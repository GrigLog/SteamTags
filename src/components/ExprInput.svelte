<script lang="ts">
  import { COLUMNS } from '../lib/data/columns';
  import { FUNCTIONS } from '../lib/expr/compile';
  import { ExprError } from '../lib/expr/parser';

  interface Props {
    /** The applied expression; updated only when the draft is valid and applied. */
    value: string;
    /** Returns an error for invalid input, or null. */
    validate: (src: string) => ExprError | null;
    label?: string;
    placeholder?: string;
    kind?: 'filter' | 'formula';
    vars?: { name: string; description: string }[];
    examples?: string[];
  }

  let {
    value = $bindable(),
    validate,
    label = 'Where',
    placeholder = '',
    kind = 'filter',
    vars = [],
    examples = [],
  }: Props = $props();

  let draft = $state(value);
  let error = $state<ExprError | null>(null);
  let showHelp = $state(false);
  let lastValue = value;

  // Follow external changes of the applied value (e.g. a reset).
  $effect(() => {
    if (value !== lastValue) {
      lastValue = value;
      draft = value;
      error = null;
    }
  });

  function apply() {
    const err = validate(draft);
    error = err;
    if (!err) {
      lastValue = draft;
      value = draft;
    }
  }

  function clear() {
    draft = '';
    apply();
  }

  const dirty = $derived(draft !== value);
  const typeLabel: Record<string, string> = { num: 'number', str: 'string', bool: 'boolean', date: 'date', list: 'list' };
</script>

<div class="expr">
  <div class="row">
    <span class="lbl">{label}</span>
    <input
      type="text"
      class="input"
      class:invalid={!!error}
      spellcheck="false"
      autocomplete="off"
      {placeholder}
      bind:value={draft}
      onkeydown={(e) => {
        if (e.key === 'Enter') apply();
        if (e.key === 'Escape') {
          draft = value;
          error = null;
        }
      }}
      aria-invalid={!!error}
      aria-label={label}
    />
    <button class="btn" class:primary={dirty} onclick={apply} title="Apply (Enter)">Apply</button>
    {#if value || draft}
      <button class="btn" onclick={clear} title="Clear">Clear</button>
    {/if}
    <button class="btn" aria-expanded={showHelp} onclick={() => (showHelp = !showHelp)}>Syntax</button>
  </div>

  {#if error}
    <div class="error" role="alert">
      <div>{error.message}</div>
      {#if draft}
        <pre class="snippet">{draft.slice(0, error.pos)}<mark>{draft.slice(error.pos, Math.max(error.end, error.pos + 1)) || ' '}</mark>{draft.slice(Math.max(error.end, error.pos + 1))}</pre>
      {/if}
    </div>
  {/if}

  {#if showHelp}
    <div class="help">
      <div class="help-grid">
        <section>
          <h3>{kind === 'filter' ? 'Conditions' : 'Formula'}</h3>
          <ul>
            {#if kind === 'formula'}
              <li>A number per game; <code>x</code> is the selected metric. Conditions count as 1/0.</li>
              <li>Games whose value is null or not finite (e.g. <code>ln(0)</code>) are skipped.</li>
            {/if}
            <li><code>and</code> <code>or</code> <code>not</code> <code>( )</code></li>
            <li><code>=</code> <code>!=</code> <code>&lt;</code> <code>&lt;=</code> <code>&gt;</code> <code>&gt;=</code> <code>+ - * / % ^</code></li>
            <li><code>name like 'Half%'</code>, <code>ilike</code> ignores case (<code>%</code> any text, <code>_</code> one char)</li>
            <li><code>reviews between 100 and 1000</code>, <code>appid in (10, 20)</code></li>
            <li><code>tags has 'Roguelike'</code> or <code>'Roguelike' in tags</code></li>
            <li><code>price is null</code>, <code>revenue is not null</code></li>
            <li>Dates: <code>release_date &gt;= '2020-01-01'</code> (or <code>'2020'</code>)</li>
            <li>Strings in single or double quotes. Names are case-insensitive.</li>
            <li>A comparison with null is false.</li>
          </ul>
          {#if examples.length}
            <h3>Examples</h3>
            <ul class="examples">
              {#each examples as ex (ex)}
                <li><button class="linkish" onclick={() => { draft = ex; apply(); }}><code>{ex}</code></button></li>
              {/each}
            </ul>
          {/if}
        </section>
        <section>
          <h3>Columns</h3>
          <table>
            <tbody>
              {#each vars as v (v.name)}
                <tr><td><code>{v.name}</code></td><td class="muted">number</td><td>{v.description}</td></tr>
              {/each}
              {#each COLUMNS as c (c.id)}
                <tr><td><code>{c.id}</code></td><td class="muted">{typeLabel[c.type]}</td><td>{c.description}</td></tr>
              {/each}
            </tbody>
          </table>
        </section>
        <section>
          <h3>Functions</h3>
          <table>
            <tbody>
              {#each Object.values(FUNCTIONS) as f (f.signature)}
                <tr><td><code>{f.signature}</code></td><td>{f.description}</td></tr>
              {/each}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  {/if}
</div>

<style>
  .expr {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    flex: 1 1 320px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .lbl {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    white-space: nowrap;
  }

  .input {
    flex: 1 1 220px;
    min-width: 0;
    font-family: var(--mono);
    font-size: 13px;
  }

  .input.invalid {
    border-color: var(--danger);
  }

  .error {
    background: var(--danger-soft);
    color: var(--danger);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 13px;
  }

  .snippet {
    margin: 4px 0 0;
    font-family: var(--mono);
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--text);
  }

  mark {
    background: var(--danger);
    color: var(--surface);
    border-radius: 2px;
  }

  .help {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 14px;
    font-size: 13px;
    max-height: 360px;
    overflow: auto;
  }

  .help-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 8px 24px;
  }

  h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
    margin: 6px 0;
  }

  ul {
    margin: 0;
    padding-left: 18px;
  }

  li {
    margin: 2px 0;
  }

  table {
    border-collapse: collapse;
  }

  td {
    padding: 2px 8px 2px 0;
    vertical-align: top;
  }

  .examples {
    list-style: none;
    padding: 0;
  }

  .linkish {
    background: none;
    border: 0;
    padding: 0;
    text-align: left;
  }

  .linkish:hover code {
    background: var(--accent-soft);
  }
</style>
