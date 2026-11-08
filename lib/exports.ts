import type { CardResult, DeckEntry, Filters, Printing } from './types';
import { DEFAULT_FILTERS, EXCLUDED_SET_CODES } from './types';
import {
  buildCardViews, buildSetGroups, cap, cheapest, deckCost, fmtUsd, summarize, workingSet,
  type CardView, type SetGroup, type Summary, type WorkingCard,
} from './analyze';

export interface ReportContext {
  entries: DeckEntry[];
  results: Record<string, CardResult>;
  filters: Filters;
  cards: WorkingCard[];
  groups: SetGroup[];
  views: CardView[];
  summary: Summary;
  generatedAt: string;
  dataFrom: string | null;
  dataTo: string | null;
}

export function buildContext(entries: DeckEntry[], results: Record<string, CardResult>, filters: Filters = DEFAULT_FILTERS, sets = {}): ReportContext {
  const cards = workingSet(entries, results, filters);
  const groups = buildSetGroups(cards, entries.length, sets);
  const views = buildCardViews(cards);
  const summary = summarize(entries, results, cards, groups);
  const times = Object.values(results).map((r) => r.fetchedAt).filter(Boolean).sort() as string[];
  return {
    entries, results, filters, cards, groups, views, summary,
    generatedAt: new Date().toISOString(),
    dataFrom: times[0] ?? null,
    dataTo: times[times.length - 1] ?? null,
  };
}

export function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.join('|') : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // BOM so Excel/Numbers open UTF-8 (apostrophes, ★) correctly
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const na = (v: string | null) => (v == null ? 'N/A' : v);

const PRINTING_HEADER = [
  'Input Name', 'Quantity', 'Deck Set Code', 'Scryfall Name', 'Scryfall ID', 'Oracle ID', 'Set Name', 'Set Code', 'Set Type',
  'Collector Number', 'Rarity', 'USD Nonfoil', 'USD Foil', 'USD Etched', 'Finishes', 'Promo', 'Promo Types', 'Release Date',
  'Image URL', 'Scryfall URL', 'Price Retrieved At',
];

function printingRow(e: DeckEntry, p: Printing): unknown[] {
  return [
    e.inputName, e.quantity, e.setCode ?? '', p.name, p.id, p.oracleId ?? '', p.setName, p.setCode.toUpperCase(), p.setType,
    p.collectorNumber, cap(p.rarity), na(p.usd), na(p.usdFoil), na(p.usdEtched), p.finishes, p.promo ? 'Yes' : 'No', p.promoTypes,
    p.releasedAt, p.imageNormal ?? '', p.scryfallUri, p.pricesFetchedAt,
  ];
}

export function fullPrintingsCsv(ctx: ReportContext): string {
  const rows: unknown[][] = [];
  for (const c of [...ctx.cards].sort((a, b) => a.entry.name.localeCompare(b.entry.name))) {
    for (const p of c.printings) if (!EXCLUDED_SET_CODES.has(p.setCode)) rows.push(printingRow(c.entry, p));
  }
  return toCsv(PRINTING_HEADER, rows);
}

export function groupedBySetCsv(ctx: ReportContext): string {
  const header = [
    'Set Rank', 'Set Name', 'Set Code', 'Set Type', 'Unique Cards In Set', 'Percent Of Deck Entries', 'Matching Physical Quantity',
    'Card Name', 'Quantity', 'Printings In Set', 'Collector Numbers', 'Rarities', 'Lowest USD Nonfoil', 'Lowest USD Foil/Etched',
    'Scryfall IDs', 'Scryfall URLs',
  ];
  const rows: unknown[][] = [];
  ctx.groups.forEach((g, i) => {
    for (const c of g.cards) {
      const nf = cheapest(c.printings, 'nonfoil');
      const fo = cheapest(c.printings, 'foil');
      rows.push([
        i + 1, g.setName, g.setCode.toUpperCase(), g.setType, g.uniqueCount, g.percentOfDeck.toFixed(1), g.physicalQuantity,
        c.entry.name, c.entry.quantity, c.printings.length, c.printings.map((p) => p.collectorNumber),
        [...new Set(c.printings.map((p) => cap(p.rarity)))], nf ? nf.value.toFixed(2) : 'N/A', fo ? fo.value.toFixed(2) : 'N/A',
        c.printings.map((p) => p.id), c.printings.map((p) => p.scryfallUri),
      ]);
    }
  });
  return toCsv(header, rows);
}

