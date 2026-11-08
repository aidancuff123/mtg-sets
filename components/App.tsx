'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CardResult, Filters, SetInfo } from '@/lib/types';
import { DEFAULT_FILTERS } from '@/lib/types';
import { parseDecklist } from '@/lib/decklist';
import { buildCardViews, buildSetGroups, summarize, workingSet, cap, type Selection } from '@/lib/analyze';
import { buildContext, fullPrintingsCsv, groupedByCardCsv, groupedBySetCsv, htmlReport, textReport } from '@/lib/exports';
import { idbGet, idbSet, lsGet, lsSet } from '@/lib/idb';
import { loadCard, loadSets as fetchSetList, loadDefaultDeck, loadSavedDeck, saveDeck } from '@/lib/dataSource';
import { SetsView, CardsView, CompareView, PricesView, type CrossOff } from './views';
import { DeckEditor } from './DeckEditor';
import type { PriceDisplay } from './ui';

type Tab = 'sets' | 'cards' | 'compare' | 'prices' | 'deck';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'sets', label: 'Sets', icon: '▦' },
  { id: 'cards', label: 'Cards', icon: '☰' },
  { id: 'compare', label: 'Compare', icon: '⇄' },
  { id: 'prices', label: 'Prices', icon: '$' },
  { id: 'deck', label: 'Deck', icon: '✎' },
];

