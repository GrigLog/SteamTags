<script lang="ts">
  import { cellFormatter, COLUMNS, sortKeys, sortRowsByKeys } from '../lib/data/columns';
  import { steamUrl } from '../lib/data/dataset';
  import { applyFilter, compileFilter } from '../lib/expr/compile';
  import { ExprError } from '../lib/expr/parser';
  import { app, columnPrefs, settings } from '../lib/stores.svelte';
  import ColumnPicker from './ColumnPicker.svelte';
  import ExprInput from './ExprInput.svelte';
  import VirtualTable, { type TableColumn } from './VirtualTable.svelte';

  interface Props {
    /** Games to show before the user's own condition is applied. */
    rows: Uint32Array;
    height?: string;
    defaultSort?: { key: string; desc: boolean };
  }

  let { rows, height = '62vh', defaultSort = { key: 'reviews', desc: true } }: Props = $props();

  const data = app.data;
  const EXAMPLES = [
    "tags has 'Roguelike' and reviews > 1000",
    "release_date >= '2024-01-01' and rating >= 95 and reviews >= 500",
    "name ilike '%simulator%' and price < 10",
    "pos(tags, 'Horror') <= 3 and revenue > 1000000",
    "has_all(genres, 'RPG', 'Strategy') and not is_free",
  ];

  let where = $state('');
  // svelte-ignore state_referenced_locally
  let sort = $state({ ...defaultSort });

  const ctx = $derived({ maxTags: settings.maxTags });

  function validate(src: string): ExprError | null {
    try {
      compileFilter(src, { data, ctx });
      return null;
    } catch (e) {
      if (e instanceof ExprError) return e;
      throw e;
    }
  }

  const filtered = $derived.by(() => {
    try {
      return applyFilter(rows, compileFilter(where, { data, ctx: { maxTags: settings.maxTags } }));
    } catch {
      return rows;
    }
  });

  const sorted = $derived.by(() => {
    const keys = sortKeys(data, sort.key, { maxTags: settings.maxTags });
    return sortRowsByKeys(filtered === rows ? rows.slice() : filtered, keys, sort.desc);
  });

  const visibleCols = $derived(COLUMNS.filter((c) => !columnPrefs.hidden.includes(c.id) || c.id === 'name'));
  const tableCols: TableColumn[] = $derived(
    visibleCols.map((c) => ({ key: c.id, label: c.label, width: c.width, align: c.align, title: `${c.description} — click to sort` })),
  );
  const formatters = $derived(new Map(visibleCols.map((c) => [c.id, cellFormatter(data, c, { maxTags: settings.maxTags })])));

  function onSort(key: string) {
    const col = COLUMNS.find((c) => c.id === key);
    if (sort.key === key) sort = { key, desc: !sort.desc };
    else sort = { key, desc: col?.type === 'num' || col?.type === 'date' };
  }

  const fmtInt = new Intl.NumberFormat('en-US');
</script>

<div class="games">
  <div class="toolbar">
    <ExprInput bind:value={where} {validate} placeholder="e.g. tags has 'Roguelike' and reviews > 1000" examples={EXAMPLES} />
    <ColumnPicker />
  </div>
  <div class="count muted num">
    {fmtInt.format(sorted.length)} of {fmtInt.format(rows.length)} games
  </div>
  <VirtualTable
    rowCount={sorted.length}
    columns={tableCols}
    sortKey={sort.key}
    sortDesc={sort.desc}
    {onSort}
    {height}
    emptyText="No games match"
  >
    {#snippet cell(r: number, key: string)}
      {@const i = sorted[r]}
      {#if key === 'name'}
        <a href={steamUrl(data.appid[i])} target="_blank" rel="noopener noreferrer" title={data.names[i]}>{data.names[i]}</a>
      {:else if key === 'tags' || key === 'genres'}
        {@const text = formatters.get(key)!(i)}
        <span title={text}>{text}</span>
      {:else}
        {formatters.get(key)!(i)}
      {/if}
    {/snippet}
  </VirtualTable>
</div>

<style>
  .games {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-start;
  }

  .count {
    font-size: 13px;
  }
</style>
