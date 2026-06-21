/* affordability.js
 * Pure(ish) calculation engine shared by the map, ranking tables, and SEO
 * pages. Turns raw inputs (home value, rent, income) + assumptions into
 * estimated payment, income needed, affordability score, and rent burden.
 *
 * All functions guard against missing/invalid data and return null fields
 * rather than NaN so the UI can show graceful empty states.
 *
 * Exposes window.HAM (Housing Affordability Math).
 */
(function (w) {
  "use strict";

  var A = w.HAM_ASSUMPTIONS || {};

  function num(v) {
    return (typeof v === "number" && isFinite(v) && v > 0) ? v : null;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /* Monthly principal & interest per $1 of loan. */
  function piFactor(rate, years) {
    var r = rate / 12;
    var n = years * 12;
    if (r === 0) return 1 / n;
    var g = Math.pow(1 + r, n);
    return (r * g) / (g - 1);
  }

  /* Full estimated monthly payment breakdown for a given home price. */
  function payment(homeValue, opts) {
    var a = Object.assign({}, A, opts || {});
    var hv = num(homeValue);
    if (!hv) return null;

    var down = hv * a.downPaymentPct;
    var loan = hv - down;
    var pi = loan * piFactor(a.interestRate, a.loanTermYears);
    var tax = (hv * a.propertyTaxRate) / 12;
    var ins = (hv * a.insuranceRate) / 12;
    var pmi = a.downPaymentPct < 0.20 ? (loan * a.pmiRate) / 12 : 0;
    var total = pi + tax + ins + pmi;

    return {
      homeValue: hv,
      downPayment: Math.round(down),
      loanAmount: Math.round(loan),
      principalInterest: Math.round(pi),
      tax: Math.round(tax),
      insurance: Math.round(ins),
      pmi: Math.round(pmi),
      total: Math.round(total)
    };
  }

  /* Annual gross income needed so housing is <= maxHousingDti of income. */
  function incomeNeeded(monthlyPayment, opts) {
    var a = Object.assign({}, A, opts || {});
    var p = num(monthlyPayment);
    if (!p) return null;
    return Math.round((p / a.maxHousingDti) * 12);
  }

  /* Largest home price affordable at a given annual income (inverts payment). */
  function maxHomePrice(income, opts) {
    var a = Object.assign({}, A, opts || {});
    var inc = num(income);
    if (!inc) return null;
    var maxMonthly = (inc / 12) * a.maxHousingDti;
    var pf = piFactor(a.interestRate, a.loanTermYears);
    var loanShare = 1 - a.downPaymentPct;
    var perDollar =
      loanShare * pf +
      a.propertyTaxRate / 12 +
      a.insuranceRate / 12 +
      (a.downPaymentPct < 0.20 ? (loanShare * a.pmiRate) / 12 : 0);
    return Math.round(maxMonthly / perDollar);
  }

  /* 0-100 affordability score from the ratio of local income to income needed. */
  function score(localIncome, neededIncome) {
    var li = num(localIncome);
    var ni = num(neededIncome);
    if (!li || !ni) return null;
    var ratio = li / ni;
    var lo = A.scoreFloorRatio, hi = A.scoreCeilRatio;
    return Math.round(clamp(((ratio - lo) / (hi - lo)) * 100, 0, 100));
  }

  /* Rent as a percentage of income (annualized). */
  function rentBurden(monthlyRent, income) {
    var r = num(monthlyRent);
    var inc = num(income);
    if (!r || !inc) return null;
    return Math.round(((r * 12) / inc) * 100);
  }

  /* Human-readable band + palette key for a score. */
  function band(s) {
    if (s == null) return { key: "na", label: "No data" };
    if (s >= 80) return { key: "s5", label: "More affordable" };
    if (s >= 60) return { key: "s4", label: "Affordable" };
    if (s >= 40) return { key: "s3", label: "Moderate" };
    if (s >= 20) return { key: "s2", label: "Stretched" };
    return { key: "s1", label: "Least affordable" };
  }

  /* One call that returns every derived field for a place/state record.
   * opts may include { scenarioFactor, income } to override the home price
   * scenario and the income used for scoring. */
  function evaluate(rec, opts) {
    opts = opts || {};
    if (!rec) return null;
    var factor = opts.scenarioFactor || 1;
    var basePrice = num(rec.medianHomeValue);
    var scenarioPrice = basePrice ? Math.round(basePrice * factor) : null;
    var pay = payment(scenarioPrice);
    var total = pay ? pay.total : null;
    var needed = incomeNeeded(total);
    // Score against the chosen income if given, else the place's own income.
    var scoringIncome = num(opts.income) || num(rec.medianIncome);
    var s = score(scoringIncome, needed);
    return {
      record: rec,
      scenarioPrice: scenarioPrice,
      payment: pay,
      monthlyPayment: total,
      incomeNeeded: needed,
      score: s,
      band: band(s),
      rentBurden: rentBurden(rec.medianRent, rec.medianIncome),
      scoringIncome: scoringIncome
    };
  }

  /* Formatting helpers used across pages. */
  function money(v) {
    if (v == null || !isFinite(v)) return "—";
    return "$" + Math.round(v).toLocaleString("en-US");
  }
  function pct(v) {
    if (v == null || !isFinite(v)) return "—";
    return v + "%";
  }

  /* Build a Home Payment Atlas calculator URL with scenario params. These query
   * params are forward-compatible: if Atlas adds parameter support they will
   * pre-fill; if not, the link still opens the calculator cleanly. */
  function atlasCalcUrl(homeValue, opts) {
    var a = Object.assign({}, A, opts || {});
    var base = a.atlas.calculator;
    var hv = num(homeValue);
    if (!hv) return base;
    // Param names match the Home Payment Atlas calculator (price/down/rate/term/
    // tax/ins/hoa/income). tax & ins are percentages on both sites.
    var params = [
      "price=" + Math.round(hv),
      "down=" + Math.round(a.downPaymentPct * 100),
      "rate=" + (a.interestRate * 100).toFixed(3),
      "term=" + a.loanTermYears,
      "tax=" + (a.propertyTaxRate * 100).toFixed(2),
      "ins=" + (a.insuranceRate * 100).toFixed(2)
    ];
    if (opts && num(opts.income)) params.push("income=" + Math.round(opts.income));
    return base + "?" + params.join("&");
  }

  function atlasStateUrl(abbr) {
    return (A.atlas && A.atlas.states && A.atlas.states[abbr]) || (A.atlas && A.atlas.home) || "#";
  }

  /* -------- Data merge + home-value tiers (Census + Zillow + base) -------- */

  // Home-value "layers" map to Zillow ZHVI tiers. starter = bottom tier,
  // median = mid tier, family = 3-bedroom (fallback 4-bedroom / mid).
  var LAYERS = {
    starter: { key: "starter", label: "Starter home", short: "starter",
      pick: function (z) { return z && (z.bottom || z.mid); } },
    median: { key: "median", label: "Median home", short: "median",
      pick: function (z) { return z && (z.mid || z.bottom); } },
    family: { key: "family", label: "Family home (3BR)", short: "3-bedroom",
      pick: function (z) { return z && (z.bed3 || z.bed4 || z.mid); } }
  };

  var _marketByAbbr = null, _censusByAbbr = null;
  function indexBy(list, key) {
    var o = {}; (list || []).forEach(function (r) { o[r[key]] = r; }); return o;
  }
  function marketFor(abbr) {
    if (!_marketByAbbr) _marketByAbbr = indexBy((w.HAM_MARKET || {}).regions, "abbr");
    return _marketByAbbr[abbr] || null;
  }
  function censusFor(abbr) {
    if (!_censusByAbbr) _censusByAbbr = indexBy((w.HAM_CENSUS || {}).regions, "abbr");
    return _censusByAbbr[abbr] || null;
  }

  // Merge a state's base record (HAM_STATES) with real Zillow + Census data,
  // tracking provenance so the UI can label real vs illustrative figures.
  function getRegion(base) {
    if (!base) return null;
    var mk = marketFor(base.abbr);
    var cs = censusFor(base.abbr);
    var income = cs && num(cs.medianHouseholdIncome)
      ? { value: cs.medianHouseholdIncome, src: "census" }
      : { value: base.medianIncome, src: "illustrative" };
    var rent = mk && num(mk.zori)
      ? { value: mk.zori, src: "zillow" }
      : { value: base.medianRent, src: "illustrative" };
    return {
      abbr: base.abbr, name: base.name, slug: base.slug, fips: base.fips,
      zhvi: mk ? mk.zhvi : null,
      marketSignals: mk ? mk.marketSignals : null,
      income: income, rent: rent,
      // fallback home value when Zillow missing
      fallbackHome: base.medianHomeValue || null
    };
  }

  // Build an evaluate()-ready record for a given home-value layer.
  function recordForLayer(region, layerKey) {
    var layer = LAYERS[layerKey] || LAYERS.median;
    var hv = (region.zhvi && layer.pick(region.zhvi)) || region.fallbackHome || null;
    return {
      name: region.name, slug: region.slug, abbr: region.abbr, fips: region.fips,
      medianHomeValue: hv,
      medianRent: region.rent.value,
      medianIncome: region.income.value
    };
  }

  // One-stop evaluation for a state by layer, with provenance + signals attached.
  function evaluateState(base, opts) {
    opts = opts || {};
    var region = getRegion(base);
    if (!region) return null;
    var layerKey = opts.layer || "median";
    var rec = recordForLayer(region, layerKey);
    var evalOpts = {};
    if (num(opts.income)) evalOpts.income = opts.income;
    var e = evaluate(rec, evalOpts);
    if (!e) e = { record: rec, scenarioPrice: rec.medianHomeValue, payment: null,
      monthlyPayment: null, incomeNeeded: null, score: null, band: band(null),
      rentBurden: rentBurden(rec.medianRent, rec.medianIncome) };
    e.region = region;
    e.layer = LAYERS[layerKey] || LAYERS.median;
    e.provenance = { income: region.income.src, rent: region.rent.src,
      homeValue: region.zhvi ? "zillow" : (region.fallbackHome ? "illustrative" : "none") };
    e.marketSignals = region.marketSignals;
    return e;
  }

  function dataVintage() {
    var v = {};
    if (w.HAM_MARKET) v.zillow = w.HAM_MARKET.vintage;
    if (w.HAM_CENSUS) v.census = w.HAM_CENSUS.vintage;
    return v;
  }

  /* -------- Place-level (city / county) real data merge ------------------ */
  var _mp = null, _cpPlace = null, _cpCounty = null;
  function mpFor(slug) {
    if (!_mp) _mp = indexBy((w.HAM_MARKET_PLACES || {}).regions, "slug");
    return _mp[slug] || null;
  }
  function cpPlaceFor(slug) {
    if (!_cpPlace) _cpPlace = indexBy((w.HAM_CENSUS_PLACES || {}).places, "slug");
    return _cpPlace[slug] || null;
  }
  function cpCountyFor(slug) {
    if (!_cpCounty) _cpCounty = indexBy((w.HAM_CENSUS_PLACES || {}).counties, "slug");
    return _cpCounty[slug] || null;
  }

  function getPlace(base) {
    if (!base) return null;
    var mk = mpFor(base.slug);
    var cs = base.type === "county" ? cpCountyFor(base.slug) : cpPlaceFor(base.slug);
    return {
      slug: base.slug, name: base.name, stateAbbr: base.stateAbbr, type: base.type, fips: base.fips,
      zhvi: mk ? mk.zhvi : null,
      income: cs && num(cs.medianHouseholdIncome) ? { value: cs.medianHouseholdIncome, src: "census" } : { value: null, src: "none" },
      rent: mk && num(mk.zori) ? { value: mk.zori, src: "zillow" } : { value: null, src: "none" },
      population: cs && num(cs.population) ? cs.population : null,
      censusName: cs ? cs.name : null
    };
  }

  // Evaluate a city/county place record by home-value layer using real data.
  function evaluatePlace(base, opts) {
    opts = opts || {};
    var region = getPlace(base);
    if (!region) return null;
    var layer = LAYERS[opts.layer || "median"] || LAYERS.median;
    var hv = region.zhvi ? layer.pick(region.zhvi) : null;
    var rec = { name: region.name, slug: region.slug, abbr: region.stateAbbr,
      medianHomeValue: hv, medianRent: region.rent.value, medianIncome: region.income.value };
    var e = evaluate(rec, num(opts.income) ? { income: opts.income } : {});
    e.region = region;
    e.layer = layer;
    e.provenance = {
      homeValue: hv != null ? "zillow" : "none",
      rent: region.rent.src, income: region.income.src
    };
    // "complete" = has the headline home value and income (cities). Counties
    // lack Zillow home values in the current datasets, so they are incomplete.
    e.complete = hv != null && region.income.value != null;
    return e;
  }

  w.HAM = {
    payment: payment,
    incomeNeeded: incomeNeeded,
    maxHomePrice: maxHomePrice,
    score: score,
    rentBurden: rentBurden,
    band: band,
    evaluate: evaluate,
    money: money,
    pct: pct,
    atlasCalcUrl: atlasCalcUrl,
    atlasStateUrl: atlasStateUrl,
    LAYERS: LAYERS,
    getRegion: getRegion,
    recordForLayer: recordForLayer,
    evaluateState: evaluateState,
    evaluatePlace: evaluatePlace,
    getPlace: getPlace,
    dataVintage: dataVintage
  };
})(window);
