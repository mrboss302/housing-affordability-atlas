#!/usr/bin/env node
/**
 * Housing Affordability Atlas — Zillow Research data refresher (adapted from Home Payment Atlas).
 *
 * Robust, dependency-free downloader that:
 *   1. Fetches the Zillow Research data page.
 *   2. Extracts current public CSV links (files.zillowstatic.com/research/public_csvs/).
 *   3. Classifies each dataset from its filename (not fragile page labels).
 *   4. Downloads the required state launch datasets + optional expansion datasets.
 *   5. Validates each CSV (expects RegionID / RegionName columns).
 *   6. Writes csv/zillow-manifest.json.
 *   7. Prints a clear report and exits non-zero only if REQUIRED data is missing.
 *
 * Why filename-based: Zillow occasionally changes download paths and updates data
 * ~the 16th of each month, so we never hard-code URLs — we discover them live.
 *
 * Offline/testing: set ZILLOW_PAGE_HTML=/path/to/saved.html to classify against a
 * saved copy of the page instead of hitting the network.
 *
 * Usage:
 *   node scripts/download-zillow-data.mjs
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const SOURCE_PAGE = "https://www.zillow.com/research/data/";
const PUBLIC_CSV_HOST = "files.zillowstatic.com/research/public_csvs/";
const USER_AGENT = "HousingAffordabilityAtlas/1.0 (+https://github.com/mrboss302/housing-affordability-atlas)";
const CSV_DIR = join(process.cwd(), "csv");
const MANIFEST_PATH = join(CSV_DIR, "zillow-manifest.json");
const FETCH_TIMEOUT_MS = 60_000;
const DOWNLOAD_RETRIES = 3;
const REQUEST_DELAY_MS = Number(process.env.ZILLOW_REQUEST_DELAY_MS || 500); // politeness gap between requests

// ---------------------------------------------------------------------------
// Run mode (controls which dataset groups are fetched):
//   --state-only  required state launch CSVs only        (small, ~a few MB)
//   --expansion   optional city/metro/ZORI/payment only  (large, ~600 MB)
//   --all         everything
// Default (no flag) is --state-only: the safe, CI-friendly choice that never
// pulls the large expansion datasets unless explicitly asked.
// ---------------------------------------------------------------------------
function parseMode(argv = process.argv.slice(2)) {
  if (argv.includes("--all")) return "all";
  if (argv.includes("--expansion")) return "expansion";
  if (argv.includes("--state-only")) return "state-only";
  return "state-only";
}
const MODE = parseMode();

// ---------------------------------------------------------------------------
// Classification — derived purely from the filename pattern.
// ---------------------------------------------------------------------------
function classify(filename) {
  const n = filename.toLowerCase();

  // geography = token before the first underscore
  const prefix = n.split("_")[0];
  const geography =
    { state: "state", city: "city", metro: "metro", county: "county", zip: "zip",
      neighborhood: "neighborhood", country: "national", us: "national",
      usa: "national", national: "national" }[prefix] || "unknown";

  // NOTE: "_" is a word char, so \b boundaries don't work around tokens like
  // "_zhvi_". Anchor on underscores / string ends instead.
  let metric = "unknown";
  if (/(^|_)zhvi(_|$)/.test(n)) metric = "ZHVI";
  else if (/(^|_)zori(_|$)/.test(n)) metric = "ZORI";
  else if (/total_monthly_payment|total_payment|totalmonthly/.test(n)) metric = "totalMonthlyPayment";
  else if (/mortgage_payment|mortgagepayment/.test(n)) metric = "mortgagePayment";
  else if (/(^|_)mlp(_|$)|median_list|mean_list|listing_price|list_price/.test(n)) metric = "listingPrice";
  else if (/median_sale|mean_sale|sale_price|sales_price/.test(n)) metric = "salePrice";
  else if (/(^|_)invt|inventory|for_sale/.test(n)) metric = "inventory";
  else if (/market_temp|market_heat|heat_index|(^|_)mht(_|$)/.test(n)) metric = "marketHeat";

  // housingType — check most specific tokens first
  let housingType = "unknown";
  if (/sfrcondomfr/.test(n)) housingType = "allHomes";
  else if (/sfrcondo/.test(n)) housingType = "sfrCondo";
  else if (/multifamily|_mfr_|_mfr\b/.test(n)) housingType = "multifamily";
  else if (/_sfr_|_sfr\b|singlefamily|single_family/.test(n)) housingType = "singleFamily";
  else if (/condo|coop/.test(n)) housingType = "condo";

  let tier = "unknown";
  if (/0\.33_0\.67/.test(n)) tier = "mid";
  else if (/0\.0_0\.33|0_0\.33/.test(n)) tier = "bottom";
  else if (/0\.67_1\.0|0\.67_1/.test(n)) tier = "top";

  let bedrooms = null;
  const bm = n.match(/bdrmcnt_(\d)/);
  if (bm) bedrooms = bm[1] === "5" ? "5plus" : bm[1];

  let smoothing = "unknown";
  if (/_sm_sa_/.test(n)) smoothing = "smoothedSeasonallyAdjusted";
  else if (/_sm_/.test(n)) smoothing = "smoothed";
  else if (/_month(\.csv)?$/.test(n) || /_week(\.csv)?$/.test(n)) smoothing = "raw";

  // downPayment — best-effort, payment datasets only
  let downPayment = null;
  const dp = n.match(/down[_-]?payment[_-]?0?\.?(\d{1,2})/) ||
             n.match(/_(20|10|5)(?:pct|_pct|down|_down)\b/) ||
             n.match(/(?:^|_)0?\.(20|10|05)(?:_|$)/);
  if (dp) {
    const v = parseInt(dp[1], 10);
    if ([20, 10, 5].includes(v)) downPayment = v;
    else if (v === 5 || dp[1] === "05") downPayment = 5;
  }

  return { geography, metric, housingType, tier, bedrooms, smoothing, downPayment };
}

// ---------------------------------------------------------------------------
// Dataset groups. Required = state launch data (fail if missing).
// Optional = city / metro / rent / payment expansion (warn if missing).
// ---------------------------------------------------------------------------
// Zillow geography prefix as it appears in filenames.
const GEO_PREFIX = { state: "State", city: "City", metro: "Metro", county: "County", zip: "Zip", neighborhood: "Neighborhood" };

// Canonical ZHVI filenames follow a stable token grammar. We generate the exact
// target filename for each spec; the URL is taken from a discovered link when
// present, otherwise DERIVED from the discovered ZHVI directory (robust to path
// changes since we never hard-code the directory).
function zhviSpecs(geography, group) {
  const G = GEO_PREFIX[geography];
  const mid = "tier_0.33_0.67";
  const f = {
    allMid: `${G}_zhvi_uc_sfrcondo_${mid}_sm_sa_month.csv`,
    allBottom: `${G}_zhvi_uc_sfrcondo_tier_0.0_0.33_sm_sa_month.csv`,
    allTop: `${G}_zhvi_uc_sfrcondo_tier_0.67_1.0_sm_sa_month.csv`,
    sfr: `${G}_zhvi_uc_sfr_${mid}_sm_sa_month.csv`,
    condo: `${G}_zhvi_uc_condo_${mid}_sm_sa_month.csv`,
    bed: (n) => `${G}_zhvi_bdrmcnt_${n}_uc_sfrcondo_${mid}_sm_sa_month.csv`,
  };
  const base = { geography, metric: "ZHVI", smoothing: "smoothedSeasonallyAdjusted" };
  const mk = (key, label, filename, extra) => ({ key, label, group, filename, match: { ...base, ...extra } });
  return [
    mk(`${geography}_zhvi_allhomes_mid`, "all homes / sfrcondo, mid-tier", f.allMid, { housingType: "sfrCondo", tier: "mid", bedrooms: null }),
    mk(`${geography}_zhvi_allhomes_bottom`, "all homes / sfrcondo, bottom-tier", f.allBottom, { housingType: "sfrCondo", tier: "bottom", bedrooms: null }),
    mk(`${geography}_zhvi_allhomes_top`, "all homes / sfrcondo, top-tier", f.allTop, { housingType: "sfrCondo", tier: "top", bedrooms: null }),
    mk(`${geography}_zhvi_sfr_mid`, "single-family, mid-tier", f.sfr, { housingType: "singleFamily", tier: "mid", bedrooms: null }),
    mk(`${geography}_zhvi_condo_mid`, "condo/co-op, mid-tier", f.condo, { housingType: "condo", tier: "mid", bedrooms: null }),
    mk(`${geography}_zhvi_1bed_mid`, "1-bedroom, mid-tier", f.bed(1), { housingType: "sfrCondo", tier: "mid", bedrooms: "1" }),
    mk(`${geography}_zhvi_2bed_mid`, "2-bedroom, mid-tier", f.bed(2), { housingType: "sfrCondo", tier: "mid", bedrooms: "2" }),
    mk(`${geography}_zhvi_3bed_mid`, "3-bedroom, mid-tier", f.bed(3), { housingType: "sfrCondo", tier: "mid", bedrooms: "3" }),
    mk(`${geography}_zhvi_4bed_mid`, "4-bedroom, mid-tier", f.bed(4), { housingType: "sfrCondo", tier: "mid", bedrooms: "4" }),
    mk(`${geography}_zhvi_5bed_mid`, "5+ bedroom, mid-tier", f.bed(5), { housingType: "sfrCondo", tier: "mid", bedrooms: "5plus" }),
  ];
}

const REQUIRED_GROUPS = {
  stateLaunch: { label: "State-level launch ZHVI", required: true, specs: zhviSpecs("state", "stateLaunch") },
};

const OPTIONAL_GROUPS = {
  cityZhvi: { label: "City ZHVI", type: "specs", specs: zhviSpecs("city", "cityZhvi") },
  metroZhvi: { label: "Metro ZHVI", type: "specs", specs: zhviSpecs("metro", "metroZhvi") },
  // Rent + payment are "collect everything that matches" groups: we don't know the
  // exact filename tokens in advance, so we gather all classified matches.
  rentZori: {
    label: "Rent / ZORI",
    type: "collect",
    predicate: (c) => c.metric === "ZORI" && ["city", "metro", "county", "zip"].includes(c.geography),
    // From each discovered ZORI link, derive the preferred housing-type and
    // seasonally-adjusted variants by token-swapping the filename.
    derive: (discovered) => {
      const out = [];
      for (const d of discovered) {
        if (d.cls.metric !== "ZORI") continue;
        const f = d.filename;
        const variants = [
          f.replace(/_sm_month\.csv$/, "_sm_sa_month.csv"), // seasonally adjusted
          f.replace(/uc_sfrcondomfr/, "uc_sfr"),            // single-family rent
          f.replace(/uc_sfrcondomfr/, "uc_mfr"),            // multi-family rent
        ];
        for (const v of variants) if (v !== f) out.push({ filename: v, metric: "ZORI" });
      }
      return out;
    },
    expect: [
      { key: "city_zori", label: "City ZORI", test: (c) => c.metric === "ZORI" && c.geography === "city" },
      { key: "metro_zori", label: "Metro ZORI", test: (c) => c.metric === "ZORI" && c.geography === "metro" },
      { key: "county_zori", label: "County ZORI", test: (c) => c.metric === "ZORI" && c.geography === "county" },
      { key: "zip_zori", label: "ZIP ZORI", test: (c) => c.metric === "ZORI" && c.geography === "zip" },
    ],
  },
  payment: {
    label: "Zillow payment datasets",
    type: "collect",
    predicate: (c) => ["mortgagePayment", "totalMonthlyPayment"].includes(c.metric),
    // Zillow ships payment datasets alongside the "new homeowner income needed"
    // file. Use any discovered downpayment-tagged link as a template to derive
    // mortgage-payment and total-monthly-payment files at 20/10/5% down, in the
    // same directory (robust to path changes).
    derive: (discovered) => {
      const tmpl = discovered.find((d) => /downpayment/i.test(d.filename));
      if (!tmpl) return [];
      const dir = tmpl.url.split("?")[0].replace(/[^/]+$/, "");
      const out = [];
      for (const [token, metric] of [["mortgage_payment", "mortgagePayment"], ["total_monthly_payment", "totalMonthlyPayment"]]) {
        for (const dp of ["0.20", "0.10", "0.05"]) {
          const filename = tmpl.filename
            .replace(/new_homeowner_[a-z_]+?_downpayment/i, `new_homeowner_${token}_downpayment`)
            .replace(/downpayment_0\.\d{2}/i, `downpayment_${dp}`);
          out.push({ filename, metric, url: dir + filename });
        }
      }
      return out;
    },
    expect: [
      { key: "mortgage_20", label: "Mortgage Payment 20% down", test: (c) => c.metric === "mortgagePayment" && c.downPayment === 20 },
      { key: "mortgage_10", label: "Mortgage Payment 10% down", test: (c) => c.metric === "mortgagePayment" && c.downPayment === 10 },
      { key: "mortgage_5", label: "Mortgage Payment 5% down", test: (c) => c.metric === "mortgagePayment" && c.downPayment === 5 },
      { key: "total_20", label: "Total Monthly Payment 20% down", test: (c) => c.metric === "totalMonthlyPayment" && c.downPayment === 20 },
      { key: "total_10", label: "Total Monthly Payment 10% down", test: (c) => c.metric === "totalMonthlyPayment" && c.downPayment === 10 },
      { key: "total_5", label: "Total Monthly Payment 5% down", test: (c) => c.metric === "totalMonthlyPayment" && c.downPayment === 5 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function fetchText(url, { asLog = "" } = {}) {
  for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/csv,*/*" },
        signal: ctrl.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      if (attempt === DOWNLOAD_RETRIES) throw err;
      const wait = attempt * 1500;
      console.warn(`  retry ${attempt}/${DOWNLOAD_RETRIES - 1} for ${asLog || url}: ${err.message} (waiting ${wait}ms)`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// Pull every public CSV URL out of the raw page source, wherever it lives
// (anchor href, option data-url, or inline JSON). This is the robust core.
function extractCsvLinks(html) {
  const re = /https?:\/\/files\.zillowstatic\.com\/research\/public_csvs\/[^\s"'<>\\)]+?\.csv(?:\?[^\s"'<>\\)]*)?/gi;
  const found = html.match(re) || [];
  const byFilename = new Map(); // clean filename -> url (dedup)
  for (const raw of found) {
    const url = raw.replace(/&amp;/g, "&");
    const clean = basename(url.split("?")[0]);
    if (!clean.toLowerCase().endsWith(".csv")) continue;
    if (!byFilename.has(clean)) byFilename.set(clean, url);
  }
  return [...byFilename.entries()].map(([filename, url]) => ({ filename, url }));
}

function validateCsv(text) {
  const firstLine = (text.split(/\r?\n/, 1)[0] || "").trim();
  const hasRegionId = /(^|,)"?RegionID"?(,|$)/i.test(firstLine);
  const hasRegionName = /(^|,)"?RegionName"?(,|$)/i.test(firstLine);
  return { ok: hasRegionId && hasRegionName, header: firstLine };
}

// Latest YYYY-MM month present in a CSV header (last date column).
function latestMonthFromCsv(path) {
  try {
    const header = readFileSync(path, "utf8").split(/\r?\n/, 1)[0] || "";
    const dates = header.split(",").filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.trim()));
    if (!dates.length) return null;
    return dates[dates.length - 1].slice(0, 7);
  } catch {
    return null;
  }
}

