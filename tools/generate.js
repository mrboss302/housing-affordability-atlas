/* tools/generate.js
 * Static-site generator for Housing Affordability Atlas.
 *
 * It loads the SAME data + math modules the browser uses (assets/data/*.js and
 * assets/js/affordability.js), then bakes fully static, crawlable HTML for
 * every page — including computed ranking/affordability tables — plus
 * sitemap.xml and robots.txt.
 *
 * Run:  node tools/generate.js
 *
 * This is a build-time tool only. The published site is plain static files and
 * needs no Node at runtime. To add states/places/income pages, edit the data
 * files and the small arrays near the bottom, then re-run this script.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/* ---- Load shared browser modules into a fake window ---------------------- */
global.window = {};
// Optional data files (market/census) load first if present so affordability.js
// and source-metadata.js pick them up. The build never fails if one is missing.
const DATA_FILES = [
  "assets/data/assumptions.js",
  "assets/data/states.js",
  "assets/data/places-sample.js",
  "assets/data/market-data.js",        // Zillow state (optional, generated)
  "assets/data/census-data.js",        // Census state ACS (optional, generated)
  "assets/data/market-places.js",      // Zillow city/county (optional, generated)
  "assets/data/census-places.js",      // Census place/county ACS (optional, generated)
  "assets/js/affordability.js",
  "assets/data/source-metadata.js"
];
DATA_FILES.forEach((f) => {
  const full = path.join(ROOT, f);
  if (fs.existsSync(full)) eval(fs.readFileSync(full, "utf8"));
  else console.warn("[generate] optional data file not found, skipping: " + f);
});

const A = global.window.HAM_ASSUMPTIONS;
const STATES = global.window.HAM_STATES;
const PLACES = global.window.HAM_PLACES;
const HAM = global.window.HAM;
const SOURCES = global.window.HAM_SOURCES || { fields: {}, attribution: "", lastUpdated: null };
const MARKET = global.window.HAM_MARKET || null;
const CENSUS = global.window.HAM_CENSUS || null;
const MARKET_PLACES = global.window.HAM_MARKET_PLACES || null;
const CENSUS_PLACES = global.window.HAM_CENSUS_PLACES || null;

/* ---- Site configuration ------------------------------------------------- */
const SITE = {
  name: "Housing Affordability Atlas",
  // Public origin — drives canonicals, OG URLs, sitemap, robots, ads.txt.
  // Override at build time with SITE_URL (the CI workflow sets it). Default is
  // the GitHub Pages project URL; switch to a custom domain when you add one.
  origin: (process.env.SITE_URL || "https://mrboss302.github.io/housing-affordability-atlas").replace(/\/$/, ""),
  tagline: "Explore where housing may still be affordable.",
  // AdSense publisher ID (shared with the Home Payment Atlas network).
  // EDIT if this site uses a different AdSense account.
  adClient: "ca-pub-3840656918521680"
};

// Honest, per-field data-status note (replaces the old "demo data" wording).
const ZVINTAGE = (MARKET && MARKET.vintage) ? MARKET.vintage : null;
const DATA_NOTE = (function () {
  const home = ZVINTAGE
    ? "Home values and rents reflect Zillow Research data (ZHVI and ZORI, " + ZVINTAGE + ")."
    : "Home values and rents are illustrative until the Zillow Research datasets are imported.";
  const inc = CENSUS
    ? "Household income reflects U.S. Census ACS data."
    : "Household income figures are illustrative estimates pending Census ACS import.";
  return home + " " + inc + " All figures are estimates for general comparison, " +
    "not appraisals or quotes — confirm details before relying on them.";
})();
const SAMPLE_NOTE = DATA_NOTE; // backward-compat alias used by some builders

/* ---- Small helpers ------------------------------------------------------ */
// Clean percentage formatter — strips floating-point noise (0.28*100 = 28.0000…4).
const pp = (v) => String(Math.round(v * 1e6) / 1e6);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = HAM.money;
const pct = HAM.pct;
const slugStates = {}; STATES.forEach((s) => (slugStates[s.abbr] = s));
const placeBySlug = {}; PLACES.forEach((p) => (placeBySlug[p.slug] = p));

function prefixFor(outPath) {
  // outPath is relative to ROOT, e.g. "map/income-needed/index.html"
  const depth = outPath.split("/").length - 1;
  return depth === 0 ? "" : "../".repeat(depth);
}
function evalRec(rec, opts) { return HAM.evaluate(rec, opts || {}); }      // places (illustrative)
function evalState(s, opts) { return HAM.evaluateState(s, opts || {}); }   // states (real Zillow + Census)

/* ---- Reusable HTML partials -------------------------------------------- */
function head(meta, pre) {
  const canonical = SITE.origin + "/" + meta.url.replace(/index\.html$/, "");
  const jsonld = (meta.jsonld || []).map((o) =>
    '<script type="application/ld+json">' + JSON.stringify(o) + "</script>").join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
${meta.noindex ? '<meta name="robots" content="noindex,follow">\n' : ""}<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:title" content="${esc(meta.ogTitle || meta.title)}">
<meta property="og:description" content="${esc(meta.ogDescription || meta.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0f766e">
<link rel="icon" href="${pre}assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://homepaymentatlas.com">
<link rel="stylesheet" href="${pre}assets/css/styles.css">
${jsonld}
<!-- Google AdSense loader (publisher ${SITE.adClient}). Enables AdSense site
     verification and Auto Ads. Individual ad units stay as labeled placeholders
     until you create units in AdSense and set their numeric slot IDs in ad(). -->
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${SITE.adClient}" crossorigin="anonymous"></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>`;
}

function header(pre) {
  const link = (href, label) => `<a href="${pre}${href}">${label}</a>`;
  return `<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="${pre}index.html"><span class="brand-mark" aria-hidden="true"></span>${SITE.name}</a>
    <button class="nav-toggle" data-nav-toggle aria-expanded="false" aria-controls="primary-nav" aria-label="Toggle navigation">
      <span></span><span></span><span></span>
    </button>
    <nav class="primary-nav" id="primary-nav" data-nav aria-label="Primary">
      ${link("map/index.html", "Map")}
      ${link("rankings/most-affordable-states/index.html", "Rankings")}
      ${link("income/75000/index.html", "By income")}
      ${link("methodology/index.html", "Methodology")}
      ${link("about/index.html", "About")}
    </nav>
  </div>
</header>`;
}

function footer(pre) {
  const col = (title, links) =>
    `<div class="foot-col"><h2>${title}</h2><ul>` +
    links.map((l) => `<li><a href="${pre}${l[0]}">${l[1]}</a></li>`).join("") +
    `</ul></div>`;
  return `<footer class="site-footer">
  <div class="wrap foot-grid">
    ${col("Maps", [
      ["map/index.html", "Full affordability map"],
      ["map/buying-affordability/index.html", "Buying affordability"],
      ["map/income-needed/index.html", "Income needed"],
      ["map/rent-burden/index.html", "Rent burden"]
    ])}
    ${col("Rankings", [
      ["rankings/most-affordable-states/index.html", "Most affordable states"],
      ["rankings/most-affordable-places-to-buy/index.html", "Most affordable places"],
      ["rankings/lowest-income-needed/index.html", "Lowest income needed"],
      ["rankings/best-places-for-first-time-buyers/index.html", "First-time buyers"]
    ])}
    ${col("By income", [
      ["income/50000/index.html", "On $50,000"],
      ["income/75000/index.html", "On $75,000"],
      ["income/100000/index.html", "On $100,000"],
      ["income/150000/index.html", "On $150,000"]
    ])}
    ${col("States", [
      ["states/maryland/index.html", "Maryland"],
      ["states/virginia/index.html", "Virginia"],
      ["states/pennsylvania/index.html", "Pennsylvania"]
    ])}
    ${col("Site", [
      ["about/index.html", "About"],
      ["methodology/index.html", "Methodology"],
      ["privacy/index.html", "Privacy"],
      ["terms/index.html", "Terms & disclaimer"]
    ])}
  </div>
  <div class="wrap foot-base">
    <p class="foot-atlas">Detailed mortgage and payment math lives on our companion site,
      <a href="${A.atlas.home}" rel="noopener">Home Payment Atlas</a>.</p>
    <p class="foot-atlas-src">Home values &amp; rent: Zillow Research. Income &amp; geography: U.S. Census Bureau. Zillow does not endorse this site.</p>
    <p class="foot-legal">&copy; <span data-year>2026</span> ${SITE.name}. Educational estimates only — not financial, legal, tax, mortgage, or real-estate advice. Verify with official sources.</p>
  </div>
</footer>
<script src="${pre}assets/js/site.js" defer></script>`;
}

function scripts(pre, withMap) {
  if (!withMap) return "";
  // Load order matters: data + assumptions, then market/census (if present),
  // then affordability (merges them), then geometry + map.
  const lines = [
    `<script src="${pre}assets/data/assumptions.js" defer></script>`,
    `<script src="${pre}assets/data/states.js" defer></script>`,
    `<script src="${pre}assets/data/market-data.js" defer></script>`
  ];
  if (CENSUS) lines.push(`<script src="${pre}assets/data/census-data.js" defer></script>`);
  lines.push(
    `<script src="${pre}assets/data/us-geo.js" defer></script>`,
    `<script src="${pre}assets/js/affordability.js" defer></script>`,
    `<script src="${pre}assets/js/map.js" defer></script>`
  );
  return lines.join("\n");
}

/* Advertisement slot. Reserves space to avoid layout shift; labeled clearly. */
function ad(variant) {
  const sizes = {
    horizontal: "ad-horizontal",
    incontent: "ad-incontent",
    sidebar: "ad-sidebar",
    footer: "ad-footer"
  };
  const slot = "1111111111"; // EDIT: replace with the real data-ad-slot ID
  return `<aside class="ad-slot ${sizes[variant] || "ad-horizontal"}" aria-label="Advertisement">
  <span class="ad-label">Advertisement</span>
  <!-- AdSense unit. Replace data-ad-client and data-ad-slot, then uncomment.
  <ins class="adsbygoogle" style="display:block"
       data-ad-client="${SITE.adClient}"
       data-ad-slot="${slot}"
       data-ad-format="auto" data-full-width-responsive="true"></ins>
  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
  -->
  <div class="ad-placeholder" aria-hidden="true">Ad space</div>
</aside>`;
}

