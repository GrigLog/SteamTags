<script lang="ts">
  interface Props {
    /** 0..1 */
    value: number;
    label?: string;
  }

  let { value, label = '' }: Props = $props();
  const pct = $derived(Math.round(Math.min(1, Math.max(0, value)) * 100));
</script>

<div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label || 'Progress'}>
  <div class="track"><div class="fill" style:width="{pct}%"></div></div>
  <span class="text muted num">{label} {pct}%</span>
</div>

<style>
  .progress {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .track {
    flex: 1;
    height: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 0.12s linear;
  }

  .text {
    font-size: 12.5px;
    white-space: nowrap;
    min-width: 120px;
  }
</style>
