/* Compass Toolkit: Attendance Note Watcher (background).
 *
 * Checks Compass on a timer for attendance notes waiting for review, and
 * alerts you with a desktop notification, a banner in your open Compass tabs,
 * or both when new ones appear. Loaded by background.js. The page half is
 * src/content/feature-attendance-watcher.js.
 */
(function () {
  "use strict";

  const FEATURE = "attendanceWatcher";
  const ALARM = "attendance-watcher-check";
  const NOTIFICATION_PREFIX = "attendance-watcher-";
  const BASE_TITLE = "Compass Toolkit";
  const COMPASS_URLS = ["*://*.compass.education/*"];
  const STATE_KEY = CompassToolkit.DATA_KEYS.watcher;
  const PENDING_TTL_MS = 60 * 1000;

  async function getSettings() {
    return (await CompassToolkit.getSettings())[FEATURE];
  }

  /* ---------------- state ---------------- */

  async function getState() {
    const data = await CompassToolkit.getData([STATE_KEY]);
    return data[STATE_KEY] || {};
  }

  /* Writes are queued so two overlapping patches can't each read the same
   * old state and drop the other's changes. */
  let writes = Promise.resolve();
  function setState(patch) {
    const next = writes.then(async function () {
      const state = Object.assign({}, await getState(), patch);
      await CompassToolkit.setData({ [STATE_KEY]: state });
      return state;
    });
    writes = next.catch(function () {});
    return next;
  }

  /* ---------------- scheduling ---------------- */

  async function schedule() {
    const s = await getSettings();
    await chrome.alarms.clear(ALARM);
    if (!s.enabled) return setBadge(null);
    const period = Math.max(1, Number(s.intervalMinutes) || 5);
    chrome.alarms.create(ALARM, { delayInMinutes: 0.2, periodInMinutes: period });
  }

  chrome.runtime.onInstalled.addListener(function () {
    schedule();
  });
  chrome.runtime.onStartup.addListener(schedule);

  // Every setting is in one stored blob, so only reschedule when a change
  // touches the timer itself.
  chrome.storage.onChanged.addListener(function (changes, area) {
    const change = changes[CompassToolkit.SETTINGS_KEY];
    if (area !== "sync" || !change) return;
    const before = CompassToolkit.withDefaults(change.oldValue)[FEATURE];
    const after = CompassToolkit.withDefaults(change.newValue)[FEATURE];
    if (
      before.enabled !== after.enabled ||
      before.intervalMinutes !== after.intervalMinutes
    ) {
      schedule();
    }
  });

  chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === ALARM) runCheck("timer");
  });

  function withinHours(s) {
    if (!s.schoolHoursOnly) return true;
    const now = new Date();
    if (now.getDay() === 0 || now.getDay() === 6) return false;
    const toMins = function (time) {
      const parts = String(time).split(":").map(Number);
      return parts[0] * 60 + (parts[1] || 0);
    };
    const mins = now.getHours() * 60 + now.getMinutes();
    return mins >= toMins(s.startTime) && mins <= toMins(s.endTime);
  }

  /* ---------------- fetching ---------------- */

  async function compassTabs() {
    const tabs = await chrome.tabs.query({ url: COMPASS_URLS });
    return tabs.filter(function (tab) {
      return !tab.discarded;
    });
  }

  async function findCompassTab() {
    return (await compassTabs())[0] || null;
  }

  // Null when the tab can't answer, such as one opened before the extension
  // was installed or reloaded, which has no content script yet.
  async function viaTab(tab, endpoint) {
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, {
        type: "CT_WATCHER_FETCH",
        endpoint: endpoint
      });
      return reply || null;
    } catch (e) {
      return null;
    }
  }

  /* Prefer making the request from inside an open Compass tab, where your
   * signed-in session is guaranteed. Otherwise go direct. */
  async function attempt(origin, endpoint) {
    const tabs = await compassTabs();
    const tab = tabs.find(function (t) {
      return new URL(t.url).origin === origin;
    });

    let response = tab ? await viaTab(tab, endpoint) : null;
    let source = "Compass tab";
    if (!response) {
      response = await CompassToolkitAlerts.fetchAlerts(origin, endpoint);
      source = tab
        ? "background (Compass tab not ready)"
        : "background (no Compass tab open)";
    }

    const parsed = response.error
      ? response
      : CompassToolkitAlerts.parseAlerts(response.text || "");
    return Object.assign({}, parsed, {
      source: source,
      raw: typeof response.text === "string" ? response.text.slice(0, 400) : null
    });
  }

  let running = null;

  async function runCheck(trigger) {
    // A manual check waits for any check already in progress, then runs its
    // own, so Check now always gets a fresh result and its own alerts.
    while (running) {
      if (trigger === "timer") return running;
      await running.catch(function () {});
    }
    running = (async function () {
      const s = await getSettings();
      if (trigger === "timer" && (!s.enabled || !withinHours(s))) return getState();

      let { origin, endpoint } = await getState();
      if (!origin) {
        const tab = await findCompassTab();
        if (tab) {
          // Kept, because a tab opened before the extension was installed
          // never sends its own hello, and opening the notes needs this.
          origin = new URL(tab.url).origin;
          await setState({ origin: origin });
        }
      }
      if (!origin) return fail("no-origin");

      const candidates = endpoint ? [endpoint] : CompassToolkitAlerts.GUESSED_ENDPOINTS;
      let result;
      for (const candidate of candidates) {
        result = await attempt(origin, candidate);
        if (!result.error) {
          if (!endpoint) await setState({ endpoint: candidate, endpointGuessed: true });
          break;
        }
        if (endpoint && result.error === "signed-out") break;
      }
      await setState({ lastSource: result.source, lastRaw: result.raw });
      if (result.error) return fail(endpoint ? result.error : "needs-learning");
      await recordResult(result, trigger);
      return getState();
    })().finally(function () {
      running = null;
    });
    return running;
  }

  async function fail(error) {
    await setBadge({ error: true });
    return setState({ lastCheck: Date.now(), lastError: error });
  }

  /* ---------------- results ---------------- */

  function isNewer(result, seen) {
    if (!result.found) return false;
    if (seen == null) return true;
    if (typeof result.count === "number") {
      return typeof seen !== "number" || result.count > seen;
    }
    return false;
  }

  /* mode: "timer"  -> alert only if the notes are new or the count went up
   *       "manual" -> alert whenever notes are waiting (the Check now button)
   *       "page"   -> never alert; you're looking at the homepage already */
  async function recordResult(result, mode) {
    const s = await getSettings();
    const state = await getState();
    const alert =
      (mode === "timer" && isNewer(result, state.seen)) ||
      (mode === "manual" && result.found);
    const seen = result.found
      ? typeof result.count === "number"
        ? result.count
        : "found"
      : null;
    await setState({ seen: seen, lastCheck: Date.now(), lastResult: result, lastError: null });
    await setBadge(result);

    if (!result.found) broadcast({ type: "CT_WATCHER_HIDE_BANNER" });
    if (alert) await deliver(result, s);
  }

  /* Send to every open Compass tab. Tabs opened before the extension was
   * installed or reloaded have no content script yet, so they miss it until
   * they are refreshed. */
  async function broadcast(message) {
    const tabs = await compassTabs();
    const delivered = await Promise.all(
      tabs.map(async function (tab) {
        try {
          await chrome.tabs.sendMessage(tab.id, message);
          return true;
        } catch (e) {
          return false;
        }
      })
    );
    if (!tabs.length) return "no Compass tabs open";
    const shown = delivered.filter(Boolean).length;
    return (
      "shown in " + shown + " of " + tabs.length +
      " Compass tab" + (tabs.length === 1 ? "" : "s") +
      (shown < tabs.length ? " (refresh the ones it missed)" : "")
    );
  }

  /* ---------------- toolbar badge ---------------- */

  async function setBadge(result) {
    if (!result) {
      await chrome.action.setBadgeText({ text: "" });
      return chrome.action.setTitle({ title: BASE_TITLE });
    }
    if (result.error) {
      await chrome.action.setBadgeBackgroundColor({ color: "#7a8a92" });
      await chrome.action.setBadgeText({ text: "?" });
      return chrome.action.setTitle({
        title: BASE_TITLE + ": the last attendance note check didn't complete"
      });
    }
    if (result.found) {
      await chrome.action.setBadgeBackgroundColor({ color: "#c2410c" });
      await chrome.action.setBadgeText({
        text: typeof result.count === "number" ? String(result.count) : "!"
      });
      return chrome.action.setTitle({
        title: BASE_TITLE + ": " + (result.title || "Attendance notes need review")
      });
    }
    await chrome.action.setBadgeText({ text: "" });
    return chrome.action.setTitle({ title: BASE_TITLE });
  }

  /* ---------------- alerts ---------------- */

  async function notify(result, s) {
    const n = result.count;
    try {
      await chrome.notifications.create(NOTIFICATION_PREFIX + Date.now(), {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "Attendance notes need review",
        message:
          typeof n === "number"
            ? n + " attendance note" + (n === 1 ? " is" : "s are") +
              " waiting for review in Compass."
            : result.title || "New attendance notes are waiting for review in Compass.",
        priority: 2,
        requireInteraction: !!s.requireInteraction
      });
      return "sent";
    } catch (e) {
      return "failed: " + (e.message || e);
    }
  }

  async function deliver(result, s) {
    const notification = s.desktopNotifications
      ? await notify(result, s)
      : "turned off in settings";
    const banner = s.inPageBanner
      ? await broadcast({ type: "CT_WATCHER_SHOW_BANNER", result: result })
      : "turned off in settings";
    await setState({ lastDelivery: { at: Date.now(), notification: notification, banner: banner } });
  }

  /* ---------------- opening the notes ---------------- */

  /* Compass's alert link lands on the Attendance page's default tab. When
   * Quick Attendance Notes is on, the tab is marked before it goes there, and
   * that feature's content script claims the mark and switches to the Notes
   * tab. Ordinary visits aren't marked, so they're left alone. */
  async function markPending(tabId) {
    const { pendingNotes = {} } = await chrome.storage.session.get("pendingNotes");
    pendingNotes[tabId] = Date.now();
    await chrome.storage.session.set({ pendingNotes: pendingNotes });
  }

  async function claimPending(tabId) {
    const { pendingNotes = {} } = await chrome.storage.session.get("pendingNotes");
    const stamp = pendingNotes[tabId];
    delete pendingNotes[tabId];
    await chrome.storage.session.set({ pendingNotes: pendingNotes });
    return !!stamp && Date.now() - stamp < PENDING_TTL_MS;
  }

  // Opens the attendance notes in preferTabId, else an open Compass tab, else a new tab.
  async function openNotes(preferTabId) {
    const { origin, lastResult } = await getState();
    if (!origin) return;

    // The link comes from Compass's own reply, so it only counts if it stays on Compass.
    let url = new URL((lastResult && lastResult.linkUrl) || "/Organise/Attendance/", origin);
    if (url.origin !== origin) url = new URL("/Organise/Attendance/", origin);

    let tab = null;
    if (preferTabId != null) tab = await chrome.tabs.get(preferTabId).catch(function () { return null; });
    if (!tab) tab = await findCompassTab();
    if (!tab) tab = await chrome.tabs.create({ url: "about:blank", active: true });

    const all = await CompassToolkit.getSettings();
    if (all.attendanceNotes.enabled) await markPending(tab.id);
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true, url: url.href });
  }

  chrome.tabs.onRemoved.addListener(function (tabId) {
    claimPending(tabId).catch(function () {});
  });

  chrome.notifications.onClicked.addListener(function (id) {
    if (id.indexOf(NOTIFICATION_PREFIX) !== 0) return;
    chrome.notifications.clear(id);
    openNotes(null);
  });

  /* ---------------- messages ---------------- */

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.type) return;

    if (message.type === "CT_WATCHER_TEST_ALERT") {
      (async function () {
        const s = await getSettings();
        const sample = {
          found: true,
          count: 3,
          title: "Test: there are 3 Attendance Notes that require review.",
          linkUrl: "/Organise/Attendance/"
        };
        await deliver(sample, Object.assign({}, s, { desktopNotifications: true, inPageBanner: true }));
        sendResponse(await getState());
      })();
      return true;
    }

    if (message.type === "CT_WATCHER_CHECK_NOW") {
      runCheck("manual").then(sendResponse);
      return true;
    }

    if (message.type === "CT_WATCHER_OPEN_NOTES") {
      openNotes(sender.tab ? sender.tab.id : null);
      return;
    }

    if (message.type === "CT_CLAIM_NOTES_TAB" && sender.tab) {
      claimPending(sender.tab.id).then(function (open) {
        sendResponse({ open: open });
      });
      return true;
    }

    if (message.type === "CT_WATCHER_HELLO" && message.origin) {
      getState().then(function (state) {
        if (state.origin !== message.origin) setState({ origin: message.origin });
      });
      return;
    }

    if (message.type === "CT_WATCHER_LEARNED") {
      /* The homepage just made its own alerts call: remember exactly how, and
       * record what it showed you (no alert, since you're looking at it). */
      (async function () {
        await setState({ origin: message.origin, endpoint: message.endpoint, endpointGuessed: false });
        const parsed = CompassToolkitAlerts.parseAlerts(message.text || "");
        if (!parsed.error) await recordResult(parsed, "page");
      })();
    }
  });
})();
