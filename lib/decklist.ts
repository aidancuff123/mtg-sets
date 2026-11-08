import type { DeckEntry, ParseResult } from './types';

/** Normalize typographic punctuation so names match Scryfall's canonical spelling. */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameKey(raw: string): string {
  return normalizeName(raw).toLowerCase();
}

const QTY_RE = /^(\d+)\s*x?\s+(.+)$/i;
// "Name (set) 123 *F*" — set code, optional collector number, optional foil marker
const SET_RE = /^(.*?)\s+\(([A-Za-z0-9]{2,8})\)(?:\s+([A-Za-z0-9★†\-]+))?\s*(?:\*[A-Z]+\*)?\s*$/;
const SECTION_RE = /^(deck|commander|companion|sideboard|maybeboard|main(board)?|lands?|creatures?)\s*:?\s*$/i;

export function parseDecklist(text: string): ParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const byKey = new Map<string, DeckEntry>();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    const lineNo = idx + 1;
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    if (SECTION_RE.test(line)) return;
    const m = QTY_RE.exec(line);
    if (!m) {
      warnings.push(`Line ${lineNo} ignored (no leading quantity): "${line}"`);
      return;
    }
    const quantity = parseInt(m[1], 10);
    let rest = m[2].trim().replace(/\s*\*[A-Z]+\*\s*$/, '');
    let setCode: string | undefined;
    let collectorNumber: string | undefined;
    const s = SET_RE.exec(rest);
    if (s) {
      rest = s[1].trim();
      setCode = s[2].toLowerCase();
      collectorNumber = s[3];
    }
    if (!rest) {
      errors.push(`Line ${lineNo}: missing card name`);
      return;
    }
    if (quantity <= 0) {
      warnings.push(`Line ${lineNo} ignored (quantity 0): "${line}"`);
      return;
    }
    const name = normalizeName(rest);
    const key = name.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity += quantity;
      warnings.push(`Line ${lineNo}: "${name}" listed more than once — quantities merged`);
      return;
    }
    byKey.set(key, { inputName: rest, name, key, quantity, setCode, collectorNumber, line: lineNo });
  });

  const entries = [...byKey.values()];
  const totalQuantity = entries.reduce((s, e) => s + e.quantity, 0);
  return { entries, totalQuantity, warnings, errors };
}

export function serializeDecklist(entries: DeckEntry[]): string {
  return entries
    .map((e) => `${e.quantity} ${e.inputName}${e.setCode ? ` (${e.setCode})` : ''}${e.collectorNumber ? ` ${e.collectorNumber}` : ''}`)
    .join('\n');
}
