/* Compass Toolkit: Preferred Calendar View.
 *
 * Compass always opens the calendar on Week view. This presses the view button
 * you actually want as soon as the toolbar is up, so the calendar lands where
 * you work rather than where Compass left it.
 *
 * It switches once, when the page loads and when the setting itself changes.
 * Anything you do by hand after that has to stick: a page that keeps dragging
 * you back to one view is worse than the default it was fixing.
 */
(function () {
  "use strict";

  if (!CompassToolkit.isTopFrame) return;

  /* ExtJS gives each view button a stable id, which is the only dependable
   * handle on this toolbar. Its classes are themed and its labels are the
   * school's wording, but these ids are Compass's own. "multiweek" is the one
   * labelled Term. */
  const VIEW_BUTTONS = {
    day: "calendar-manager-tb-day",
    week: "calendar-manager-tb-week",
    month: "calendar-manager-tb-month",
    multiweek: "calendar-manager-tb-multiweek",
    list: "calendar-manager-tb-list"
  };

  const PRESSED = "x-pressed";
  const POLL_MS = 200;
  const CHECK_MS = 100; // how often to look at whether a press has landed
  const GIVE_UP_MS = 25000; // a slow calendar can take this long to draw
  const CONFIRM_MS = 600; // how long to let a press land before trying again
  const CONFIRM_MAX_MS = 5000; // ceiling on the backoff between tries
  const MAX_PRESSES = 5;

  // The view we have already switched to on this page. Kept so a settings
  // change can switch again while a manual click cannot trigger one.
  let appliedView = null;
  // What we last told the page world about the week start, for when it asks
  // again because it started after we first said.
  let wantMonday = false;

  const isCalendarPage = () =>
    /\/Organise\/Calendar/i.test(location.pathname);

  CompassToolkit.observeFeature("calendarView", function (settings) {
    if (!isCalendarPage()) return;

    wantMonday = !!settings.enabled && settings.mondayStart !== false;
    sendWeekStart();
    setWeekendsHidden(!!settings.enabled && !!settings.hideWeekends);

    if (!settings.enabled) {
      appliedView = null;
      reveal();
      return;
    }
    const view = settings.view;
    if (!VIEW_BUTTONS[view] || view === appliedView) {
      reveal();
      return;
    }

    appliedView = view;
    CompassToolkit.whenReady(function () {
      whenWeekStartReady(function () {
        switchTo(view);
      });
    });
  });

  /* ---------------- waiting for the week start ---------------- */

  /* Switching view builds that view, laid out however the calendar is
   * configured at that moment, and that is the layout it keeps. Clicking
   * before the week start has been applied therefore lands you on the
   * Sunday-first grid the other half of this feature exists to avoid, which
   * is why the switch waits its turn. */
  const WEEK_START_WAIT_MS = 4000;
  let weekStartReady = false;
  const readyWaiters = [];

  window.addEventListener("compassToolkitWeekStartReady", weekStartIsReady);

  function weekStartIsReady() {
    if (weekStartReady) return;
    weekStartReady = true;
    while (readyWaiters.length) readyWaiters.shift()();
  }

  function whenWeekStartReady(fn) {
    // Nothing to wait for if the week is being left as Compass lays it out.
    if (weekStartReady || !wantMonday) {
      fn();
      return;
    }
    readyWaiters.push(fn);
    // Never block on it for good. Landing on Term a week late beats being
    // left on the Week view Compass opened.
    setTimeout(weekStartIsReady, WEEK_START_WAIT_MS);
  }

  /* ---------------- week start ---------------- */

  /* Which day a week starts on is Compass's own calendar library's business,
   * and only the page's world can reach it, so that half of this feature lives
   * in src/page/week-start.js and is told what to do from here. */
  function sendWeekStart() {
    window.dispatchEvent(
      new CustomEvent("compassToolkitWeekStart", {
        detail: { monday: wantMonday }
      })
    );
  }

  // Both scripts start at document_start, so the page side may have missed the
  // first send. It asks until it hears back.
  window.addEventListener("compassToolkitWeekStartRequest", function () {
    if (wantMonday) sendWeekStart();
  });

  /* ExtJS wires a button's pressed state up on mousedown and its handler on
   * click, so a bare .click() can leave the toolbar looking unpressed. Sending
   * the whole sequence is what a real click looks like to it. */
  function press(el) {
    ["mousedown", "mouseup", "click"].forEach(function (type) {
      el.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
      );
    });
  }

  // Which view the toolbar is showing, or null before it has drawn.
  function pressedView() {
    const keys = Object.keys(VIEW_BUTTONS);
    for (let i = 0; i < keys.length; i++) {
      const el = document.getElementById(VIEW_BUTTONS[keys[i]]);
      if (el && el.classList.contains(PRESSED)) return keys[i];
    }
    return null;
  }

  function switchTo(view) {
    const id = VIEW_BUTTONS[view];
    const deadline = Date.now() + GIVE_UP_MS;
    let presses = 0;
    let wait = CONFIRM_MS;
    let lastPress = 0;
    let startingView = null;

    function tick() {
      // The setting changed while we were waiting, so this run is stale.
      if (appliedView !== view) return;

      const button = document.getElementById(id);
      // The toolbar is built after the page, and its buttons have no size
      // until it lays out. Either way there is nothing to click yet.
      if (!button || !button.offsetWidth) {
        if (Date.now() < deadline) setTimeout(tick, POLL_MS);
        else reveal(); // the toolbar never came; show whatever there is
        return;
      }

      const showing = pressedView();
      if (showing === view) {
        // Arrived, by our press or otherwise. Let the view paint before it
        // is uncovered, so the reveal shows a finished calendar.
        setTimeout(reveal, SETTLE_MS);
        return;
      }

      /* A press can land on a button ExtJS has rendered but not yet attached
       * its handler to, which does nothing at all, so a press has to be
       * confirmed rather than assumed. The view not having moved at all is
       * what says the press went nowhere. If it has moved and still isn't
       * ours, somebody chose that, and this stops rather than fighting them. */
      if (startingView !== null && showing !== startingView) {
        reveal();
        return;
      }
      startingView = showing;

      /* Whether a press landed is checked far more often than a new press is
       * made. Tying the two together meant sitting through a whole backoff
       * step after a press that worked immediately, with the calendar still
       * covered for no reason. */
      const now = Date.now();
      if (lastPress === 0 || now - lastPress >= wait) {
        if (presses >= MAX_PRESSES) {
          console.log(
            "[Compass Toolkit] Calendar stayed on its own view after " +
              presses +
              " attempts"
          );
          reveal();
          return;
        }
        presses++;
        lastPress = now;
        press(button);
        wait = Math.min(wait * 2, CONFIRM_MAX_MS);
      }

      if (now < deadline) setTimeout(tick, CHECK_MS);
      else reveal();
    }

    tick();
  }

  /* ---------------- hiding weekends ---------------- */

  /* Saturday and Sunday take two of the seven columns in the Month and Term
   * grids and a school week never uses them, so this takes them out and lets
   * the other five have the width.
   *
   * Done cell by cell rather than with a nth-child rule, because an event
   * running over several days is a single cell with a colspan: everything
   * after it in that row sits further along than its position suggests, and a
   * rule counting positions would hide the wrong things.
   *
   * Every change is recorded on the element it was made to, so switching the
   * option off puts the grid back without a reload. */

  // The Week view's all-day strip carries the month view's class as well, so
  // it has to be excluded or its columns would be hidden without the time
  // grid below it following suit.
  const GRID = ".ext-cal-monthview:not(.ext-cal-day-header)";
  const DAY_TABLES = [".ext-cal-hd-days-tbl", ".ext-cal-bg-tbl", ".ext-cal-evt-tbl"];
  const HIDDEN_ATTR = "data-ct-weekend"; // a cell this hid
  const SPAN_ATTR = "data-ct-span"; // a colspan this shortened, and its old value
  const ROW_ATTR = "data-ct-weekends"; // which columns a row was last done for
  const WEEKEND_DEBOUNCE_MS = 30;

  let weekendsWanted = false;
  let weekendObserver = null;
  let weekendTimer = null;

  function setWeekendsHidden(wanted) {
    if (wanted === weekendsWanted) return;
    weekendsWanted = wanted;
    CompassToolkit.whenReady(function () {
      if (weekendsWanted) {
        hideWeekends();
        watchGrid();
      } else {
        unwatchGrid();
        restoreWeekends();
      }
    });
  }

  /* Compass redraws the grid whenever the view or the term changes, and what
   * it draws is its own seven columns again. */
  function watchGrid() {
    if (weekendObserver) return;
    weekendObserver = new MutationObserver(function () {
      if (weekendTimer) return;
      weekendTimer = setTimeout(function () {
        weekendTimer = null;
        hideWeekends();
      }, WEEKEND_DEBOUNCE_MS);
    });
    // Only new markup is watched. This changes attributes alone, so it cannot
    // set itself off again.
    weekendObserver.observe(document.body, { childList: true, subtree: true });
  }

  function unwatchGrid() {
    if (weekendObserver) weekendObserver.disconnect();
    weekendObserver = null;
    if (weekendTimer) clearTimeout(weekendTimer);
    weekendTimer = null;
  }

  /* Which columns are the weekend, read off the dates Compass puts in its own
   * cell ids. Working it out rather than assuming keeps this right whichever
   * day the week has been set to start on. */
  function weekendColumns() {
    const rows = document.querySelectorAll(GRID + " .ext-cal-bg-tbl tr");
    for (let i = 0; i < rows.length; i++) {
      const cells = dayCells(rows[i]);
      if (cells.length !== 7) continue;
      const cols = [];
      for (let c = 0; c < 7; c++) {
        if (isWeekend(cells[c])) cols.push(c);
      }
      if (cols.length === 2) return cols;
    }
    return null;
  }

  // The gutter and week-number cells are furniture, not days.
  function dayCells(row) {
    return Array.prototype.filter.call(row.cells || [], function (cell) {
      return (
        !cell.classList.contains("ext-cal-gutter") &&
        !cell.classList.contains("ext-cal-gutter-rt") &&
        !cell.classList.contains("ext-cal-week-link-hd")
      );
    });
  }

  function isWeekend(cell) {
    const match = /day-(\d{4})(\d{2})(\d{2})/.exec(cell.id || "");
    if (match) {
      const day = new Date(+match[1], +match[2] - 1, +match[3]).getDay();
      return day === 0 || day === 6;
    }
    // No date to read, so fall back to what Extensible marked as weekend.
    return cell.classList.contains("ext-cal-day-we");
  }

  function hideWeekends() {
    if (!weekendsWanted || !document.body) return;
    const cols = weekendColumns();
    if (!cols) return;

    const key = cols.join(",");
    const selector = DAY_TABLES.map(function (t) {
      return GRID + " " + t;
    }).join(",");

    Array.prototype.forEach.call(
      document.querySelectorAll(selector),
      function (table) {
        Array.prototype.forEach.call(table.rows, function (row) {
          if (row.getAttribute(ROW_ATTR) === key) return;
          hideRowWeekends(row, cols);
          row.setAttribute(ROW_ATTR, key);
        });
      }
    );
  }

  function hideRowWeekends(row, cols) {
    // Start from the row as Compass drew it, so a week that now starts on a
    // different day is not hidden twice over.
    restoreRow(row);

    let column = 0;
    Array.prototype.forEach.call(row.cells, function (cell) {
      if (dayCells(row).indexOf(cell) === -1) return; // furniture

      const span = cell.colSpan || 1;
      let hidden = 0;
      for (let i = column; i < column + span; i++) {
        if (cols.indexOf(i % 7) !== -1) hidden++;
      }

      if (hidden >= span) {
        // Nothing but weekend under it.
        cell.setAttribute(HIDDEN_ATTR, "");
        cell.style.display = "none";
      } else if (hidden > 0) {
        // Spans into the week as well, so it keeps its place and gives back
        // the width of the days that went.
        cell.setAttribute(SPAN_ATTR, String(span));
        cell.colSpan = span - hidden;
      }
      column += span;
    });
  }

  function restoreRow(row) {
    Array.prototype.forEach.call(row.cells, function (cell) {
      if (cell.hasAttribute(HIDDEN_ATTR)) {
        cell.style.display = "";
        cell.removeAttribute(HIDDEN_ATTR);
      }
      if (cell.hasAttribute(SPAN_ATTR)) {
        cell.colSpan = parseInt(cell.getAttribute(SPAN_ATTR), 10) || 1;
        cell.removeAttribute(SPAN_ATTR);
      }
    });
  }

  function restoreWeekends() {
    Array.prototype.forEach.call(
      document.querySelectorAll("[" + ROW_ATTR + "]"),
      function (row) {
        restoreRow(row);
        row.removeAttribute(ROW_ATTR);
      }
    );
  }

  /* ---------------- settling curtain ---------------- */

  /* Three things land on the calendar in its first second or two: Compass
   * renders the Week view it always opens on, this switches to another one,
   * and the week start redraws what that produced. Watching all of that
   * happen is worse than waiting a moment for it, so the calendar is covered
   * until it has settled.
   *
   * visibility, not display: ExtJS measures its own layout, and an element
   * with no box measures as nothing. Hidden still has its full size. */
  const CURTAIN_MAX_MS = 5000; // never leave it covered longer than this
  const SETTLE_MS = 60; // one frame or so for the new view to paint
  const CURTAIN_CSS =
    "#calendar-manager, .x-cal-panel { visibility: hidden !important; }";

  let curtain = null;
  let curtainTimer = null;

  function drawCurtain() {
    if (curtain || !document.documentElement) return;
    try {
      // The way out goes up first: a fault anywhere after this must not be
      // able to leave somebody looking at an invisible calendar.
      curtainTimer = setTimeout(reveal, CURTAIN_MAX_MS);
      curtain = document.createElement("style");
      curtain.textContent = CURTAIN_CSS;
      document.documentElement.appendChild(curtain);
    } catch (e) {
      reveal();
    }
  }

  function reveal() {
    // Last thing behind the cover, so the weekends are already gone by the
    // time anybody sees the grid.
    hideWeekends();
    if (curtainTimer) clearTimeout(curtainTimer);
    curtainTimer = null;
    if (curtain) curtain.remove();
    curtain = null;
  }

  /* Last, so everything it touches is initialised. The settings that say
   * whether there is anything to wait for are read asynchronously and cannot
   * arrive before this runs, so the cover goes up first and comes straight
   * back down if there turns out to be nothing to do. */
  if (isCalendarPage()) drawCurtain();
})();
