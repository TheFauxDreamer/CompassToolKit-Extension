/* Compass Toolkit: Clean Staff Directory.
 *
 * Hides staff cards whose name contains any of the configured phrases, so
 * integration and system accounts stop cluttering the directory.
 */
(function () {
  "use strict";

  const FEATURE = "directoryFilter";
  const CARD_LINK = 'a[href*="User.aspx"]';
  const CARD = "div.MuiGrid-item";

  let filters = [];
  let enabled = false;
  let observer = null;

  function shouldHide(card) {
    const nameLink = card.querySelector(CARD_LINK);
    if (!nameLink) return false;

    const name = nameLink.textContent.trim().toLowerCase();
    return filters.some(function (phrase) {
      return phrase && name.includes(phrase.toLowerCase());
    });
  }

  function processCard(card) {
    if (enabled && shouldHide(card)) {
      card.style.display = "none";
      card.dataset.compassFiltered = "true";
    } else if (card.dataset.compassFiltered) {
      // Previously hidden, so the filters (or the feature) changed.
      card.style.display = "";
      delete card.dataset.compassFiltered;
    }
  }

  function applyFilters() {
    document.querySelectorAll(CARD + " " + CARD_LINK).forEach(function (link) {
      const card = link.closest(CARD);
      if (card) processCard(card);
    });
  }

  function unhideAll() {
    document
      .querySelectorAll('[data-compass-filtered="true"]')
      .forEach(function (card) {
        card.style.display = "";
        delete card.dataset.compassFiltered;
      });
  }

  // The directory is a React list: pagination, search and sorting all
  // re-render it, so new cards have to be caught as they arrive.
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(function (mutations) {
      const added = mutations.some(function (mutation) {
        return Array.prototype.some.call(mutation.addedNodes, function (node) {
          if (node.nodeType !== Node.ELEMENT_NODE) return false;
          return !!node.querySelector?.(CARD_LINK) || !!node.matches?.(CARD);
        });
      });
      if (added) applyFilters();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  CompassToolkit.observeFeature(FEATURE, function (settings) {
    enabled = !!settings.enabled;
    filters = Array.isArray(settings.filters) ? settings.filters : [];

    CompassToolkit.whenReady(function () {
      if (!enabled) {
        stopObserver();
        unhideAll();
        return;
      }
      applyFilters();
      startObserver();
    });
  });
})();
