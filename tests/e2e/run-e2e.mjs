// End-to-end test: production server + headless Chrome at iPhone 14 size.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '../..');
const cache = mkdtempSync(path.join(tmpdir(), 'mtg-e2e-'));
const outDir = path.join(root, 'tests/e2e/out');
mkdirSync(outDir, { recursive: true });
execFileSync('npx', ['tsx', 'tests/e2e/seed.ts', cache], { cwd: root, stdio: 'inherit' });
const port = 3100;
const server = spawn('npx', ['next', 'start', '-p', String(port)], {
  cwd: root, env: { ...process.env, CACHE_DIR: cache, DECKLIST_FILE: path.join(cache, 'deck.txt') }, stdio: 'pipe',
});
const base = `http://localhost:${port}`;
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures++; };

async function waitUp() {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  throw new Error('server did not start');
}

try {
  await waitUp();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const iphone = {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, acceptDownloads: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  };
  const ctx = await browser.newContext(iphone);
  const page = await ctx.newPage();
  const noOverflow = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await page.goto(base);
  await page.getByText('All 68 cards processed').waitFor({ timeout: 30000 });
  check(true, 'decklist auto-loads and all 68 cards process');
  check(await page.getByText('68 entries · 100 cards').isVisible(), 'header shows 68 entries · 100 cards');
  check(await noOverflow(), 'Sets view: no horizontal overflow at 390px');
  const scores = await page.$$eval('.group .score b', (els) => els.map((e) => Number(e.textContent)));
  check(scores.length > 0 && scores.every((v, i) => i === 0 || scores[i - 1] >= v), `sets sorted by distinct overlap (${scores.slice(0, 5).join(',')}…)`);
  check(!(await page.content()).includes('The List'), 'PLST/The List never rendered');
  await page.locator('.ghead').first().click();
  check(await page.locator('.gcard').count() > 1, 'expanding top set lists its cards');
  const swampBtn = page.locator('.gcard', { hasText: 'Swamp' }).locator('.linkbtn');
  if (await swampBtn.count()) { await swampBtn.click(); check(await page.locator('.variant').count() >= 3, 'Swamp variants within one set expand'); }
  await page.screenshot({ path: path.join(outDir, '1-sets.png') });

  await page.getByRole('button', { name: 'Cards' }).click();
  check(await page.locator('.group').count() === 68, 'Cards view lists all 68 entries');
  await page.selectOption('select[aria-label="Sort cards"]', 'most-sets');
  check((await page.locator('.group .gtitle b').first().textContent()).includes('Swamp'), 'sort by most sets puts Swamp first');
  check(await noOverflow(), 'Cards view: no overflow');
  await page.screenshot({ path: path.join(outDir, '2-cards.png') });

  await page.locator('.ghead').first().click();
  await page.getByRole('button', { name: 'Compare all printings' }).click();
  check(await page.locator('.cmp').count() >= 30, 'Compare view shows every Swamp printing');
  check(await page.locator('.badge.nf').count() === 1, 'exactly one cheapest-nonfoil highlight');
  check(await noOverflow(), 'Compare view: no overflow');
  await page.screenshot({ path: path.join(outDir, '3-compare.png') });

  await page.getByRole('button', { name: 'Prices' }).click();
  check(await page.getByText('Printing records').isVisible(), 'Price analysis renders');
  check(await page.locator('.warnline').first().isVisible(), 'missing prices flagged as incomplete');
  await page.screenshot({ path: path.join(outDir, '4-prices.png') });

  // filters
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.locator('.chip', { hasText: 'Mythic' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Sets' }).click();
  const mythicOnly = await page.$$eval('.rarity', (els) => els.every((e) => e.textContent === 'Mythic'));
  check(mythicOnly, 'rarity filter applies');
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // exports
  const files = {};
  await page.getByRole('button', { name: 'Export' }).click();
  for (const label of ['Offline HTML report', 'Plain text (grouped by set)', 'Full printings CSV', 'Grouped-by-set CSV', 'Grouped-by-card CSV']) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).click()]);
    const p = path.join(outDir, dl.suggestedFilename());
    await dl.saveAs(p);
    files[label] = p;
  }
  check(Object.keys(files).length === 5, 'all five exports download');
  const csv = readFileSync(files['Full printings CSV'], 'utf8');
  check(csv.split('\r\n').length > 100 && !csv.includes(',PLST,'), 'printings CSV has rows and no PLST');

  // offline HTML: JS disabled + no network
  const off = await browser.newContext({ ...iphone, javaScriptEnabled: false, offline: true });
  const op = await off.newPage();
  await op.goto('file://' + files['Offline HTML report']);
  check(await op.getByText('Sets ranked by distinct-card overlap').isVisible(), 'offline HTML renders with JS off + offline');
  check(await op.evaluate(() => document.querySelectorAll('details').length) > 68, 'offline HTML contains set + card sections');
  check(await op.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'offline HTML fits iPhone width');
  await op.screenshot({ path: path.join(outDir, '6-offline-report.png') });

  // partial failure: add a card the server can't fetch here → error shown, other data kept
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Deck' }).click();
  await page.screenshot({ path: path.join(outDir, '5-deck.png') });
  await page.fill('input[placeholder="Card name"]', 'Uncached Test Card');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  check(await page.getByText('69 entries').isVisible(), 'deck editor adds a card');
  await page.getByRole('button', { name: 'Recalculate overlaps' }).click();
  await page.getByText(/1 fetch errors/).waitFor({ timeout: 60000 });
  check(true, 'uncached card failure is reported explicitly');
  check(await page.getByText(/Incomplete: 0 pending, 1 errors/).isVisible(), 'dataset not marked complete when a card fails');
  check(await page.locator('.group').count() > 10, 'successfully retrieved data is retained');
  await browser.close();
} catch (e) {
  console.error(e); failures++;
} finally {
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll e2e checks passed');
process.exit(failures ? 1 : 0);
