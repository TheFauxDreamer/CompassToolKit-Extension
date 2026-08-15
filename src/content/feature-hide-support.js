/* Compass Toolkit — Hide Support Button.
 *
 * Compass loads Intercom, which parks a help bubble in the bottom-left corner
 * of every page. This hides it.
 *
 * A stylesheet rather than removing the node: Intercom boots long after the
 * page and rebuilds its own DOM, so a rule keeps it hidden however many times
 * it comes back. Removing the rule brings it straight back, which is what
 * makes the toggle work without a reload.
 */
(function () {
  "use strict";

  const FEATURE = "hideSupportButton";
  const STYLE_ID = "compass-toolkit-hide-support";

  // Intercom uses different containers before and after it finishes booting.
  const SELECTORS = [
    ".intercom-lightweight-app",
    "#intercom-container",
    ".intercom-app",
    ".intercom-launcher-frame",
    ".intercom-namespace"
  ].join(", ");

  let styleEl = null;

  function hide() {
    if (styleEl && styleEl.isConnected) return;

    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.textContent = SELECTORS + " { display: none !important; }";
    // Appended to documentElement when there is no head yet: this runs at
    // document_start, and hiding early avoids the bubble ever flashing up.
    (document.head || document.documentElement).appendChild(styleEl);
  }

  function show() {
    if (styleEl) styleEl.remove();
    styleEl = null;
  }

  CompassToolkit.observeFeature(FEATURE, function (settings) {
    if (settings.enabled) {
      hide();
    } else {
      show();
    }
  });
})();
