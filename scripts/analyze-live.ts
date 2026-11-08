/**
 * Command-line full analysis: fetches (through the same 24h cache the web app uses) and writes every report.
 *   npm run analyze:live              # uses data/saved-decklist.txt or the default list
 *   npm run analyze:live -- deck.txt  # any decklist file
 */
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { parseDecklist } from '../lib/decklist';
import { ScryfallClient, fetchCardPrintings } from '../lib/scryfall';
import { cachedFetch } from '../lib/cache';
import { buildContext, fullPrintingsCsv, groupedByCardCsv, groupedBySetCsv, htmlReport, textReport } from '../lib/exports';
import type { CardResult } from '../lib/types';

async function main() {
  const arg = process.argv[2];
  const saved = path.join('data', 'saved-decklist.txt');
  const file = arg ?? (existsSync(saved) ? saved : path.join('data', 'default-decklist.txt'));
  const parsed = parseDecklist(await fs.readFile(file, 'utf8'));
  console.log(`${file}: ${parsed.entries.length} entries, ${parsed.totalQuantity} cards`);
  parsed.warnings.forEach((w) => console.warn('  warn:', w));
  const client = new ScryfallClient();
  const results: Record<string, CardResult> = {};
  let i = 0;
  for (const e of parsed.entries) {
    i++;
    try {
      const r = await cachedFetch(`card:${e.key}`, () => fetchCardPrintings(client, e.name), { refresh: process.env.REFRESH === '1' });
      results[e.key] = { ...r.value, key: e.key };
      process.stdout.write(`\r[${i}/${parsed.entries.length}] ${e.name.padEnd(40)} ${r.value.status} (${r.value.printings.length})${r.fromCache ? ' cached' : ''}   `);
    } catch (err) {
      results[e.key] = { key: e.key, queryName: e.name, status: 'error', printings: [], message: (err as Error).message };
      console.error(`\n  ERROR ${e.name}: ${(err as Error).message}`);
    }
  }
  const ctx = buildContext(parsed.entries, results);
  await fs.mkdir('reports', { recursive: true });
  const out: [string, string][] = [
    ['report.html', htmlReport(ctx)], ['report.txt', textReport(ctx)], ['printings.csv', fullPrintingsCsv(ctx)],
    ['grouped-by-set.csv', groupedBySetCsv(ctx)], ['grouped-by-card.csv', groupedByCardCsv(ctx)],
  ];
  for (const [n, c] of out) await fs.writeFile(path.join('reports', n), c);
  console.log(`\n\nSets: ${ctx.groups.length} · printings: ${ctx.summary.printingRecords} · complete: ${ctx.summary.complete}`);
  console.log('Top 10:', ctx.groups.slice(0, 10).map((g) => `${g.setName} (${g.setCode.toUpperCase()}) ${g.uniqueCount}`).join('\n        '));
  if (ctx.summary.unresolved.length) console.log('Unresolved:', ctx.summary.unresolved.map((u) => u.queryName).join(', '));
  if (ctx.summary.errored.length) console.log('Errors:', ctx.summary.errored.map((u) => `${u.queryName}: ${u.message}`).join('; '));
  console.log('Reports written to ./reports');
}
main();
