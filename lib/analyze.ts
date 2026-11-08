import type { CardResult, DeckEntry, Filters, Printing, SetInfo } from './types';
import { EXCLUDED_SET_CODES } from './types';

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'];
export function rarityRank(r: string) {
  const i = RARITY_ORDER.indexOf(r);
  return i < 0 ? RARITY_ORDER.length : i;
}

export function price(v: string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Cheapest foil-type price for a printing (traditional foil or etched foil). */
export function foilPrice(p: Printing): number | null {
  const a = price(p.usdFoil);
  const b = price(p.usdEtched);
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

export function modePrice(p: Printing, mode: 'nonfoil' | 'foil'): number | null {
  return mode === 'foil' ? foilPrice(p) : price(p.usd);
}

const SPECIAL_FRAMES = new Set(['showcase', 'extendedart', 'inverted', 'etched', 'shatteredglass', 'textless']);
export function isSpecial(p: Printing): boolean {
  return (
    p.fullArt ||
    p.borderColor === 'borderless' ||
    p.frameEffects.some((f) => SPECIAL_FRAMES.has(f)) ||
    /[^0-9]/.test(p.collectorNumber)
  );
}

export function filterPrintings(printings: Printing[], f: Filters): Printing[] {
  const setQ = f.setQuery.trim().toLowerCase();
  return printings.filter((p) => {
    if (EXCLUDED_SET_CODES.has(p.setCode)) return false; // PLST can never come back through filters
    if (setQ && !p.setCode.includes(setQ) && !p.setName.toLowerCase().includes(setQ)) return false;
    if (f.rarities.length && !f.rarities.includes(p.rarity)) return false;
    if (f.setTypes.length && !f.setTypes.includes(p.setType)) return false;
    if (!f.includePromos && p.promo) return false;
    if (!f.includeSpecial && isSpecial(p)) return false;
    if (f.minPrice != null || f.maxPrice != null) {
      const v = modePrice(p, f.priceMode);
      if (v == null) return false;
      if (f.minPrice != null && v < f.minPrice) return false;
      if (f.maxPrice != null && v > f.maxPrice) return false;
    }
    return true;
  });
}

export interface WorkingCard {
  entry: DeckEntry;
  result?: CardResult;
  printings: Printing[]; // after filters
}

export function workingSet(entries: DeckEntry[], results: Record<string, CardResult>, f: Filters): WorkingCard[] {
  const q = f.cardQuery.trim().toLowerCase();
  return entries
    .filter((e) => !q || e.name.toLowerCase().includes(q) || e.inputName.toLowerCase().includes(q))
    .map((entry) => {
      const result = results[entry.key];
      return { entry, result, printings: result ? filterPrintings(result.printings, f) : [] };
    });
}

export interface SetGroupCard {
  entry: DeckEntry;
  printings: Printing[]; // all variants of this card in this set
}

export interface SetGroup {
  setCode: string;
  setName: string;
  setType: string;
  releasedAt: string;
  iconSvgUri: string | null;
  cards: SetGroupCard[];
  uniqueCount: number;
  physicalQuantity: number;
  percentOfDeck: number;
  printingCount: number;
}

/**
 * Each card is placed in EVERY set where it has an eligible printing. A set's score is the number of
 * distinct deck entries it contains (quantities don't count; multiple variants count once).
 */
export function buildSetGroups(cards: WorkingCard[], totalEntries: number, sets: Record<string, SetInfo> = {}): SetGroup[] {
  const groups = new Map<string, SetGroup>();
  for (const c of cards) {
    const bySet = new Map<string, Printing[]>();
    for (const p of c.printings) {
      if (EXCLUDED_SET_CODES.has(p.setCode)) continue;
      const arr = bySet.get(p.setCode) ?? [];
      arr.push(p);
      bySet.set(p.setCode, arr);
    }
    for (const [code, ps] of bySet) {
      let g = groups.get(code);
      if (!g) {
        const p0 = ps[0];
        g = {
          setCode: code,
          setName: p0.setName,
          setType: p0.setType,
          releasedAt: sets[code]?.releasedAt ?? p0.releasedAt,
          iconSvgUri: sets[code]?.iconSvgUri ?? null,
          cards: [],
          uniqueCount: 0,
          physicalQuantity: 0,
          percentOfDeck: 0,
          printingCount: 0,
        };
        groups.set(code, g);
      }
      ps.sort((a, b) => collectorCompare(a.collectorNumber, b.collectorNumber));
      g.cards.push({ entry: c.entry, printings: ps });
      g.uniqueCount += 1;
      g.physicalQuantity += c.entry.quantity;
      g.printingCount += ps.length;
    }
  }
  const out = [...groups.values()];
  for (const g of out) {
    g.percentOfDeck = totalEntries ? (g.uniqueCount / totalEntries) * 100 : 0;
    g.cards.sort((a, b) => a.entry.name.localeCompare(b.entry.name));
  }
  out.sort(
    (a, b) =>
      b.uniqueCount - a.uniqueCount ||
      b.physicalQuantity - a.physicalQuantity ||
      a.setName.localeCompare(b.setName),
  );
  return out;
}

export function collectorCompare(a: string, b: string) {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

export interface CardView {
  entry: DeckEntry;
  status: CardResult['status'] | 'pending';
  message?: string;
  sets: { setCode: string; setName: string; setType: string; releasedAt: string; printings: Printing[] }[];
  printingCount: number;
  minNonfoil: number | null;
  maxNonfoil: number | null;
  minFoil: number | null;
  minAny: number | null;
  maxAny: number | null;
}

export function buildCardViews(cards: WorkingCard[]): CardView[] {
  return cards.map((c) => {
    const bySet = new Map<string, CardView['sets'][number]>();
    for (const p of c.printings) {
      const s = bySet.get(p.setCode) ?? { setCode: p.setCode, setName: p.setName, setType: p.setType, releasedAt: p.releasedAt, printings: [] };
      s.printings.push(p);
      bySet.set(p.setCode, s);
    }
    const sets = [...bySet.values()].sort((a, b) => a.releasedAt.localeCompare(b.releasedAt) || a.setName.localeCompare(b.setName));
    const nf = c.printings.map((p) => price(p.usd)).filter((v): v is number => v != null);
    const fo = c.printings.map(foilPrice).filter((v): v is number => v != null);
    const any = [...nf, ...fo];
    return {
      entry: c.entry,
      status: c.result?.status ?? 'pending',
      message: c.result?.message,
      sets,
      printingCount: c.printings.length,
      minNonfoil: nf.length ? Math.min(...nf) : null,
      maxNonfoil: nf.length ? Math.max(...nf) : null,
      minFoil: fo.length ? Math.min(...fo) : null,
      minAny: any.length ? Math.min(...any) : null,
      maxAny: any.length ? Math.max(...any) : null,
    };
  });
}

export type CardSort = 'most-sets' | 'fewest-sets' | 'name' | 'lowest-price' | 'highest-price';
export function sortCardViews(views: CardView[], sort: CardSort): CardView[] {
  const byName = (a: CardView, b: CardView) => a.entry.name.localeCompare(b.entry.name);
  const nullLast = (a: number | null, b: number | null, dir: 1 | -1) =>
    a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : (a - b) * dir;
  const v = [...views];
  switch (sort) {
    case 'most-sets': return v.sort((a, b) => b.sets.length - a.sets.length || byName(a, b));
    case 'fewest-sets': return v.sort((a, b) => a.sets.length - b.sets.length || byName(a, b));
    case 'lowest-price': return v.sort((a, b) => nullLast(a.minAny, b.minAny, 1) || byName(a, b));
    case 'highest-price': return v.sort((a, b) => nullLast(a.maxAny, b.maxAny, -1) || byName(a, b));
    default: return v.sort(byName);
  }
}

export interface Cheapest {
  printing: Printing;
  value: number;
}

export function cheapest(printings: Printing[], mode: 'nonfoil' | 'foil'): Cheapest | null {
  let best: Cheapest | null = null;
  for (const p of printings) {
    const v = modePrice(p, mode);
    if (v == null) continue; // unknown price is never "cheapest"
    if (!best || v < best.value) best = { printing: p, value: v };
  }
  return best;
}

export interface DeckCost {
  total: number;
  pricedEntries: number;
  missing: DeckEntry[];
  complete: boolean;
  lines: { entry: DeckEntry; cheapest: Cheapest | null; lineTotal: number | null }[];
}

export function deckCost(cards: WorkingCard[], mode: 'nonfoil' | 'foil'): DeckCost {
  const lines = cards.map((c) => {
    const ch = cheapest(c.printings, mode);
    return { entry: c.entry, cheapest: ch, lineTotal: ch ? ch.value * c.entry.quantity : null };
  });
  const missing = lines.filter((l) => !l.cheapest).map((l) => l.entry);
  const total = lines.reduce((s, l) => s + (l.lineTotal ?? 0), 0);
  return { total, pricedEntries: lines.length - missing.length, missing, complete: missing.length === 0, lines };
}

export interface Selection {
  printingId: string;
  finish: 'nonfoil' | 'foil' | 'etched';
}

export function selectedCost(cards: WorkingCard[], results: Record<string, CardResult>, selections: Record<string, Selection>) {
  let total = 0;
  const missing: string[] = [];
  let selectedCount = 0;
  for (const c of cards) {
    const sel = selections[c.entry.key];
    if (!sel) continue;
    selectedCount++;
    const p = results[c.entry.key]?.printings.find((x) => x.id === sel.printingId);
    const v = p ? price(sel.finish === 'foil' ? p.usdFoil : sel.finish === 'etched' ? p.usdEtched : p.usd) : null;
    if (v == null) missing.push(c.entry.name);
    else total += v * c.entry.quantity;
  }
  return { total, missing, selectedCount };
}

export interface Summary {
  entries: number;
  totalQuantity: number;
  setsFound: number;
  printingRecords: number;
  printingsWithPrice: number;
  resolved: number;
  unresolved: CardResult[];
  errored: CardResult[];
  pending: number;
  complete: boolean;
}

export function summarize(entries: DeckEntry[], results: Record<string, CardResult>, cards: WorkingCard[], groups: SetGroup[]): Summary {
  const all = cards.flatMap((c) => c.printings);
  const unresolved: CardResult[] = [];
  const errored: CardResult[] = [];
  let resolved = 0;
  let pending = 0;
  for (const e of entries) {
    const r = results[e.key];
    if (!r) pending++;
    else if (r.status === 'ok') resolved++;
    else if (r.status === 'error') errored.push(r);
    else unresolved.push(r);
  }
  return {
    entries: entries.length,
    totalQuantity: entries.reduce((s, e) => s + e.quantity, 0),
    setsFound: groups.length,
    printingRecords: all.length,
    printingsWithPrice: all.filter((p) => p.usd != null || p.usdFoil != null || p.usdEtched != null).length,
    resolved,
    unresolved,
    errored,
    pending,
    // complete only when every entry is processed (ok or explicitly flagged unresolved) with no errors
    complete: pending === 0 && errored.length === 0,
  };
}

export function fmtUsd(v: string | number | null | undefined): string {
  if (v == null || v === '') return 'N/A';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 'N/A';
  return `$${n.toFixed(2)}`;
}

export function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
