<script lang="ts">
  import ExprInput from '../components/ExprInput.svelte';
  import GamesTable from '../components/GamesTable.svelte';
  import ProgressBar from '../components/ProgressBar.svelte';
  import VirtualTable, { type TableColumn } from '../components/VirtualTable.svelte';
  import { cacheKey, getCached, putCached } from '../lib/cache';
  import { CancelledError } from '../lib/compute/client';
  import {
    CHEBYSHEV_K,
    CONFIDENCE,
    halfWidth,
    METRIC_LABELS,
    normalizeParams,
    sampleRows,
    utilityOf,
    type Metric,
    type Mode,
    type UtilityFnKind,
    type UtilityParams,
    type UtilityResult,
  } from '../lib/compute/utility';
  import { sortRowsByKeys } from '../lib/data/columns';
  import { tagEnd } from '../lib/data/dataset';
  import { compileFilter } from '../lib/expr/compile';
  import { ExprError } from '../lib/expr/parser';
  import { app, settings } from '../lib/stores.svelte';

  const data = app.data;
  const version = app.loaded!.manifest.version;

  const FNS: { id: UtilityFnKind; label: string; formula: string }[] = [
    { id: 'binary', label: 'Binary', formula: '1 if x > t, else 0' },
    { id: 'log', label: 'lg(x+1)', formula: 'log10(x + 1)' },
    { id: 'capped', label: 'Capped linear', formula: 'min(x, cap)' },
    { id: 'linear', label: 'Linear', formula: 'x' },
    { id: 'custom', label: 'Custom', formula: 'your formula' },
  ];
  const METRICS: Metric[] = ['reviews', 'revenue', 'positive'];

  let mode = $state<Mode>('tag');
  let metric = $state<Metric>('reviews');
  let fn = $state<UtilityFnKind>('log');
  const thresholds = $state<Record<Metric, number>>({ reviews: 1000, positive: 1000, revenue: 100_000 });
  const caps = $state<Record<Metric, number>>({ reviews: 10_000, positive: 10_000, revenue: 1_000_000 });
  let formula = $state('sqrt(x)');
  let filter = $state('');
  let minGames = $state(1);
  let search = $state('');

  const params = $derived<UtilityParams>(
    normalizeParams({
      mode,
      metric,
      fn,
      threshold: Number(thresholds[metric]) || 0,
      cap: Number(caps[metric]) || 0,
      formula,
      filter,
      maxTags: settings.maxTags,
      includeFree: settings.includeFree,
    }),
  );

  let result = $state.raw<UtilityResult | null>(null);
  let resultParams = $state.raw<UtilityParams | null>(null);
  let running = $state(false);
  let progress = $state(0);
  let fromCache = $state(false);
  let runError = $state<string | null>(null);
  let selected = $state<number | null>(null);

  // Recompute (or fetch from cache) whenever the parameters change; stale runs are cancelled.
  $effect(() => {
    const p = params;
    const key = cacheKey(version, 'utility', p);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      runError = null;
      const hit = await getCached<UtilityResult>(key);
      if (ctrl.signal.aborted) return;
      if (hit) {
        result = hit;
        resultParams = p;
        fromCache = true;
        selected = null;
        return;
      }
      running = true;
      progress = 0;
      try {
        const r = await app.client!.utility(p, (done) => (progress = done), ctrl.signal);
        result = r;
        resultParams = p;
        fromCache = false;
        selected = null;
        await putCached(key, r);
      } catch (e) {
        if (!(e instanceof CancelledError)) runError = (e as Error).message;
      } finally {
        if (!ctrl.signal.aborted) running = false;
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  });

  function validateFormula(src: string): ExprError | null {
    try {
      utilityOf(data, { ...params, fn: 'custom', formula: src });
      return null;
    } catch (e) {
      if (e instanceof ExprError) return e;
      throw e;
    }
  }

  function validateFilter(src: string): ExprError | null {
    try {
      compileFilter(src, { data, ctx: { maxTags: settings.maxTags } });
      return null;
    } catch (e) {
      if (e instanceof ExprError) return e;
      throw e;
    }
  }

  // ---- Result table ----

  type SortKey = 'name' | 'n' | 'mean' | 'lower' | 'upper';
  let sort = $state<{ key: SortKey; desc: boolean }>({ key: 'lower', desc: true });

  const catName = (r: UtilityResult, j: number) =>
    r.b[j] < 0 ? data.tagNames[r.a[j]] : `${data.tagNames[r.a[j]]} + ${data.tagNames[r.b[j]]}`;

  const extra = $derived.by(() => {
    if (!result) return null;
    const r = result;
    const m = r.count.length;
    const half = new Float64Array(m);
    const lower = new Float64Array(m);
    const upper = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      half[j] = halfWidth(r.sd, r.count[j]);
      lower[j] = r.catMean[j] - half[j];
      upper[j] = r.catMean[j] + half[j];
    }
    const names = Array.from({ length: m }, (_, j) => catName(r, j));
    const collator = new Intl.Collator('en', { sensitivity: 'base' });
    const order = Array.from({ length: m }, (_, j) => j).sort((x, y) => collator.compare(names[x], names[y]));
    const nameRank = new Float64Array(m);
    order.forEach((j, k) => (nameRank[j] = k));
    return { half, lower, upper, names, nameRank };
  });

  const rows = $derived.by(() => {
    if (!result || !extra) return new Uint32Array(0);
    const r = result;
    const terms = search.toLowerCase().split(/[\s+,]+/).filter(Boolean);
    const min = Math.max(1, Number(minGames) || 1);
    const out: number[] = [];
    for (let j = 0; j < r.count.length; j++) {
      if (r.count[j] < min) continue;
      if (terms.length) {
        const a = data.tagNames[r.a[j]].toLowerCase();
        const b = r.b[j] < 0 ? '' : data.tagNames[r.b[j]].toLowerCase();
        if (!terms.every((t) => a.includes(t) || b.includes(t))) continue;
      }
      out.push(j);
    }
    const keys: ArrayLike<number> =
      sort.key === 'name' ? extra.nameRank
      : sort.key === 'n' ? r.count
      : sort.key === 'mean' ? r.catMean
      : sort.key === 'lower' ? extra.lower
      : extra.upper;
    return sortRowsByKeys(Uint32Array.from(out), keys, sort.desc);
  });

  const columns: TableColumn[] = $derived([
    { key: 'rank', label: '#', width: 56, align: 'right', sortable: false },
    { key: 'name', label: result?.mode === 'pair' ? 'Tag pair' : 'Tag', width: 300 },
    { key: 'n', label: 'Games', width: 90, align: 'right', title: 'Games in the category (within the sample)' },
    { key: 'mean', label: 'Utility', width: 190, align: 'right', title: 'Mean utility ± Chebyshev half-width (sorts by the mean)' },
    { key: 'lower', label: 'Lower bound', width: 120, align: 'right', title: `Mean − √10·σ/√n (≥${Math.round(CONFIDENCE * 100)}% confidence)` },
    { key: 'upper', label: 'Upper bound', width: 120, align: 'right', title: `Mean + √10·σ/√n (≥${Math.round(CONFIDENCE * 100)}% confidence)` },
  ]);

  function onSort(key: string) {
    const k = key as SortKey;
    sort = sort.key === k ? { key: k, desc: !sort.desc } : { key: k, desc: k !== 'name' };
  }

  const fmtInt = new Intl.NumberFormat('en-US');
  const fmtSig = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 });
  const fmtCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 4 });
  const fmtVal = (v: number) => (Number.isNaN(v) ? '—' : Math.abs(v) >= 1e5 ? fmtCompact.format(v) : fmtSig.format(v));

  // ---- Games of the selected category ----

  const selectedGames = $derived.by(() => {
    if (selected === null || !result || !resultParams) return null;
    const r = result;
    const p = resultParams;
    const a = r.a[selected];
    const b = r.b[selected];
    const u = utilityOf(data, p);
    const out: number[] = [];
    for (const i of sampleRows(data, p)) {
      if (!Number.isFinite(u(i))) continue;
      let hasA = false;
      let hasB = b < 0;
      for (let k = data.tagOff[i], e = tagEnd(data, i, p.maxTags); k < e; k++) {
        if (data.tagIds[k] === a) hasA = true;
        else if (data.tagIds[k] === b) hasB = true;
      }
      if (hasA && hasB) out.push(i);
    }
    return { name: catName(r, selected), rows: Uint32Array.from(out) };
  });

  const fnDescription = $derived(
    fn === 'binary' ? `1 if x > ${fmtInt.format(thresholds[metric])}, else 0`
    : fn === 'capped' ? `min(x, ${fmtInt.format(caps[metric])})`
    : FNS.find((f) => f.id === fn)!.formula,
  );
  const unit = $derived(metric === 'revenue' ? 'USD' : 'reviews');
