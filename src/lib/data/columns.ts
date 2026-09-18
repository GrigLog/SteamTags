// Column registry shared by the games table, the query language and custom utility formulas.

import { dayToIso, tagEnd, type GameData } from './dataset';

export type ValueType = 'num' | 'str' | 'bool' | 'date' | 'list';
export type NumFormat = 'int' | 'usd' | 'usd0' | 'pct';

export interface ColumnDef {
  id: string;
  label: string;
  type: ValueType;
  format?: NumFormat;
  hiddenByDefault?: boolean;
  align: 'left' | 'right';
  width: number;
  description: string;
}

/** Settings that change what a column returns. */
export interface ColumnCtx {
  maxTags: number;
}

export interface ListAccess {
  kind: 'tag' | 'genre';
  ids: ArrayLike<number>;
  names: string[];
  start(i: number): number;
  end(i: number): number;
}

export const COLUMNS: ColumnDef[] = [
  { id: 'appid', label: 'App ID', type: 'num', format: 'int', hiddenByDefault: true, align: 'right', width: 80, description: 'Steam app id' },
  { id: 'name', label: 'Name', type: 'str', align: 'left', width: 260, description: 'Game name (links to the Steam store page)' },
  { id: 'release_date', label: 'Released', type: 'date', align: 'left', width: 104, description: 'Release date; null when unknown' },
  { id: 'genres', label: 'Genres', type: 'list', align: 'left', width: 180, description: 'Steam genres' },
  { id: 'tags', label: 'Tags', type: 'list', align: 'left', width: 200, description: 'User tags, most voted first, limited by the global "max tags" setting' },
  { id: 'reviews', label: 'Reviews', type: 'num', format: 'int', align: 'right', width: 96, description: 'Total number of reviews' },
  { id: 'positive', label: 'Positive', type: 'num', format: 'int', hiddenByDefault: true, align: 'right', width: 92, description: 'Positive reviews' },
  { id: 'negative', label: 'Negative', type: 'num', format: 'int', hiddenByDefault: true, align: 'right', width: 92, description: 'Negative reviews' },
  { id: 'rating', label: 'Rating', type: 'num', format: 'pct', align: 'right', width: 84, description: 'Share of positive reviews, 0–100; null without reviews' },
  { id: 'is_free', label: 'Free', type: 'bool', hiddenByDefault: true, align: 'left', width: 50, description: 'Free to play' },
  { id: 'price', label: 'Initial Price', type: 'num', format: 'usd', hiddenByDefault: true, align: 'right', width: 76, description: 'Initial price, USD; null when unknown' },
  { id: 'final_price', label: 'Price', type: 'num', format: 'usd', align: 'right', width: 84, description: 'Current (discounted) price, USD; null when unknown' },
  { id: 'discount', label: 'Discount', type: 'num', format: 'pct', hiddenByDefault: true, align: 'right', width: 74, description: 'Current discount, 0–100; null when unknown' },
  { id: 'revenue', label: 'Revenue est.', type: 'num', format: 'usd0', align: 'right', width: 110, description: '(price + final_price) / 2 × reviews × 30, USD. Very rough. 0 for free games, null for paid games without a price' },
];

export const COLUMN_BY_ID = new Map(COLUMNS.map((c) => [c.id, c]));

export function numAccessor(d: GameData, id: string): (i: number) => number {
  switch (id) {
    case 'appid': return (i) => d.appid[i];
    case 'release_date': return (i) => (d.releaseDay[i] === 0 ? NaN : d.releaseDay[i]);
    case 'reviews': return (i) => d.total[i];
    case 'positive': return (i) => d.positive[i];
    case 'negative': return (i) => d.total[i] - d.positive[i];
    case 'rating': return (i) => (d.total[i] === 0 ? NaN : (100 * d.positive[i]) / d.total[i]);
    case 'is_free': return (i) => d.isFree[i];
    case 'price': return (i) => d.priceInit[i];
    case 'final_price': return (i) => d.priceFinal[i];
    case 'discount': return (i) => {
      const p = d.priceInit[i];
      return p > 0 ? Math.round(100 * (1 - d.priceFinal[i] / p)) : NaN;
    };
    case 'revenue': return (i) => d.revenue[i];
    default: throw new Error(`Column ${id} is not numeric`);
  }
}

export function strAccessor(d: GameData, id: string): (i: number) => string {
  if (id === 'name') return (i) => d.names[i];
  throw new Error(`Column ${id} is not a string`);
}

