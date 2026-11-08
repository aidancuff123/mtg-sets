import { describe, expect, it, vi } from 'vitest';
import { ScryfallClient, buildSearchUrl, fetchCardPrintings } from '@/lib/scryfall';
import { jsonResponse, sfCard } from './helpers';

const noSleep = () => Promise.resolve();
function client(fetchFn: (url: string) => Promise<Response>, extra = {}) {
  return new ScryfallClient({ fetchFn: fetchFn as any, minIntervalMs: 0, sleep: noSleep, ...extra });
}

describe('Scryfall query construction', () => {
  it('uses exact name, unique=prints, English paper, and excludes PLST', () => {
    const u = new URL(buildSearchUrl('!"Kiku\'s Shadow"'));
    expect(u.searchParams.get('unique')).toBe('prints');
    expect(u.searchParams.get('q')).toBe('!"Kiku\'s Shadow" lang:en game:paper -set:plst');
    expect(u.searchParams.get('include_extras')).toBe('true');
  });

  it('normalizes curly apostrophes before querying', async () => {
    const urls: string[] = [];
    const c = client(async (url) => {
      urls.push(url);
      return jsonResponse({ object: 'list', has_more: false, data: [sfCard({ name: "Kiku's Shadow", set: 'sok' })] });
    });
    const r = await fetchCardPrintings(c, 'Kiku’s Shadow');
    expect(r.status).toBe('ok');
    expect(new URL(urls[0]).searchParams.get('q')).toContain('!"Kiku\'s Shadow"');
  });
});

