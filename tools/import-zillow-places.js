/* tools/import-zillow-places.js
 * Imports Zillow Research CITY (place) and COUNTY datasets for the curated
 * registry in assets/data/places-sample.js, writing assets/data/market-places.js.
 *
 * SOURCE: Zillow Research aggregate datasets (https://www.zillow.com/research/data/).
 *   City ZHVI: mid / bottom / top tier + 2/3/4-bedroom. City ZORI rent.
 *   County ZORI rent (no county ZHVI is published in these files).
 *   Aggregate research data only — never listings or individual properties.
 *
 * Large files are streamed line-by-line. Only registry targets are kept.
 *
 * USAGE:
 *   ZILLOW_CSV_DIR=/path/to/zillow/csv node tools/import-zillow-places.js
 *   (defaults to the Home Payment Atlas csv folder if present)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const N = require("./normalize-data");

const ROOT = path.resolve(__dirname, "..");
const CSV_DIR = process.env.ZILLOW_CSV_DIR ||
  path.resolve(ROOT, "../../Downloads/Mortgage Calculator/csv");

const CITY_FILES = {
  mid: "City_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
  bottom: "City_zhvi_uc_sfrcondo_tier_0.0_0.33_sm_sa_month.csv",
  top: "City_zhvi_uc_sfrcondo_tier_0.67_1.0_sm_sa_month.csv",
  bed2: "City_zhvi_bdrmcnt_2_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
  bed3: "City_zhvi_bdrmcnt_3_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
  bed4: "City_zhvi_bdrmcnt_4_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
  zori: "City_zori_uc_sfrcondomfr_sm_sa_month.csv"
};
const COUNTY_ZORI = "County_zori_uc_sfrcondomfr_sm_sa_month.csv";

// Load the registry to know which cities/counties to extract.
global.window = {};
eval(fs.readFileSync(path.join(ROOT, "assets/data/places-sample.js"), "utf8"));
const REG = global.window.HAM_PLACES;
const cities = REG.filter((p) => p.type === "city");
const counties = REG.filter((p) => p.type === "county");

// key: "city|state" (lowercased) -> slug
const cityKey = {};
cities.forEach((p) => { cityKey[(p.zillow + "|" + p.stateAbbr).toLowerCase()] = p.slug; });
const countyByFips = {};
counties.forEach((p) => { countyByFips[p.fips] = p.slug; });

function streamMatch(file, onRow) {
  return new Promise((resolve) => {
    const full = path.join(CSV_DIR, file);
    if (!fs.existsSync(full)) { console.warn("[zillow-places] missing: " + file); resolve(null); return; }
    const rl = readline.createInterface({ input: fs.createReadStream(full), crlfDelay: Infinity });
    let header = null, vintage = null;
    rl.on("line", (line) => {
      const row = N.splitCsvLine(line);
      if (!header) { header = row; return; }
      const v = onRow(header, row);
      if (v && v.date) vintage = v.date;
    });
    rl.on("close", () => resolve(vintage));
  });
}

async function run() {
  if (!fs.existsSync(CSV_DIR)) {
    console.warn("[zillow-places] CSV dir not found: " + CSV_DIR + " — writing empty dataset.");
  }
  const data = {}; // slug -> { zhvi:{}, zori }
  cities.forEach((p) => (data[p.slug] = { zhvi: {}, zori: null }));
  let vintage = null;

  // City ZHVI tiers + bedrooms
  for (const field of ["mid", "bottom", "top", "bed2", "bed3", "bed4"]) {
    const v = await streamMatch(CITY_FILES[field], (header, row) => {
      const name = row[2], state = row[5];
      const slug = cityKey[((name || "") + "|" + (state || "")).toLowerCase()];
      if (!slug) return null;
      const lm = N.latestMonthValue(header, row);
      if (lm.value != null && data[slug].zhvi[field] == null) data[slug].zhvi[field] = lm.value;
      return lm;
    });
    vintage = v || vintage;
  }

  // City ZORI rent
  {
    const v = await streamMatch(CITY_FILES.zori, (header, row) => {
      const name = row[2], state = row[5];
      const slug = cityKey[((name || "") + "|" + (state || "")).toLowerCase()];
      if (!slug) return null;
      const lm = N.latestMonthValue(header, row);
      if (lm.value != null) data[slug].zori = lm.value;
      return lm;
    });
    vintage = v || vintage;
  }

  // County ZORI rent (by FIPS = StateCodeFIPS + MunicipalCodeFIPS)
  const countyData = {};
  counties.forEach((p) => (countyData[p.slug] = { zhvi: { mid: null }, zori: null }));
  {
    const v = await streamMatch(COUNTY_ZORI, (header, row) => {
      const scIdx = header.indexOf("StateCodeFIPS");
      const mcIdx = header.indexOf("MunicipalCodeFIPS");
      if (scIdx < 0 || mcIdx < 0) return null;
      const fips = (row[scIdx] || "").padStart(2, "0") + (row[mcIdx] || "").padStart(3, "0");
      const slug = countyByFips[fips];
      if (!slug) return null;
      const lm = N.latestMonthValue(header, row);
      if (lm.value != null) countyData[slug].zori = lm.value;
      return lm;
    });
    vintage = v || vintage;
  }

  const regions = [];
  cities.forEach((p) => regions.push({
    slug: p.slug, name: p.name, stateAbbr: p.stateAbbr, type: "city",
    fips: p.fips, zhvi: data[p.slug].zhvi, zori: data[p.slug].zori
  }));
  counties.forEach((p) => regions.push({
    slug: p.slug, name: p.name, stateAbbr: p.stateAbbr, type: "county",
    fips: p.fips, zhvi: { mid: null }, zori: countyData[p.slug].zori
  }));

  const banner = "/* market-places.js — AUTO-GENERATED by tools/import-zillow-places.js. Do not edit by hand.\n" +
    "   City home values (ZHVI) & rent (ZORI) and county rent (ZORI) from Zillow Research\n" +
    "   (https://www.zillow.com/research/data/). County home values are not published in these\n" +
    "   datasets, so county zhvi is null. Data vintage: " + (vintage || "unknown") + ". */\n";
  const dest = path.join(ROOT, "assets/data/market-places.js");
  fs.writeFileSync(dest, banner + "window.HAM_MARKET_PLACES = " + JSON.stringify({
    vintage: vintage, source: "Zillow Research (City/County ZHVI, ZORI)",
    sourceUrl: "https://www.zillow.com/research/data/", regions: regions
  }) + ";\n");

  const cityMid = regions.filter((r) => r.type === "city" && r.zhvi.mid != null).length;
  const cityRent = regions.filter((r) => r.type === "city" && r.zori != null).length;
  console.log("[zillow-places] vintage " + (vintage || "n/a") +
    " — " + cities.length + " cities (" + cityMid + " with ZHVI, " + cityRent + " with rent), " +
    counties.length + " counties.");
  // Report any city we could not match (helps prune the registry).
  regions.filter((r) => r.type === "city" && r.zhvi.mid == null)
    .forEach((r) => console.warn("  [no ZHVI match] " + r.name + ", " + r.stateAbbr));
}

run();
