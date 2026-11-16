# Technical SEO review and deployment checklist

Updated: November 15, 2026.

This document describes changes to the **website** and how to measure their real search impact. It is not a report of verified Google rankings, Search Console metrics, or AdSense approval. Those require access to the live Google property.

## Implemented

- **All-state directory:** /states/ links directly to all 50 states and Washington, DC, with their Zillow middle-tier home-value estimate, modeled monthly payment, and income needed. Every state page has a normal HTML link, not just an interactive SVG pin.
- **Data-backed rankings hub:** /rankings/ links only to rankings supported by current datasets. Unfinished buyer-opportunity, price-cut, and market-heat pages remain reachable at their existing URLs but use `noindex,follow` and do not appear in the XML sitemap.
- **Descriptive metadata:** Titles and descriptions for the homepage, state pages and rent-to-income map now describe the actual page topic and measured source values without hardcoded annual 'freshness' claims.
- **Structured data:** WebSite + Organization identity on the homepage; WebPage identity, canonical and breadcrumb metadata on appropriate internal pages. Existing page-specific WebApplication/Dataset/FAQ markup is preserved, without invented aggregate-data licenses.
- **Shared link previews:** Build creates a deterministic 1200×630 PNG at `assets/og-card.png` and adds Open Graph and Twitter Card metadata to every generated HTML page. No purchased assets or fonts.
- **Correct breadcrumb hierarchy:** State pages use Home → States → State; rankings use Home → Rankings → Ranking.
- **Custom noindex 404:** Useful navigational options and proper GitHub Pages 404 handling.
- **Automated SEO quality gate:** `node scripts/test-seo.cjs` checks generated titles/descriptions, sitemap vs. noindex, canonical URLs, JSON-LD, linked resources, crawlable reachability from the homepage, all-state directory links and the generated preview image. Runs in PR CI and before GitHub Pages deploy.
- **Sitemap integrity:** No arbitrary build-date `lastmod`. Source observation dates remain visibly labeled where applicable.

## Local verification

No npm install or external services are needed.

```bash
node tools/generate.js
node scripts/test-quality.cjs
node scripts/test-seo.cjs
```

The tests will fail on duplicate search-result titles, duplicate meta descriptions, missing canonical/indexable pages, unlinked indexable pages, broken anchors, missing OG imagery, or roadmap pages accidentally marked indexable.

## What the site owner must check in Google Search Console

1. Verify the correct HTTPS/domain property for `housingaffordabilityatlas.com`; confirm the site's canonical domain.
2. Submit `https://housingaffordabilityatlas.com/sitemap.xml` under Sitemaps.
3. Use URL Inspection on these pages after deployment: `/`, `/states/`, `/rankings/`, `/compare/`, `/data-updates/`, and a representative state page such as `/states/maryland/`.
4. Inspect indexing reasons, especially `Crawled - currently not indexed`, `Discovered - currently not indexed`, duplicate/canonical conflicts, and exclusions caused by deliberate `noindex`.
5. Expect the three incomplete market-signal pages to remain excluded. Their noindex directives **must remain crawlable**; do not block them in robots.txt.
6. Check Google Rich Results Test and social-preview tools on production URLs. Structured data and imagery are descriptions, not guarantees of rich results.
7. Compare organic impressions, clicked queries, CTR and landing-page trends over successive periods. Rewrite titles only where the actual search intent and page usefulness warrant changes.
8. Look for real usability problems: mobile navigation, text contrast, table overflow, inaccessible state selections and slow interactive map rendering. SEO is not solved by metadata alone.

## Editorial direction

Continue building **original, verifiable comparisons** using the published Zillow and Census source months. Prioritize useful questions such as what housing is affordable at a stated income or what changes between neighboring states. Avoid mass-producing dozens of near-identical keyword pages, inventing user demand, or implying modeled mortgage rates are current quotes.

Google's public recommendations emphasize concise, page-specific titles, descriptive meta summaries, crawlable links, verifiable sitemap update dates, and helpful content. Search rankings and AdSense decisions depend on more than code changes.

## External checks not completed from GitHub

The repository cannot confirm Google Search Console coverage, property ownership, domain redirects, current Core Web Vitals field data, real visitor interest, or Google AdSense approval. Production publication and tests can be verified separately through GitHub Actions.
