# Housing Affordability Atlas: AdSense and data-integrity review

Prepared November 15, 2026. Google does not disclose the single exact cause of "low value content." These are technical/product improvements, not a guarantee of approval.

## Implemented

- Interactive state-to-state comparison of verified Zillow home-value tiers under identical hypothetical mortgage assumptions, with household-income and rate-stress results.
- Data coverage report with the actual Zillow ZHVI observation month, Census ACS year, state coverage and explicit gaps.
- Source fix: Zillow ZORI fields currently contain no state rent observations. Census ACS median gross rent is used as the clearly attributed fallback; state/city pages and maps no longer describe illustrative rent as current Zillow research.
- Rent-to-income figure correctly described as a proxy. It divides median gross rent by **all-household** median income and must never be presented as the official Census renter cost-burden percentage.
- Corrected Home Payment Atlas deep links to pass estimated annual property-tax and homeowners-insurance **dollars** rather than mistaken percentages.
- Corrected 100× rent-percentage display on state pages.
- Removed empty manual ad placeholders while preserving the AdSense account-verification script and ads.txt.
- Removed unsupported claims that combined Zillow/Census result pages are licensed as CC-BY 4.0.
- Sitemap no longer pretends every page was substantively updated on every automated build.
- Replaced unfinished privacy placeholder language with clear operational notes and a project issue-reporting channel.
- Added generated-page and financial-engine CI tests.

## Required owner checks before requesting another AdSense review

- [ ] Confirm production deployment and open `/compare/` and `/data-updates/` on desktop and mobile. Test user-input combinations, keyboard access, and link sharing.
- [ ] Confirm the AdSense account ID in site metadata and ads.txt; enable appropriate consent settings for regions where ads may be served.
- [ ] Verify an actual monitored **private contact method** for privacy and partnership requests. The public GitHub issue tracker is not a substitute for a private inbox.
- [ ] Review Google's Publisher Policies and the true effective behavior of analytics, advertising, cookies and the privacy notice.
- [ ] Review Zillow Research licensing/terms, permitted redistribution, source attribution, and the use of any third-party geospatial data. Do not infer a license for mixed-source outputs.
- [ ] Audit source-release dates and scheduled refresh logs. Zillow housing prices, Census ACS incomes, rental metrics and geographic boundaries have different vintages.
- [ ] Check Search Console: indexed vs noindex state/place and pending market-signal pages, sitemap coverage, duplicate titles/canonicals and unresolved crawl errors.
- [ ] Confirm unique user value with genuine visits/feedback; do not buy fake traffic or mass-publish similar pages solely for approval.
- [ ] Run `node tools/generate.js && node scripts/test-quality.cjs` and verify CI before deployment.

## Limits and research directions

The comparison is state-level, not neighborhood-level and not a mortgage approval forecast. Tax, insurance, PMI, maintenance, HOA and closing costs vary. The website's default interest rate is a hypothetical scenario, not a live lender offer. Improvements should emphasize original interactive analysis and source transparency rather than creating thin location-keyword pages.

To claim a genuine Census cost-burden measure, use a renter-household distribution such as ACS B25106 or the appropriate renter cost categories; do not equate overall median rent / overall median household income with renter cost burden. Zillow ZORI can only be attributed when actually present in the imported dataset.

Sustained AdSense approval depends on Google's assessment of the published product and visitors' experience, not merely on GitHub commits or green tests.
