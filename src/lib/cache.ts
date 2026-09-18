// Result cache: in-memory Map in front of IndexedDB, keyed by data version + parameters.
// Entries from other data versions are purged at startup, so results live until the dataset changes.

import { createStore, del, get, keys, set, type UseStore } from 'idb-keyval';

const MAX_ENTRIES = 30;
const INDEX_KEY = '__lru__';

let store: UseStore | null = null;
try {
  store = typeof indexedDB === 'undefined' ? null : createStore('steam-tags', 'results');
} catch {
  store = null;
}

const memory = new Map<string, unknown>();

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function cacheKey(version: string, kind: string, params: unknown): string {
  return `${version}|${kind}|${stableStringify(params)}`;
}

async function touch(key: string, remove = false): Promise<void> {
  if (!store) return;
  const index = ((await get<string[]>(INDEX_KEY, store)) ?? []).filter((k) => k !== key);
  if (!remove) index.push(key);
  while (index.length > MAX_ENTRIES) {
    const old = index.shift()!;
    memory.delete(old);
    await del(old, store);
  }
  await set(INDEX_KEY, index, store);
}

export async function getCached<T>(key: string): Promise<T | undefined> {
  if (memory.has(key)) return memory.get(key) as T;
  if (!store) return undefined;
  try {
    const v = await get<T>(key, store);
    if (v !== undefined) {
      memory.set(key, v);
      void touch(key);
    }
    return v;
  } catch {
    return undefined;
  }
}

export async function putCached<T>(key: string, value: T): Promise<void> {
  memory.set(key, value);
  if (!store) return;
  try {
    await set(key, value, store);
    await touch(key);
  } catch {
    // Quota or private mode: the in-memory copy still works for this session.
  }
}

export async function purgeOtherVersions(version: string): Promise<void> {
  if (!store) return;
  try {
    const all = (await keys(store)) as string[];
    const stale = all.filter((k) => k !== INDEX_KEY && !k.startsWith(`${version}|`));
    for (const k of stale) await del(k, store);
    if (stale.length) {
      const index = ((await get<string[]>(INDEX_KEY, store)) ?? []).filter((k) => k.startsWith(`${version}|`));
      await set(INDEX_KEY, index, store);
    }
  } catch {
    // Ignore: a stale cache only wastes space.
  }
}
