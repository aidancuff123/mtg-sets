import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeName, parseDecklist, serializeDecklist } from '@/lib/decklist';

const DEFAULT = readFileSync(path.join(__dirname, '..', 'data', 'default-decklist.txt'), 'utf8');

describe('decklist parsing', () => {
  const r = parseDecklist(DEFAULT);

  it('retains all 68 entries and totals 100 cards', () => {
    expect(r.errors).toEqual([]);
    expect(r.entries).toHaveLength(68);
    expect(r.totalQuantity).toBe(100);
    expect(new Set(r.entries.map((e) => e.key)).size).toBe(68);
  });

  it('keeps Swamp at 33 copies with its set code as metadata', () => {
    const swamp = r.entries.find((e) => e.name === 'Swamp')!;
    expect(swamp.quantity).toBe(33);
    expect(swamp.setCode).toBe('mdd');
  });

  it('keeps PLST-tagged entries as cards (only their PLST printings are excluded later)', () => {
    const plst = r.entries.filter((e) => e.setCode === 'plst').map((e) => e.name);
    expect(plst).toEqual(['Gifted Aetherborn', 'Vampiric Link']);
  });

  it('normalizes curly apostrophes and preserves punctuation', () => {
    const names = r.entries.map((e) => e.name);
    expect(names).toContain("Adventurer's Inn");
    expect(names).toContain("K'rrik, Son of Yawgmoth");
    expect(names).toContain('Foul-Tongue Shriek');
    expect(names).toContain("Witch's Cottage");
    expect(names.some((n) => n.includes('’'))).toBe(false);
    const krrik = r.entries.find((e) => e.name.startsWith('K'))!;
    expect(krrik.inputName).toBe('K’rrik, Son of Yawgmoth');
  });

  it('handles ManaBox lines with collector numbers, foil markers, headers and blanks', () => {
    const p = parseDecklist('Deck\n2 Sol Ring (c21) 263 *F*\n\n1x Lightning Bolt\n// comment\n1 Fire // Ice (mh2) 290\nSideboard\n1 Sol Ring (cmm)');
    expect(p.entries.map((e) => [e.name, e.quantity, e.setCode, e.collectorNumber])).toEqual([
      ['Sol Ring', 3, 'c21', '263'],
      ['Lightning Bolt', 1, undefined, undefined],
      ['Fire // Ice', 1, 'mh2', '290'],
    ]);
    expect(p.warnings.some((w) => w.includes('merged'))).toBe(true);
  });

  it('warns about lines without quantities instead of silently dropping them', () => {
    const p = parseDecklist('Lightning Bolt\n1 Shock');
    expect(p.entries).toHaveLength(1);
    expect(p.warnings[0]).toMatch(/no leading quantity/);
  });

  it('round-trips through serialize', () => {
    const again = parseDecklist(serializeDecklist(r.entries));
    expect(again.entries).toHaveLength(68);
    expect(again.totalQuantity).toBe(100);
  });

  it('normalizeName handles smart quotes and whitespace', () => {
    expect(normalizeName('  Kiku’s   Shadow ')).toBe("Kiku's Shadow");
    expect(normalizeName('“Ach! Hans, Run!”')).toBe('"Ach! Hans, Run!"');
  });
});
