/* tools/normalize-data.js
 * Shared normalization helpers for the data-ingestion pipeline. Used by
 * import-zillow.js and import-census.js so every importer produces records that
 * join cleanly on FIPS / USPS abbreviation regardless of how the source labels
 * a region.
 *
 * Design rules:
 *   - Prefer FIPS codes as the join key; fall back to USPS abbreviation.
 *   - Normalize region names (trim, collapse whitespace, strip " County" etc.
 *     only where asked) so Zillow / Census / HUD labels line up.
 *   - Never throw on a missing value — return null and let the site render an
 *     empty state.
 */
"use strict";

// 50 states + DC. name -> { abbr, fips }
const STATE_INDEX = {
  "Alabama": { abbr: "AL", fips: "01" }, "Alaska": { abbr: "AK", fips: "02" },
  "Arizona": { abbr: "AZ", fips: "04" }, "Arkansas": { abbr: "AR", fips: "05" },
  "California": { abbr: "CA", fips: "06" }, "Colorado": { abbr: "CO", fips: "08" },
  "Connecticut": { abbr: "CT", fips: "09" }, "Delaware": { abbr: "DE", fips: "10" },
  "District of Columbia": { abbr: "DC", fips: "11" }, "Florida": { abbr: "FL", fips: "12" },
  "Georgia": { abbr: "GA", fips: "13" }, "Hawaii": { abbr: "HI", fips: "15" },
  "Idaho": { abbr: "ID", fips: "16" }, "Illinois": { abbr: "IL", fips: "17" },
  "Indiana": { abbr: "IN", fips: "18" }, "Iowa": { abbr: "IA", fips: "19" },
  "Kansas": { abbr: "KS", fips: "20" }, "Kentucky": { abbr: "KY", fips: "21" },
  "Louisiana": { abbr: "LA", fips: "22" }, "Maine": { abbr: "ME", fips: "23" },
  "Maryland": { abbr: "MD", fips: "24" }, "Massachusetts": { abbr: "MA", fips: "25" },
  "Michigan": { abbr: "MI", fips: "26" }, "Minnesota": { abbr: "MN", fips: "27" },
  "Mississippi": { abbr: "MS", fips: "28" }, "Missouri": { abbr: "MO", fips: "29" },
  "Montana": { abbr: "MT", fips: "30" }, "Nebraska": { abbr: "NE", fips: "31" },
  "Nevada": { abbr: "NV", fips: "32" }, "New Hampshire": { abbr: "NH", fips: "33" },
  "New Jersey": { abbr: "NJ", fips: "34" }, "New Mexico": { abbr: "NM", fips: "35" },
  "New York": { abbr: "NY", fips: "36" }, "North Carolina": { abbr: "NC", fips: "37" },
  "North Dakota": { abbr: "ND", fips: "38" }, "Ohio": { abbr: "OH", fips: "39" },
  "Oklahoma": { abbr: "OK", fips: "40" }, "Oregon": { abbr: "OR", fips: "41" },
  "Pennsylvania": { abbr: "PA", fips: "42" }, "Rhode Island": { abbr: "RI", fips: "44" },
  "South Carolina": { abbr: "SC", fips: "45" }, "South Dakota": { abbr: "SD", fips: "46" },
  "Tennessee": { abbr: "TN", fips: "47" }, "Texas": { abbr: "TX", fips: "48" },
  "Utah": { abbr: "UT", fips: "49" }, "Vermont": { abbr: "VT", fips: "50" },
  "Virginia": { abbr: "VA", fips: "51" }, "Washington": { abbr: "WA", fips: "53" },
  "West Virginia": { abbr: "WV", fips: "54" }, "Wisconsin": { abbr: "WI", fips: "55" },
  "Wyoming": { abbr: "WY", fips: "56" }
};

function cleanName(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
}
function slugify(s) {
  return cleanName(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function stateMeta(name) {
  return STATE_INDEX[cleanName(name)] || null;
}
function abbrFromName(name) {
  const m = stateMeta(name);
  return m ? m.abbr : null;
}

// A tolerant CSV line splitter (handles simple quoted fields). Zillow research
// files are plain, but quoted commas appear in some region names.
function splitCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// Given a header row and a data row from a Zillow wide month file, return the
// latest non-empty monthly value and its YYYY-MM label.
function latestMonthValue(header, row) {
  for (let i = header.length - 1; i >= 0; i--) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(header[i])) {
      const v = num(row[i]);
      if (v != null) return { value: Math.round(v), date: header[i].slice(0, 7) };
    }
  }
  return { value: null, date: null };
}

module.exports = {
  STATE_INDEX, cleanName, slugify, stateMeta, abbrFromName,
  splitCsvLine, num, latestMonthValue
};
