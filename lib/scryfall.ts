import type { CardResult, Printing, SetInfo } from './types';
import { EXCLUDED_SET_CODES } from './types';
import { normalizeName, nameKey } from './decklist';

export const SCRYFALL_BASE = 'https://api.scryfall.com';
const HEADERS = {
  'User-Agent': 'MTGOverlapAnalyzer/1.0 (personal deck tool)',
  Accept: 'application/json;q=0.9,*/*;q=0.8',
};

export interface ClientOptions {
  fetchFn?: typeof fetch;
  /** Minimum gap between request starts. Default 120ms (~8 req/s, below Scryfall's 10/s). */
  minIntervalMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Max wait honoured from a Retry-After header */
  maxBackoffMs?: number;
  /** Request headers. Defaults to a descriptive User-Agent + Accept (server). Pass {} in browsers. */
  headers?: Record<string, string>;
}

export class ScryfallError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Serializes all requests made through one client with a minimum spacing. */
export class ScryfallClient {
  private fetchFn: typeof fetch;
  private minIntervalMs: number;
  private maxRetries: number;
  private sleep: (ms: number) => Promise<void>;
  private maxBackoffMs: number;
  private headers: Record<string, string>;
  private chain: Promise<unknown> = Promise.resolve();
  private lastStart = 0;
  public requestCount = 0;

  constructor(opts: ClientOptions = {}) {
    // wrap: browsers throw "Illegal invocation" if fetch is called with `this` bound to another object
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
    this.minIntervalMs = opts.minIntervalMs ?? 120;
    this.maxRetries = opts.maxRetries ?? 4;
    this.sleep = opts.sleep ?? realSleep;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000;
    this.headers = opts.headers ?? HEADERS;
  }

  private schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = this.lastStart + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = Date.now();
      this.requestCount++;
      return task();
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** GET JSON. Returns null on 404. Retries 429/5xx/network errors with bounded exponential backoff. */
  async getJson<T = any>(url: string): Promise<T | null> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.schedule(() => this.fetchFn(url, { headers: this.headers, cache: 'no-store' }));
      } catch (err) {
        if (attempt >= this.maxRetries) throw new ScryfallError(`Network error contacting Scryfall: ${(err as Error).message}`);
        await this.sleep(Math.min(1000 * 2 ** attempt, this.maxBackoffMs));
        attempt++;
        continue;
      }
      if (res.status === 404) return null;
      if (res.ok) return (await res.json()) as T;
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= this.maxRetries) {
          throw new ScryfallError(`Scryfall returned HTTP ${res.status} after ${attempt + 1} attempts`, res.status);
        }
        const ra = Number(res.headers.get('retry-after'));
        const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt;
        await this.sleep(Math.min(backoff, this.maxBackoffMs));
        attempt++;
        continue;
      }
      let detail = '';
      try {
        detail = ((await res.json()) as any)?.details ?? '';
      } catch {}
      throw new ScryfallError(`Scryfall HTTP ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
    }
  }
}

export function isEligible(c: any): boolean {
  if (!c || c.object !== 'card') return false;
  if (EXCLUDED_SET_CODES.has(String(c.set).toLowerCase())) return false;
  if (c.digital) return false;
  if (Array.isArray(c.games) && !c.games.includes('paper')) return false;
  if (c.lang && c.lang !== 'en') return false;
  return true;
}

export function toPrinting(c: any, fetchedAt: string): Printing {
  const face0 = Array.isArray(c.card_faces) ? c.card_faces[0] : undefined;
  const imgs = c.image_uris ?? face0?.image_uris ?? null;
  return {
    id: c.id,
    oracleId: c.oracle_id ?? face0?.oracle_id ?? null,
    name: c.name,
    setName: c.set_name,
    setCode: String(c.set).toLowerCase(),
    setType: c.set_type ?? 'unknown',
    collectorNumber: String(c.collector_number ?? ''),
    rarity: c.rarity ?? 'unknown',
    usd: c.prices?.usd ?? null,
    usdFoil: c.prices?.usd_foil ?? null,
    usdEtched: c.prices?.usd_etched ?? null,
    finishes: c.finishes ?? [],
    promo: !!c.promo,
    promoTypes: c.promo_types ?? [],
    fullArt: !!c.full_art,
    frameEffects: c.frame_effects ?? [],
    borderColor: c.border_color ?? '',
    releasedAt: c.released_at ?? '',
    lang: c.lang ?? 'en',
    imageSmall: imgs?.small ?? null,
    imageNormal: imgs?.normal ?? null,
    scryfallUri: c.scryfall_uri ?? `https://scryfall.com/card/${c.set}/${c.collector_number}`,
    pricesFetchedAt: fetchedAt,
  };
}

