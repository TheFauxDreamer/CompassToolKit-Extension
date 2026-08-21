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
  const GIVE_UP_MS = 25000; // a slow calendar can take this long to draw
  const CONFIRM_MS = 600; // how long to let a press land before trying again
  const CONFIRM_MAX_MS = 5000; // ceiling on the backoff between tries
  const MAX_PRESSES = 5;

  // The view we have already switched to on this page. Kept so a settings
  // change can switch again while a manual click cannot trigger one.
  let appliedView = null;

  const isCalendarPage = () =>
    /\/Organise\/Calendar/i.test(location.pathname);

  CompassToolkit.observeFeature("calendarView", function (settings) {
    if (!settings.enabled || !isCalendarPage()) {
      appliedView = null;
      return;
    }
    const view = settings.view;
    if (!VIEW_BUTTONS[view] || view === appliedView) return;

    appliedView = view;
    CompassToolkit.whenReady(function () {
      switchTo(view);
    });
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
    let startingView = null;

    function tick() {
      // The setting changed while we were waiting, so this run is stale.
      if (appliedView !== view) return;

      const button = document.getElementById(id);
      // The toolbar is built after the page, and its buttons have no size
      // until it lays out. Either way there is nothing to click yet.
      if (!button || !button.offsetWidth) {
        if (Date.now() < deadline) setTimeout(tick, POLL_MS);
        return;
      }

      const showing = pressedView();
      if (showing === view) return; // arrived, by our press or otherwise

      /* A press can land on a button ExtJS has rendered but not yet attached
       * its handler to, which does nothing at all, so a press has to be
       * confirmed rather than assumed. The view not having moved at all is
       * what says the press went nowhere. If it has moved and still isn't
       * ours, somebody chose that, and this stops rather than fighting them. */
      if (startingView !== null && showing !== startingView) return;
      startingView = showing;

      if (presses >= MAX_PRESSES) {
        console.log(
          "[Compass Toolkit] Calendar stayed on its own view after " +
            presses +
            " attempts"
        );
        return;
      }
      presses++;
      press(button);
      setTimeout(tick, wait);
      wait = Math.min(wait * 2, CONFIRM_MAX_MS);
    }

    tick();
  }
})();
