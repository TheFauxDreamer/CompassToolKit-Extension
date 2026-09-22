/* Compass Toolkit: no new tabs (MAIN world).
 *
 * Compass's newer homepage panels are React cards rather than links. The
 * Favourite Modules tiles carry no href at all and reach their page through
 * window.open, so there is no target attribute for the content script half of
 * this feature to strip. Only the page's own world can see that call, so this
 * runs there and sends same-site openings to the tab you are already in.
 *
 * Two things are deliberately left alone. Anything leaving Compass still gets
 * its own tab, which is what keeps School Favourites, Outlook and the links
 * inside posts opening where they always did. So does a window asked for at a
 * particular size, because that is a dialogue Compass meant to open rather
 * than a tab that got away.
 */
(function () {
  "use strict";

  if (window.__compassToolkitNoNewTabs__) return;
  window.__compassToolkitNoNewTabs__ = true;

  const ASK_MS = 100;
  const ASK_LIMIT = 40; // 4s of asking the content script for the setting

  let wanted = false; // has the content script said the feature is on?
  let answered = false;
  let reported = false;

  /* Settings live in extension storage, which only the content script can
   * read, so it sends them in here and again whenever they change. The
   * listener goes up first so no answer can be missed. */
  window.addEventListener("compassToolkitNoNewTabs", function (event) {
    const detail = (event && event.detail) || {};
    answered = true;
    wanted = !!detail.sameTab;
  });

  /* A features string naming a size means a pop-up window, not a tab. */
  const SIZED = /\b(width|height|left|top|popup)\b/i;

  function sameSite(href) {
    try {
      const target = new URL(String(href), location.href);
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        return false;
      }
      return target.origin === location.origin;
    } catch (e) {
      // Not something that resolves to an address, so not ours to redirect.
      return false;
    }
  }

  // An absent target is a new tab too: that is what window.open defaults to.
  function isNewTab(target) {
    if (target === undefined || target === null || target === "") return true;
    const name = String(target).toLowerCase();
    return name === "_blank" || name === "_new";
  }

  function shouldRedirect(url, target, features) {
    if (!wanted || !url) return false;
    if (!isNewTab(target)) return false;
    if (features && SIZED.test(String(features))) return false;
    return sameSite(url);
  }

  const nativeOpen = window.open;

  window.open = function (url, target, features) {
    if (shouldRedirect(url, target, features)) {
      try {
        const href = new URL(String(url), location.href).href;
        // Say once that this is running, so a card that still opens a tab can
        // be told apart from one this never reached.
        if (!reported) {
          reported = true;
          console.log("[Compass Toolkit] Opening in this tab: " + href);
        }
        location.assign(href);
        /* Callers commonly follow up with win.focus(), so handing back this
         * window keeps that working. The page they asked for is the one that
         * is now loading here. */
        return window;
      } catch (e) {
        // Fall through and let Compass have its tab rather than nothing.
      }
    }
    return nativeOpen.apply(this, arguments);
  };

  /* Both scripts start at document_start, so whichever runs second misses the
   * other's first event. Asking until answered covers either order. */
  let asks = 0;
  const askTimer = setInterval(function () {
    if (answered || asks++ >= ASK_LIMIT) {
      clearInterval(askTimer);
      return;
    }
    window.dispatchEvent(new CustomEvent("compassToolkitNoNewTabsRequest"));
  }, ASK_MS);
  window.dispatchEvent(new CustomEvent("compassToolkitNoNewTabsRequest"));
})();