function escapeQuoted(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildSearchUrl(query: string): string {
  const p = new URLSearchParams({
    q: `${query} lang:en game:paper -set:plst`,
    unique: 'prints',
    include_extras: 'true',
    include_variations: 'true',
    include_multilingual: 'false',
    order: 'released',
    dir: 'asc',
  });
  return `${SCRYFALL_BASE}/cards/search?${p.toString()}`;
}

/** Follow every page of a search. Returns null if the first page 404s (no matches). */
export async function searchAllPages(client: ScryfallClient, firstUrl: string): Promise<any[] | null> {
  const out: any[] = [];
  let url: string | null = firstUrl;
  let first = true;
  let guard = 0;
  while (url) {
    if (++guard > 200) throw new ScryfallError('Pagination exceeded 200 pages — aborting');
    const page: any = await client.getJson(url);
    if (!page) {
      if (first) return null;
      throw new ScryfallError('A later results page returned 404');
    }
    first = false;
    if (Array.isArray(page.data)) out.push(...page.data);
    url = page.has_more && page.next_page ? page.next_page : null;
  }
  return out;
}

/** Fetch every eligible English paper printing of one card name (exact match). */
export async function fetchCardPrintings(client: ScryfallClient, inputName: string): Promise<CardResult> {
  const name = normalizeName(inputName);
  const key = nameKey(inputName);
  const fetchedAt = new Date().toISOString();

  let raw = await searchAllPages(client, buildSearchUrl(`!"${escapeQuoted(name)}"`));
  let resolvedName: string | undefined;
  let oracleId: string | null | undefined;

  if (!raw) {
    // Exact search can miss e.g. a single face of a double-faced card — resolve via /cards/named?exact
    const named: any = await client.getJson(`${SCRYFALL_BASE}/cards/named?${new URLSearchParams({ exact: name })}`);
    if (!named) {
      return { key, queryName: name, status: 'unresolved', printings: [], message: `Scryfall has no card named "${name}"`, fetchedAt };
    }
    resolvedName = named.name;
    oracleId = named.oracle_id ?? named.card_faces?.[0]?.oracle_id ?? null;
    raw = oracleId ? await searchAllPages(client, buildSearchUrl(`oracleid:${oracleId}`)) : null;
    if (!raw) {
      return {
        key, queryName: name, status: 'no-printings', resolvedName, oracleId, printings: [], fetchedAt,
        message: `"${resolvedName}" exists but has no English paper printings outside The List`,
      };
    }
  }

  const byId = new Map<string, Printing>();
  for (const c of raw) {
    if (!isEligible(c)) continue;
    if (!byId.has(c.id)) byId.set(c.id, toPrinting(c, fetchedAt));
  }
  const printings = [...byId.values()];
  if (!printings.length) {
    return { key, queryName: name, status: 'no-printings', printings: [], fetchedAt, message: `No eligible paper printings for "${name}"` };
  }
  return {
    key,
    queryName: name,
    status: 'ok',
    resolvedName: resolvedName ?? printings[0].name,
    oracleId: oracleId ?? printings[0].oracleId,
    printings,
    fetchedAt,
  };
}

export async function fetchSets(client: ScryfallClient): Promise<SetInfo[]> {
  const res: any = await client.getJson(`${SCRYFALL_BASE}/sets`);
  if (!res?.data) return [];
  return res.data.map((s: any) => ({
    code: String(s.code).toLowerCase(),
    name: s.name,
    setType: s.set_type,
    iconSvgUri: s.icon_svg_uri ?? null,
    releasedAt: s.released_at ?? null,
  }));
}
