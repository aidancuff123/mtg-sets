import type { CardResult, Printing } from '@/lib/types';
import { toPrinting } from '@/lib/scryfall';

let seq = 0;
/** Build a Scryfall-shaped card object (fields as documented at scryfall.com/docs/api/cards). */
export function sfCard(o: Partial<Record<string, any>> & { name: string; set: string }): any {
  seq++;
  return {
    object: 'card',
    id: o.id ?? `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    oracle_id: o.oracle_id ?? `oracle-${o.name}`,
    name: o.name,
    lang: o.lang ?? 'en',
    set: o.set,
    set_name: o.set_name ?? `Set ${o.set.toUpperCase()}`,
    set_type: o.set_type ?? 'expansion',
    collector_number: o.collector_number ?? String(seq),
    rarity: o.rarity ?? 'common',
    prices: { usd: '0.25', usd_foil: '1.00', usd_etched: null, ...(o.prices ?? {}) },
    finishes: o.finishes ?? ['nonfoil', 'foil'],
    promo: o.promo ?? false,
    promo_types: o.promo_types,
    digital: o.digital ?? false,
    games: o.games ?? ['paper'],
    released_at: o.released_at ?? '2020-01-01',
    image_uris: { small: `https://img.example/${seq}-s.jpg`, normal: `https://img.example/${seq}-n.jpg` },
    scryfall_uri: `https://scryfall.com/card/${o.set}/${o.collector_number ?? seq}`,
    border_color: o.border_color ?? 'black',
    full_art: o.full_art ?? false,
    frame_effects: o.frame_effects,
  };
}

export function printing(o: Partial<Record<string, any>> & { name: string; set: string }): Printing {
  return toPrinting(sfCard(o), '2026-11-08T00:00:00.000Z');
}

export function result(name: string, printings: Printing[], status: CardResult['status'] = 'ok'): CardResult {
  return { key: name.toLowerCase(), queryName: name, status, printings, fetchedAt: '2026-11-08T00:00:00.000Z' };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
