/* Compass Toolkit: Attendance Note Watcher (page side).
 *
 * The checking itself is done by the background worker
 * (src/background/attendance-watcher.js). This is the part that lives on
 * Compass pages: it passes on what the homepage's own alerts request looked
 * like, makes a check from inside the tab when the worker asks (where your
 * signed-in session is certain), and shows the in-page banner.
 */
(function () {
  "use strict";

  if (!CompassToolkit.isTopFrame) return;

  const FEATURE = "attendanceWatcher";

  let enabled = false;
  // The homepage's alerts call can land before the settings have been read.
  let unsent = null;

  function send(message) {
    try {
      chrome.runtime.sendMessage(message, function () {
        // Read so an absent listener isn't reported as an extension error.
        void chrome.runtime.lastError;
      });
    } catch (e) {
      /* the extension was reloaded underneath this page */
    }
  }

  /* ---------------- what the homepage asked for ---------------- */

  window.addEventListener("message", function (e) {
    if (e.source !== window || e.origin !== location.origin) return;
    const msg = e.data;
    if (!msg || msg.source !== "compass-toolkit" || msg.type !== "CT_ALERTS_SEEN") {
      return;
    }

    let seen;
    try {
      const url = new URL(msg.data.url);
      seen = {
        type: "CT_WATCHER_LEARNED",
        origin: location.origin,
        endpoint: {
          url: url.pathname + url.search,
          method: msg.data.method,
          body: msg.data.body
        },
        text: msg.data.text
      };
    } catch (err) {
      return;
    }

    if (enabled) send(seen);
    else unsent = seen;
  });

  /* ---------------- banner ---------------- */

  /* Compass tidies up elements it doesn't recognise, so the banner lives on
   * <html> (outside the page body) and puts itself back if it gets removed,
   * until you dismiss it or open the notes. */
  let bannerHost = null;
  let guard = null;
  let reattachCount = 0;

  function buildBanner(result) {
    const host = document.createElement("caw-banner");
    host.style.cssText =
      "all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;display:block;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML =
      "<style>" +
      '.card{font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fff;color:#1a2330;' +
      "border-left:6px solid #c2410c;border-radius:6px;box-shadow:0 6px 24px rgba(20,50,60,.25);" +
      "padding:14px 16px;width:320px}" +
      "h2{font-size:15px;margin:0 0 12px;font-weight:600}" +
      ".row{display:flex;gap:8px;justify-content:flex-end}" +
      "button{font:inherit;font-size:13px;border-radius:4px;padding:6px 12px;cursor:pointer;border:1px solid #c2410c}" +
      ".primary{background:#c2410c;color:#fff}" +
      ".ghost{background:#fff;color:#c2410c}" +
      "button:focus-visible{outline:2px solid #1a2330;outline-offset:2px}" +
      "</style>" +
      '<div class="card" role="alert">' +
      "<h2></h2>" +
      '<div class="row">' +
      '<button class="ghost" data-a="dismiss">Dismiss</button>' +
      '<button class="primary" data-a="review">Review notes</button>' +
      "</div></div>";
    root.querySelector("h2").textContent =
      result.title || "New attendance notes need review.";
    root.addEventListener("click", function (e) {
      const button = e.target.closest("button");
      const action = button && button.dataset.a;
      if (action === "dismiss") hideBanner();
      if (action === "review") {
        hideBanner();
        send({ type: "CT_WATCHER_OPEN_NOTES" });
      }
    });
    return host;
  }

  function attach() {
    if (bannerHost && !bannerHost.isConnected) {
      document.documentElement.appendChild(bannerHost);
    }
  }

  function showBanner(result) {
    hideBanner();
    bannerHost = buildBanner(result);
    reattachCount = 0;
    attach();
    guard = new MutationObserver(function () {
      if (!bannerHost || bannerHost.isConnected) return;
      // Put it back, but don't fight the page forever if something keeps removing it.
      if (++reattachCount > 50) return stopGuard();
      attach();
    });
    guard.observe(document, { childList: true, subtree: true });
  }

  function stopGuard() {
    if (guard) guard.disconnect();
    guard = null;
  }

  function hideBanner() {
    stopGuard();
    if (bannerHost) bannerHost.remove();
    bannerHost = null;
  }

  /* ---------------- messages from the background ---------------- */

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.type) return;

    if (message.type === "CT_WATCHER_FETCH") {
      // Same request the worker would make, made from inside the Compass tab.
      CompassToolkitAlerts.fetchAlerts(location.origin, message.endpoint).then(
        sendResponse
      );
      return true;
    }
    if (message.type === "CT_WATCHER_SHOW_BANNER") {
      showBanner(message.result);
      sendResponse({ ok: true });
    }
    if (message.type === "CT_WATCHER_HIDE_BANNER") {
      hideBanner();
      sendResponse({ ok: true });
    }
  });

  /* ---------------- on and off ---------------- */

  /* Off means idle: nothing is sent to the worker, and a banner already on
   * screen goes with it. */
  CompassToolkit.observeFeature(FEATURE, function (settings) {
    const wasEnabled = enabled;
    enabled = !!settings.enabled;

    if (!enabled) {
      hideBanner();
      unsent = null;
      return;
    }
    if (wasEnabled) return;

    send({ type: "CT_WATCHER_HELLO", origin: location.origin });
    if (unsent) send(unsent);
    unsent = null;
  });
})();
