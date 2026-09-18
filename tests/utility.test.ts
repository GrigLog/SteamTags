import { describe, expect, it } from 'vitest';
import { CHEBYSHEV_K, computeUtilitySync, halfWidth, type UtilityParams, type UtilityResult } from '../src/lib/compute/utility';
import { loadRealData, makeData } from './helpers';

const toy = makeData([
  { tags: ['A', 'B'], total: 10 },
  { tags: ['A'], total: 0 },
  { tags: ['B', 'C'], total: 100 },
  { tags: ['A', 'B', 'C'], total: 1000 },
  { tags: ['A', 'C'], total: 5000, free: true },
]);

const base: UtilityParams = {
  mode: 'tag', metric: 'reviews', fn: 'linear', threshold: 50, cap: 500, formula: 'x', filter: '', maxTags: 20, includeFree: false,
};

function byName(d: typeof toy, r: UtilityResult): Record<string, { n: number; m: number }> {
  const out: Record<string, { n: number; m: number }> = {};
  for (let j = 0; j < r.count.length; j++) {
    const key = r.b[j] < 0 ? d.tagNames[r.a[j]] : `${d.tagNames[r.a[j]]}+${d.tagNames[r.b[j]]}`;
    out[key] = { n: r.count[j], m: r.catMean[j] };
  }
  return out;
}

describe('utility ranking', () => {
  it('uses k = sqrt(10) for 90% Chebyshev intervals', () => {
    expect(CHEBYSHEV_K ** 2).toBeCloseTo(10);
    expect(halfWidth(2, 4)).toBeCloseTo(Math.sqrt(10));
  });

  it('computes global mean, sample sd and per-tag means', () => {
    const r = computeUtilitySync(toy, base);
    expect(r.sampleSize).toBe(4); // the free game is excluded
    expect(r.mean).toBeCloseTo(277.5);
    expect(r.sd).toBeCloseTo(Math.sqrt(702075 / 3));
    const cats = byName(toy, r);
    expect(cats.A).toEqual({ n: 3, m: 1010 / 3 });
    expect(cats.B).toEqual({ n: 3, m: 1110 / 3 });
    expect(cats.C).toEqual({ n: 2, m: 550 });
  });

  it('counts unordered tag pairs within maxTags', () => {
    const cats = byName(toy, computeUtilitySync(toy, { ...base, mode: 'pair' }));
    expect(cats).toEqual({ 'A+B': { n: 2, m: 505 }, 'A+C': { n: 1, m: 1000 }, 'B+C': { n: 2, m: 550 } });
    const two = byName(toy, computeUtilitySync(toy, { ...base, mode: 'pair', maxTags: 2 }));
    expect(two).toEqual({ 'A+B': { n: 2, m: 505 }, 'B+C': { n: 1, m: 100 } });
  });

  it('supports every utility function', () => {
    const run = (p: Partial<UtilityParams>) => computeUtilitySync(toy, { ...base, ...p });
    expect(run({ fn: 'binary', threshold: 50 }).mean).toBeCloseTo(0.5);
    expect(run({ fn: 'log' }).mean).toBeCloseTo((Math.log10(11) + 0 + Math.log10(101) + Math.log10(1001)) / 4);
    expect(run({ fn: 'capped', cap: 500 }).mean).toBeCloseTo((10 + 0 + 100 + 500) / 4);
    expect(run({ fn: 'custom', formula: 'sqrt(x)' }).mean).toBeCloseTo((Math.sqrt(10) + 0 + 10 + Math.sqrt(1000)) / 4);
    // Non-finite utilities (ln 0) are skipped.
    const ln = run({ fn: 'custom', formula: 'ln(x)' });
    expect(ln.sampleSize).toBe(3);
    expect(ln.skipped).toBe(1);
  });

  it('applies the optional filter and free-game setting', () => {
    expect(computeUtilitySync(toy, { ...base, filter: 'reviews >= 100' }).sampleSize).toBe(2);
    expect(computeUtilitySync(toy, { ...base, includeFree: true }).sampleSize).toBe(5);
  });

  it('runs on the real dataset', () => {
    const d = loadRealData();
    const tags = computeUtilitySync(d, { ...base, fn: 'log' });
    expect(tags.sampleSize).toBe(111004);
    expect(tags.count.length).toBeGreaterThan(400);
    const pairs = computeUtilitySync(d, { ...base, mode: 'pair', metric: 'revenue', fn: 'log' });
    expect(pairs.skipped).toBe(365); // paid games without a price
    expect(pairs.count.length).toBeGreaterThan(40000);
  });
});
