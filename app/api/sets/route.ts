import { NextRequest, NextResponse } from 'next/server';
import { cachedFetch } from '@/lib/cache';
import { fetchSets } from '@/lib/scryfall';
import { scryfall } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const r = await cachedFetch('sets:all', () => fetchSets(scryfall()), {
      refresh: req.nextUrl.searchParams.get('refresh') === '1',
      shouldCache: (v) => v.length > 0,
    });
    return NextResponse.json({ sets: r.value, stale: r.stale });
  } catch (err) {
    return NextResponse.json({ sets: [], error: (err as Error).message }, { status: 502 });
  }
}