function breadcrumbs(pre, trail) {
  // trail: array of [href|null, label]
  const items = trail.map((t, i) => {
    const last = i === trail.length - 1;
    if (last || !t[0]) return `<li aria-current="page">${esc(t[1])}</li>`;
    return `<li><a href="${pre}${t[0]}">${esc(t[1])}</a></li>`;
  }).join("");
  return `<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>${items}</ol></nav>`;
}
function breadcrumbJsonLd(trail) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem", position: i + 1, name: t[1],
      item: t[0] ? SITE.origin + "/" + t[0].replace(/index\.html$/, "") : undefined
    }))
  };
}
function faqJsonLd(faqs) {
  return {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question", name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a }
    }))
  };
}
function faqSection(faqs) {
  return `<section class="faq" aria-labelledby="faq-h">
  <h2 id="faq-h">Frequently asked questions</h2>
  ${faqs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${f.a}</p></details>`).join("\n")}
</section>`;
}
function disclaimer() {
  return `<section class="disclaimer" role="note">
  <h2>About these estimates &amp; data sources</h2>
  <p>${DATA_NOTE}</p>
  <p class="source-line">${esc(SOURCES.attribution)}</p>
  <p>Figures are educational estimates only and are <strong>not</strong> financial, legal, tax,
  mortgage, or real-estate advice, and not a loan offer. Verify every number with lenders, agents,
  tax authorities, and official sources. See our <a href="${rel()}methodology/index.html">methodology</a>
  and <a href="${rel()}terms/index.html">terms &amp; disclaimer</a>.</p>
</section>`;
  function rel() { return disclaimer._pre || ""; }
}

// Compact inline source/vintage strip for use under data sections.
function sourceStrip() {
  const bits = [];
  if (ZVINTAGE) bits.push(`Home values &amp; rent: Zillow Research, ${ZVINTAGE}`);
  else bits.push("Home values &amp; rent: illustrative (Zillow import pending)");
  bits.push(CENSUS ? "Income: U.S. Census ACS" : "Income: illustrative (Census import pending)");
  return `<p class="source-strip">Sources — ${bits.join(" · ")}. Zillow does not endorse this site.</p>`;
}
function atlasCta(pre, opts) {
  opts = opts || {};
  const calc = opts.calcUrl || A.atlas.calculator;
  const stateUrl = opts.stateUrl;
  return `<section class="cta-atlas" aria-labelledby="cta-h">
  <h2 id="cta-h">Customize this scenario</h2>
  <p>Want to adjust down payment, taxes, PMI, insurance, or HOA? Open this scenario in the
  Home Payment Atlas mortgage calculator for full, personalized payment math.</p>
  <div class="cta-actions">
    <a class="btn btn-primary" href="${esc(calc)}" rel="noopener">Open the full mortgage calculator</a>
    ${stateUrl ? `<a class="btn" href="${esc(stateUrl)}" rel="noopener">${esc(opts.stateLabel || "See state assumptions on Home Payment Atlas")}</a>` : ""}
    <a class="btn btn-ghost" href="${A.atlas.methodology}" rel="noopener">Review the Home Payment Atlas methodology</a>
  </div>
</section>`;
}

/* Page shell */
function page(meta, body, opts) {
  opts = opts || {};
  const pre = prefixFor(meta.url);
  disclaimer._pre = pre;
  const websiteLd = {
    "@context": "https://schema.org", "@type": "WebSite", name: SITE.name,
    url: SITE.origin + "/", description: SITE.tagline
  };
  meta.jsonld = [websiteLd].concat(meta.jsonld || []);
  const html =
    head(meta, pre) +
    header(pre) +
    `<main id="main">` + body(pre) + `</main>` +
    footer(pre) +
    scripts(pre, opts.withMap);
  if (meta.noindex) NOINDEX.add(meta.url);
  write(meta.url, html + "\n</body>\n</html>\n");
}
const NOINDEX = new Set();

function write(rel, html) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, html);
  GENERATED.push(rel);
}
const GENERATED = [];

/* ---- Shared content builders ------------------------------------------- */
function mapControls(pre, opts) {
  opts = opts || {};
  const incomeOpts = `<option value="area">Area median income</option>` +
    A.incomeScenarios.map((v) => `<option value="${v}">${money(v)} household income</option>`).join("");
  const viewOpts =
    `<optgroup label="Affordability (live data)">` +
    `<option value="median-affordability">Median-home affordability</option>` +
    `<option value="starter-affordability">Starter-home affordability</option>` +
    `<option value="family-affordability">Family-home affordability (3BR)</option>` +
    `<option value="income-needed">Income needed</option>` +
    `<option value="monthly-payment">Estimated monthly payment</option>` +
    `<option value="rent-affordability">Rent affordability</option>` +
    `</optgroup>` +
    `<optgroup label="Market signals (data roadmap)">` +
    `<option value="buyer-opportunity">Buyer opportunity (preview)</option>` +
    `<option value="market-heat">Market heat (preview)</option>` +
    `<option value="price-cut-share">Price-cut share (preview)</option>` +
    `</optgroup>`;
  return `<form class="map-controls" aria-label="Map controls" onsubmit="return false">
    <div class="control">
      <label for="ctl-income">Income level</label>
      <select id="ctl-income" data-control="income">${incomeOpts}</select>
    </div>
    <div class="control control-wide">
      <label for="ctl-view">Map layer</label>
      <select id="ctl-view" data-control="view">${viewOpts}</select>
    </div>
    <div class="control">
      <label for="ctl-custom">Custom home price (optional)</label>
      <input id="ctl-custom" type="number" inputmode="numeric" min="0" step="5000"
             placeholder="e.g. 350000" data-control="custom-price">
    </div>
  </form>`;
}

function mapBlock(pre, mode) {
  const modeAttr = mode ? ` data-map-mode="${mode}"` : "";
  return `<div class="map-area">
    <div class="map-figure" data-map${modeAttr}>
      <div class="map-canvas" data-map-canvas role="img"
           aria-label="Interactive U.S. affordability map">
        <p class="map-empty" role="status">Preparing the affordability map…</p>
      </div>
    </div>
    <div class="map-side">
      <div class="map-legend" data-map-legend aria-live="polite"></div>
      <section class="map-panel" data-map-panel aria-live="polite" aria-labelledby="panel-title" tabindex="-1">
        <p class="panel-hint">Select any state on the map to see estimated affordability, income needed, and a link to customize the payment on Home Payment Atlas.</p>
      </section>
      ${ad("sidebar")}
    </div>
  </div>`;
}

/* Static, crawlable state ranking table for the active default scenario. */
function stateTable(pre, opts) {
  opts = opts || {};
  const metric = opts.metric || "score";
  const layer = opts.layer || "median";
  const limit = opts.limit || STATES.length;
  const income = opts.income;
  let rows = STATES.map((s) => {
    const e = evalState(s, income ? { income, layer } : { layer });
    return { s, e };
  });
  const lowerBetter = metric === "incomeNeeded" || metric === "monthlyPayment" || metric === "rentBurden";
  rows.sort((a, b) => {
    const av = a.e[metric], bv = b.e[metric];
    if (av == null) return 1; if (bv == null) return -1;
    return lowerBetter ? av - bv : bv - av;
  });
  rows = rows.slice(0, limit);
  const layerLabel = (HAM.LAYERS[layer] || HAM.LAYERS.median).label;
  const body = rows.map((r, i) => {
    const s = r.s, e = r.e;
    return `<tr>
      <td>${i + 1}</td>
      <td>${stateNameCell(pre, s)}</td>
      <td>${money(e.scenarioPrice)}</td>
      <td>${money(e.monthlyPayment)}</td>
      <td>${money(e.incomeNeeded)}</td>
      <td><span class="score-pill" data-band="${e.band.key}">${e.score == null ? "—" : e.score}</span></td>
    </tr>`;
  }).join("");
  const dyn = opts.dynamic ? " data-state-ranking" : "";
  const srcBit = ZVINTAGE ? `Zillow ZHVI ${ZVINTAGE}` : "illustrative values";
  return `<div class="table-wrap"><table class="data-table"${opts.id ? ` id="${opts.id}"` : ""}>
    <caption class="table-caption">${esc(layerLabel)} affordability by state — ${srcBit}${CENSUS ? ", Census ACS income" : ", illustrative income"}${income ? `, ${money(income)} income scenario` : ""}.</caption>
    <thead><tr><th scope="col">#</th><th scope="col">State</th><th scope="col">Est. home value</th>
    <th scope="col">Est. payment</th><th scope="col">Income needed</th><th scope="col">Score</th></tr></thead>
    <tbody${dyn}>${body}</tbody>
  </table></div>`;
}

// Real city affordability table. Only "complete" cities (real Zillow home value
// + Census income) are included so the ranking never shows fabricated rows.
function placeTable(pre, places, opts) {
  opts = opts || {};
  const layer = opts.layer || "median";
  let rows = places
    .map((p) => ({ p, e: evalPlace(p, Object.assign({ layer }, opts.income ? { income: opts.income } : {})) }))
    .filter((r) => r.e && r.e.complete);
  const lowerBetter = opts.metric === "incomeNeeded";
  rows.sort((a, b) =>
    lowerBetter ? a.e.incomeNeeded - b.e.incomeNeeded : b.e.score - a.e.score);
  if (opts.limit) rows = rows.slice(0, opts.limit);
  const body = rows.map((r, i) => {
    const p = r.p, e = r.e;
    const name = pageExistsForPlace(p.slug)
      ? `<a href="${pre}places/${p.slug}/index.html">${esc(p.name)}</a>`
      : esc(p.name);
    return `<tr>
      <td>${i + 1}</td>
      <td>${name}<span class="muted"> · ${p.stateAbbr}</span></td>
      <td>${money(e.scenarioPrice)}</td>
      <td>${money(e.monthlyPayment)}</td>
      <td>${money(e.incomeNeeded)}</td>
      <td>${pct(e.rentBurden)}</td>
      <td><span class="score-pill" data-band="${e.band.key}">${e.score == null ? "—" : e.score}</span></td>
    </tr>`;
  }).join("");
  const srcBit = ZVINTAGE ? `Zillow ZHVI/ZORI ${ZVINTAGE}, Census ACS` : "Zillow + Census";
  return `<div class="table-wrap"><table class="data-table">
    <caption class="table-caption">${esc(opts.caption || "City affordability — " + srcBit + ".")}</caption>
    <thead><tr><th scope="col">#</th><th scope="col">City</th><th scope="col">Home value</th>
    <th scope="col">Est. payment</th><th scope="col">Income needed</th><th scope="col">Rent burden</th><th scope="col">Score</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}
