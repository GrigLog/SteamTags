<script lang="ts">
  import BarChart from '../components/BarChart.svelte';
  import GamesTable from '../components/GamesTable.svelte';
  import TagPicker from '../components/TagPicker.svelte';
  import { computeDynamics, gamesInBin, monthLabel, STEPS, type Target } from '../lib/compute/dynamics';
  import { baseRows } from '../lib/data/dataset';
  import { app, settings } from '../lib/stores.svelte';

  const data = app.data;
  function parseMonth(s: string, fallback: number): number {
    const m = /^(\d{4})-(\d{2})$/.exec(s);
    return m ? +m[1] * 12 + +m[2] - 1 : fallback;
  }

  const [minMonth, maxMonth] = (() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const m of data.monthIndex) {
      if (m < 0) continue;
      if (m < lo) lo = m;
      if (m > hi) hi = m;
    }
    return [lo, hi];
  })();
  // Releases dated after the data was fetched are data glitches; leave them out of the default range.
  const fetchedTo = data.meta.fetchedTo ? parseMonth(data.meta.fetchedTo.slice(0, 7), maxMonth) : maxMonth;
  const lastMonth = Math.min(maxMonth, fetchedTo);

  const defaultTag = data.tagNames.indexOf('Roguelike');
  let target = $state<Target>({ kind: 'tag', id: defaultTag >= 0 ? defaultTag : 0 });
  let fromText = $state(monthLabel(minMonth));
  let toText = $state(monthLabel(lastMonth));
  let step = $state(12);
  let selected = $state<number | null>(null);

  const fromMonth = $derived(parseMonth(fromText, minMonth));
  const toMonth = $derived(Math.max(fromMonth, parseMonth(toText, maxMonth)));
  const rows = $derived(baseRows(data, settings.includeFree));
  const targetName = $derived(target.kind === 'tag' ? data.tagNames[target.id] : data.genreNames[target.id]);

  const result = $derived(
    computeDynamics(data, rows, { target, fromMonth, toMonth, step, maxTags: settings.maxTags }),
  );
  const share = $derived(Array.from(result.count, (c, k) => (result.total[k] ? (100 * c) / result.total[k] : 0)));

  // Any parameter change invalidates the selected bin.
  $effect(() => {
    void result;
    selected = null;
  });

  const selectedRows = $derived(
    selected === null || selected >= result.labels.length
      ? null
      : gamesInBin(data, rows, target, result.binFrom[selected], result.binTo[selected], settings.maxTags),
  );

  const fmtInt = new Intl.NumberFormat('en-US');
  const fmtCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const fmtPct = (v: number) => `${v === 0 ? 0 : v.toFixed(v < 10 ? 1 : 0)}%`;

  function tooltip(k: number): string[] {
    return [
      `${targetName}: ${fmtInt.format(result.count[k])} releases`,
      `All releases: ${fmtInt.format(result.total[k])}`,
      `Share: ${share[k].toFixed(2)}%`,
      'Click to list the games',
    ];
  }

  const totalCount = $derived(result.count.reduce((a, b) => a + b, 0));
  const stepLabel = $derived(STEPS.find((s) => s.months === step)?.label ?? `${step} mo`);
</script>

