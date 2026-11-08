/**
 * Real-data integration test. Hits api.scryfall.com, so it only runs with SCRYFALL_LIVE=1:
 *   npm run test:live
 * Assertions are structural (no hard-coded rankings) so they stay valid as Scryfall data changes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDecklist } from '@/lib/decklist';
import { ScryfallClient, fetchCardPrintings } from '@/lib/scryfall';
import { buildContext, htmlReport } from '@/lib/exports';
import type { CardResult } from '@/lib/types';

const live = process.env.SCRYFALL_LIVE === '1';

describe.skipIf(!live)('live Scryfall: full supplied decklist', () => {
  it('processes all 68 entries, excludes PLST, paginates Swamp, ranks sets', async () => {
    const { entries, totalQuantity } = parseDecklist(readFileSync(path.join(__dirname, '../../data/default-decklist.txt'), 'utf8'));
    expect(entries).toHaveLength(68);
    expect(totalQuantity).toBe(100);
    const client = new ScryfallClient({ minIntervalMs: 120 });
    const results: Record<string, CardResult> = {};
    for (const e of entries) results[e.key] = await fetchCardPrintings(client, e.name);

    expect(Object.keys(results)).toHaveLength(68);
    const all = Object.values(results).flatMap((r) => r.printings);
    expect(all.some((p) => p.setCode === 'plst')).toBe(false);
    expect(all.some((p) => p.lang !== 'en')).toBe(false);
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    expect(results['swamp'].printings.length).toBeGreaterThan(175); // > 1 page of search results
    // The two PLST-tagged entries must still resolve via other printings
    expect(results['gifted aetherborn'].status).toBe('ok');
    expect(results['vampiric link'].status).toBe('ok');

    const ctx = buildContext(entries, results);
    for (let i = 1; i < ctx.groups.length; i++) expect(ctx.groups[i - 1].uniqueCount).toBeGreaterThanOrEqual(ctx.groups[i].uniqueCount);
    // every card appears in every set it has a printing in
    for (const r of Object.values(results)) {
      const sets = new Set(r.printings.map((p) => p.setCode));
      const inGroups = ctx.groups.filter((g) => g.cards.some((c) => c.entry.key === r.key)).length;
      expect(inGroups).toBe(sets.size);
    }
    const html = htmlReport(ctx);
    expect(html).not.toMatch(/<script/i);
    const unresolved = Object.values(results).filter((r) => r.status !== 'ok');
    console.log(`Sets: ${ctx.groups.length}, printings: ${all.length}, requests: ${client.requestCount}`);
    console.log('Top 5:', ctx.groups.slice(0, 5).map((g) => `${g.setCode.toUpperCase()}=${g.uniqueCount}`).join(', '));
    console.log('Unresolved:', unresolved.map((u) => `${u.queryName}: ${u.message}`));
  });
});