function evalPlace(p, opts) { return HAM.evaluatePlace(p, opts || {}); }
// Count of cities with complete real data (gates ranking-page indexing).
function completeCityCount() {
  return PLACES.filter((p) => p.type === "city")
    .filter((p) => { const e = HAM.evaluatePlace(p, {}); return e && e.complete; }).length;
}

const PLACE_PAGES = ["baltimore-md", "baltimore-county-md", "richmond-va", "philadelphia-pa"];
function pageExistsForPlace(slug) { return PLACE_PAGES.indexOf(slug) !== -1; }

// State names link only where a state page is published (others stay plain text).
function stateNameCell(pre, s) {
  return STATE_PAGES.indexOf(s.abbr) !== -1
    ? `<a href="${pre}states/${s.slug}/index.html">${esc(s.name)}</a>`
    : `${esc(s.name)}<span class="muted"> · ${s.abbr}</span>`;
}

function statCards(e, labels) {
  const c = (k, v, note) =>
    `<div class="stat-card"><span class="stat-k">${k}</span><span class="stat-v">${v}</span>${note ? `<span class="stat-note">${note}</span>` : ""}</div>`;
  return `<div class="stat-cards">
    ${c("Estimated home value", money(e.scenarioPrice), labels && labels.priceNote)}
    ${c("Estimated monthly payment", money(e.monthlyPayment), "Principal, interest, taxes, insurance, PMI")}
    ${c("Estimated income needed", money(e.incomeNeeded), "So housing ≤ 28% of income")}
    ${c("Affordability score", e.score == null ? "—" : e.score + " / 100", e.band.label)}
    ${c("Estimated rent burden", pct(e.rentBurden), "Median rent ÷ median income")}
  </div>`;
}

module.exports = { run };

/* =======================================================================
 *  PAGE DEFINITIONS
 * ===================================================================== */
function run() {
  buildHome();
  buildMapPages();
  buildStatePages();
  buildPlacePages();
  buildIncomePages();
  buildRankingPages();
  buildInfoPages();
  buildSitemapRobots();
  console.log("Generated " + GENERATED.length + " files:");
  GENERATED.forEach((g) => console.log("  " + g));
}

/* ---- Homepage ---------------------------------------------------------- */
function buildHome() {
  const url = "index.html";
  const meta = {
    url,
    title: "Housing Affordability Atlas — Explore Where Housing May Still Be Affordable",
    description: "An interactive U.S. housing affordability map. Explore estimated home prices, monthly payments, and the income needed by state and place, then customize the math on Home Payment Atlas.",
    jsonld: [{
      "@context": "https://schema.org", "@type": "WebApplication",
      name: SITE.name, url: SITE.origin + "/",
      applicationCategory: "FinanceApplication", operatingSystem: "Any",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      description: SITE.tagline
    }]
  };
  const vint = ZVINTAGE ? `Zillow Research home-value data, ${ZVINTAGE}` : "public housing data";
  page(meta, (pre) => `
  <section class="hero">
    <div class="wrap hero-inner">
      <h1>Explore where housing may still be affordable</h1>
      <p class="lede">An interactive U.S. housing-affordability map built on public and research
        data. Compare home values, the income needed to buy, and rent pressure across all 50 states —
        then open any market in <a href="${A.atlas.home}" rel="noopener">Home Payment Atlas</a> to
        run the detailed payment math.</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="${pre}map/index.html">Open the affordability map</a>
        <a class="btn" href="${pre}rankings/most-affordable-states/index.html">See most affordable states</a>
      </div>
      <p class="hero-flag">Built on ${vint}${CENSUS ? " and U.S. Census ACS income" : ""}. Estimates for comparison, not advice.</p>
    </div>
  </section>
  <div class="wrap">
    ${ad("horizontal")}

    <section class="section">
      <h2>A market-discovery map, not a listings site</h2>
      <p>Most housing sites show you individual listings. This one shows you the <em>landscape</em>:
        which states and markets are within reach for a given income, where rent eats the most of a
        paycheck, and where starter homes are still attainable. Home values and rents come from
        <strong>Zillow Research</strong> (ZHVI and ZORI); income and geography come from the
        <strong>U.S. Census Bureau</strong>. When you find a market worth a closer look, continue to
        <a href="${A.atlas.home}" rel="noopener">Home Payment Atlas</a> to customize down payment,
        taxes, PMI, insurance, and HOA.</p>
      <div class="feature-grid">
        <a class="feature" href="${pre}map/buying-affordability/index.html"><h3>Buying affordability</h3><p>How far an income stretches toward a median or starter home, by state.</p></a>
        <a class="feature" href="${pre}map/income-needed/index.html"><h3>Income needed</h3><p>The household income typically required to buy a mid-tier home.</p></a>
        <a class="feature" href="${pre}map/rent-burden/index.html"><h3>Rent affordability</h3><p>Zillow rent as a share of income — where renting pressures budgets most.</p></a>
        <a class="feature" href="${pre}rankings/most-affordable-starter-home-markets/index.html"><h3>Starter homes</h3><p>Markets where entry-level (bottom-tier) homes are most attainable.</p></a>
      </div>
    </section>

    ${mapControls(pre)}
    ${mapBlock(pre)}
    ${sourceStrip()}

    <section class="section">
      <h2>Most affordable states to buy${ZVINTAGE ? ` <span class="muted">(${ZVINTAGE})</span>` : ""}</h2>
      <p>Ranked by estimated buying-affordability score for a mid-tier home, combining Zillow home
        values with income context. Open a state for county and city detail, or change the controls
        above to explore starter homes, family homes, income needed, or rent.</p>
      ${stateTable(pre, { limit: 10 })}
      <p><a class="textlink" href="${pre}rankings/most-affordable-states/index.html">See the full state ranking →</a></p>
    </section>

    ${ad("incontent")}
    ${atlasCta(pre)}
    ${disclaimer()}
  </div>`, { withMap: true });
}

/* ---- Map pages --------------------------------------------------------- */
function buildMapPages() {
  const defs = [
    {
      url: "map/index.html", mode: null,
      h1: "U.S. Housing Affordability Map",
      title: "U.S. Housing Affordability Map (Interactive) | Housing Affordability Atlas",
      desc: "Interactive map of U.S. housing affordability by state, built on Zillow home values and Census income. Switch layers — starter, median, and family-home affordability, income needed, payment, and rent.",
      intro: "Set an income level and choose a map layer — starter, median, or family-home affordability, income needed, estimated payment, or rent. States recolor instantly; select any state for estimated payment, income needed, and a link to customize the scenario on Home Payment Atlas."
    },
    {
      url: "map/buying-affordability/index.html", mode: "buying-affordability",
      h1: "Buying Affordability Map",
      title: "Buying Affordability Map by State | Housing Affordability Atlas",
      desc: "See estimated home-buying affordability across U.S. states. Compare how far a given income stretches toward owning a median or starter home.",
      intro: "This view scores each state on estimated ownership affordability: how an income compares with the income typically needed to buy. Lighter-stress states score higher."
    },
    {
      url: "map/income-needed/index.html", mode: "income-needed",
      h1: "Income Needed to Buy a Home — by State",
      title: "Income Needed to Buy a Home, by State | Housing Affordability Atlas",
      desc: "Map of the estimated household income needed to buy a typical home in each U.S. state, based on transparent, editable mortgage assumptions.",
      intro: "This view maps the estimated annual household income needed so a median-home payment stays within about 28% of gross income. Darker states need higher incomes."
    },
    {
      url: "map/rent-burden/index.html", mode: "rent-burden",
      h1: "Rent Burden Map — by State",
      title: "Rent Affordability & Rent Burden by State | Housing Affordability Atlas",
      desc: "Map of estimated rent burden — Zillow rent index as a share of household income — across U.S. states. See where renting consumes the largest share of a paycheck.",
      intro: "This view maps estimated rent burden: the Zillow Observed Rent Index (state value = median of city ZORI) as a percentage of household income. Above ~30% is generally considered rent burdened."
    }
  ];
  defs.forEach((dpage) => {
    const trail = [["index.html", "Home"], ["map/index.html", "Map"]];
    if (dpage.mode) trail.push([dpage.url, dpage.h1]);
    const meta = {
      url: dpage.url, title: dpage.title, description: dpage.desc,
      jsonld: [
        breadcrumbJsonLd(trail),
        { "@context": "https://schema.org", "@type": "WebApplication", name: dpage.h1,
          applicationCategory: "FinanceApplication", operatingSystem: "Any",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          url: SITE.origin + "/" + dpage.url.replace(/index\.html$/, "") }
      ]
    };
    page(meta, (pre) => `
    <div class="wrap">
      ${breadcrumbs(pre, trail)}
      <h1>${esc(dpage.h1)}</h1>
      <p class="lede">${esc(dpage.intro)}</p>
      ${ad("horizontal")}
      ${mapControls(pre)}
      ${mapBlock(pre, dpage.mode)}
      <section class="section">
        <h2>State ranking for this view <span class="muted">(updates with the controls)</span></h2>
        ${stateTable(pre, { limit: 15, dynamic: true })}
      </section>
      ${ad("incontent")}
      <section class="section">
        <h2>How these estimates work</h2>
        <p>Each state combines a typical home value with editable assumptions — a
          ${(A.interestRate * 100).toFixed(2)}% rate, ${A.loanTermYears}-year term,
          ${pp(A.downPaymentPct * 100)}% down, plus property tax, insurance, and PMI — to estimate a
          monthly payment, then the income needed so that payment is about
          ${pp(A.maxHousingDti * 100)}% of gross pay. Read the full
          <a href="${pre}methodology/index.html">methodology</a>.</p>
      </section>
      ${atlasCta(pre)}
      ${disclaimer()}
    </div>`, { withMap: true });
  });
}

