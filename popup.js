/* Compass Toolkit: popup menu.
 *
 * Renders one row per feature from the schema in settings.js: a switch to turn
 * it on or off, and, for features that have them, a panel of sub-settings that
 * is only reachable while the feature is enabled.
 */
(function () {
  "use strict";

  const CALENDAR_PAGE = "pages/calendar.html";

  let settings = null;
  let snippets = []; // chronicle snippets, stored under their own key
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
        const note = el("div", "empty-note", "No phrases, so nothing is hidden.");
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

  /* ---------------- chronicle snippets panel ---------------- */

  /* An editor for the saved snippets. The panel swaps between a list of what
   * is there and a form for one snippet, rather than editing in place: at
   * 380px wide there is no room to show both. */
  function buildSnippetsPanel() {
    const wrap = el("div", "sub-setting");
    wrap.appendChild(el("div", "sub-label", "Saved snippets"));
    wrap.appendChild(
      el(
        "div",
        "sub-desc",
        "Offered from a Snippets button inside the chronicle entry form. Give a snippet a field to show it only there; leave the field blank and it shows in every chronicle field."
      )
    );

    const body = el("div", "snippet-body");
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

    /* Sync rejects an item over 8KB, which a long enough list of snippets can
     * reach. Saying so beats one quietly vanishing on the next reload. */
    function explain(error) {
      if (/quota/i.test(error || "")) {
        return "There is too much text here for Chrome to sync. Shorten or delete a snippet and try again.";
      }
      return error || "Chrome refused the change.";
    }

    // The list is only replaced once the write succeeds, so what is on screen
    // always matches what is stored.
    function persist(next, onSaved) {
      const previous = snippets;
      snippets = next;
      CompassToolkit.saveSnippets(next).then(function (result) {
        if (!result.ok) {
          snippets = previous;
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
      const list = el("div", "snippet-list");

      if (!snippets.length) {
        list.appendChild(
          el(
            "div",
            "empty-note",
            "No snippets yet. The button appears once you add one."
          )
        );
      }

      snippets.forEach(function (snippet, index) {
        const row = el("div", "snippet");

        const head = el("div", "snippet-head");
        head.appendChild(el("span", "snippet-title", snippet.title));
        const scope = el(
          "span",
          "snippet-scope" + (snippet.field ? "" : " all"),
          snippet.field || "All fields"
        );
        scope.title = snippet.field
          ? 'Only fields whose label contains "' + snippet.field + '"'
          : "Offered in every chronicle field";
        head.appendChild(scope);

        const actions = el("div", "snippet-actions");
        const edit = actionButton("note", "Edit " + snippet.title);
        edit.addEventListener("click", function () {
          renderEditor(snippet);
        });

        const remove = actionButton("trash", "Delete " + snippet.title);
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
          const next = snippets.slice();
          next.splice(index, 1);
          persist(next);
        });

        actions.appendChild(edit);
        actions.appendChild(remove);
        head.appendChild(actions);

        row.appendChild(head);
        row.appendChild(el("div", "snippet-preview", snippet.text));
        list.appendChild(row);
      });

      body.appendChild(list);

      const add = iconButton("btn block", "plus", "Add a snippet");
      add.addEventListener("click", function () {
        renderEditor(null);
      });
      body.appendChild(add);

      // Offered only while something built-in is actually missing, and it adds
      // rather than replaces, so edited snippets are left alone.
      const missing = CompassToolkit.defaultSnippets().filter(function (snippet) {
        return !snippets.some(function (existing) {
          return existing.id === snippet.id;
        });
      });
      if (missing.length) {
        const restore = el(
          "button",
          "link-btn snippet-restore",
          "Add the " + missing.length + " missing built-in snippets"
        );
        restore.type = "button";
        restore.addEventListener("click", function () {
          persist(snippets.concat(missing));
        });
        body.appendChild(restore);
      }
    }

    function renderEditor(snippet) {
      body.innerHTML = "";
      setStatus(null);

      const form = el("div", "snippet-form");

      function labelled(text, control, hint) {
        form.appendChild(el("label", "field-label", text));
        form.appendChild(control);
        if (hint) form.appendChild(el("div", "sub-desc", hint));
      }

      const title = document.createElement("input");
      title.type = "text";
      title.placeholder = "e.g. Minor injury";
      title.value = snippet ? snippet.title : "";
      labelled("Name", title);

      const field = document.createElement("input");
      field.type = "text";
      field.placeholder = "Leave blank for every field";
      field.value = snippet ? snippet.field : "";
      labelled(
        "Chronicle field",
        field,
        "Matched against the field's label in the entry form. Part of the label is enough."
      );

      const text = document.createElement("textarea");
      text.rows = 6;
      text.placeholder = "The text to insert…";
      text.value = snippet ? snippet.text : "";
      labelled("Snippet", text);

      const buttons = el("div", "row-btns");
      const save = el("button", "btn", snippet ? "Save changes" : "Add snippet");
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
          setStatus("A snippet needs a name and some text.", "error");
          return;
        }

        const next = snippets.slice();
        if (snippet) {
          const index = next.findIndex(function (item) {
            return item.id === snippet.id;
          });
          if (index !== -1) {
            next[index] = {
              id: snippet.id,
              title: values.title,
              field: values.field,
              text: values.text
            };
          }
        } else {
          next.push({
            id: CompassToolkit.newSnippetId(),
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

    // The same two buttons are on the calendar page now. Worth saying here,
    // because this menu is where people found them first.
    wrap.appendChild(
      el(
        "div",
        "panel-note",
        "These are also on the calendar page itself, behind the Print Calendar button."
      )
    );

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

  /* ---------------- menu entries panel ---------------- */

  /* The entries are read off whichever Compass page is open rather than typed
   * in, so what is offered is what that person actually has. A switch that is
   * on is an entry that shows. */
  function buildMenuPanel(feature) {
    const wrap = el("div", "sub-setting");
    wrap.appendChild(el("div", "sub-label", "Menu entries"));
    wrap.appendChild(
      el(
        "div",
        "sub-desc",
        "Read from the Compass page you have open. Switch off anything you would rather not see."
      )
    );

    const list = el("div", "menu-list");
    const status = el("div", "status");
    wrap.appendChild(list);
    wrap.appendChild(status);

    function setStatus(message, kind, iconName) {
      status.className = "status" + (kind ? " " + kind : "");
      status.hidden = !message;
      status.innerHTML = "";
      if (!message) return;
      if (iconName) status.appendChild(CompassToolkitIcons.create(iconName, 13));
      status.appendChild(el("span", null, message));
    }

    function hidden() {
      const stored = settings[feature.key].hidden;
      return Array.isArray(stored) ? stored : [];
    }

    function setShown(key, shown) {
      const next = hidden().filter(function (item) {
        return item !== key;
      });
      if (!shown) next.push(key);
      settings[feature.key].hidden = next;
      save();
    }

    function row(className, label, key) {
      const line = el("div", className);
      const text = el("span", null, label);
      text.title = label;
      line.appendChild(text);

      const toggle = el("label", "switch small");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = hidden().indexOf(key) === -1;
      input.setAttribute("aria-label", "Show " + label);
      input.addEventListener("change", function () {
        setShown(key, input.checked);
      });
      toggle.appendChild(input);
      toggle.appendChild(el("span", "slider"));
      line.appendChild(toggle);
      return line;
    }

    function render(groups) {
      list.innerHTML = "";
      groups.forEach(function (group) {
        const box = el("div", "menu-group");
        // A whole menu can go, as well as anything inside it.
        box.appendChild(
          group.key
            ? row("menu-group-name", group.name, group.key)
            : el("div", "menu-group-name", group.name)
        );
        group.items.forEach(function (item) {
          box.appendChild(row("menu-item", item.label, item.key));
        });
        list.appendChild(box);
      });
    }

    /* A menu Compass is still filling in reports itself as loading. Asking
     * again shortly is the difference between offering the whole menu and
     * offering however much of it had arrived. */
    const RETRY_MS = 700;
    const RETRIES = 3;

    function load(attempt) {
      const tries = attempt || 0;
      if (!tries) setStatus("Reading the menus from the open tab…");

      getActiveTab().then(function (tab) {
        const url = (tab && tab.url) || "";
        if (!url.includes("compass.education")) {
          setStatus("Open a Compass page to choose what to hide.", null, "alert");
          return;
        }
        sendToTab(tab.id, { type: "CT_MENU_ITEMS" }).then(function (response) {
          if (!response) {
            setStatus("Refresh the Compass page, then reopen this.", null, "alert");
            return;
          }

          if (response.loading && tries < RETRIES) {
            setStatus("Waiting for the menus to finish loading…");
            setTimeout(function () {
              load(tries + 1);
            }, RETRY_MS);
            return;
          }

          const groups = response.groups || [];
          if (!groups.length) {
            setStatus("No menus found on that page.", null, "alert");
            return;
          }
          render(groups);
          const count = groups.reduce(function (total, group) {
            return total + group.items.length;
          }, 0);
          setStatus(
            count + " entries across " + groups.length + " menus" +
              // Said plainly rather than quietly showing a short list.
              (response.loading ? ", and one is still loading" : "")
          );
        });
      });
    }

    load();
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

    if (feature.custom === "chronicleSnippets") {
      panel.appendChild(buildSnippetsPanel());
    }

    if (feature.custom === "menuItems") {
      panel.appendChild(buildMenuPanel(feature));
    }

    return panel;
  }

  function buildFeature(feature) {
    const section = el("section", "feature");
    section.dataset.key = feature.key;
    /* The row carries its own colours and the stylesheet decides whether to
     * use them, so switching the coding on and off is a class on the body
     * rather than a re-render. */
    section.style.setProperty("--feature-colour", feature.colour.base);
    section.style.setProperty("--feature-colour-strong", feature.colour.strong);
    section.style.setProperty("--feature-colour-soft", feature.colour.soft);

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
    applyColourCoding();
  }

  /* ---------------- colour coding ---------------- */

  const colourToggle = document.getElementById("colourToggle");

  function applyColourCoding() {
    const on = !!settings[CompassToolkit.UI_KEY].colourCoded;
    colourToggle.checked = on;
    document.body.classList.toggle("colour-coded", on);
  }

  colourToggle.addEventListener("change", function () {
    // The switch is live before the stored settings have arrived.
    if (!settings) {
      colourToggle.checked = !colourToggle.checked;
      return;
    }
    settings[CompassToolkit.UI_KEY].colourCoded = colourToggle.checked;
    applyColourCoding();
    save();
  });

  /* ---------------- boot ---------------- */

  // Two-step rather than a confirm() dialogue, because resetting throws away
  // any directory filter phrases the user has added.
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
    snippets = CompassToolkit.defaultSnippets();
    Promise.all([save(), CompassToolkit.saveSnippets(snippets)]).then(render);
  });

  const manifest = chrome.runtime.getManifest();
  document.getElementById("version").textContent = "v" + manifest.version;

  Promise.all([
    CompassToolkit.getSettings(),
    CompassToolkit.getSnippets()
  ]).then(function (loaded) {
    settings = loaded[0];
    snippets = loaded[1];
    render();
  });
})();
