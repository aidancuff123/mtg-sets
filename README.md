# MTG Printing & Set Overlap Analyzer

Next.js 15 + React 19 + TypeScript. The server fetches from Scryfall and keeps a JSON cache, and the phone talks only to your server.

## Run it

```bash
npm install
npm run dev            # dev server on 0.0.0.0:3000 (reachable from your LAN)
# or, faster for daily use:
npm run build && npm start
```

Open `http://localhost:3000` on the computer. The first run fetches all 68 cards (~150 Scryfall requests at ≤8 req/s, about 30–60 s, shown in a progress bar). After that, reloads come from the 24-hour cache until you tap ↻.

### From your iPhone (same Wi-Fi)

1. Find your computer's LAN IP:
   - macOS: `ipconfig getifaddr en0`
   - Linux: `hostname -I`
   - Windows: `ipconfig` (IPv4 Address)
2. In Safari on the iPhone, open `http://<that-IP>:3000`, e.g. `http://192.168.1.23:3000`.
3. Optional: Share → **Add to Home Screen** to get a full-screen app.

If it won't load, allow Node through the firewall on port 3000 (macOS: System Settings → Network → Firewall). Phones on a "guest" Wi-Fi network usually can't reach other devices.

### Free hosting on GitHub Pages (browser-only build)

`npm run build:static` writes a static site to `./out`, served under `/mtg-sets/` by default (set `BASE_PATH` to change it). In this build the browser calls Scryfall directly; Scryfall allows cross-site requests. It uses the same rate limiter, and results are cached on the device in IndexedDB for 24 hours. Push the contents of `out/` to the repo's `gh-pages` branch. The live site is https://aidancuff123.github.io/mtg-sets/, and the one-page version is at `/mtg-sets/simple/`.

### Remote access / deployment (server build)

The app has **no login**, and the decklist save endpoint is writable. Don't port-forward it to the public internet as-is. Safer options:

- **Tailscale** (recommended): install on the computer and the phone, then open `http://<computer-tailscale-name>:3000` from anywhere. It stays private to your devices.
- **Cloudflare Tunnel + Cloudflare Access**, or a reverse proxy (Caddy/nginx) with basic auth, on a VPS such as your GCP/EC2 box: `npm ci && npm run build && npm start` behind the proxy.
- Vercel works for the UI, but its filesystem is ephemeral, so the JSON cache and saved decklist won't persist there. A VM is the better fit.

Environment variables: `CACHE_DIR` (default `.cache/scryfall`), `DECKLIST_FILE` (default `data/saved-decklist.txt`), `SCRYFALL_MIN_INTERVAL_MS` (default 120).

## Tests

```bash
npm test               # 41 unit tests: parsing, PLST, overlap, pagination, 429, CSV, offline HTML, cache
npm run test:live      # real Scryfall: the full 68-card deck, structural assertions (needs internet)
npm run test:e2e       # production server + headless Chrome at iPhone 14 size (needs Chrome; CHROME_PATH=...)
npm run analyze:live   # CLI: fetch through the cache and write every report to ./reports
```

## How it works

- **Lookup:** `!"Exact Name" lang:en game:paper -set:plst` with `unique=prints&include_extras&include_variations`, following every `next_page`. If the exact search misses, it resolves the name with `/cards/named?exact=` and then searches by `oracleid:`. If that also fails, the card goes in the **Unresolved** section.
- **Filtering:** PLST is removed in the query, again on ingest, and again in the analysis and filter layer. Digital-only and non-English records are dropped, and records are deduplicated by Scryfall ID.
- **Overlap:** a card counts once in every set where it has any eligible printing. The set score is the number of distinct entries, and physical quantity is shown separately.
- **Prices:** `prices.usd`, `usd_foil` and `usd_etched` exactly as Scryfall returns them. A null price shows as N/A and is never treated as cheapest. Totals with gaps are marked with "+" and list the missing cards.
- **Offline:** the server serves a stale cache if Scryfall is down. The browser keeps the last dataset in IndexedDB. The HTML export is static with no scripts or external resources (it omits card images, which would need the network).