/* ---- State pages ------------------------------------------------------- */
const STATE_PAGES = ["MD", "VA", "PA"];
const STATE_NEIGHBORS = { MD: ["VA", "PA", "DE"], VA: ["MD", "NC", "TN"], PA: ["MD", "OH", "NJ"] };
function buildStatePages() {
  // National mid-tier reference = cross-state median (context, not population-weighted).
  const midVals = STATES.map((s) => evalState(s, { layer: "median" }).scenarioPrice)
    .filter((v) => v != null).sort((a, b) => a - b);
  const natMid = midVals.length ? midVals[Math.floor(midVals.length / 2)] : null;
  // Rank states by median-home affordability score for context lines.
  const rankList = STATES.map((s) => ({ abbr: s.abbr, score: evalState(s, { layer: "median" }).score }))
    .filter((r) => r.score != null).sort((a, b) => b.score - a.score);
  const rankOf = {}; rankList.forEach((r, i) => (rankOf[r.abbr] = i + 1));

  STATE_PAGES.forEach((abbr) => {
    const s = slugStates[abbr];
    const e = evalState(s, { layer: "median" });
    const eStarter = evalState(s, { layer: "starter" });
    const eFamily = evalState(s, { layer: "family" });
    const incomeLabel = e.provenance.income === "census" ? "U.S. Census ACS median household income" : "an illustrative median income";
    const incomeVal = e.region.income.value;
    const rank = rankOf[abbr], total = rankList.length;
    const vsNat = (natMid && e.scenarioPrice) ? Math.round(((e.scenarioPrice - natMid) / natMid) * 100) : null;
    const places = PLACES.filter((p) => p.stateAbbr === abbr);
    const url = `states/${s.slug}/index.html`;
    const trail = [["index.html", "Home"], ["map/index.html", "Map"], [url, s.name]];
    const faqs = [
      { q: `What income do you need to buy a home in ${s.name}?`,
        a: `With a typical (mid-tier) ${s.name} home around ${money(e.scenarioPrice)}, the estimated payment is about ${money(e.monthlyPayment)}/month, which generally calls for a household income near ${money(e.incomeNeeded)} (keeping housing close to ${(pp(A.maxHousingDti*100))}% of gross income). A starter home (~${money(eStarter.scenarioPrice)}) lowers that to roughly ${money(eStarter.incomeNeeded)}. Your real figure depends on down payment, rate, and local taxes — model it on <a href="${A.atlas.calculator}" rel="noopener">Home Payment Atlas</a>.` },
      { q: `Is ${s.name} affordable compared with other states?`,
        a: `${s.name} ranks ${rank} of ${total} for estimated median-home buying affordability (score ${e.score}/100, ${e.band.label.toLowerCase()})${vsNat != null ? `, with home values about ${Math.abs(vsNat)}% ${vsNat >= 0 ? "above" : "below"} the cross-state median` : ""}. Compare it on the <a href="../../rankings/most-affordable-states/index.html">most affordable states ranking</a>.` },
      { q: `Where do these ${s.name} numbers come from?`,
        a: `Home values are Zillow Research ZHVI${ZVINTAGE ? ` (${ZVINTAGE})` : ""}; rent is the Zillow ZORI index; income is ${incomeLabel}. They are estimates for comparison, not appraisals. Customize the mortgage math on the <a href="${HAM.atlasStateUrl(abbr)}" rel="noopener">${s.name} page on Home Payment Atlas</a>.` }
    ];
    const meta = {
      url,
      title: `${s.name} Housing Affordability — Home Values, Income Needed & Rankings`,
      description: `${s.name} housing affordability: typical home value ${money(e.scenarioPrice)}, est. payment ${money(e.monthlyPayment)}/mo, income needed ${money(e.incomeNeeded)}. Zillow + Census data, county rankings, and a payment calculator.`,
      jsonld: [breadcrumbJsonLd(trail), faqJsonLd(faqs),
        { "@context": "https://schema.org", "@type": "Dataset",
          name: `${s.name} housing affordability estimates`,
          description: `Estimated home values, monthly payment, income needed, and rent burden for ${s.name}, derived from Zillow Research and U.S. Census data.`,
          creator: { "@type": "Organization", name: SITE.name },
          isBasedOn: ["https://www.zillow.com/research/data/", "https://www.census.gov/programs-surveys/acs/"],
          url: SITE.origin + "/" + url.replace(/index\.html$/, "") }]
    };
    page(meta, (pre) => `
    <div class="wrap">
      ${breadcrumbs(pre, trail)}
      <h1>${esc(s.name)} Housing Affordability</h1>
      <p class="lede">What it takes to afford a home in ${esc(s.name)}, using Zillow Research home
        values and ${e.provenance.income === "census" ? "Census income data" : "income context"}.
        ${esc(s.name)} ranks <strong>${rank} of ${total}</strong> states for estimated median-home
        affordability${vsNat != null ? `, with typical values about ${Math.abs(vsNat)}% ${vsNat >= 0 ? "above" : "below"} the cross-state median` : ""}.</p>
      ${ad("horizontal")}
      <section class="section">
        <h2>${esc(s.name)} affordability summary</h2>
        ${statCards(e, { priceNote: "Zillow mid-tier ZHVI" })}
        <p>At a typical home value of ${money(e.scenarioPrice)} against ${incomeLabel.replace("U.S. ", "")}
          of ${money(incomeVal)}, ${esc(s.name)} scores <strong>${e.score}/100</strong>
          (${e.band.label.toLowerCase()}) for estimated buying affordability. A starter home runs about
          ${money(eStarter.scenarioPrice)} (income needed ~${money(eStarter.incomeNeeded)}); a 3-bedroom
          family home about ${money(eFamily.scenarioPrice)} (income needed ~${money(eFamily.incomeNeeded)}).</p>
        ${sourceStrip()}
      </section>

      <section class="section">
        <h2>Affordability by home type in ${esc(s.name)}</h2>
        <p>How the same income picture shifts across Zillow price tiers:</p>
        <div class="table-wrap"><table class="data-table">
          <caption class="table-caption">${esc(s.name)} home tiers — Zillow ZHVI${ZVINTAGE ? `, ${ZVINTAGE}` : ""}.</caption>
          <thead><tr><th scope="col">Home type</th><th scope="col">Est. value</th><th scope="col">Est. payment</th><th scope="col">Income needed</th><th scope="col">Score</th></tr></thead>
          <tbody>
            <tr><td>Starter (bottom tier)</td><td>${money(eStarter.scenarioPrice)}</td><td>${money(eStarter.monthlyPayment)}</td><td>${money(eStarter.incomeNeeded)}</td><td><span class="score-pill" data-band="${eStarter.band.key}">${eStarter.score}</span></td></tr>
            <tr><td>Median (mid tier)</td><td>${money(e.scenarioPrice)}</td><td>${money(e.monthlyPayment)}</td><td>${money(e.incomeNeeded)}</td><td><span class="score-pill" data-band="${e.band.key}">${e.score}</span></td></tr>
            <tr><td>Family home (3BR)</td><td>${money(eFamily.scenarioPrice)}</td><td>${money(eFamily.monthlyPayment)}</td><td>${money(eFamily.incomeNeeded)}</td><td><span class="score-pill" data-band="${eFamily.band.key}">${eFamily.score}</span></td></tr>
          </tbody>
        </table></div>
      </section>

      <section class="section">
        <h2>Cities in ${esc(s.name)}</h2>
        <p>Major ${esc(s.name)} cities ranked by estimated buying-affordability score, using Zillow city
          home values and Census city income.</p>
        ${placeTable(pre, places, { caption: `${s.name} city affordability — Zillow ZHVI/ZORI${ZVINTAGE ? ", " + ZVINTAGE : ""} and Census ACS.` })}
      </section>

      ${ad("incontent")}

      <section class="section">
        <h2>What different incomes can afford in ${esc(s.name)}</h2>
        <p>Estimated largest home price affordable at each income (${(pp(A.downPaymentPct*100))}% down,
          ${(A.interestRate*100).toFixed(2)}% rate), compared with the ${money(e.scenarioPrice)} typical home:</p>
        ${incomeScenarioTable(s, e.scenarioPrice)}
      </section>

      ${atlasCta(pre, { stateUrl: HAM.atlasStateUrl(abbr), stateLabel: `See ${s.name} payment assumptions on Home Payment Atlas`, calcUrl: HAM.atlasCalcUrl(e.scenarioPrice, { income: incomeVal }) })}

      <section class="section">
        <h2>Nearby &amp; related states</h2>
        <ul class="pill-links">
          ${STATE_NEIGHBORS[abbr].map((n) => {
            const ns = slugStates[n];
            const linkable = STATE_PAGES.indexOf(n) !== -1;
            return linkable
              ? `<li><a href="${pre}states/${ns.slug}/index.html">${esc(ns.name)}</a></li>`
              : `<li><span class="pill-muted">${esc(ns.name)}</span></li>`;
          }).join("")}
          <li><a href="${pre}rankings/most-affordable-states/index.html">All states ranked</a></li>
        </ul>
      </section>

      ${faqSection(faqs)}
      ${disclaimer()}
    </div>`);
  });
}

