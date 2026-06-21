/* site.js
 * Small, dependency-free site runtime: mobile nav toggle, footer year, and
 * light progressive enhancement. Kept separate from map.js so non-map pages
 * stay lightweight. Safe to load on every page.
 */
(function (w, d) {
  "use strict";

  d.addEventListener("DOMContentLoaded", function () {
    // Footer year(s)
    var y = String(new Date().getFullYear());
    d.querySelectorAll("[data-year]").forEach(function (n) { n.textContent = y; });

    // Mobile navigation toggle
    var toggle = d.querySelector("[data-nav-toggle]");
    var nav = d.querySelector("[data-nav]");
    if (toggle && nav) {
      toggle.addEventListener("click", function () {
        var open = nav.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
      // Close the menu when a link is chosen (mobile)
      nav.addEventListener("click", function (e) {
        if (e.target.closest("a") && nav.classList.contains("is-open")) {
          nav.classList.remove("is-open");
          toggle.setAttribute("aria-expanded", "false");
        }
      });
    }

    // Highlight the current top-level nav item
    var here = w.location.pathname.replace(/index\.html$/, "");
    d.querySelectorAll("[data-nav] a").forEach(function (a) {
      var href = a.getAttribute("href") || "";
      var path = href.replace(/^(\.\.\/)+/, "/").replace(/index\.html$/, "");
      if (path !== "/" && here.indexOf(path) !== -1) {
        a.setAttribute("aria-current", "page");
      } else if (path === "/" && (here === "/" || here.endsWith("/"))) {
        if (here === "/" ) a.setAttribute("aria-current", "page");
      }
    });
  });
})(window, document);
