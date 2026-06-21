/* source-metadata.js
 * Single source of truth for data provenance and attribution. Drives the
 * "Sources & data vintage" notes shown across the site and the launch checklist.
 *
 * status values:
 *   "real"        verified dataset wired in
 *   "derived"     computed from a real dataset (transparent transformation)
 *   "illustrative" placeholder estimate, clearly labeled, pending a real source
 *   "pending"     field exists in the schema but no data imported yet
 *
 * Exposes window.HAM_SOURCES.
 */
(function (w) {
  "use strict";

  var M = (w.HAM_MARKET || {});
  var C = (w.HAM_CENSUS || null);

  var SOURCES = {
    // Where each displayed field comes from
    fields: {
      homeValue: {
        label: "Home values (ZHVI: starter, mid, by bedroom)",
        source: "Zillow Research",
        sourceUrl: "https://www.zillow.com/research/data/",
        vintage: M.vintage || null,
        status: (M.regions && M.regions.length) ? "real" : "pending"
      },
      rent: {
        label: "Rent index (ZORI, state = median of city ZORI)",
        source: "Zillow Research",
        sourceUrl: "https://www.zillow.com/research/data/",
        vintage: M.vintage || null,
        status: (M.regions && M.regions.length) ? "derived" : "pending"
      },
      income: {
        label: "Median household income",
        source: "U.S. Census Bureau, ACS 5-year",
        sourceUrl: "https://www.census.gov/programs-surveys/acs/",
        vintage: C ? C.vintage : null,
        status: C ? "real" : "illustrative"
      },
      marketSignals: {
        label: "Inventory, price cuts, days to pending, market heat",
        source: "Zillow Research (planned)",
        sourceUrl: "https://www.zillow.com/research/data/",
        vintage: null,
        status: "pending"
      },
      geography: {
        label: "State & county boundaries, FIPS codes",
        source: "U.S. Census Bureau, Cartographic Boundary Files",
        sourceUrl: "https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html",
        vintage: "2018",
        status: "real"
      },
      payments: {
        label: "Detailed mortgage/payment customization",
        source: "Home Payment Atlas",
        sourceUrl: "https://homepaymentatlas.com/",
        vintage: null,
        status: "external"
      }
    },
    // Short attribution string used in footers / methodology (status-aware).
    attribution: "Home values and rent: Zillow Research (ZHVI, ZORI)" +
      (M.vintage ? ", " + M.vintage : "") + ". Geography and FIPS codes: U.S. Census Bureau " +
      "(Cartographic Boundary Files). Household income: " +
      (C ? "U.S. Census ACS." : "illustrative estimates pending U.S. Census ACS import.") +
      " Detailed payment math: Home Payment Atlas. Zillow does not endorse this site.",
    lastUpdated: M.vintage || null
  };

  w.HAM_SOURCES = SOURCES;
})(window);
