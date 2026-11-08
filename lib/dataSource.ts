'use client';
/**
 * Where the client gets data from.
 *  - Server mode (npm run dev / start): the Next.js API routes fetch from Scryfall and cache on disk.
 *  - Static mode (GitHub Pages build, NEXT_PUBLIC_STATIC=1): the browser talks to Scryfall directly
 *    (Scryfall sends CORS headers), with the same rate limiter, and caches results in IndexedDB for 24h.
 */
import type { CardResult, SetInfo } from './types';
import { ScryfallClient, fetchCardPrintings, fetchSets } from './scryfall';
import { nameKey } from './decklist';
import { idbGet, idbSet } from './idb';

export const STATIC = process.env.NEXT_PUBLIC_STATIC === '1';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';
const TTL = 24 * 60 * 60 * 1000;

let client: ScryfallClient | null = null;
function sf() {
  // No custom headers in the browser: they would force a CORS preflight.
  return (client ??= new ScryfallClient({ minIntervalMs: 120, headers: {} }));
}

async function browserCached<T>(key: string, loader: () => Promise<T>, refresh: boolean, ok: (v: T) => boolean = () => true) {
  const hit = await idbGet<{ storedAt: number; value: T }>(`c:${key}`);
  if (!refresh && hit && Date.now() - hit.storedAt < TTL) return { value: hit.value, fromCache: true, stale: false, storedAt: hit.storedAt };
  try {
    const value = await loader();
    if (ok(value)) await idbSet(`c:${key}`, { storedAt: Date.now(), value });
    return { value, fromCache: false, stale: false, storedAt: Date.now() };
  } catch (err) {
    if (hit) return { value: hit.value, fromCache: true, stale: true, storedAt: hit.storedAt, error: (err as Error).message };
    throw err;
  }
}

export async function loadCard(name: string, refresh: boolean): Promise<CardResult> {
  const key = nameKey(name);
  if (!STATIC) {
    const res = await fetch(`${BASE}/api/card?name=${encodeURIComponent(name)}${refresh ? '&refresh=1' : ''}`);
    return (await res.json()) as CardResult;
  }
  try {
    const r = await browserCached(`card:${key}`, () => fetchCardPrintings(sf(), name), refresh, (v) => v.status !== 'error');
    return {
      ...r.value,
      fromCache: r.fromCache,
      stale: r.stale,
      message: r.stale ? `Showing saved data from ${new Date(r.storedAt).toLocaleString()} — refresh failed: ${r.error}` : r.value.message,
    };
  } catch (err) {
    return { key, queryName: name, status: 'error', printings: [], message: `Could not reach Scryfall: ${(err as Error).message}` };
  }
}

export async function loadSets(refresh: boolean): Promise<SetInfo[]> {
  if (!STATIC) {
    const r = await fetch(`${BASE}/api/sets${refresh ? '?refresh=1' : ''}`);
    return ((await r.json()) as { sets: SetInfo[] }).sets ?? [];
  }
  try {
    return (await browserCached('sets:all', () => fetchSets(sf()), refresh, (v) => v.length > 0)).value;
  } catch {
    return [];
  }
}

export async function loadDefaultDeck(): Promise<string> {
  const r = await fetch(STATIC ? `${BASE}/default-decklist.txt` : '/api/decklist?default=1');
  return STATIC ? r.text() : ((await r.json()) as { text: string }).text;
}

export async function loadSavedDeck(): Promise<string> {
  if (STATIC) return loadDefaultDeck(); // device copy (localStorage) is checked first by the caller
  const r = await fetch('/api/decklist');
  return ((await r.json()) as { text: string }).text;
}

/** Returns a human-readable status line. */
export async function saveDeck(text: string): Promise<string> {
  if (STATIC) return `Saved on this device at ${new Date().toLocaleTimeString()}`;
  try {
    const r = await fetch('/api/decklist', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    return r.ok ? `Saved on this device and on the server at ${new Date().toLocaleTimeString()}` : 'Saved on this device; server save failed';
  } catch {
    return 'Saved on this device (server unreachable)';
  }
}