export default function App() {
  const [deckText, setDeckText] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, CardResult>>({});
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const [sets, setSets] = useState<Record<string, SetInfo>>({});
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [tab, setTab] = useState<Tab>('sets');
  const [progress, setProgress] = useState<{ done: number; total: number; current?: string } | null>(null);
  const [showImages, setShowImages] = useState(true);
  const [display, setDisplay] = useState<PriceDisplay>('both');
  const [sheet, setSheet] = useState<'filters' | 'export' | null>(null);
  const [compareKey, setCompareKey] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [saveStatus, setSaveStatus] = useState('');
  const [online, setOnline] = useState(true);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [hideDone, setHideDone] = useState(false);
  const runId = useRef(0);

  const parsed = useMemo(() => (deckText == null ? null : parseDecklist(deckText)), [deckText]);
  const entries = parsed?.entries ?? [];

  // ── initial load: deck text, cached dataset, UI prefs ──
  useEffect(() => {
    (async () => {
      setShowImages(lsGet('showImages', true));
      setDisplay(lsGet('priceDisplay', 'both'));
      setSelections(lsGet('selections', {}));
      setDone(lsGet('crossedOff', {}));
      setHideDone(lsGet('hideCrossedOff', false));
      const cached = await idbGet<Record<string, CardResult>>('results');
      if (cached) setResults(cached);
      const cachedSets = await idbGet<Record<string, SetInfo>>('sets');
      if (cachedSets) setSets(cachedSets);
      let text = lsGet<string | null>('deckText', null);
      if (text == null) {
        try {
          text = await loadSavedDeck();
        } catch {
          text = '';
        }
      }
      setDeckText(text);
    })();
    const on = () => setOnline(navigator.onLine);
    on();
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);

  useEffect(() => lsSet('showImages', showImages), [showImages]);
  useEffect(() => lsSet('priceDisplay', display), [display]);
  useEffect(() => lsSet('selections', selections), [selections]);
  useEffect(() => lsSet('crossedOff', done), [done]);
  useEffect(() => lsSet('hideCrossedOff', hideDone), [hideDone]);
  const x: CrossOff = useMemo(() => ({
    done, hideDone,
    toggle: (k: string) => setDone((cur) => { const n = { ...cur }; if (n[k]) delete n[k]; else n[k] = true; return n; }),
  }), [done, hideDone]);
  const doneCount = entries.filter((e) => done[e.key]).length;

  const loadSets = useCallback(async (refresh = false) => {
    try {
      const list = await fetchSetList(refresh);
      if (list.length) {
        const m = Object.fromEntries(list.map((s) => [s.code, s]));
        setSets(m);
        idbSet('sets', m);
      }
    } catch {}
  }, []);

  // ── dataset builder: server fetches + caches; client shows progress and persists for offline use ──
  const build = useCallback(async (refresh = false) => {
    if (!parsed) return;
    const id = ++runId.current;
    const list = parsed.entries;
    let done = 0;
    setProgress({ done, total: list.length });
    loadSets(refresh);
    const queue = [...list];
    const worker = async () => {
      while (queue.length && runId.current === id) {
        const e = queue.shift()!;
        setProgress({ done, total: list.length, current: e.name });
        let r: CardResult;
        try {
          r = await loadCard(e.name, refresh);
        } catch (err) {
          r = { key: e.key, queryName: e.name, status: 'error', printings: [], message: `Could not load data: ${(err as Error).message}` };
        }
        const prev = resultsRef.current[e.key];
        if (r.status === 'error' && prev && prev.status !== 'error') {
          // keep previously retrieved data instead of discarding it
          r = { ...prev, stale: true, message: `Showing earlier data — refresh failed: ${r.message}` };
        }
        if (runId.current !== id) return;
        setResults((cur) => ({ ...cur, [e.key]: { ...r, key: e.key } }));
        done++;
        setProgress({ done, total: list.length, current: e.name });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (runId.current === id) {
      setProgress(null);
      idbSet('results', resultsRef.current);
    }
  }, [parsed, loadSets]);

  // auto-build whenever the deck changes
  useEffect(() => {
    if (parsed) build(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckText]);

  // persist after updates settle
  useEffect(() => {
    const t = setTimeout(() => idbSet('results', results), 1500);
    return () => clearTimeout(t);
  }, [results]);

  const cards = useMemo(() => workingSet(entries, results, filters), [entries, results, filters]);
  const groups = useMemo(() => buildSetGroups(cards, entries.length, sets), [cards, entries.length, sets]);
  const views = useMemo(() => buildCardViews(cards), [cards]);
  const summary = useMemo(() => summarize(entries, results, workingSet(entries, results, DEFAULT_FILTERS), groups), [entries, results, groups]);
  const allSetTypes = useMemo(
    () => [...new Set(entries.flatMap((e) => results[e.key]?.printings.map((p) => p.setType) ?? []))].sort(),
    [entries, results],
  );
  const activeFilterCount =
    (filters.cardQuery ? 1 : 0) + (filters.setQuery ? 1 : 0) + (filters.rarities.length ? 1 : 0) + (filters.setTypes.length ? 1 : 0) +
    (filters.includePromos ? 0 : 1) + (filters.includeSpecial ? 0 : 1) + (filters.minPrice != null || filters.maxPrice != null ? 1 : 0);

  const download = (name: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const ctx = () => buildContext(entries, results, filters, sets);
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

  const applyDeck = (t: string) => {
    lsSet('deckText', t);
    setDeckText(t);
    setTab('sets');
  };

  const dataTime = useMemo(() => {
    const ts = Object.values(results).map((r) => r.fetchedAt).filter(Boolean).sort() as string[];
    return ts.length ? new Date(ts[ts.length - 1]).toLocaleString() : null;
  }, [results]);

  if (!parsed) return <div className="splash">Loading…</div>;

  return (
    <div className="app">
      <header className="top">
        <div className="toprow">
          <div className="brand">
            <b>Set Overlap</b>
            <small>{entries.length} entries · {parsed.totalQuantity} cards{dataTime ? ` · prices ${dataTime}` : ''}</small>
          </div>
          <button className="iconbtn" onClick={() => setSheet('filters')} aria-label="Filters">
            ⚲{activeFilterCount > 0 && <span className="dot">{activeFilterCount}</span>}
          </button>
          <button className="iconbtn" onClick={() => setSheet('export')} aria-label="Export">⇪</button>
          <button className="iconbtn" onClick={() => build(true)} disabled={!!progress} aria-label="Refresh from Scryfall">↻</button>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search cards…"
          value={filters.cardQuery}
          onChange={(e) => setFilters({ ...filters, cardQuery: e.target.value })}
        />
        {(tab === 'sets' || tab === 'cards') && (
          <div className="crossbar">
            <span><b>{doneCount}</b>/{entries.length} crossed off</span>
            <label><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide crossed off</label>
            {doneCount > 0 && <button className="linkbtn" onClick={() => { if (window.confirm('Clear all cross-offs?')) setDone({}); }}>Clear</button>}
          </div>
        )}
        {progress && (
          <div className="progress" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
            <div className="bar" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
            <span>Fetching {progress.done}/{progress.total}{progress.current ? ` · ${progress.current}` : ''}</span>
          </div>
        )}
        {!progress && (
          <StatusLine summary={summary} online={online} onRetry={() => build(false)} />
        )}
      </header>

      <main className="content">
        {(summary.unresolved.length > 0 || summary.errored.length > 0) && tab !== 'deck' && (
          <details className="card pad alert">
            <summary>
              {summary.unresolved.length > 0 && `${summary.unresolved.length} unresolved`}
              {summary.unresolved.length > 0 && summary.errored.length > 0 && ' · '}
              {summary.errored.length > 0 && `${summary.errored.length} fetch errors`}
            </summary>
            {[...summary.unresolved, ...summary.errored].map((u) => (
              <p key={u.key} className="small"><b>{u.queryName}</b> — {u.message ?? u.status}</p>
            ))}
            {summary.errored.length > 0 && <button className="btn small" onClick={() => build(false)}>Retry failed</button>}
          </details>
        )}
        {tab === 'sets' && <SetsView groups={groups} display={display} showImages={showImages} priceMode={filters.priceMode} x={x} />}
        {tab === 'cards' && <CardsView views={views} display={display} showImages={showImages} x={x} onCompare={(k) => { setCompareKey(k); setTab('compare'); }} />}
        {tab === 'compare' && (
          <CompareView
            cards={cards}
            selectedKey={compareKey}
            onSelect={setCompareKey}
            showImages={showImages}
            selections={selections}
            onChoose={(k, s) => setSelections((cur) => { const n = { ...cur }; if (s) n[k] = s; else delete n[k]; return n; })}
          />
        )}
        {tab === 'prices' && <PricesView summary={summary} cards={cards} results={results} selections={selections} onCompare={(k) => { setCompareKey(k); setTab('compare'); }} />}
        {tab === 'deck' && (
          <DeckEditor
            key={deckText}
            text={deckText ?? ''}
            onApply={applyDeck}
            saveStatus={saveStatus}
            onSave={async (t) => {
              lsSet('deckText', t);
              setSaveStatus(await saveDeck(t));
            }}
            onReset={async () => {
              applyDeck(await loadDefaultDeck());
            }}
          />
        )}
      </main>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <span className="ti">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {sheet && <div className="scrim" onClick={() => setSheet(null)} />}
      {sheet === 'filters' && (
        <div className="sheet" role="dialog" aria-label="Filters">
          <div className="sheethead"><b>Filters</b><button className="btn small" onClick={() => setSheet(null)}>Done</button></div>
          <label className="field">Set name or code<input type="search" value={filters.setQuery} onChange={(e) => setFilters({ ...filters, setQuery: e.target.value })} placeholder="e.g. M19 or Commander" /></label>
          <div className="field">Rarity
            <div className="chips">
              {['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'].map((r) => (
                <button key={r} className={`chip ${filters.rarities.includes(r) ? 'on' : ''}`}
                  onClick={() => setFilters({ ...filters, rarities: toggle(filters.rarities, r) })}>{cap(r)}</button>
              ))}
            </div>
          </div>
          <div className="field">Set type
            <div className="chips">
              {allSetTypes.map((t) => (
                <button key={t} className={`chip ${filters.setTypes.includes(t) ? 'on' : ''}`}
                  onClick={() => setFilters({ ...filters, setTypes: toggle(filters.setTypes, t) })}>{t.replace(/_/g, ' ')}</button>
              ))}
            </div>
          </div>
          <label className="switch"><input type="checkbox" checked={filters.includePromos} onChange={(e) => setFilters({ ...filters, includePromos: e.target.checked })} />Include promotional printings</label>
          <label className="switch"><input type="checkbox" checked={filters.includeSpecial} onChange={(e) => setFilters({ ...filters, includeSpecial: e.target.checked })} />Include special printings (borderless, showcase, full-art, variants)</label>
          <div className="field">Price range (USD, {filters.priceMode})
            <div className="row gap">
              <input type="number" inputMode="decimal" placeholder="Min" value={filters.minPrice ?? ''} onChange={(e) => setFilters({ ...filters, minPrice: e.target.value === '' ? null : Number(e.target.value) })} />
              <input type="number" inputMode="decimal" placeholder="Max" value={filters.maxPrice ?? ''} onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value === '' ? null : Number(e.target.value) })} />
            </div>
          </div>
          <div className="field">Price basis for filters & sorting
            <div className="seg">
              {(['nonfoil', 'foil'] as const).map((m) => <button key={m} className={filters.priceMode === m ? 'on' : ''} onClick={() => setFilters({ ...filters, priceMode: m })}>{cap(m)}</button>)}
            </div>
          </div>
          <div className="field">Show prices
            <div className="seg">
              {(['both', 'nonfoil', 'foil'] as const).map((m) => <button key={m} className={display === m ? 'on' : ''} onClick={() => setDisplay(m)}>{cap(m)}</button>)}
            </div>
          </div>
          <label className="switch"><input type="checkbox" checked={showImages} onChange={(e) => setShowImages(e.target.checked)} />Show card images</label>
          <p className="muted small">The List (PLST) is always excluded. Sets are always ranked by distinct-card overlap.</p>
          <button className="btn wide" onClick={() => setFilters({ ...DEFAULT_FILTERS })}>Reset filters</button>
        </div>
      )}
      {sheet === 'export' && (
        <div className="sheet" role="dialog" aria-label="Export">
          <div className="sheethead"><b>Export</b><button className="btn small" onClick={() => setSheet(null)}>Done</button></div>
          <p className="muted small">Exports reflect current filters{activeFilterCount ? ` (${activeFilterCount} active)` : ' (none active)'}. PLST is never included.</p>
          {!summary.complete && <p className="warnline">Dataset incomplete — exports will be flagged as such.</p>}
          <button className="btn wide" onClick={() => download(`mtg-overlap-report-${stamp()}.html`, htmlReport(ctx()), 'text/html')}>Offline HTML report</button>
          <button className="btn wide" onClick={() => download(`mtg-overlap-report-${stamp()}.txt`, textReport(ctx()), 'text/plain')}>Plain text (grouped by set)</button>
          <button className="btn wide" onClick={() => download(`mtg-printings-${stamp()}.csv`, fullPrintingsCsv(ctx()), 'text/csv')}>Full printings CSV</button>
          <button className="btn wide" onClick={() => download(`mtg-grouped-by-set-${stamp()}.csv`, groupedBySetCsv(ctx()), 'text/csv')}>Grouped-by-set CSV</button>
          <button className="btn wide" onClick={() => download(`mtg-grouped-by-card-${stamp()}.csv`, groupedByCardCsv(ctx()), 'text/csv')}>Grouped-by-card CSV</button>
        </div>
      )}
    </div>
  );
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function StatusLine({ summary, online, onRetry }: { summary: ReturnType<typeof summarize>; online: boolean; onRetry: () => void }) {
  if (!online) return <div className="status warn">Offline — showing saved data</div>;
  if (summary.complete)
    return <div className="status ok">✓ All {summary.entries} cards processed{summary.unresolved.length ? ` · ${summary.unresolved.length} unresolved` : ''} · PLST excluded</div>;
  return (
    <div className="status warn">
      Incomplete: {summary.pending} pending, {summary.errored.length} errors <button className="linkbtn" onClick={onRetry}>Retry</button>
    </div>
  );
}
