/* Compass Toolkit — Chronicle Anywhere.
 *
 * Compass only lets you create a chronicle entry from the Chronicle page. This
 * puts a button on every page that opens that page in a modal over whatever
 * you are looking at, so you never navigate away.
 *
 * The entry form inside the modal is Compass's own. That is the whole point:
 * the save goes through Compass's real form, so the payload, validation,
 * permissions and audit trail are whatever Compass says they are, and nothing
 * here has to know how a chronicle entry is stored. Earlier attempts at this
 * rebuilt the form and invented an endpoint to POST to; this one deliberately
 * doesn't touch the API at all.
 *
 * Compass is same-origin, so once the frame loads we can reach into it to open
 * the entry dialog and hide the page behind it. Every one of those steps is
 * best-effort: if a selector stops matching, you still get the Chronicle page
 * in a modal, which beats being navigated away from your work.
 */
(function () {
  "use strict";

  if (!CompassToolkit.isTopFrame) return;

  const FEATURE = "chronicleAnywhere";
  // The query parameter is ignored by Compass if it isn't supported; the
  // dialog is opened by clicking as well, so this is only a shortcut.
  const ENTRY_URL = "/Organise/Chronicle/?createNew=chronicleEntry";
  const FRAME_TIMEOUT_MS = 12000;
  const OPEN_GIVE_UP_MS = 15000;
  const POLL_MS = 300;

  let config = { enabled: false };
  let button = null;
  let overlay = null;
  let escHandler = null;
  let supportHidden = false; // is the Hide Support Button feature on?
  let panelEl = null; // the white box inside the backdrop
  let headerEl = null; // its title bar
  let fitObserver = null; // watches the dialog so the box tracks its size

  const onChroniclePage = () =>
    /^\/Organise\/Chronicle/i.test(location.pathname);

  /* ---------------- launcher button ---------------- */

  const EDGE_GAP = 20; // distance from the edge of the window
  const PROBE_STEP = 24; // how far to jump when looking for a clear spot
  const SLIDE_LIMIT = 260; // how far along the edge to try before giving up
  const PROBE_LIMIT = 420; // how far from the edge to try after that

  // Compass puts the Intercom help bubble in the bottom-left corner, but it
  // boots well after the page does. Detecting it would mean placing the button
  // in the corner and shifting it once the bubble turns up, so the space is
  // reserved from the outset and the button never moves.
  const HELP_SELECTOR =
    ".intercom-lightweight-app, #intercom-container, .intercom-app," +
    " .intercom-launcher-frame";
  const HELP_RESERVE = 72; // launcher width plus breathing room

  const POSITIONS = {
    bottomLeft: { vertical: "bottom", horizontal: "left" },
    bottomRight: { vertical: "bottom", horizontal: "right" },
    topRight: { vertical: "top", horizontal: "right" }
  };

  // Position is applied separately so the button can move out of the way of
  // Compass's help bubble and of this toolkit's own profile-page buttons.
  const BUTTON_STYLE = `
    position: fixed;
    z-index: 2147483646;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 24px;
    color: #fff;
    background: #6a1b9a;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.2;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    font-family: system-ui, -apple-system, sans-serif;
    /* Hidden until it has been measured and placed, so it is painted once, in
       its final spot, rather than appearing in the corner and moving. */
    visibility: hidden;
  `;

  function showButton() {
    if (button || onChroniclePage()) return;

    button = document.createElement("button");
    button.style.cssText = BUTTON_STYLE;
    button.appendChild(CompassToolkitIcons.create("note", 16));
    button.appendChild(document.createTextNode("New Chronicle"));
    button.onmouseover = function () {
      button.style.background = "#4a148c";
    };
    button.onmouseout = function () {
      button.style.background = "#6a1b9a";
    };
    button.onclick = openModal;
    document.body.appendChild(button);

    // Measured and positioned before it is ever shown.
    applyPosition();
    button.style.visibility = "visible";
    // Chat and help widgets load late, so check again as the page settles.
    [1500, 4000, 8000].forEach(function (delay) {
      setTimeout(applyPosition, delay);
    });
    window.addEventListener("resize", onResize);
  }

  function hideButton() {
    window.removeEventListener("resize", onResize);
    if (button) button.remove();
    button = null;
  }

  let resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyPosition, 200);
  }

  /* Is something already sitting at this point? Only fixed and sticky things
   * count — the page scrolls underneath the button, so ordinary content isn't
   * a clash. */
  function isOccupied(x, y) {
    const px = Math.min(Math.max(x, 0), window.innerWidth - 1);
    const py = Math.min(Math.max(y, 0), window.innerHeight - 1);

    return document.elementsFromPoint(px, py).some(function (el) {
      if (el === document.body || el === document.documentElement) return false;
      if (el === button || button.contains(el) || el.contains(button)) {
        return false;
      }

      /* Don't dodge the support bubble when it is being hidden. Both features
       * react to the same settings change and this one runs first, so the
       * bubble is often still on screen at this point — going by the setting
       * rather than by what is currently painted avoids that race. */
      if (supportHidden && el.closest && el.closest(HELP_SELECTOR)) {
        return false;
      }

      const style = getComputedStyle(el);
      if (style.position !== "fixed" && style.position !== "sticky") return false;
      if (style.visibility === "hidden" || style.opacity === "0") return false;

      // A full-window fixed layer is a page overlay, not a widget to dodge.
      const rect = el.getBoundingClientRect();
      if (
        rect.width > window.innerWidth * 0.8 &&
        rect.height > window.innerHeight * 0.8
      ) {
        return false;
      }
      return rect.width > 0 && rect.height > 0;
    });
  }

  /* Sample a grid across the whole button, not just its centre — the help
   * bubble is far narrower than the button and sits under one end of it, so a
   * single centre probe walks straight past it. */
  function areaIsClear(left, top, width, height) {
    const margin = 8; // don't sit flush against whatever is there
    const x1 = left - margin;
    const y1 = top - margin;
    const x2 = left + width + margin;
    const y2 = top + height + margin;
    const cols = 5;
    const rows = 3;

    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = x1 + ((x2 - x1) * i) / (cols - 1);
        const y = y1 + ((y2 - y1) * j) / (rows - 1);
        if (isOccupied(x, y)) return false;
      }
    }
    return true;
  }

  /* How far along the edge to start, so the button clears the help bubble
   * immediately instead of being nudged aside once it loads. Measured if the
   * bubble is already there, otherwise the space is reserved on spec. */
  function reservedSlide(spec) {
    // Nothing to leave room for once the support bubble is being hidden, so
    // the button sits flush in the corner.
    if (supportHidden) return 0;

    // Only the corner the bubble actually occupies.
    if (spec.vertical !== "bottom" || spec.horizontal !== "left") return 0;

    const widget = document.querySelector(HELP_SELECTOR);
    if (widget) {
      const rect = widget.getBoundingClientRect();
      // Its container is sometimes a full-window overlay; only trust a rect
      // that looks like a launcher sitting in the corner.
      if (
        rect.width > 0 &&
        rect.width < window.innerWidth * 0.5 &&
        rect.right > EDGE_GAP
      ) {
        return Math.ceil(rect.right + 12 - EDGE_GAP);
      }
    }
    return HELP_RESERVE;
  }

  /* Find a free spot for the button, preferring to slide sideways along the
   * edge — sitting next to the help bubble reads better than hovering above
   * it. Moving away from the edge is only a fallback for when the whole row
   * is taken. */
  function findClearSpot(spec) {
    const width = button.offsetWidth || 170;
    const height = button.offsetHeight || 44;

    const topFor = (offset) =>
      spec.vertical === "bottom"
        ? window.innerHeight - offset - height
        : offset;
    const leftFor = (slide) =>
      spec.horizontal === "left"
        ? EDGE_GAP + slide
        : window.innerWidth - EDGE_GAP - width - slide;

    // 1. Along the edge, starting past the space kept for the help bubble.
    const start = reservedSlide(spec);
    for (
      let slide = start;
      slide <= start + SLIDE_LIMIT;
      slide += PROBE_STEP
    ) {
      if (areaIsClear(leftFor(slide), topFor(EDGE_GAP), width, height)) {
        return { slide: slide, offset: EDGE_GAP };
      }
    }

    // 2. The row is full — move away from the edge instead.
    for (
      let offset = EDGE_GAP + PROBE_STEP;
      offset <= PROBE_LIMIT;
      offset += PROBE_STEP
    ) {
      if (areaIsClear(leftFor(0), topFor(offset), width, height)) {
        return { slide: 0, offset: offset };
      }
    }

    return { slide: 0, offset: EDGE_GAP }; // nowhere is clear
  }

  function applyPosition() {
    // Skip while the modal is up: the button is hidden, so it can't be
    // measured and there is nothing to place.
    if (!button || overlay) return;

    const spec = POSITIONS[config.position] || POSITIONS.bottomLeft;
    button.style.top = "auto";
    button.style.bottom = "auto";
    button.style.left = "auto";
    button.style.right = "auto";

    // Park it in the corner so it can be measured, then shift it clear.
    button.style[spec.horizontal] = EDGE_GAP + "px";
    button.style[spec.vertical] = EDGE_GAP + "px";

    const spot = findClearSpot(spec);
    button.style[spec.horizontal] = EDGE_GAP + spot.slide + "px";
    button.style[spec.vertical] = spot.offset + "px";
  }

  /* ---------------- modal ---------------- */

  function styled(tag, css) {
    const node = document.createElement(tag);
    node.style.cssText = css;
    return node;
  }

  function openModal() {
    if (overlay) return;

    // The launcher has no job while the form is open, and leaving it visible
    // would float it over the modal.
    if (button) button.style.display = "none";

    overlay = styled(
      "div",
      `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.55);
      font-family: system-ui, -apple-system, sans-serif;
    `
    );

    const panel = styled(
      "div",
      `
      display: flex;
      flex-direction: column;
      width: 92vw;
      height: 92vh;
      /* Shrinks onto the dialog once it appears; these only cap how big it
         can get if the dialog turns out to be larger than the screen. */
      max-width: 96vw;
      max-height: 94vh;
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 12px 48px rgba(0,0,0,0.45);
      overflow: hidden;
    `
    );

    const header = styled(
      "div",
      `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 4px 10px;
      background: #6a1b9a;
      color: #fff;
      flex-shrink: 0;
    `
    );

    const title = styled(
      "div",
      "display:flex; align-items:center; gap:7px; font-size:12.5px; font-weight:600;"
    );
    title.appendChild(CompassToolkitIcons.create("note", 14));
    title.appendChild(document.createTextNode("New Chronicle Entry"));

    const actions = styled("div", "display:flex; align-items:center; gap:6px;");

    const close = styled(
      "button",
      `
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; padding: 0;
      color: #fff; background: rgba(255,255,255,0.16);
      border: none; border-radius: 4px; cursor: pointer;
    `
    );
    close.appendChild(CompassToolkitIcons.create("close", 13));
    close.title = "Close (Esc)";
    close.onclick = closeModal;

    actions.appendChild(close);
    header.appendChild(title);
    header.appendChild(actions);

    const status = styled(
      "div",
      `
      padding: 10px 14px;
      font-size: 13px;
      color: #555;
      background: #f5f5f5;
      border-bottom: 1px solid #e0e0e0;
      flex-shrink: 0;
    `
    );
    status.textContent = "Loading the Chronicle page…";

    const frame = document.createElement("iframe");
    frame.src = ENTRY_URL;
    frame.style.cssText =
      "flex: 1; width: 100%; border: 0; display: block; background: #fff;";

    panel.appendChild(header);
    panel.appendChild(status);
    panel.appendChild(frame);
    overlay.appendChild(panel);
    panelEl = panel;
    headerEl = header;

    // Clicking the backdrop closes; clicks inside the panel must not.
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });
    panel.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    escHandler = function (e) {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", escHandler, true);

    document.body.appendChild(overlay);

    let settled = false;
    frame.addEventListener("load", function () {
      // Re-applied on every load: saving an entry can navigate the frame,
      // which throws the injected stylesheet away.
      const doc = frameDocument(frame);
      if (doc) hideHelpWidget(doc);

      if (settled) return;
      settled = true;
      onFrameLoaded(frame, status);
    });

    // If Compass refuses to be framed, the load event may never arrive.
    setTimeout(function () {
      if (settled) return;
      settled = true;
      showBlocked(status);
    }, FRAME_TIMEOUT_MS);
  }

  function closeModal() {
    if (escHandler) {
      document.removeEventListener("keydown", escHandler, true);
      escHandler = null;
    }
    if (fitObserver) {
      fitObserver.disconnect();
      fitObserver = null;
    }
    if (overlay) overlay.remove();
    overlay = null;
    panelEl = null;
    headerEl = null;

    if (button && config.enabled) {
      button.style.display = "inline-flex";
      applyPosition(); // the page may have changed while the modal was up
    }
  }

  function showBlocked(status) {
    status.style.background = "#fdecea";
    status.style.color = "#b71c1c";
    status.textContent =
      "Compass wouldn't load inside the page. Open the Chronicle page directly to add an entry.";
  }

  /* ---------------- driving the framed page ---------------- */

  function frameDocument(frame) {
    try {
      const doc = frame.contentDocument;
      return doc && doc.body ? doc : null;
    } catch (e) {
      return null; // cross-origin — shouldn't happen on Compass
    }
  }

  /* Compass loads Intercom inside the framed page too, so the help bubble
   * reappears on top of the entry form. A stylesheet rather than removing the
   * node: Intercom boots after the load event and rebuilds itself, so a rule
   * catches it whenever it turns up. The class differs before and after it
   * finishes booting, hence all three. */
  function hideHelpWidget(doc) {
    if (doc.getElementById("ct-hide-widgets")) return;

    const style = doc.createElement("style");
    style.id = "ct-hide-widgets";
    style.textContent =
      ".intercom-lightweight-app, #intercom-container, .intercom-app " +
      "{ display: none !important; }";
    (doc.head || doc.documentElement).appendChild(style);
  }

  function onFrameLoaded(frame, status) {
    const doc = frameDocument(frame);
    if (!doc) {
      showBlocked(status);
      return;
    }
    status.textContent = "Opening the entry form…";
    openEntryDialog(frame, status);
  }

  const CREATE_TEXT = /\b(add|new|create)\b.{0,12}\b(chronicle|entry)\b/i;

  /* The create control differs between Compass builds, so try the specific
   * thing first and fall back to matching what the button says. */
  function findCreateControl(doc) {
    const direct = doc.querySelector('a[href*="createNew=chronicleEntry"]');
    if (direct) return direct;

    const candidates = doc.querySelectorAll(
      'a, button, .x-btn, [role="button"]'
    );
    for (const el of candidates) {
      const text = (el.textContent || "").trim();
      if (!text || text.length > 40) continue;
      if (!CREATE_TEXT.test(text)) continue;
      if (el.offsetParent === null) continue; // not visible
      return el;
    }
    return null;
  }

  // ExtJS renders the entry form as a floating window.
  function findDialog(doc) {
    const windows = doc.querySelectorAll(".x-window");
    for (const win of windows) {
      if (win.offsetParent !== null) return win;
    }
    return null;
  }

  // ExtJS listens for the whole pointer sequence, not just a click.
  function clickLikeAUser(el) {
    const rect = el.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      view: el.ownerDocument.defaultView,
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
        el.dispatchEvent(new C(type, opts));
      } catch (_) {}
    }
  }

  function openEntryDialog(frame, status) {
    const deadline = Date.now() + OPEN_GIVE_UP_MS;
    let clicked = false;

    const poll = setInterval(function () {
      if (!overlay) return clearInterval(poll); // user closed it

      const doc = frameDocument(frame);
      if (!doc) return;

      const dialog = findDialog(doc);
      if (dialog) {
        clearInterval(poll);
        status.remove();
        if (config.hideNavigation) {
          hidePageBehind(doc, dialog);
          fitToDialog(doc, dialog);
        }
        if (config.closeOnSave) watchForDialogClose(frame, dialog);
        return;
      }

      if (Date.now() > deadline) {
        clearInterval(poll);
        // The page is still usable — the user can click the button themselves.
        status.textContent =
          "Couldn't open the form automatically — use the Chronicle page below.";
        console.log(
          "[Compass Toolkit] Chronicle: no entry dialog found. Create controls seen:",
          Array.from(doc.querySelectorAll('a, button, .x-btn'))
            .map((el) => (el.textContent || "").trim())
            .filter((t) => t && t.length < 40)
            .slice(0, 40)
        );
        return;
      }

      if (!clicked) {
        const control = findCreateControl(doc);
        if (control) {
          clicked = true;
          clickLikeAUser(control);
        }
      }
    }, POLL_MS);
  }

  /* Hide everything sitting behind the dialog so the modal shows the form
   * rather than a page with a form on top of it. Reversible, and skipped
   * entirely if the sub-setting is off. */
  function hidePageBehind(doc, dialog) {
    let top = dialog;
    while (top.parentElement && top.parentElement !== doc.body) {
      top = top.parentElement;
    }

    Array.from(doc.body.children).forEach(function (child) {
      if (child === top) return;
      if (child.contains(dialog)) return;
      // Leave ExtJS's own overlays alone — masks, shadows, tooltips, menus.
      if (/x-mask|x-shadow|x-tip|x-menu|x-layer/.test(child.className || "")) {
        return;
      }
      /* Chronicle Templates parks its in-field buttons in a fixed layer of its
       * own, outside the dialog. Hiding it would take the buttons off the very
       * form this modal exists to show. */
      if (child.hasAttribute && child.hasAttribute("data-ct-templates")) return;
      child.style.display = "none";
    });

    doc.body.style.background = "#fff";
  }

  /* Left alone, the dialog is a small window floating in the middle of a
   * full-size page: whitespace all around it, and a scrollable page behind
   * that carries the dialog off screen. Pin it to the corner, stop the page
   * scrolling, and shrink the modal onto it. */
  function fitToDialog(doc, dialog) {
    dialog.setAttribute("data-ct-dialog", "");

    if (!doc.getElementById("ct-fit")) {
      const style = doc.createElement("style");
      style.id = "ct-fit";
      style.textContent = [
        "html, body { margin:0 !important; padding:0 !important;",
        "  overflow:hidden !important; background:#fff !important; }",
        // ExtJS keeps recentring the window, so this has to win.
        "[data-ct-dialog] { top:0 !important; left:0 !important;",
        "  margin:0 !important; box-shadow:none !important; }",
        // The greyed-out backdrop belongs to the page we just hid.
        ".x-mask, .x-mask-msg { display:none !important; }"
      ].join("\n");
      (doc.head || doc.documentElement).appendChild(style);
    }

    const apply = function () {
      if (!panelEl || !headerEl) return;
      const rect = dialog.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      // The panel holds the title bar as well as the frame.
      panelEl.style.width = Math.ceil(rect.width) + "px";
      panelEl.style.height =
        Math.ceil(rect.height) + headerEl.offsetHeight + "px";
    };

    apply();

    // The dialog grows as fields and pickers open, so track it.
    if (typeof ResizeObserver === "function") {
      fitObserver = new ResizeObserver(apply);
      fitObserver.observe(dialog);
    }
  }

  /* Once the dialog goes away the entry has been saved or cancelled, so the
   * modal has done its job. */
  function watchForDialogClose(frame, dialog) {
    const poll = setInterval(function () {
      if (!overlay) return clearInterval(poll);

      const doc = frameDocument(frame);
      if (!doc) return clearInterval(poll);

      const stillOpen = doc.contains(dialog) && dialog.offsetParent !== null;
      if (!stillOpen && !findDialog(doc)) {
        clearInterval(poll);
        closeModal();
      }
    }, 500);
  }

  /* ---------------- wiring ---------------- */

  /* Watched separately, because observeFeature only reports changes to its own
   * feature — toggling Hide Support Button would otherwise leave this button
   * indented around a bubble that is no longer there. */
  CompassToolkit.observeFeature("hideSupportButton", function (settings) {
    supportHidden = !!settings.enabled;
    CompassToolkit.whenReady(applyPosition);
  });

  CompassToolkit.observeFeature(FEATURE, function (settings) {
    config = settings;
    CompassToolkit.whenReady(function () {
      if (config.enabled) {
        showButton();
        applyPosition(); // picks up a position change on an existing button
      } else {
        hideButton();
        closeModal();
      }
    });
  });
})();
