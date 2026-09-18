// Decoder for the "STG1" columnar binary produced by scripts/build_data.py.

export interface Section {
  name: string;
  offset: number;
  length: number;
}

export interface Meta {
  format: number;
  n: number;
  source: string;
  generatedAt: string;
  fetchedFrom: string | null;
  fetchedTo: string | null;
  minDay: number;
  maxDay: number;
  fxToUsd: Record<string, number>;
  tags: string[];
  genres: string[];
  sections: Section[];
}

export interface Manifest {
  version: string;
  file: string;
  bytes: number;
  rawBytes: number;
  n: number;
  source: string;
  generatedAt: string;
}

/** All games as parallel columns. Row i describes one game; rows are sorted by appid. */
export interface GameData {
  n: number;
  meta: Meta;
  appid: Uint32Array;
  names: string[];
  /** Days since 1970-01-01; 0 = unknown. */
  releaseDay: Uint16Array;
  /** year * 12 + (month - 1); -1 = unknown. */
  monthIndex: Int32Array;
  total: Uint32Array;
  positive: Uint32Array;
  /** USD; NaN = unknown. */
  priceInit: Float64Array;
  priceFinal: Float64Array;
  /** Estimated revenue in USD; NaN = unknown (paid game without a price). */
  revenue: Float64Array;
  isFree: Uint8Array;
  /** CSR layout: tags of game i are tagIds[tagOff[i] .. tagOff[i + 1]), most voted first. */
  tagOff: Uint32Array;
  tagIds: Uint16Array;
  genreOff: Uint32Array;
  genreIds: Uint8Array;
  tagNames: string[];
  genreNames: string[];
}

const MAGIC = 'STG1';
const REVENUE_REVIEW_MULTIPLIER = 30;
const DAY_MS = 86_400_000;

function readVarints(buf: Uint8Array, count: number, out: Uint32Array | Float64Array): void {
  let pos = 0;
  for (let k = 0; k < count; k++) {
    let x = 0;
    let mul = 1;
    for (;;) {
      const b = buf[pos++];
      x += (b & 0x7f) * mul;
      if (b < 0x80) break;
      mul *= 128;
    }
    out[k] = x;
  }
  if (pos !== buf.length) throw new Error('Corrupt data: trailing bytes in varint section');
}

export function decode(raw: Uint8Array): GameData {
  const magic = String.fromCharCode(raw[0], raw[1], raw[2], raw[3]);
  if (magic !== MAGIC) throw new Error(`Unexpected data format "${magic}"`);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const jsonLen = view.getUint32(4, true);
  const utf8 = new TextDecoder();
  const meta = JSON.parse(utf8.decode(raw.subarray(8, 8 + jsonLen))) as Meta;
  const base = 8 + jsonLen;
  const sec = (name: string): Uint8Array => {
    const s = meta.sections.find((x) => x.name === name);
    if (!s) throw new Error(`Corrupt data: missing section ${name}`);
    return raw.subarray(base + s.offset, base + s.offset + s.length);
  };
  const n = meta.n;

  const appid = new Uint32Array(n);
  readVarints(sec('appid'), n, appid);
  for (let i = 1; i < n; i++) appid[i] += appid[i - 1];

  const names = utf8.decode(sec('name')).split('\0');
  if (names.length !== n) throw new Error('Corrupt data: name count mismatch');

  const days = sec('release_day');
  const releaseDay = new Uint16Array(n);
  const monthIndex = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const d = days[i] | (days[n + i] << 8);
    releaseDay[i] = d;
    if (d === 0) {
      monthIndex[i] = -1;
    } else {
      const date = new Date(d * DAY_MS);
      monthIndex[i] = date.getUTCFullYear() * 12 + date.getUTCMonth();
    }
  }

  const total = new Uint32Array(n);
  readVarints(sec('total'), n, total);
  const positive = new Uint32Array(n);
  readVarints(sec('negative'), n, positive);
  for (let i = 0; i < n; i++) positive[i] = total[i] - positive[i];

  const flags = sec('flags');
  const isFree = new Uint8Array(n);
  const priceInit = new Float64Array(n);
  const priceFinal = new Float64Array(n);
  readVarints(sec('price_init'), n, priceInit);
  readVarints(sec('price_final'), n, priceFinal);
  const revenue = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    isFree[i] = flags[i] & 1;
    if (flags[i] & 2) {
      priceInit[i] /= 100;
      priceFinal[i] /= 100;
      revenue[i] = ((priceInit[i] + priceFinal[i]) / 2) * total[i] * REVENUE_REVIEW_MULTIPLIER;
    } else {
      priceInit[i] = NaN;
      priceFinal[i] = NaN;
      revenue[i] = isFree[i] ? 0 : NaN;
    }
  }

  const genreCount = sec('genre_count');
  const genreIds = sec('genre_ids').slice();
  const genreOff = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) genreOff[i + 1] = genreOff[i] + genreCount[i];

  const tagCount = sec('tag_count');
  const tagBytes = sec('tag_ids');
  const tagOff = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) tagOff[i + 1] = tagOff[i] + tagCount[i];
  const tagIds = new Uint16Array(tagOff[n]);
  for (let p = 0, k = 0; k < tagIds.length; k++) {
    const b = tagBytes[p++];
    tagIds[k] = b === 255 ? 255 + tagBytes[p++] : b;
  }

  return {
    n,
    meta,
    appid,
    names,
    releaseDay,
    monthIndex,
    total,
    positive,
    priceInit,
    priceFinal,
    revenue,
    isFree,
    tagOff,
    tagIds,
    genreOff,
    genreIds,
    tagNames: meta.tags,
    genreNames: meta.genres,
  };
}

/** End offset (exclusive) of game i's tags when only the first maxTags count. */
export function tagEnd(d: GameData, i: number, maxTags: number): number {
  return Math.min(d.tagOff[i] + maxTags, d.tagOff[i + 1]);
}

const baseRowsCache = new WeakMap<GameData, Map<boolean, Uint32Array>>();

/** Row indices of games included by the global "include free games" setting. */
export function baseRows(d: GameData, includeFree: boolean): Uint32Array {
  let byFlag = baseRowsCache.get(d);
  if (!byFlag) baseRowsCache.set(d, (byFlag = new Map()));
  let rows = byFlag.get(includeFree);
  if (!rows) {
    const out = new Uint32Array(d.n);
    let m = 0;
    for (let i = 0; i < d.n; i++) if (includeFree || !d.isFree[i]) out[m++] = i;
    rows = out.slice(0, m);
    byFlag.set(includeFree, rows);
  }
  return rows;
}

export function dayToIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Parses 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' into days since 1970; NaN when invalid. */
export function isoToDay(s: string): number {
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(s.trim());
  if (!m) return NaN;
  const y = +m[1];
  const mo = m[2] ? +m[2] : 1;
  const da = m[3] ? +m[3] : 1;
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return NaN;
  const t = Date.UTC(y, mo - 1, da);
  const back = new Date(t);
  if (back.getUTCMonth() !== mo - 1) return NaN;
  return Math.round(t / DAY_MS);
}

export function steamUrl(appid: number): string {
  return `https://store.steampowered.com/app/${appid}/`;
}