</script>

<section class="card">
  <div class="controls">
    <div class="field">
      <span>Mode</span>
      <div class="segmented" role="group" aria-label="Mode">
        <button aria-pressed={mode === 'tag'} onclick={() => (mode = 'tag')}>Tag</button>
        <button aria-pressed={mode === 'pair'} onclick={() => (mode = 'pair')}>Tag pair</button>
      </div>
    </div>
    <div class="field">
      <span>Metric x</span>
      <div class="segmented" role="group" aria-label="Metric">
        {#each METRICS as m (m)}
          <button aria-pressed={metric === m} onclick={() => (metric = m)}>{METRIC_LABELS[m]}</button>
        {/each}
      </div>
    </div>
    <div class="field">
      <span>Utility function</span>
      <div class="segmented" role="group" aria-label="Utility function">
        {#each FNS as f (f.id)}
          <button aria-pressed={fn === f.id} onclick={() => (fn = f.id)} title={f.formula}>{f.label}</button>
        {/each}
      </div>
    </div>
    {#if fn === 'binary'}
      <label class="field">
        <span>Threshold t, {unit}</span>
        <input type="number" min="0" step="any" bind:value={thresholds[metric]} />
      </label>
    {:else if fn === 'capped'}
      <label class="field">
        <span>Cap, {unit}</span>
        <input type="number" min="0" step="any" bind:value={caps[metric]} />
      </label>
    {/if}
  </div>

  {#if fn === 'custom'}
    <div class="formula">
      <ExprInput
        bind:value={formula}
        validate={validateFormula}
        label="u(x) ="
        kind="formula"
        placeholder="e.g. sqrt(x), if(x > 5000, 1, x / 5000)"
        vars={[{ name: 'x', description: `The selected metric: ${METRIC_LABELS[metric]}` }]}
        examples={['sqrt(x)', 'if(x > 5000, 1, x / 5000)', 'log10(x + 1) * rating / 100', 'x > 1000 and rating >= 80']}
      />
    </div>
  {:else}
    <p class="muted fn-desc">u(x) = <code>{fnDescription}</code>, where x is {METRIC_LABELS[metric].toLowerCase()}</p>
  {/if}

  <div class="formula">
    <ExprInput
      bind:value={filter}
      validate={validateFilter}
      label="Games"
      placeholder="optional: only games matching a condition, e.g. release_date >= '2020-01-01'"
      examples={["release_date >= '2020-01-01'", 'price >= 5', "not has(tags, 'Early Access')"]}
    />
  </div>
</section>

<section class="card results">
  {#if running}
    <ProgressBar value={progress} label={mode === 'pair' ? 'Computing tag pairs…' : 'Computing tags…'} />
  {/if}
  {#if runError}
    <div class="error" role="alert">{runError}</div>
  {/if}

  {#if result && extra}
    <div class="summary">
      <span><strong class="num">{fmtInt.format(result.sampleSize)}</strong> games in the sample</span>
      {#if result.skipped}
        <span class="muted">({fmtInt.format(result.skipped)} skipped: no value{metric === 'revenue' ? ', e.g. paid games without a price' : ''})</span>
      {/if}
      <span>mean <strong class="num">{fmtVal(result.mean)}</strong></span>
      <span>σ <strong class="num">{fmtVal(result.sd)}</strong></span>
      <span>k = √10 ≈ {CHEBYSHEV_K.toFixed(3)} (Chebyshev, ≥{Math.round(CONFIDENCE * 100)}%)</span>
      <span class="muted">{fromCache ? 'from cache' : `computed in ${Math.round(result.ms)} ms`}</span>
    </div>
    <p class="muted explain">
      Utility is the mean of u over the category's games, shown as m ± √10·σ/√n. σ is estimated over the
      whole sample and assumed to be the same in every category. Sorted by the lower bound by default.
    </p>

    <div class="table-controls">
      <label class="field">
        <span>Search tags</span>
        <input type="search" bind:value={search} placeholder={mode === 'pair' ? 'e.g. roguelike deck' : 'e.g. horror'} />
      </label>
      <label class="field">
        <span>Min games</span>
        <input type="number" min="1" step="1" bind:value={minGames} class="short" />
      </label>
      <span class="muted count num">{fmtInt.format(rows.length)} of {fmtInt.format(result.count.length)} {result.mode === 'pair' ? 'pairs' : 'tags'}</span>
    </div>

    <VirtualTable
      rowCount={rows.length}
      {columns}
      sortKey={sort.key}
      sortDesc={sort.desc}
      {onSort}
      onRowClick={(r) => (selected = rows[r])}
      selectedRow={selected === null ? null : rows.indexOf(selected)}
      height="56vh"
      emptyText="No categories match"
    >
      {#snippet cell(r: number, key: string)}
        {@const j = rows[r]}
        {#if key === 'rank'}
          <span class="muted">{r + 1}</span>
        {:else if key === 'name'}
          <span title="Click to list the games">{extra.names[j]}</span>
        {:else if key === 'n'}
          {fmtInt.format(result!.count[j])}
        {:else if key === 'mean'}
          {fmtVal(result!.catMean[j])} <span class="muted">± {fmtVal(extra.half[j])}</span>
        {:else if key === 'lower'}
          {fmtVal(extra.lower[j])}
        {:else}
          {fmtVal(extra.upper[j])}
        {/if}
      {/snippet}
    </VirtualTable>
  {:else if !running && !runError}
    <p class="muted">Preparing…</p>
  {/if}
</section>

{#if selectedGames}
  <section class="card games">
    <div class="games-head">
      <h2>{selectedGames.name} <span class="muted">· {fmtInt.format(selectedGames.rows.length)} games</span></h2>
      <button class="btn" onclick={() => (selected = null)}>Close</button>
    </div>
    {#key selectedGames}
      <GamesTable rows={selectedGames.rows} height="50vh" />
    {/key}
  </section>
{/if}

<style>
  .formula {
    margin-top: 12px;
    display: flex;
  }

  .fn-desc {
    margin: 10px 0 0;
    font-size: 13px;
  }

  .results {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
    font-size: 13.5px;
  }

  .explain {
    font-size: 12.5px;
    margin: 0;
  }

  .table-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 18px;
    align-items: flex-end;
  }

  .short {
    width: 90px;
  }

  .count {
    font-size: 13px;
    padding-bottom: 6px;
  }

  .error {
    background: var(--danger-soft);
    color: var(--danger);
    border-radius: 6px;
    padding: 6px 10px;
  }

  .games {
    margin-top: 16px;
  }

  .games-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
</style>
