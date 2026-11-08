export interface DeckEntry {
  /** Name exactly as typed (curly apostrophes etc. preserved) */
  inputName: string;
  /** Normalized name used for Scryfall queries (straight apostrophes, collapsed spaces) */
  name: string;
  /** Lower-cased normalized name — the unique key for an entry */
  key: string;
  quantity: number;
  /** Set code supplied in the decklist — metadata only, never limits searches */
  setCode?: string;
  collectorNumber?: string;
  line: number;
}

export interface ParseResult {
  entries: DeckEntry[];
  totalQuantity: number;
  warnings: string[];
  errors: string[];
}

export interface Printing {
  id: string;
  oracleId: string | null;
  name: string;
  setName: string;
  setCode: string;
  setType: string;
  collectorNumber: string;
  rarity: string;
  usd: string | null;
  usdFoil: string | null;
  usdEtched: string | null;
  finishes: string[];
  promo: boolean;
  promoTypes: string[];
  fullArt: boolean;
  frameEffects: string[];
  borderColor: string;
  releasedAt: string;
  lang: string;
  imageSmall: string | null;
  imageNormal: string | null;
  scryfallUri: string;
  /** ISO timestamp of when Scryfall returned this record */
  pricesFetchedAt: string;
}

export type CardStatus = 'ok' | 'unresolved' | 'no-printings' | 'error';

export interface CardResult {
  key: string;
  queryName: string;
  status: CardStatus;
  resolvedName?: string;
  oracleId?: string | null;
  printings: Printing[];
  message?: string;
  fetchedAt?: string;
  fromCache?: boolean;
  stale?: boolean;
}

export interface SetInfo {
  code: string;
  name: string;
  setType: string;
  iconSvgUri: string | null;
  releasedAt: string | null;
}

export interface Filters {
  cardQuery: string;
  setQuery: string;
  rarities: string[]; // empty = all
  setTypes: string[]; // empty = all
  includePromos: boolean;
  includeSpecial: boolean; // alt-art / full-art / showcase / borderless / etc.
  minPrice: number | null;
  maxPrice: number | null;
  priceMode: 'nonfoil' | 'foil';
}

export const DEFAULT_FILTERS: Filters = {
  cardQuery: '',
  setQuery: '',
  rarities: [],
  setTypes: [],
  includePromos: true,
  includeSpecial: true,
  minPrice: null,
  maxPrice: null,
  priceMode: 'nonfoil',
};

export const EXCLUDED_SET_CODES = new Set(['plst']);
