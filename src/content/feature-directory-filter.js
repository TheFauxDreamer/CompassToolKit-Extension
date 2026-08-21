/* Compass Toolkit: Clean Staff Directory.
 *
 * Hides staff cards whose name contains any of the configured phrases, so
 * integration and system accounts stop cluttering the directory, and can read
 * the directory's pages into one list.
 *
 * The two go together. Compass pages the directory before this hides anything,
 * so a page of a hundred arrives with the system accounts still counted in it
 * and comes out as seventy-odd real people, with the rest pushed onto a second
 * page. Turning the page size up cannot fix that on its own: the largest
 * Compass offers is a hundred, and a school with more than that many real
 * staff still ends up split.
 */
(function () {
  "use strict";

  const FEATURE = "directoryFilter";
  const CARD_LINK = 'a[href*="User.aspx"]';
  const CARD = "div.MuiGrid-item";

  let filters = [];
  let enabled = false;
  let observer = null;

  function shouldHide(card) {
    const nameLink = card.querySelector(CARD_LINK);
    if (!nameLink) return false;

    const name = nameLink.textContent.trim().toLowerCase();
    return filters.some(function (phrase) {
      return phrase && name.includes(phrase.toLowerCase());
    });
  }

  function processCard(card) {
    if (enabled && shouldHide(card)) {
      card.style.display = "none";
      card.dataset.compassFiltered = "true";
    } else if (card.dataset.compassFiltered) {
      // Previously hidden, so the filters (or the feature) changed.
      card.style.display = "";
      delete card.dataset.compassFiltered;
    }
  }

  function applyFilters() {
    document.querySelectorAll(CARD + " " + CARD_LINK).forEach(function (link) {
      const card = link.closest(CARD);
      if (card) processCard(card);
    });
  }

  function unhideAll() {
    document
      .querySelectorAll('[data-compass-filtered="true"]')
      .forEach(function (card) {
        card.style.display = "";
        delete card.dataset.compassFiltered;
      });
  }

  // The directory is a React list: pagination, search and sorting all
  // re-render it, so new cards have to be caught as they arrive.
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(function (mutations) {
      const added = mutations.some(function (mutation) {
        return Array.prototype.some.call(mutation.addedNodes, function (node) {
          if (node.nodeType !== Node.ELEMENT_NODE) return false;
          return !!node.querySelector?.(CARD_LINK) || !!node.matches?.(CARD);
        });
      });
      if (added) {
        applyFilters();
        /* React redraws its footer along with its list, which puts its pager
         * and its own count back underneath a list that is no longer paged.
         * Those get put right again without paging through anything. */
        if (!merging && document.querySelector("[" + MERGED_ATTR + "]")) {
          if (fingerprint() !== mergedFingerprint) {
            /* React is showing a different set of people now, so the copies
             * are of a list that no longer applies. Searching for one person
             * and being handed the whole directory alongside them is the worst
             * version of this, so they go immediately. */
            undoMerge();
            queueMerge();
          } else {
            /* The same list, redrawn. React puts its pager and its own count
             * back underneath a list that is no longer paged, so those are
             * put right again without paging through anything. */
            sweepEmptyMerged();
            hidePagination();
            setCountLabel();
          }
        } else {
          // A redraw that took the copies with it means paging again.
          queueMerge();
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  /* ---------------- one page for everyone ---------------- */

  /* Compass's own page-size control is a React select, so its value cannot
   * simply be set: the only way to change it is to open it and click an
   * option, the same as a person would. Everything below drives the page the
   * way a person would, because that is the only interface React exposes.
   *
   * Cards are copied off each page rather than moved. Changing page re-renders
   * the list and throws away what was there, so the copies are what survives
   * to be put back together at the end. They are plain markup with a link in
   * them, which is all a directory card has to be. */

  const PAGINATION = 'nav[aria-label="pagination navigation"], .MuiPagination-root';
  const NEXT_BUTTON = '[aria-label="Go to next page"]';
  const PAGE_BUTTON = ".MuiPaginationItem-page";
  const COMBOBOX = '[role="combobox"]';
  const MERGED_ATTR = "data-ct-merged";
  const COUNT_ATTR = "data-ct-count";

  const STEP_MS = 120; // between polls while waiting for React to re-render
  const CHANGE_TIMEOUT_MS = 6000; // how long one page change may take
  const MAX_PAGES = 40; // a runaway guard, not an expected limit
  const MERGE_DELAY_MS = 600; // let a search settle before paging anything

  let showAll = false;
  let merging = false; // our own edits must not set the watcher off
  let mergeQueued = false;
  // Who React was showing when the copies were taken. Searching, sorting or
  // filtering by status changes that, and the copies are then of the old list.
  let mergedFingerprint = null;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* Every card is found by starting at the profile link and taking the grid
   * item closest to it.
   *
   * Searching for the grid item directly does not work: the whole directory
   * panel is itself one, so it matches, and it contains profile links because
   * everybody is inside it. Treating that as a card means copying the entire
   * directory, search box, pager and all, as though it were one person. */
  function allCards() {
    const out = [];
    document.querySelectorAll(CARD_LINK).forEach(function (link) {
      const card = link.closest(CARD);
      if (card && out.indexOf(card) === -1) out.push(card);
    });
    return out;
  }

  function isCard(node) {
    const link = node.querySelector(CARD_LINK);
    return !!link && link.closest(CARD) === node;
  }

  function cards() {
    return allCards().filter(function (card) {
      return !card.hasAttribute(MERGED_ATTR);
    });
  }

  // Who is on screen right now, in order. Used to tell one page from the next.
  function fingerprint() {
    return cards()
      .map(function (card) {
        const link = card.querySelector(CARD_LINK);
        return (link && link.getAttribute("href")) || "";
      })
      .join("|");
  }

  async function waitForChange(before) {
    const deadline = Date.now() + CHANGE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await wait(STEP_MS);
      const now = fingerprint();
      if (now && now !== before) return true;
    }
    return false;
  }

  /* The cards under one status heading. The heading is the element before the
   * grid the cards sit in, which is how Compass groups Active from the rest. */
  function groupsOnPage() {
    const found = [];
    cards().forEach(function (card) {
      const grid = card.parentElement;
      if (!grid) return;
      let group = null;
      for (let i = 0; i < found.length; i++) {
        if (found[i].grid === grid) group = found[i];
      }
      if (!group) {
        const heading = grid.previousElementSibling;
        group = {
          grid: grid,
          box: grid.parentElement,
          heading: heading ? heading.textContent.trim() : "",
          cards: []
        };
        found.push(group);
      }
      group.cards.push(card);
    });
    return found;
  }

  function pageCount() {
    const nav = document.querySelector(PAGINATION);
    if (!nav) return 1;
    return nav.querySelectorAll(PAGE_BUTTON).length || 1;
  }

  function nextButton() {
    const nav = document.querySelector(PAGINATION);
    return nav ? nav.querySelector(NEXT_BUTTON) : null;
  }

  async function goToFirstPage() {
    const nav = document.querySelector(PAGINATION);
    if (!nav) return;
    const first = Array.prototype.find.call(
      nav.querySelectorAll(PAGE_BUTTON),
      function (b) {
        return b.textContent.trim() === "1";
      }
    );
    // The page you are on is the one marked current, so there is nothing to do.
    if (!first || first.getAttribute("aria-current") === "true") return;
    const before = fingerprint();
    first.click();
    await waitForChange(before);
  }

  /* Fewer pages to read means fewer round trips, so the page size goes to
   * whatever the largest option is before the walk starts. */
  async function maximisePageSize() {
    const box = Array.prototype.find.call(
      document.querySelectorAll(COMBOBOX),
      function (el) {
        return /per page/i.test(el.textContent || "");
      }
    );
    if (!box) return;

    box.click();
    await wait(STEP_MS);

    const listId = box.getAttribute("aria-controls");
    const list =
      (listId && document.getElementById(listId)) ||
      document.querySelector('ul[role="listbox"]');
    if (!list) return;

    let best = null;
    let bestValue = -1;
    Array.prototype.forEach.call(
      list.querySelectorAll('[role="option"]'),
      function (option) {
        const raw = option.getAttribute("data-value") || option.textContent || "";
        const value = parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
        if (!isNaN(value) && value > bestValue) {
          bestValue = value;
          best = option;
        }
      }
    );
    if (!best || best.getAttribute("aria-selected") === "true") {
      // Already on the largest, so close the list and carry on.
      document.body.click();
      return;
    }
    const before = fingerprint();
    best.click();
    await waitForChange(before);
  }

  async function loadEveryPage() {
    if (merging || !enabled || !showAll) return;
    if (pageCount() <= 1) return; // one page already

    merging = true;
    /* Anything a previous run added comes out first. Settings changes deliver
     * again, and without this a second run appends a second copy of everyone
     * and a second set of group headings on top of the first. */
    removeMergedNodes();
    drawCurtain();
    showNote();
    try {
      await maximisePageSize();
      await goToFirstPage();

      // Keyed by the profile each card links to, so a card seen twice while
      // paging is only kept once.
      const seen = new Set();
      const collected = [];
      // An empty copy of each group's heading and grid, so a status that only
      // appears on a later page can be rebuilt rather than having its people
      // filed under whatever the first page happened to show.
      const shells = new Map();

      for (let page = 0; page < MAX_PAGES; page++) {
        groupsOnPage().forEach(function (group) {
          if (!shells.has(group.heading) && group.box) {
            /* Built rather than copied. Cloning the whole group meant finding
             * its grid again inside the copy and emptying it, which goes
             * wrong the moment Compass nests things differently: the wrong
             * element gets emptied and the copy keeps a stale set of cards.
             * A shallow clone of the grid is empty by construction. */
            const shellBox = document.createElement(group.box.tagName);
            shellBox.className = group.box.className;
            const heading = group.grid.previousElementSibling;
            if (heading) shellBox.appendChild(heading.cloneNode(true));
            const shellGrid = group.grid.cloneNode(false);
            shellBox.appendChild(shellGrid);
            shells.set(group.heading, { box: shellBox, grid: shellGrid });
          }
          group.cards.forEach(function (card) {
            const link = card.querySelector(CARD_LINK);
            const href = link && link.getAttribute("href");
            if (!href || seen.has(href)) return;
            seen.add(href);
            const copy = card.cloneNode(true);
            copy.setAttribute(MERGED_ATTR, "");
            collected.push({ heading: group.heading, card: copy });
          });
        });

        const next = nextButton();
        if (!next || next.disabled || next.classList.contains("Mui-disabled")) break;
        const before = fingerprint();
        next.click();
        if (!(await waitForChange(before))) break;
      }

      await goToFirstPage();
      placeCollected(collected, shells);
    } catch (e) {
      console.log("[Compass Toolkit] Could not read the whole directory: " + e);
    } finally {
      reveal();
      merging = false;
    }
  }

  /* The copies go back into the groups they came from, after whatever the
   * first page is already showing. Anything already on screen is left alone,
   * so the real cards keep working and only the extras are copies. */
  /* Compass's group headings are short status words. Anything long is this
   * having read the wrong element, and rebuilding a group from it would make
   * a box per page rather than one per status. */
  const MAX_HEADING = 40;

  function plausibleHeading(text) {
    return !!text && text.length <= MAX_HEADING;
  }

  function placeCollected(collected, shells) {
    const live = groupsOnPage();
    if (!live.length) return;

    const onScreen = new Set();
    const grids = new Map();
    live.forEach(function (group) {
      grids.set(group.heading, group.grid);
      group.cards.forEach(function (card) {
        const link = card.querySelector(CARD_LINK);
        if (link) onScreen.add(link.getAttribute("href"));
      });
    });

    const wrapper = live[0].box && live[0].box.parentElement;

    collected.forEach(function (item) {
      const link = item.card.querySelector(CARD_LINK);
      if (link && onScreen.has(link.getAttribute("href"))) return; // already here

      let target = grids.get(item.heading);
      if (!target && !plausibleHeading(item.heading)) {
        // Not a status label, so there is nothing sensible to rebuild. Better
        // in with the rest than in a box of its own.
        target = live[0].grid;
      }
      if (!target) {
        /* A status the first page never showed. Its own heading and grid are
         * put back rather than its people being appended to another group,
         * which would quietly relabel them. */
        const shell = shells.get(item.heading);
        if (shell && wrapper) {
          shell.box.setAttribute(MERGED_ATTR, "");
          wrapper.appendChild(shell.box);
          target = shell.grid;
          grids.set(item.heading, target);
        } else {
          target = live[0].grid;
        }
      }
      target.appendChild(item.card);
    });

    sweepEmptyMerged();
    hidePagination();
    // Filter first: the count has to describe what is left on screen, which is
    // the whole complaint about Compass's own.
    applyFilters();
    setCountLabel();
    mergedFingerprint = fingerprint();
  }

  function hidePagination() {
    const nav = document.querySelector(PAGINATION);
    if (nav) nav.style.display = "none";
    const box = Array.prototype.find.call(
      document.querySelectorAll(COMBOBOX),
      function (el) {
        return /per page/i.test(el.textContent || "");
      }
    );
    // The whole control, not just its label.
    const control = box && box.closest(".MuiInputBase-root");
    if (control) control.style.display = "none";
  }

  /* Compass counts before any of this hides anything, so its own label would
   * read "Showing 1-134 of 134" over a list of ninety. */
  function setCountLabel() {
    let shown = 0;
    let hidden = 0;
    allCards().forEach(function (card) {
      if (card.dataset.compassFiltered) hidden++;
      else shown++;
    });

    const label = Array.prototype.find.call(
      document.querySelectorAll("span"),
      function (el) {
        // Either Compass's own label, or the one this already replaced, so
        // the count can be brought up to date when the filters change.
        return (
          el.hasAttribute(COUNT_ATTR) ||
          /Showing\s+[\d,]+\s*[\u2013-]\s*[\d,]+\s+of\s+[\d,]+/i.test(
            el.textContent || ""
          )
        );
      }
    );
    if (!label) return;
    if (!label.hasAttribute(COUNT_ATTR)) {
      label.setAttribute(COUNT_ATTR, label.textContent);
    }
    label.textContent =
      "Showing all " + shown + (hidden ? " (" + hidden + " hidden)" : "");
  }

  /* Anything this added that has ended up with no card in it is showing
   * nobody, so it is just an empty box on the page. They are swept by what
   * they contain rather than by how they came to be there, so a heading that
   * does not line up between pages cannot leave a trail of them. */
  function sweepEmptyMerged() {
    document.querySelectorAll("[" + MERGED_ATTR + "]").forEach(function (node) {
      if (isCard(node)) return; // a person, which is the point
      // A group of cards holds cards. Anything holding a pager or a search box
      // is a copy of the directory itself and should never have been made.
      if (node.querySelector("nav, [role=\"combobox\"], input")) {
        node.remove();
        return;
      }
      if (!node.querySelector(CARD_LINK)) node.remove(); // holds nobody
    });
  }

  function removeMergedNodes() {
    document.querySelectorAll("[" + MERGED_ATTR + "]").forEach(function (node) {
      node.remove();
    });
  }

  function undoMerge() {
    removeMergedNodes();
    mergedFingerprint = null;
    const nav = document.querySelector(PAGINATION);
    if (nav) nav.style.display = "";
    document.querySelectorAll("[" + COUNT_ATTR + "]").forEach(function (label) {
      label.textContent = label.getAttribute(COUNT_ATTR);
      label.removeAttribute(COUNT_ATTR);
    });
    document.querySelectorAll(COMBOBOX).forEach(function (el) {
      const control = el.closest(".MuiInputBase-root");
      if (control && control.style.display === "none") control.style.display = "";
    });
  }

  /* ---------------- covering the work ---------------- */

  /* Reading the pages means driving Compass's own pager, so the list really
   * does jump to page two and back while this runs. Watching that happen is
   * the flicker, so the list is covered until it is one list again.
   *
   * The region holding the cards is Compass's own element, so it is only
   * hidden, never emptied: React carries on rendering into it throughout. */
  const REGION = '[role="region"].MuiAccordion-region, [role="region"]';
  const CURTAIN_MAX_MS = 10000; // the backstop; the reveals below do the work
  const NOTE_ATTR = "data-ct-loading";

  let curtainEl = null;
  let curtainTimer = null;

  function drawCurtain() {
    if (curtainEl) return;
    const region = document.querySelector(REGION);
    if (!region) return;
    try {
      // The way out first, so nothing after this can strand a hidden list.
      curtainTimer = setTimeout(reveal, CURTAIN_MAX_MS);
      region.style.visibility = "hidden";
      curtainEl = region;
    } catch (e) {
      reveal();
    }
  }

  // Only worth saying while pages are actually being read.
  function showNote() {
    if (!curtainEl || document.querySelector("[" + NOTE_ATTR + "]")) return;
    const note = document.createElement("div");
    note.setAttribute(NOTE_ATTR, "");
    note.textContent = "Loading the full staff list\u2026";
    note.style.cssText =
      "padding:18px 4px; font-family:system-ui,-apple-system,sans-serif;" +
      "font-size:13px; color:#6b7688;";
    curtainEl.parentElement.insertBefore(note, curtainEl);
  }

  function reveal() {
    if (curtainTimer) clearTimeout(curtainTimer);
    curtainTimer = null;
    if (curtainEl) curtainEl.style.visibility = "";
    curtainEl = null;
    document.querySelectorAll("[" + NOTE_ATTR + "]").forEach(function (n) {
      n.remove();
    });
  }

  /* Searching, sorting or changing the status filter makes React draw its own
   * list again, which takes the copies with it. That is the signal to read the
   * pages again rather than something to prevent. */
  function queueMerge() {
    if (merging || mergeQueued || !enabled || !showAll) return;
    if (document.querySelector("[" + MERGED_ATTR + "]")) return; // still there
    if (pageCount() <= 1) return; // it all fits already
    mergeQueued = true;
    // Long enough for typing in the search box to settle before any paging.
    setTimeout(function () {
      mergeQueued = false;
      loadEveryPage();
    }, MERGE_DELAY_MS);
  }

  /* ---------------- before the first paint ---------------- */

  /* Compass paints its cards as soon as its own data arrives, which can be
   * before the settings saying which of them to hide have been read. Left
   * alone that puts every account on screen for a moment and then takes thirty
   * of them away again, which is the flicker.
   *
   * A mutation callback runs before the browser paints, so covering the list
   * the instant the first card is inserted means the unfiltered version is
   * never shown at all. Nothing is covered until a card has actually been
   * seen, so no other Compass page is affected by this. */
  let settingsKnown = false;
  let firstCardSeen = false;
  let earlyWatch = null;

  function startEarlyWatch() {
    if (earlyWatch || !document.documentElement) return;
    earlyWatch = new MutationObserver(function () {
      if (firstCardSeen || !document.querySelector(CARD_LINK)) return;
      firstCardSeen = true;
      stopEarlyWatch();
      /* Settings that have not arrived yet are treated as the feature being
       * on. Covering briefly and uncovering costs nothing; showing the
       * unfiltered list is the thing worth avoiding. */
      if (!settingsKnown || enabled) drawCurtain();
      settle();
    });
    earlyWatch.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function stopEarlyWatch() {
    if (earlyWatch) earlyWatch.disconnect();
    earlyWatch = null;
  }

  /* What to do once both the cards and the settings are known. Whichever
   * arrives second is what runs this. */
  function settle() {
    if (!firstCardSeen || !settingsKnown) return;
    if (!enabled) {
      reveal();
      return;
    }
    applyFilters();
    // Paging reveals when it has finished; there is nothing else to wait for.
    if (showAll) loadEveryPage();
    else reveal();
  }

  CompassToolkit.observeFeature(FEATURE, function (settings) {
    enabled = !!settings.enabled;
    filters = Array.isArray(settings.filters) ? settings.filters : [];
    const wantAll = enabled && settings.showAll !== false;
    const changed = wantAll !== showAll;
    showAll = wantAll;
    settingsKnown = true;

    CompassToolkit.whenReady(function () {
      if (!enabled) {
        stopObserver();
        stopEarlyWatch();
        unhideAll();
        undoMerge();
        reveal();
        return;
      }
      applyFilters();
      startObserver();
      if (showAll) settle();
      else if (changed) undoMerge();
      // Cards already on screen when the settings landed: nothing to wait for.
      if (firstCardSeen && !showAll) reveal();
    });
  });

  startEarlyWatch();
})();