describe('fetchCardPrintings', () => {
  it('follows every page (Swamp-style pagination) and dedupes by Scryfall ID', async () => {
    const dup = sfCard({ name: 'Swamp', set: 'm19', id: 'dup-id' });
    const pages = [
      { has_more: true, next_page: 'https://api.scryfall.com/page2', data: [sfCard({ name: 'Swamp', set: 'lea' }), dup] },
      { has_more: true, next_page: 'https://api.scryfall.com/page3', data: [dup, sfCard({ name: 'Swamp', set: 'm19' })] },
      { has_more: false, data: [sfCard({ name: 'Swamp', set: 'fdn' })] },
    ];
    let i = 0;
    const c = client(async () => jsonResponse({ object: 'list', ...pages[i++] }));
    const r = await fetchCardPrintings(c, 'Swamp');
    expect(i).toBe(3);
    expect(r.printings).toHaveLength(4);
    expect(new Set(r.printings.map((p) => p.id)).size).toBe(4);
  });

  it('drops PLST, digital-only, non-English and non-paper records even if returned', async () => {
    const c = client(async () =>
      jsonResponse({
        object: 'list', has_more: false,
        data: [
          sfCard({ name: 'Vampiric Link', set: 'plst', set_name: 'The List' }),
          sfCard({ name: 'Vampiric Link', set: 'PLST' }),
          sfCard({ name: 'Vampiric Link', set: 'prm', digital: true }),
          sfCard({ name: 'Vampiric Link', set: 'nem', lang: 'ja' }),
          sfCard({ name: 'Vampiric Link', set: 'me4', games: ['mtgo'] }),
          sfCard({ name: 'Vampiric Link', set: 'nem' }),
        ],
      }),
    );
    const r = await fetchCardPrintings(c, 'Vampiric Link');
    expect(r.printings.map((p) => p.setCode)).toEqual(['nem']);
  });

  it('keeps null prices as null (never $0) and preserves all fields', async () => {
    const c = client(async () =>
      jsonResponse({ object: 'list', has_more: false, data: [sfCard({ name: 'Fear', set: '10e', prices: { usd: null, usd_foil: '3.10', usd_etched: null }, rarity: 'common', promo: true })] }),
    );
    const [p] = (await fetchCardPrintings(c, 'Fear')).printings;
    expect(p.usd).toBeNull();
    expect(p.usdFoil).toBe('3.10');
    expect(p.promo).toBe(true);
    expect(p.oracleId).toBe('oracle-Fear');
    expect(p.scryfallUri).toMatch(/^https:\/\/scryfall\.com\/card\/10e\//);
  });

  it('falls back to /cards/named then reports unresolved cards explicitly', async () => {
    const urls: string[] = [];
    const c = client(async (url) => {
      urls.push(url);
      return jsonResponse({ object: 'error', code: 'not_found', status: 404 }, 404);
    });
    const r = await fetchCardPrintings(c, 'Totally Fake Card');
    expect(r.status).toBe('unresolved');
    expect(r.message).toMatch(/no card named/i);
    expect(urls[1]).toContain('/cards/named?exact=Totally+Fake+Card');
  });

  it('resolves a double-faced card face via /cards/named + oracleid search', async () => {
    const c = client(async (url) => {
      if (url.includes('/cards/named')) return jsonResponse({ object: 'card', name: 'Front // Back', oracle_id: 'abc' });
      if (url.includes('oracleid%3Aabc')) return jsonResponse({ object: 'list', has_more: false, data: [sfCard({ name: 'Front // Back', set: 'mid' })] });
      return jsonResponse({ object: 'error' }, 404);
    });
    const r = await fetchCardPrintings(c, 'Front');
    expect(r.status).toBe('ok');
    expect(r.resolvedName).toBe('Front // Back');
  });
});

describe('rate limiting and retries', () => {
  it('backs off on HTTP 429 honouring Retry-After, then succeeds', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const c = new ScryfallClient({
      minIntervalMs: 0,
      sleep: async (ms) => { sleeps.push(ms); },
      fetchFn: (async () => (++n < 3 ? jsonResponse({}, 429, { 'retry-after': '2' }) : jsonResponse({ ok: 1 }))) as any,
    });
    expect(await c.getJson('https://api.scryfall.com/x')).toEqual({ ok: 1 });
    expect(sleeps.filter((ms) => ms === 2000)).toHaveLength(2); // Retry-After honoured (other entries are pacing waits)
  });

  it('never retries indefinitely on persistent 429', async () => {
    const f = vi.fn(async () => jsonResponse({}, 429));
    const c = client(f, { maxRetries: 3 });
    await expect(c.getJson('https://api.scryfall.com/x')).rejects.toThrow(/429 after 4 attempts/);
    expect(f).toHaveBeenCalledTimes(4);
  });

  it('spaces requests at least minIntervalMs apart (< 10 req/s)', async () => {
    const starts: number[] = [];
    const c = new ScryfallClient({ minIntervalMs: 110, fetchFn: (async () => { starts.push(Date.now()); return jsonResponse({}); }) as any });
    await Promise.all([1, 2, 3, 4].map(() => c.getJson('https://api.scryfall.com/x')));
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(100);
  });

  it('paces /cards/search and /cards/named at Scryfall\'s 2/s limit, other endpoints faster', () => {
    const c = new ScryfallClient({ minIntervalMs: 120 });
    expect(c.intervalFor('https://api.scryfall.com/cards/search?q=x')).toBeGreaterThanOrEqual(500);
    expect(c.intervalFor('https://api.scryfall.com/cards/named?exact=x')).toBeGreaterThanOrEqual(500);
    expect(c.intervalFor('https://api.scryfall.com/sets')).toBe(120);
  });

  it('slows the whole session down after a 429 or a CORS-less network failure', async () => {
    let n = 0;
    const c = new ScryfallClient({ minIntervalMs: 0, sleep: noSleep, fetchFn: (async () => {
      n++;
      if (n === 1) throw new TypeError('Load failed');
      if (n === 2) return jsonResponse({}, 429);
      return jsonResponse({ ok: 1 });
    }) as any });
    await c.getJson('https://api.scryfall.com/cards/search?q=x');
    expect(c.intervalFor('https://api.scryfall.com/cards/search?q=x')).toBeGreaterThan(550);
  });

  it('surfaces non-retryable errors with Scryfall details', async () => {
    const c = client(async () => jsonResponse({ object: 'error', details: 'bad query' }, 400));
    await expect(c.getJson('https://api.scryfall.com/x')).rejects.toThrow(/400: bad query/);
  });
});
