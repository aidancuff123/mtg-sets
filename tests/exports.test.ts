import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseDecklist } from '@/lib/decklist';
import { buildContext, csvCell, fullPrintingsCsv, groupedByCardCsv, groupedBySetCsv, htmlReport, textReport } from '@/lib/exports';
import { cachedFetch, writeCache, readCache } from '@/lib/cache';
import { printing, result } from './helpers';

function ctx() {
  const { entries } = parseDecklist('1 Kiku’s Shadow (sok)\n33 Swamp\n1 Vampiric Link (plst)\n1 <script>alert(1)</script>');
  const rs = [
    result("Kiku's Shadow", [printing({ name: "Kiku's Shadow", set: 'sok', set_name: 'Saviors of Kamigawa', rarity: 'common', prices: { usd: '0.15', usd_foil: null } })]),
    result('Swamp', [
      printing({ name: 'Swamp', set: 'sok', set_name: 'Saviors of Kamigawa', collector_number: '300', prices: { usd: '0.05' } }),
      printing({ name: 'Swamp', set: 'sok', set_name: 'Saviors of Kamigawa', collector_number: '301', prices: { usd: '0.06' } }),
      printing({ name: 'Swamp', set: 'pmei', set_name: 'Media, "Inserts", etc', set_type: 'promo' }),
    ]),
    result('Vampiric Link', [printing({ name: 'Vampiric Link', set: 'plst', set_name: 'The List' }), printing({ name: 'Vampiric Link', set: 'nem', set_name: 'Nemesis', rarity: 'common' })]),
    { key: '<script>alert(1)</script>', queryName: '<script>alert(1)</script>', status: 'unresolved' as const, printings: [], message: 'No card named <script>' },
  ];
  return buildContext(entries, Object.fromEntries(rs.map((r) => [r.key, r])));
}

function parseCsv(s: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  s = s.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\r' && s[i + 1] === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; }
    else cur += ch;
  }
  return rows;
}

describe('CSV exports', () => {
  it('escapes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('x\ny')).toBe('"x\ny"');
    expect(csvCell(null)).toBe('');
  });

  it('full printings CSV has one row per printing, N/A for null prices, no PLST', () => {
    const rows = parseCsv(fullPrintingsCsv(ctx()));
    const h = rows[0];
    expect(h).toContain('Scryfall ID');
    expect(h).toContain('USD Etched');
    const body = rows.slice(1);
    expect(body).toHaveLength(5); // kiku 1 + swamp 3 + vampiric link (nem) 1
    expect(body.every((r) => r.length === h.length)).toBe(true);
    expect(body.some((r) => r[h.indexOf('Set Code')] === 'PLST')).toBe(false);
    expect(body.find((r) => r[0] === 'Kiku’s Shadow')![h.indexOf('USD Foil')]).toBe('N/A');
    expect(body.find((r) => r[h.indexOf('Set Name')] === 'Media, "Inserts", etc')).toBeTruthy();
  });

  it('grouped-by-set CSV ranks by overlap with one row per card/set and lists variants', () => {
    const rows = parseCsv(groupedBySetCsv(ctx()));
    const h = rows[0];
    const first = rows[1];
    expect(first[h.indexOf('Set Code')]).toBe('SOK');
    expect(first[h.indexOf('Unique Cards In Set')]).toBe('2');
    const swampRow = rows.find((r) => r[h.indexOf('Card Name')] === 'Swamp' && r[h.indexOf('Set Code')] === 'SOK')!;
    expect(swampRow[h.indexOf('Printings In Set')]).toBe('2');
    expect(swampRow[h.indexOf('Collector Numbers')]).toBe('300|301');
    expect(swampRow[h.indexOf('Quantity')]).toBe('33');
  });

  it('grouped-by-card CSV includes unresolved cards', () => {
    const csv = groupedByCardCsv(ctx());
    expect(csv).toContain('unresolved');
    expect(csv).not.toMatch(/,PLST,/);
  });
});

describe('offline HTML report', () => {
  const html = htmlReport(ctx());

  it('is fully static: no scripts, no external CSS/JS, no fetch', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/fetch\(|XMLHttpRequest/);
    expect(html).toMatch(/<style>/);
    expect(html).toMatch(/^<!DOCTYPE html>/);
  });

  it('escapes card text, shows timestamp, rarity, prices and excludes PLST', () => {
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('2026-11-08T00:00:00.000Z');
    expect(html).toContain('Common');
    expect(html).toContain('$0.15');
    expect(html).toContain('N/A');
    expect(html).not.toContain('The List (PLST)</');
    expect(html).not.toMatch(/\(PLST\)<\/span>/);
    expect(html).toContain('Unresolved cards');
  });

  it('lists set groups in descending overlap order', () => {
    const sok = html.indexOf('Saviors of Kamigawa (SOK)');
    const nem = html.indexOf('Nemesis (NEM)');
    expect(sok).toBeGreaterThan(-1);
    expect(sok).toBeLessThan(nem);
  });

  it('plain text report groups by set', () => {
    const t = textReport(ctx());
    expect(t).toMatch(/#1 Saviors of Kamigawa \(SOK\) — 2 cards/);
    expect(t).toContain('33x Swamp');
    expect(t).not.toMatch(/\(PLST\) —/);
    expect(t).not.toContain('The List (PLST) —');
  });
});

describe('server cache', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mtgcache-'));
  it('serves fresh cache without refetching, and stale cache when the network fails', async () => {
    let calls = 0;
    const a = await cachedFetch('k', async () => ++calls, { dir });
    const b = await cachedFetch('k', async () => ++calls, { dir });
    expect([a.value, b.value, b.fromCache, calls]).toEqual([1, 1, true, 1]);
    const c = await cachedFetch('k', async () => { throw new Error('offline'); }, { dir, refresh: true });
    expect(c).toMatchObject({ value: 1, stale: true, error: 'offline' });
  });
  it('expires after 24h', async () => {
    await writeCache('old', 5, dir);
    const e = (await readCache<number>('old', dir))!;
    const { isFresh } = await import('@/lib/cache');
    expect(isFresh(e)).toBe(true);
    expect(isFresh(e, e.storedAt + 25 * 3600 * 1000)).toBe(false);
  });
});
