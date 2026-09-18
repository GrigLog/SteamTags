// Release counts per time bin for one tag or genre, plus the share of all releases.

import { tagEnd, type GameData } from '../data/dataset';

export type TargetKind = 'tag' | 'genre';

export interface Target {
  kind: TargetKind;
  id: number;
}

export interface DynamicsParams {
  target: Target;
  /** Inclusive month range, as year * 12 + month0. */
  fromMonth: number;
  toMonth: number;
  /** Bin size in months. */
  step: number;
  maxTags: number;
}

export interface DynamicsResult {
  labels: string[];
  /** First month of each bin, clipped to the range. */
  binFrom: number[];
  /** Last month of each bin, clipped to the range. */
  binTo: number[];
  count: Uint32Array;
  total: Uint32Array;
  /** Games in the base set without a release date (not binned). */
  undated: number;
}

export const STEPS = [
  { months: 1, label: '1 mo' },
  { months: 3, label: '3 mo' },
  { months: 6, label: '6 mo' },
  { months: 12, label: '1 yr' },
  { months: 24, label: '2 yr' },
  { months: 60, label: '5 yr' },
];

export function monthLabel(m: number): string {
  return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
}

export function binLabel(start: number, step: number): string {
  const y = Math.floor(start / 12);
  const mo = start % 12;
  if (step === 1) return monthLabel(start);
  if (step === 3) return `${y} Q${mo / 3 + 1}`;
  if (step === 6) return `${y} H${mo / 6 + 1}`;
  if (step === 12) return String(y);
  if (step % 12 === 0) return `${y}–${y + step / 12 - 1}`;
  return `${monthLabel(start)}…`;
}

export function hasTarget(d: GameData, i: number, target: Target, maxTags: number): boolean {
  if (target.kind === 'tag') {
    for (let k = d.tagOff[i], e = tagEnd(d, i, maxTags); k < e; k++) if (d.tagIds[k] === target.id) return true;
    return false;
  }
  for (let k = d.genreOff[i], e = d.genreOff[i + 1]; k < e; k++) if (d.genreIds[k] === target.id) return true;
  return false;
}

/** Bins are aligned to multiples of the step since year 0, so years, quarters and halves line up with the calendar. */
export function computeDynamics(d: GameData, rows: Uint32Array, p: DynamicsParams): DynamicsResult {
  const { step } = p;
  const firstStart = Math.floor(p.fromMonth / step) * step;
  const nBins = Math.max(0, Math.floor(p.toMonth / step) - Math.floor(p.fromMonth / step) + 1);
  const labels: string[] = [];
  const binFrom: number[] = [];
  const binTo: number[] = [];
  for (let b = 0; b < nBins; b++) {
    const start = firstStart + b * step;
    labels.push(binLabel(start, step));
    binFrom.push(Math.max(start, p.fromMonth));
    binTo.push(Math.min(start + step - 1, p.toMonth));
  }
  const count = new Uint32Array(nBins);
  const total = new Uint32Array(nBins);
  let undated = 0;
  for (let k = 0; k < rows.length; k++) {
    const i = rows[k];
    const m = d.monthIndex[i];
    if (m < 0) {
      undated++;
      continue;
    }
    if (m < p.fromMonth || m > p.toMonth) continue;
    const b = Math.floor(m / step) - Math.floor(p.fromMonth / step);
    total[b]++;
    if (hasTarget(d, i, p.target, p.maxTags)) count[b]++;
  }
  return { labels, binFrom, binTo, count, total, undated };
}

/** Games from `rows` with the target released within [fromMonth, toMonth]. */
export function gamesInBin(d: GameData, rows: Uint32Array, target: Target, fromMonth: number, toMonth: number, maxTags: number): Uint32Array {
  const out: number[] = [];
  for (let k = 0; k < rows.length; k++) {
    const i = rows[k];
    const m = d.monthIndex[i];
    if (m >= fromMonth && m <= toMonth && hasTarget(d, i, target, maxTags)) out.push(i);
  }
  return Uint32Array.from(out);
}
