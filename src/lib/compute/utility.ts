// Utility-function ranking of tags and tag pairs with Chebyshev confidence intervals.
//
// For every game i in the sample S we compute u_i = f(x_i). The variance is estimated once over the
// whole sample (sample std σ, n − 1 denominator) and assumed identical inside every category. For a
// category c with n_c games, the mean m_c has std σ/√n_c, so Chebyshev's inequality
// P(|m_c − μ_c| ≥ kσ/√n_c) ≤ 1/k² with k = √10 gives a 90% interval m_c ± √10·σ/√n_c.

import { baseRows, tagEnd, type GameData } from '../data/dataset';
import { applyFilter, compileFilter, compileNumber, type CompileEnv } from '../expr/compile';

export const CHEBYSHEV_K = Math.sqrt(10);
export const CONFIDENCE = 1 - 1 / (CHEBYSHEV_K * CHEBYSHEV_K);

export type Mode = 'tag' | 'pair';
export type Metric = 'reviews' | 'positive' | 'revenue';
export type UtilityFnKind = 'binary' | 'log' | 'capped' | 'linear' | 'custom';

export interface UtilityParams {
  mode: Mode;
  metric: Metric;
  fn: UtilityFnKind;
  threshold: number;
  cap: number;
  formula: string;
  filter: string;
  maxTags: number;
  includeFree: boolean;
}

export interface UtilityResult {
  mode: Mode;
  /** Games in the sample (finite utility). */
  sampleSize: number;
  /** Games dropped because their utility was null or not finite. */
  skipped: number;
  mean: number;
  sd: number;
  /** One entry per category that has at least one game. b is -1 in tag mode. */
  a: Uint16Array;
  b: Int16Array;
  count: Uint32Array;
  catMean: Float64Array;
  ms: number;
}

export const METRIC_LABELS: Record<Metric, string> = {
  reviews: 'Reviews',
  positive: 'Positive reviews',
  revenue: 'Revenue (est., USD)',
};

/** Keeps only the parameters that affect the result, so equivalent requests share a cache entry. */
export function normalizeParams(p: UtilityParams): UtilityParams {
  return {
    mode: p.mode,
    metric: p.metric,
    fn: p.fn,
    threshold: p.fn === 'binary' ? p.threshold : 0,
    cap: p.fn === 'capped' ? p.cap : 0,
    formula: p.fn === 'custom' ? p.formula.trim() : '',
    filter: p.filter.trim(),
    maxTags: p.maxTags,
    includeFree: p.includeFree,
  };
}

export function metricAccessor(d: GameData, metric: Metric): (i: number) => number {
  switch (metric) {
    case 'reviews': return (i) => d.total[i];
    case 'positive': return (i) => d.positive[i];
    case 'revenue': return (i) => d.revenue[i];
  }
}

/** Builds u(i) for the chosen utility function; throws ExprError for a bad custom formula. */
export function utilityOf(d: GameData, p: UtilityParams): (i: number) => number {
  const x = metricAccessor(d, p.metric);
  switch (p.fn) {
    case 'binary': {
      const t = p.threshold;
      return (i) => { const v = x(i); return v !== v ? NaN : v > t ? 1 : 0; };
    }
    case 'log': return (i) => Math.log10(x(i) + 1);
    case 'capped': {
      const c = p.cap;
      return (i) => Math.min(x(i), c);
    }
    case 'linear': return x;
    case 'custom': {
      const env: CompileEnv = {
        data: d,
        ctx: { maxTags: p.maxTags },
        vars: { x: { f: x, description: METRIC_LABELS[p.metric] } },
      };
      return compileNumber(p.formula, env);
    }
  }
}

/** Rows of the sample before dropping non-finite utilities: base rows narrowed by the optional filter. */
export function sampleRows(d: GameData, p: Pick<UtilityParams, 'filter' | 'maxTags' | 'includeFree'>): Uint32Array {
  const filter = compileFilter(p.filter, { data: d, ctx: { maxTags: p.maxTags } });
  return applyFilter(baseRows(d, p.includeFree), filter);
}

