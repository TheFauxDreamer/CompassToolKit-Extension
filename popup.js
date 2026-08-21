/* Compass Toolkit — popup menu.
 *
 * Renders one row per feature from the schema in settings.js: a switch to turn
 * it on or off, and, for features that have them, a panel of sub-settings that
 * is only reachable while the feature is enabled.
 */
(function () {
  "use strict";

  const CALENDAR_PAGE = "pages/calendar.html";

  let settings = null;
  let templates = []; // chronicle notes — stored under their own key
  const listEl = document.getElementById("features");
  const summaryEl = document.getElementById("summary");

  /* ---------------- helpers ---------------- */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* A span wrapping an inline SVG, so icons can be styled as a unit. */
  function icon(name, className, size) {
    const wrap = el("span", className || "icon");
    wrap.appendChild(CompassToolkitIcons.create(name, size));
    return wrap;
  }

  /* Buttons are icon + label; the label is a span so the gap stays even. */
  function iconButton(className, iconName, label) {
    const button = el("button", className);
    button.type = "button";
    button.appendChild(CompassToolkitIcons.create(iconName, 15));
    button.appendChild(el("span", null, label));
    return button;
  }

  function setButtonLabel(button, iconName, label) {
    button.innerHTML = "";
    button.appendChild(CompassToolkitIcons.create(iconName, 15));
    button.appendChild(el("span", null, label));
  }

  function save() {
    return CompassToolkit.saveSettings(settings);
  }

  function hasPanel(feature) {
    return feature.settings.length > 0 || !!feature.custom;
  }

  function updateSummary() {
    const total = CompassToolkit.FEATURES.length;
    const on = CompassToolkit.FEATURES.filter(function (f) {
      return settings[f.key].enabled;
    }).length;
    summaryEl.textContent =
      on === total
        ? "All " + total + " features on"
        : on + " of " + total + " features on";
  }

  function getActiveTab() {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        resolve(tabs && tabs[0] ? tabs[0] : null);
      });
    });
  }

  function sendToTab(tabId, message) {
    return new Promise(function (resolve) {
      chrome.tabs.sendMessage(tabId, message, function (response) {
        if (chrome.runtime.lastError) {
          resolve(null); // no content script in that tab yet
          return;
        }
        resolve(response);
      });
    });
  }

  /* ---------------- sub-setting controls ---------------- */

  function buildToggleSetting(feature, setting) {
    const wrap = el("div", "sub-setting");
    const row = el("div", "sub-row");

    const text = el("div", "sub-text");
    text.appendChild(el("div", "sub-label", setting.label));
    if (setting.description) {
      text.appendChild(el("div", "sub-desc", setting.description));
    }

    const label = el("label", "switch small");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!settings[feature.key][setting.key];
    input.addEventListener("change", function () {
      settings[feature.key][setting.key] = input.checked;
      save();
    });
    label.appendChild(input);
    label.appendChild(el("span", "slider"));

    row.appendChild(text);
    row.appendChild(label);
    wrap.appendChild(row);
    return wrap;
  }

  function buildSelectSetting(feature, setting) {
    const wrap = el("div", "sub-setting");
    const row = el("div", "sub-row");

    const text = el("div", "sub-text");
    text.appendChild(el("div", "sub-label", setting.label));
    if (setting.description) {
      text.appendChild(el("div", "sub-desc", setting.description));
    }

    const select = document.createElement("select");
    select.className = "sub-select";
    select.setAttribute("aria-label", setting.label);
    (setting.options || []).forEach(function (option) {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      select.appendChild(node);
    });
    select.value = settings[feature.key][setting.key];
    select.addEventListener("change", function () {
      settings[feature.key][setting.key] = select.value;
      save();
    });

    row.appendChild(text);
    row.appendChild(select);
    wrap.appendChild(row);
    return wrap;
  }

  function buildListSetting(feature, setting) {
    const wrap = el("div", "sub-setting");
    wrap.appendChild(el("div", "sub-label", setting.label));
    if (setting.description) {
      wrap.appendChild(el("div", "sub-desc", setting.description));
    }

    const chips = el("div", "chip-list");
    wrap.appendChild(chips);

    function values() {
      const stored = settings[feature.key][setting.key];
      return Array.isArray(stored) ? stored : [];
    }

    function renderChips() {
      chips.innerHTML = "";
      const items = values();

      if (items.length === 0) {
        const note = el("div", "empty-note", "No phrases — nothing is hidden.");
        chips.appendChild(note);
        return;
      }

      items.forEach(function (phrase, index) {
        const chip = el("span", "chip");
        const label = el("span", null, phrase);
        label.title = phrase;

        const remove = el("button");
        remove.type = "button";
        remove.title = "Remove";
        remove.setAttribute("aria-label", "Remove " + phrase);
        remove.appendChild(CompassToolkitIcons.create("close", 11));
        remove.addEventListener("click", function () {
          const next = values().slice();
          next.splice(index, 1);
          settings[feature.key][setting.key] = next;
          save().then(renderChips);
        });

        chip.appendChild(label);
        chip.appendChild(remove);
        chips.appendChild(chip);
      });
    }

    const addRow = el("div", "add-row");
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = setting.placeholder || "Add a phrase";

    const addBtn = el("button", "btn", "Add");
    addBtn.type = "button";

    function add() {
      const value = input.value.trim();
      if (!value) return;
      const items = values();
      const duplicate = items.some(function (item) {
        return item.toLowerCase() === value.toLowerCase();
      });
      if (duplicate) {
        input.value = "";
        return;
      }
      settings[feature.key][setting.key] = items.concat([value]);
      input.value = "";
      save().then(renderChips);
    }

    addBtn.addEventListener("click", add);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") add();
    });

    addRow.appendChild(input);
    addRow.appendChild(addBtn);
    wrap.appendChild(addRow);

    renderChips();
    return wrap;
  }

  /* ---------------- chronicle notes panel ---------------- */

  /* An editor for the pre-written notes. The panel swaps between a list of
   * what's there and a form for one note, rather than editing in place: at
   * 380px wide there is no room to show both. */
  function buildTemplatesPanel() {
    const wrap = el("div", "sub-setting");
    wrap.appendChild(el("div", "sub-label", "Pre-written notes"));
    wrap.appendChild(
      el(
        "div",
        "sub-desc",
        "Offered from a Notes button inside the chronicle entry form. Give a note a field to show it only there; leave the field blank and it shows in every chronicle field."
      )
    );

    const body = el("div", "note-body");
    const status = el("div", "status");
    status.hidden = true;
    wrap.appendChild(body);
    wrap.appendChild(status);

    function setStatus(message, kind) {
      status.hidden = !message;
      if (!message) return;
      status.className = "status" + (kind ? " " + kind : "");
      status.innerHTML = "";
      status.appendChild(
        CompassToolkitIcons.create(kind === "error" ? "alert" : "check", 13)
      );
      status.appendChild(el("span", null, message));
    }

    /* Sync rejects an item over 8KB, which a long enough list of notes can
     * reach. Saying so beats a note quietly vanishing on the next reload. */
    function explain(error) {
      if (/quota/i.test(error || "")) {
        return "There is too much text here for Chrome to sync. Shorten or delete a note and try again.";
      }
      return error || "Chrome refused the change.";
    }

    // The list is only replaced once the write succeeds, so what is on screen
    // always matches what is stored.
    function persist(next, onSaved) {
      const previous = templates;
      templates = next;
      CompassToolkit.saveTemplates(next).then(function (result) {
        if (!result.ok) {
          templates = previous;
          renderList();
          setStatus("Not saved. " + explain(result.error), "error");
          return;
        }
        setStatus(null);
        if (onSaved) onSaved();
        else renderList();
      });
    }

    function actionButton(iconName, label) {
      const button = el("button", "icon-btn");
      button.type = "button";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.appendChild(CompassToolkitIcons.create(iconName, 13));
      return button;
    }

    function renderList() {
      body.innerHTML = "";
      const list = el("div", "note-list");

      if (!templates.length) {
        list.appendChild(
          el(
            "div",
            "empty-note",
            "No notes — the button won't appear until you add one."
          )
        );
      }

      templates.forEach(function (note, index) {
        const row = el("div", "note");

        const head = el("div", "note-head");
        head.appendChild(el("span", "note-title", note.title));
        const scope = el(
          "span",
          "note-scope" + (note.field ? "" : " all"),
          note.field || "All fields"
        );
        scope.title = note.field
          ? 'Only fields whose label contains "' + note.field + '"'
          : "Offered in every chronicle field";
        head.appendChild(scope);

        const actions = el("div", "note-actions");
        const edit = actionButton("note", "Edit " + note.title);
        edit.addEventListener("click", function () {
          renderEditor(note);
        });

        const remove = actionButton("trash", "Delete " + note.title);
        let armed = null;
        remove.addEventListener("click", function () {
          // Two-step, like resetting: there is no undo once it is gone.
          if (!armed) {
            remove.classList.add("armed");
            remove.appendChild(el("span", null, "Delete?"));
            armed = setTimeout(function () {
              armed = null;
              remove.classList.remove("armed");
              remove.innerHTML = "";
              remove.appendChild(CompassToolkitIcons.create("trash", 13));
            }, 4000);
            return;
          }
          clearTimeout(armed);
          const next = templates.slice();
          next.splice(index, 1);
          persist(next);
        });

        actions.appendChild(edit);
        actions.appendChild(remove);
        head.appendChild(actions);

        row.appendChild(head);
        row.appendChild(el("div", "note-preview", note.text));
        list.appendChild(row);
      });

      body.appendChild(list);

      const add = iconButton("btn block", "plus", "Add a note");
      add.addEventListener("click", function () {
        renderEditor(null);
      });
      body.appendChild(add);

      // Offered only while something built-in is actually missing, and it adds
      // rather than replaces, so edited notes are left alone.
      const missing = CompassToolkit.defaultTemplates().filter(function (note) {
        return !templates.some(function (existing) {
          return existing.id === note.id;
        });
      });
      if (missing.length) {
        const restore = el(
          "button",
          "link-btn note-restore",
          "Add the " + missing.length + " missing built-in notes"
        );
        restore.type = "button";
        restore.addEventListener("click", function () {
          persist(templates.concat(missing));
        });
        body.appendChild(restore);
      }
    }

    function renderEditor(note) {
      body.innerHTML = "";
      setStatus(null);

      const form = el("div", "note-form");

      function labelled(text, control, hint) {
        form.appendChild(el("label", "field-label", text));
        form.appendChild(control);
        if (hint) form.appendChild(el("div", "sub-desc", hint));
      }

      const title = document.createElement("input");
      title.type = "text";
      title.placeholder = "e.g. Minor injury";
      title.value = note ? note.title : "";
      labelled("Name", title);

      const field = document.createElement("input");
      field.type = "text";
      field.placeholder = "Leave blank for every field";
      field.value = note ? note.field : "";
      labelled(
        "Chronicle field",
        field,
        "Matched against the field's label in the entry form — part of the label is enough."
      );

      const text = document.createElement("textarea");
      text.rows = 6;
      text.placeholder = "The note to insert…";
      text.value = note ? note.text : "";
      labelled("Note", text);

      const buttons = el("div", "row-btns");
      const save = el("button", "btn", note ? "Save changes" : "Add note");
      save.type = "button";
      const cancel = el("button", "btn secondary", "Cancel");
      cancel.type = "button";

      save.addEventListener("click", function () {
        const values = {
          title: title.value.trim(),
          field: field.value.trim(),
          text: text.value
        };
        if (!values.title || !values.text.trim()) {
          setStatus("A note needs a name and some text.", "error");
          return;
        }

        const next = templates.slice();
        if (note) {
          const index = next.findIndex(function (item) {
            return item.id === note.id;
          });
          if (index !== -1) {
            next[index] = {
              id: note.id,
              title: values.title,
              field: values.field,
              text: values.text
            };
          }
        } else {
          next.push({
            id: CompassToolkit.newTemplateId(),
            title: values.title,
            field: values.field,
            text: values.text
          });
        }
        persist(next);
      });

      cancel.addEventListener("click", renderList);

      buttons.appendChild(save);
      buttons.appendChild(cancel);
      form.appendChild(buttons);
      body.appendChild(form);
      title.focus();
    }

    renderList();
    return wrap;
  }

  /* ---------------- calendar panel ---------------- */

  function buildCalendarPanel() {
    const wrap = el("div", "sub-setting");

    const steps = document.createElement("ol");
    steps.className = "steps";
    [
      "Open your Compass calendar page.",
      "Switch to Term view (not Day, Week or Month).",
      "Wait for the calendar to finish loading.",
      "Capture, then open the printable calendar."
    ].forEach(function (step) {
      steps.appendChild(el("li", null, step));
    });
    wrap.appendChild(steps);

    const captureBtn = iconButton("btn block", "download", "Capture calendar data");
    const openBtn = iconButton(
      "btn secondary block",
      "printer",
      "Open printable calendar"
    );
    openBtn.disabled = true;

    // Two separate lines: what is stored, and what the current tab needs
    // before it can be captured. They change independently.
    const status = el("div", "status", "Checking…");
    const hint = el("div", "status");
    hint.hidden = true;
    const capturedAt = el("div", "captured-at");

    function setStatus(message, kind, iconName) {
      status.className = "status" + (kind ? " " + kind : "");
      status.innerHTML = "";
      if (iconName) {
        status.appendChild(CompassToolkitIcons.create(iconName, 13));
      }
      status.appendChild(el("span", null, message));
    }

    function setHint(message) {
      hint.hidden = !message;
      if (!message) return;
      hint.innerHTML = "";
      hint.appendChild(CompassToolkitIcons.create("alert", 13));
      hint.appendChild(el("span", null, message));
    }

    function refreshStored() {
      const keys = CompassToolkit.DATA_KEYS;
      return CompassToolkit.getData([
        keys.calendar,
        keys.terms,
        keys.layers
      ]).then(function (data) {
        const calendar = data[keys.calendar];
        const events = calendar && calendar.events ? calendar.events.length : 0;

        if (events === 0) {
          openBtn.disabled = true;
          capturedAt.textContent = "";
          return false;
        }

        const terms = data[keys.terms];
        const layers = data[keys.layers];
        const parts = [events + " events"];
        if (terms && terms.terms) parts.push(terms.terms.length + " terms");
        if (layers && layers.layers) parts.push(layers.layers.length + " layers");

        openBtn.disabled = false;
        setStatus("Captured " + parts.join(", "), "success", "check");
        capturedAt.textContent =
          "Last captured: " + new Date(calendar.timestamp).toLocaleString();
        return true;
      });
    }

    // Tell the user what is missing before they click, not after.
    function checkPage() {
      return getActiveTab().then(function (tab) {
        const url = (tab && tab.url) || "";
        if (!url.includes("compass.education")) {
          return { ready: false, message: "Open a Compass tab to capture." };
        }
        if (!url.includes("/Organise/Calendar")) {
          return { ready: false, message: "Open the Compass calendar page to capture." };
        }
        return sendToTab(tab.id, { type: "CT_CHECK_VIEW" }).then(function (res) {
          if (!res) {
            return {
              ready: false,
              message: "Refresh the calendar page, then capture."
            };
          }
          if (!res.isTermView) {
            return { ready: false, message: "Switch the calendar to Term view." };
          }
          return { ready: true, tabId: tab.id };
        });
      });
    }

    function refresh() {
      refreshStored().then(function (hasData) {
        if (!hasData) setStatus("Nothing captured yet.");
        return checkPage().then(function (page) {
          captureBtn.disabled = !page.ready;
          setHint(page.ready ? null : page.message);
        });
      });
    }

    captureBtn.addEventListener("click", function () {
      captureBtn.disabled = true;
      setButtonLabel(captureBtn, "hourglass", "Capturing…");
      setStatus("Asking the page for its calendar data…");

      checkPage()
        .then(function (page) {
          if (!page.ready) {
            setHint(page.message);
            return null;
          }
          setHint(null);
          return sendToTab(page.tabId, { type: "CT_CAPTURE_CALENDAR" });
        })
        .then(function (response) {
          if (response === null) return;

          if (!response || !response.success) {
            setStatus(
              (response && response.error) || "Capture failed. Try refreshing the page.",
              "error"
            );
            return;
          }
          if (response.eventCount === 0) {
            setStatus(
              "No events found. Let the calendar finish loading and try again.",
              "error"
            );
            return;
          }
          refreshStored();
        })
        .then(function () {
          setButtonLabel(captureBtn, "download", "Capture calendar data");
          captureBtn.disabled = false;
        });
    });

    openBtn.addEventListener("click", function () {
      chrome.tabs.create({ url: chrome.runtime.getURL(CALENDAR_PAGE) });
    });

    wrap.appendChild(captureBtn);
    wrap.appendChild(openBtn);
    wrap.appendChild(status);
    wrap.appendChild(capturedAt);
    wrap.appendChild(hint);

    refresh();
    return wrap;
  }

  /* ---------------- rows ---------------- */

  function buildPanel(feature) {
    const panel = el("div", "feature-panel");
    panel.id = "panel-" + feature.key;
    panel.hidden = true;

    if (feature.where) {
      panel.appendChild(el("div", "panel-where", feature.where));
    }

    feature.settings.forEach(function (setting) {
      if (setting.type === "toggle") {
        panel.appendChild(buildToggleSetting(feature, setting));
      } else if (setting.type === "select") {
        panel.appendChild(buildSelectSetting(feature, setting));
      } else if (setting.type === "list") {
        panel.appendChild(buildListSetting(feature, setting));
      }
    });

    if (feature.custom === "calendar") {
      panel.appendChild(buildCalendarPanel());
    }

    if (feature.custom === "chronicleTemplates") {
      panel.appendChild(buildTemplatesPanel());
    }

    return panel;
  }

  function buildFeature(feature) {
    const section = el("section", "feature");
    section.dataset.key = feature.key;

    const head = el("div", "feature-head");
    const expandable = hasPanel(feature);
    const main = el(expandable ? "button" : "div", "feature-main");
    if (expandable) main.type = "button";

    main.appendChild(icon(feature.icon, "feature-icon", 16));

    const text = el("span", "feature-text");
    const name = el("span", "feature-name");
    name.appendChild(el("span", null, feature.name));
    // Each feature keeps the version of the extension it came from, so a
    // bumped one is visible at a glance without opening anything.
    const version = el("span", "feature-version", "v" + feature.version);
    version.title = feature.name + " version " + feature.version;
    name.appendChild(version);
    if (expandable) name.appendChild(icon("chevronRight", "chevron", 12));
    text.appendChild(name);
    text.appendChild(el("span", "feature-desc", feature.description));
    main.appendChild(text);

    const switchLabel = el("label", "switch");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!settings[feature.key].enabled;
    input.setAttribute("aria-label", "Enable " + feature.name);
    switchLabel.appendChild(input);
    switchLabel.appendChild(el("span", "slider"));

    head.appendChild(main);
    head.appendChild(switchLabel);
    section.appendChild(head);

    const panel = expandable ? buildPanel(feature) : null;
    if (panel) section.appendChild(panel);

    function setExpanded(expanded) {
      if (!panel) return;
      panel.hidden = !expanded;
      section.classList.toggle("expanded", expanded);
      main.setAttribute("aria-expanded", String(expanded));
    }

    if (expandable) {
      main.setAttribute("aria-controls", panel.id);
      setExpanded(false);
      main.addEventListener("click", function () {
        setExpanded(panel.hidden);
      });
    }

    input.addEventListener("change", function () {
      settings[feature.key].enabled = input.checked;
      section.dataset.enabled = String(input.checked);
      // Opening the panel on enable surfaces the options straight away;
      // closing it on disable puts them out of reach, since they no longer
      // apply to anything.
      setExpanded(input.checked && expandable);
      if (expandable) main.disabled = !input.checked;
      updateSummary();
      save();
    });

    section.dataset.enabled = String(input.checked);
    if (expandable) main.disabled = !input.checked;
    return section;
  }

  function render() {
    listEl.innerHTML = "";
    CompassToolkit.FEATURES.forEach(function (feature) {
      listEl.appendChild(buildFeature(feature));
    });
    updateSummary();
  }

  /* ---------------- boot ---------------- */

  // Two-step rather than a confirm() dialogue — resetting throws away any
  // directory filter phrases the user has added.
  const resetBtn = document.getElementById("resetBtn");
  let resetArmed = false;
  let resetTimer = null;

  resetBtn.addEventListener("click", function () {
    if (!resetArmed) {
      resetArmed = true;
      resetBtn.textContent = "Click again to confirm";
      resetTimer = setTimeout(function () {
        resetArmed = false;
        resetBtn.textContent = "Reset to defaults";
      }, 4000);
      return;
    }

    clearTimeout(resetTimer);
    resetArmed = false;
    resetBtn.textContent = "Reset to defaults";
    settings = CompassToolkit.defaults();
    templates = CompassToolkit.defaultTemplates();
    Promise.all([save(), CompassToolkit.saveTemplates(templates)]).then(render);
  });

  const manifest = chrome.runtime.getManifest();
  document.getElementById("version").textContent = "v" + manifest.version;

  Promise.all([
    CompassToolkit.getSettings(),
    CompassToolkit.getTemplates()
  ]).then(function (loaded) {
    settings = loaded[0];
    templates = loaded[1];
    render();
  });
})();
