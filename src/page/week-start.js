/* Compass Toolkit: week start (MAIN world).
 *
 * Compass builds its calendar with Extensible Calendar for ExtJS, which lays
 * each week out from a `startDay` config. Compass sets that to Monday on the
 * Week view and leaves the Month and Term views on Extensible's own default of
 * Sunday, which is the split this closes.
 *
 * Only the page's own world can reach Ext, so this runs there. There are two
 * ways in, and which one is available depends on how far Compass has got:
 *
 *   1. Before the calendar is built, the prototype default decides what the
 *      views are constructed with, and nothing has to be redrawn.
 *   2. Once it is built, the view components have to be changed and asked to
 *      recompute, which is the slower and more brittle of the two.
 *
 * Both are tried, both are best effort, and every step is wrapped: a calendar
 * laid out the way Compass intended is a far better failure than a broken one.
 * What it managed is logged, so a page that doesn't take can be diagnosed.
 */
(function () {
  "use strict";

  if (window.__compassToolkitWeekStart__) return;
  window.__compassToolkitWeekStart__ = true;

  const MONDAY = 1;
  const POLL_MS = 250;
  const WATCH_MS = 30000; // views are built lazily, so keep looking a while
  const ASK_MS = 100;
  const ASK_LIMIT = 40; // 4s of asking the content script for the setting

  let wanted = false; // has the content script asked for Monday?
  let watching = false;
  let reported = false;
  let announced = false;

  function log(message) {
    console.log("[Compass Toolkit] " + message);
  }

  /* Switching the calendar to another view builds that view, and it is built
   * with whatever startDay is set at that moment. The view switch therefore
   * has to hold off until this has landed, or it would hand you the very
   * Sunday-first grid this is here to avoid. */
  function announce() {
    if (announced) return;
    announced = true;
    window.dispatchEvent(new CustomEvent("compassToolkitWeekStartReady"));
  }

  /* ---------------- the setting ---------------- */

  /* Settings live in extension storage, which only the content script can
   * read, so it sends them in here and again whenever they change. */
  /* The listener goes up first so no answer can be missed, but the work it
   * starts is deferred. The content script answers synchronously, so asking
   * below would otherwise run watch() partway through this script, before the
   * declarations under here exist. */
  window.addEventListener("compassToolkitWeekStart", function (event) {
    const detail = (event && event.detail) || {};
    if (!detail.monday || wanted) return;
    // Turning it back off is left to a page reload. Undoing it live would mean
    // rebuilding the calendar a second time to no benefit.
    wanted = true;
    setTimeout(watch, 0);
  });

  /* ---------------- before the calendar is built ---------------- */

  /* Setting the default on the prototypes is the clean way in: views built
   * afterwards simply come out Monday first. Compass configures the Week view
   * explicitly, so that one keeps whatever it was given either way. */
  const PROTOTYPES = [
    ["calendar", "view", "AbstractCalendar"],
    ["calendar", "view", "Month"],
    ["calendar", "view", "MultiWeek"],
    ["calendar", "CalendarPanel"]
  ];

  function patchPrototypes() {
    const root = window.Extensible;
    if (!root || !root.calendar) return 0;

    let patched = 0;
    PROTOTYPES.forEach(function (path) {
      try {
        let node = root;
        for (let i = 0; i < path.length && node; i++) node = node[path[i]];
        if (!node || !node.prototype) return;
        if (node.prototype.startDay === MONDAY) return;
        if (typeof node.prototype.startDay !== "number") return;
        node.prototype.startDay = MONDAY;
        patched++;
      } catch (e) {
        // A build without that class. Nothing to do about it.
      }
    });
    return patched;
  }

  /* ---------------- after the calendar is built ---------------- */

  /* The views are found through their own markup rather than through a
   * component id, so this does not depend on the calendar panel being called
   * what it is called on one school's Compass. */
  function calendarViews() {
    const out = [];
    if (!window.Ext || typeof Ext.getCmp !== "function") return out;

    const nodes = document.querySelectorAll(
      ".ext-cal-multiweekview, .ext-cal-monthview, .ext-cal-dayview"
    );
    Array.prototype.forEach.call(nodes, function (node) {
      if (!node.id) return;
      try {
        const cmp = Ext.getCmp(node.id);
        // startDay is what marks a component as one of the calendar views;
        // the header strips carry the same classes but have no layout.
        if (!cmp || typeof cmp.startDay !== "number") return;
        if (out.indexOf(cmp) === -1) out.push(cmp);
      } catch (e) {
        // Not a component, or the id belongs to something else.
      }
    });
    return out;
  }

  /* A view that has already drawn keeps its dates until it recomputes them.
   * setStartDate is what triggers that; refresh is the fallback for a build
   * where it is missing. */
  /* Whether the view has actually taken the new start day. viewStart is the
   * first date it is showing, so on a Monday-first grid it falls on a Monday.
   * Checking rather than assuming is what keeps this to one redraw. */
  function alreadyMonday(cmp) {
    try {
      const start = cmp.viewStart || cmp.startDate;
      return !!start && typeof start.getDay === "function" &&
        start.getDay() === MONDAY;
    } catch (e) {
      return false;
    }
  }

  function redraw(cmp) {
    let done = false;
    /* Some builds of setStartDate return early when handed the date the view
     * already holds, which is exactly what this passes it, so it cannot be
     * trusted on its own. refresh is the fallback, but only when the first
     * one plainly did nothing: running both every time redraws every view
     * twice, which is visible as a flicker. */
    try {
      if (typeof cmp.setStartDate === "function" && cmp.startDate) {
        cmp.setStartDate(cmp.startDate, true);
        done = true;
      }
    } catch (e) {
      // Fall through to the blunter one.
    }
    if (done && alreadyMonday(cmp)) return true;
    try {
      if (typeof cmp.refresh === "function") {
        cmp.refresh(true);
        done = true;
      }
    } catch (e) {
      // Left as it was, which is Compass's own layout.
    }
    return done;
  }

  function patchViews() {
    let changed = 0;
    calendarViews().forEach(function (cmp) {
      if (cmp.startDay === MONDAY) return;
      try {
        cmp.startDay = MONDAY;
        redraw(cmp);
        changed++;
      } catch (e) {
        // One view refusing should not stop the others.
      }
    });
    return changed;
  }

  /* ---------------- watching ---------------- */

  function watch() {
    if (watching) return;
    watching = true;

    const deadline = Date.now() + WATCH_MS;
    let protos = 0;
    let views = 0;

    function tick() {
      try {
        protos += patchPrototypes();
        views += patchViews();
      } catch (e) {
        console.error("[Compass Toolkit] week start failed:", e);
        return;
      }

      // Say once what was found, so a calendar that ignores this can be told
      // apart from one this never reached.
      if (!reported && (protos || views)) {
        reported = true;
        log(
          "Week starts on Monday (" +
            protos +
            " defaults, " +
            views +
            " views already drawn)"
        );
      }
      // The defaults are what a view about to be built will read, so once
      // they are set it is safe to switch views.
      if (protos) announce();

      if (Date.now() < deadline) setTimeout(tick, POLL_MS);
      else if (!reported) {
        log("Could not set the week start: no Extensible calendar on this page");
        announce();
      }
    }

    tick();
  }

  /* ---------------- asking ---------------- */

  /* Both scripts start at document_start, so whichever runs second misses the
   * other's first event. Asking until answered covers either order. This is
   * last in the file because the content script replies synchronously, and the
   * reply runs the code above. */
  let asks = 0;
  const askTimer = setInterval(function () {
    if (wanted || asks++ >= ASK_LIMIT) {
      clearInterval(askTimer);
      return;
    }
    window.dispatchEvent(new CustomEvent("compassToolkitWeekStartRequest"));
  }, ASK_MS);
  window.dispatchEvent(new CustomEvent("compassToolkitWeekStartRequest"));
})();
