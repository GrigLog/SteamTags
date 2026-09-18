<script lang="ts" module>
  export interface TableColumn {
    key: string;
    label: string;
    width: number;
    align?: 'left' | 'right';
    title?: string;
    sortable?: boolean;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    rowCount: number;
    columns: TableColumn[];
    sortKey?: string | null;
    sortDesc?: boolean;
    onSort?: (key: string) => void;
    onRowClick?: (row: number) => void;
    selectedRow?: number | null;
    cell: Snippet<[row: number, key: string]>;
    rowHeight?: number;
    height?: string;
    emptyText?: string;
  }

  let {
    rowCount,
    columns,
    sortKey = null,
    sortDesc = false,
    onSort,
    onRowClick,
    selectedRow = null,
    cell,
    rowHeight = 30,
    height = '60vh',
    emptyText = 'No rows',
  }: Props = $props();

  const OVERSCAN = 8;
  let scrollTop = $state(0);
  let viewport = $state(600);
  let el: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => (viewport = el!.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Jump back to the top when the row set changes size (new filter or sort).
  $effect(() => {
    void rowCount;
    void sortKey;
    void sortDesc;
    if (el) el.scrollTop = 0;
  });

  const first = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN));
  const last = $derived(Math.min(rowCount, Math.ceil((scrollTop + viewport) / rowHeight) + OVERSCAN));
  const visible = $derived(Array.from({ length: Math.max(0, last - first) }, (_, k) => first + k));
  const template = $derived(
    columns.map((c, k) => (k === columns.length - 1 ? `minmax(${c.width}px, 1fr)` : `${c.width}px`)).join(' '),
  );
  const minWidth = $derived(columns.reduce((s, c) => s + c.width, 0));
</script>

<div
  class="vt"
  style:height
  bind:this={el}
  onscroll={() => (scrollTop = el!.scrollTop)}
  role="grid"
  aria-rowcount={rowCount + 1}
  tabindex="-1"
>
  <div class="inner" style:min-width="{minWidth}px">
    <div class="head" role="row" style:grid-template-columns={template}>
      {#each columns as c (c.key)}
        {#if c.sortable !== false && onSort}
          <button
            class="th"
            class:right={c.align === 'right'}
            class:sorted={sortKey === c.key}
            role="columnheader"
            aria-sort={sortKey === c.key ? (sortDesc ? 'descending' : 'ascending') : 'none'}
            title={c.title ?? `Sort by ${c.label}`}
            onclick={() => onSort(c.key)}
          >
            <span class="label">{c.label}</span>
            <span class="arrow" aria-hidden="true">{sortKey === c.key ? (sortDesc ? '▼' : '▲') : ''}</span>
          </button>
        {:else}
          <div class="th" class:right={c.align === 'right'} role="columnheader" title={c.title}>
            <span class="label">{c.label}</span>
          </div>
        {/if}
      {/each}
    </div>
    {#if rowCount === 0}
      <div class="empty muted">{emptyText}</div>
    {:else}
      <div class="body" style:height="{rowCount * rowHeight}px">
        <div class="window" style:transform="translateY({first * rowHeight}px)">
          {#each visible as r (r)}
            <div
              class="tr"
              class:clickable={!!onRowClick}
              class:selected={selectedRow === r}
              role="row"
              aria-rowindex={r + 2}
              style:height="{rowHeight}px"
              style:grid-template-columns={template}
              onclick={onRowClick ? () => onRowClick(r) : undefined}
              onkeydown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
              tabindex={onRowClick ? 0 : undefined}
            >
              {#each columns as c (c.key)}
                <div class="td" class:right={c.align === 'right'} role="gridcell">{@render cell(r, c.key)}</div>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .vt {
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    position: relative;
    contain: strict;
    min-height: 160px;
  }

  .inner {
    position: relative;
  }

  .head {
    display: grid;
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-strong);
  }

  .th {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 7px 10px;
    font-weight: 600;
    font-size: 12.5px;
    text-align: left;
    border: 0;
    background: none;
    white-space: nowrap;
    overflow: hidden;
    color: var(--text);
  }

  button.th:hover {
    background: var(--border);
  }

  .th.right {
    justify-content: flex-end;
  }

  .th.sorted {
    color: var(--accent);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .arrow {
    font-size: 9px;
    min-width: 9px;
  }

  .body {
    position: relative;
  }

  .window {
    position: absolute;
    inset: 0 0 auto 0;
  }

  .tr {
    display: grid;
    border-bottom: 1px solid var(--border);
    align-items: center;
  }

  .tr:hover {
    background: var(--row-hover);
  }

  .tr.clickable {
    cursor: pointer;
  }

  .tr.selected {
    background: var(--row-selected);
  }

  .td {
    padding: 0 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
  }

  .td.right {
    text-align: right;
  }

  .empty {
    padding: 24px;
    text-align: center;
  }
</style>