export function groupedByCardCsv(ctx: ReportContext): string {
  const header = [
    'Card Name', 'Quantity', 'Deck Set Code', 'Status', 'Eligible Set Count', 'Printing Count', 'Lowest USD Nonfoil', 'Lowest USD Foil/Etched',
    'Set Code', 'Set Name', 'Collector Numbers', 'Rarities', 'USD Nonfoil Prices', 'USD Foil Prices', 'USD Etched Prices', 'Scryfall URLs',
  ];
  const rows: unknown[][] = [];
  for (const v of [...ctx.views].sort((a, b) => a.entry.name.localeCompare(b.entry.name))) {
    const base = [v.entry.name, v.entry.quantity, v.entry.setCode ?? '', v.status, v.sets.length, v.printingCount, fmtUsd(v.minNonfoil), fmtUsd(v.minFoil)];
    if (!v.sets.length) {
      rows.push([...base, '', '', '', '', '', '', '', v.message ?? '']);
      continue;
    }
    for (const s of v.sets) {
      rows.push([
        ...base, s.setCode.toUpperCase(), s.setName, s.printings.map((p) => p.collectorNumber), s.printings.map((p) => cap(p.rarity)),
        s.printings.map((p) => na(p.usd)), s.printings.map((p) => na(p.usdFoil)), s.printings.map((p) => na(p.usdEtched)),
        s.printings.map((p) => p.scryfallUri),
      ]);
    }
  }
  return toCsv(header, rows);
}

function filterNote(f: Filters): string[] {
  const n: string[] = [];
  if (f.cardQuery) n.push(`card name contains "${f.cardQuery}"`);
  if (f.setQuery) n.push(`set contains "${f.setQuery}"`);
  if (f.rarities.length) n.push(`rarity: ${f.rarities.join(', ')}`);
  if (f.setTypes.length) n.push(`set type: ${f.setTypes.join(', ')}`);
  if (!f.includePromos) n.push('promos excluded');
  if (!f.includeSpecial) n.push('special printings excluded');
  if (f.minPrice != null || f.maxPrice != null) n.push(`${f.priceMode} price ${f.minPrice ?? 0}–${f.maxPrice ?? '∞'}`);
  return n;
}

