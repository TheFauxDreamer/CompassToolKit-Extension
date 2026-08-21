/* Compass Toolkit: Staff Card Printer.
 *
 * Compass's own Download PDF turns the directory into a list of names and
 * details. This prints the cards as cards, photo and all, which is what people
 * actually want on a staffroom wall or in a relief folder.
 *
 * The cards are read off the page rather than from an API, so whatever the
 * directory is showing is what prints: the whole list once Clean Staff
 * Directory has assembled it, without the accounts it hides.
 */
(function () {
  "use strict";

  if (!CompassToolkit.isTopFrame) return;

  const KEYS = CompassToolkit.DATA_KEYS;
  const PRINT_PAGE = "pages/staff-cards.html";
  const CARD = "div.MuiGrid-item";
  const CARD_LINK = 'a[href*="User.aspx"]';
  const MIN_CARDS = 3; // fewer than this is not a directory

  // Photos are re-encoded small: a printed card is a couple of centimetres
  // across, and a hundred full-size portraits would not fit in storage.
  const PHOTO_WIDTH = 150;
  const PHOTO_QUALITY = 0.72;
  const PHOTO_TIMEOUT_MS = 8000;
  const PHOTO_BATCH = 6;

  const OLIVE = "#827717";
  const OLIVE_DARK = "#6b6113";

  let config = { enabled: false, includePhotos: true };
  let button = null;
  let watcher = null;

  CompassToolkit.observeFeature("staffCards", function (settings) {
    config = settings;
    CompassToolkit.whenReady(function () {
      if (!settings.enabled) {
        stopWatching();
        removeButton();
        return;
      }
      refresh();
      startWatching();
    });
  });

  /* ---------------- finding the cards ---------------- */

  /* Always from the profile link outwards. The directory panel is itself a
   * grid item and holds every link on the page, so looking for grid items
   * directly would treat the whole directory as one person. */
  function readCards() {
    const seen = new Set();
    const out = [];

    document.querySelectorAll(CARD_LINK).forEach(function (link) {
      const card = link.closest(CARD);
      if (!card) return;
      // Whatever the directory is hiding stays hidden here too.
      if (card.dataset.compassFiltered || card.style.display === "none") return;

      const href = link.getAttribute("href") || "";
      if (!href || seen.has(href)) return;
      seen.add(href);

      out.push({
        name: text(link),
        url: link.href,
        status: text(card.querySelector(".MuiChip-label")),
        photo: photoUrl(card),
        email: emailOf(card),
        fields: fieldsOf(card)
      });
    });

    return out;
  }

  function text(node) {
    return node ? node.textContent.replace(/\s+/g, " ").trim() : "";
  }

  function photoUrl(card) {
    const img = card.querySelector("img");
    return img && img.src ? img.src : "";
  }

  /* The detail rows are a label span and a value span side by side, with the
   * label carrying the colon. Read by shape rather than by class, because the
   * classes are generated and change between builds. */
  function fieldsOf(card) {
    const out = [];
    card.querySelectorAll("div").forEach(function (row) {
      const spans = row.querySelectorAll(":scope > span");
      if (spans.length < 2) return;
      const label = text(spans[0]);
      if (!/:$/.test(label)) return;
      const value = text(spans[1]);
      if (!value || value === "-") return; // Compass's own empty marker
      out.push({ label: label.replace(/:\s*$/, ""), value: value });
    });
    return out;
  }

  function emailOf(card) {
    const nodes = card.querySelectorAll("a, span");
    for (let i = 0; i < nodes.length; i++) {
      const value = text(nodes[i]);
      if (value.indexOf("@") !== -1 && value.indexOf(" ") === -1) return value;
    }
    return "";
  }

  /* ---------------- photos ---------------- */

  /* Drawn through a canvas rather than passed on as a URL. The printable page
   * is served from the extension, so a Compass URL there is a cross-site
   * request without the session cookie and comes back as nothing. Loading the
   * image here, where the page's own session applies, and handing over the
   * pixels is what makes it appear. */
  function shrinkPhoto(url) {
    return new Promise(function (resolve) {
      if (!url) {
        resolve("");
        return;
      }
      let settled = false;
      const done = function (value) {
        if (settled) return;
        settled = true;
        resolve(value || "");
      };

      const img = new Image();
      img.onload = function () {
        try {
          const w = img.naturalWidth || PHOTO_WIDTH;
          const h = img.naturalHeight || PHOTO_WIDTH;
          const scale = Math.min(1, PHOTO_WIDTH / w);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          canvas
            .getContext("2d")
            .drawImage(img, 0, 0, canvas.width, canvas.height);
          done(canvas.toDataURL("image/jpeg", PHOTO_QUALITY));
        } catch (e) {
          // A canvas the browser will not let us read. Print without it.
          done("");
        }
      };
      img.onerror = function () {
        done("");
      };
      setTimeout(function () {
        done("");
      }, PHOTO_TIMEOUT_MS);
      img.src = url;
    });
  }

  // A few at a time: a hundred at once stalls the tab the user is looking at.
  async function attachPhotos(cards, onProgress) {
    let done = 0;
    for (let i = 0; i < cards.length; i += PHOTO_BATCH) {
      const batch = cards.slice(i, i + PHOTO_BATCH);
      await Promise.all(
        batch.map(function (card) {
          return shrinkPhoto(card.photo).then(function (data) {
            card.photo = data;
          });
        })
      );
      done += batch.length;
      if (onProgress) onProgress(done, cards.length);
    }
  }

  /* ---------------- the button ---------------- */

  const BUTTON_STYLE = `
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 99999;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 24px;
    color: #fff;
    background: ${OLIVE};
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

  const MARK = "data-ct-staff-print";

  /* Works on either kind of button. Compass's own carries its icon in a slot
   * of its own, so only that slot and the label are touched and the rest of
   * its markup is left alone. */
  function setLabel(node, iconName, label) {
    const slot = node.querySelector(".MuiButton-startIcon");
    const icon = CompassToolkitIcons.create(iconName, slot ? 19 : 16);
    if (slot) {
      slot.textContent = "";
      slot.appendChild(icon);
    }
    Array.prototype.slice.call(node.childNodes).forEach(function (child) {
      if (child.nodeType === Node.TEXT_NODE) child.remove();
    });
    if (!slot) {
      node.textContent = "";
      node.appendChild(icon);
    }
    node.appendChild(document.createTextNode(label));
  }

  /* Compass's Download PDF button, found by the icon React gives it rather
   * than by its wording, which a school could have translated. The label is
   * the fallback. Our own clone is never a candidate. */
  function findToolbarButton() {
    const buttons = document.querySelectorAll("button");
    for (let i = 0; i < buttons.length; i++) {
      const candidate = buttons[i];
      if (candidate.hasAttribute(MARK)) continue;
      if (candidate.querySelector('[data-testid="SaveAltIcon"]')) return candidate;
    }
    for (let i = 0; i < buttons.length; i++) {
      const candidate = buttons[i];
      if (candidate.hasAttribute(MARK)) continue;
      if (/download\s*pdf/i.test(candidate.textContent || "")) return candidate;
    }
    return null;
  }

  /* A copy of Compass's own button, so it sits beside it looking like it
   * belongs there rather than like something bolted on. Copying is what gets
   * the styling: the classes are generated per build and there is no way to
   * write them down in advance. */
  function cloneToolbarButton(reference) {
    const copy = reference.cloneNode(true);
    copy.setAttribute(MARK, "");
    copy.removeAttribute("id");
    copy.removeAttribute("aria-label");
    // React's ripple does nothing without React behind it.
    copy.querySelectorAll(".MuiTouchRipple-root").forEach(function (node) {
      node.remove();
    });
    setLabel(copy, "idCard", "Print Staff Cards");
    copy.title = "Compass Toolkit: print the staff cards";
    return copy;
  }

  function makeFloatingButton() {
    const node = document.createElement("button");
    node.style.cssText = BUTTON_STYLE;
    node.setAttribute(MARK, "");
    setLabel(node, "idCard", "Print Staff Cards");
    node.title = "Staff Card Printer";
    node.onmouseover = function () {
      node.style.background = OLIVE_DARK;
      node.style.transform = "scale(1.05)";
    };
    node.onmouseout = function () {
      node.style.background = OLIVE;
      node.style.transform = "scale(1)";
    };
    return node;
  }

  function placeButton(reference) {
    if (reference) {
      button = cloneToolbarButton(reference);
      reference.insertAdjacentElement("afterend", button);
    } else {
      // No toolbar to join, so it goes in the corner instead of nowhere.
      button = makeFloatingButton();
      document.body.appendChild(button);
    }
    button.setAttribute("data-ct-place", reference ? "inline" : "floating");
    button.addEventListener("click", build);
  }

  function removeButton() {
    document.querySelectorAll("[" + MARK + "]").forEach(function (node) {
      node.remove();
    });
    button = null;
  }

  // Any marked button that is not the live one is a leftover: a copy React
  // brought back with a piece of DOM it had cached, or one left behind by a
  // toolbar that has since reappeared. Only ours has a click handler on it.
  function dropStrays() {
    document.querySelectorAll("[" + MARK + "]").forEach(function (node) {
      if (node !== button) node.remove();
    });
  }

  function refresh() {
    const enough =
      document.querySelectorAll(CARD + " " + CARD_LINK).length >= MIN_CARDS;
    if (!config.enabled || !enough) {
      removeButton();
      return;
    }

    /* React rebuilds that toolbar whenever the list changes, and takes
     * anything of ours with it. The button is not just put back: where it
     * belongs is worked out again, so one that had to sit in the corner while
     * the toolbar was missing moves back into it once it returns. */
    const reference = findToolbarButton();
    const wanted = reference ? "inline" : "floating";
    const settled =
      button &&
      document.contains(button) &&
      button.getAttribute("data-ct-place") === wanted &&
      (!reference || button.previousElementSibling === reference);

    if (settled) {
      dropStrays();
      return;
    }

    removeButton();
    placeButton(reference);
    dropStrays();
  }

  // The directory is a React list, so the cards arrive after the page does.
  function startWatching() {
    if (watcher) return;
    watcher = new MutationObserver(function () {
      refresh();
    });
    watcher.observe(document.body, { childList: true, subtree: true });
  }

  function stopWatching() {
    if (watcher) watcher.disconnect();
    watcher = null;
  }

  /* ---------------- building the page ---------------- */

  async function build() {
    if (!button || button.disabled) return;

    const cards = readCards();
    if (!cards.length) {
      alert("No staff cards found on this page.");
      return;
    }

    setBusy(true);
    setLabel(button, "hourglass", "Reading " + cards.length + " cards…");

    try {
      if (config.includePhotos !== false) {
        await attachPhotos(cards, function (done, total) {
          setLabel(button, "hourglass", "Photos " + done + " of " + total);
        });
      } else {
        cards.forEach(function (card) {
          card.photo = "";
        });
      }

      const payload = {};
      payload[KEYS.staff] = {
        cards: cards,
        withPhotos: config.includePhotos !== false,
        timestamp: new Date().toISOString()
      };
      await CompassToolkit.setData(payload);

      const win = window.open(chrome.runtime.getURL(PRINT_PAGE), "_blank");
      if (!win) {
        alert("Please allow pop-ups for this site to open the printable page.");
      }
    } catch (e) {
      console.log("[Compass Toolkit] Staff card printing failed: " + e);
      alert("Could not build the printable page. See the console for details.");
    } finally {
      setLabel(button, "idCard", "Print Staff Cards");
      setBusy(false);
    }
  }

  function setBusy(busy) {
    if (!button) return;
    button.disabled = busy;
    // The class is what Compass's own styling reads; the inline pair covers
    // the plain button in the corner.
    button.classList.toggle("Mui-disabled", busy);
    button.style.opacity = busy ? "0.7" : "";
    button.style.cursor = busy ? "default" : "";
  }
})();
