/* Compass Toolkit: Term Calendar Printer (page side).
 *
 * The calendar only ever holds one term's events in memory, so they have to be
 * pulled from the page while the user is looking at them. The page-context
 * interceptor is what hands them over.
 *
 * Capture is driven from two places. The popup asks for one over a message,
 * and the panel this puts on the calendar page calls the same code directly.
 * The on-page panel exists because the popup is easy to miss: every other
 * feature acts on the page you are already looking at, so the one whose
 * controls live only behind the toolbar icon reads as broken.
 */
(function () {
  "use strict";

  if (!CompassToolkit.isTopFrame) return;

  const KEYS = CompassToolkit.DATA_KEYS;
  const CAPTURE_TIMEOUT_MS = 3000;
  const PRINT_PAGE = "pages/calendar.html";
  // Which view is showing is only knowable from the toolbar's classes, and
  // ExtJS swaps them without an event worth listening for, so the open panel
  // rechecks on a timer. Cheap: it reads two class lists.
  const VIEW_POLL_MS = 700;

  // The colour this feature is given in the popup, so the button on the page
  // and the row in the menu are recognisably the same thing.
  const GREEN = "#2e7d32";
  const GREEN_DARK = "#226325";

  let enabled = false;
  let launcher = null;
  let panel = null;
  let panelParts = null;
  let pollTimer = null;
  let escHandler = null;
  let outsideHandler = null;

  CompassToolkit.observeFeature("calendarPrinter", function (settings) {
    enabled = !!settings.enabled;
    CompassToolkit.whenReady(refreshLauncher);
  });

  const isCalendarPage = () =>
    /\/Organise\/Calendar/i.test(location.pathname);

  // Only the Term view has the whole term loaded; capturing from Week or Month
  // view would silently produce a near-empty calendar.
  function isTermView() {
    const termButton = document.getElementById("calendar-manager-tb-multiweek");
    return !!termButton && termButton.classList.contains("x-pressed");
  }

  /* ---------------- capture ---------------- */

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

  function openPrintable() {
    const win = window.open(chrome.runtime.getURL(PRINT_PAGE), "_blank");
    if (!win) {
      alert("Please allow pop-ups for this site to open the printable calendar.");
    }
  }

  /* ---------------- on-page panel ---------------- */

  function styled(tag, css) {
    const node = document.createElement(tag);
    node.style.cssText = css;
    return node;
  }

  const LAUNCHER_STYLE = `
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 99999;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 24px;
    color: #fff;
    background: ${GREEN};
    border: none;
    border-radius: 4px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.2;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    transition: background 0.3s, transform 0.3s;
  `;

  const PANEL_STYLE = `
    position: fixed;
    right: 20px;
    bottom: 78px;
    z-index: 99999;
    display: flex;
    flex-direction: column;
    width: 320px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 120px);
    overflow: hidden;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.28);
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    line-height: 1.45;
    color: #1a2330;
  `;

  const ACTION_STYLE = `
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    width: 100%;
    margin-top: 8px;
    padding: 9px 12px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.2;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  `;

  const STATUS_STYLE = `
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin-top: 10px;
    padding: 8px 10px;
    font-size: 12px;
    background: #eef1f6;
    border: 1px solid #e2e6ed;
    border-radius: 6px;
    color: #6b7688;
  `;

  function setLabel(button, iconName, label) {
    button.textContent = "";
    button.appendChild(CompassToolkitIcons.create(iconName, 15));
    button.appendChild(document.createTextNode(label));
  }

  /* Inline styles mean there is no :disabled rule to fall back on, so the
   * greyed-out look has to be set alongside the property. */
  function setDisabled(button, off) {
    button.disabled = off;
    button.style.opacity = off ? "0.5" : "1";
    button.style.cursor = off ? "default" : "pointer";
  }

  function showLauncher() {
    if (launcher) return;

    launcher = styled("button", LAUNCHER_STYLE);
    setLabel(launcher, "calendar", "Print Calendar");
    launcher.title = "Term Calendar Printer";
    launcher.onmouseover = function () {
      launcher.style.background = GREEN_DARK;
      launcher.style.transform = "scale(1.05)";
    };
    launcher.onmouseout = function () {
      launcher.style.background = GREEN;
      launcher.style.transform = "scale(1)";
    };
    launcher.onclick = function (e) {
      e.stopPropagation();
      if (panel) closePanel();
      else openPanel();
    };
    document.body.appendChild(launcher);
  }

  function hideLauncher() {
    closePanel();
    if (launcher) launcher.remove();
    launcher = null;
  }

  function refreshLauncher() {
    const wanted = enabled && isCalendarPage();
    if (wanted) showLauncher();
    else hideLauncher();
  }

  function openPanel() {
    if (panel) return;

    panel = styled("div", PANEL_STYLE);

    const header = styled(
      "div",
      `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-shrink: 0;
      padding: 9px 10px 9px 12px;
      background: ${GREEN};
      color: #fff;
    `
    );

    const title = styled(
      "div",
      "display:flex; align-items:center; gap:7px; font-size:12.5px; font-weight:600;"
    );
    title.appendChild(CompassToolkitIcons.create("calendar", 14));
    title.appendChild(document.createTextNode("Term Calendar Printer"));

    const close = styled(
      "button",
      `
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; padding: 0; flex-shrink: 0;
      color: #fff; background: rgba(255,255,255,0.16);
      border: none; border-radius: 4px; cursor: pointer;
    `
    );
    close.appendChild(CompassToolkitIcons.create("close", 13));
    close.title = "Close (Esc)";
    close.onclick = closePanel;

    header.appendChild(title);
    header.appendChild(close);

    const body = styled("div", "padding: 12px; overflow-y: auto;");

    const intro = styled(
      "div",
      "font-size:12px; color:#6b7688;"
    );
    intro.textContent =
      "Capture what the calendar has loaded, then open it as a printable page.";

    const captureBtn = styled(
      "button",
      ACTION_STYLE + "color:#fff; background:" + GREEN + ";"
    );
    setLabel(captureBtn, "download", "Capture calendar data");

    const openBtn = styled(
      "button",
      ACTION_STYLE +
        "color:#1a2330; background:#eef1f6; border:1px solid #d3d9e3;"
    );
    setLabel(openBtn, "printer", "Open printable calendar");

    const status = styled("div", STATUS_STYLE);
    const capturedAt = styled(
      "div",
      "margin-top:6px; font-size:11px; color:#98a1b0;"
    );
    // What the page needs before it can be captured, kept separate from what
    // is already stored: the two change independently.
    const hint = styled("div", STATUS_STYLE);
    hint.style.display = "none";

    body.appendChild(intro);
    body.appendChild(captureBtn);
    body.appendChild(openBtn);
    body.appendChild(status);
    body.appendChild(capturedAt);
    body.appendChild(hint);

    panel.appendChild(header);
    panel.appendChild(body);
    // Clicks inside must not reach the close-on-outside-click handler.
    panel.addEventListener("click", function (e) {
      e.stopPropagation();
    });
    document.body.appendChild(panel);

    panelParts = {
      captureBtn: captureBtn,
      openBtn: openBtn,
      status: status,
      capturedAt: capturedAt,
      hint: hint
    };

    captureBtn.onclick = onCaptureClick;
    openBtn.onclick = function () {
      if (!openBtn.disabled) openPrintable();
    };

    escHandler = function (e) {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", escHandler, true);

    outsideHandler = function (e) {
      if (launcher && launcher.contains(e.target)) return;
      closePanel();
    };
    document.addEventListener("click", outsideHandler);

    setDisabled(openBtn, true);
    setStatus("Checking…");
    refreshStored();
    refreshView();
    pollTimer = setInterval(refreshView, VIEW_POLL_MS);
  }

  function closePanel() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (escHandler) document.removeEventListener("keydown", escHandler, true);
    escHandler = null;
    if (outsideHandler) document.removeEventListener("click", outsideHandler);
    outsideHandler = null;
    if (panel) panel.remove();
    panel = null;
    panelParts = null;
  }

  function setStatus(message, kind, iconName) {
    if (!panelParts) return;
    const box = panelParts.status;
    const colour =
      kind === "success" ? GREEN : kind === "error" ? "#c62828" : "#6b7688";
    box.style.color = colour;
    box.style.borderColor = kind ? colour : "#e2e6ed";
    box.textContent = "";
    if (iconName) box.appendChild(CompassToolkitIcons.create(iconName, 13));
    box.appendChild(document.createTextNode(message));
  }

  function setHint(message) {
    if (!panelParts) return;
    const box = panelParts.hint;
    box.style.display = message ? "flex" : "none";
    if (!message) return;
    box.style.color = "#c62828";
    box.style.borderColor = "#c62828";
    box.textContent = "";
    box.appendChild(CompassToolkitIcons.create("alert", 13));
    box.appendChild(document.createTextNode(message));
  }

  /* What is in storage from the last capture, which is what the printable page
   * will open. Only read on demand, not on the view poll. */
  function refreshStored() {
    return CompassToolkit.getData([
      KEYS.calendar,
      KEYS.terms,
      KEYS.layers
    ]).then(function (data) {
      if (!panelParts) return false;

      const calendar = data[KEYS.calendar];
      const events = calendar && calendar.events ? calendar.events.length : 0;

      if (events === 0) {
        setDisabled(panelParts.openBtn, true);
        panelParts.capturedAt.textContent = "";
        setStatus("Nothing captured yet.");
        return false;
      }

      const terms = data[KEYS.terms];
      const layers = data[KEYS.layers];
      const parts = [events + " events"];
      if (terms && terms.terms) parts.push(terms.terms.length + " terms");
      if (layers && layers.layers) parts.push(layers.layers.length + " layers");

      setDisabled(panelParts.openBtn, false);
      setStatus("Captured " + parts.join(", "), "success", "check");
      panelParts.capturedAt.textContent =
        "Last captured: " + new Date(calendar.timestamp).toLocaleString();
      return true;
    });
  }

  // Tell the user what is missing before they click, not after.
  function refreshView() {
    if (!panelParts) return;
    const ready = isTermView();
    setDisabled(panelParts.captureBtn, !ready);
    setHint(ready ? null : "Switch the calendar to Term view to capture.");
  }

  function onCaptureClick() {
    if (!panelParts || panelParts.captureBtn.disabled) return;

    const captureBtn = panelParts.captureBtn;
    setDisabled(captureBtn, true);
    setLabel(captureBtn, "hourglass", "Capturing…");
    setStatus("Asking the page for its calendar data…");

    capture(function (response) {
      if (!panelParts) return; // panel closed while we waited

      if (!response || !response.success) {
        setStatus(
          (response && response.error) ||
            "Capture failed. Try refreshing the page.",
          "error",
          "alert"
        );
      } else if (response.eventCount === 0) {
        setStatus(
          "No events found. Let the calendar finish loading and try again.",
          "error",
          "alert"
        );
      } else {
        refreshStored();
      }

      setLabel(captureBtn, "download", "Capture calendar data");
      refreshView();
    });
  }

  /* ---------------- popup messages ---------------- */

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
      capture(function (response) {
        sendResponse(response);
        // A capture from the popup should show up in an open panel too.
        refreshStored();
      });
      return true; // response is async
    }
  });
})();
