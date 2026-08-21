/* Compass Toolkit: Term Calendar Printer (page side).
 *
 * The calendar only ever holds one term's events in memory, so capture is
 * driven from the popup: it asks this script to pull whatever the page has
 * loaded, which is handed over by the page-context interceptor.
 */
(function () {
  "use strict";

  if (!CompassToolkit.isTopFrame) return;

  const KEYS = CompassToolkit.DATA_KEYS;
  const CAPTURE_TIMEOUT_MS = 3000;

  let enabled = false;

  CompassToolkit.observeFeature("calendarPrinter", function (settings) {
    enabled = !!settings.enabled;
  });

  const isCalendarPage = () =>
    /\/Organise\/Calendar/i.test(location.pathname);

  // Only the Term view has the whole term loaded; capturing from Week or Month
  // view would silently produce a near-empty calendar.
  function isTermView() {
    const termButton = document.getElementById("calendar-manager-tb-multiweek");
    return !!termButton && termButton.classList.contains("x-pressed");
  }

  function capture(sendResponse) {
    let settled = false;

    function onData(event) {
      if (settled) return;
      settled = true;
      window.removeEventListener("compassToolkitCalendarData", onData);

      const detail = event.detail || {};
      const events = detail.calendarData;
      const terms = detail.termData;
      const layers = detail.calendarLayers;
      const timestamp = new Date().toISOString();

      const payload = {};
      if (events) payload[KEYS.calendar] = { events: events, timestamp: timestamp };
      if (terms) payload[KEYS.terms] = { terms: terms, timestamp: timestamp };
      if (layers && layers.length) {
        payload[KEYS.layers] = { layers: layers, timestamp: timestamp };
      }

      CompassToolkit.setData(payload).then(function () {
        sendResponse({
          success: true,
          eventCount: events ? events.length : 0,
          termCount: terms ? terms.length : 0,
          layerCount: layers ? layers.length : 0
        });
      });
    }

    window.addEventListener("compassToolkitCalendarData", onData);
    window.dispatchEvent(new CustomEvent("compassToolkitCalendarRequest"));

    setTimeout(function () {
      if (settled) return;
      settled = true;
      window.removeEventListener("compassToolkitCalendarData", onData);
      sendResponse({
        success: false,
        error:
          "The page didn't respond. Refresh the calendar page and try again."
      });
    }, CAPTURE_TIMEOUT_MS);
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.type) return;

    if (message.type === "CT_CHECK_VIEW") {
      sendResponse({
        isCalendarPage: isCalendarPage(),
        isTermView: isTermView(),
        enabled: enabled
      });
      return true;
    }

    if (message.type === "CT_CAPTURE_CALENDAR") {
      if (!enabled) {
        sendResponse({ success: false, error: "Feature is turned off." });
        return true;
      }
      capture(sendResponse);
      return true; // response is async
    }
  });
})();
