<script lang="ts">
  import GamesTable from '../components/GamesTable.svelte';
  import { baseRows } from '../lib/data/dataset';
  import { app, settings } from '../lib/stores.svelte';

  const rows = $derived(baseRows(app.data, settings.includeFree));
</script>

<section class="card">
  <GamesTable {rows} height="calc(100vh - 260px)" />
</section>
