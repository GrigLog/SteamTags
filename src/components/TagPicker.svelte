<script lang="ts">
  import type { Target } from '../lib/compute/dynamics';
  import { suggest } from '../lib/expr/compile';

  interface Props {
    tags: string[];
    genres: string[];
    value: Target;
    onChange: (t: Target) => void;
  }

  let { tags, genres, value, onChange }: Props = $props();

  const listId = `tag-picker-${Math.random().toString(36).slice(2)}`;
  const options = $derived([
    ...tags.map((name, id) => ({ text: `Tag: ${name}`, target: { kind: 'tag' as const, id } })),
    ...genres.map((name, id) => ({ text: `Genre: ${name}`, target: { kind: 'genre' as const, id } })),
  ]);
  const byText = $derived(new Map(options.map((o) => [o.text.toLowerCase(), o])));
  const currentText = $derived(value.kind === 'tag' ? `Tag: ${tags[value.id]}` : `Genre: ${genres[value.id]}`);

  let draft = $state('');
  let error = $state('');

  $effect(() => {
    draft = currentText;
  });

  function commit() {
    const raw = draft.trim();
    const hit =
      byText.get(raw.toLowerCase()) ??
      byText.get(`tag: ${raw.toLowerCase()}`) ??
      byText.get(`genre: ${raw.toLowerCase()}`);
    if (hit) {
      error = '';
      draft = hit.text;
      onChange(hit.target);
      return;
    }
    const s = suggest(raw.replace(/^(tag|genre):\s*/i, ''), [...tags, ...genres]);
    error = `Unknown tag or genre${s ? ` — did you mean "${s}"?` : ''}`;
  }
</script>

<label class="field picker">
  <span>Tag or genre</span>
  <input
    type="search"
    list={listId}
    bind:value={draft}
    onchange={commit}
    onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
    onkeydown={(e) => e.key === 'Enter' && commit()}
    aria-invalid={!!error}
    placeholder="Start typing a tag…"
  />
  <datalist id={listId}>
    {#each options as o (o.text)}
      <option value={o.text}></option>
    {/each}
  </datalist>
  {#if error}<small class="err">{error}</small>{/if}
</label>

<style>
  .picker input {
    width: 260px;
  }

  .err {
    color: var(--danger);
  }
</style>
