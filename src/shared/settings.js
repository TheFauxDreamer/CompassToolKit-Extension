/* Compass Toolkit: shared settings layer.
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
    "(STIMS)",
    "(STMS)"
  ];

  /* Pre-written wording, offered from a button inside the chronicle entry
   * form. `field` scopes a snippet to one field: blank means it is offered in
   * every field, which is how all of these ship, because the fields on a
   * chronicle entry are configured per school and nothing here can guess their
   * names. Square brackets mark the bits meant to be filled in. */
  const DEFAULT_CHRONICLE_SNIPPETS = [
    {
      id: "injury-minor",
      title: "Minor injury",
      field: "",
      text:
        "Minor injury to [body part], sustained during [activity].\n" +
        "First aid given by [staff member]. Student was comfortable and " +
        "returned to class.\nParent/guardian notified: [yes/no]."
    },
    {
      id: "injury-head",
      title: "Head knock",
      field: "",
      text:
        "Student received a knock to the head during [activity].\n" +
        "Checked by [staff member]; no symptoms of concern observed. Ice pack " +
        "applied and the student was monitored in [location].\n" +
        "Parent/guardian contacted and advised of the school's head injury " +
        "procedure."
    },
    {
      id: "sick-bay",
      title: "Sent to sick bay",
      field: "",
      text:
        "Student reported feeling unwell ([symptoms]) during [class] and was " +
        "sent to sick bay.\nOutcome: [rested and returned to class / " +
        "collected by parent/guardian]."
    },
    {
      id: "late-to-class",
      title: "Late to class",
      field: "",
      text:
        "Arrived [number] minutes late to [class] without a note or " +
        "explanation.\nPunctuality expectation restated. This is the " +
        "[first/second/further] instance this term."
    },
    {
      id: "out-of-uniform",
      title: "Out of uniform",
      field: "",
      text:
        "Out of uniform: [item]. No uniform pass presented.\n" +
        "Student was reminded of the uniform expectation and [action taken]."
    },
    {
      id: "mobile-phone",
      title: "Mobile phone",
      field: "",
      text:
        "Using a mobile phone during [class] after being asked to put it " +
        "away.\nPhone handed in and collected from [location] at the end of " +
        "[period/day]. Expectation restated."
    },
    {
      id: "positive",
      title: "Positive recognition",
      field: "",
      text:
        "Recognising consistent [effort/attitude/improvement] in [class]: " +
        "[what they did].\nShared with [parent/guardian / year coordinator]."
    },
    {
      id: "contacted-home",
      title: "Contacted home",
      field: "",
      text:
        "Phone call to [parent/guardian] regarding [reason].\n" +
        "Discussed: [summary]. Agreed next steps: [actions].\n" +
        "Call was [answered / left a message / no answer]."
    }
  ];

  /* The single source of truth: each feature, its sub-settings, and the
   * labels the popup renders. `default` on a sub-setting also defines the
   * value features fall back to when nothing is stored. */
  const FEATURES = [
    {
      key: "timetablePrinter",
      colour: { base: "#1976d2", strong: "#1565c0", soft: "#e8f1fc" },
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
      colour: { base: "#b45309", strong: "#8f4207", soft: "#fdf0e1" },
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
      colour: { base: "#2e7d32", strong: "#226325", soft: "#e8f4e9" },
      name: "Term Calendar Printer",
      version: "1.7",
      icon: "calendar",
      description:
        "Captures the whole-term calendar view and opens it as a printable page.",
      where: "Calendar page, Term view",
      custom: "calendar",
      settings: []
    },
    {
      key: "calendarView",
      colour: { base: "#5d4037", strong: "#46302a", soft: "#efe9e7" },
      name: "Preferred Calendar View",
      version: "1.2",
      icon: "layout",
      description:
        "Opens the calendar on the view you use, and starts its weeks on Monday.",
      where: "Calendar page",
      settings: [
        {
          key: "view",
          type: "select",
          label: "Open the calendar on",
          description:
            "Which view the calendar switches to as it loads. Changing view by hand afterwards is left alone.",
          options: [
            { value: "day", label: "Day" },
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
            { value: "multiweek", label: "Term" },
            { value: "list", label: "List" }
          ],
          default: "multiweek"
        },
        {
          key: "mondayStart",
          type: "toggle",
          label: "Start the week on Monday",
          description:
            "Lays the Month and Term views out Monday to Sunday. Compass starts those weeks on Sunday, even though it already starts the Week view on Monday.",
          default: true
        },
        {
          key: "hideWeekends",
          type: "toggle",
          label: "Hide weekends",
          description:
            "Leaves Saturday and Sunday out of the Month and Term views, so the five school days have the whole width.",
          default: false
        }
      ]
    },
    {
      key: "chronicleAnywhere",
      colour: { base: "#6a1b9a", strong: "#55137c", soft: "#f3e9f8" },
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
      key: "chronicleSnippets",
      colour: { base: "#ad1457", strong: "#8c1046", soft: "#fbe9f0" },
      name: "Chronicle Snippets",
      version: "1.0",
      icon: "fileText",
      description:
        "Pre-written wording, offered from a button inside the chronicle entry form.",
      where: "Chronicle entry form, wherever it opens",
      custom: "chronicleSnippets",
      settings: [
        {
          key: "placement",
          type: "select",
          label: "Button placement",
          description:
            "The button is put inside the field itself. If that breaks the chronicle layout, set it to float over the field instead.",
          options: [
            { value: "inline", label: "In the field" },
            { value: "float", label: "Floating" }
          ],
          default: "inline"
        },
        {
          key: "insertMode",
          type: "select",
          label: "Insert a snippet",
          description:
            "Where the text goes when the field already has something in it.",
          options: [
            { value: "cursor", label: "At the cursor" },
            { value: "append", label: "At the end" },
            { value: "replace", label: "Replace it" }
          ],
          default: "cursor"
        }
      ]
    },
    {
      key: "directoryFilter",
      colour: { base: "#00838f", strong: "#006670", soft: "#e0f2f4" },
      name: "Clean Staff Directory",
      version: "1.1",
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
        },
        {
          key: "showAll",
          type: "toggle",
          label: "Show everyone on one page",
          description:
            "Reads through the pages and puts the whole directory in one list. Hidden accounts still take up their place in Compass's count, so without this they push real staff onto a later page.",
          default: true
        }
      ]
    },
    {
      key: "staffCards",
      colour: { base: "#827717", strong: "#6b6113", soft: "#f4f2e2" },
      name: "Staff Card Printer",
      version: "1.0",
      icon: "idCard",
      description:
        "Builds a printable page of the staff cards themselves, photos and all.",
      where: "Staff directory",
      settings: [
        {
          key: "includePhotos",
          type: "toggle",
          label: "Include photos",
          description:
            "Leave photos out for a smaller, faster page that fits more people to a sheet.",
          default: true
        }
      ]
    },
    {
      key: "noNewTabs",
      colour: { base: "#c62828", strong: "#a11f1f", soft: "#fbeaea" },
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
      key: "menuDeclutter",
      colour: { base: "#00695c", strong: "#004d40", soft: "#e0efec" },
      name: "Menu Declutter",
      version: "1.0",
      icon: "menu",
      description:
        "Hides the paid-module adverts from the navigation menus, and any heading left empty by them.",
      where: "All Compass pages",
      custom: "menuItems",
      settings: [
        /* Phrased as showing rather than hiding, so every switch in this
         * panel means the same thing: on is on the menu. Both start off,
         * which is the decluttered state. */
        {
          key: "showAdverts",
          type: "toggle",
          label: "Show module adverts",
          description:
            "The entries Compass uses to advertise modules your school has not bought.",
          default: false
        },
        {
          key: "showEmptyHeadings",
          type: "toggle",
          label: "Show empty headings",
          description:
            "A subheading, or a whole menu, with nothing left under it once the rest is hidden.",
          default: false
        },
        {
          /* The menu entries chosen for hiding, each stored by its own link.
           * `data` is a value the feature keeps but the popup draws through a
           * panel of its own, since the choices are read off the open page
           * rather than typed in. */
          key: "hidden",
          type: "data",
          default: []
        }
      ]
    },
    {
      key: "hideSupportButton",
      colour: { base: "#455a64", strong: "#35464e", soft: "#eceff1" },
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
      colour: { base: "#4527a0", strong: "#371e80", soft: "#ebe8f7" },
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

  /* How the menu itself looks, kept beside the feature settings so it syncs
   * with them. It sits under its own key rather than in FEATURES because it
   * turns nothing on: no content script reads it, and it is not counted in the
   * "features on" summary. */
  const UI_KEY = "ui";
  const UI_DEFAULTS = {
    /* On out of the box. Nine rows in the one accent read as a single block,
     * which is what made the menu hard to tell apart in the first place. */
    colourCoded: true
  };

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
    out[UI_KEY] = Object.assign({}, UI_DEFAULTS);
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

  /* ---------------- chronicle snippets ---------------- */

  /* Snippets live under their own sync key rather than inside the settings
   * blob. chrome.storage.sync caps a single item at 8KB, and a snippet body is
   * far larger than anything else stored here: keeping them apart means a long
   * list can't push the rest of the settings over the limit, and a rejected
   * write can be reported on its own rather than failing silently. */
  const SNIPPETS_KEY = "chronicle.snippets";

  function defaultSnippets() {
    return DEFAULT_CHRONICLE_SNIPPETS.map(function (snippet) {
      return {
        id: snippet.id,
        title: snippet.title,
        field: snippet.field,
        text: snippet.text
      };
    });
  }

  /* Stored snippets are treated as untrusted, since they may have been written
   * by an older version or by a sync partner running one. Anything without both
   * a title and a body is dropped rather than shown as a blank row. */
  function cleanSnippets(list) {
    if (!Array.isArray(list)) return null;
    const out = [];
    list.forEach(function (item, index) {
      if (!item || typeof item !== "object") return;
      const title = String(item.title == null ? "" : item.title).trim();
      const text = String(item.text == null ? "" : item.text);
      if (!title || !text.trim()) return;
      out.push({
        id: String(item.id || "snippet-" + index),
        title: title,
        field: String(item.field == null ? "" : item.field).trim(),
        text: text
      });
    });
    return out;
  }

  /* v1.1.0 shipped these under "chronicle.templates", before the feature was
   * renamed away from wording Compass already uses. Anything written under the
   * old key is adopted once and the old key dropped, so a snippet edited on
   * that version is not silently replaced by the built-in set. Safe to delete
   * this, and the call below, once no install is on v1.1.0. */
  const LEGACY_SNIPPETS_KEY = "chronicle.templates";

  function adoptLegacySnippets() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.sync.get([LEGACY_SNIPPETS_KEY], function (result) {
          if (consumeLastError("reading the old snippets key")) {
            resolve(null);
            return;
          }
          const clean = cleanSnippets(result[LEGACY_SNIPPETS_KEY]);
          if (!clean) {
            resolve(null);
            return;
          }
          const payload = {};
          payload[SNIPPETS_KEY] = clean;
          chrome.storage.sync.set(payload, function () {
            consumeLastError("moving snippets to the new key");
            chrome.storage.sync.remove(LEGACY_SNIPPETS_KEY, function () {
              consumeLastError("dropping the old snippets key");
              resolve(clean);
            });
          });
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function getSnippets() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.sync.get([SNIPPETS_KEY], function (result) {
          if (consumeLastError("reading chronicle snippets")) {
            resolve(defaultSnippets());
            return;
          }
          /* Nothing stored means a first run, so the built-in snippets are
           * the answer. An empty list means every one was deleted on purpose,
           * which has to survive a reload. */
          const clean = cleanSnippets(result[SNIPPETS_KEY]);
          if (clean) {
            resolve(clean);
            return;
          }
          adoptLegacySnippets().then(function (moved) {
            resolve(moved || defaultSnippets());
          });
        });
      } catch (e) {
        resolve(defaultSnippets());
      }
    });
  }

  /* Resolves { ok, error } rather than throwing: the popup shows the message
   * so a list that has outgrown the sync quota doesn't fail invisibly. */
  function saveSnippets(list) {
    return new Promise(function (resolve) {
      const payload = {};
      payload[SNIPPETS_KEY] = cleanSnippets(list) || [];
      try {
        chrome.storage.sync.set(payload, function () {
          const err = chrome.runtime.lastError;
          if (err) {
            console.log(
              "[Compass Toolkit] saving chronicle snippets: " + err.message
            );
            resolve({ ok: false, error: err.message });
            return;
          }
          resolve({ ok: true });
        });
      } catch (e) {
        resolve({ ok: false, error: String((e && e.message) || e) });
      }
    });
  }

  /* The snippets equivalent of observeFeature. They are stored separately, so
   * changes to them arrive on their own key. */
  function observeSnippets(handler) {
    let current = null;

    function deliver(list) {
      if (current && JSON.stringify(current) === JSON.stringify(list)) return;
      current = list;
      try {
        handler(list);
      } catch (e) {
        console.error("[Compass Toolkit] chronicle snippets failed:", e);
      }
    }

    getSnippets().then(deliver);

    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "sync" || !changes[SNIPPETS_KEY]) return;
      // A removed key means the snippets were reset, not that there are none.
      deliver(
        cleanSnippets(changes[SNIPPETS_KEY].newValue) || defaultSnippets()
      );
    });
  }

  function newSnippetId() {
    return (
      "snippet-" +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 6)
    );
  }

  /* Keys used for data captured off Compass pages (chrome.storage.local). */
  const DATA_KEYS = {
    periods: "capture.periodsData",
    events: "capture.eventsData",
    student: "capture.studentInfo",
    school: "capture.schoolInfo",
    calendar: "capture.calendar",
    staff: "capture.staffCards",
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

  /* Runs `fn` once the document body exists. Content scripts start at
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
    UI_KEY: UI_KEY,
    DATA_KEYS: DATA_KEYS,
    defaults: defaults,
    withDefaults: withDefaults,
    getSettings: getSettings,
    saveSettings: saveSettings,
    observeFeature: observeFeature,
    SNIPPETS_KEY: SNIPPETS_KEY,
    defaultSnippets: defaultSnippets,
    getSnippets: getSnippets,
    saveSnippets: saveSnippets,
    observeSnippets: observeSnippets,
    newSnippetId: newSnippetId,
    getData: getData,
    setData: setData,
    isTopFrame: isTopFrame,
    whenReady: whenReady
  };
})();
