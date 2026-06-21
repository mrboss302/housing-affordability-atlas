# Housing Affordability Atlas

A fast, mobile-first, SEO-friendly **static** site: an interactive U.S. housing
affordability map, market-discovery rankings, and place pages. It is the map /
discovery companion to **[Home Payment Atlas](https://homepaymentatlas.com)**
(the detailed mortgage/payment calculator). This site shows the *landscape* of
affordability; Home Payment Atlas is where users customize the payment math.

## Positioning & data strategy

- **Census/HUD** — official public-data backbone: income, population, FIPS
  codes, and the state/county geography that draws the map.
- **Zillow Research** — housing-market texture: home values (ZHVI by tier and
  bedroom count) and rent (ZORI). Aggregate research datasets only — never
  listings, photos, or individual property details. *Zillow does not endorse
  this site.*
- **Home Payment Atlas** — the destination for detailed mortgage/payment
  customization (we link, we don't duplicate).

## Data status (what's real vs pending)

| Field | Source | Status |
|---|---|---|
| State home values (starter / median / family / by bedroom) | Zillow Research ZHVI | **Real** |
| State rent index | Zillow Research ZORI (state = median of city ZORI) | **Real (derived)** |
| State / county / place median income, rent, population | U.S. Census ACS 5-year 2023 | **Real** |
| **City** home values (tiers + bedroom) & rent | Zillow Research City ZHVI / ZORI | **Real** (33 curated cities) |
| State / county geometry, FIPS | U.S. Census Cartographic Boundary Files | **Real** |
| **County** home values | not published by Zillow at county level | **Missing** — county pages show "Not available" and are `noindex` |
| Inventory, price cuts, days to pending, market heat | Zillow Research (planned) | **Pending** — market-signal layers/rankings show an honest "data coming soon" state |

The site never publishes placeholder numbers as if they were real. Pages missing
their headline figure are `noindex` and excluded from the sitemap.

## Deploy (automated)

This repo auto-builds and deploys to **GitHub Pages** via
`.github/workflows/deploy.yml`:

- **On push to `main` / manual run** → builds from committed data and deploys.
- **Monthly (17th, after Zillow's ~16th update)** → downloads fresh Zillow +
  Census data, regenerates, commits the refreshed data/pages, then deploys.

Setup (one time):
1. Repo **Settings → Pages → Source: GitHub Actions** (the workflow also tries to
   enable this automatically).
2. Repo **Settings → Secrets and variables → Actions** → add `CENSUS_API_KEY`
   (your activated Census key) so scheduled runs can refresh income data.
3. The public origin is set by the `SITE_URL` env in the workflow — change it (and
   add a `CNAME` step) when you move to a custom domain.

Local preview: `node tools/serve.js` → http://localhost:8766. Manual full refresh:
run the four pipeline steps below, then `node tools/generate.js`.

## Data ingestion pipeline

```bash
# 1. Zillow STATE datasets -> assets/data/market-data.js
ZILLOW_CSV_DIR="/path/to/zillow/csv" node tools/import-zillow.js

# 2. Zillow CITY/COUNTY datasets -> assets/data/market-places.js
ZILLOW_CSV_DIR="/path/to/zillow/csv" node tools/import-zillow-places.js
#    (both default to the Home Payment Atlas csv folder if present)

# 3. Census ACS state + place + county -> census-data.js & census-places.js
CENSUS_YEAR=2023 CENSUS_API_KEY=xxxxx node tools/import-census.js
#    Get a free key at https://api.census.gov/data/key_signup.html — ACTIVATE it
#    via the email link. The key is read from the env only; never written to a file.

# 4. Regenerate every page, sitemap, robots.txt, ads.txt
node tools/generate.js
```

To add cities to rankings/place pages, add them to `assets/data/places-sample.js`
(the curated registry) using their Zillow name + state, then re-run steps 2–4. The
importers log any city they can't match so you can prune it.

Pipeline properties: normalizes region names and IDs (prefers **FIPS**, falls
back to USPS abbreviation), tracks **data vintage** per source, stores source
URLs, **gracefully skips** any missing dataset, and never breaks the build.

### Files in the pipeline

| File | Role |
|---|---|
| `tools/normalize-data.js` | Shared name/FIPS/abbr normalization + CSV parsing |
| `tools/import-zillow.js` | State ZHVI tiers, bedrooms, ZORI → `market-data.js` |
| `tools/import-zillow-places.js` | City ZHVI/ZORI + county ZORI → `market-places.js` |
| `tools/import-census.js` | ACS state + place + county → `census-data.js`, `census-places.js` |
| `tools/generate.js` | Static-site generator (bakes crawlable tables, noindex, sitemap) |
| `assets/data/source-metadata.js` | Per-field provenance + attribution (drives source notes) |
| `assets/data/market-data.js` / `market-places.js` | **Generated** Zillow data (do not edit) |
| `assets/data/census-data.js` / `census-places.js` | **Generated** Census data (do not edit) |
| `assets/data/assumptions.js` | Mortgage assumptions (rate, term, down, tax, PMI, DTI) |
| `assets/data/states.js` | State directory + fallbacks |
| `assets/data/places-sample.js` | Curated city/county REGISTRY (no figures — data is merged) |

### Census field reference

| Variable | Field | Update frequency |
|---|---|---|
| `B19013_001E` | Median household income | ACS 5-year, annual release |
| `B25064_001E` | Median gross rent | ACS 5-year, annual release |
| `B25077_001E` | Median owner value | ACS 5-year, annual release |
| `B01003_001E` | Total population | ACS 5-year, annual release |

Zillow ZHVI/ZORI refresh **monthly** — re-run `import-zillow.js` then
`generate.js`. **Verify numbers** by spot-checking a few states against
zillow.com/research/data and data.census.gov before publishing.

## How the map works

Geometry is real U.S. Census boundaries (`cb_2018_us_state_20m`), simplified and
Albers-USA-projected with `mapshaper`, baked into `assets/data/us-geo.js` as
pre-computed SVG paths (no fetch/CORS). `assets/js/map.js` renders the states as
an inline SVG and colors them by the active **layer**:

- Starter / Median / Family-home affordability (Zillow tiers vs income)
- Income needed, Estimated monthly payment, Rent affordability
- Buyer opportunity / Market heat / Price-cut share — *preview layers* that show
  "data coming soon" until the Zillow market-signal datasets are imported.

All math lives in `assets/js/affordability.js` and is shared by the map **and**
the generator, so numbers are consistent everywhere. Keyboard-accessible
(Tab + Enter on states), respects `prefers-reduced-motion`.

## AdSense

- Publisher ID: `SITE.adClient` in `tools/generate.js`. The loader is active in
  `<head>`; `ads.txt` is generated at the root. Ad units are labeled
  "Advertisement" and reserve space (low CLS). Replace the placeholder
  `data-ad-slot` IDs in `ad()` with real units, then uncomment the `<ins>` block.

## Add more pages

- **State page:** add the abbr to `STATE_PAGES` (+ `STATE_NEIGHBORS` in
  generate.js, `PUBLISHED_STATES` in map.js), then re-run.
- **Place page:** add to `places-sample.js` + `PLACE_PAGES`, re-run.
- **Income page:** add to `assumptions.js` → `incomeScenarios`, re-run.
- **Ranking page:** add an entry to `liveDefs` (data-backed) or `roadmapDefs`
  (pending) in `buildRankingPages`, re-run.

## Legal / content guardrails

Educational estimates only — not financial, legal, tax, mortgage, or real-estate
advice. Aggregate research data only (no scraped listings). Zillow data is not
"official government data" and Zillow does not endorse this site. See
`/methodology/`, `/privacy/`, and `/terms/`.