// Directory part of a discovered CSV URL (path changes are absorbed here).
function urlDir(url) {
  const clean = url.split("?")[0];
  return clean.slice(0, clean.lastIndexOf("/") + 1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Try to GET a CSV; returns { ok, text } or { ok:false, reason }. A 404 is a
// normal "not available" signal (derived/optional URLs) and is NOT retried.
// Transient failures (network errors, 429, 5xx) ARE retried with backoff so the
// CDN throttling we can hit mid-run doesn't produce false "missing" results.
async function probeDownload(url, filename) {
  let lastReason = "unknown";
  for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/csv,*/*" },
        signal: ctrl.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      if (res.status === 404) return { ok: false, reason: "not found (404)" };
      if (res.status === 429 || res.status >= 500) {
        lastReason = `HTTP ${res.status}`;
        if (attempt < DOWNLOAD_RETRIES) { await sleep(attempt * 2500); continue; }
        return { ok: false, reason: lastReason };
      }
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      const text = await res.text();
      const v = validateCsv(text);
      if (!v.ok) return { ok: false, reason: `unexpected columns: "${v.header.slice(0, 60)}"` };
      return { ok: true, text };
    } catch (err) {
      clearTimeout(timer);
      lastReason = err.message;
      if (attempt < DOWNLOAD_RETRIES) { await sleep(attempt * 2500); continue; }
      return { ok: false, reason: lastReason };
    }
  }
  return { ok: false, reason: lastReason };
}

function writeCsv(filename, text) {
  writeFileSync(join(CSV_DIR, filename), text);
}

function existingValidOnDisk(filename) {
  const p = join(CSV_DIR, filename);
  if (!existsSync(p) || statSync(p).size === 0) return false;
  return validateCsv(readFileSync(p, "utf8")).ok;
}

// Resolve a target filename to a URL: prefer a directly-discovered link, else
// derive it from the discovered directory for that metric.
function resolveUrl(filename, discoveredByName, metricDirs, metric) {
  const direct = discoveredByName.get(filename);
  if (direct) return { url: direct, derived: false };
  const dir = metricDirs[metric];
  if (dir) return { url: dir + filename, derived: true };
  return { url: null, derived: false };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  mkdirSync(CSV_DIR, { recursive: true });
  const warnings = [];
  const manifestFiles = [];

  console.log(`Zillow data refresh — fetching ${SOURCE_PAGE}`);

  // 1. Get the page (or a saved copy for offline testing).
  let html = "";
  let pageOk = true;
  try {
    if (process.env.ZILLOW_PAGE_HTML) {
      html = readFileSync(process.env.ZILLOW_PAGE_HTML, "utf8");
      console.log(`  using local page source: ${process.env.ZILLOW_PAGE_HTML}`);
    } else {
      html = await fetchText(SOURCE_PAGE, { asLog: "research data page" });
    }
  } catch (err) {
    pageOk = false;
    warnings.push(`Could not fetch the Zillow research page: ${err.message}`);
    console.warn(`  ! page fetch failed: ${err.message}`);
  }

  // 2. Extract + classify links, then index by filename and by metric directory.
  const links = pageOk ? extractCsvLinks(html) : [];
  const discovered = links.map((l) => ({ ...l, cls: classify(l.filename) }));
  console.log(`  discovered ${discovered.length} unique public CSV links`);

  const discoveredByName = new Map(discovered.map((d) => [d.filename, d.url]));
  // metric -> directory URL (e.g. ".../public_csvs/zhvi/"), from discovered links.
  const metricDirs = {};
  for (const d of discovered) {
    if (d.cls.metric !== "unknown" && !metricDirs[d.cls.metric]) metricDirs[d.cls.metric] = urlDir(d.url);
  }

  const downloadedNames = new Set();
  // Resolve a spec's exact filename to a URL (discovered or derived), probe it,
  // and write it. Returns "downloaded" | "reused" | "missing".
  async function fetchTarget(filename, metric, { group, required, allowReuse = false, url: urlOverride = null, diskOnly = false } = {}) {
    if (downloadedNames.has(filename)) return "downloaded";
    // diskOnly: never touch the network — record an existing valid copy if present.
    if (diskOnly) {
      if (existingValidOnDisk(filename)) {
        manifestFiles.push(makeFileRecordResolved(filename, null, required, group));
        return "reused";
      }
      return "missing";
    }
    const { url, derived } = urlOverride
      ? { url: urlOverride, derived: !discoveredByName.has(filename) }
      : resolveUrl(filename, discoveredByName, metricDirs, metric);
    if (url && pageOk) {
      if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
      const r = await probeDownload(url, filename);
      if (r.ok) {
        writeCsv(filename, r.text);
        downloadedNames.add(filename);
        manifestFiles.push(makeFileRecordResolved(filename, url, required, group));
        console.log(`  [${group}${derived ? " derived" : ""}] ${filename}`);
        return "downloaded";
      }
      if (allowReuse && existingValidOnDisk(filename)) {
        manifestFiles.push(makeFileRecordResolved(filename, null, required, group));
        console.warn(`  ~ ${filename}: reused on-disk copy (${r.reason})`);
        return "reused";
      }
      return "missing";
    }
    // No URL (metric dir undiscovered) or page down — fall back to disk if allowed.
    if (allowReuse && existingValidOnDisk(filename)) {
      manifestFiles.push(makeFileRecordResolved(filename, null, required, group));
      console.warn(`  ~ ${filename}: reused on-disk copy (no live URL)`);
      return "reused";
    }
    return "missing";
  }

  // Which groups this run will fetch (see MODE).
  const doRequiredDownload = MODE !== "expansion"; // expansion reuses state from disk
  const doOptional = MODE !== "state-only";
  console.log(`  mode: ${MODE} (required: ${doRequiredDownload ? "download" : "reuse-from-disk"}, expansion: ${doOptional ? "yes" : "skipped"})`);

  // 3. Required groups (state launch). Reuse on-disk copies if a refresh fails,
  // so a transient Zillow hiccup never blocks the build when data already exists.
  const requiredGroups = {};
  let requiredFound = 0;
  let requiredMissing = 0;
  for (const [gname, group] of Object.entries(REQUIRED_GROUPS)) {
    const res = { label: group.label, required: true, total: group.specs.length, found: 0, missing: 0, files: [], missingItems: [] };
    for (const spec of group.specs) {
      const outcome = await fetchTarget(spec.filename, "ZHVI", {
        group: gname, required: true,
        allowReuse: true, diskOnly: !doRequiredDownload,
      });
      if (outcome === "missing") {
        res.missing++; requiredMissing++;
        res.missingItems.push(spec.label);
        console.warn(`  ! required missing: ${spec.label} (${spec.filename})`);
      } else {
        res.found++; requiredFound++;
        res.files.push(spec.filename);
        if (outcome === "reused") res.reusedOnDisk = (res.reusedOnDisk || 0) + 1;
      }
    }
    requiredGroups[gname] = res;
  }

  // 4. Optional groups — never fail; log what's missing. Skipped in state-only mode.
  const optionalGroups = {};
  let optionalFound = 0;
  let optionalMissing = 0;
  for (const [gname, group] of Object.entries(OPTIONAL_GROUPS)) {
    const res = { label: group.label, required: false, found: 0, missing: 0, files: [], foundItems: [], missingItems: [] };

    if (!doOptional) {
      res.skipped = true;
      optionalGroups[gname] = res;
      continue;
    }

    if (group.type === "specs") {
      res.total = group.specs.length;
      for (const spec of group.specs) {
        const outcome = await fetchTarget(spec.filename, "ZHVI", { group: gname, required: false });
        if (outcome === "missing") {
          res.missing++; optionalMissing++;
          res.missingItems.push(spec.label);
        } else {
          res.found++; optionalFound++;
          res.files.push(spec.filename);
          res.foundItems.push(spec.label);
        }
      }
    } else if (group.type === "collect") {
      // Start from directly-discovered matches, then add derived candidates.
      const targets = new Map(); // filename -> { metric, url|null }
      for (const d of discovered) {
        if (group.predicate(d.cls)) targets.set(d.filename, { metric: d.cls.metric, url: d.url });
      }
      if (group.derive) {
        for (const t of group.derive(discovered, metricDirs)) {
          if (!targets.has(t.filename)) targets.set(t.filename, { metric: t.metric, url: t.url || null });
        }
      }
      res.total = targets.size;
      for (const [filename, t] of targets) {
        const outcome = await fetchTarget(filename, t.metric, { group: gname, required: false, url: t.url });
        if (outcome === "missing") {
          res.missing++; optionalMissing++;
        } else {
          res.found++; optionalFound++;
          res.files.push(filename);
        }
      }
      // Report hoped-for sub-items against what we actually downloaded.
      const downloadedCls = res.files.map((f) => classify(f));
      for (const item of group.expect) {
        const present = downloadedCls.some((c) => item.test(c));
        (present ? res.foundItems : res.missingItems).push(item.label);
        if (!present) warnings.push(`${item.label} was not found.`);
      }
    }
    optionalGroups[gname] = res;
  }

  // 5. Manifest.
  manifestFiles.sort((a, b) => a.filename.localeCompare(b.filename));
  const manifest = {
    generatedAt: new Date().toISOString(),
    sourcePage: SOURCE_PAGE,
    mode: MODE,
    discoveredLinkCount: discovered.length,
    requiredGroups,
    optionalGroups,
    files: manifestFiles,
    summary: {
      mode: MODE,
      downloaded: manifestFiles.length,
      discovered: discovered.length,
      requiredFound,
      requiredMissing,
      optionalFound,
      optionalMissing,
    },
    warnings,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");

  // 6. Report.
  const latestMonth = detectLatestRequiredMonth(requiredGroups.stateLaunch);
  printReport({ discovered, requiredGroups, optionalGroups, warnings, latestMonth, requiredMissing });

  // 7. Exit code — non-zero ONLY when required data is missing.
  if (requiredMissing > 0) {
    console.error(`\nFinal status: FAILED — ${requiredMissing} required dataset(s) missing.`);
    process.exit(1);
  }
  console.log(`\nFinal status: OK`);
}

// Manifest record from a resolved filename (url is null when reused from disk).
function makeFileRecordResolved(filename, url, required, group) {
  const c = classify(filename);
  return {
    filename,
    url: url || null,
    localPath: `csv/${filename}`,
    geography: c.geography,
    metric: c.metric,
    housingType: c.housingType,
    tier: c.tier,
    bedrooms: c.bedrooms,
    smoothing: c.smoothing,
    downPayment: c.downPayment,
    required,
    group,
  };
}

function detectLatestRequiredMonth(stateGroup) {
  if (!stateGroup || !stateGroup.files || !stateGroup.files.length) return null;
  let latest = null;
  for (const f of stateGroup.files) {
    const m = latestMonthFromCsv(join(CSV_DIR, f));
    if (m && (!latest || m > latest)) latest = m;
  }
  return latest;
}

function printReport({ discovered, requiredGroups, optionalGroups, warnings, latestMonth, requiredMissing }) {
  const reqDl = requiredGroups.stateLaunch.found;
  const reqMiss = requiredGroups.stateLaunch.missingItems || [];
  const city = optionalGroups.cityZhvi;
  const metro = optionalGroups.metroZhvi;
  const zori = optionalGroups.rentZori;
  const pay = optionalGroups.payment;

  const optVal = (g) => (g && g.skipped ? "skipped (state-only mode)" : `${g ? g.found : 0}`);

  const lines = [];
  lines.push("\n──────────────────────────────────────────────");
  lines.push("Zillow data refresh complete.");
  lines.push(`Mode: ${MODE}`);
  lines.push("");
  lines.push("Discovered:");
  lines.push(`- ${discovered.length} CSV links`);
  lines.push("");
  lines.push("Downloaded:");
  lines.push(`- ${reqDl} required state ZHVI files`);
  lines.push(`- ${optVal(city)} city ZHVI files`);
  lines.push(`- ${optVal(metro)} metro ZHVI files`);
  lines.push(`- ${optVal(zori)} ZORI rent files`);
  lines.push(`- ${optVal(pay)} payment files`);

  const allWarn = [
    ...reqMiss.map((m) => `Required missing: ${m}`),
    ...(zori.missingItems || []).map((m) => `${m} was not found`),
    ...(pay.missingItems || []).map((m) => `${m} was not found`),
    ...(city.missingItems || []).map((m) => `City: ${m} was not found`),
    ...(metro.missingItems || []).map((m) => `Metro: ${m} was not found`),
  ];
  if (allWarn.length) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of allWarn.slice(0, 40)) lines.push(`- ${w}`);
    if (allWarn.length > 40) lines.push(`- …and ${allWarn.length - 40} more`);
  }

  lines.push("");
  lines.push("Latest required data month:");
  lines.push(`- ${latestMonth || "unknown"}`);
  lines.push("──────────────────────────────────────────────");
  console.log(lines.join("\n"));
}

// --classify-test: verify the classifier against known filenames (no network).
function classifyTest() {
  const cases = [
    "State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    "State_zhvi_uc_sfrcondo_tier_0.0_0.33_sm_sa_month.csv",
    "State_zhvi_uc_sfrcondo_tier_0.67_1.0_sm_sa_month.csv",
    "State_zhvi_uc_sfr_tier_0.33_0.67_sm_sa_month.csv",
    "State_zhvi_uc_condo_tier_0.33_0.67_sm_sa_month.csv",
    "State_zhvi_bdrmcnt_1_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    "State_zhvi_bdrmcnt_5_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    "City_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    "Metro_zhvi_uc_sfr_tier_0.33_0.67_sm_sa_month.csv",
    "Metro_zori_uc_sfrcondomfr_sm_sa_month.csv",
    "Metro_zori_uc_sfrcondomfr_sm_month.csv",
    "Zip_zori_uc_sfrcondomfr_sm_month.csv",
    "City_zori_uc_sfr_sm_month.csv",
    "County_zori_uc_mfr_sm_month.csv",
    "Metro_invt_fs_uc_sfrcondo_sm_month.csv",
    "Metro_mlp_uc_sfrcondo_sm_month.csv",
    "Metro_median_sale_price_uc_sfrcondo_month.csv",
    "Metro_new_homeowner_mortgage_payment_downpayment_0.20_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    "Metro_total_monthly_payment_downpayment_0.05_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
  ];
  for (const f of cases) {
    const c = classify(f);
    console.log(
      f.padEnd(72),
      `geo=${c.geography} metric=${c.metric} type=${c.housingType} tier=${c.tier} bed=${c.bedrooms} smooth=${c.smoothing} dp=${c.downPayment}`
    );
  }
}

if (process.argv.includes("--classify-test")) {
  classifyTest();
} else {
  main().catch((err) => {
    console.error("Fatal error in download-zillow-data:", err);
    process.exit(1);
  });
}
