// Loads the dataset: manifest (always revalidated) + data file (from Cache Storage when the version
// is unchanged, otherwise downloaded with progress and stored).

import { decompress } from 'fzstd';
import { decode, type GameData, type Manifest } from './dataset';

const CACHE_NAME = 'steam-tags-data';

export interface Loaded {
  manifest: Manifest;
  data: GameData;
  /** Decompressed bytes, meant to be transferred to the compute worker (detached afterwards). */
  raw: Uint8Array;
  fromCache: boolean;
}

export type LoadPhase = 'manifest' | 'download' | 'decode';

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

async function fetchManifest(url: string, cache: Cache | null): Promise<Manifest> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = (await res.json()) as Manifest;
    await cache?.put(url, new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } }));
    return manifest;
  } catch (err) {
    // Offline: fall back to the last manifest we saw.
    const hit = await cache?.match(url);
    if (hit) return (await hit.json()) as Manifest;
    throw new Error(`Could not load the dataset manifest (${(err as Error).message})`);
  }
}

async function download(url: string, expected: number, onProgress: (loaded: number, total: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Could not download the dataset (HTTP ${res.status})`);
  const out = new Uint8Array(expected);
  const reader = res.body.getReader();
  let loaded = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length <= out.length) out.set(value, loaded);
    else chunks.push(value);
    loaded += value.length;
    onProgress(loaded, Math.max(expected, loaded));
  }
  if (loaded === expected && !chunks.length) return out;
  // Size differed from the manifest (shouldn't happen); rebuild the exact buffer.
  const exact = new Uint8Array(loaded);
  exact.set(out.subarray(0, Math.min(expected, loaded)));
  let pos = Math.min(expected, loaded);
  for (const c of chunks) {
    exact.set(c, pos);
    pos += c.length;
  }
  return exact;
}

export async function loadDataset(onProgress: (phase: LoadPhase, loaded: number, total: number) => void): Promise<Loaded> {
  const manifestUrl = new URL('data/manifest.json', document.baseURI).href;
  const cache = await openCache();
  onProgress('manifest', 0, 1);
  const manifest = await fetchManifest(manifestUrl, cache);
  const dataUrl = new URL(`data/${manifest.file}`, document.baseURI).href;

  let bytes: Uint8Array | null = null;
  let fromCache = false;
  const hit = await cache?.match(dataUrl);
  if (hit) {
    bytes = new Uint8Array(await hit.arrayBuffer());
    fromCache = bytes.length === manifest.bytes;
    if (!fromCache) bytes = null;
  }
  if (!bytes) {
    bytes = await download(dataUrl, manifest.bytes, (l, t) => onProgress('download', l, t));
    await cache?.put(dataUrl, new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/octet-stream' } }));
  }
  // Drop data files from older versions.
  if (cache) {
    for (const req of await cache.keys()) {
      if (req.url !== dataUrl && req.url !== manifestUrl) await cache.delete(req);
    }
  }

  onProgress('decode', 0, 1);
  await new Promise((r) => setTimeout(r, 0));
  const raw = decompress(bytes);
  const data = decode(raw);
  return { manifest, data, raw, fromCache };
}
