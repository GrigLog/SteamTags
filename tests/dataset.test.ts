import { describe, expect, it } from 'vitest';
import { cellFormatter, COLUMN_BY_ID, sortKeys, sortRowsByKeys } from '../src/lib/data/columns';
import { baseRows, dayToIso, isoToDay, tagEnd } from '../src/lib/data/dataset';
import { loadFixture, loadRealData, realManifest, rowOf } from './helpers';

describe('decode (frozen fixture)', () => {
  const d = loadFixture();

  it('keeps only released games, sorted by appid', () => {
    expect(Array.from(d.appid)).toEqual([10, 70, 11180, 35030, 200210, 254440, 681810, 1938090]);
    expect(d.appid).not.toContain(224880); // coming soon
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
    expect(d.priceInit[rowOf(d, 681810)]).toBeCloseTo(60 * 0.14, 2); // CNY
    expect(d.priceInit[rowOf(d, 35030)]).toBeCloseTo(6.6, 2); // 970 JPY
  });

  it('handles unknown prices, free games and missing dates', () => {
    const cod = rowOf(d, 1938090); // paid, no price
    expect(d.priceInit[cod]).toBeNaN();
    expect(d.revenue[cod]).toBeNaN();
    const free = rowOf(d, 200210);
    expect(d.isFree[free]).toBe(1);
    expect(d.revenue[free]).toBe(0);
    const undated = rowOf(d, 11180);
    expect(d.releaseDay[undated]).toBe(0);
    expect(d.monthIndex[undated]).toBe(-1);
  });

  it('limits tags by maxTags', () => {
    const i = rowOf(d, 10);
    expect(tagEnd(d, i, 5) - d.tagOff[i]).toBe(5);
    expect(tagEnd(d, i, 20) - d.tagOff[i]).toBe(20);
    const short = rowOf(d, 11180); // 7 tags
    expect(tagEnd(d, short, 20) - d.tagOff[short]).toBe(7);
  });

  it('excludes free games from base rows unless asked', () => {
    expect(baseRows(d, true).length).toBe(8);
    expect(Array.from(baseRows(d, false), (i) => d.appid[i])).not.toContain(200210);
    expect(baseRows(d, false).length).toBe(7);
  });

  it('formats and sorts columns', () => {
    const i = rowOf(d, 10);
    const ctx = { maxTags: 3 };
    expect(cellFormatter(d, COLUMN_BY_ID.get('tags')!, ctx)(i)).toBe('Action, FPS, Multiplayer');
    expect(cellFormatter(d, COLUMN_BY_ID.get('price')!, ctx)(i)).toBe('$9.99');
    const byReviews = sortRowsByKeys(baseRows(d, true).slice(), sortKeys(d, 'reviews', ctx), true);
    expect(d.appid[byReviews[0]]).toBe(1938090);
    // Unknown prices sort last in both directions.
    const priceKeys = sortKeys(d, 'price', ctx);
    for (const desc of [false, true]) {
      const rows = sortRowsByKeys(baseRows(d, true).slice(), priceKeys, desc);
      expect(d.appid[rows[rows.length - 1]]).toBe(1938090);
    }
    const byName = sortRowsByKeys(baseRows(d, true).slice(), sortKeys(d, 'name', ctx), false);
    expect(d.names[byName[0]]).toBe('Call of Duty®');
  });

  it('parses ISO dates', () => {
    expect(dayToIso(isoToDay('2020-02-29'))).toBe('2020-02-29');
    expect(dayToIso(isoToDay('2020-03'))).toBe('2020-03-01');
    expect(isoToDay('2021-02-30')).toBeNaN();
    expect(isoToDay('nope')).toBeNaN();
  });
});

// The published dataset changes with every update: only check invariants here.
describe('published dataset (invariants)', () => {
  const d = loadRealData();

  it('matches its manifest and is sorted by appid', () => {
    expect(d.n).toBe(realManifest().n);
    expect(d.names).toHaveLength(d.n);
    for (let i = 1; i < d.n; i++) if (d.appid[i] <= d.appid[i - 1]) throw new Error(`appids out of order at ${i}`);
  });

  it('has consistent tags, genres and reviews', () => {
    expect(d.tagOff[d.n]).toBe(d.tagIds.length);
    expect(d.genreOff[d.n]).toBe(d.genreIds.length);
    for (const t of d.tagIds) if (t >= d.tagNames.length) throw new Error(`tag id ${t} out of range`);
    for (const g of d.genreIds) if (g >= d.genreNames.length) throw new Error(`genre id ${g} out of range`);
    for (let i = 0; i < d.n; i++) {
      if (d.tagOff[i + 1] < d.tagOff[i]) throw new Error(`bad tag offsets at ${i}`);
      if (d.positive[i] > d.total[i]) throw new Error(`positive > total at ${i}`);
    }
  });

  it('splits free and paid games consistently', () => {
    const free = d.isFree.reduce((a, b) => a + b, 0);
    expect(baseRows(d, true).length).toBe(d.n);
    expect(baseRows(d, false).length).toBe(d.n - free);
  });
});