export function listAccessor(d: GameData, id: string, ctx: ColumnCtx): ListAccess {
  if (id === 'tags') {
    const { maxTags } = ctx;
    return {
      kind: 'tag',
      ids: d.tagIds,
      names: d.tagNames,
      start: (i) => d.tagOff[i],
      end: (i) => tagEnd(d, i, maxTags),
    };
  }
  if (id === 'genres') {
    return {
      kind: 'genre',
      ids: d.genreIds,
      names: d.genreNames,
      start: (i) => d.genreOff[i],
      end: (i) => d.genreOff[i + 1],
    };
  }
  throw new Error(`Column ${id} is not a list`);
}

export function listText(list: ListAccess, i: number): string {
  const parts: string[] = [];
  for (let k = list.start(i), e = list.end(i); k < e; k++) parts.push(list.names[list.ids[k]]);
  return parts.join(', ');
}

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0Fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export function formatNum(v: number, format: NumFormat | undefined): string {
  if (Number.isNaN(v)) return '';
  switch (format) {
    case 'int': return intFmt.format(v);
    case 'usd': return usdFmt.format(v);
    case 'usd0': return usd0Fmt.format(v);
    case 'pct': return pctFmt.format(v) + '%';
    default: return String(v);
  }
}

/** Builds a cell formatter for one column. */
export function cellFormatter(d: GameData, col: ColumnDef, ctx: ColumnCtx): (i: number) => string {
  switch (col.type) {
    case 'str': return strAccessor(d, col.id);
    case 'list': {
      const list = listAccessor(d, col.id, ctx);
      return (i) => listText(list, i);
    }
    case 'date': {
      const get = numAccessor(d, col.id);
      return (i) => {
        const v = get(i);
        return Number.isNaN(v) ? '' : dayToIso(v);
      };
    }
    case 'bool': {
      const get = numAccessor(d, col.id);
      return (i) => (get(i) ? 'yes' : '');
    }
    default: {
      const get = numAccessor(d, col.id);
      return (i) => formatNum(get(i), col.format);
    }
  }
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const sortKeyCache = new WeakMap<GameData, Map<string, Float64Array>>();

/** Numeric sort key for every game (NaN = null, sorts last). Strings and lists use collation ranks. */
export function sortKeys(d: GameData, colId: string, ctx: ColumnCtx): Float64Array {
  const col = COLUMN_BY_ID.get(colId);
  if (!col) throw new Error(`Unknown column ${colId}`);
  const cacheKey = col.id === 'tags' ? `tags|${ctx.maxTags}` : col.id;
  let perData = sortKeyCache.get(d);
  if (!perData) sortKeyCache.set(d, (perData = new Map()));
  const cached = perData.get(cacheKey);
  if (cached) return cached;

  const keys = new Float64Array(d.n);
  if (col.type === 'str' || col.type === 'list') {
    const text = col.type === 'str' ? strAccessor(d, col.id) : cellFormatter(d, col, ctx);
    const values = new Array<string>(d.n);
    // Trimmed: some names start with stray whitespace, which would otherwise sort them first.
    for (let i = 0; i < d.n; i++) values[i] = text(i).trim();
    const order = Array.from({ length: d.n }, (_, i) => i);
    order.sort((a, b) => collator.compare(values[a], values[b]));
    let rank = 0;
    for (let r = 0; r < d.n; r++) {
      const i = order[r];
      // Empty strings behave like nulls and sort last.
      keys[i] = values[i] === '' ? NaN : (r > 0 && values[order[r - 1]] === values[i] ? rank : (rank = r));
    }
  } else {
    const get = numAccessor(d, col.id);
    for (let i = 0; i < d.n; i++) keys[i] = get(i);
  }
  perData.set(cacheKey, keys);
  return keys;
}

/** Sorts row indices in place by a key array; nulls (NaN) always go last. */
export function sortRowsByKeys(rows: Uint32Array, keys: ArrayLike<number>, desc: boolean): Uint32Array {
  const dir = desc ? -1 : 1;
  return rows.sort((a, b) => {
    const ka = keys[a];
    const kb = keys[b];
    const na = ka !== ka;
    const nb = kb !== kb;
    if (na || nb) return na === nb ? a - b : na ? 1 : -1;
    return ka === kb ? a - b : (ka < kb ? -dir : dir);
  });
}
