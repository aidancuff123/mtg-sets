// Builds the browser-only version for GitHub Pages into ./out
//   BASE_PATH=/mtg-sets node scripts/build-static.mjs
import { execSync } from 'node:child_process';
import { cpSync, existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';

const basePath = process.env.BASE_PATH ?? '/mtg-sets';
const api = 'app/api', parked = '.api-parked', manifest = 'app/manifest.ts', parkedManifest = '.manifest-parked.ts';
rmSync('out', { recursive: true, force: true });
cpSync('data/default-decklist.txt', 'public/default-decklist.txt');
if (existsSync(api)) renameSync(api, parked); // API routes need a server; static mode talks to Scryfall directly
if (existsSync(manifest)) renameSync(manifest, parkedManifest);
try {
  execSync('npx next build', { stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_STATIC: '1', NEXT_PUBLIC_BASE_PATH: basePath } });
  writeFileSync('out/.nojekyll', ''); // let GitHub Pages serve the _next/ folder
  writeFileSync('out/manifest.webmanifest', JSON.stringify({ name: 'MTG Set Overlap', short_name: 'Set Overlap', start_url: `${basePath}/`, display: 'standalone', background_color: '#0f1115', theme_color: '#0f1115' }));
} finally {
  if (existsSync(parked)) renameSync(parked, api);
  if (existsSync(parkedManifest)) renameSync(parkedManifest, manifest);
}
console.log(`Static site written to ./out (base path ${basePath || '/'})`);
