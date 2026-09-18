// Web Worker running heavy computations off the main thread, in chunks, with progress and cancellation.

import { decode, type GameData } from '../data/dataset';
import { ExprError } from '../expr/parser';
import type { FromWorker, ToWorker } from './protocol';
import { computeUtility } from './utility';

let data: GameData | undefined;
const cancelled = new Set<number>();

// Yielding through a MessageChannel lets queued "cancel" messages run between chunks without the
// ~4 ms clamp of nested setTimeout.
const channel = new MessageChannel();
const waiting: (() => void)[] = [];
channel.port1.onmessage = () => waiting.shift()?.();
const yieldToEvents = () => new Promise<void>((resolve) => {
  waiting.push(resolve);
  channel.port2.postMessage(null);
});

function post(msg: FromWorker, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(msg, transfer);
}

async function runUtility(id: number, params: Extract<ToWorker, { type: 'utility' }>['params']) {
  if (!data) throw new Error('Worker has no data');
  const gen = computeUtility(data, params);
  let lastReport = 0;
  for (;;) {
    const step = gen.next();
    if (step.done) {
      const r = step.value;
      post({ type: 'result', id, result: r }, [r.a.buffer, r.b.buffer, r.count.buffer, r.catMean.buffer]);
      return;
    }
    const now = performance.now();
    if (now - lastReport > 30) {
      lastReport = now;
      post({ type: 'progress', id, done: step.value });
    }
    await yieldToEvents();
    if (cancelled.has(id)) {
      cancelled.delete(id);
      return;
    }
  }
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      data = decode(msg.raw);
      post({ type: 'ready' });
      break;
    case 'cancel':
      cancelled.add(msg.id);
      break;
    case 'utility':
      try {
        await runUtility(msg.id, msg.params);
      } catch (err) {
        const e = err as Error;
        post({
          type: 'error',
          id: msg.id,
          message: e.message,
          ...(err instanceof ExprError ? { pos: err.pos, end: err.end } : {}),
        });
      }
      break;
  }
};
