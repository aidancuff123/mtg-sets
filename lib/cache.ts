import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const TTL_MS = 24 * 60 * 60 * 1000;

export function cacheDir(): string {
  return process.env.CACHE_DIR || path.join(process.cwd(), '.cache', 'scryfall');
}

function fileFor(key: string, dir: string) {
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
  const slug = key.replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
  return path.join(dir, `${slug}-${hash}.json`);
}

export interface CacheEntry<T> {
  storedAt: number;
  value: T;
}

export async function readCache<T>(key: string, dir = cacheDir()): Promise<CacheEntry<T> | null> {
  try {
    return JSON.parse(await fs.readFile(fileFor(key, dir), 'utf8')) as CacheEntry<T>;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, value: T, dir = cacheDir()): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const file = fileFor(key, dir);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ storedAt: Date.now(), value }));
  await fs.rename(tmp, file);
}

export function isFresh(entry: CacheEntry<unknown> | null, now = Date.now(), ttl = TTL_MS): boolean {
  return !!entry && now - entry.storedAt < ttl;
}

/**
 * Cache-first loader: fresh cache → return; otherwise fetch; if fetching fails and any cached copy
 * exists, return the stale copy instead of throwing (keeps the app usable during outages).
 */
export async function cachedFetch<T>(
  key: string,
  loader: () => Promise<T>,
  opts: { refresh?: boolean; dir?: string; shouldCache?: (v: T) => boolean } = {},
): Promise<{ value: T; fromCache: boolean; stale: boolean; storedAt: number; error?: string }> {
  const dir = opts.dir ?? cacheDir();
  const existing = await readCache<T>(key, dir);
  if (!opts.refresh && existing && isFresh(existing)) {
    return { value: existing.value, fromCache: true, stale: false, storedAt: existing.storedAt };
  }
  try {
    const value = await loader();
    if (!opts.shouldCache || opts.shouldCache(value)) await writeCache(key, value, dir);
    return { value, fromCache: false, stale: false, storedAt: Date.now() };
  } catch (err) {
    if (existing) {
      return { value: existing.value, fromCache: true, stale: true, storedAt: existing.storedAt, error: (err as Error).message };
    }
    throw err;
  }
}
