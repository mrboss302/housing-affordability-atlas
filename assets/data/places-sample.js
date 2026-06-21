/* places-sample.js
 * Curated place REGISTRY (which cities/counties get data + pages). This file no
 * longer carries illustrative figures — real values are merged at build/runtime
 * from the ingestion pipeline:
 *   - City home values & rent -> market-places.js (Zillow City ZHVI / ZORI)
 *   - County rent             -> market-places.js (Zillow County ZORI)
 *   - Income / population      -> census-places.js (U.S. Census ACS place/county)
 *
 * NOTE ON COUNTY HOME VALUES: Zillow Research publishes ZHVI at city/metro/state
 * level but not county level in the imported datasets, so county records have no
 * home value (shown as "Not available"). County pages are therefore marked
 * noindex until a county home-value source is added.
 *
 * Each record:
 *   name        display name
 *   slug        URL slug (used for /places/<slug>/ where a page exists)
 *   stateAbbr   USPS code
 *   type        "city" | "county"
 *   zillow      name as it appears in Zillow Research files (defaults to name)
 *   fips        county GEOID (5-digit) for Census county join / reference
 *   nearby      related slugs
 *
 * Exposes window.HAM_PLACES.
 */
(function (w) {
  "use strict";

  var c = function (name, slug, stateAbbr, fips, nearby, zillow) {
    return { name: name, slug: slug, stateAbbr: stateAbbr, type: "city",
      fips: fips, zillow: zillow || name, nearby: nearby || [] };
  };
  var county = function (name, slug, stateAbbr, fips, nearby) {
    return { name: name, slug: slug, stateAbbr: stateAbbr, type: "county",
      fips: fips, zillow: name, nearby: nearby || [] };
  };

  var PLACES = [
    // --- Maryland cities (+ one county detail page) ---
    c("Baltimore", "baltimore-md", "MD", "24510", ["baltimore-county-md", "frederick-md", "rockville-md"]),
    county("Baltimore County", "baltimore-county-md", "MD", "24005", ["baltimore-md", "frederick-md"]),
    c("Frederick", "frederick-md", "MD", "24021", ["baltimore-md", "rockville-md"]),
    c("Rockville", "rockville-md", "MD", "24031", ["gaithersburg-md", "baltimore-md"]),
    c("Gaithersburg", "gaithersburg-md", "MD", "24031", ["rockville-md", "baltimore-md"]),
    c("Hagerstown", "hagerstown-md", "MD", "24043", ["frederick-md"]),

    // --- Virginia cities ---
    c("Richmond", "richmond-va", "VA", "51760", ["virginia-beach-va", "norfolk-va", "roanoke-va"]),
    c("Virginia Beach", "virginia-beach-va", "VA", "51810", ["norfolk-va", "chesapeake-va"]),
    c("Norfolk", "norfolk-va", "VA", "51710", ["virginia-beach-va", "chesapeake-va"]),
    c("Chesapeake", "chesapeake-va", "VA", "51550", ["norfolk-va", "virginia-beach-va"]),
    c("Roanoke", "roanoke-va", "VA", "51770", ["lynchburg-va", "richmond-va"]),
    c("Lynchburg", "lynchburg-va", "VA", "51680", ["roanoke-va"]),

    // --- Pennsylvania cities ---
    c("Philadelphia", "philadelphia-pa", "PA", "42101", ["pittsburgh-pa", "allentown-pa", "reading-pa"]),
    c("Pittsburgh", "pittsburgh-pa", "PA", "42003", ["philadelphia-pa", "erie-pa"]),
    c("Allentown", "allentown-pa", "PA", "42077", ["reading-pa", "philadelphia-pa"]),
    c("Reading", "reading-pa", "PA", "42011", ["allentown-pa", "philadelphia-pa"]),
    c("Erie", "erie-pa", "PA", "42049", ["pittsburgh-pa"]),
    c("Scranton", "scranton-pa", "PA", "42069", ["allentown-pa"]),

    // --- National set (varied affordability) for rankings ---
    c("Toledo", "toledo-oh", "OH", "39095", []),
    c("Cleveland", "cleveland-oh", "OH", "39035", []),
    c("Columbus", "columbus-oh", "OH", "39049", []),
    c("Detroit", "detroit-mi", "MI", "26163", []),
    c("Fort Wayne", "fort-wayne-in", "IN", "18003", []),
    c("Des Moines", "des-moines-ia", "IA", "19153", []),
    c("Wichita", "wichita-ks", "KS", "20173", []),
    c("Oklahoma City", "oklahoma-city-ok", "OK", "40109", []),
    c("Tulsa", "tulsa-ok", "OK", "40143", []),
    c("Memphis", "memphis-tn", "TN", "47157", []),
    c("Birmingham", "birmingham-al", "AL", "01073", []),
    c("Buffalo", "buffalo-ny", "NY", "36029", []),
    c("Rochester", "rochester-ny", "NY", "36055", []),
    c("El Paso", "el-paso-tx", "TX", "48141", []),
    c("Tucson", "tucson-az", "AZ", "04019", []),
    c("Albuquerque", "albuquerque-nm", "NM", "35001", [])
  ];

  w.HAM_PLACES = PLACES;
})(window);
