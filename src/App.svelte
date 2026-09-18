<script lang="ts">
  import { onMount } from 'svelte';
  import ProgressBar from './components/ProgressBar.svelte';
  import { purgeOtherVersions } from './lib/cache';
  import { ComputeClient } from './lib/compute/client';
  import { loadDataset, type LoadPhase } from './lib/data/loader';
  import { app, ROUTES, router, saveSettings, settings, type RouteId } from './lib/stores.svelte';
  import AdHoc from './views/AdHoc.svelte';
  import Dynamics from './views/Dynamics.svelte';
  import Utility from './views/Utility.svelte';

  let phase = $state<LoadPhase>('manifest');
  let progress = $state(0);
  let totalBytes = $state(0);
  let loadError = $state<string | null>(null);
  const visited = $state<Record<RouteId, boolean>>({ adhoc: false, dynamics: false, utility: false });

  $effect(() => {
    visited[router.current] = true;
  });

  $effect(() => {
    void settings.maxTags;
    void settings.includeFree;
    saveSettings();
  });

  onMount(async () => {
    try {
      const loaded = await loadDataset((p, l, t) => {
        phase = p;
        progress = t ? l / t : 0;
        if (p === 'download') totalBytes = t;
      });
      app.client = new ComputeClient(loaded.raw);
      app.loaded = loaded;
      void purgeOtherVersions(loaded.manifest.version);
    } catch (e) {
      loadError = (e as Error).message;
    }
  });

  const PHASE_LABEL: Record<LoadPhase, string> = {
    manifest: 'Checking dataset version…',
    download: 'Downloading dataset…',
    decode: 'Unpacking…',
  };

  const fmtInt = new Intl.NumberFormat('en-US');
  const fmtMb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
</script>

<header class="top">
  <div class="brand">
    <h1>Steam Tags Analytics</h1>
    {#if app.loaded}
      {@const m = app.loaded.data.meta}
      <span class="muted info" title="Dataset {app.loaded.manifest.source}, version {app.loaded.manifest.version}">
        {fmtInt.format(m.n)} released games · fetched {m.fetchedFrom}{m.fetchedTo !== m.fetchedFrom ? ` – ${m.fetchedTo}` : ''}
      </span>
    {/if}
  </div>
  <nav class="tabs" aria-label="Dashboards">
    {#each ROUTES as r (r.id)}
      <a href="#/{r.id}" class="tab" aria-current={router.current === r.id ? 'page' : undefined}>{r.label}</a>
    {/each}
  </nav>
  <div class="settings" aria-label="Global settings">
    <label class="setting" title="Only the first N tags of each game (most voted first) are used everywhere">
      <span>Max tags per game</span>
      <input type="range" min="1" max="20" bind:value={settings.maxTags} />
      <output class="num">{settings.maxTags}</output>
    </label>
    <label class="setting">
      <input type="checkbox" bind:checked={settings.includeFree} />
      <span>Include free games</span>
    </label>
  </div>
</header>

<main>
  {#if loadError}
    <div class="card status">
      <h2>Could not load the dataset</h2>
      <p class="muted">{loadError}</p>
      <button class="btn" onclick={() => location.reload()}>Retry</button>
    </div>
  {:else if !app.loaded}
    <div class="card status">
      <h2>Loading data</h2>
      <ProgressBar
        value={phase === 'download' ? progress : phase === 'decode' ? 1 : 0}
        label={phase === 'download' && totalBytes ? `${PHASE_LABEL[phase]} ${fmtMb(progress * totalBytes)} / ${fmtMb(totalBytes)}` : PHASE_LABEL[phase]}
      />
      <p class="muted small">The dataset is downloaded once and cached in your browser until a new version is published.</p>
    </div>
  {:else}
    {#if visited.adhoc}
      <div hidden={router.current !== 'adhoc'}><AdHoc /></div>
    {/if}
    {#if visited.dynamics}
      <div hidden={router.current !== 'dynamics'}><Dynamics /></div>
    {/if}
    {#if visited.utility}
      <div hidden={router.current !== 'utility'}><Utility /></div>
    {/if}
  {/if}
</main>

<footer class="muted">
  Revenue is a very rough estimate: (initial + final price) / 2 × reviews × 30. Non-USD prices use fixed exchange rates.
  Only released games (not "coming soon") are included.
</footer>

<style>
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 24px;
    padding: 10px 20px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 20;
  }

  .brand {
    display: flex;
    flex-direction: column;
  }

  h1 {
    font-size: 17px;
    margin: 0;
  }

  .info {
    font-size: 12px;
  }

  .tabs {
    display: flex;
    gap: 4px;
  }

  .tab {
    padding: 6px 12px;
    border-radius: 6px;
    color: var(--text);
    font-weight: 500;
  }

  .tab:hover {
    background: var(--surface-2);
    text-decoration: none;
  }

  .tab[aria-current='page'] {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .settings {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    margin-left: auto;
    align-items: center;
  }

  .setting {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    cursor: pointer;
  }

  .setting input[type='range'] {
    width: 120px;
    accent-color: var(--accent);
  }

  .setting input[type='checkbox'] {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
  }

  output {
    min-width: 2ch;
    font-weight: 600;
  }

  main {
    padding: 16px 20px;
    max-width: 1600px;
    margin: 0 auto;
  }

  .status {
    max-width: 520px;
    margin: 60px auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .small {
    font-size: 12.5px;
    margin: 0;
  }

  footer {
    font-size: 12px;
    padding: 4px 20px 20px;
    text-align: center;
  }

  @media (max-width: 700px) {
    .top,
    main {
      padding-left: 12px;
      padding-right: 12px;
    }

    .settings {
      margin-left: 0;
    }
  }
</style>
