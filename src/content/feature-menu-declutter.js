/* Compass Toolkit: Menu Declutter.
 *
 * Compass advertises modules the school has not bought inside its own
 * navigation menus. Those entries are tagged in the markup, either with the
 * feature-demo class or by pointing at FeatureDemonstration.aspx, so they can
 * be picked out exactly and nothing you actually have access to is touched.
 *
 * The hiding is done with a stylesheet rather than by walking the DOM, so the
 * adverts never appear and then vanish. What is left over needs JavaScript:
 * a subheading whose every entry was an advert, and a whole menu whose
 * dropdown was nothing else.
 */
(function () {
  "use strict";

  const FEATURE = "menuDeclutter";
  const STYLE_ID = "ct-menu-declutter";
  const HIDDEN_CLASS = "ct-menu-emptied";

  // A direct-child link that marks an entry as an advert.
  const PROMO_LINK = 'a.feature-demo, a[href*="FeatureDemonstration.aspx"]';

  /* Kept apart, because they are switched separately. The advert rules go with
   * the "Show module adverts" option; the class rule is what everything else
   * here hides with, so it stands as long as the feature is on at all.
   *
   * The option is worded the other way round, as showing rather than hiding,
   * to match every other switch in the panel. */
  const ADVERT_CSS =
    "li:has(> a.feature-demo)," +
    'li:has(> a[href*="FeatureDemonstration.aspx"])' +
    "{display:none !important}" +
    /* If the markup ever changes and the link is not wrapped in an item of
     * its own, the link itself still goes. */
    "a.feature-demo," +
    'a[href*="FeatureDemonstration.aspx"]' +
    "{display:none !important}";

  const HIDDEN_CSS = "." + HIDDEN_CLASS + "{display:none !important}";

  let enabled = false;
  let showAdverts = false;
  let showEmptyHeadings = false;
  let chosen = [];
  let observer = null;
  let queued = false;

  /* The stylesheet goes in before anything is painted, which means before the
   * settings that say whether it is wanted have been read. Putting it up and
   * taking it down again costs nothing; leaving the adverts on screen for a
   * moment and then pulling them is the thing worth avoiding. */
  function setStyle(css) {
    if (!document.documentElement) return;
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
  }

  function removeStyle() {
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
  }

  /* ---------------- what counts as gone ---------------- */

  function isPromo(item) {
    return item.querySelector(":scope > " + PROMO_LINK) !== null;
  }

  /* What identifies one menu entry between the page and the popup. Its link is
   * the natural handle; entries that only run script get their wording
   * instead, which is stable enough for a menu. */
  function entryKey(item) {
    const link = item.querySelector(":scope > a");
    const href = link ? link.getAttribute("href") || "" : "";
    if (href && href !== "#") return href;
    const label = text(link || item);
    return label ? "label:" + label : "";
  }

  function text(node) {
    return node ? node.textContent.replace(/\s+/g, " ").trim() : "";
  }

  function isChosen(item) {
    if (!chosen.length) return false;
    const key = entryKey(item);
    return !!key && chosen.indexOf(key) !== -1;
  }

  /* Whether an entry is already off the menu, and so does not count towards
   * keeping its heading. An advert only counts as gone while adverts are being
   * hidden; left showing, it is an entry like any other. */
  function isGone(item) {
    return (
      item.classList.contains(HIDDEN_CLASS) ||
      item.hidden ||
      item.style.display === "none" ||
      (!showAdverts && isPromo(item))
    );
  }

  function hide(node) {
    node.classList.add(HIDDEN_CLASS);
  }

  /* ---------------- the leftovers ---------------- */

  function tidy() {
    // From a clean slate, so an entry comes back if Compass rebuilds the menu
    // with something real in it.
    document.querySelectorAll("." + HIDDEN_CLASS).forEach(function (node) {
      node.classList.remove(HIDDEN_CLASS);
    });

    if (!enabled) return;

    document.querySelectorAll("li").forEach(function (item) {
      if (isChosen(item)) hide(item);
    });

    if (showEmptyHeadings) return;

    document.querySelectorAll("ul").forEach(function (list) {
      let heading = null;
      let sectionHasItems = false;
      let listHasItems = false;

      const closeSection = function () {
        if (heading && !sectionHasItems) hide(heading);
      };

      Array.prototype.forEach.call(list.children, function (item) {
        if (item.tagName !== "LI") return;

        if (item.classList.contains("mnuSubHead")) {
          closeSection();
          heading = item;
          sectionHasItems = false;
          return;
        }

        if (item.classList.contains("mnuHead")) {
          closeSection();
          heading = null;
          sectionHasItems = false;
          return;
        }

        if (!isGone(item)) {
          sectionHasItems = true;
          listHasItems = true;
        }
      });

      closeSection();

      /* A menu whose whole dropdown was adverts: the icon that opens it goes
       * too. Only ever a real Compass dropdown, which is what the mnuHead
       * says, so empty lists elsewhere on the page are left alone. */
      const isMenuList = list.querySelector(":scope > li.mnuHead") !== null;
      if (isMenuList && !listHasItems) {
        const parent = list.parentElement;
        if (
          parent &&
          parent.tagName === "LI" &&
          parent.querySelector("ul") === list
        ) {
          hide(parent);
        }
      }
    });
  }

  /* Compass rebuilds parts of the page as you move around it.
   *
   * The pass is asked for before the next paint, so an emptied heading is
   * gone in the same frame the change lands in. A frame never comes in a
   * background tab though, so a timer backs it up: the work still has to
   * happen, it just does not matter exactly when nobody is looking. */
  const SAFETY_MS = 250;

  function schedule() {
    if (queued) return;
    queued = true;
    const run = function () {
      if (!queued) return; // whichever got here first has done it
      queued = false;
      tidy();
    };
    requestAnimationFrame(run);
    setTimeout(run, SAFETY_MS);
  }

  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) observer.disconnect();
    observer = null;
  }

  CompassToolkit.observeFeature(FEATURE, function (settings) {
    enabled = !!settings.enabled;
    showAdverts = !!settings.showAdverts;
    showEmptyHeadings = !!settings.showEmptyHeadings;
    chosen = Array.isArray(settings.hidden) ? settings.hidden : [];

    if (enabled) setStyle((showAdverts ? "" : ADVERT_CSS) + HIDDEN_CSS);
    else removeStyle();

    if (!enabled) {
      stopObserver();
      CompassToolkit.whenReady(tidy); // puts back whatever was hidden
      return;
    }

    CompassToolkit.whenReady(function () {
      tidy();
      startObserver();
    });
  });

  /* ---------------- what the popup asks for ---------------- */

  /* The menus as they stand on this page, so the popup can offer them rather
   * than asking someone to work out what to type. Only the top frame answers:
   * the menus live there, and a page with frames in it would otherwise send
   * back several replies to the one question. */
  /* Compass puts a placeholder in while it fetches a menu's contents, such as
   * "Loading Class Items...". Nobody can choose to hide something that is
   * about to disappear on its own, so it is never offered.
   *
   * It usually sits alongside the real entries, which are already there, and
   * then that is all there is to it. Only when a menu holds the placeholder
   * and nothing else has anything actually not arrived yet, and only then is
   * it worth waiting and asking again. */
  const PLACEHOLDER = /^loading\b/i;

  function readMenus() {
    const groups = [];
    let loading = false;

    document.querySelectorAll("ul").forEach(function (list) {
      const head = list.querySelector(":scope > li.mnuHead");
      if (!head) return; // not one of Compass's dropdowns

      const owner = list.parentElement;
      const ownerLink =
        owner && owner.tagName === "LI"
          ? owner.querySelector(":scope > a")
          : null;
      const group = {
        name: text(head) || text(ownerLink) || "Menu",
        key: owner && owner.tagName === "LI" ? entryKey(owner) : "",
        items: []
      };
      let placeholder = false;

      Array.prototype.forEach.call(list.children, function (item) {
        if (item.tagName !== "LI") return;
        if (item.classList.contains("mnuHead")) return;
        if (item.classList.contains("mnuSubHead")) return; // a label, not a link
        if (isPromo(item)) return; // already gone, and not a choice to offer

        const key = entryKey(item);
        const label = text(item.querySelector(":scope > a") || item);
        if (!key || !label) return;
        if (PLACEHOLDER.test(label)) {
          placeholder = true;
          return;
        }
        group.items.push({ key: key, label: label });
      });

      if (group.items.length) groups.push(group);
      // A placeholder and nothing else: this one really is still filling in.
      else if (placeholder) loading = true;
    });

    return { groups: groups, loading: loading };
  }

  if (CompassToolkit.isTopFrame) {
    chrome.runtime.onMessage.addListener(function (message, sender, respond) {
      if (!message || message.type !== "CT_MENU_ITEMS") return;
      respond(readMenus());
      return true;
    });
  }

  // Before the settings arrive, so nothing is ever seen that should not be.
  setStyle(ADVERT_CSS + HIDDEN_CSS);
})();
