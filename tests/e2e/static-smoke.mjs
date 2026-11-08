// Serves ./out under /mtg-sets/ (like GitHub Pages) and runs the browser-only app against mocked Scryfall.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve('out');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain', '.webmanifest': 'application/json' };
const srv = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith('/mtg-sets/')) { res.writeHead(404); return res.end(); }
  p = p.slice('/mtg-sets'.length);
  if (p.endsWith('/')) p += 'index.html';
  let body;
  try { body = await readFile(path.join(root, p)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  res.end(body);
}).listen(4100);

let fails = 0;
const check = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let calls = 0, preflights = 0;
await ctx.route('https://api.scryfall.com/**', (route) => {
  calls++;
  if (route.request().method() === 'OPTIONS') preflights++;
  const u = new URL(route.request().url());
  if (u.pathname === '/sets') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  const q = u.searchParams.get('q') || '';
  const name = (q.match(/!"(.+?)"/) || [])[1];
  if (!name) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  const mk = (set, n, extra = {}) => ({ object: 'card', id: `${set}-${n}-${name}`, name, lang: 'en', set, set_name: `Set ${set}`, set_type: 'expansion', collector_number: String(n), rarity: 'rare', prices: { usd: '1.00', usd_foil: null }, finishes: ['nonfoil'], games: ['paper'], released_at: '2020-01-01', scryfall_uri: 'https://scryfall.com/x', ...extra });
  route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ object: 'list', has_more: false, data: [mk('aaa', 1), mk('plst', 2), mk(name.length % 2 ? 'bbb' : 'ccc', 3)] }) });
});
await page.goto('http://localhost:4100/mtg-sets/');
await page.getByText('All 68 cards processed').waitFor({ timeout: 90000 });
check(true, 'static build loads the default deck and processes all 68 cards in-browser');
check(await page.getByText('68 entries · 100 cards').isVisible(), 'header shows 68 entries · 100 cards');
check(preflights === 0, 'no CORS preflight requests (plain GETs to Scryfall)');
const scores = await page.$$eval('.group .score b', (els) => els.map((e) => Number(e.textContent)));
check(scores[0] === 68, `top set contains all 68 cards (${scores.slice(0, 3)})`);
check(!(await page.content()).includes('Set plst'), 'PLST excluded');
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow at 390px');
const before = calls;
await page.reload();
await page.getByText('All 68 cards processed').waitFor({ timeout: 30000 });
check(calls - before <= 1, `reload served from the on-device 24h cache (${calls - before} new requests)`);
await page.locator('.ghead').first().click();
await page.locator('.gcard .check').first().click();
check((await page.locator('.crossbar').innerText()).startsWith('1/68'), 'tapping a card crosses it off (1/68)');
check(await page.locator('.ghead').first().getAttribute('aria-expanded') === 'true', 'set stays expanded after crossing off');
await page.getByRole('button', { name: 'Cards' }).click();
check(await page.locator('.card.group.crossed').count() === 1, 'crossed-off card shows struck through in Cards view');
await page.locator('.crossbar input').check();
check(await page.locator('.card.group').count() === 67, 'hide crossed off hides it');
await page.reload();
await page.getByText('All 68 cards processed').waitFor({ timeout: 30000 });
check((await page.locator('.crossbar').innerText()).startsWith('1/68'), 'cross-offs persist after reload');
await page.getByRole('button', { name: 'Export' }).click();
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Offline HTML report' }).click()]);
check(!!dl.suggestedFilename().endsWith('.html'), 'offline HTML export downloads');
check(errors.length === 0, `no page errors ${errors.join('; ')}`);
await b.close(); srv.close();
console.log(fails ? `${fails} failed` : 'All static checks passed');
process.exit(fails ? 1 : 0);
