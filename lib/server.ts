import 'server-only';
import { ScryfallClient } from './scryfall';

const g = globalThis as unknown as { __scryfall?: ScryfallClient };
/** One process-wide client so every route shares the same rate limiter. */
export function scryfall(): ScryfallClient {
  if (!g.__scryfall) {
    g.__scryfall = new ScryfallClient({ minIntervalMs: Number(process.env.SCRYFALL_MIN_INTERVAL_MS) || 120 });
  }
  return g.__scryfall;
}