function incomeScenarioTable(s, typicalHome) {
  const ref = typicalHome || evalState(s, { layer: "median" }).scenarioPrice;
  const rows = A.incomeScenarios.map((inc) => {
    const max = HAM.maxHomePrice(inc);
    const canAfford = ref != null && max >= ref;
    return `<tr><td>${money(inc)}</td><td>${money(max)}</td>
      <td>${canAfford ? "<span class=\"score-pill\" data-band=\"s4\">Likely</span>" : "<span class=\"score-pill\" data-band=\"s2\">Stretch</span>"}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="data-table">
    <caption class="table-caption">Estimated buying power by income (${(pp(A.downPaymentPct*100))}% down, ${(A.interestRate*100).toFixed(2)}% rate). Typical ${esc(s.name)} home: ${money(ref)}.</caption>
    <thead><tr><th scope="col">Household income</th><th scope="col">Est. max home price</th><th scope="col">Typical home in reach?</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

/* ---- Place pages ------------------------------------------------------- */
function buildPlacePages() {
  PLACE_PAGES.forEach((slug) => {
    const p = placeBySlug[slug];
    const s = slugStates[p.stateAbbr];
    const e = evalPlace(p, { layer: "median" });
    const eStarter = evalPlace(p, { layer: "starter" });
    const url = `places/${slug}/index.html`;
    const isCounty = p.type === "county";
    const complete = e.complete;            // city with real home value + income
    const hasHome = e.scenarioPrice != null;
    const incomeReal = e.region.income.src === "census";
    const rentReal = e.region.rent.src === "zillow";
    const trail = [["index.html", "Home"], ["map/index.html", "Map"],
      [`states/${s.slug}/index.html`, s.name], [url, p.name]];
    const stateMid = evalState(s, { layer: "median" });

    const rentVsBuy = (e.rentBurden != null && hasHome)
      ? `Median rent runs about ${money(e.region.rent.value)}/month (${pct(e.rentBurden)} of income), versus an estimated ${money(e.monthlyPayment)}/month to own a typical home. `
      : (e.region.rent.value != null
        ? `Median rent runs about ${money(e.region.rent.value)}/month. `
        : "");

    const faqs = [
      hasHome
        ? { q: `How much income do you need to buy in ${p.name}, ${p.stateAbbr}?`,
            a: `For a typical home around ${money(e.scenarioPrice)} (Zillow ZHVI${ZVINTAGE ? ", " + ZVINTAGE : ""}), the estimated payment is roughly ${money(e.monthlyPayment)}/month and the income needed is near ${money(e.incomeNeeded)}. A starter home (~${money(eStarter.scenarioPrice)}) lowers that to about ${money(eStarter.incomeNeeded)}. Model your own scenario on <a href="${A.atlas.calculator}" rel="noopener">Home Payment Atlas</a>.` }
        : { q: `What is the typical home value in ${p.name}?`,
            a: `Zillow Research publishes home values at city, metro, and state level but not for individual counties in the datasets used here, so a ${p.name} home value is not available yet. Income and rent below are from current data; for buying math, see ${esc(s.name)} (typical home ~${money(stateMid.scenarioPrice)}) or use the <a href="${A.atlas.calculator}" rel="noopener">mortgage calculator</a>.` },
      { q: `Is it cheaper to rent or buy in ${p.name}?`,
        a: `${rentVsBuy}Rent-vs-buy depends on how long you stay, your down payment, and maintenance. Compare scenarios on the <a href="${A.atlas.calculator}" rel="noopener">Home Payment Atlas calculator</a>.` },
      { q: `Where do these ${p.name} figures come from?`,
        a: `${hasHome ? "Home value and rent are from Zillow Research (ZHVI/ZORI" + (ZVINTAGE ? ", " + ZVINTAGE : "") + "). " : "Rent is from Zillow Research (ZORI). "}Income and population are from the U.S. Census Bureau (ACS 5-year ${CENSUS ? "2023" : ""}). They are estimates for comparison, not appraisals. Zillow does not endorse this site.` }
    ];
    const meta = {
      url,
      title: hasHome
        ? `${p.name}, ${p.stateAbbr} Housing Affordability — Home Value, Payment & Income`
        : `${p.name}, ${p.stateAbbr} — Income, Rent & Affordability Context`,
      description: hasHome
        ? `${p.name}, ${p.stateAbbr}: typical home ${money(e.scenarioPrice)}, est. payment ${money(e.monthlyPayment)}/mo, income needed ${money(e.incomeNeeded)}. Zillow + Census data; customize on Home Payment Atlas.`
        : `${p.name}, ${p.stateAbbr} income, rent, and affordability context from Census and Zillow data. County home values are not yet available.`,
      // County pages lack a Zillow home value, so keep them out of the index
      // until a county home-value source is added.
      noindex: !complete,
      jsonld: [breadcrumbJsonLd(trail), faqJsonLd(faqs)].concat(complete ? [
        { "@context": "https://schema.org", "@type": "Dataset",
          name: `${p.name}, ${p.stateAbbr} housing affordability estimates`,
          description: `Home value, payment, income needed, and rent burden for ${p.name}, derived from Zillow Research and U.S. Census data.`,
          isBasedOn: ["https://www.zillow.com/research/data/", "https://www.census.gov/programs-surveys/acs/"],
          url: SITE.origin + "/" + url.replace(/index\.html$/, "") }] : [])
    };
    const nearby = (p.nearby || []).map((ns) => placeBySlug[ns]).filter(Boolean);
    const naCard = (k, note) => `<div class="stat-card"><span class="stat-k">${k}</span><span class="stat-v">Not available</span><span class="stat-note">${note}</span></div>`;
    const cards = hasHome
      ? statCards(e, { priceNote: `Zillow mid-tier ZHVI` })
      : `<div class="stat-cards">
          ${naCard("Estimated home value", "County-level Zillow ZHVI not published")}
          ${naCard("Estimated monthly payment", "Needs a home value")}
          <div class="stat-card"><span class="stat-k">Median household income</span><span class="stat-v">${money(e.region.income.value)}</span><span class="stat-note">U.S. Census ACS</span></div>
          <div class="stat-card"><span class="stat-k">Median rent</span><span class="stat-v">${e.region.rent.value != null ? money(e.region.rent.value) + "/mo" : "—"}</span><span class="stat-note">Zillow ZORI</span></div>
          <div class="stat-card"><span class="stat-k">Population</span><span class="stat-v">${e.region.population != null ? e.region.population.toLocaleString("en-US") : "—"}</span><span class="stat-note">U.S. Census ACS</span></div>
        </div>`;

    page(meta, (pre) => `
    <div class="wrap">
      ${breadcrumbs(pre, trail)}
      <h1>${esc(p.name)}, ${esc(p.stateAbbr)} — Housing Affordability</h1>
      <p class="lede">${hasHome
        ? `${esc(p.name)} has a typical home value of <strong>${money(e.scenarioPrice)}</strong> (Zillow ZHVI${ZVINTAGE ? ", " + ZVINTAGE : ""}) against a median household income of ${money(e.region.income.value)} (Census ACS), within <a href="${pre}states/${s.slug}/index.html">${esc(s.name)}</a>.`
        : `Income, rent, and population for ${esc(p.name)} from current data, within <a href="${pre}states/${s.slug}/index.html">${esc(s.name)}</a>. County-level home values are not published in the Zillow datasets used here.`}</p>
      ${!complete ? `<p class="data-flag" role="note">Limited data: a county-level home value is not available, so this page is not indexed for search until that data is added.</p>` : ""}
      ${ad("horizontal")}
      <section class="section">
        <h2>Local affordability summary</h2>
        ${cards}
        ${placeSourceStrip(e)}
      </section>
      ${hasHome ? `<section class="section">
        <h2>Payment &amp; income at a glance</h2>
        <div class="callout-grid">
          <div class="callout"><h3>Estimated payment</h3><p>${money(e.monthlyPayment)}/mo for a typical home (~${money(e.scenarioPrice)}), including taxes, insurance, and PMI.</p></div>
          <div class="callout"><h3>Income needed</h3><p>About ${money(e.incomeNeeded)}/yr to keep housing near ${(pp(A.maxHousingDti*100))}% of gross income.</p></div>
          <div class="callout"><h3>Rent vs. buy</h3><p>${rentVsBuy || "Rent data not available for this place yet."}</p></div>
        </div>
      </section>` : ""}
      ${atlasCta(pre, { stateUrl: HAM.atlasStateUrl(p.stateAbbr), stateLabel: `See ${s.name} assumptions on Home Payment Atlas`, calcUrl: HAM.atlasCalcUrl(hasHome ? e.scenarioPrice : stateMid.scenarioPrice, { income: e.region.income.value }) })}
      ${ad("incontent")}
      ${nearby.length ? `<section class="section">
        <h2>Nearby places</h2>
        <ul class="pill-links">
          ${nearby.map((np) => pageExistsForPlace(np.slug)
            ? `<li><a href="${pre}places/${np.slug}/index.html">${esc(np.name)}</a></li>`
            : `<li><span class="pill-muted">${esc(np.name)}, ${np.stateAbbr}</span></li>`).join("")}
          <li><a href="${pre}states/${s.slug}/index.html">All of ${esc(s.name)}</a></li>
        </ul>
      </section>` : ""}
      ${faqSection(faqs)}
      ${disclaimer()}
    </div>`);
  });
}

// Provenance strip specific to a place evaluation.
function placeSourceStrip(e) {
  const bits = [];
  if (e.provenance.homeValue === "zillow") bits.push(`Home value: Zillow ZHVI${ZVINTAGE ? ", " + ZVINTAGE : ""}`);
  if (e.provenance.rent === "zillow") bits.push("Rent: Zillow ZORI");
  if (e.provenance.income === "census") bits.push("Income & population: U.S. Census ACS 2023");
  return `<p class="source-strip">Sources — ${bits.join(" · ")}. Zillow does not endorse this site.</p>`;
}

/* ---- Income pages ------------------------------------------------------ */
function buildIncomePages() {
  A.incomeScenarios.forEach((inc) => {
    const maxPrice = HAM.maxHomePrice(inc);
    const url = `income/${inc}/index.html`;
    const trail = [["index.html", "Home"], ["income/75000/index.html", "By income"], [url, money(inc)]];
    // States whose mid-tier (Zillow) home is within reach, ranked by score.
    const reachable = STATES.map((s) => ({ s, e: evalState(s, { income: inc, layer: "median" }) }))
      .filter((r) => r.e.scenarioPrice != null && r.e.scenarioPrice <= maxPrice)
      .sort((a, b) => b.e.score - a.e.score);
    // States where at least a starter (bottom-tier) home is within reach.
    const starterReach = STATES.map((s) => ({ s, e: evalState(s, { income: inc, layer: "starter" }) }))
      .filter((r) => r.e.scenarioPrice != null && r.e.scenarioPrice <= maxPrice).length;
    const affordablePlaces = PLACES.filter((p) => p.medianHomeValue <= maxPrice);
    const faqs = [
      { q: `What home price can you afford on ${money(inc)} a year?`,
        a: `Using a ${(pp(A.downPaymentPct*100))}% down payment, a ${(A.interestRate*100).toFixed(2)}% rate, and a ${A.loanTermYears}-year term (plus taxes, insurance, and PMI), an income of ${money(inc)} supports an estimated home price up to about ${money(maxPrice)}, keeping housing near ${(pp(A.maxHousingDti*100))}% of gross pay.` },
      { q: `Where can I afford to live on ${money(inc)}?`,
        a: `Based on Zillow mid-tier home values, ${reachable.length} states have a typical home within that estimated budget, and ${starterReach} have at least a starter (bottom-tier) home in reach. See the ranked list above, then open a state or the <a href="../../map/index.html">map</a> for detail.` },
      { q: `How do I make this estimate personal?`,
        a: `Open the <a href="${HAM.atlasCalcUrl(maxPrice, { income: inc })}" rel="noopener">Home Payment Atlas calculator</a> to set your real down payment, rate, taxes, insurance, PMI, and HOA.` }
    ];
    const meta = {
      url,
      title: `Where Can I Afford to Live on ${money(inc)} a Year? Home Budget Map`,
      description: `On ${money(inc)} a year you can afford a home up to about ${money(maxPrice)}. See which states are within reach (Zillow home values), payment examples, and customize on Home Payment Atlas.`,
      jsonld: [breadcrumbJsonLd(trail), faqJsonLd(faqs)]
    };
    const samplePayment = HAM.payment(maxPrice);
    page(meta, (pre) => `
    <div class="wrap">
      ${breadcrumbs(pre, trail)}
      <h1>Where can I afford to live on ${money(inc)} a year?</h1>
      <p class="lede">On a household income of ${money(inc)}, a standard ${(pp(A.downPaymentPct*100))}%-down
        scenario supports an estimated home price up to about <strong>${money(maxPrice)}</strong> — keeping housing near
        ${(pp(A.maxHousingDti*100))}% of gross income.</p>
      ${ad("horizontal")}
      <section class="section">
        <h2>The assumptions behind this estimate</h2>
        <ul class="assume-list">
          <li>${(pp(A.downPaymentPct*100))}% down payment</li>
          <li>${(A.interestRate*100).toFixed(2)}% interest rate, ${A.loanTermYears}-year fixed</li>
          <li>Property tax ${(pp(A.propertyTaxRate*100))}%/yr, insurance ${(pp(A.insuranceRate*100))}%/yr, PMI ${(pp(A.pmiRate*100))}%/yr of the loan</li>
          <li>Housing capped near ${(pp(A.maxHousingDti*100))}% of gross income</li>
        </ul>
        <p>At the top of that budget (~${money(maxPrice)}), the estimated payment is about
          <strong>${money(samplePayment.total)}/month</strong>
          (${money(samplePayment.principalInterest)} principal &amp; interest +
          ${money(samplePayment.tax)} tax + ${money(samplePayment.insurance)} insurance +
          ${money(samplePayment.pmi)} PMI).</p>
      </section>
      <section class="section">
        <h2>States within reach on ${money(inc)}</h2>
        ${reachable.length
          ? placeTableFromStates(pre, reachable.slice(0, 15), inc)
          : "<p>No states have a typical (mid-tier) home within that estimated budget. Many still have starter homes in reach — try the <a href=\"" + pre + "map/income-needed/index.html\">income-needed map</a> or the starter-home view.</p>"}
        ${sourceStrip()}
      </section>
      ${ad("incontent")}
      ${affordablePlaces.length ? `<section class="section">
        <h2>Illustrative markets with homes at or below ${money(maxPrice)}</h2>
        ${placeTable(pre, affordablePlaces.slice(0, 12), { income: inc, caption: `Illustrative places with a typical home at or below ${money(maxPrice)} (city/county figures pending Zillow place-level import).` })}
      </section>` : ""}
      <section class="section">
        <h2>Other income levels</h2>
        <ul class="pill-links">
          ${A.incomeScenarios.map((v) => v === inc
            ? `<li><span class="pill-muted">${money(v)}</span></li>`
            : `<li><a href="${pre}income/${v}/index.html">${money(v)}</a></li>`).join("")}
        </ul>
      </section>
      ${atlasCta(pre, { calcUrl: HAM.atlasCalcUrl(maxPrice) })}
      ${faqSection(faqs)}
      ${disclaimer()}
    </div>`);
  });
}

function placeTableFromStates(pre, rows, income) {
  const body = rows.map((r, i) => {
    const s = r.s, e = r.e;
    return `<tr><td>${i + 1}</td>
      <td>${stateNameCell(pre, s)}</td>
      <td>${money(e.scenarioPrice)}</td>
      <td>${money(e.monthlyPayment)}</td>
      <td><span class="score-pill" data-band="${e.band.key}">${e.score == null ? "—" : e.score}</span></td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="data-table">
    <caption class="table-caption">States with a typical (Zillow mid-tier) home within an estimated ${money(income)} budget${ZVINTAGE ? `, ${ZVINTAGE}` : ""}.</caption>
    <thead><tr><th scope="col">#</th><th scope="col">State</th><th scope="col">Typical home</th>
    <th scope="col">Est. payment</th><th scope="col">Score</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

// Crawlable state rent-burden table (Zillow ZORI rent vs income), worst first.
function rentTable(pre, opts) {
  opts = opts || {};
  let rows = STATES.map((s) => ({ s, e: evalState(s, { layer: "median" }) }))
    .filter((r) => r.e.rentBurden != null);
  rows.sort((a, b) => opts.leastFirst ? a.e.rentBurden - b.e.rentBurden : b.e.rentBurden - a.e.rentBurden);
  const body = rows.map((r, i) => {
    const s = r.s, e = r.e;
    return `<tr><td>${i + 1}</td><td>${stateNameCell(pre, s)}</td>
      <td>${money(e.region.rent.value)}/mo</td>
      <td>${money(e.region.income.value)}</td>
      <td>${pct(e.rentBurden)}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="data-table">
    <caption class="table-caption">Estimated rent burden by state — Zillow ZORI rent ÷ income${ZVINTAGE ? `, ${ZVINTAGE}` : ""}. Above ~30% is considered rent burdened.</caption>
    <thead><tr><th scope="col">#</th><th scope="col">State</th><th scope="col">Est. rent</th>
    <th scope="col">Income</th><th scope="col">Rent burden</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

// Component datasets behind the market-signal indices (data roadmap).
const SIGNAL_COMPONENTS = [
  { name: "For-sale inventory", what: "more choice favors buyers", status: "pending" },
  { name: "Share of listings with a price cut", what: "rising cuts favor buyers", status: "pending" },
  { name: "Days to pending", what: "slower sales favor buyers", status: "pending" },
  { name: "Zillow Market Heat Index", what: "lower heat favors buyers", status: "pending" }
];

function buildRankingPages() {
  // slug -> short label for cross-linking
  const liveDefs = [
    {
      slug: "most-affordable-states", h1: "Most Affordable States to Buy a Home",
      title: "Most Affordable States to Buy a Home (2026 Ranking)",
      desc: "The most affordable U.S. states to buy a home, by estimated buying-affordability score combining Zillow home values with income context.",
      intro: "States ranked by estimated buying-affordability score for a mid-tier home — comparing household income with the income needed to buy.",
      methodLine: "Higher scores mean income covers the income needed for a mid-tier Zillow home value more comfortably.",
      table: (pre) => stateTable(pre, { metric: "score", layer: "median" })
    },
    {
      slug: "most-affordable-starter-home-markets", h1: "Most Affordable Starter-Home Markets",
      title: "Most Affordable Starter-Home Markets (Zillow Bottom-Tier)",
      desc: "States where entry-level (Zillow bottom-tier) homes are most attainable for a typical income — a starter-home affordability ranking.",
      intro: "States ranked by starter-home affordability, using Zillow's bottom-tier home value index against income. Ideal for first-time and budget-focused buyers.",
      methodLine: "Uses Zillow bottom-tier ZHVI (entry-level homes) rather than the mid-tier typical home.",
      table: (pre) => stateTable(pre, { metric: "score", layer: "starter" })
    },
    {
      slug: "affordable-family-home-markets", h1: "Affordable Family-Home Markets",
      title: "Most Affordable Family-Home Markets (3-Bedroom)",
      desc: "States where 3-bedroom family homes are most affordable, using Zillow's bedroom-count home value index against income.",
      intro: "States ranked by affordability of a 3-bedroom family home, using Zillow's by-bedroom home value index. This is the family-home affordability gap in action.",
      methodLine: "Uses Zillow 3-bedroom ZHVI (falling back to 4-bedroom or mid-tier where unavailable).",
      table: (pre) => stateTable(pre, { metric: "score", layer: "family" })
    },
    {
      slug: "lowest-income-needed", h1: "Lowest Income Needed to Buy",
      title: "States With the Lowest Income Needed to Buy a Home",
      desc: "States ranked by the lowest estimated household income needed to buy a typical home, using Zillow home values and standard mortgage assumptions.",
      intro: "States ranked from the lowest estimated income needed to buy a typical (mid-tier) home to the highest.",
      methodLine: "Income needed is the payment for a mid-tier Zillow home scaled so housing is about 28% of gross income.",
      table: (pre) => stateTable(pre, { metric: "incomeNeeded", layer: "median" })
    },
    {
      slug: "most-rent-burdened-markets", h1: "Most Rent-Burdened States",
      title: "Most Rent-Burdened States (Rent vs Income)",
      desc: "States where rent consumes the largest share of income, using the Zillow rent index against household income.",
      intro: "States ranked by estimated rent burden — Zillow rent as a share of income. This captures rent-vs-income pressure, where renting strains budgets most.",
      methodLine: "Rent burden is the Zillow ZORI rent index (state = median of city ZORI) divided by income, annualized.",
      table: (pre) => rentTable(pre, {})
    },
    {
      slug: "most-affordable-places-to-buy", h1: "Most Affordable Cities to Buy",
      title: "Most Affordable Cities to Buy a Home",
      desc: "Affordable U.S. cities to buy a home, ranked by estimated affordability score using Zillow city home values and Census city income.",
      intro: "Major U.S. cities ranked by estimated buying-affordability score, using Zillow city-level home values (ZHVI) and Census city income.",
      methodLine: "Each city combines its Zillow mid-tier home value with Census income and the standard mortgage assumptions.",
      placeBased: true,
      table: (pre) => placeTable(pre, PLACES, { layer: "median", caption: "Most affordable cities to buy — Zillow ZHVI/ZORI and Census ACS." })
    },
    {
      slug: "best-places-for-first-time-buyers", h1: "Best Cities for First-Time Buyers",
      title: "Best Cities for First-Time Buyers (Starter Homes)",
      desc: "U.S. cities that may suit first-time buyers, ranking entry-level (Zillow bottom-tier) home affordability against city income.",
      intro: "First-time buyers often target lower-priced starter homes. This ranks cities by entry-level (Zillow bottom-tier) home affordability against Census city income.",
      methodLine: "Uses each city's Zillow bottom-tier home value with Census income and the standard mortgage assumptions.",
      placeBased: true,
      table: (pre) => placeTable(pre, PLACES, { layer: "starter", caption: "First-time-buyer-friendly cities (Zillow bottom-tier ZHVI) and Census ACS." })
    }
  ];

  const roadmapDefs = [
    {
      slug: "best-buyer-opportunity-markets", h1: "Best Buyer-Opportunity Markets",
      title: "Best Buyer-Opportunity Markets (Buyer Opportunity Score)",
      desc: "A directional Buyer Opportunity Score combining for-sale inventory, price cuts, days to pending, and market heat. Part of our data roadmap.",
      intro: "The Buyer Opportunity Score is a directional index of how buyer-friendly a market is — blending inventory, price cuts, days to pending, and market heat. It is a signal, not a guarantee, and activates when those Zillow datasets are imported.",
      indexName: "Buyer Opportunity Score"
    },
    {
      slug: "markets-with-most-price-cuts", h1: "Markets With the Most Price Cuts",
      title: "Housing Markets With the Most Price Cuts",
      desc: "Markets where sellers are cutting prices most often — a price-cut opportunity signal. Part of our data roadmap.",
      intro: "A high share of listings with price cuts can signal negotiating room for buyers. This price-cut opportunity ranking activates when the Zillow price-cut dataset is imported.",
      indexName: "Price-cut share"
    },
    {
      slug: "least-competitive-housing-markets", h1: "Least Competitive Housing Markets",
      title: "Least Competitive Housing Markets (Buyer-Favorable)",
      desc: "Buyer-favorable markets with slower sales and cooler demand, by the Zillow Market Heat Index. Part of our data roadmap.",
      intro: "Least-competitive markets give buyers more time and leverage — slower days to pending and a cooler Market Heat Index. This ranking activates when those Zillow datasets are imported.",
      indexName: "Market Heat Index"
    }
  ];

  const allSlugs = liveDefs.concat(roadmapDefs);
  const rankingNav = (pre, current) => `<section class="section">
    <h2>Explore more rankings</h2>
    <ul class="pill-links">
      ${allSlugs.map((o) => o.slug === current
        ? `<li><span class="pill-muted">${esc(o.h1)}</span></li>`
        : `<li><a href="${pre}rankings/${o.slug}/index.html">${esc(o.h1)}</a></li>`).join("")}
    </ul>
  </section>`;

  // ---- Live, data-backed ranking pages ----
  liveDefs.forEach((dpage) => {
    const url = `rankings/${dpage.slug}/index.html`;
    const trail = [["index.html", "Home"], ["rankings/most-affordable-states/index.html", "Rankings"], [url, dpage.h1]];
    const faqs = [
      { q: "Where does this ranking's data come from?",
        a: "Home values and rent are from Zillow Research (ZHVI/ZORI)" + (ZVINTAGE ? ", " + ZVINTAGE : "") + "; income is from the U.S. Census Bureau" + (CENSUS ? " (ACS 5-year 2023)" : "") + ". Figures are estimates, not appraisals." },
      { q: "How is the ranking calculated?",
        a: dpage.methodLine + " Full details are on the <a href=\"../../methodology/index.html\">methodology page</a>." },
      { q: "How do I adjust the assumptions?",
        a: "Open the <a href=\"" + A.atlas.calculator + "\" rel=\"noopener\">Home Payment Atlas calculator</a> to set your own down payment, rate, taxes, insurance, and PMI." }
    ];
    // City-based rankings need enough real records to be worth indexing.
    const MIN_CITIES = 12;
    const thinPlaceRanking = dpage.placeBased && completeCityCount() < MIN_CITIES;
    const meta = {
      url, title: dpage.title + " | Housing Affordability Atlas", description: dpage.desc,
      noindex: thinPlaceRanking,
      jsonld: [breadcrumbJsonLd(trail), faqJsonLd(faqs)]
    };
    page(meta, (pre) => `
    <div class="wrap">
      ${breadcrumbs(pre, trail)}
      <h1>${esc(dpage.h1)}</h1>
      <p class="lede">${esc(dpage.intro)}</p>
      ${thinPlaceRanking ? `<p class="data-flag" role="note">This ranking is not yet indexed for search: more real city records are being added before publishing it.</p>` : ""}
      ${ad("horizontal")}
      <section class="section">
        ${dpage.table(pre)}
        ${sourceStrip()}
      </section>
      ${ad("incontent")}
      <section class="section">
        <h2>How this ranking is built</h2>
        <p>${esc(dpage.methodLine)} Every figure is an educational estimate. See the full
          <a href="${pre}methodology/index.html">methodology</a>, then customize the math on the
          <a href="${A.atlas.calculator}" rel="noopener">Home Payment Atlas mortgage calculator</a>.</p>
      </section>
      ${rankingNav(pre, dpage.slug)}
      ${atlasCta(pre)}
      ${faqSection(faqs)}
      ${disclaimer()}
    </div>`);
  });

  // ---- Data-roadmap (market-signal) ranking pages ----
  roadmapDefs.forEach((dpage) => {
    const url = `rankings/${dpage.slug}/index.html`;
    const trail = [["index.html", "Home"], ["rankings/most-affordable-states/index.html", "Rankings"], [url, dpage.h1]];
    const faqs = [
      { q: `Why isn't the ${dpage.indexName} live yet?`,
        a: "It depends on Zillow market-signal datasets (inventory, price cuts, days to pending, market heat) that are not yet imported. We publish numbers only when the underlying data is in place — no fabricated figures." },
      { q: "Is this index financial advice?",
        a: "No. It is a directional, educational signal of market conditions, not a guarantee, prediction, or financial, mortgage, or real-estate advice." },
      { q: "What can I use right now?",
        a: "The affordability rankings are fully live on Zillow home-value data — see the most affordable states and starter-home markets below, or open the <a href=\"" + A.atlas.calculator + "\" rel=\"noopener\">mortgage calculator</a>." }
    ];
    const meta = {
      url, title: dpage.title + " | Housing Affordability Atlas", description: dpage.desc,
      jsonld: [breadcrumbJsonLd(trail), faqJsonLd(faqs)]
    };
    page(meta, (pre) => `
    <div class="wrap">
      ${breadcrumbs(pre, trail)}
      <h1>${esc(dpage.h1)}</h1>
      <p class="lede">${esc(dpage.intro)}</p>
      ${ad("horizontal")}
      <section class="section roadmap-note" role="note">
        <h2>On the data roadmap</h2>
        <p>The <strong>${esc(dpage.indexName)}</strong> is a directional index, not a guarantee. To keep
          this site trustworthy, we do not publish placeholder market-signal numbers. This ranking goes
          live once these Zillow Research datasets are imported:</p>
        <ul class="status-list">
          ${SIGNAL_COMPONENTS.map((c) => `<li><span class="status-dot" data-status="${c.status}"></span>${esc(c.name)} — <span class="muted">${esc(c.what)}; ${esc(c.status)}</span></li>`).join("")}
        </ul>
      </section>
      <section class="section">
        <h2>What you can explore right now</h2>
        <p>Our affordability layers are fully live on Zillow home-value data. While the market-signal
          index is being wired up, here are the most affordable states to buy today:</p>
        ${stateTable(pre, { metric: "score", layer: "median", limit: 10 })}
        ${sourceStrip()}
      </section>
      ${ad("incontent")}
      ${rankingNav(pre, dpage.slug)}
      ${atlasCta(pre)}
      ${faqSection(faqs)}
      ${disclaimer()}
    </div>`);
  });
}

/* ---- Info pages: methodology, about, privacy, terms -------------------- */
function buildInfoPages() {
  // Methodology
  page({
    url: "methodology/index.html",
    title: "Methodology — How We Estimate Affordability | Housing Affordability Atlas",
    description: "How Housing Affordability Atlas estimates payments, income needed, affordability scores, and rent burden — the assumptions, the math, and what it does not know.",
    jsonld: [breadcrumbJsonLd([["index.html", "Home"], ["methodology/index.html", "Methodology"]])]
  }, (pre) => `
  <div class="wrap narrow">
    ${breadcrumbs(pre, [["index.html", "Home"], ["methodology/index.html", "Methodology"]])}
    <h1>Methodology &amp; data sources</h1>
    <p class="lede">This is a market-discovery tool built on public and research data with transparent,
      editable assumptions. Here is exactly where the data comes from, how every number is produced, and
      what we deliberately leave to a detailed calculator.</p>
    ${ad("horizontal")}

    <h2>Data sources at a glance</h2>
    <div class="table-wrap"><table class="data-table">
      <caption class="table-caption">Where each field comes from and its current status.</caption>
      <thead><tr><th scope="col">Field</th><th scope="col">Source</th><th scope="col">Vintage</th><th scope="col">Status</th></tr></thead>
      <tbody>
        ${Object.keys(SOURCES.fields).map((k) => {
          const f = SOURCES.fields[k];
          return `<tr><td>${esc(f.label)}</td>
            <td><a href="${esc(f.sourceUrl)}" rel="noopener">${esc(f.source)}</a></td>
            <td>${esc(f.vintage || "—")}</td>
            <td><span class="status-dot" data-status="${esc(f.status)}"></span>${esc(f.status)}</td></tr>`;
        }).join("")}
      </tbody>
    </table></div>

    <h2>Roles of each source</h2>
    <p><strong>Zillow Research</strong> supplies housing-market texture: home values by tier (ZHVI
      bottom/mid/top and by bedroom count) and the rent index (ZORI). We use only Zillow's aggregate
      research datasets — never listings, photos, or individual property details — and Zillow does not
      endorse this site. <strong>The U.S. Census Bureau</strong> is the backbone for official public-data
      context: household income (ACS), population, FIPS codes, and the state/county geography that draws
      the map. <strong>HUD Fair Market Rents</strong> can supplement rent where useful.
      <strong>Home Payment Atlas</strong> is the destination for detailed mortgage and payment
      customization — we link there rather than duplicating that math.</p>

    <h2>Derived insights (not copied tables)</h2>
    <p>We combine sources into original, directional signals: a <em>starter-home affordability score</em>
      (Zillow bottom-tier value vs income), a <em>median-</em> and <em>family-home affordability score</em>
      (mid-tier and 3-bedroom values), <em>rent-vs-income pressure</em> (ZORI vs income), and — on the
      roadmap — a <em>Buyer Opportunity Score</em> and <em>price-cut opportunity</em> index. Our state rent
      figure is itself derived: the median of Zillow city-level ZORI within each state.</p>

    <h2>How the monthly payment is calculated</h2>
    <p>We take the home value for the chosen tier, subtract a ${(pp(A.downPaymentPct*100))}% down payment, and
      amortize the loan at a ${(A.interestRate*100).toFixed(2)}% rate over ${A.loanTermYears} years for
      principal &amp; interest. We add property tax (${(pp(A.propertyTaxRate*100))}%/yr of value), homeowners
      insurance (${(pp(A.insuranceRate*100))}%/yr), and PMI (${(pp(A.pmiRate*100))}%/yr of the loan when down
      payment is under 20%).</p>
    <h2>How income needed &amp; the affordability score are calculated</h2>
    <p>Income needed scales the monthly payment so housing is about ${(pp(A.maxHousingDti*100))}% of gross
      income. The 0–100 score compares income with that income needed: a ratio of ${A.scoreFloorRatio} or
      below scores 0, ${A.scoreCeilRatio} or above scores 100, linear in between.</p>

    <h2>Market-signal layers (data roadmap)</h2>
    <p>The Buyer Opportunity, Market Heat, and Price-cut layers depend on Zillow inventory, price-cut,
      days-to-pending, and market-heat datasets that are not yet imported. Until then these layers show an
      honest "data coming soon" state — we never publish placeholder market numbers.</p>

    <h2>What this site does not know</h2>
    <p>It does not know your credit, exact local tax rate, HOA dues, insurance quote, loan program, or the
      rate you'll be offered. It is not a pre-approval and not advice. For any real decision, customize the
      scenario on <a href="${A.atlas.home}" rel="noopener">Home Payment Atlas</a> and confirm with a lender.</p>
    <h2>Customize on Home Payment Atlas</h2>
    <p>Home Payment Atlas is the companion calculator for detailed mortgage math. Use the
      <a href="${A.atlas.calculator}" rel="noopener">full mortgage calculator</a> to adjust every input, and
      review the <a href="${A.atlas.methodology}" rel="noopener">Home Payment Atlas methodology</a>.</p>
    ${disclaimer()}
  </div>`);

  // About
  page({
    url: "about/index.html",
    title: "About — Housing Affordability Atlas",
    description: "About Housing Affordability Atlas: a public-data-style discovery tool that pairs with Home Payment Atlas for detailed mortgage and payment math.",
    jsonld: [breadcrumbJsonLd([["index.html", "Home"], ["about/index.html", "About"]])]
  }, (pre) => `
  <div class="wrap narrow">
    ${breadcrumbs(pre, [["index.html", "Home"], ["about/index.html", "About"]])}
    <h1>About this site</h1>
    <p class="lede">Housing Affordability Atlas helps people explore, at a glance, where housing may still
      be within reach across the United States.</p>
    <p>It is part of the <strong>Atlas</strong> family of public-data housing tools, alongside
      <a href="${A.atlas.home}" rel="noopener">Home Payment Atlas</a>.</p>
    ${ad("horizontal")}
    <h2>What it is</h2>
    <p>It is an interactive map, rankings, and place-discovery tool built in a public-data style. It is
      intentionally not a brokerage or a listings site — there are no agents, no listings, and nothing for
      sale here. The goal is orientation: pick an income and a scenario, and see how affordability varies
      across the country.</p>
    <h2>How it relates to Home Payment Atlas</h2>
    <p>This site handles the map and the big-picture comparison. Its companion,
      <a href="${A.atlas.home}" rel="noopener">Home Payment Atlas</a>, handles the detailed payment math —
      mortgage calculators, payment scenarios, and state-level assumptions. When you find a place worth a
      closer look here, you continue to Home Payment Atlas to make the numbers your own.</p>
    <h2>Educational &amp; informational</h2>
    <p>Everything here is educational and informational. The figures are estimates derived from Zillow
      Research and U.S. Census data and are not financial, legal, tax, mortgage, or real-estate advice.
      Please read the <a href="${pre}methodology/index.html">methodology</a> and
      <a href="${pre}terms/index.html">terms</a>.</p>
    ${disclaimer()}
  </div>`);

  // Privacy
  page({
    url: "privacy/index.html",
    title: "Privacy Policy | Housing Affordability Atlas",
    description: "Privacy policy for Housing Affordability Atlas: cookies, analytics, advertising, third-party links, and contact information.",
    jsonld: [breadcrumbJsonLd([["index.html", "Home"], ["privacy/index.html", "Privacy"]])]
  }, (pre) => `
  <div class="wrap narrow">
    ${breadcrumbs(pre, [["index.html", "Home"], ["privacy/index.html", "Privacy"]])}
    <h1>Privacy policy</h1>
    <p class="lede">This page explains, in plain language, how this website handles information. It is a
      starting template — review it with a qualified professional before publishing.</p>
    <h2>Cookies</h2>
    <p>The core site works without personalization cookies. If analytics or advertising are enabled, those
      services may set cookies or similar identifiers in your browser.</p>
    <h2>Analytics</h2>
    <p>We may use privacy-respecting analytics to understand aggregate, anonymized usage (such as which
      pages are popular). This helps us improve the site.</p>
    <h2>Advertising</h2>
    <p>This site is designed to display ads, including via Google AdSense. Third-party vendors, including
      Google, may use cookies to serve ads based on prior visits to this and other websites. You can learn
      about your choices at <a href="https://policies.google.com/technologies/ads" rel="noopener">Google Ads</a>
      and <a href="https://www.aboutads.info/" rel="noopener">aboutads.info</a>.</p>
    <h2>Third-party links</h2>
    <p>We link to external sites, including Home Payment Atlas. We are not responsible for the content or
      privacy practices of other sites; review their policies separately.</p>
    <h2>No financial advice</h2>
    <p>This site provides educational estimates only and does not collect financial account information to
      provide personalized advice.</p>
    <h2>Contact</h2>
    <p>Questions about this policy can be sent to the site contact address listed at launch
      (contact placeholder — add your address before publishing).</p>
    ${disclaimer()}
  </div>`);

  // Terms
  page({
    url: "terms/index.html",
    title: "Terms & Disclaimer | Housing Affordability Atlas",
    description: "Terms of use and disclaimer for Housing Affordability Atlas: educational estimates only, not financial, legal, tax, mortgage, or real-estate advice.",
    jsonld: [breadcrumbJsonLd([["index.html", "Home"], ["terms/index.html", "Terms"]])]
  }, (pre) => `
  <div class="wrap narrow">
    ${breadcrumbs(pre, [["index.html", "Home"], ["terms/index.html", "Terms"]])}
    <h1>Terms &amp; disclaimer</h1>
    <p class="lede">Please read these terms before relying on anything you find here.</p>
    <h2>Educational estimates only</h2>
    <p>All figures on this site are educational estimates generated from public and research data (Zillow
      Research, U.S. Census Bureau) plus standard mortgage assumptions. They are illustrations, not quotes,
      appraisals, or guarantees.</p>
    <h2>Data attribution</h2>
    <p>Home values and rent are from Zillow Research; income, population, and geography from the U.S. Census
      Bureau. Zillow does not endorse this site, and this data is not official government data where Zillow
      is the source. We use only aggregate research datasets — not listings or individual property details.</p>
    <h2>Not professional advice</h2>
    <p>Nothing here is financial, legal, tax, mortgage, or real-estate advice, and nothing here is an offer
      to lend. Do not make decisions based solely on this site.</p>
    <h2>No guarantee of accuracy</h2>
    <p>We make no warranty that any number, score, or ranking is accurate, complete, or current. Data may be
      incomplete, outdated, or wrong.</p>
    <h2>Verify with official sources</h2>
    <p>Always verify numbers with licensed lenders, real-estate agents, tax authorities, insurers, and
      official government sources before acting. For detailed payment math, use
      <a href="${A.atlas.home}" rel="noopener">Home Payment Atlas</a> and confirm with a professional.</p>
    ${disclaimer()}
  </div>`);
}

/* ---- sitemap.xml + robots.txt ------------------------------------------ */
function buildSitemapRobots() {
  // Exclude noindex pages from the sitemap so Google only sees launch-ready URLs.
  const urls = GENERATED.filter((f) => f.endsWith("index.html") && !NOINDEX.has(f))
    .map((f) => SITE.origin + "/" + f.replace(/index\.html$/, ""));
  console.log("[generate] noindex/excluded from sitemap: " + (NOINDEX.size ? Array.from(NOINDEX).join(", ") : "none"));
  const today = new Date().toISOString().slice(0, 10);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join("\n")}
</urlset>
`;
  write("sitemap.xml", sitemap);
  const robots = `User-agent: *
Allow: /

Sitemap: ${SITE.origin}/sitemap.xml
`;
  write("robots.txt", robots);

  // ads.txt — authorizes the AdSense publisher to sell this site's inventory.
  // EDIT the publisher ID if this site uses a different AdSense account.
  const pub = SITE.adClient.replace(/^ca-/, "");
  write("ads.txt", "google.com, " + pub + ", DIRECT, f08c47fec0942fa0\n");
}

run();
