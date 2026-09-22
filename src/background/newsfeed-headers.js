/* Compass Toolkit: Newsfeed Projector (background).
 *
 * Compass is an ASP.NET app and some endpoints are picky about where a request
 * came from. While the feature is on, requests made by this extension's own
 * pages (the projector display and the toolkit menu) to the school's Compass
 * site are rewritten so their Origin and Referer match that site, exactly like
 * the Compass web page. Loaded by background.js.
 */
(function () {
  "use strict";

  const FEATURE = "newsfeedProjector";
  const RULE_ID = 1;

  async function installHeaderRule() {
    const s = (await CompassToolkit.getSettings())[FEATURE];

    let host = null;
    try {
      host = new URL(s.schoolUrl).hostname;
    } catch (e) {
      /* not an address, so there is nothing to match */
    }

    // Off (or unusable) means no rule at all, so nothing is rewritten.
    if (!s.enabled || !host) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE_ID] });
      return;
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_ID],
      addRules: [
        {
          id: RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "origin", operation: "set", value: "https://" + host },
              { header: "referer", operation: "set", value: "https://" + host + "/" }
            ]
          },
          condition: {
            requestDomains: [host],
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: ["xmlhttprequest", "image", "other"]
          }
        }
      ]
    });
  }

  function install() {
    installHeaderRule().catch(function (e) {
      console.log("[Compass Toolkit] Newsfeed Projector header rule: " + e.message);
    });
  }

  chrome.runtime.onInstalled.addListener(install);
  chrome.runtime.onStartup.addListener(install);

  // Every setting is in one stored blob, so only act when this feature's
  // switch or address changed.
  chrome.storage.onChanged.addListener(function (changes, area) {
    const change = changes[CompassToolkit.SETTINGS_KEY];
    if (area !== "sync" || !change) return;
    const before = CompassToolkit.withDefaults(change.oldValue)[FEATURE];
    const after = CompassToolkit.withDefaults(change.newValue)[FEATURE];
    if (before.enabled !== after.enabled || before.schoolUrl !== after.schoolUrl) install();
  });
})();
