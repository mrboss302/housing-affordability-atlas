/* map.js
 * Interactive U.S. affordability map. Renders real Census state geometry
 * (assets/data/us-geo.js, Albers USA projection) as an inline SVG and colors
 * each state by the active layer, combining real Zillow Research home values
 * (ZHVI/ZORI) with Census income context.
 *
 * Map layers:
 *   starter-affordability  Zillow bottom-tier ZHVI vs income
 *   median-affordability   Zillow mid-tier ZHVI vs income
 *   family-affordability   Zillow 3BR ZHVI vs income
 *   income-needed          income to buy a mid-tier home
 *   monthly-payment        estimated payment for a mid-tier home
 *   rent-affordability     ZORI rent as a share of income
 *   buyer-opportunity / market-heat / price-cut-share  (market-signal layers —
 *     shown as "data coming soon" until those Zillow datasets are imported)
 *
 * Progressive enhancement: SEO copy and ranking tables live in the page HTML.
 * If geometry/data fail to load, a labeled empty state appears and the rest of
 * the page still works. Respects prefers-reduced-motion.
 *
 * Auto-initializes every element with [data-map].
 */
(function (w, d) {
  "use strict";

  var prefersReduced = w.matchMedia &&
    w.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // State pages that are actually published (others render as plain text).
  var PUBLISHED_STATES = { MD: 1, VA: 1, PA: 1 };

  var SCORE = function (e) { return e.score; };
  var fmtScore = function (v) { return v == null ? "—" : v + "/100"; };

  var METRICS = {
    "starter-affordability": { label: "Starter-home affordability", layer: "starter",
      lowerIsBetter: false, value: SCORE, format: fmtScore },
    "median-affordability": { label: "Median-home affordability", layer: "median",
      lowerIsBetter: false, value: SCORE, format: fmtScore },
    "family-affordability": { label: "Family-home affordability (3BR)", layer: "family",
      lowerIsBetter: false, value: SCORE, format: fmtScore },
    "income-needed": { label: "Income needed (median home)", layer: "median",
      lowerIsBetter: true, value: function (e) { return e.incomeNeeded; },
      format: function (v) { return w.HAM.money(v); } },
    "monthly-payment": { label: "Estimated monthly payment", layer: "median",
      lowerIsBetter: true, value: function (e) { return e.monthlyPayment; },
      format: function (v) { return w.HAM.money(v) + "/mo"; } },
    "rent-affordability": { label: "Rent affordability (rent burden)", layer: "median",
      lowerIsBetter: true, value: function (e) { return e.rentBurden; },
      format: function (v) { return w.HAM.pct(v); } },
    "buyer-opportunity": { label: "Buyer opportunity (preview)", layer: "median",
      pending: true, signal: "marketHeatIndex" },
    "market-heat": { label: "Market heat (preview)", layer: "median",
      pending: true, signal: "marketHeatIndex" },
    "price-cut-share": { label: "Price-cut share (preview)", layer: "median",
      pending: true, signal: "priceCutShare" }
  };

  // Map the legacy specialized pages to the new metric keys.
  var MODE_ALIASES = {
    "buying-affordability": "median-affordability",
    "income-needed": "income-needed",
    "monthly-payment": "monthly-payment",
    "rent-burden": "rent-affordability",
    "starter-affordability": "starter-affordability",
    "family-affordability": "family-affordability",
    "buyer-opportunity": "buyer-opportunity"
  };

  function svgEl(tag, attrs, text) {
    var n = d.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }

  function MapApp(root) {
    this.root = root;
    var lock = root.getAttribute("data-map-mode");
    this.lockedMode = lock ? (MODE_ALIASES[lock] || lock) : null;
    this.metricKey = this.lockedMode || "median-affordability";
    this.income = "area";
    this.customPrice = null;
    this.selected = null;
    this.byAbbr = {};
    this.init();
  }

  MapApp.prototype.init = function () {
    if (!w.US_GEO || !w.HAM_STATES || !w.HAM) {
      this.root.innerHTML =
        '<p class="map-empty" role="status">The interactive map could not load its data. ' +
        "Affordability tables on this page are still available below.</p>";
      return;
    }
    this.states = w.HAM_STATES;
    this.geo = w.US_GEO;
    var self = this;
    this.states.forEach(function (s) { self.byAbbr[s.abbr] = s; });
    this.buildLayout();
    this.bindControls();
    this.render();
  };

  MapApp.prototype.buildLayout = function () {
    this.svgWrap = this.root.querySelector("[data-map-canvas]") || this.root;
    this.svgWrap.innerHTML = ""; // clear the loading placeholder
    this.legendEl = this.root.querySelector("[data-map-legend]") ||
      (this.root.parentNode && this.root.parentNode.querySelector("[data-map-legend]"));
    this.panelEl = d.querySelector("[data-map-panel]");

    var svg = svgEl("svg", {
      viewBox: this.geo.viewBox, role: "group",
      "aria-label": "Map of U.S. states colored by housing affordability. " +
        "Use Tab to move between states and Enter to view details.",
      class: "us-map" + (prefersReduced ? " no-motion" : "")
    });
    var self = this;
    this.paths = {};
    this.geo.states.forEach(function (g) {
      var p = svgEl("path", { d: g.d, class: "state", tabindex: "0",
        role: "button", "data-abbr": g.abbr, "aria-label": g.name });
      p.addEventListener("click", function () { self.select(g.abbr); });
      p.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); self.select(g.abbr); }
      });
      p.addEventListener("mouseenter", function () { self.showTip(g.abbr, p); });
      p.addEventListener("focus", function () { self.showTip(g.abbr, p); });
      p.addEventListener("mouseleave", function () { self.hideTip(); });
      p.addEventListener("blur", function () { self.hideTip(); });
      svg.appendChild(p);
      self.paths[g.abbr] = p;
    });
    this.svgWrap.appendChild(svg);

    this.tip = d.createElement("div");
    this.tip.className = "map-tip";
    this.tip.setAttribute("role", "status");
    this.tip.hidden = true;
    this.svgWrap.appendChild(this.tip);
  };

  MapApp.prototype.bindControls = function () {
    var self = this;
    function on(sel, evt, fn) {
      var n = d.querySelector(sel);
      if (n) n.addEventListener(evt, fn);
      return n;
    }
    on('[data-control="income"]', "change", function (e) { self.income = e.target.value; self.render(); });
    var viewCtrl = on('[data-control="view"]', "change", function (e) { self.metricKey = e.target.value; self.render(); });
    if (this.lockedMode && viewCtrl) { viewCtrl.value = this.lockedMode; viewCtrl.disabled = true; }
    var custom = d.querySelector('[data-control="custom-price"]');
    if (custom) custom.addEventListener("input", function (e) {
      var v = parseInt(e.target.value, 10);
      self.customPrice = isFinite(v) && v > 0 ? v : null;
      self.render();
    });
  };

  MapApp.prototype.metric = function () { return METRICS[this.metricKey]; };

  MapApp.prototype.evalState = function (base) {
    var m = this.metric();
    var opts = { layer: m.layer };
    if (this.income !== "area") opts.income = parseInt(this.income, 10);
    var e = w.HAM.evaluateState(base, opts);
    if (e && this.customPrice) {
      // Override the home value with a flat custom price across all states.
      var pay = w.HAM.payment(this.customPrice);
      e.scenarioPrice = this.customPrice;
      e.payment = pay;
      e.monthlyPayment = pay ? pay.total : null;
      e.incomeNeeded = w.HAM.incomeNeeded(e.monthlyPayment);
      var inc = (this.income !== "area") ? parseInt(this.income, 10) : e.region.income.value;
      e.score = w.HAM.score(inc, e.incomeNeeded);
      e.band = w.HAM.band(e.score);
    }
    return e;
  };

  MapApp.prototype.render = function () {
    var self = this, m = this.metric();
    var evals = this.states.map(function (s) {
      var e = self.evalState(s);
      e.abbr = s.abbr;
      e.metricValue = m.pending ? null : m.value(e);
      return e;
    });
    this.evals = {};
    evals.forEach(function (e) { self.evals[e.abbr] = e; });

    var withVal = evals.filter(function (e) { return e.metricValue != null; })
      .sort(function (a, b) { return a.metricValue - b.metricValue; });
    var n = withVal.length;
    withVal.forEach(function (e, i) {
      var q = n > 1 ? Math.floor((i / n) * 5) : 4;
      if (q > 4) q = 4;
      e.bandKey = "s" + ((m.lowerIsBetter ? (4 - q) : q) + 1);
    });
    evals.forEach(function (e) {
      var p = self.paths[e.abbr];
      if (p) p.setAttribute("data-band", e.metricValue == null ? "na" : e.bandKey);
    });

    this.renderLegend();
    if (this.selected) this.renderPanel(this.selected);
    this.updateRanking();
  };

  MapApp.prototype.renderLegend = function () {
    if (!this.legendEl) return;
    var m = this.metric();
    if (m.pending) {
      this.legendEl.innerHTML = '<span class="legend-title">' + m.label + "</span>" +
        '<p class="legend-pending">This market-signal layer is part of the data roadmap. ' +
        "It will activate once the Zillow inventory, price-cut, days-to-pending, and " +
        "market-heat datasets are imported. Other layers use live data now.</p>";
      return;
    }
    var labels = ["Most affordable", "More", "Moderate", "Less", "Least affordable"];
    var html = '<span class="legend-title">' + m.label + '</span><ul class="legend-scale">';
    ["s5", "s4", "s3", "s2", "s1"].forEach(function (k, i) {
      html += '<li><span class="legend-swatch" data-band="' + k + '"></span>' + labels[i] + "</li>";
    });
    html += '<li><span class="legend-swatch" data-band="na"></span>No data</li></ul>';
    this.legendEl.innerHTML = html;
  };

  MapApp.prototype.showTip = function (abbr, pathNode) {
    var e = this.evals[abbr], s = this.byAbbr[abbr], m = this.metric();
    if (!e || !s) return;
    var val = m.pending ? "Data coming soon" : m.format(m.value(e));
    this.tip.innerHTML = "<strong>" + s.name + "</strong><br>" + m.label + ": " + val;
    this.tip.hidden = false;
    var box = pathNode.getBBox();
    var wrapBox = this.svgWrap.getBoundingClientRect();
    var svg = pathNode.ownerSVGElement;
    var sx = wrapBox.width / svg.viewBox.baseVal.width;
    var sy = wrapBox.height / svg.viewBox.baseVal.height;
    this.tip.style.left = ((box.x + box.width / 2) * sx) + "px";
    this.tip.style.top = (box.y * sy) + "px";
  };

  MapApp.prototype.hideTip = function () { if (this.tip) this.tip.hidden = true; };

  MapApp.prototype.select = function (abbr) {
    this.selected = abbr;
    var self = this;
    Object.keys(this.paths).forEach(function (a) {
      self.paths[a].classList.toggle("is-selected", a === abbr);
    });
    this.renderPanel(abbr);
    if (this.panelEl && w.innerWidth < 900) {
      this.panelEl.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "nearest" });
      this.panelEl.focus({ preventScroll: true });
    }
  };

  MapApp.prototype.renderPanel = function (abbr) {
    if (!this.panelEl) return;
    var e = this.evals[abbr], s = this.byAbbr[abbr];
    if (!e || !s) return;
    var H = w.HAM, A = w.HAM_ASSUMPTIONS;
    var calc = H.atlasCalcUrl(e.scenarioPrice, { income: e.region.income.value });
    var stateUrl = H.atlasStateUrl(abbr);
    var layerLabel = e.layer.label.toLowerCase();
    var incomeText = this.income === "area"
      ? "the area median income (" + H.money(e.region.income.value) +
        (e.provenance.income === "illustrative" ? ", illustrative" : "") + ")"
      : "a household income of " + H.money(parseInt(this.income, 10));

    var explain = "Buying a " + layerLabel + " in " + s.name + " is estimated at about " +
      H.money(e.monthlyPayment) + "/month, which typically calls for an income near " +
      H.money(e.incomeNeeded) + ". The score compares " + incomeText + " with that income needed.";

    var prov = '<p class="panel-prov">Home value &amp; rent: Zillow Research' +
      (w.HAM_MARKET && w.HAM_MARKET.vintage ? " (" + w.HAM_MARKET.vintage + ")" : "") +
      ". Income: " + (e.provenance.income === "census" ? "U.S. Census ACS" : "illustrative estimate") + ".</p>";

    this.panelEl.innerHTML =
      '<div class="panel-head"><h3 id="panel-title">' + s.name + '</h3>' +
      '<span class="badge" data-band="' + (e.bandKey || "na") + '">' + (e.band ? e.band.label : "No data") + "</span></div>" +
      '<dl class="panel-stats">' +
        stat("Estimated " + layerLabel + " value", H.money(e.scenarioPrice)) +
        stat("Estimated monthly payment", H.money(e.monthlyPayment)) +
        stat("Estimated income needed", H.money(e.incomeNeeded)) +
        stat("Affordability score", e.score == null ? "—" : e.score + " / 100") +
        stat("Estimated rent burden", H.pct(e.rentBurden)) +
      "</dl>" +
      '<p class="panel-note">' + explain + "</p>" + prov +
      '<div class="panel-actions">' +
        '<a class="btn btn-primary" href="' + calc + '" rel="noopener">Customize this estimated payment on Home Payment Atlas</a>' +
        '<a class="btn" href="' + stateUrl + '" rel="noopener">See ' + s.name + " payment assumptions on Home Payment Atlas</a>" +
        '<a class="btn btn-ghost" href="' + A.atlas.methodology + '" rel="noopener">Review the payment methodology</a>' +
        (PUBLISHED_STATES[abbr] ? '<a class="btn btn-ghost" href="' + statePath(s.slug) + '">Open the ' + s.name + " page</a>" : "") +
      "</div>";

    function stat(k, v) { return "<div><dt>" + k + "</dt><dd>" + v + "</dd></div>"; }
  };

  function statePath(slug) { return rootPrefix() + "states/" + slug + "/"; }
  function rootPrefix() {
    var p = w.location.pathname;
    var depth = p.replace(/\/[^/]*$/, "/").split("/").filter(Boolean).length;
    return depth ? "../".repeat(depth) : "./";
  }
  function stateCell(s) {
    return PUBLISHED_STATES[s.abbr]
      ? '<a href="' + statePath(s.slug) + '">' + s.name + "</a>"
      : s.name + '<span class="muted"> · ' + s.abbr + "</span>";
  }

  MapApp.prototype.updateRanking = function () {
    var host = d.querySelector("[data-state-ranking]");
    if (!host) return;
    var self = this, m = this.metric(), H = w.HAM;
    if (m.pending) {
      host.innerHTML = '<tr><td colspan="6" class="muted">This layer\'s ranking activates when ' +
        "its dataset is imported. Switch the view to a live layer to see rankings.</td></tr>";
      return;
    }
    var rows = this.states.map(function (s) { return self.evals[s.abbr]; })
      .filter(function (e) { return e && e.metricValue != null; });
    rows.sort(function (a, b) {
      return m.lowerIsBetter ? a.metricValue - b.metricValue : b.metricValue - a.metricValue;
    });
    host.innerHTML = rows.slice(0, 15).map(function (e, i) {
      var s = self.byAbbr[e.abbr];
      return "<tr><td>" + (i + 1) + "</td><td>" + stateCell(s) + "</td>" +
        "<td>" + H.money(e.scenarioPrice) + "</td>" +
        "<td>" + H.money(e.monthlyPayment) + "</td>" +
        "<td>" + H.money(e.incomeNeeded) + "</td>" +
        "<td>" + (e.score == null ? "—" : e.score) + "</td></tr>";
    }).join("");
  };

  d.addEventListener("DOMContentLoaded", function () {
    d.querySelectorAll("[data-map]").forEach(function (m) { new MapApp(m); });
  });
})(window, document);
