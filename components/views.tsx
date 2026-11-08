'use client';
import { useMemo, useState } from 'react';
import type { CardResult, DeckEntry, Printing } from '@/lib/types';
import {
  cap, cheapest, collectorCompare, deckCost, fmtUsd, foilPrice, modePrice, price, rarityRank, selectedCost, sortCardViews,
  type CardSort, type CardView, type SetGroup, type Selection, type Summary, type WorkingCard,
} from '@/lib/analyze';
import { Chevron, PrintingLine, Prices, Rarity, ScryLink, SetIcon, Thumb, type PriceDisplay } from './ui';

type InSetSort = 'name' | 'price' | 'rarity';

/* ───────────── View A: sets ranked by overlap ───────────── */
export function SetsView({ groups, display, showImages, priceMode }: {
  groups: SetGroup[]; display: PriceDisplay; showImages: boolean; priceMode: 'nonfoil' | 'foil';
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [limit, setLimit] = useState(40);
  const [inSort, setInSort] = useState<InSetSort>('name');
  if (!groups.length) return <Empty text="No sets match. Build the dataset or loosen your filters." />;
  return (
    <div>
      <div className="toolbar">
        <span className="muted">{groups.length} sets · ranked by distinct cards</span>
        <select value={inSort} onChange={(e) => setInSort(e.target.value as InSetSort)} aria-label="Sort cards within set">
          <option value="name">A–Z</option>
          <option value="price">Price</option>
          <option value="rarity">Rarity</option>
        </select>
      </div>
      {groups.slice(0, limit).map((g, i) => {
        const isOpen = !!open[g.setCode];
        return (
          <section key={g.setCode} className="card group">
            <button className="ghead" onClick={() => setOpen({ ...open, [g.setCode]: !isOpen })} aria-expanded={isOpen}>
              <span className="rank">{i + 1}</span>
              <SetIcon uri={g.iconSvgUri} />
              <span className="gtitle">
                <b>{g.setName}</b>
                <small>{g.setCode.toUpperCase()} · {g.setType.replace(/_/g, ' ')} · {g.releasedAt.slice(0, 4)}</small>
              </span>
              <span className="score">
                <b>{g.uniqueCount}</b>
                <small>{g.percentOfDeck.toFixed(0)}% · {g.physicalQuantity} pcs</small>
              </span>
              <Chevron open={isOpen} />
            </button>
            {isOpen && (
              <div className="gbody">
                {sortInSet(g.cards, inSort, priceMode).map((c) => (
                  <GroupCard key={c.entry.key} entry={c.entry} printings={c.printings} display={display} showImages={showImages} />
                ))}
              </div>
            )}
          </section>
        );
      })}
      {limit < groups.length && (
        <button className="btn wide" onClick={() => setLimit(limit + 60)}>Show more sets ({groups.length - limit} left)</button>
      )}
    </div>
  );
}

function sortInSet(cards: SetGroup['cards'], s: InSetSort, mode: 'nonfoil' | 'foil') {
  const c = [...cards];
  const minP = (ps: Printing[]) => cheapest(ps, mode)?.value ?? Infinity;
  const minR = (ps: Printing[]) => Math.max(...ps.map((p) => rarityRank(p.rarity)));
  if (s === 'price') c.sort((a, b) => minP(b.printings) - minP(a.printings) || a.entry.name.localeCompare(b.entry.name));
  else if (s === 'rarity') c.sort((a, b) => minR(b.printings) - minR(a.printings) || a.entry.name.localeCompare(b.entry.name));
  return c;
}

function GroupCard({ entry, printings, display, showImages }: { entry: DeckEntry; printings: Printing[]; display: PriceDisplay; showImages: boolean }) {
  const [open, setOpen] = useState(false);
  const p = printings[0];
  const multi = printings.length > 1;
  return (
    <div className="gcard">
      <div className="gcrow">
        <Thumb p={p} show={showImages} />
        <div className="ginfo">
          <div className="gname"><span className="qty">{entry.quantity}×</span> {entry.name}</div>
          {multi ? (
            <button className="linkbtn" onClick={() => setOpen(!open)} aria-expanded={open}>
              {printings.length} printings in this set <Chevron open={open} />
            </button>
          ) : (
            <PrintingLine p={p} display={display} />
          )}
        </div>
      </div>
      {multi && open && (
        <div className="variants">
          {printings.map((v) => (
            <div key={v.id} className="variant">
              <Thumb p={v} show={showImages} />
              <PrintingLine p={v} display={display} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────── View B: all cards and their sets ───────────── */
export function CardsView({ views, display, showImages, onCompare }: {
  views: CardView[]; display: PriceDisplay; showImages: boolean; onCompare: (key: string) => void;
}) {
  const [sort, setSort] = useState<CardSort>('name');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const sorted = useMemo(() => sortCardViews(views, sort), [views, sort]);
  return (
    <div>
      <div className="toolbar">
        <span className="muted">{views.length} cards</span>
        <select value={sort} onChange={(e) => setSort(e.target.value as CardSort)} aria-label="Sort cards">
          <option value="name">A–Z</option>
          <option value="most-sets">Most sets</option>
          <option value="fewest-sets">Fewest sets</option>
          <option value="lowest-price">Lowest price</option>
          <option value="highest-price">Highest price</option>
        </select>
      </div>
      {sorted.map((v) => {
        const isOpen = !!open[v.entry.key];
        const first = v.sets[0]?.printings[0];
        return (
          <section key={v.entry.key} className="card group">
            <button className="ghead" onClick={() => setOpen({ ...open, [v.entry.key]: !isOpen })} aria-expanded={isOpen}>
              <Thumb p={first} show={showImages} />
              <span className="gtitle">
                <b><span className="qty">{v.entry.quantity}×</span> {v.entry.name}</b>
                <small>
                  {v.status === 'ok' || v.status === 'pending'
                    ? `${v.printingCount} printings · from ${fmtUsd(v.minNonfoil)} NF · ${fmtUsd(v.minFoil)} foil`
                    : <span className="bad">{v.message ?? v.status}</span>}
                </small>
              </span>
              <span className="score"><b>{v.sets.length}</b><small>sets</small></span>
              <Chevron open={isOpen} />
            </button>
            {isOpen && (
              <div className="gbody">
                <button className="btn small" onClick={() => onCompare(v.entry.key)}>Compare all printings</button>
                {v.sets.map((s) => (
                  <div key={s.setCode} className="setrow">
                    <div className="setname">{s.setName} <small>{s.setCode.toUpperCase()}</small></div>
                    {s.printings.map((p) => <PrintingLine key={p.id} p={p} display={display} />)}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ───────────── View C: printing comparison ───────────── */
export function CompareView({ cards, selectedKey, onSelect, showImages, selections, onChoose }: {
  cards: WorkingCard[]; selectedKey: string | null; onSelect: (k: string) => void; showImages: boolean;
  selections: Record<string, Selection>; onChoose: (key: string, sel: Selection | null) => void;
}) {
  const [sort, setSort] = useState<'date' | 'nonfoil' | 'foil' | 'set'>('date');
  const card = cards.find((c) => c.entry.key === selectedKey) ?? cards[0];
  const ps = useMemo(() => {
    if (!card) return [];
    const arr = [...card.printings];
    const nul = (v: number | null) => (v == null ? Infinity : v);
    if (sort === 'nonfoil') arr.sort((a, b) => nul(price(a.usd)) - nul(price(b.usd)));
    else if (sort === 'foil') arr.sort((a, b) => nul(foilPrice(a)) - nul(foilPrice(b)));
    else if (sort === 'set') arr.sort((a, b) => a.setName.localeCompare(b.setName) || collectorCompare(a.collectorNumber, b.collectorNumber));
    else arr.sort((a, b) => a.releasedAt.localeCompare(b.releasedAt) || collectorCompare(a.collectorNumber, b.collectorNumber));
    return arr;
  }, [card, sort]);
  if (!card) return <Empty text="No cards loaded." />;
  const cheapNf = cheapest(card.printings, 'nonfoil');
  const cheapF = cheapest(card.printings, 'foil');
  const sel = selections[card.entry.key];
  return (
    <div>
      <div className="toolbar col">
        <select className="big" value={card.entry.key} onChange={(e) => onSelect(e.target.value)} aria-label="Choose card">
          {[...cards].sort((a, b) => a.entry.name.localeCompare(b.entry.name)).map((c) => (
            <option key={c.entry.key} value={c.entry.key}>{c.entry.name} ({c.printings.length})</option>
          ))}
        </select>
        <div className="row gap">
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort printings">
            <option value="date">Release date</option>
            <option value="nonfoil">Nonfoil price</option>
            <option value="foil">Foil price</option>
            <option value="set">Set name</option>
          </select>
          <span className="muted">{ps.length} printings</span>
        </div>
      </div>
      <div className="card pad cheap">
        <div><small>Cheapest nonfoil</small><b>{cheapNf ? `${fmtUsd(cheapNf.value)} · ${cheapNf.printing.setCode.toUpperCase()} #${cheapNf.printing.collectorNumber}` : 'No known price'}</b></div>
        <div><small>Cheapest foil/etched</small><b>{cheapF ? `${fmtUsd(cheapF.value)} · ${cheapF.printing.setCode.toUpperCase()} #${cheapF.printing.collectorNumber}` : 'No known price'}</b></div>
      </div>
      <div className="cmpgrid">
        {ps.map((p) => {
          const isNf = cheapNf?.printing.id === p.id;
          const isF = cheapF?.printing.id === p.id;
          const chosen = sel?.printingId === p.id;
          return (
            <article key={p.id} className={`card cmp ${isNf ? 'hl-nf' : ''} ${isF ? 'hl-f' : ''} ${chosen ? 'chosen' : ''}`}>
              <Thumb p={p} show={showImages} size="lg" />
              <div className="cmpinfo">
                <b>{p.setName}</b>
                <small>{p.setCode.toUpperCase()} #{p.collectorNumber} · {p.releasedAt}</small>
                <div className="row gap wrap"><Rarity r={p.rarity} />{p.promo && <span className="tag">Promo</span>}<span className="tag">{p.finishes.join(' / ')}</span></div>
                <Prices p={p} display="both" />
                <div className="row gap wrap">
                  {isNf && <span className="badge nf">Cheapest NF</span>}
                  {isF && <span className="badge f">Cheapest foil</span>}
                </div>
                <div className="row gap wrap">
                  <ScryLink p={p} />
                  <select
                    className="small"
                    value={chosen ? sel!.finish : ''}
                    onChange={(e) => onChoose(card.entry.key, e.target.value ? { printingId: p.id, finish: e.target.value as Selection['finish'] } : null)}
                    aria-label="Use this printing for my deck cost"
                  >
                    <option value="">{chosen ? 'Unselect' : 'Use for deck…'}</option>
                    {p.finishes.includes('nonfoil') && <option value="nonfoil">Use nonfoil</option>}
                    {p.finishes.includes('foil') && <option value="foil">Use foil</option>}
                    {p.finishes.includes('etched') && <option value="etched">Use etched</option>}
                  </select>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────── View D: price analysis ───────────── */
export function PricesView({ summary, cards, results, selections, onCompare }: {
  summary: Summary; cards: WorkingCard[]; results: Record<string, CardResult>; selections: Record<string, Selection>; onCompare: (k: string) => void;
}) {
  const nf = useMemo(() => deckCost(cards, 'nonfoil'), [cards]);
  const fo = useMemo(() => deckCost(cards, 'foil'), [cards]);
  const sel = useMemo(() => selectedCost(cards, results, selections), [cards, results, selections]);
  const [showAll, setShowAll] = useState(false);
  return (
    <div>
      <div className="stats">
        <Stat v={summary.entries} l="Cards entered" />
        <Stat v={summary.totalQuantity} l="Physical cards" />
        <Stat v={summary.setsFound} l="Eligible sets" />
        <Stat v={summary.printingRecords} l="Printing records" />
        <Stat v={summary.printingsWithPrice} l="Printings with a price" />
        <Stat v={`${summary.resolved}/${summary.entries}`} l="Cards resolved" />
      </div>
      <div className="card pad">
        <h3>Estimated deck cost (cheapest printings)</h3>
        <div className="costrow"><span>Nonfoil</span><b>{fmtUsd(nf.total)}{!nf.complete && '+'}</b></div>
        {!nf.complete && <p className="warnline">Incomplete — no nonfoil price for: {nf.missing.map((m) => m.name).join(', ')}</p>}
        <div className="costrow"><span>Foil / etched</span><b>{fmtUsd(fo.total)}{!fo.complete && '+'}</b></div>
        {!fo.complete && <p className="warnline">Incomplete — no foil price for: {fo.missing.map((m) => m.name).join(', ')}</p>}
        <div className="costrow"><span>My selected printings ({sel.selectedCount})</span><b>{sel.selectedCount ? fmtUsd(sel.total) : '—'}{sel.missing.length ? '+' : ''}</b></div>
        {sel.missing.length > 0 && <p className="warnline">Selected printing has no price for: {sel.missing.join(', ')}</p>}
        <p className="muted small">Quantity-weighted (e.g. Swamp × {cards.find((c) => c.entry.name === 'Swamp')?.entry.quantity ?? 'n'}). Pick printings in Compare. Prices are indicative Scryfall data.</p>
      </div>
      <div className="card pad">
        <h3>Lowest nonfoil price per card</h3>
        {(showAll ? nf.lines : nf.lines.slice(0, 25)).map((l, i) => (
          <button key={l.entry.key} className="pricerow" onClick={() => onCompare(l.entry.key)}>
            <span>{l.entry.quantity}× {l.entry.name}</span>
            <span className={l.cheapest ? '' : 'na'}>
              {l.cheapest ? `${fmtUsd(l.cheapest.value)} ${l.cheapest.printing.setCode.toUpperCase()}` : 'N/A'}
              <small> · foil {fo.lines[i].cheapest ? fmtUsd(fo.lines[i].cheapest!.value) : 'N/A'}</small>
            </span>
          </button>
        ))}
        {!showAll && nf.lines.length > 25 && <button className="btn wide" onClick={() => setShowAll(true)}>Show all {nf.lines.length}</button>}
      </div>
    </div>
  );
}

function Stat({ v, l }: { v: number | string; l: string }) {
  return <div className="stat"><b>{v}</b><small>{l}</small></div>;
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
