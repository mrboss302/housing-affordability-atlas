/* Housing Affordability Atlas: state-to-state comparison.
 * Keeps the official data vintages and model assumptions visible. No API calls.
 * All calculations reuse the shared HAM engine used by state pages and maps.
 */
(function (w, d) {
  "use strict";
  const H = w.HAM, STATES = w.HAM_STATES || [], BASE = w.HAM_ASSUMPTIONS || {};
  if (!H) return;

  const FORMAT = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0
  });
  const TYPES = Object.freeze({ starter: "Starter", median: "Middle-tier", family: "3-bedroom" });
  const money = (v) => v == null || !Number.isFinite(v) ? "—" : FORMAT.format(Math.round(v));

  function number(raw, fallback, min, max) {
    if (raw === "" || raw == null) return fallback;
    const v = Number(raw);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  }
  function calc(state, options) {
    if (!state) return null;
    const o = options || {};
    const layer = Object.hasOwn(TYPES, o.layer) ? o.layer : "median";
    const income = number(o.income, 75000, 1000, 10000000);
    const down = number(o.down, 10, 0, 100);
    const rate = number(o.rate, 6.7, 0, 25);
    const term = [15, 20, 30].includes(Number(o.term)) ? Number(o.term) : 30;
    const assumptions = Object.assign({}, BASE, {
      interestRate: rate / 100, downPaymentPct: down / 100, loanTermYears: term
    });
    const result = H.evaluateState(state, { layer, income, assumptions });
    if (!result || !result.payment || !Number.isFinite(result.monthlyPayment)) return null;

    const budget = income / 12 * assumptions.maxHousingDti;
    const stressed = H.evaluateState(state, {
      layer, income,
      assumptions: Object.assign({}, assumptions, { interestRate: Math.min(0.25, assumptions.interestRate + 0.01) })
    });
    return {
      state: state.name, abbr: state.abbr, slug: state.slug,
      region: result.region, provenance: result.provenance, layer,
      income, down, rate, term, assumptions,
      price: result.scenarioPrice,
      monthly: result.monthlyPayment, payment: result.payment,
      needed: result.incomeNeeded, score: result.score, band: result.band,
      rent: result.region.rent.value,
      rentSource: result.provenance.rent,
      rentProxy: result.rentBurden,
      budget, left: budget - result.monthlyPayment,
      cashDown: result.payment.downPayment,
      stressedIncrease: stressed && stressed.monthlyPayment != null ?
        stressed.monthlyPayment - result.monthlyPayment : null,
      atlasUrl: H.atlasCalcUrl(result.scenarioPrice, Object.assign({}, assumptions, { income }))
    };
  }
  function comparison(a, b) {
    if (!a || !b) return null;
    const delta = b.monthly - a.monthly;
    return {
      delta, priceDelta: b.price - a.price,
      higher: delta >= 0 ? b.state : a.state,
      lower: delta >= 0 ? a.state : b.state
    };
  }
  const API = Object.freeze({ TYPES, number, calc, comparison });
  w.HAM_COMPARE = API;
  if (!d) return;
  const root = d.querySelector("[data-compare]");
  if (!root) return;

  const byId = (id) => root.querySelector("#" + id);
  const fields = {
    first: byId("ha-first"), second: byId("ha-second"),
    layer: byId("ha-layer"), income: byId("ha-income"),
    down: byId("ha-down"), rate: byId("ha-rate"), term: byId("ha-term")
  };
  const summary = byId("ha-summary"), status = byId("ha-status");
  const cards = [byId("ha-card-a"), byId("ha-card-b")];
  const share = byId("ha-share");
  const states = STATES.filter(s => {
    const r = H.getRegion(s);
    return r && r.zhvi && r.income.src === "census" &&
      Number(r.zhvi.mid) > 0;
  }).sort((a, b) => a.name.localeCompare(b.name));
  const options = new URLSearchParams(w.location.search);

  function choices(el) {
    el.replaceChildren();
    states.forEach((state) => {
      const option = d.createElement("option");
      option.value = state.abbr;
      option.textContent = state.name;
      el.appendChild(option);
    });
  }
  function valueOr(param, fallback, valid) {
    const raw = options.get(param);
    return raw !== null && valid(raw) ? raw : fallback;
  }
  const keys = new Set(states.map(x => x.abbr));
  choices(fields.first); choices(fields.second);
  fields.first.value = valueOr("a", keys.has("MD") ? "MD" : states[0]?.abbr, x => keys.has(x));
  fields.second.value = valueOr("b", keys.has("VA") ? "VA" : states.find(x => x.abbr !== fields.first.value)?.abbr, x => keys.has(x));
  fields.layer.value = valueOr("tier", "median", x => Object.hasOwn(TYPES, x));
  fields.income.value = valueOr("income", "75000", x => Number.isFinite(Number(x)) && Number(x) >= 1000 && Number(x) <= 10000000);
  fields.down.value = valueOr("down", "10", x => Number.isFinite(Number(x)) && Number(x) >= 0 && Number(x) <= 100);
  fields.rate.value = valueOr("rate", "6.7", x => Number.isFinite(Number(x)) && Number(x) >= 0 && Number(x) <= 25);
  fields.term.value = valueOr("term", "30", x => ["15", "20", "30"].includes(x));
  if (!states.length) {
    status.textContent = "Verified state values are unavailable. View the source methodology for coverage details.";
    return;
  }

  function fill(which, result) {
    const card = cards[which], prefix = which === 0 ? "ha-a-" : "ha-b-";
    const set = (key, text) => {
      const el = card.querySelector("#" + prefix + key);
      if (el) el.textContent = text;
    };
    if (!result) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    set("name", result.state);
    set("price", money(result.price));
    set("payment", money(result.monthly));
    set("needed", money(result.needed));
    set("gap", (result.left >= 0 ? "+" : "−") + money(Math.abs(result.left)) + "/mo");
    set("gap-note", result.left >= 0 ? "Within the 28% housing guideline" : "Above the 28% housing guideline");
    set("score", result.score == null ? "—" : result.score + " / 100");
    set("pi", money(result.payment.principalInterest));
    set("tax", money(result.payment.tax));
    set("insurance", money(result.payment.insurance));
    set("pmi", money(result.payment.pmi));
    set("rent", result.rent != null ? money(result.rent) + " / mo" : "Not available");
    set("rent-source", result.rentSource === "census" ? "Census ACS median gross rent" :
      result.rentSource === "zillow" ? "Zillow ZORI" : "No verified rent");
    set("stress", result.stressedIncrease == null ? "—" :
      "+" + money(Math.max(0,result.stressedIncrease)) + " /mo");
    set("down", money(result.cashDown));
    const link = card.querySelector("#" + prefix + "atlas");
    if (link) link.href = result.atlasUrl;
    const stateLink = card.querySelector("#" + prefix + "state");
    if (stateLink) stateLink.href = "../states/" + encodeURIComponent(result.slug) + "/";
  }

  function update() {
    const selected = Object.fromEntries(Object.entries(fields).map(([key, el]) => [key, el.value]));
    const sa = states.find(x => x.abbr === selected.first);
    const sb = states.find(x => x.abbr === selected.second);
    const a = calc(sa, selected), b = calc(sb, selected);
    fill(0, a); fill(1, b);
    if (!a || !b) {
      summary.textContent = "This scenario cannot be calculated from the available data.";
    } else if (a.abbr === b.abbr) {
      summary.textContent = "Select two different states to see what changes under the same assumptions.";
    } else {
      const c = comparison(a, b);
      const gap = money(Math.abs(c.delta));
      summary.textContent = Math.abs(c.delta) < 1 ?
        "These two statewide examples have almost identical estimated monthly payments under the selected assumptions." :
        c.higher + " has an estimated payment of " + gap + " per month more than " + c.lower +
        " for the chosen home-value tier. This comparison uses the same hypothetical rate and down payment in both markets.";
    }
    const query = new URLSearchParams({
      a: selected.first, b: selected.second, tier: selected.layer,
      income: selected.income, down: selected.down, rate: selected.rate, term: selected.term
    });
    try { w.history.replaceState(null, "", w.location.pathname + "?" + query.toString()); } catch (_) {}
    status.textContent = "Comparison updated. Figures are modeled estimates, not current lender quotes.";
  }

  Object.values(fields).forEach((el) => {
    el.addEventListener("input", update);
    el.addEventListener("change", update);
  });
  share.addEventListener("click", () => {
    if (!w.navigator.clipboard || !w.navigator.clipboard.writeText) {
      status.textContent = "Copy the page URL from your browser to share this scenario.";
      return;
    }
    w.navigator.clipboard.writeText(w.location.href).then(() => {
      status.textContent = "Comparison link copied. Any income value in the URL is visible to recipients.";
    }, () => { status.textContent = "Copy the page URL from your browser to share."; });
  });
  update();
})(window, typeof document === "undefined" ? null : document);
