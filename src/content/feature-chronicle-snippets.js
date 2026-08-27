/* Compass Toolkit: Chronicle Snippets.
 *
 * The same chronicle entries get written over and over: an injury, a knock to
 * the head, a phone confiscated. This offers pre-written wording from a small
 * button sitting inside the entry form's own fields. Picking one drops its text
 * into that field; Compass's form does the saving, exactly as if it had been
 * typed.
 *
 * A snippet can name a field. When it does, its button only turns up in fields
 * whose label contains that name, so an injury snippet can be tied to the injury
 * field. When it doesn't, the snippet is offered in every field of the entry form,
 * which is how the built-in ones ship: the fields on a chronicle entry are
 * configured per school, so nothing here can guess their names.
 *
 * A button is put inside the field's own wrapper, positioned absolutely so it
 * is out of the flow: ExtJS measures and lays out its own markup, and an
 * out-of-flow child changes none of those measurements. The wrapper scrolls,
 * and the button goes with it, drawn by the browser rather than chased from
 * JavaScript.
 *
 * The fallback is a fixed layer that floats over the field instead, touching
 * nothing Compass owns. It costs a reposition on every scroll, which lands a
 * frame behind the content and looks it, so it is the setting to reach for
 * only if putting the button in the form upsets a school's layout.
 *
 * This runs in every frame, not just the top one, so the buttons appear in the
 * entry form whether it was opened from the Chronicle page, from a student
 * profile, or inside the Chronicle Anywhere pop-up.
 */
