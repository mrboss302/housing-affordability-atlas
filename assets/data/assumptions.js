/* assumptions.js
 * Central, editable assumptions used to turn raw place data (home value, rent,
 * income) into estimated payments, income-needed figures, and affordability
 * scores.
 *
 * IMPORTANT: These are transparent, editable DEMO assumptions. They are not a
 * quote and not personalized. Replace or override them with current figures
 * (or send users to Home Payment Atlas) before presenting as live guidance.
 *
 * Exposes window.HAM_ASSUMPTIONS.
 */
(function (w) {
  "use strict";

  var ASSUMPTIONS = {
    // Mortgage math
    interestRate: 0.067,        // annual APR used for estimated P&I
    loanTermYears: 30,
    downPaymentPct: 0.10,       // 10% down (triggers PMI in the model)

    // Recurring ownership costs, expressed as a share of home value per year
    propertyTaxRate: 0.011,     // 1.1% — national-ballpark placeholder
    insuranceRate: 0.0045,      // ~0.45% homeowners insurance
    pmiRate: 0.006,             // PMI ~0.6%/yr of loan when < 20% down

    // Underwriting / affordability rules of thumb
    maxHousingDti: 0.28,        // front-end ratio: housing <= 28% of gross income
    rentBurdenThreshold: 0.30,  // rent > 30% of income = "rent burdened"

    // Home-price scenarios (multipliers applied to a place's median home value)
    scenarios: {
      starter: { label: "Starter home", factor: 0.80 },
      median: { label: "Median home", factor: 1.0 }
    },

    // Affordability score calibration (ratio = local income / income needed)
    // ratio at/below scoreFloorRatio -> 0, at/above scoreCeilRatio -> 100
    scoreFloorRatio: 0.40,
    scoreCeilRatio: 1.60,

    // Companion site
    atlas: {
      home: "https://homepaymentatlas.com/",
      calculator: "https://homepaymentatlas.com/mortgage-calculator/index.html",
      methodology: "https://homepaymentatlas.com/methodology/index.html",
      states: {
        MD: "https://homepaymentatlas.com/states/maryland/index.html",
        VA: "https://homepaymentatlas.com/states/virginia/index.html",
        PA: "https://homepaymentatlas.com/states/pennsylvania/index.html"
      }
    },

    // Standalone income scenarios used by /income/ pages and the income selector
    incomeScenarios: [50000, 75000, 100000, 150000]
  };

  w.HAM_ASSUMPTIONS = ASSUMPTIONS;
})(window);
