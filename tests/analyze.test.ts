import { describe, expect, it } from 'vitest';
import { parseDecklist } from '@/lib/decklist';
import { buildCardViews, buildSetGroups, cheapest, deckCost, filterPrintings, fmtUsd, sortCardViews, summarize, workingSet } from '@/lib/analyze';
import { DEFAULT_FILTERS, type CardResult } from '@/lib/types';
import { printing, result } from './helpers';

function setup(deck: string, results: CardResult[], filters = DEFAULT_FILTERS) {
  const { entries } = parseDecklist(deck);
  const map = Object.fromEntries(results.map((r) => [r.key, r]));
  const cards = workingSet(entries, map, filters);
  return { entries, map, cards, groups: buildSetGroups(cards, entries.length) };
}

describe('set overlap grouping', () => {
  // Spec example: A has cards 1-4, B has 1-2, C has 3
  const deck = '1 Card One\n1 Card Two\n1 Card Three\n1 Card Four';
  const rs = [
    result('Card One', [printing({ name: 'Card One', set: 'aaa' }), printing({ name: 'Card One', set: 'bbb' })]),
    result('Card Two', [printing({ name: 'Card Two', set: 'aaa' }), printing({ name: 'Card Two', set: 'bbb' })]),
    result('Card Three', [printing({ name: 'Card Three', set: 'aaa' }), printing({ name: 'Card Three', set: 'ccc' })]),
    result('Card Four', [printing({ name: 'Card Four', set: 'aaa' })]),
  ];

  it('ranks sets by distinct card count (A, B, C)', () => {
    const { groups } = setup(deck, rs);
    expect(groups.map((g) => [g.setCode, g.uniqueCount])).toEqual([['aaa', 4], ['bbb', 2], ['ccc', 1]]);
  });

  it('places each card in every set it has a printing in', () => {
    const { groups } = setup(deck, rs);
    const where = (n: string) => groups.filter((g) => g.cards.some((c) => c.entry.name === n)).map((g) => g.setCode);
    expect(where('Card One')).toEqual(['aaa', 'bbb']);
    expect(where('Card Three')).toEqual(['aaa', 'ccc']);
  });

  it('counts Swamp once per set regardless of 33 copies or many variants, but keeps quantity', () => {
    const swamps = [1, 2, 3, 4].map((n) => printing({ name: 'Swamp', set: 'zzz', collector_number: String(270 + n) }));
    const { groups } = setup('33 Swamp\n1 Fear\n1 Cremate', [
      result('Swamp', swamps),
      result('Fear', [printing({ name: 'Fear', set: 'yyy' })]),
      result('Cremate', [printing({ name: 'Cremate', set: 'yyy' })]),
    ]);
    const z = groups.find((g) => g.setCode === 'zzz')!;
    expect(z.uniqueCount).toBe(1);
    expect(z.physicalQuantity).toBe(33);
    expect(z.cards[0].printings).toHaveLength(4); // every variant retained
    expect(groups[0].setCode).toBe('yyy'); // 2 distinct beats 1 distinct with 33 copies
  });

  it('computes percentage of distinct deck entries', () => {
    const { groups } = setup(deck, rs);
    expect(groups[0].percentOfDeck).toBe(100);
    expect(groups[1].percentOfDeck).toBe(50);
  });

  it('keeps different rarities per printing', () => {
    const { groups } = setup('1 Fear', [
      result('Fear', [printing({ name: 'Fear', set: 'lea', rarity: 'common' }), printing({ name: 'Fear', set: 'p30', rarity: 'rare' })]),
    ]);
    expect(groups.flatMap((g) => g.cards.flatMap((c) => c.printings.map((p) => p.rarity))).sort()).toEqual(['common', 'rare']);
  });
});

