import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';
const DEFAULT = path.join(process.cwd(), 'data', 'default-decklist.txt');
const SAVED = process.env.DECKLIST_FILE || path.join(process.cwd(), 'data', 'saved-decklist.txt');

export async function GET(req: NextRequest) {
  const wantDefault = req.nextUrl.searchParams.get('default') === '1';
  let text: string;
  let source = 'saved';
  try {
    if (wantDefault) throw new Error('default');
    text = await fs.readFile(SAVED, 'utf8');
  } catch {
    text = await fs.readFile(DEFAULT, 'utf8');
    source = 'default';
  }
  return NextResponse.json({ text, source });
}

export async function PUT(req: NextRequest) {
  const { text } = (await req.json()) as { text?: string };
  if (typeof text !== 'string' || text.length > 200_000) return NextResponse.json({ error: 'invalid decklist' }, { status: 400 });
  await fs.mkdir(path.dirname(SAVED), { recursive: true });
  await fs.writeFile(SAVED, text);
  return NextResponse.json({ ok: true });
}