(function () {
  "use strict";

  const FEATURE = "chronicleSnippets";
  const SWEEP_MS = 300; // reposition and rescan while a form is open
  const CHRONICLE_HINT = /chronicle/i;
  /* Used when a window has no title to go on. Stricter than the word alone,
   * because plenty of Compass mentions it in passing: the roll has a chronicle
   * shortcut on every student and a chronicle tag picker beside it, and none of
   * that makes the roll an entry form. */
  const CHRONICLE_PHRASE = /chronicle\s+entry|new\s+chronicle|add\s+chronicle/i;
  const FIELD_SELECTOR =
    'textarea, input, iframe, [contenteditable="true"],' +
    ' [contenteditable="plaintext-only"]';

  let config = { enabled: false, insertMode: "cursor", placement: "inline" };
  let snippets = [];
  let root = null; // the fixed layer holding every button
  let menu = null; // the open dropdown, if any
  let menuOwner = null; // the entry it belongs to
  let sweepTimer = null;
  const attached = new Map(); // field element -> entry

  /* ---------------- finding the entry form ---------------- */

  /* The entry form is an ExtJS window wherever it is opened from, so the
   * window's own title is the most reliable thing to go on. Its contents are
   * the fallback for builds that render the title differently. */
  function isChronicleWindow(win) {
    if (win.dataset.ctChronicle) return true;

    const header = win.querySelector(
      ".x-window-header, .x-window-header-text, .x-header-text, .x-title-text"
    );
    const title = header ? (header.textContent || "").trim() : "";

    /* A titled window is judged on its title alone. Falling back to the whole
     * window's text whenever the title missed would match anything that merely
     * mentions the word, such as a profile page's Chronicle tab, and hang
     * buttons off unrelated forms. */
    const hit = title
      ? CHRONICLE_HINT.test(title)
      : CHRONICLE_PHRASE.test(win.textContent || "");

    /* Only a yes is remembered: a window's contents arrive after it opens, so
     * an early no would stick for the wrong reason. */
    if (hit) win.dataset.ctChronicle = "1";
    return hit;
  }

  /* Only the entry form's own fields get a button. Wherever it is opened from,
   * that form is an ExtJS window, the same thing Chronicle Anywhere looks for,
   * so nothing outside one is ever scanned. Searching the Chronicle page at
   * large would put a Notes button on its search and filter boxes. */
  function chronicleContainers() {
    return Array.prototype.filter.call(
      document.querySelectorAll(".x-window"),
      function (win) {
        return win.offsetParent !== null && isChronicleWindow(win);
      }
    );
  }

  /* ---------------- fields ---------------- */

  /* Only free-text fields qualify. Combo boxes, date pickers and spinners are
   * inputs too, but a snippet has no business in one and the button would land on
   * top of the trigger. */
  const TRIGGER_WRAP =
    ".x-form-trigger-wrap, .x-form-field-trigger-wrap, .x-trigger-wrap," +
    " .x-form-date-wrap, .x-form-num-wrap";

  /* Every field on an ExtJS form sits in one of these. Compass drops plain
   * fields of its own into windows that have nothing to do with a form: the
   * comment box against each student on the roll is a bare textarea in a table
   * cell, and a Snippets button has no business on it. */
  const FORM_ITEM =
    ".x-form-item, .x-field, .x-form-item-body, .x-html-editor-wrap";

  function isEligible(el) {
    if (root && root.contains(el)) return false;
    if (el.disabled || el.readOnly) return false;
    if (el.closest(TRIGGER_WRAP)) return false;
    if (!el.closest(FORM_ITEM)) return false;

    if (el.tagName === "INPUT") {
      if ((el.type || "text").toLowerCase() !== "text") return false;
      if (el.getAttribute("role") === "combobox") return false;
      if (el.hasAttribute("aria-autocomplete")) return false;
      if (/date|time|num|spinner|combo|picker/i.test(el.className || "")) {
        return false;
      }
    }

    const rect = el.getBoundingClientRect();
    return rect.width >= 90 && rect.height >= 16;
  }

  /* What the button is pinned to and how text gets in are not always the same
   * element: a rich text editor is an iframe on the page whose own document
   * holds the text. */
  function describeField(el) {
    if (el.tagName === "IFRAME") {
      let doc = null;
      try {
        doc = el.contentDocument;
      } catch (e) {
        return null; // cross-origin, so not one of Compass's editors
      }
      if (!doc || !doc.body) return null;
      const editable = doc.designMode === "on" || doc.body.isContentEditable;
      if (!editable) return null;
      return { anchor: el, kind: "rich", doc: doc, body: doc.body };
    }

    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      return { anchor: el, kind: "value", input: el };
    }

    return { anchor: el, kind: "rich", doc: el.ownerDocument, body: el };
  }

  function normalise(text) {
    return String(text == null ? "" : text)
      .replace(/\s+/g, " ")
      .replace(/[:*\s]+$/, "")
      .trim()
      .toLowerCase();
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function fieldLabel(el) {
    // 1. ExtJS renders the label inside the form item, beside the field.
    const item = el.closest(".x-form-item, .x-field, .x-form-item-body");
    if (item) {
      const label = item.querySelector(
        ".x-form-item-label-inner, .x-form-item-label, label"
      );
      const text = label && normalise(label.textContent);
      if (text) return text;
    }

    // 2. A plain label pointing at it.
    if (el.id) {
      const forLabel = el.ownerDocument.querySelector(
        'label[for="' + cssEscape(el.id) + '"]'
      );
      const text = forLabel && normalise(forLabel.textContent);
      if (text) return text;
    }

    // 3. Whatever the field says about itself.
    return normalise(
      el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("name") ||
        ""
    );
  }

  /* A snippet with no field set is offered everywhere. Otherwise its field has to
   * appear somewhere in the label, so "details" finds both "Details" and
   * "Entry details" without anyone having to type the label exactly as Compass
   * renders it. */
  function matches(snippet, label) {
    const want = normalise(snippet.field);
    if (!want) return true;
    return !!label && label.indexOf(want) !== -1;
  }

  /* ---------------- the button layer ---------------- */

  /* Explicit about everything that matters: inside the form the button is in
   * reach of Compass's own stylesheets, and a rule meant for ExtJS buttons
   * should not get to reshape it. */
  const BUTTON_STYLE = `
    position: absolute;
    z-index: 5;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    width: auto;
    height: auto;
    min-width: 0;
    margin: 0;
    padding: 2px 5px;
    white-space: nowrap;
    text-transform: none;
    text-decoration: none;
    float: none;
    color: #fff;
    background: #6a1b9a;
    border: none;
    border-radius: 4px;
    font: 500 11px/1.2 system-ui, -apple-system, sans-serif;
    cursor: pointer;
    pointer-events: auto;
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    opacity: 0.85;
  `;

  const MENU_STYLE = `
    position: absolute;
    min-width: 210px;
    max-width: 320px;
    padding: 4px;
    background: #fff;
    border: 1px solid #d3d9e3;
    border-radius: 6px;
    box-shadow: 0 6px 24px rgba(0,0,0,0.28);
    overflow-y: auto;
    pointer-events: auto;
    font-family: system-ui, -apple-system, sans-serif;
    color: #1a2330;
  `;

  function ensureRoot() {
    if (root && root.isConnected) return root;
    root = document.createElement("div");
    // Chronicle Anywhere hides everything behind the entry form; the marker is
    // how it knows to leave this layer alone.
    root.setAttribute("data-ct-snippets", "");
    root.style.cssText =
      "position:fixed; inset:0; z-index:2147483000; pointer-events:none;";
    document.body.appendChild(root);
    return root;
  }

  function attach(field) {
    const button = document.createElement("button");
    button.type = "button";
    // Named so it is recognisable in the form's markup, where it now sits
    // among Compass's own elements.
    button.setAttribute("data-ct-snippet-button", "");
    button.style.cssText = BUTTON_STYLE;
    button.title = "Insert a saved snippet";
    button.appendChild(CompassToolkitIcons.create("fileText", 11));
    button.appendChild(document.createTextNode("Snippets"));
    button.appendChild(CompassToolkitIcons.create("chevronDown", 10));

    const entry = { field: field, anchor: field.anchor, button: button, snippets: [] };

    button.onmouseover = function () {
      button.style.opacity = "1";
      button.style.background = "#4a148c";
    };
    button.onmouseout = function () {
      button.style.opacity = "0.85";
      button.style.background = "#6a1b9a";
    };
    // Keeping the press off the field is what preserves the caret sitting in
    // it, which "At the cursor" then inserts at.
    button.addEventListener("mousedown", function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
    button.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (menuOwner === entry) closeMenu();
      else openMenu(entry);
    });

    mount(entry);
    return entry;
  }

  const inlinePlacement = () => (config.placement || "inline") !== "float";

  /* Inline, the button belongs to the field's own wrapper so that scrolling
   * moves it without anything being recalculated. Floating, it goes in the
   * shared layer. A wrapper-less field (nothing but the body above it) falls
   * back to floating rather than being left without a button. */
  function mount(entry) {
    const host = inlinePlacement() ? hostFor(entry.anchor) : null;
    if (host) host.appendChild(entry.button);
    else ensureRoot().appendChild(entry.button);
    entry.host = host;
  }

  function hostFor(anchor) {
    const parent = anchor.parentElement;
    if (!parent || parent === document.body) return null;
    return parent;
  }

  /* ExtJS re-renders a form item and takes the button with it, and switching
   * placement moves every button at once. Both show up as the button no longer
   * being where it belongs. */
  function remount(entry) {
    const wanted = inlinePlacement() ? hostFor(entry.anchor) : null;
    if (entry.host === wanted && entry.button.isConnected) return;
    if (entry.host !== wanted) release(entry.host);
    mount(entry);
  }

  /* The wrapper only ever lent the button a positioning context; give it back
   * so nothing is left behind on a form Compass still owns. */
  function release(host) {
    if (!host || host.dataset.ctAnchored !== "1") return;
    delete host.dataset.ctAnchored;
    host.style.position = "";
  }

  function detach(el) {
    const entry = attached.get(el);
    if (!entry) return;
    if (menuOwner === entry) closeMenu();
    entry.button.remove();
    release(entry.host);
    attached.delete(el);
  }

  function detachAll() {
    // detach() releases each wrapper as it goes.
    Array.from(attached.keys()).forEach(detach);
    closeMenu();
    if (root) {
      root.remove();
      root = null;
    }
  }

  const INSET = 4;
  const CLIP_DEPTH = 30; // a form is never nested deeper than this

  function box(rect) {
    return {
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom
    };
  }

  function intersect(target, other) {
    target.top = Math.max(target.top, other.top);
    target.left = Math.max(target.left, other.left);
    target.right = Math.min(target.right, other.right);
    target.bottom = Math.min(target.bottom, other.bottom);
  }

  function clamp(value, low, high) {
    return Math.min(Math.max(value, low), high);
  }

  function clips(node) {
    const style = getComputedStyle(node);
    return (
      style.overflow !== "visible" ||
      style.overflowX !== "visible" ||
      style.overflowY !== "visible"
    );
  }

  /* How much of the field can actually be seen. The button belongs inside the
   * entry form, so it is clipped to the window the field lives in and to every
   * scrolling box between the two. An entry form taller than its dialog would
   * otherwise scroll a field out of view and leave its button floating over the
   * page above the form. */
  function visibleRect(entry) {
    const visible = box(entry.anchor.getBoundingClientRect());

    let node = entry.anchor.parentElement;
    let depth = 0;
    while (node && depth++ < CLIP_DEPTH) {
      /* The window is the form's own edge and always clips. Anything else is
       * only worth a computed style if something is actually overflowing it,
       * which keeps this off the hot path for ordinary wrappers. */
      const overflows =
        node.scrollHeight > node.clientHeight ||
        node.scrollWidth > node.clientWidth;
      if (node === entry.container || (overflows && clips(node))) {
        intersect(visible, node.getBoundingClientRect());
      }
      if (node === entry.container) break;
      node = node.parentElement;
    }

    intersect(visible, {
      top: 0,
      left: 0,
      right: window.innerWidth,
      bottom: window.innerHeight
    });
    return visible;
  }

  /* Where the layer's own origin landed. Normally it is the top left of the
   * viewport, but a transformed or filtered ancestor takes a fixed element out
   * of the viewport's coordinate space and into its own. Reading it back and
   * subtracting it means the buttons sit on their fields either way. */
  function layerOrigin() {
    const rect = root.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  }

  function place(entry, origin) {
    if (entry.host) placeInline(entry);
    else placeFloating(entry, origin);
  }

  /* Where the button sits within the field, in the field's own box. Both
   * placements want the same spot; they differ only in what they measure it
   * against. */
  function offsetInField(rect, width, height, bar) {
    return {
      left: Math.max(0, rect.width - width - INSET - bar),
      // Single-line fields have no room above the text, so the button centres
      // on the right-hand end instead of tucking into the corner.
      top:
        rect.height < height + INSET * 2 + 6
          ? (rect.height - height) / 2
          : INSET
    };
  }

  function scrollbarWidth(anchor) {
    return Math.max(0, (anchor.offsetWidth || 0) - (anchor.clientWidth || 0));
  }

  /* Positioned against the wrapper's padding box, which is what an absolutely
   * positioned child is laid out from, hence the border widths and, if the
   * wrapper happens to scroll, its scroll offsets. */
  function placeInline(entry) {
    const button = entry.button;
    const host = entry.host;
    const rect = entry.anchor.getBoundingClientRect();

    if (!rect.width || !rect.height) {
      button.style.display = "none";
      return;
    }
    button.style.display = "inline-flex";

    // The one thing the wrapper has to provide. Re-checked every pass so a
    // re-render, or another field letting go of the same wrapper, heals.
    if (getComputedStyle(host).position === "static") {
      host.style.position = "relative";
      host.dataset.ctAnchored = "1";
    }

    const hostRect = host.getBoundingClientRect();
    const spot = offsetInField(
      rect,
      button.offsetWidth || 58,
      button.offsetHeight || 18,
      scrollbarWidth(entry.anchor)
    );

    const left =
      rect.left - hostRect.left - host.clientLeft + host.scrollLeft + spot.left;
    const top =
      rect.top - hostRect.top - host.clientTop + host.scrollTop + spot.top;

    button.style.left = Math.round(left) + "px";
    button.style.top = Math.round(top) + "px";
  }

  function placeFloating(entry, origin) {
    const button = entry.button;
    const rect = entry.anchor.getBoundingClientRect();
    const width = button.offsetWidth || 58;
    const height = button.offsetHeight || 18;

    // Gone, collapsed, or scrolled out of the form, so nothing to sit on.
    const visible = visibleRect(entry);
    if (
      !rect.width ||
      !rect.height ||
      visible.right - visible.left < width + 6 ||
      visible.bottom - visible.top < height + 4
    ) {
      button.style.display = "none";
      return;
    }
    button.style.display = "inline-flex";

    const spot = offsetInField(
      rect,
      width,
      height,
      scrollbarWidth(entry.anchor)
    );
    let left = rect.left + spot.left;
    let top = rect.top + spot.top;

    // Half-scrolled fields keep their button on the part still showing rather
    // than letting it ride out past the edge of the form.
    left = clamp(left, visible.left + 2, visible.right - width - 2);
    top = clamp(top, visible.top + 2, visible.bottom - height - 2);

    const from = origin || layerOrigin();
    button.style.left = Math.round(left - from.left) + "px";
    button.style.top = Math.round(top - from.top) + "px";
  }

  /* Scrolling only moves what the browser isn't already moving: an inline
   * button travels with its wrapper and must be left alone, or it would be
   * repositioned a frame late, the wiggle this placement exists to avoid. */
  function placeAll() {
    if (!root && !attached.size) return;
    const origin = root ? layerOrigin() : null;
    attached.forEach(function (entry) {
      if (!entry.host) placeFloating(entry, origin);
    });
    if (menuOwner) placeMenu(menuOwner, origin);
  }

  // Coalesced into a frame so a burst of scroll events costs one pass.
  let framePending = null;
  function onViewportChange() {
    if (framePending) return;
    framePending = requestAnimationFrame(function () {
      framePending = null;
      placeAll();
    });
  }

  /* ---------------- the dropdown ---------------- */

  function preview(text) {
    const flat = String(text).replace(/\s+/g, " ").trim();
    return flat.length > 64 ? flat.slice(0, 63) + "…" : flat;
  }

  function openMenu(entry) {
    closeMenu();

    menu = document.createElement("div");
    menu.style.cssText = MENU_STYLE;
    menu.addEventListener("mousedown", function (e) {
      // Same reason as the button: don't take the caret out of the field.
      e.preventDefault();
      e.stopPropagation();
    });

    entry.snippets.forEach(function (snippet) {
      const item = document.createElement("button");
      item.type = "button";
      item.style.cssText = `
        display: block;
        width: 100%;
        padding: 6px 8px;
        border: 0;
        border-radius: 4px;
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      `;

      const title = document.createElement("div");
      title.textContent = snippet.title;
      title.style.cssText = "font-size:12.5px; font-weight:600;";

      const sub = document.createElement("div");
      sub.textContent = preview(snippet.text);
      sub.style.cssText =
        "margin-top:1px; font-size:11px; color:#6b7688;" +
        " overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";

      item.appendChild(title);
      item.appendChild(sub);
      item.onmouseover = function () {
        item.style.background = "#e8f1fc";
      };
      item.onmouseout = function () {
        item.style.background = "none";
      };
      item.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        insert(entry, snippet.text);
      });

      menu.appendChild(item);
    });

    ensureRoot().appendChild(menu);
    menuOwner = entry;
    placeMenu(entry);

    document.addEventListener("mousedown", onDocumentDown, true);
    document.addEventListener("keydown", onEscape, true);
  }

  /* Below the button, right edges aligned, flipped above when there isn't room
   * because the entry form can be a short pop-up with little around it. */
  function placeMenu(entry, origin) {
    if (!menu) return;
    const rect = entry.button.getBoundingClientRect();

    menu.style.maxHeight = Math.max(120, window.innerHeight - 16) + "px";
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;

    let left = Math.min(rect.right - width, window.innerWidth - width - 4);
    left = Math.max(4, left);

    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 4) {
      top = rect.top - height - 4;
      if (top < 4) top = Math.max(4, window.innerHeight - height - 4);
    }

    const from = origin || layerOrigin();
    menu.style.left = Math.round(left - from.left) + "px";
    menu.style.top = Math.round(top - from.top) + "px";
  }

  function closeMenu() {
    document.removeEventListener("mousedown", onDocumentDown, true);
    document.removeEventListener("keydown", onEscape, true);
    if (menu) menu.remove();
    menu = null;
    menuOwner = null;
  }

  function onDocumentDown(e) {
    if (!menu) return;
    const target = e.target instanceof Node ? e.target : null;
    if (target && (menu.contains(target) || menuOwner.button.contains(target))) {
      return;
    }
    closeMenu();
  }

  function onEscape(e) {
    // Swallowed, or Esc would close the entry form behind the menu as well.
    if (e.key !== "Escape") return;
    e.stopPropagation();
    closeMenu();
  }

  /* ---------------- inserting ---------------- */

  function insert(entry, text) {
    if (entry.field.kind === "value") insertIntoValue(entry.field.input, text);
    else insertIntoRich(entry.field, text);
  }

  /* Assigning to `.value` is invisible to anything watching the field, so the
   * change goes through the native setter and is then announced. ExtJS reads
   * the DOM value back, and the events cover the React-rendered pages too. */
  function setValue(input, value) {
    const proto =
      input.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");

    if (descriptor && descriptor.set) descriptor.set.call(input, value);
    else input.value = value;

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function insertIntoValue(input, text) {
    const current = input.value || "";
    const mode = config.insertMode || "cursor";
    const gap = input.tagName === "TEXTAREA" ? "\n" : " ";
    let next;
    let caret;

    if (mode === "replace" || !current.trim()) {
      next = text;
      caret = next.length;
    } else if (mode === "append") {
      next = current.replace(/\s+$/, "") + gap + text;
      caret = next.length;
    } else {
      const start =
        typeof input.selectionStart === "number"
          ? input.selectionStart
          : current.length;
      const end =
        typeof input.selectionEnd === "number" ? input.selectionEnd : start;
      next = current.slice(0, start) + text + current.slice(end);
      caret = start + text.length;
    }

    setValue(input, next);
    try {
      input.focus();
      input.setSelectionRange(caret, caret);
    } catch (e) {
      /* not all inputs support a selection range */
    }
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function selectionIsInside(doc, body) {
    try {
      const selection = doc.defaultView.getSelection();
      if (!selection || !selection.rangeCount) return false;
      return body.contains(selection.getRangeAt(0).commonAncestorContainer);
    } catch (e) {
      return false;
    }
  }

  function caretToEnd(doc, body) {
    try {
      const range = doc.createRange();
      range.selectNodeContents(body);
      range.collapse(false);
      const selection = doc.defaultView.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (e) {
      /* nothing to place a caret in */
    }
  }

  function insertIntoRich(field, text) {
    const doc = field.doc;
    const body = field.body;
    const mode = config.insertMode || "cursor";
    const hasText = !!(body.textContent || "").trim();

    try {
      if (doc.defaultView && doc.defaultView !== window) doc.defaultView.focus();
      if (body.focus) body.focus();
    } catch (e) {
      /* focus can be refused; the insert below still tries */
    }

    if (mode === "replace" || !hasText) {
      body.innerHTML = escapeHtml(text).replace(/\r?\n/g, "<br>");
      announce(field);
      return;
    }

    // No caret in the field yet means "at the cursor" has nowhere to go, so it
    // behaves like "at the end" rather than silently landing at the start.
    let atEnd = false;
    if (mode === "append" || !selectionIsInside(doc, body)) {
      caretToEnd(doc, body);
      atEnd = true;
    }

    // Text going on the end needs a break before it; text going where the
    // cursor was put should land exactly there.
    const html =
      (atEnd ? "<br>" : "") + escapeHtml(text).replace(/\r?\n/g, "<br>");
    let done = false;
    try {
      done = doc.execCommand("insertHTML", false, html);
    } catch (e) {
      done = false;
    }
    if (!done) body.innerHTML = (body.innerHTML || "") + html;

    announce(field);
  }

  /* The rich text editor syncs its value into the form when it loses focus,
   * which happens on the way to Save. These are for anything listening more
   * closely than that. */
  function announce(field) {
    const targets =
      field.body === field.anchor ? [field.body] : [field.body, field.anchor];
    targets.forEach(function (node) {
      if (!node || !node.dispatchEvent) return;
      try {
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {
        /* older event constructors, not worth a fallback */
      }
    });
  }

  /* ---------------- sweeping ---------------- */

  function scan() {
    if (!config.enabled || !snippets.length || !document.body) {
      if (attached.size) detachAll();
      return;
    }

    const containers = chronicleContainers();
    if (!containers.length) {
      if (attached.size) detachAll();
      return;
    }

    const seen = new Set();

    const origin = root ? layerOrigin() : null;

    containers.forEach(function (container) {
      container.querySelectorAll(FIELD_SELECTOR).forEach(function (el) {
        if (!isEligible(el)) return;

        const field = describeField(el);
        if (!field) return;

        const label = fieldLabel(el);
        const matching = snippets.filter(function (snippet) {
          return matches(snippet, label);
        });
        // No snippet claims this field, so no button belongs in it.
        if (!matching.length) return;

        seen.add(el);
        let entry = attached.get(el);
        if (!entry) {
          entry = attach(field);
          attached.set(el, entry);
        }
        entry.field = field; // a rich editor can be re-created under us
        entry.anchor = field.anchor;
        entry.container = container; // the form the button is kept inside
        entry.snippets = matching;
        remount(entry);
        place(entry, origin);
      });
    });

    // Whatever wasn't seen has gone: the form closed, or was re-rendered.
    Array.from(attached.keys()).forEach(function (el) {
      if (!seen.has(el)) detach(el);
    });
  }

  function tick() {
    if (document.hidden) return;
    try {
      scan();
    } catch (e) {
      console.error("[Compass Toolkit] Chronicle Snippets failed:", e);
    }
  }

  function start() {
    if (sweepTimer) return;
    sweepTimer = setInterval(tick, SWEEP_MS);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    tick();
  }

  function stop() {
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange);
    detachAll();
  }

  /* ---------------- wiring ---------------- */

  function apply() {
    CompassToolkit.whenReady(function () {
      if (config.enabled && snippets.length) start();
      else stop();
    });
  }

  CompassToolkit.observeFeature(FEATURE, function (settings) {
    // Buttons are mounted per placement, so a change of it rebuilds them.
    const moved = config.placement !== settings.placement;
    config = settings;
    if (moved) detachAll();
    apply();
  });

  // Notes are stored under their own key, so they change independently of the
  // feature's own settings.
  CompassToolkit.observeSnippets(function (list) {
    snippets = list;
    // Buttons are attached per field against the snippets that matched at the
    // time; the simplest way to pick up an edit is to build them again.
    detachAll();
    apply();
  });
})();
