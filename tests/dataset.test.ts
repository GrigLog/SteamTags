import { describe, expect, it } from 'vitest';
import { baseRows, dayToIso, isoToDay, tagEnd } from '../src/lib/data/dataset';
import { cellFormatter, COLUMN_BY_ID, sortKeys, sortRowsByKeys } from '../src/lib/data/columns';
import { loadRealData, rowOf } from './helpers';

describe('dataset decode', () => {
  const d = loadRealData();

  it('keeps only released games, sorted by appid', () => {
    expect(d.n).toBe(129656);
    for (let i = 1; i < d.n; i++) expect(d.appid[i]).toBeGreaterThan(d.appid[i - 1]);
    expect(d.tagNames).toHaveLength(430);
    expect(d.genreNames).toHaveLength(33);
  });

  it('decodes Counter-Strike', () => {
    const i = rowOf(d, 10);
    expect(d.names[i]).toBe('Counter-Strike');
    expect(d.total[i]).toBe(261628);
    expect(d.positive[i]).toBe(254838);
    expect(dayToIso(d.releaseDay[i])).toBe('2000-11-01');
    expect(d.priceInit[i]).toBeCloseTo(9.99);
    expect(d.isFree[i]).toBe(0);
    expect(d.revenue[i]).toBeCloseTo(9.99 * 261628 * 30, 0);
    const tags = Array.from(d.tagIds.subarray(d.tagOff[i], d.tagOff[i + 1]), (t) => d.tagNames[t]);
    expect(tags).toHaveLength(20);
    expect(tags.slice(0, 3)).toEqual(['Action', 'FPS', 'Multiplayer']);
    expect(tags).toContain("1990's");
    const genres = Array.from(d.genreIds.subarray(d.genreOff[i], d.genreOff[i + 1]), (g) => d.genreNames[g]);
    expect(genres).toEqual(['Action']);
  });

  it('converts non-USD prices with the fixed rate', () => {
    const i = d.names.indexOf('仙剑奇侠传六');
    expect(d.priceInit[i]).toBeCloseTo(60 * 0.14, 2);
  });

  it('marks paid games without a price as unknown revenue', () => {
    const i = rowOf(d, 1938090); // Call of Duty, delisted price
    expect(Number.isNaN(d.priceInit[i])).toBe(true);
    expect(Number.isNaN(d.revenue[i])).toBe(true);
  });

  it('limits tags by maxTags', () => {
    const i = rowOf(d, 10);
    expect(tagEnd(d, i, 5) - d.tagOff[i]).toBe(5);
    expect(tagEnd(d, i, 20) - d.tagOff[i]).toBe(20);
  });

  it('excludes free games from base rows unless asked', () => {
    const paid = baseRows(d, false);
    const all = baseRows(d, true);
    expect(all.length).toBe(d.n);
    expect(paid.length).toBe(111004); // 18,652 released games are free
    for (const i of paid) expect(d.isFree[i]).toBe(0);
  });

  it('formats and sorts columns', () => {
    const i = rowOf(d, 10);
    const ctx = { maxTags: 3 };
    expect(cellFormatter(d, COLUMN_BY_ID.get('tags')!, ctx)(i)).toBe('Action, FPS, Multiplayer');
    expect(cellFormatter(d, COLUMN_BY_ID.get('price')!, ctx)(i)).toBe('$9.99');
    const keys = sortKeys(d, 'reviews', ctx);
    const rows = sortRowsByKeys(baseRows(d, true).slice(), keys, true);
    expect(d.total[rows[0]]).toBeGreaterThanOrEqual(d.total[rows[1]]);
    const nameKeys = sortKeys(d, 'name', ctx);
    const byName = sortRowsByKeys(baseRows(d, true).slice(0, 1000), nameKeys, false);
    const coll = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
    for (let k = 1; k < byName.length; k++) expect(coll.compare(d.names[byName[k - 1]], d.names[byName[k]])).toBeLessThanOrEqual(0);
  });

  it('parses ISO dates', () => {
    expect(dayToIso(isoToDay('2020-02-29'))).toBe('2020-02-29');
    expect(dayToIso(isoToDay('2020-03'))).toBe('2020-03-01');
    expect(isoToDay('2021-02-30')).toBeNaN();
    expect(isoToDay('nope')).toBeNaN();
  });
});
