/* Compass Toolkit — shared settings layer.
 *
 * Loaded as a classic script by the content scripts, the popup and the
 * extension's own pages, so everything agrees on one schema and one storage
 * key. Feature settings live in chrome.storage.sync (small, worth syncing);
 * captured page data lives in chrome.storage.local (large, device specific).
 */

var CompassToolkit = (function () {
  "use strict";

  const SETTINGS_KEY = "settings";

  const DEFAULT_DIRECTORY_FILTERS = [
    "(DOE Integration)",
    "(Program Kaartdijin)",
    "Kaartdijin",
    "(STIMS)"
  ];

  /* The single source of truth: each feature, its sub-settings, and the
   * labels the popup renders. `default` on a sub-setting also defines the
   * value features fall back to when nothing is stored. */
  const FEATURES = [
    {
      key: "timetablePrinter",
      name: "Timetable Printer",
      version: "2.3",
      icon: "printer",
      description:
        "Adds a print button to the Schedule tab of a staff or student profile.",
      where: "Profile pages (UserNew.aspx)",
      settings: [
        {
          key: "quickPrint",
          type: "toggle",
          label: "Quick print",
          description:
            "Skip the preview and open the print dialogue straight away.",
          default: false
        }
      ]
    },
    {
      key: "clearanceForm",
      name: "Clearance Form",
      version: "1.3.1",
      icon: "clipboard",
      description:
        "Adds a button that builds a printable clearance form from a student's timetable.",
      where: "Profile pages (UserNew.aspx)",
      settings: [
        {
          key: "quickPrint",
          type: "toggle",
          label: "Quick print",
          description:
            "Skip the preview and open the print dialogue straight away.",
          default: false
        },
        {
          key: "year12Only",
          type: "toggle",
          label: "Year 12 only",
          description:
            "Only show the clearance button on Year 12 student profiles.",
          default: true
        }
      ]
    },
    {
      key: "calendarPrinter",
      name: "Term Calendar Printer",
      version: "1.5",
      icon: "calendar",
      description:
        "Captures the whole-term calendar view and opens it as a printable page.",
      where: "Calendar page, Term view",
      custom: "calendar",
      settings: []
    },
    {
      key: "chronicleAnywhere",
      name: "Chronicle Anywhere",
      version: "1.0",
      icon: "note",
      defaultEnabled: false,
      description:
        "Create a chronicle entry from any page, without navigating away.",
      where: "All Compass pages",
      settings: [
        {
          key: "position",
          type: "select",
          label: "Button position",
          description:
            "Which corner the New Chronicle button starts from. It slides along to sit beside anything already there, like the Compass help bubble.",
          options: [
            { value: "bottomLeft", label: "Bottom left" },
            { value: "bottomRight", label: "Bottom right" },
            { value: "topRight", label: "Top right" }
          ],
          default: "bottomLeft"
        },
        {
          key: "hideNavigation",
          type: "toggle",
          label: "Show just the form",
          description:
            "Hide the Chronicle page behind the entry form in the pop-up. Turn off if the form looks wrong.",
          default: true
        },
        {
          key: "closeOnSave",
          type: "toggle",
          label: "Close when finished",
          description:
            "Close the pop-up automatically once the entry is saved or cancelled.",
          default: true
        }
      ]
    },
    {
      key: "directoryFilter",
      name: "Clean Staff Directory",
      version: "1.0",
      icon: "filter",
      description:
        "Hides system and support accounts from the staff directory.",
      where: "Staff directory",
      settings: [
        {
          key: "filters",
          type: "list",
          label: "Hide names containing",
          description:
            "Any staff card whose name contains one of these phrases is hidden.",
          placeholder: "e.g. (STIMS)",
          default: DEFAULT_DIRECTORY_FILTERS
        }
      ]
    },
    {
      key: "noNewTabs",
      name: "No New Tabs",
      version: "1.2",
      icon: "link",
      description:
        "Stops Compass opening a new tab every time you click something.",
      where: "All Compass pages",
      settings: [
        {
          key: "keepFavourites",
          type: "toggle",
          label: "Keep School Favourites in new tabs",
          description:
            "Links under the School Favourites menu (and Outlook) still open in a new tab.",
          default: true
        },
        {
          key: "postLinksNewTab",
          type: "toggle",
          label: "Open links inside posts in a new tab",
          description:
            "Links in news feed posts and rich text open in a new tab so you don't lose your place.",
          default: true
        }
      ]
    },
    {
      key: "hideSupportButton",
      name: "Hide Support Button",
      version: "1.0",
      icon: "messageOff",
      defaultEnabled: false,
      description:
        "Hides the Compass help and support bubble in the bottom-left corner.",
      where: "All Compass pages",
      settings: []
    },
    {
      key: "attendanceNotes",
      name: "Quick Attendance Notes",
      version: "1.0.0",
      icon: "checkSquare",
      description:
        "Clicking the “Attendance Notes require review” alert opens the Notes tab directly.",
      where: "Home page alert → Attendance",
      settings: []
    }
  ];

  const FEATURE_BY_KEY = {};
  FEATURES.forEach(function (f) {
    FEATURE_BY_KEY[f.key] = f;
  });

  function defaults() {
    const out = {};
    FEATURES.forEach(function (feature) {
      // Features are on unless they opt out with defaultEnabled: false.
      const entry = { enabled: feature.defaultEnabled !== false };
      feature.settings.forEach(function (setting) {
        entry[setting.key] = Array.isArray(setting.default)
          ? setting.default.slice()
          : setting.default;
      });
      out[feature.key] = entry;
    });
    return out;
  }

  /* Stored settings are merged over the defaults so a feature or sub-setting
   * added in a later version appears without needing a migration. */
  function withDefaults(stored) {
    const base = defaults();
    if (!stored || typeof stored !== "object") return base;

    Object.keys(base).forEach(function (featureKey) {
      const savedFeature = stored[featureKey];
      if (!savedFeature || typeof savedFeature !== "object") return;
      Object.keys(base[featureKey]).forEach(function (settingKey) {
        if (Object.prototype.hasOwnProperty.call(savedFeature, settingKey)) {
          base[featureKey][settingKey] = savedFeature[settingKey];
        }
      });
    });
    return base;
  }

  /* Chrome reports an unread `runtime.lastError` as an extension error, so
   * every storage callback has to read it even when there is nothing to do
   * about it (a sync write-rate limit, say). Returns true if one was set. */
  function consumeLastError(context) {
    const err = chrome.runtime.lastError;
    if (!err) return false;
    console.log("[Compass Toolkit] " + context + ": " + err.message);
    return true;
  }

  function getSettings() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.sync.get([SETTINGS_KEY], function (result) {
          if (consumeLastError("reading settings")) {
            resolve(defaults());
            return;
          }
          resolve(withDefaults(result[SETTINGS_KEY]));
        });
      } catch (e) {
        resolve(defaults());
      }
    });
  }

  function saveSettings(settings) {
    return new Promise(function (resolve) {
      const payload = {};
      payload[SETTINGS_KEY] = settings;
      chrome.storage.sync.set(payload, function () {
        consumeLastError("saving settings");
        resolve();
      });
    });
  }

  /* Calls `handler(featureSettings, allSettings)` once with the current values
   * and again whenever they change. Features use this to start, stop and
   * reconfigure themselves live, without a page reload. */
  function observeFeature(featureKey, handler) {
    let current = null;

    function deliver(settings) {
      const next = settings[featureKey] || {};
      if (current && JSON.stringify(current) === JSON.stringify(next)) return;
      current = next;
      try {
        handler(next, settings);
      } catch (e) {
        console.error("[Compass Toolkit] " + featureKey + " failed:", e);
      }
    }

    getSettings().then(deliver);

    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "sync" || !changes[SETTINGS_KEY]) return;
      deliver(withDefaults(changes[SETTINGS_KEY].newValue));
    });
  }

  /* Keys used for data captured off Compass pages (chrome.storage.local). */
  const DATA_KEYS = {
    periods: "capture.periodsData",
    events: "capture.eventsData",
    student: "capture.studentInfo",
    school: "capture.schoolInfo",
    calendar: "capture.calendar",
    terms: "capture.terms",
    layers: "capture.layers"
  };

  function getData(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(keys, function (result) {
        consumeLastError("reading captured data");
        resolve(result || {});
      });
    });
  }

  function setData(payload) {
    return new Promise(function (resolve) {
      chrome.storage.local.set(payload, function () {
        consumeLastError("storing captured data");
        resolve();
      });
    });
  }

  const isTopFrame = (function () {
    try {
      return window.top === window;
    } catch (e) {
      return false;
    }
  })();

  /* Runs `fn` once the document body exists — content scripts start at
   * document_start, before there is anything to touch. */
  function whenReady(fn) {
    if (document.body) {
      fn();
      return;
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        fn();
      });
      return;
    }
    fn();
  }

  return {
    SETTINGS_KEY: SETTINGS_KEY,
    FEATURES: FEATURES,
    FEATURE_BY_KEY: FEATURE_BY_KEY,
    DATA_KEYS: DATA_KEYS,
    defaults: defaults,
    withDefaults: withDefaults,
    getSettings: getSettings,
    saveSettings: saveSettings,
    observeFeature: observeFeature,
    getData: getData,
    setData: setData,
    isTopFrame: isTopFrame,
    whenReady: whenReady
  };
})();