export function textReport(ctx: ReportContext): string {
  const s = ctx.summary;
  const out: string[] = [];
  out.push('MTG PRINTING & SET OVERLAP REPORT');
  out.push(`Generated: ${ctx.generatedAt}`);
  out.push(`Scryfall data retrieved: ${ctx.dataFrom ?? 'n/a'} to ${ctx.dataTo ?? 'n/a'}`);
  out.push(`Entries: ${s.entries} | Physical cards: ${s.totalQuantity} | Sets: ${s.setsFound} | Printings: ${s.printingRecords}`);
  out.push('The List (PLST) excluded. Prices are indicative Scryfall market data (USD).');
  const fn = filterNote(ctx.filters);
  if (fn.length) out.push(`Filters: ${fn.join('; ')}`);
  if (!s.complete) out.push(`WARNING: dataset incomplete (${s.pending} pending, ${s.errored.length} errors)`);
  if (s.unresolved.length) {
    out.push('', 'UNRESOLVED CARDS');
    for (const u of s.unresolved) out.push(`  - ${u.queryName}: ${u.message ?? u.status}`);
  }
  if (s.errored.length) {
    out.push('', 'FETCH ERRORS');
    for (const u of s.errored) out.push(`  - ${u.queryName}: ${u.message ?? 'error'}`);
  }
  out.push('', 'SETS RANKED BY DISTINCT CARD OVERLAP', '');
  ctx.groups.forEach((g, i) => {
    out.push(`#${i + 1} ${g.setName} (${g.setCode.toUpperCase()}) — ${g.uniqueCount} cards, ${g.percentOfDeck.toFixed(1)}% of entries, ${g.physicalQuantity} physical`);
    for (const c of g.cards) {
      const variants = c.printings
        .map((p) => `#${p.collectorNumber} ${cap(p.rarity)} NF ${fmtUsd(p.usd)} / F ${fmtUsd(p.usdFoil)}${p.usdEtched ? ` / E ${fmtUsd(p.usdEtched)}` : ''}`)
        .join('; ');
      out.push(`    ${c.entry.quantity}x ${c.entry.name} — ${variants}`);
    }
    out.push('');
  });
  return out.join('\n');
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** Fully static, self-contained HTML. No scripts, no external CSS, no data fetching. */
export function htmlReport(ctx: ReportContext): string {
  const s = ctx.summary;
  const nf = deckCost(ctx.cards, 'nonfoil');
  const fo = deckCost(ctx.cards, 'foil');
  const fn = filterNote(ctx.filters);
  const css = `
  :root{color-scheme:light dark;--bg:#0f1115;--fg:#e8e6e3;--mut:#9aa0a6;--card:#181b22;--line:#2a2f3a;--acc:#c9a227}
  @media (prefers-color-scheme:light){:root{--bg:#f6f5f2;--fg:#1c1c1e;--mut:#6b6b70;--card:#fff;--line:#e2e0da;--acc:#8a6d00}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
  main{max-width:860px;margin:0 auto;padding:16px 14px 48px}h1{font-size:22px;margin:4px 0 6px}h2{font-size:17px;margin:28px 0 10px}
  .meta{color:var(--mut);font-size:13px}.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:14px 0}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px}.stat b{display:block;font-size:20px}
  details{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:8px 0;overflow:hidden}
  summary{padding:12px 14px;cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}
  summary .t{font-weight:600}summary .s{display:block;color:var(--mut);font-size:13px;margin-top:2px}
  .rank{display:inline-block;min-width:30px;color:var(--acc);font-weight:700}
  ul{list-style:none;margin:0;padding:0 14px 10px}li{border-top:1px solid var(--line);padding:9px 0}
  .cn{font-weight:600}.q{color:var(--acc);font-weight:700;margin-right:4px}.v{font-size:13px;color:var(--mut);margin-top:3px}
  .v span{display:inline-block;margin-right:10px}a{color:var(--acc)}.warn{background:#5a1d1d;color:#fff;padding:10px 12px;border-radius:10px}
  .r-common{color:#9aa0a6}.r-uncommon{color:#8fb3c9}.r-rare{color:#d4b24c}.r-mythic{color:#e0703a}
  table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:6px 4px;border-top:1px solid var(--line)}`;

  const variantLine = (p: Printing) =>
    `<div class="v"><span>#${esc(p.collectorNumber)}</span><span class="r-${esc(p.rarity)}">${esc(cap(p.rarity))}</span>` +
    `<span>NF ${esc(fmtUsd(p.usd))}</span><span>Foil ${esc(fmtUsd(p.usdFoil))}</span>${p.usdEtched ? `<span>Etched ${esc(fmtUsd(p.usdEtched))}</span>` : ''}` +
    `${p.promo ? '<span>Promo</span>' : ''}<span><a href="${esc(p.scryfallUri)}">Scryfall</a></span></div>`;

  const groupsHtml = ctx.groups
    .map(
      (g, i) => `<details${i < 3 ? ' open' : ''}><summary><span class="rank">#${i + 1}</span><span class="t">${esc(g.setName)} (${esc(g.setCode.toUpperCase())})</span>` +
        `<span class="s">${g.uniqueCount} distinct cards · ${g.percentOfDeck.toFixed(1)}% of entries · ${g.physicalQuantity} physical · ${esc(g.setType)}</span></summary><ul>` +
        g.cards.map((c) => `<li><span class="q">${c.entry.quantity}×</span><span class="cn">${esc(c.entry.name)}</span>${c.printings.map(variantLine).join('')}</li>`).join('') +
        `</ul></details>`,
    )
    .join('\n');

  const cardsHtml = [...ctx.views]
    .sort((a, b) => a.entry.name.localeCompare(b.entry.name))
    .map(
      (v) => `<details><summary><span class="t">${v.entry.quantity}× ${esc(v.entry.name)}</span><span class="s">${v.sets.length} sets · ${v.printingCount} printings · cheapest NF ${esc(fmtUsd(v.minNonfoil))} · foil ${esc(fmtUsd(v.minFoil))}${v.status !== 'ok' ? ` · ${esc(v.status)}` : ''}</span></summary><ul>` +
        v.sets.map((st) => `<li><span class="cn">${esc(st.setName)} (${esc(st.setCode.toUpperCase())})</span>${st.printings.map(variantLine).join('')}</li>`).join('') +
        `</ul></details>`,
    )
    .join('\n');

  const costRows = nf.lines
    .map((l, i) => {
      const f = fo.lines[i];
      return `<tr><td>${l.entry.quantity}× ${esc(l.entry.name)}</td><td>${l.cheapest ? `${esc(fmtUsd(l.cheapest.value))} <span class="meta">${esc(l.cheapest.printing.setCode.toUpperCase())}</span>` : '<b>N/A</b>'}</td><td>${f.cheapest ? `${esc(fmtUsd(f.cheapest.value))} <span class="meta">${esc(f.cheapest.printing.setCode.toUpperCase())}</span>` : '<b>N/A</b>'}</td></tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>MTG Set Overlap Report</title><style>${css}</style></head><body><main>
<h1>MTG Printing &amp; Set Overlap Report</h1>
<p class="meta">Scryfall data retrieved: <b>${esc(ctx.dataFrom ?? 'n/a')}</b>${ctx.dataTo && ctx.dataTo !== ctx.dataFrom ? ` → <b>${esc(ctx.dataTo)}</b>` : ''} (UTC)<br>Report generated: ${esc(ctx.generatedAt)}<br>
The List (PLST) is excluded entirely. Prices are indicative Scryfall USD market data, not guaranteed purchase prices. N/A = no price on Scryfall.${fn.length ? `<br>Filters applied: ${esc(fn.join('; '))}` : ''}</p>
${!s.complete ? `<p class="warn">Dataset incomplete: ${s.pending} cards not yet fetched, ${s.errored.length} with errors.</p>` : ''}
<div class="stats">
<div class="stat"><b>${s.entries}</b>Card entries</div><div class="stat"><b>${s.totalQuantity}</b>Physical cards</div>
<div class="stat"><b>${s.setsFound}</b>Eligible sets</div><div class="stat"><b>${s.printingRecords}</b>Printing records</div>
<div class="stat"><b>${esc(fmtUsd(nf.total))}${nf.complete ? '' : '+'}</b>Cheapest nonfoil deck${nf.complete ? '' : ` (${nf.missing.length} unpriced)`}</div>
<div class="stat"><b>${esc(fmtUsd(fo.total))}${fo.complete ? '' : '+'}</b>Cheapest foil deck${fo.complete ? '' : ` (${fo.missing.length} unpriced)`}</div>
</div>
${s.unresolved.length ? `<h2>Unresolved cards</h2><ul>${s.unresolved.map((u) => `<li><span class="cn">${esc(u.queryName)}</span><div class="v">${esc(u.message ?? u.status)}</div></li>`).join('')}</ul>` : ''}
${s.errored.length ? `<h2>Fetch errors</h2><ul>${s.errored.map((u) => `<li><span class="cn">${esc(u.queryName)}</span><div class="v">${esc(u.message ?? '')}</div></li>`).join('')}</ul>` : ''}
<h2>Sets ranked by distinct-card overlap</h2>
${groupsHtml}
<h2>All cards and their sets</h2>
${cardsHtml}
<h2>Cheapest printing per card</h2>
<table><thead><tr><th>Card</th><th>Nonfoil</th><th>Foil/Etched</th></tr></thead><tbody>${costRows}</tbody></table>
</main></body></html>`;
}