<section class="card">
  <div class="controls">
    <TagPicker tags={data.tagNames} genres={data.genreNames} value={target} onChange={(t) => (target = t)} />
    <label class="field">
      <span>From</span>
      <input type="month" bind:value={fromText} min={monthLabel(minMonth)} max={monthLabel(maxMonth)} />
    </label>
    <label class="field">
      <span>To</span>
      <input type="month" bind:value={toText} min={monthLabel(minMonth)} max={monthLabel(maxMonth)} />
    </label>
    <div class="field">
      <span>Step</span>
      <div class="segmented" role="group" aria-label="Step">
        {#each STEPS as s (s.months)}
          <button aria-pressed={step === s.months} onclick={() => (step = s.months)}>{s.label}</button>
        {/each}
      </div>
    </div>
    <button class="btn" onclick={() => { fromText = monthLabel(minMonth); toText = monthLabel(lastMonth); }}>Full range</button>
  </div>

  <p class="muted summary">
    {fmtInt.format(totalCount)} releases with <strong>{targetName}</strong> between {monthLabel(fromMonth)} and {monthLabel(toMonth)}.
    {#if result.undated}{fmtInt.format(result.undated)} games without a release date are not shown.{/if}
    {#if target.kind === 'tag' && settings.maxTags < 20}Only the first {settings.maxTags} tags of each game count.{/if}
  </p>

  <div class="charts">
    <figure>
      <figcaption>Releases with {targetName}, per {stepLabel}</figcaption>
      <BarChart
        labels={result.labels}
        values={result.count}
        colorVar="--chart-count"
        activeColorVar="--chart-count-active"
        {selected}
        yFormat={(v) => fmtCompact.format(v)}
        tooltipLines={tooltip}
        onSelect={(k) => (selected = k)}
        ariaLabel="Number of releases with {targetName} per {stepLabel}"
      />
    </figure>
    <figure>
      <figcaption>Share of all releases, %</figcaption>
      <BarChart
        labels={result.labels}
        values={share}
        colorVar="--chart-share"
        activeColorVar="--chart-share-active"
        {selected}
        yFormat={fmtPct}
        tooltipLines={tooltip}
        onSelect={(k) => (selected = k)}
        ariaLabel="Share of releases with {targetName} among all releases per {stepLabel}"
        height={180}
      />
    </figure>
  </div>

  <details class="datatable">
    <summary>Data table</summary>
    <div class="scroll">
      <table>
        <thead><tr><th>Period</th><th class="r">With {targetName}</th><th class="r">All releases</th><th class="r">Share</th></tr></thead>
        <tbody>
          {#each result.labels as label, k (label)}
            <tr class:sel={selected === k} onclick={() => (selected = k)}>
              <td>{label}</td>
              <td class="r num">{fmtInt.format(result.count[k])}</td>
              <td class="r num">{fmtInt.format(result.total[k])}</td>
              <td class="r num">{share[k].toFixed(2)}%</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </details>
</section>

{#if selectedRows}
  <section class="card games">
    <div class="games-head">
      <h2>
        {targetName} · {result.labels[selected!]}
        <span class="muted">({monthLabel(result.binFrom[selected!])} – {monthLabel(result.binTo[selected!])})</span>
      </h2>
      <button class="btn" onclick={() => (selected = null)}>Close</button>
    </div>
    {#key selectedRows}
      <GamesTable rows={selectedRows} height="50vh" />
    {/key}
  </section>
{:else}
  <p class="muted hint">Click a bar to list the games released in that period.</p>
{/if}

<style>
  .summary {
    margin: 12px 0 4px;
    font-size: 13px;
  }

  .charts {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  figure {
    margin: 0;
  }

  figcaption {
    font-size: 13px;
    font-weight: 600;
    margin: 8px 0 4px;
  }

  .datatable {
    margin-top: 8px;
    font-size: 13px;
  }

  .datatable summary {
    cursor: pointer;
    color: var(--text-muted);
  }

  .scroll {
    max-height: 280px;
    overflow: auto;
    margin-top: 6px;
  }

  table {
    border-collapse: collapse;
    min-width: 420px;
  }

  th,
  td {
    padding: 3px 12px 3px 0;
    text-align: left;
  }

  th {
    position: sticky;
    top: 0;
    background: var(--surface);
  }

  .r {
    text-align: right;
  }

  tbody tr {
    cursor: pointer;
  }

  tbody tr:hover,
  tr.sel {
    background: var(--row-hover);
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

  .hint {
    text-align: center;
    font-size: 13px;
  }
</style>