const CHUNK = 4096;

/**
 * Computes the ranking. Yields progress in [0, 1] between chunks so the caller can report it and
 * stay responsive; the generator's return value is the result.
 */
export function* computeUtility(d: GameData, params: UtilityParams): Generator<number, UtilityResult> {
  const started = performance.now();
  const p = normalizeParams(params);
  const u = utilityOf(d, p);
  const rows = sampleRows(d, p);
  const T = d.tagNames.length;
  const pairWork = p.mode === 'pair' ? 0.8 : 0.5;

  // Phase 1: per-game utilities.
  const util = new Float64Array(rows.length);
  const keep = new Uint32Array(rows.length);
  let m = 0;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const stop = Math.min(start + CHUNK, rows.length);
    for (let k = start; k < stop; k++) {
      const i = rows[k];
      const v = u(i);
      if (Number.isFinite(v)) {
        keep[m] = i;
        util[m++] = v;
      }
    }
    yield ((stop / rows.length) * (1 - pairWork));
  }

  let sum = 0;
  for (let k = 0; k < m; k++) sum += util[k];
  const mean = m ? sum / m : NaN;
  let ss = 0;
  for (let k = 0; k < m; k++) ss += (util[k] - mean) ** 2;
  const sd = m > 1 ? Math.sqrt(ss / (m - 1)) : NaN;

  // Phase 2: accumulate per category.
  const size = p.mode === 'pair' ? T * T : T;
  const cnt = new Uint32Array(size);
  const tot = new Float64Array(size);
  const { tagOff, tagIds } = d;
  for (let start = 0; start < m; start += CHUNK) {
    const stop = Math.min(start + CHUNK, m);
    for (let k = start; k < stop; k++) {
      const i = keep[k];
      const v = util[k];
      const s = tagOff[i];
      const e = tagEnd(d, i, p.maxTags);
      if (p.mode === 'tag') {
        for (let q = s; q < e; q++) {
          cnt[tagIds[q]]++;
          tot[tagIds[q]] += v;
        }
      } else {
        for (let q = s; q < e; q++) {
          const x = tagIds[q];
          for (let r = q + 1; r < e; r++) {
            const y = tagIds[r];
            const key = x < y ? x * T + y : y * T + x;
            cnt[key]++;
            tot[key] += v;
          }
        }
      }
    }
    yield (1 - pairWork) + (stop / m) * pairWork;
  }

  let cats = 0;
  for (let c = 0; c < size; c++) if (cnt[c]) cats++;
  const a = new Uint16Array(cats);
  const b = new Int16Array(cats);
  const count = new Uint32Array(cats);
  const catMean = new Float64Array(cats);
  for (let c = 0, j = 0; c < size; c++) {
    if (!cnt[c]) continue;
    if (p.mode === 'pair') {
      a[j] = Math.floor(c / T);
      b[j] = c % T;
    } else {
      a[j] = c;
      b[j] = -1;
    }
    count[j] = cnt[c];
    catMean[j] = tot[c] / cnt[c];
    j++;
  }

  return {
    mode: p.mode,
    sampleSize: m,
    skipped: rows.length - m,
    mean,
    sd,
    a,
    b,
    count,
    catMean,
    ms: performance.now() - started,
  };
}

/** Runs the generator to completion synchronously (tests, small inputs). */
export function computeUtilitySync(d: GameData, params: UtilityParams): UtilityResult {
  const gen = computeUtility(d, params);
  for (;;) {
    const step = gen.next();
    if (step.done) return step.value;
  }
}

/** Half-width of the Chebyshev interval for a category with n games. */
export function halfWidth(sd: number, n: number): number {
  return (CHEBYSHEV_K * sd) / Math.sqrt(n);
}
