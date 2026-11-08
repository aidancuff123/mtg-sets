'use client';
import type { Printing } from '@/lib/types';
import { cap, fmtUsd } from '@/lib/analyze';

export type PriceDisplay = 'both' | 'nonfoil' | 'foil';

export function Rarity({ r }: { r: string }) {
  return <span className={`rarity r-${r}`}>{cap(r)}</span>;
}

export function Prices({ p, display }: { p: Printing; display: PriceDisplay }) {
  return (
    <span className="prices">
      {display !== 'foil' && (
        <span className={p.usd == null ? 'na' : ''}>
          <small>NF</small> {fmtUsd(p.usd)}
        </span>
      )}
      {display !== 'nonfoil' && (
        <span className={p.usdFoil == null ? 'na' : ''}>
          <small>Foil</small> {fmtUsd(p.usdFoil)}
        </span>
      )}
      {display !== 'nonfoil' && p.usdEtched != null && (
        <span>
          <small>Etched</small> {fmtUsd(p.usdEtched)}
        </span>
      )}
    </span>
  );
}

export function Thumb({ p, show, size = 'sm' }: { p?: Printing; show: boolean; size?: 'sm' | 'lg' }) {
  if (!show) return null;
  if (!p?.imageSmall) return <div className={`thumb ${size} empty`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`thumb ${size}`} src={size === 'lg' ? p.imageNormal ?? p.imageSmall : p.imageSmall} alt={p.name} loading="lazy" />;
}

export function SetIcon({ uri }: { uri: string | null }) {
  if (!uri) return <span className="seticon blank" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="seticon" src={uri} alt="" loading="lazy" />;
}

export function Chevron({ open }: { open: boolean }) {
  return <span className={`chev ${open ? 'open' : ''}`} aria-hidden>›</span>;
}

export function ScryLink({ p }: { p: Printing }) {
  return (
    <a className="scry" href={p.scryfallUri} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
      Scryfall ↗
    </a>
  );
}

export function PrintingLine({ p, display }: { p: Printing; display: PriceDisplay }) {
  return (
    <div className="pline">
      <span className="cnum">#{p.collectorNumber}</span>
      <Rarity r={p.rarity} />
      {p.promo && <span className="tag">Promo</span>}
      <Prices p={p} display={display} />
      <ScryLink p={p} />
    </div>
  );
}
