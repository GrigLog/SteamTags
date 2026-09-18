import { readFileSync } from 'node:fs';
import { decompress } from 'fzstd';
import { decode, type GameData, type Manifest } from '../src/lib/data/dataset';

const cache = new Map<string, GameData>();

function loadDir(dir: string): GameData {
  let d = cache.get(dir);
  if (!d) {
    const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8')) as Manifest;
    d = decode(decompress(new Uint8Array(readFileSync(`${dir}/${manifest.file}`))));
    cache.set(dir, d);
  }
  return d;
}

/**
 * The published dataset (public/data). It changes with every data update, so tests on it may only
 * check properties that hold for any dataset — never exact counts or specific games' values.
 */
export function loadRealData(): GameData {
  return loadDir('public/data');
}

export function realManifest(): Manifest {
  return JSON.parse(readFileSync('public/data/manifest.json', 'utf8')) as Manifest;
}

/**
 * A frozen 9-row sample (tests/fixtures/games.csv) built with scripts/build_data.py, for exact-value
 * tests. Rebuild after changing the data format: npm run fixture
 */
export function loadFixture(): GameData {
  return loadDir('tests/fixtures/data');
}

export function rowOf(d: GameData, appid: number): number {
  const i = d.appid.indexOf(appid);
  if (i < 0) throw new Error(`appid ${appid} not found`);
  return i;
}

export interface ToyGame {
  name?: string;
  tags: string[];
  genres?: string[];
  total: number;
  positive?: number;
  price?: number;
  free?: boolean;
  day?: number;
}

/** Builds an in-memory GameData from a handful of games (for math tests). */
export function makeData(games: ToyGame[]): GameData {
  const n = games.length;
  const tagNames = [...new Set(games.flatMap((g) => g.tags))].sort();
  const genreNames = [...new Set(games.flatMap((g) => g.genres ?? []))].sort();
  const tagOff = new Uint32Array(n + 1);
  const genreOff = new Uint32Array(n + 1);
  games.forEach((g, i) => {
    tagOff[i + 1] = tagOff[i] + g.tags.length;
    genreOff[i + 1] = genreOff[i] + (g.genres?.length ?? 0);
  });
  const price = Float64Array.from(games, (g) => g.price ?? (g.free ? NaN : 10));
  return {
    n,
    meta: { format: 1, n, source: 'toy', generatedAt: '', fetchedFrom: null, fetchedTo: null, minDay: 0, maxDay: 0, fxToUsd: {}, tags: tagNames, genres: genreNames, sections: [] },
    appid: Uint32Array.from(games, (_, i) => i + 1),
    names: games.map((g, i) => g.name ?? `Game ${i + 1}`),
    releaseDay: Uint16Array.from(games, (g) => g.day ?? 18000),
    monthIndex: Int32Array.from(games, (g) => {
      const dt = new Date((g.day ?? 18000) * 86_400_000);
      return dt.getUTCFullYear() * 12 + dt.getUTCMonth();
    }),
    total: Uint32Array.from(games, (g) => g.total),
    positive: Uint32Array.from(games, (g) => g.positive ?? g.total),
    priceInit: price,
    priceFinal: price.slice(),
    revenue: Float64Array.from(games, (g, i) => (Number.isNaN(price[i]) ? (g.free ? 0 : NaN) : price[i] * g.total * 30)),
    isFree: Uint8Array.from(games, (g) => (g.free ? 1 : 0)),
    tagOff,
    tagIds: Uint16Array.from(games.flatMap((g) => g.tags.map((t) => tagNames.indexOf(t)))),
    genreOff,
    genreIds: Uint8Array.from(games.flatMap((g) => (g.genres ?? []).map((t) => genreNames.indexOf(t)))),
    tagNames,
    genreNames,
  };
}
