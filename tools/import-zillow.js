/* tools/import-zillow.js
 * Imports Zillow Research state-level datasets into assets/data/market-data.js.
 *
 * SOURCE: Zillow Research public data — https://www.zillow.com/research/data/
 *   ZHVI (Zillow Home Value Index): mid-tier, bottom-tier, top-tier, and by
 *   bedroom count. ZORI (Zillow Observed Rent Index).
 *   We use only aggregate research datasets — never listings, photos, or
 *   individual property details.
 *
 * USAGE:
 *   ZILLOW_CSV_DIR=/path/to/zillow/csv node tools/import-zillow.js
 *   (defaults to the Home Payment Atlas csv folder if present)
 *
 * The importer is resilient: any dataset that is missing is simply skipped and
 * its fields are left null, so the site still builds.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const N = require("./normalize-data");

const ROOT = path.resolve(__dirname, "..");
const CSV_DIR = process.env.ZILLOW_CSV_DIR ||
  path.resolve(ROOT, "../../Downloads/Mortgage Calculator/csv");

// Map of logical field -> Zillow state filename.
const FILES = {
  zhviMid: "State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
  zhviBottom: "State_zhvi_uc_sfrcondo_tier_0.0_0.33_sm_sa_month.csv",
  zhviTop: "State_zhvi_uc_sfrcondo_tier_0.67_1.0_sm_sa_month.csv",
  zhviBed2: "State_zhvi_bdrmcnt_2_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
  zhviBed3: "State_zhvi_bdrmcnt_3_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
  zhviBed4: "State_zhvi_bdrmcnt_4_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
};
// Zillow publishes ZORI at city/county/metro level but not state level, so we
// derive a state rent index as the MEDIAN of city-level ZORI within each state.
// This is a transparent derived signal, clearly labeled on the site.
const CITY_ZORI_FILE = "City_zori_uc_sfrcondomfr_sm_sa_month.csv";

function median(arr) {
  const a = arr.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

function deriveStateRent() {
  const full = path.join(CSV_DIR, CITY_ZORI_FILE);
  if (!fs.existsSync(full)) return { values: {}, vintage: null };
  const lines = fs.readFileSync(full, "utf8").split(/\r?\n/).filter(Boolean);
  const header = N.splitCsvLine(lines[0]);
  const stateIdx = header.indexOf("State");
  const byState = {};
  let vintage = null;
  for (let i = 1; i < lines.length; i++) {
    const row = N.splitCsvLine(lines[i]);
    const abbr = (row[stateIdx] || "").trim();
    if (!abbr) continue;
    const lm = N.latestMonthValue(header, row);
    if (lm.value == null) continue;
    (byState[abbr] = byState[abbr] || []).push(lm.value);
    if (lm.date) vintage = lm.date;
  }
  const values = {};
  Object.keys(byState).forEach((a) => { values[a] = median(byState[a]); });
  return { values, vintage };
}

function readStateFile(file) {
  const full = path.join(CSV_DIR, file);
  if (!fs.existsSync(full)) return null;
  const lines = fs.readFileSync(full, "utf8").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return null;
  const header = N.splitCsvLine(lines[0]);
  const nameIdx = header.indexOf("RegionName");
  const out = {};
  let vintage = null;
  for (let i = 1; i < lines.length; i++) {
    const row = N.splitCsvLine(lines[i]);
    const meta = N.stateMeta(row[nameIdx]);
    if (!meta) continue; // skips "United States" / territories not in our index
    const lm = N.latestMonthValue(header, row);
    out[meta.abbr] = lm.value;
    if (lm.date) vintage = lm.date;
  }
  return { values: out, vintage };
}

function run() {
  const exists = fs.existsSync(CSV_DIR);
  if (!exists) {
    console.warn("[import-zillow] CSV dir not found: " + CSV_DIR +
      "\n  Set ZILLOW_CSV_DIR or download from https://www.zillow.com/research/data/");
  }

  const loaded = {};
  let vintage = null;
  let foundCount = 0;
  Object.keys(FILES).forEach((key) => {
    const res = exists ? readStateFile(FILES[key]) : null;
    if (res) { loaded[key] = res.values; vintage = res.vintage || vintage; foundCount++; }
    else loaded[key] = {};
  });
  // Derived state rent index (median of city ZORI within each state).
  const rentRes = exists ? deriveStateRent() : { values: {}, vintage: null };
  loaded.zori = rentRes.values;
  if (Object.keys(rentRes.values).length) { foundCount++; vintage = rentRes.vintage || vintage; }

  // Build one record per state from normalize-data's canonical index.
  const records = Object.keys(N.STATE_INDEX).map((name) => {
    const meta = N.STATE_INDEX[name];
    const a = meta.abbr;
    const pick = (k) => (loaded[k] && loaded[k][a] != null ? loaded[k][a] : null);
    return {
      abbr: a, fips: meta.fips, name: name, slug: N.slugify(name),
      zhvi: {
        bottom: pick("zhviBottom"),
        mid: pick("zhviMid"),
        top: pick("zhviTop"),
        bed2: pick("zhviBed2"),
        bed3: pick("zhviBed3"),
        bed4: pick("zhviBed4")
      },
      zori: pick("zori"),
      // Market-signal fields are not in the ZHVI/ZORI research files. They stay
      // null until an inventory/price-cut/days-to-pending/heat dataset is added,
      // so the UI shows an honest "data pending" state rather than fabrications.
      marketSignals: {
        forSaleInventory: null,
        medianListPrice: null,
        priceCutShare: null,
        daysToPending: null,
        marketHeatIndex: null
      }
    };
  });

  const banner = "/* market-data.js — AUTO-GENERATED by tools/import-zillow.js. Do not edit by hand.\n" +
    "   Home values (ZHVI) and rent (ZORI) are from Zillow Research aggregate datasets\n" +
    "   (https://www.zillow.com/research/data/). Data vintage: " + (vintage || "unknown") + ".\n" +
    "   Market-signal fields (inventory, price cuts, days to pending, market heat) are\n" +
    "   null until those datasets are imported. Re-run the importer to refresh. */\n";
  const out = banner +
    "window.HAM_MARKET = " + JSON.stringify({
      vintage: vintage,
      source: "Zillow Research (ZHVI, ZORI)",
      sourceUrl: "https://www.zillow.com/research/data/",
      rentNote: "State rent is the median of Zillow city-level ZORI within each state (derived).",
      regions: records
    }) + ";\n";

  const dest = path.join(ROOT, "assets/data/market-data.js");
  fs.writeFileSync(dest, out);
  const withMid = records.filter((r) => r.zhvi.mid != null).length;
  const withRent = records.filter((r) => r.zori != null).length;
  console.log("[import-zillow] datasets found: " + foundCount + "/" + (Object.keys(FILES).length + 1) +
    ", vintage " + (vintage || "n/a"));
  console.log("[import-zillow] wrote " + dest + " — " + records.length + " states (" +
    withMid + " with ZHVI mid, " + withRent + " with ZORI rent).");
}

run();
