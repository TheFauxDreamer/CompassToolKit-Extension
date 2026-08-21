/* Compass Toolkit: Timetable Printer and Clearance Form.
 *
 * Both features live on the same page (a profile's Schedule tab) and are built
 * from the same two API responses, so they share one listener and one cache
 * here rather than intercepting the page twice.
 */
(function () {
  "use strict";

  if (!CompassToolkit.isTopFrame) return;
  if (!/\/Records\/UserNew\.aspx/i.test(location.pathname)) return;

  const KEYS = CompassToolkit.DATA_KEYS;
  const CHECK_INTERVAL_MS = 3000;
  const FULL_WEEK_DAYS = 5;

  let periodsData = null;
  let eventsData = null;
  let schoolInfo = null;

  let timetableConfig = { enabled: false };
  let clearanceConfig = { enabled: false };

  let timetableButton = null;
  let clearanceButton = null;

  /* ---------------- data capture ---------------- */

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "compass-toolkit") return;

    if (msg.type === "CT_SCHOOL_INFO") {
      schoolInfo = msg.data;
      CompassToolkit.setData({ [KEYS.school]: schoolInfo });
    } else if (msg.type === "CT_PERIODS_DATA") {
      periodsData = msg.data;
      CompassToolkit.setData({ [KEYS.periods]: periodsData });
      refresh();
    } else if (msg.type === "CT_EVENTS_DATA") {
      eventsData = msg.data;
      CompassToolkit.setData({ [KEYS.events]: eventsData });
      refresh();
    }
  });

  // Data captured earlier in the session is still usable, because the page
  // does not always re-request it when you come back to the Schedule tab.
  CompassToolkit.getData([KEYS.periods, KEYS.events, KEYS.school]).then(
    function (stored) {
      if (stored[KEYS.periods]) periodsData = stored[KEYS.periods];
      if (stored[KEYS.events]) eventsData = stored[KEYS.events];
      if (stored[KEYS.school]) schoolInfo = stored[KEYS.school];
      refresh();
    }
  );

  /* ---------------- page inspection ---------------- */

  const isScheduleTabActive = () =>
    !!document.querySelector(
      'button[aria-controls="tabpanel-scheduleTab"].Mui-selected'
    );

  const isStaffProfile = () =>
    Array.prototype.some.call(
      document.querySelectorAll(".MuiChip-label"),
      (chip) => chip.textContent.trim() === "Staff"
    );

  function yearGroup() {
    const link = document.querySelector('a[href*="YearLevel.aspx"]');
    return link ? link.textContent.trim() : "";
  }

  function studentInfo() {
    // The heading class varies between headerLg and headerMd across platforms.
    const nameElement = document.querySelector('h1[class*="MuiTypography-header"]');
    const houseLink = document.querySelector('a[href*="House.aspx"]');
    return {
      name: nameElement ? nameElement.textContent.trim() : "",
      yearGroup: yearGroup(),
      faction: houseLink ? houseLink.textContent.trim() : "",
      isStaff: isStaffProfile()
    };
  }

  // A timetable pulled from a partial week is missing days; warn rather than
  // print something incomplete.
  function uniqueDayCount() {
    if (!eventsData || !eventsData.d) return 0;
    const days = new Set();
    eventsData.d.forEach(function (event) {
      days.add(new Date(event.start).toISOString().split("T")[0]);
    });
    return days.size;
  }

  /* ---------------- buttons ---------------- */

  const BASE_STYLE = `
    position: fixed;
    right: 20px;
    z-index: 99999;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 24px;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.2;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    /* Not "all": these buttons restack when the other one appears, and the
       move should be instant rather than animated. */
    transition: background 0.3s, transform 0.3s;
    font-family: system-ui, -apple-system, sans-serif;
  `;

  // The icon is an inline SVG using currentColor, so it stays white with the
  // label and can't be affected by whatever fonts Compass has loaded.
  function setLabel(button, iconName, label) {
    button.textContent = "";
    button.appendChild(CompassToolkitIcons.create(iconName, 16));
    button.appendChild(document.createTextNode(label));
  }

  function makeButton(iconName, label, color, hoverColor, onClick) {
    const button = document.createElement("button");
    setLabel(button, iconName, label);
    button.style.cssText = BASE_STYLE + "background: " + color + ";";
    button.dataset.baseColor = color;
    button.dataset.hoverColor = hoverColor;
    button.onmouseover = function () {
      button.style.background = button.dataset.hoverColor;
      button.style.transform = "scale(1.05)";
    };
    button.onmouseout = function () {
      button.style.background = button.dataset.baseColor;
      button.style.transform = "scale(1)";
    };
    button.onclick = onClick;
    document.body.appendChild(button);
    return button;
  }

  function setColors(button, color, hoverColor) {
    button.dataset.baseColor = color;
    button.dataset.hoverColor = hoverColor;
    button.style.background = color;
  }

  function removeButton(button) {
    if (button) button.remove();
    return null;
  }

  // Stack whichever buttons are showing, so the clearance button doesn't float
  // above a gap when the timetable printer is switched off.
  function layoutButtons() {
    let bottom = 20;
    if (timetableButton) {
      timetableButton.style.bottom = bottom + "px";
      bottom += 50;
    }
    if (clearanceButton) {
      clearanceButton.style.bottom = bottom + "px";
    }
  }

  function openPage(page, width, height) {
    const payload = {
      [KEYS.periods]: periodsData,
      [KEYS.events]: eventsData,
      [KEYS.student]: studentInfo()
    };
    // Don't overwrite a cached school name with a null we never received.
    if (schoolInfo) payload[KEYS.school] = schoolInfo;

    CompassToolkit.setData(payload).then(function () {
      const url = chrome.runtime.getURL(page);
      const win = window.open(url, "_blank", "width=" + width + ",height=" + height);
      if (!win) {
        alert("Please allow pop-ups for this site to open the print view.");
      }
    });
  }

  function refreshTimetableButton() {
    const show =
      timetableConfig.enabled && periodsData && eventsData && isScheduleTabActive();

    if (!show) {
      timetableButton = removeButton(timetableButton);
      return;
    }

    const incomplete = uniqueDayCount() < FULL_WEEK_DAYS;
    const iconName = incomplete ? "alert" : "printer";
    const label = incomplete
      ? "Day missing. Change selected week"
      : "Print Timetable";
    const color = incomplete ? "#ff9800" : "#1976d2";
    const hover = incomplete ? "#f57c00" : "#1565c0";

    if (!timetableButton) {
      timetableButton = makeButton(iconName, label, color, hover, function () {
        openPage("pages/timetable-print.html", 1000, 800);
      });
    } else {
      setLabel(timetableButton, iconName, label);
      setColors(timetableButton, color, hover);
    }
  }

  function refreshClearanceButton() {
    const wrongYear =
      clearanceConfig.year12Only !== false && yearGroup() !== "Year 12";
    const show =
      clearanceConfig.enabled &&
      periodsData &&
      eventsData &&
      isScheduleTabActive() &&
      !isStaffProfile() &&
      !wrongYear;

    if (!show) {
      clearanceButton = removeButton(clearanceButton);
      return;
    }

    if (!clearanceButton) {
      clearanceButton = makeButton(
        "clipboard",
        "Clearance Form",
        "#2e7d32",
        "#1b5e20",
        function () {
          openPage("pages/clearance.html", 900, 1000);
        }
      );
    }
  }

  function refresh() {
    if (!document.body) return;
    refreshTimetableButton();
    refreshClearanceButton();
    layoutButtons();
  }

  /* ---------------- wiring ---------------- */

  CompassToolkit.observeFeature("timetablePrinter", function (settings) {
    timetableConfig = settings;
    CompassToolkit.whenReady(refresh);
  });

  CompassToolkit.observeFeature("clearanceForm", function (settings) {
    clearanceConfig = settings;
    CompassToolkit.whenReady(refresh);
  });

  // Compass swaps tabs without navigating, so conditions are re-checked on a
  // timer rather than on load alone.
  CompassToolkit.whenReady(function () {
    setTimeout(refresh, 1000);
    setInterval(refresh, CHECK_INTERVAL_MS);
  });
})();
