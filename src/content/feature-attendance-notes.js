/* Compass Toolkit — Quick Attendance Notes.
 *
 * Clicking the "Attendance Notes require review" alert on the home page lands
 * you on the Attendance page's default tab, so the notes are always one more
 * click away. This flags the click, then activates the Notes tab on arrival.
 *
 * The flag is what keeps ordinary visits to /Organise/Attendance/ untouched —
 * only a click on the notification jumps to Notes.
 */
(function () {
  "use strict";

  const FEATURE = "attendanceNotes";
  const FLAG = "ct_openNotesTab";
  const TAB_LABEL = "notes";
  const FLAG_TTL_MS = 60 * 1000; // the flag goes stale after a minute
  const GIVE_UP_MS = 25 * 1000; // stop hunting for the tab after this
  const MAX_CLICKS = 6;

  let enabled = false;

  const onAttendancePage = () =>
    /^\/Organise\/Attendance/i.test(location.pathname);

  /* ---------- part 1: catch the notification click ---------- */

  // The Organisation menu links to /Organise/Attendance/ too, so an href match
  // alone would fire on ordinary navigation. The notification sits in a MUI
  // card mentioning the notes; the menu link carries class "navigatable".
  function isNotificationLink(link) {
    if (link.classList.contains("navigatable")) return false;
    if (link.closest("li.clickable, .mnuHead, .mnuSubHead")) return false;

    const card = link.closest(
      ".MuiCardContent-root, .MuiCard-root, .MuiPaper-root"
    );
    if (card) return /attendance note/i.test(card.textContent || "");

    // Fallback if the card markup changes: check the immediate surroundings.
    const near = link.closest("span, div, p");
    return !!near && /attendance note/i.test(near.textContent || "");
  }

  document.addEventListener(
    "click",
    function (e) {
      if (!enabled) return;
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;
      const link = el.closest('a[href*="/Organise/Attendance"]');
      if (!link || !isNotificationLink(link)) return;

      try {
        sessionStorage.setItem(FLAG, String(Date.now()));
      } catch (_) {
        /* private mode / storage blocked — nothing we can do */
      }
      watchForSoftNavigation();
    },
    true
  );

  // The home page can navigate without a full page load, in which case no new
  // content script runs and nothing would pick the flag up.
  function watchForSoftNavigation() {
    if (onAttendancePage()) return;
    let ticks = 0;
    const iv = setInterval(function () {
      if (onAttendancePage()) {
        clearInterval(iv);
        start();
      } else if (++ticks > 40) {
        clearInterval(iv); // ~10s
      }
    }, 250);
  }

  /* ---------- part 2: activate the Notes tab ---------- */

  function flagIsFresh() {
    let stamp;
    try {
      stamp = Number(sessionStorage.getItem(FLAG) || 0);
    } catch (_) {
      return false;
    }
    return stamp > 0 && Date.now() - stamp < FLAG_TTL_MS;
  }

  function clearFlag() {
    try {
      sessionStorage.removeItem(FLAG);
    } catch (_) {}
  }

  // ExtJS tab markup:
  //   <a class="x-tab ..."><span class="x-tab-wrap"><span class="x-tab-button">
  //     <span class="x-tab-inner">Notes</span> ...
  function findNotesTab() {
    const labels = document.querySelectorAll(".x-tab-inner");
    for (const label of labels) {
      if (label.textContent.trim().toLowerCase() !== TAB_LABEL) continue;
      const tab = label.closest(".x-tab") || label.closest("a");
      // Skip tabs that aren't visible yet (hidden panels, measuring passes).
      if (tab && tab.offsetParent !== null) return tab;
    }
    return null;
  }

  const isActive = (tab) =>
    tab.classList.contains("x-tab-active") || tab.classList.contains("x-active");

  // ExtJS listens for the full pointer sequence, not just a click.
  function clickTab(tab) {
    const target = tab.querySelector(".x-tab-button") || tab;
    const rect = target.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      buttons: 1,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2)
    };
    const seq = [
      ["pointerdown", window.PointerEvent],
      ["mousedown", MouseEvent],
      ["pointerup", window.PointerEvent],
      ["mouseup", MouseEvent],
      ["click", MouseEvent]
    ];
    for (const [type, Ctor] of seq) {
      const C = Ctor || MouseEvent;
      try {
        target.dispatchEvent(new C(type, opts));
      } catch (_) {}
    }
  }

  function start() {
    if (!enabled || !onAttendancePage() || !flagIsFresh()) return;
    clearFlag(); // one shot — a later refresh won't re-trigger

    const deadline = Date.now() + GIVE_UP_MS;
    let clicks = 0;
    let finished = false;

    const stop = () => {
      finished = true;
      observer.disconnect();
      clearInterval(poll);
    };

    const attempt = () => {
      if (finished) return;
      if (Date.now() > deadline || clicks >= MAX_CLICKS) return stop();

      const tab = findNotesTab();
      if (!tab) return; // panel hasn't rendered yet
      if (isActive(tab)) return stop(); // already showing Notes

      clicks++;
      clickTab(tab);

      // Verify shortly after — ExtJS applies the active class on its own turn.
      setTimeout(function () {
        const t = findNotesTab();
        if (t && isActive(t)) stop();
      }, 400);
    };

    const observer = new MutationObserver(attempt);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    const poll = setInterval(attempt, 300);

    attempt();
    setTimeout(stop, GIVE_UP_MS + 1000);
  }

  CompassToolkit.observeFeature(FEATURE, function (settings) {
    const wasEnabled = enabled;
    enabled = !!settings.enabled;
    if (enabled && !wasEnabled) CompassToolkit.whenReady(start);
  });
})();
