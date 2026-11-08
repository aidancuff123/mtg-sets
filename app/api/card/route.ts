import { NextRequest, NextResponse } from 'next/server';
import { cachedFetch } from '@/lib/cache';
import { nameKey } from '@/lib/decklist';
import { fetchCardPrintings } from '@/lib/scryfall';
import { scryfall } from '@/lib/server';
import type { CardResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')?.trim();
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const key = nameKey(name);
  try {
    const r = await cachedFetch<CardResult>(`card:${key}`, () => fetchCardPrintings(scryfall(), name), { refresh });
    const body: CardResult = {
      ...r.value,
      fromCache: r.fromCache,
      stale: r.stale,
      message: r.stale ? `Showing cached data from ${new Date(r.storedAt).toISOString()} — refresh failed: ${r.error}` : r.value.message,
    };
    return NextResponse.json(body);
  } catch (err) {
    const body: CardResult = { key, queryName: name, status: 'error', printings: [], message: (err as Error).message };
    return NextResponse.json(body, { status: 502 });
  }
}
