/* Compass Toolkit: page-context interceptor (MAIN world).
 *
 * Compass loads its timetable and calendar data over XHR/fetch, and there is
 * no way to read those responses from an isolated content script. This runs in
 * the page's own world at document_start so it can wrap XMLHttpRequest and
 * fetch before Compass uses them.
 *
 * It is deliberately passive: it only caches responses and hands them to the
 * content script. Nothing here changes what the page does.
 *
 * Endpoints:
 *   GetPeriodsByTimePeriod / GetEventsByUser   → Timetable Printer, Clearance
 *   GetCalendarEventsBy... / GetAllTerms       → Term Calendar Printer
 */
(function () {
  "use strict";

  if (window.__compassToolkit__) return; // already installed
  console.log("[Compass Toolkit] Interceptor active");

  const store = {
    periodsData: null,
    eventsData: null,
    calendarData: null,
    termData: null,
    calendarLayers: null
  };
  window.__compassToolkit__ = store;

  /* ---------------- school name / logo ---------------- */

  // Compass.schoolName is set by the page's own scripts, which have not run
  // at document_start, so retry as the page comes up.
  let schoolPosted = false;
  function postSchoolInfo() {
    if (schoolPosted) return;
    const name =
      window.Compass && window.Compass.schoolName ? window.Compass.schoolName : "";
    if (!name) return;
    schoolPosted = true;
    post("CT_SCHOOL_INFO", {
      name: name,
      logoUrl: window.location.origin + "/Download/Cdn/FrontPageLogo"
    });
  }

  function post(type, data) {
    try {
      window.postMessage({ source: "compass-toolkit", type: type, data: data }, "*");
    } catch (e) {
      console.error("[Compass Toolkit] postMessage failed:", e);
    }
  }

  postSchoolInfo();
  document.addEventListener("DOMContentLoaded", postSchoolInfo);
  window.addEventListener("load", postSchoolInfo);

  /* ---------------- calendar layer extraction ---------------- */

  /* Layer names and colours only exist in the calendar's sidebar markup, not
   * in any API response, so they have to be scraped when the user captures. */
  function extractCalendarLayers() {
    const layers = [];
    const allLayerElements = document.querySelectorAll("li.ext-cal-evr");
    if (allLayerElements.length === 0) {
      // Recoverable: the calendar renders without names. Logged, not warned,
      // so it doesn't show up as an extension fault.
      console.log(
        "[Compass Toolkit] Calendar layer list not visible, capturing without layer names"
      );
      return layers;
    }

    // The layer list lives in a "calendarlist...-body" container; the matching
    // header container has to be excluded or we read the wrong elements.
    const allContainers = document.querySelectorAll(
      '[id*="calendarlist"][id$="-body"]'
    );
    const containers = Array.from(allContainers).filter(function (el) {
      return !el.id.includes("_header");
    });

    let layerListElements;
    if (containers.length > 0) {
      layerListElements = containers[0].querySelectorAll("li.ext-cal-evr");
    } else {
      layerListElements = Array.from(allLayerElements).filter(function (el) {
        const ul = el.parentElement;
        return ul && ul.tagName === "UL" && ul.parentElement;
      });
    }

    Array.prototype.forEach.call(layerListElements, function (el) {
      const style = el.getAttribute("style");
      if (!style) return;

      const colorMatch = style.match(/background-color:\s*(#[0-9A-Fa-f]{6})/i);
      if (!colorMatch) return;
      const color = colorMatch[1].toUpperCase();

      // The <em> holds the checkbox glyph, not part of the name.
      const clone = el.cloneNode(true);
      const em = clone.querySelector("em");
      if (em) em.remove();

      const name = clone.textContent
        .replace(/\u00A0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!name) return;

      // Events are matched back to layers by colour, so a colour can only
      // belong to one layer.
      if (layers.some(function (l) { return l.color === color; })) return;

      layers.push({ color: color, name: name });
    });

    if (layers.length > 0) store.calendarLayers = layers;
    console.log("[Compass Toolkit] Extracted " + layers.length + " calendar layers");
    return layers;
  }

  store.extractLayers = extractCalendarLayers;

  // The content script asks for a capture when the user clicks in the popup.
  window.addEventListener("compassToolkitCalendarRequest", function () {
    const layers = extractCalendarLayers();
    if (layers.length > 0) store.calendarLayers = layers;

    window.dispatchEvent(
      new CustomEvent("compassToolkitCalendarData", {
        detail: {
          calendarData: store.calendarData,
          termData: store.termData,
          calendarLayers: store.calendarLayers
        }
      })
    );
  });

  /* ---------------- request interception ---------------- */

  function handleResponse(url, text) {
    if (!url || typeof url !== "string") return;
    const lower = url.toLowerCase();

    try {
      if (url.includes("GetPeriodsByTimePeriod")) {
        postSchoolInfo();
        store.periodsData = JSON.parse(text);
        post("CT_PERIODS_DATA", store.periodsData);
      } else if (url.includes("GetEventsByUser")) {
        store.eventsData = JSON.parse(text);
        post("CT_EVENTS_DATA", store.eventsData);
      } else if (lower.includes("getcalendareventsby")) {
        const response = JSON.parse(text);
        if (response && Array.isArray(response.d)) {
          store.calendarData = response.d;
          console.log(
            "[Compass Toolkit] Captured " + response.d.length + " calendar events"
          );
        }
      } else if (lower.includes("getallterms")) {
        const response = JSON.parse(text);
        if (response && Array.isArray(response.d)) {
          store.termData = response.d;
          console.log(
            "[Compass Toolkit] Captured " + response.d.length + " terms"
          );
        }
      }
    } catch (e) {
      // Not JSON, or a response we don't care about, so ignore it.
    }
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ctUrl = url;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    const xhr = this;
    xhr.addEventListener("load", function () {
      handleResponse(xhr.__ctUrl, xhr.responseText);
    });
    return originalSend.apply(this, arguments);
  };

  const originalFetch = window.fetch;
  window.fetch = function () {
    const args = arguments;
    const first = args[0];
    const url = typeof first === "string" ? first : first && first.url;

    return originalFetch.apply(this, args).then(function (response) {
      if (url) {
        // Read from a clone so the page still gets an unconsumed body.
        response
          .clone()
          .text()
          .then(function (text) {
            handleResponse(url, text);
          })
          .catch(function () {});
      }
      return response;
    });
  };
})();
