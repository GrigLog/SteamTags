// App-wide reactive state: global settings, loaded data and the current route.

import type { ComputeClient } from './compute/client';
import { COLUMNS } from './data/columns';
import type { Loaded } from './data/loader';

const SETTINGS_KEY = 'steam-tags:settings';

export interface Settings {
  maxTags: number;
  includeFree: boolean;
}

const DEFAULT_SETTINGS: Settings = { maxTags: 20, includeFree: false };

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    const maxTags = Number(saved.maxTags);
    return {
      maxTags: Number.isInteger(maxTags) && maxTags >= 1 && maxTags <= 20 ? maxTags : DEFAULT_SETTINGS.maxTags,
      includeFree: typeof saved.includeFree === 'boolean' ? saved.includeFree : DEFAULT_SETTINGS.includeFree,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const settings: Settings = $state(loadSettings());

export function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode): settings just won't persist.
  }
}

class AppStore {
  // $state.raw: the dataset holds large arrays that must not be wrapped in reactive proxies.
  loaded = $state.raw<Loaded | null>(null);
  client = $state.raw<ComputeClient | null>(null);

  get data() {
    if (!this.loaded) throw new Error('Data not loaded');
    return this.loaded.data;
  }
}

export const app = new AppStore();

export const ROUTES = [
  { id: 'adhoc', label: 'Ad-hoc query' },
  { id: 'dynamics', label: 'Dynamics' },
  { id: 'utility', label: 'Utility' },
] as const;

export type RouteId = (typeof ROUTES)[number]['id'];

function routeFromHash(): RouteId {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  return (ROUTES.find((r) => r.id === id)?.id ?? 'adhoc') as RouteId;
}

class Router {
  current = $state<RouteId>(routeFromHash());

  constructor() {
    window.addEventListener('hashchange', () => (this.current = routeFromHash()));
  }
}

export const router = new Router();

// Shared table column visibility. Only the user's own toggles are persisted, so changes to
// `hiddenByDefault` in the column registry still apply to columns they never touched.
const COLUMNS_KEY = 'steam-tags:column-overrides';

function defaultHidden(id: string): boolean {
  return COLUMNS.find((c) => c.id === id)?.hiddenByDefault ?? false;
}

function loadOverrides(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, hidden]) => typeof hidden === 'boolean')) as Record<string, boolean>;
  } catch {
    return {};
  }
}

class ColumnPrefs {
  /** Column id -> hidden, only for columns the user toggled away from the default. */
  private overrides = $state<Record<string, boolean>>(loadOverrides());

  hidden = $derived(COLUMNS.filter((c) => this.overrides[c.id] ?? defaultHidden(c.id)).map((c) => c.id));

  toggle(id: string) {
    const nowHidden = !this.hidden.includes(id);
    const next = { ...this.overrides };
    if (nowHidden === defaultHidden(id)) delete next[id];
    else next[id] = nowHidden;
    this.overrides = next;
    try {
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
}

export const columnPrefs = new ColumnPrefs();