describe('PLST exclusion', () => {
  it('never groups PLST even if a PLST record slips into results, and filters cannot re-include it', () => {
    const r = result('Vampiric Link', [printing({ name: 'Vampiric Link', set: 'plst' }), printing({ name: 'Vampiric Link', set: 'nem' })]);
    const { groups } = setup('1 Vampiric Link (plst)', [r], { ...DEFAULT_FILTERS, setQuery: 'plst' });
    expect(groups).toEqual([]);
    const all = setup('1 Vampiric Link (plst)', [r]);
    expect(all.groups.map((g) => g.setCode)).toEqual(['nem']);
    expect(filterPrintings(r.printings, DEFAULT_FILTERS).map((p) => p.setCode)).toEqual(['nem']);
  });
});

describe('prices', () => {
  const ps = [
    printing({ name: 'Fear', set: 'a', prices: { usd: null, usd_foil: null } }),
    printing({ name: 'Fear', set: 'b', prices: { usd: '0.50', usd_foil: null } }),
    printing({ name: 'Fear', set: 'c', prices: { usd: '0.20', usd_foil: '4.00', usd_etched: '2.00' } }),
  ];

  it('never treats an unknown price as cheapest', () => {
    expect(cheapest(ps, 'nonfoil')!.printing.setCode).toBe('c');
    expect(cheapest(ps, 'foil')!.value).toBe(2.0); // etched counted in the foil column
    expect(cheapest([ps[0]], 'nonfoil')).toBeNull();
  });

  it('formats null prices as N/A, not $0', () => {
    expect(fmtUsd(null)).toBe('N/A');
    expect(fmtUsd('0.2')).toBe('$0.20');
  });

  it('weights deck cost by quantity and flags incomplete totals', () => {
    const { cards } = setup('33 Swamp\n1 Fear\n1 Mystery', [
      result('Swamp', [printing({ name: 'Swamp', set: 'x', prices: { usd: '0.10' } })]),
      result('Fear', ps),
      result('Mystery', [printing({ name: 'Mystery', set: 'y', prices: { usd: null, usd_foil: null } })]),
    ]);
    const c = deckCost(cards, 'nonfoil');
    expect(c.total).toBeCloseTo(33 * 0.1 + 0.2);
    expect(c.complete).toBe(false);
    expect(c.missing.map((m) => m.name)).toEqual(['Mystery']);
  });

  it('price filter excludes printings without a known price', () => {
    expect(filterPrintings(ps, { ...DEFAULT_FILTERS, maxPrice: 1 }).map((p) => p.setCode)).toEqual(['b', 'c']);
  });
});

describe('card views and completeness', () => {
  it('sorts cards by set availability and reports unresolved/pending honestly', () => {
    const deck = '1 Many\n1 Few\n1 Ghost\n1 Pending';
    const { entries, map, cards, groups } = setup(deck, [
      result('Many', ['a', 'b', 'c'].map((s) => printing({ name: 'Many', set: s }))),
      result('Few', [printing({ name: 'Few', set: 'a' })]),
      { key: 'ghost', queryName: 'Ghost', status: 'unresolved', printings: [], message: 'not found' },
    ]);
    const v = buildCardViews(cards);
    expect(sortCardViews(v, 'most-sets').map((x) => x.entry.name).slice(0, 2)).toEqual(['Many', 'Few']);
    const s = summarize(entries, map, cards, groups);
    expect(s.unresolved.map((u) => u.queryName)).toEqual(['Ghost']);
    expect(s.pending).toBe(1);
    expect(s.complete).toBe(false);
  });

  it('partial API failures keep successful data and mark dataset incomplete', () => {
    const { entries, map, cards, groups } = setup('1 Good\n1 Broken', [
      result('Good', [printing({ name: 'Good', set: 'a' })]),
      { key: 'broken', queryName: 'Broken', status: 'error', printings: [], message: 'HTTP 503' },
    ]);
    const s = summarize(entries, map, cards, groups);
    expect(groups).toHaveLength(1);
    expect(s.errored).toHaveLength(1);
    expect(s.complete).toBe(false);
  });
});
