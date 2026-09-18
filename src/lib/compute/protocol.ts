import type { UtilityParams, UtilityResult } from './utility';

export type ToWorker =
  | { type: 'init'; raw: Uint8Array }
  | { type: 'utility'; id: number; params: UtilityParams }
  | { type: 'cancel'; id: number };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'progress'; id: number; done: number }
  | { type: 'result'; id: number; result: UtilityResult }
  | { type: 'error'; id: number; message: string; pos?: number; end?: number };
