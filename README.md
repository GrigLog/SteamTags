# Steam Tags Analytics

Static dashboards for exploring Steam game tags, hosted on GitHub Pages with no backend. It has three dashboards:

- **Ad-hoc query**: a table of every released game. You can show or hide columns, sort by clicking a header, and filter with SQL-WHERE-like conditions (`tags has 'Roguelike' and reviews > 1000`).
- **Dynamics**: release counts for a tag or genre per time bin, plus its share of all releases. You can change the date range and bin size. Clicking a bar lists the games in that bin.
- **Utility**: ranks tags or tag pairs by the mean of a utility function applied to reviews or estimated revenue. The functions are binary, lg(x+1), capped linear, linear, and a custom formula. Each value comes with a 90% Chebyshev interval `m ± √10·σ/√n`, where σ is estimated over the whole sample, and the table is sorted by the lower bound.

Global settings apply to every dashboard: the number of tags per game to consider (the first N, most voted first) and whether free games are included.

## Data notes

- Only games with `coming_soon = False` are included.
- Revenue is estimated as `(initial_price + final_price) / 2 × total_reviews × 30`. This is very rough.
  - Free games without a price count as $0.
  - Paid games without a price (mostly delisted) have unknown revenue and are skipped in revenue mode.
- Non-USD prices are converted with the fixed rates in `FX_TO_USD` in `scripts/build_data.py`.

## Updating the dataset

Requirements: [uv](https://docs.astral.sh/uv/). The script uses only the Python 3.14 standard library.

```bash
npm run data -- path/to/app_dataset_YYYYMMDD_YYYYMMDD.csv
```

This command:

1. Writes `public/data/games.<hash>.bin.zst`, a compressed columnar binary of about 3.5 MB.
2. Writes `public/data/manifest.json`.
3. Deletes the previous data file.
4. Verifies that the binary round-trips against the CSV.

Commit the `public/data` changes. Don't commit the CSV (`*.csv` is git-ignored).

Browsers keep the data file in Cache Storage and computed results in IndexedDB. Both are keyed by the data version, so they refresh only when a new dataset is published.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (decoder, query language, utility math, dynamics)
npm run fixture  # rebuild the test fixture after changing scripts/build_data.py
npm run check    # type check
npm run build    # production build in dist/
npm run size     # fails if dist/ exceeds 10 MB
```

### Tests and the dataset

Tests that check exact values use a frozen 9-row sample, `tests/fixtures/games.csv`, and its built binary in `tests/fixtures/data`. Tests on the published dataset in `public/data` only check properties that hold for any data, so updating the dataset never breaks them. If you change the binary format in `scripts/build_data.py`, run `npm run fixture` and commit the result.

## Deploying

The `.github/workflows/deploy.yml` workflow builds and deploys on every push to `main`. To turn it on for a repository, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Stack

- Vite, Svelte 5, and TypeScript.
- Runtime dependencies:
  - `fzstd` to decompress the data.
  - `chart.js` for the charts.
  - `idb-keyval` for the result cache.
- The query language is a small custom parser that compiles expressions into JavaScript closures over typed arrays. There is no SQL engine.
- Utility computations run in a Web Worker and report progress.
