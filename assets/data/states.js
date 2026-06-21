/* states.js
 * State directory + FALLBACK inputs for the affordability model.
 *
 * Live data now comes from the ingestion pipeline and OVERRIDES the values here:
 *   - Home values & rent  -> market-data.js (Zillow Research ZHVI / ZORI)
 *   - Median income       -> census-data.js (U.S. Census ACS), when imported
 *
 * The medianHomeValue / medianRent / medianIncome numbers below are retained
 * only as ILLUSTRATIVE fallbacks so the site still renders if a dataset is
 * missing. medianIncome stays illustrative until tools/import-census.js is run
 * with a Census API key. See source-metadata.js for per-field provenance.
 *
 * Each record:
 *   abbr            two-letter USPS code (joins to geometry in us-geo.js)
 *   name            display name
 *   slug            URL slug used for /states/<slug>/
 *   fips            state FIPS code
 *   medianHomeValue estimated typical home value (USD)
 *   medianRent      estimated median gross monthly rent (USD)
 *   medianIncome    estimated median household income (USD/yr)
 *
 * Derived fields (payment, income needed, score, rent burden) are computed at
 * runtime by affordability.js so the math stays consistent everywhere.
 *
 * Exposes window.HAM_STATES.
 */
(function (w) {
  "use strict";

  var STATES = [
    { abbr: "AL", name: "Alabama", slug: "alabama", fips: "01", medianHomeValue: 220000, medianRent: 950, medianIncome: 59000 },
    { abbr: "AK", name: "Alaska", slug: "alaska", fips: "02", medianHomeValue: 350000, medianRent: 1300, medianIncome: 86000 },
    { abbr: "AZ", name: "Arizona", slug: "arizona", fips: "04", medianHomeValue: 430000, medianRent: 1400, medianIncome: 72000 },
    { abbr: "AR", name: "Arkansas", slug: "arkansas", fips: "05", medianHomeValue: 200000, medianRent: 850, medianIncome: 56000 },
    { abbr: "CA", name: "California", slug: "california", fips: "06", medianHomeValue: 760000, medianRent: 1900, medianIncome: 91000 },
    { abbr: "CO", name: "Colorado", slug: "colorado", fips: "08", medianHomeValue: 540000, medianRent: 1650, medianIncome: 87000 },
    { abbr: "CT", name: "Connecticut", slug: "connecticut", fips: "09", medianHomeValue: 380000, medianRent: 1400, medianIncome: 90000 },
    { abbr: "DE", name: "Delaware", slug: "delaware", fips: "10", medianHomeValue: 360000, medianRent: 1300, medianIncome: 79000 },
    { abbr: "DC", name: "District of Columbia", slug: "district-of-columbia", fips: "11", medianHomeValue: 650000, medianRent: 1700, medianIncome: 101000 },
    { abbr: "FL", name: "Florida", slug: "florida", fips: "12", medianHomeValue: 400000, medianRent: 1500, medianIncome: 67000 },
    { abbr: "GA", name: "Georgia", slug: "georgia", fips: "13", medianHomeValue: 330000, medianRent: 1250, medianIncome: 71000 },
    { abbr: "HI", name: "Hawaii", slug: "hawaii", fips: "15", medianHomeValue: 840000, medianRent: 1900, medianIncome: 94000 },
    { abbr: "ID", name: "Idaho", slug: "idaho", fips: "16", medianHomeValue: 430000, medianRent: 1150, medianIncome: 70000 },
    { abbr: "IL", name: "Illinois", slug: "illinois", fips: "17", medianHomeValue: 270000, medianRent: 1200, medianIncome: 78000 },
    { abbr: "IN", name: "Indiana", slug: "indiana", fips: "18", medianHomeValue: 230000, medianRent: 950, medianIncome: 67000 },
    { abbr: "IA", name: "Iowa", slug: "iowa", fips: "19", medianHomeValue: 210000, medianRent: 900, medianIncome: 70000 },
    { abbr: "KS", name: "Kansas", slug: "kansas", fips: "20", medianHomeValue: 220000, medianRent: 950, medianIncome: 69000 },
    { abbr: "KY", name: "Kentucky", slug: "kentucky", fips: "21", medianHomeValue: 200000, medianRent: 900, medianIncome: 60000 },
    { abbr: "LA", name: "Louisiana", slug: "louisiana", fips: "22", medianHomeValue: 220000, medianRent: 950, medianIncome: 57000 },
    { abbr: "ME", name: "Maine", slug: "maine", fips: "23", medianHomeValue: 360000, medianRent: 1100, medianIncome: 71000 },
    { abbr: "MD", name: "Maryland", slug: "maryland", fips: "24", medianHomeValue: 410000, medianRent: 1500, medianIncome: 98000 },
    { abbr: "MA", name: "Massachusetts", slug: "massachusetts", fips: "25", medianHomeValue: 580000, medianRent: 1650, medianIncome: 96000 },
    { abbr: "MI", name: "Michigan", slug: "michigan", fips: "26", medianHomeValue: 240000, medianRent: 1050, medianIncome: 68000 },
    { abbr: "MN", name: "Minnesota", slug: "minnesota", fips: "27", medianHomeValue: 330000, medianRent: 1200, medianIncome: 84000 },
    { abbr: "MS", name: "Mississippi", slug: "mississippi", fips: "28", medianHomeValue: 180000, medianRent: 850, medianIncome: 53000 },
    { abbr: "MO", name: "Missouri", slug: "missouri", fips: "29", medianHomeValue: 240000, medianRent: 950, medianIncome: 65000 },
    { abbr: "MT", name: "Montana", slug: "montana", fips: "30", medianHomeValue: 450000, medianRent: 1050, medianIncome: 70000 },
    { abbr: "NE", name: "Nebraska", slug: "nebraska", fips: "31", medianHomeValue: 250000, medianRent: 950, medianIncome: 71000 },
    { abbr: "NV", name: "Nevada", slug: "nevada", fips: "32", medianHomeValue: 440000, medianRent: 1400, medianIncome: 71000 },
    { abbr: "NH", name: "New Hampshire", slug: "new-hampshire", fips: "33", medianHomeValue: 450000, medianRent: 1400, medianIncome: 90000 },
    { abbr: "NJ", name: "New Jersey", slug: "new-jersey", fips: "34", medianHomeValue: 480000, medianRent: 1550, medianIncome: 97000 },
    { abbr: "NM", name: "New Mexico", slug: "new-mexico", fips: "35", medianHomeValue: 290000, medianRent: 1000, medianIncome: 59000 },
    { abbr: "NY", name: "New York", slug: "new-york", fips: "36", medianHomeValue: 420000, medianRent: 1450, medianIncome: 81000 },
    { abbr: "NC", name: "North Carolina", slug: "north-carolina", fips: "37", medianHomeValue: 330000, medianRent: 1200, medianIncome: 67000 },
    { abbr: "ND", name: "North Dakota", slug: "north-dakota", fips: "38", medianHomeValue: 270000, medianRent: 950, medianIncome: 73000 },
    { abbr: "OH", name: "Ohio", slug: "ohio", fips: "39", medianHomeValue: 230000, medianRent: 950, medianIncome: 66000 },
    { abbr: "OK", name: "Oklahoma", slug: "oklahoma", fips: "40", medianHomeValue: 200000, medianRent: 900, medianIncome: 61000 },
    { abbr: "OR", name: "Oregon", slug: "oregon", fips: "41", medianHomeValue: 490000, medianRent: 1450, medianIncome: 76000 },
    { abbr: "PA", name: "Pennsylvania", slug: "pennsylvania", fips: "42", medianHomeValue: 270000, medianRent: 1100, medianIncome: 73000 },
    { abbr: "RI", name: "Rhode Island", slug: "rhode-island", fips: "44", medianHomeValue: 430000, medianRent: 1350, medianIncome: 81000 },
    { abbr: "SC", name: "South Carolina", slug: "south-carolina", fips: "45", medianHomeValue: 300000, medianRent: 1150, medianIncome: 63000 },
    { abbr: "SD", name: "South Dakota", slug: "south-dakota", fips: "46", medianHomeValue: 280000, medianRent: 900, medianIncome: 69000 },
    { abbr: "TN", name: "Tennessee", slug: "tennessee", fips: "47", medianHomeValue: 310000, medianRent: 1150, medianIncome: 64000 },
    { abbr: "TX", name: "Texas", slug: "texas", fips: "48", medianHomeValue: 330000, medianRent: 1300, medianIncome: 73000 },
    { abbr: "UT", name: "Utah", slug: "utah", fips: "49", medianHomeValue: 510000, medianRent: 1300, medianIncome: 86000 },
    { abbr: "VT", name: "Vermont", slug: "vermont", fips: "50", medianHomeValue: 380000, medianRent: 1150, medianIncome: 74000 },
    { abbr: "VA", name: "Virginia", slug: "virginia", fips: "51", medianHomeValue: 380000, medianRent: 1450, medianIncome: 87000 },
    { abbr: "WA", name: "Washington", slug: "washington", fips: "53", medianHomeValue: 580000, medianRent: 1650, medianIncome: 90000 },
    { abbr: "WV", name: "West Virginia", slug: "west-virginia", fips: "54", medianHomeValue: 160000, medianRent: 800, medianIncome: 55000 },
    { abbr: "WI", name: "Wisconsin", slug: "wisconsin", fips: "55", medianHomeValue: 270000, medianRent: 1050, medianIncome: 72000 },
    { abbr: "WY", name: "Wyoming", slug: "wyoming", fips: "56", medianHomeValue: 330000, medianRent: 1000, medianIncome: 72000 }
  ];

  w.HAM_STATES = STATES;
})(window);
