/**
 * Seeds a TEMPORARY cache directory with SYNTHETIC Scryfall-shaped data for the e2e test only.
 * Set names are "Fixture Set NN" so this can never be mistaken for real data.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDecklist } from '../../lib/decklist';
import { writeCache } from '../../lib/cache';
import { toPrinting } from '../../lib/scryfall';
import type { CardResult } from '../../lib/types';

const dir = process.argv[2];
const { entries } = parseDecklist(readFileSync(path.join(__dirname, '../../data/default-decklist.txt'), 'utf8'));
const now = new Date().toISOString();
const rar = ['common', 'uncommon', 'rare', 'mythic'];
let n = 0;
(async () => {
  for (const [i, e] of entries.entries()) {
    const sets: string[] = [];
    const count = e.name === 'Swamp' ? 30 : 1 + ((i * 7) % 6);
    for (let k = 0; k < count; k++) sets.push(String(((i * 3 + k * 5) % 40) + 1).padStart(2, '0'));
    if (e.name === 'Swamp' || e.name === 'Fear') sets.push('01', '02', '03'); // guarantee overlap at the top
    const printings = [...new Set(sets)].flatMap((s, k) => {
      const variants = e.name === 'Swamp' ? 3 : 1;
      return Array.from({ length: variants }, (_, v) => {
        n++;
        return toPrinting({
          object: 'card', id: `fixture-${n}`, oracle_id: `oracle-${e.key}`, name: e.name, lang: 'en', set: `f${s}`,
          set_name: `Fixture Set ${s}`, set_type: k % 3 ? 'expansion' : 'commander', collector_number: String(100 + v + k),
          rarity: rar[(i + k) % 4], prices: { usd: (i + k) % 5 === 0 ? null : ((i + 1) * 0.11 + k * 0.03).toFixed(2), usd_foil: (i + k) % 3 === 0 ? null : ((i + 1) * 0.5).toFixed(2), usd_etched: null },
          finishes: ['nonfoil', 'foil'], promo: k % 7 === 0, digital: false, games: ['paper'], released_at: `20${String(10 + (Number(s) % 15))}-01-01`,
          image_uris: null, scryfall_uri: `https://scryfall.com/card/f${s}/${100 + v + k}`,
        }, now);
      });
    });
    if (e.name === 'Vampiric Link') printings.push(toPrinting({ object: 'card', id: 'fixture-plst', name: e.name, set: 'plst', set_name: 'The List', set_type: 'memorabilia', collector_number: 'X-1', rarity: 'common', prices: {}, games: ['paper'], lang: 'en' }, now));
    const r: CardResult = { key: e.key, queryName: e.name, status: 'ok', resolvedName: e.name, printings, fetchedAt: now };
    await writeCache(`card:${e.key}`, r, dir);
  }
  console.log(`seeded ${entries.length} cards into ${dir}`);
})();
