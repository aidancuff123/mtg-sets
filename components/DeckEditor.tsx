'use client';
import { useMemo, useRef, useState } from 'react';
import { parseDecklist, serializeDecklist, normalizeName } from '@/lib/decklist';

export function DeckEditor({ text, onApply, onSave, onReset, saveStatus }: {
  text: string;
  onApply: (t: string) => void;
  onSave: (t: string) => void;
  onReset: () => void;
  saveStatus: string;
}) {
  const [draft, setDraft] = useState(text);
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseDecklist(draft), [draft]);
  const dirty = draft !== text;

  const setEntries = (fn: (t: ReturnType<typeof parseDecklist>['entries']) => ReturnType<typeof parseDecklist>['entries']) =>
    setDraft(serializeDecklist(fn(parsed.entries.map((e) => ({ ...e })))));

  return (
    <div>
      <div className="card pad">
        <div className="row between">
          <div>
            <b>{parsed.entries.length}</b> entries · <b>{parsed.totalQuantity}</b> cards
          </div>
          {dirty && <span className="tag warn">Unapplied changes</span>}
        </div>
        {parsed.errors.map((e) => <p key={e} className="warnline">{e}</p>)}
        {parsed.warnings.slice(0, 6).map((w) => <p key={w} className="muted small">{w}</p>)}
        <div className="row gap wrap mt">
          <button className="btn primary" onClick={() => onApply(draft)}>Recalculate overlaps</button>
          <button className="btn" onClick={() => onSave(draft)}>Save</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Import file</button>
          <button className="btn" onClick={() => { if (confirm('Reset to the original default decklist?')) onReset(); }}>Reset</button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.dec,.csv,text/plain"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setDraft(await f.text());
              e.target.value = '';
            }}
          />
        </div>
        {saveStatus && <p className="muted small">{saveStatus}</p>}
      </div>

      <div className="card pad">
        <h3>Add a card</h3>
        <div className="row gap">
          <input className="qtyin" type="number" min={1} value={newQty} onChange={(e) => setNewQty(Math.max(1, Number(e.target.value) || 1))} aria-label="Quantity" />
          <input className="grow" placeholder="Card name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button
            className="btn primary"
            disabled={!newName.trim()}
            onClick={() => {
              const name = newName.trim();
              const key = normalizeName(name).toLowerCase();
              setEntries((es) => {
                const ex = es.find((e) => e.key === key);
                if (ex) ex.quantity += newQty;
                else es.push({ inputName: name, name: normalizeName(name), key, quantity: newQty, line: 0 });
                return es;
              });
              setNewName('');
              setNewQty(1);
            }}
          >
            Add
          </button>
        </div>
      </div>

      <div className="card">
        {parsed.entries.map((e) => (
          <div key={e.key} className="deckrow">
            <div className="stepper">
              <button aria-label={`Decrease ${e.name}`} onClick={() => setEntries((es) => es.map((x) => (x.key === e.key ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))}>−</button>
              <span>{e.quantity}</span>
              <button aria-label={`Increase ${e.name}`} onClick={() => setEntries((es) => es.map((x) => (x.key === e.key ? { ...x, quantity: x.quantity + 1 } : x)))}>+</button>
            </div>
            <div className="grow">
              {e.inputName}
              {e.setCode && <small className="muted"> ({e.setCode})</small>}
            </div>
            <button className="iconbtn" aria-label={`Remove ${e.name}`} onClick={() => setEntries((es) => es.filter((x) => x.key !== e.key))}>✕</button>
          </div>
        ))}
      </div>

      <div className="card pad">
        <h3>Paste / edit text</h3>
        <p className="muted small">ManaBox format: <code>1 Card Name (set)</code>. Set codes are kept as notes only — every printing is still searched.</p>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={14} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
      </div>
    </div>
  );
}
