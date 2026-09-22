/* Compass Toolkit: No New Tabs.
 *
 * Compass marks nearly every link target="_blank", so ordinary navigation
 * litters the window with tabs. This strips that attribute, with two
 * exceptions the user can turn off: the School Favourites menu (which links
 * out to other systems) and links inside posts.
 *
 * The newer homepage panels are React cards with no link to strip: they reach
 * their page through window.open, which only the page's own world can see, so
 * that half of this feature lives in src/page/no-new-tabs.js and is told from
 * here whether it is on.
 */
(function () {
  "use strict";

  const FEATURE = "noNewTabs";
  const OUTLOOK_URL = "https://outlook.office.com/owa/?realm=education.wa.edu.au";
  const POST_SELECTOR = ".quill-viewer.MuiBox-root.css-0";

  let config = null;
  let observer = null;
  // Remembers what each link's target was before we touched it, so disabling
  // the feature puts the page back the way Compass had it.
  const originalTargets = new WeakMap();

  function isFavouriteLink(link) {
    if (link.href === OUTLOOK_URL) return true;

    const parentLi = link.closest("li.clickable");
    if (!parentLi) return false;
    const menuHeader = parentLi.querySelector(".mnuHead");
    return !!menuHeader && menuHeader.textContent.trim() === "School Favourites";
  }

  const isPostLink = (link) => !!link.closest(POST_SELECTOR);

  function shouldPreserve(link) {
    if (config.keepFavourites && isFavouriteLink(link)) return true;
    if (config.postLinksNewTab && isPostLink(link)) return true;
    return false;
  }

  function remember(link) {
    if (!originalTargets.has(link)) {
      originalTargets.set(link, link.getAttribute("target"));
    }
  }

  function stripTargets() {
    document.querySelectorAll('a[target="_blank"]').forEach(function (link) {
      if (shouldPreserve(link)) return;
      remember(link);
      link.removeAttribute("target");
    });
  }

  function markPostLinks() {
    if (!config.postLinksNewTab) return;
    document.querySelectorAll(POST_SELECTOR).forEach(function (container) {
      container
        .querySelectorAll('a:not([target="_blank"])')
        .forEach(function (link) {
          remember(link);
          link.setAttribute("target", "_blank");
        });
    });
  }

  function restore() {
    document.querySelectorAll("a").forEach(function (link) {
      if (!originalTargets.has(link)) return;
      const original = originalTargets.get(link);
      if (original) {
        link.setAttribute("target", original);
      } else {
        link.removeAttribute("target");
      }
    });
  }

  function apply() {
    stripTargets();
    markPostLinks();
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(function (mutations) {
      const touched = mutations.some(function (mutation) {
        return Array.prototype.some.call(mutation.addedNodes, function (node) {
          if (node.nodeType !== Node.ELEMENT_NODE) return false;
          return (
            node.tagName === "A" ||
            !!node.querySelector("a") ||
            node.classList.contains("quill-viewer") ||
            !!node.querySelector(".quill-viewer")
          );
        });
      });
      if (touched) apply();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  /* ---------------- the page's own world ---------------- */

  /* What the cards do on click is the page's own code, so the window.open
   * half of this feature runs there and is told from here whether it is on.
   * It is sent on every settings change, so turning the feature off takes
   * effect without a reload, the same as stripping targets does. */
  function sendSameTab() {
    window.dispatchEvent(
      new CustomEvent("compassToolkitNoNewTabs", {
        detail: { sameTab: !!(config && config.enabled) }
      })
    );
  }

  // Both scripts start at document_start, so the page side may have missed
  // the first send. It asks until it hears back.
  window.addEventListener("compassToolkitNoNewTabsRequest", sendSameTab);

  CompassToolkit.observeFeature(FEATURE, function (settings) {
    config = settings;
    sendSameTab();
    CompassToolkit.whenReady(function () {
      if (!config.enabled) {
        stopObserver();
        restore();
        return;
      }
      apply();
      startObserver();
    });
  });
})();
