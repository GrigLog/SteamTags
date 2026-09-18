// Promise-based front end for the compute worker.

import { ExprError } from '../expr/parser';
import type { FromWorker, ToWorker } from './protocol';
import type { UtilityParams, UtilityResult } from './utility';

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
  }
}

interface Pending {
  resolve: (r: UtilityResult) => void;
  reject: (e: Error) => void;
  onProgress?: (done: number) => void;
}

export class ComputeClient {
  private worker: Worker;
  private ready: Promise<void>;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(raw: Uint8Array) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise((resolve, reject) => {
      this.worker.addEventListener('error', (e) => reject(new Error(e.message || 'Worker failed to start')), { once: true });
      this.worker.addEventListener('message', function onReady(ev: MessageEvent<FromWorker>) {
        if (ev.data.type === 'ready') resolve();
      });
    });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.handle(ev.data);
    // The worker decodes its own copy of the data; the buffer is transferred, not copied.
    this.send({ type: 'init', raw }, [raw.buffer]);
  }

  private send(msg: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }

  private handle(msg: FromWorker) {
    if (msg.type === 'ready') return;
    const job = this.pending.get(msg.id);
    if (!job) return;
    switch (msg.type) {
      case 'progress':
        job.onProgress?.(msg.done);
        break;
      case 'result':
        this.pending.delete(msg.id);
        job.resolve(msg.result);
        break;
      case 'error':
        this.pending.delete(msg.id);
        job.reject(msg.pos !== undefined ? new ExprError(msg.message, msg.pos, msg.end) : new Error(msg.message));
        break;
    }
  }

  /** Runs a utility job; aborting the signal cancels it and rejects with CancelledError. */
  async utility(params: UtilityParams, onProgress?: (done: number) => void, signal?: AbortSignal): Promise<UtilityResult> {
    await this.ready;
    if (signal?.aborted) throw new CancelledError();
    const id = this.nextId++;
    return new Promise<UtilityResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      signal?.addEventListener('abort', () => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        this.send({ type: 'cancel', id });
        reject(new CancelledError());
      }, { once: true });
      this.send({ type: 'utility', id, params: plain(params) });
    });
  }
}

/** Plain-object copy (Svelte state proxies can't be structured-cloned). */
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
