import { describe, expect, it } from 'vitest';
import { binLabel, computeDynamics, gamesInBin } from '../src/lib/compute/dynamics';
import { isoToDay } from '../src/lib/data/dataset';
import { makeData } from './helpers';

const day = (s: string) => isoToDay(s);
const d = makeData([
  { tags: ['A', 'B'], total: 1, day: day('2020-01-15') },
  { tags: ['B'], total: 1, day: day('2020-05-01') },
  { tags: ['A'], total: 1, day: day('2021-07-01') },
  { tags: ['B', 'A'], total: 1, day: day('2022-12-31') },
]);
const rows = Uint32Array.from([0, 1, 2, 3]);
const A = { kind: 'tag' as const, id: d.tagNames.indexOf('A') };
const m = (y: number, mo: number) => y * 12 + mo - 1;

describe('dynamics', () => {
  it('bins by year with shares', () => {
    const r = computeDynamics(d, rows, { target: A, fromMonth: m(2020, 1), toMonth: m(2022, 12), step: 12, maxTags: 20 });
    expect(r.labels).toEqual(['2020', '2021', '2022']);
    expect([...r.count]).toEqual([1, 1, 1]);
    expect([...r.total]).toEqual([2, 1, 1]);
  });

  it('respects maxTags and quarter bins', () => {
    const r = computeDynamics(d, rows, { target: A, fromMonth: m(2020, 1), toMonth: m(2020, 6), step: 3, maxTags: 1 });
    expect(r.labels).toEqual(['2020 Q1', '2020 Q2']);
    expect([...r.count]).toEqual([1, 0]);
    expect([...r.total]).toEqual([1, 1]);
    expect(gamesInBin(d, rows, A, m(2022, 1), m(2022, 12), 1).length).toBe(0);
    expect(gamesInBin(d, rows, A, m(2022, 1), m(2022, 12), 2).length).toBe(1);
  });

  it('aligns multi-year bins to the calendar', () => {
    expect(binLabel(m(2020, 1), 60)).toBe('2020–2024');
    const r = computeDynamics(d, rows, { target: A, fromMonth: m(2021, 3), toMonth: m(2022, 12), step: 24, maxTags: 20 });
    expect(r.labels).toEqual(['2020–2021', '2022–2023']);
    expect(r.binFrom[0]).toBe(m(2021, 3));
    expect([...r.total]).toEqual([1, 1]);
  });
});
