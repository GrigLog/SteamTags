<script lang="ts">
  import { COLUMNS } from '../lib/data/columns';
  import { columnPrefs } from '../lib/stores.svelte';

  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (open = false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  });

  const shown = $derived(COLUMNS.length - columnPrefs.hidden.filter((h) => COLUMNS.some((c) => c.id === h)).length);
</script>

<div class="picker" bind:this={root}>
  <button class="btn" aria-expanded={open} aria-haspopup="true" onclick={() => (open = !open)}>
    Columns <span class="muted">{shown}/{COLUMNS.length}</span>
  </button>
  {#if open}
    <div class="menu" role="menu">
      {#each COLUMNS as c (c.id)}
        <label class="item" title={c.description}>
          <input
            type="checkbox"
            checked={!columnPrefs.hidden.includes(c.id)}
            disabled={c.id === 'name'}
            onchange={() => columnPrefs.toggle(c.id)}
          />
          <span>{c.label}</span>
          <code class="muted">{c.id}</code>
        </label>
      {/each}
    </div>
  {/if}
</div>

<style>
  .picker {
    position: relative;
  }

  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 10;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    box-shadow: var(--shadow);
    padding: 6px;
    min-width: 230px;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
  }

  .item:hover {
    background: var(--row-hover);
  }

  .item span {
    flex: 1;
  }
</style>
