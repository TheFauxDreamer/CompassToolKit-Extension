import { getSettings, getOverrides, setOverride, AUDIENCE_LABELS } from "./newsfeed/settings.js";
import { CompassClient, NotSignedInError, matchesAudience } from "./newsfeed/compass.js";
import { sanitizeHtml } from "./newsfeed/sanitize.js";

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const progress = $("progress");
const settingsModal = $("settingsModal");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  settings: null,
  client: null,
  allItems: [],        // everything fetched
  audiences: new Map(),
  overrides: {},
  slides: [],          // filtered items for the current view
  index: 0,
  paused: false,
  elapsed: 0,
  duration: 15000,
  lastTick: 0,
  sheet: null,
  scroll: null,
  imageTimer: null,
  refreshTimer: null,
  retryTimer: null,
  blobCache: new Map(), // url -> objectURL
  showToken: 0
};

// ---------------------------------------------------------------- start up

init();

async function init() {
  state.settings = await getSettings();
  if (!state.settings.enabled) { showOff(); return; }
  const params = new URLSearchParams(location.search);
  const aud = params.get("audience");
  if (aud && AUDIENCE_LABELS[aud]) state.settings.audience = aud;
  state.client = new CompassClient(state.settings.schoolUrl);
  bindControls();
  bindSettingsModal();
  startClock();
  updateAudienceUi();
  await load({ first: true });
  requestAnimationFrame(tick);
}

async function load({ first = false } = {}) {
  clearTimeout(state.refreshTimer);
  clearTimeout(state.retryTimer);
  if (first) showStatus("Loading school news…", "");
  try {
    const s = state.settings;
    const items = await state.client.getFeed({ maxItems: s.maxItems, maxAgeDays: s.maxAgeDays });
    const yearLevels = s.yearLevel !== "any" ? [Number(s.yearLevel)] : [];
    // Audience lookups are only needed when filtering, but doing them always keeps the dots accurate.
    state.audiences = await state.client.getAudiences(items, { yearLevels });
    state.overrides = await getOverrides();
    state.allItems = sortItems(items, s.priorityFirst);
    applyFilter({ keepCurrent: !first });
    state.refreshTimer = setTimeout(() => load(), Math.max(1, s.refreshMinutes) * 60000);
  } catch (e) {
    console.error(e);
    if (e instanceof NotSignedInError) {
      showStatus(
        "Sign in to Compass to show the news",
        `Open ${new URL(state.settings.schoolUrl).hostname} in another tab and sign in. This screen checks again every 20 seconds.`,
        [{ label: "Open Compass", onClick: () => chrome.windows.create({ url: state.settings.schoolUrl }) },
         { label: "Try again", secondary: true, onClick: () => load({ first: true }) }]
      );
    } else {
      // Keep showing what we already have if a background refresh fails.
      if (state.slides.length && !first) {
        state.refreshTimer = setTimeout(() => load(), 60000);
        return;
      }
      showStatus("The news couldn't be loaded", `${e.message} This screen tries again in 20 seconds.`,
        [{ label: "Try again", onClick: () => load({ first: true }) },
         // Likely an address or connection problem, so this leads to the toolkit's own
         // settings rather than the display's, which doesn't have the Compass address.
         { label: "Settings", secondary: true, onClick: (e) => openSettings(e.currentTarget) }]);
    }
    state.retryTimer = setTimeout(() => load({ first: true }), 20000);
  }
}

function sortItems(items, priorityFirst) {
  const t = (it) => Date.parse(it.start || it.createdTimestamp) || 0;
  return [...items].sort((a, b) => {
    if (priorityFirst && a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
    return t(b) - t(a);
  });
}

function applyFilter({ keepCurrent = false } = {}) {
  const prevIndex = state.index;
  const currentId = keepCurrent ? state.slides[state.index]?.feedItemId : null;
  state.slides = state.allItems.filter((it) =>
    matchesAudience(it, state.audiences.get(it.newsFeedItemId), state.overrides[it.newsFeedItemId], state.settings));
  const found = currentId ? state.slides.findIndex((s) => s.feedItemId === currentId) : -1;
  buildProgress();
  if (!state.slides.length) {
    showEmpty();
    return;
  }
  if (found >= 0 && keepCurrent) {
    state.index = found;
    markProgress();
    return; // keep the slide that's on screen; new content appears on the next rotation
  }
  show(keepCurrent ? Math.min(prevIndex, state.slides.length - 1) : 0);
}

function showEmpty() {
  const aud = state.settings.audience;
  const unknown = state.allItems.filter((it) =>
    (state.audiences.get(it.newsFeedItemId)?.kind || "unknown") === "unknown" && !state.overrides[it.newsFeedItemId]).length;
  if (aud !== "all" && unknown) {
    showStatus("No checked news to show",
      `Compass didn't say who ${unknown} item${unknown === 1 ? " is" : "s are"} for, so ${unknown === 1 ? "it's" : "they're"} hidden to be safe. Switch to All news and use "This item is for" to label them.`,
      [{ label: "Show all news", onClick: () => setAudience("all") },
       { label: "Settings", secondary: true, onClick: () => openLocalSettings() }]);
    return;
  }
  const other = aud === "community" || aud === "students" ? "Staff only or All news" : "another view";
  const msg = aud === "all"
    ? `No newsfeed items in the last ${state.settings.maxAgeDays || "few"} days.`
    : `There's nothing for ${AUDIENCE_LABELS[aud].toLowerCase()} right now. Try ${other}, or allow older items in Settings.`;
  showStatus("No news to show", msg, [
    { label: "Reload", onClick: () => load({ first: true }) },
    { label: "Settings", secondary: true, onClick: () => openLocalSettings() }
  ]);
}

// ---------------------------------------------------------------- slides

async function show(i) {
  if (!state.slides.length) return;
  const token = ++state.showToken;
  state.index = (i + state.slides.length) % state.slides.length;
  const item = state.slides[state.index];
  const info = state.audiences.get(item.newsFeedItemId);
  const override = state.overrides[item.newsFeedItemId];

  const sheet = document.getElementById("slideTpl").content.firstElementChild.cloneNode(true);
  sheet.querySelector(".title").textContent = item.title || "Untitled";
  sheet.querySelector(".tape").hidden = !item.isPriority;

  const meta = sheet.querySelector(".meta");
  const kind = override === "staff" || override === "community" ? override : info?.kind || "unknown";
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.dataset.kind = kind;
  dot.title = kind === "staff" ? "Staff only" : kind === "community" ? "Students & parents" : "Audience not checked";
  meta.append(dot);
  const bits = [];
  if (!state.settings.hideAuthor) bits.push(item.overrideCreatorName || item.createdUserName);
  bits.push(formatWhen(item.start || item.createdTimestamp));
  meta.append(bits.filter(Boolean).join(", "));

  const content = sheet.querySelector(".content");
  content.append(sanitizeHtml(item.itemContent, { resolveUrl: (u) => state.client.absolute(u) }));
  loadInlineImages(content);

  const images = (item.attachments || []).filter((a) => a.type === 1 || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.name || ""));
  const files = (item.attachments || []).filter((a) => !images.includes(a));
  if (files.length) {
    const f = sheet.querySelector(".files");
    f.hidden = false;
    f.textContent = `Attached in Compass: ${files.map((a) => a.name).join(", ")}`;
  }

  const media = sheet.querySelector(".media");
  if (images.length) {
    media.hidden = false;
    for (const att of images) {
      const img = document.createElement("img");
      img.alt = att.name || "";
      media.append(img);
      blobUrl(state.client.imageUrlForAttachment(att))
        .catch(() => blobUrl(state.client.absolute(att.path)))
        .then((u) => { img.src = u; })
        .catch(() => img.remove());
    }
    if (images.length > 1) {
      const c = document.createElement("span");
      c.className = "count";
      media.append(c);
    }
  }

  // Swap sheets
  const old = state.sheet;
  stage.querySelectorAll(".status").forEach((n) => n.remove());
  stage.append(sheet);
  state.sheet = sheet;
  if (old) {
    old.classList.remove("in");
    old.classList.add("out");
    setTimeout(() => old.remove(), reduceMotion ? 0 : 700);
  }
  requestAnimationFrame(() => sheet.classList.add("in"));

  // Timing: long posts scroll, picture posts step through their pictures.
  stopMedia();
  await nextFrame();
  if (token !== state.showToken) return; // another slide was requested meanwhile
  const s = state.settings;
  const overflow = Math.max(0, content.scrollHeight - content.clientHeight);
  content.classList.toggle("fits", overflow < 4);
  // Scroll speed scales with screen height so it reads the same on any projector.
  const speedVh = { slow: 1.1, medium: 1.8, fast: 2.8 }[s.scrollSpeed] || 1.1;
  const speed = (innerHeight * speedVh) / 100; // px per second
  const holdStart = 6000, holdEnd = 5000;
  const scrollMs = overflow > 4 ? holdStart + (overflow / speed) * 1000 + holdEnd : 0;
  const imageMs = images.length > 1 ? images.length * s.imageSeconds * 1000 : 0;
  state.duration = Math.max(s.slideSeconds * 1000, scrollMs, imageMs);
  state.scroll = overflow > 4 ? { el: content, overflow, startAt: holdStart, speed } : null;
  if (images.length) startImageCycle(media, images.length);

  state.elapsed = 0;
  state.lastTick = performance.now();
  $("overrideSel").value = override || "";
  markProgress();
}

function startImageCycle(media, n) {
  const imgs = [...media.querySelectorAll("img")];
  const count = media.querySelector(".count");
  let k = 0;
  const showK = () => {
    imgs.forEach((im, j) => im.classList.toggle("on", j === k));
    if (count) count.textContent = `Picture ${k + 1} of ${n}`;
  };
  showK();
  if (n > 1) {
    state.imageTimer = setInterval(() => {
      if (state.paused) return;
      k = (k + 1) % n;
      showK();
    }, state.settings.imageSeconds * 1000);
  }
}

function stopMedia() {
  clearInterval(state.imageTimer);
  state.imageTimer = null;
}

function tick(now) {
  const dt = now - (state.lastTick || now);
  state.lastTick = now;
  if (!state.paused && state.slides.length && state.sheet) {
    state.elapsed += dt;
    if (state.scroll) {
      const { el, overflow, startAt, speed } = state.scroll;
      const y = Math.min(overflow, Math.max(0, (state.elapsed - startAt) / 1000 * speed));
      el.scrollTop = y;
    }
    const seg = progress.children[state.index];
    if (seg) seg.firstElementChild.style.width = `${Math.min(100, (state.elapsed / state.duration) * 100)}%`;
    if (state.elapsed >= state.duration) {
      // Reset straight away: show() only resets this itself once it finishes preparing the
      // next slide (measuring its height, starting its image cycle), which takes a frame or
      // two. Left alone, every frame in between would see the same overrun and call show()
      // again, racing itself so fast that no call ever survives long enough to finish, which
      // is what left the display blank rather than moving on to the next item.
      state.elapsed = 0;
      if (state.slides.length > 1) show(state.index + 1);
    }
  }
  requestAnimationFrame(tick);
}

function buildProgress() {
  progress.replaceChildren(...state.slides.map(() => {
    const s = document.createElement("div");
    s.className = "seg";
    s.append(document.createElement("i"));
    return s;
  }));
  progress.hidden = state.slides.length < 2;
}

function markProgress() {
  [...progress.children].forEach((seg, j) => {
    seg.classList.toggle("done", j < state.index);
    if (j !== state.index) seg.firstElementChild.style.width = j < state.index ? "100%" : "0";
  });
}

// ---------------------------------------------------------------- images

async function blobUrl(url) {
  if (!url) throw new Error("no url");
  if (state.blobCache.has(url)) return state.blobCache.get(url);
  const res = await fetch(url, { credentials: "include" });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.startsWith("image/")) throw new Error(`image ${res.status}`);
  const obj = URL.createObjectURL(await res.blob());
  state.blobCache.set(url, obj);
  if (state.blobCache.size > 80) {
    const [firstKey, firstVal] = state.blobCache.entries().next().value;
    URL.revokeObjectURL(firstVal);
    state.blobCache.delete(firstKey);
  }
  return obj;
}

function loadInlineImages(root) {
  root.querySelectorAll("img[data-src]").forEach((img) => {
    const src = img.dataset.src;
    if (src.startsWith("data:")) { img.src = src; return; }
    blobUrl(src).then((u) => { img.src = u; }).catch(() => img.remove());
  });
}

// ---------------------------------------------------------------- status screens

function showStatus(title, text, actions = []) {
  stopMedia();
  if (state.sheet) { state.sheet.remove(); state.sheet = null; }
  stage.querySelectorAll(".status").forEach((n) => n.remove());
  progress.replaceChildren();
  const box = document.createElement("section");
  box.className = "status";
  const h = document.createElement("h1");
  h.textContent = title;
  box.append(h);
  if (text) {
    const p = document.createElement("p");
    p.textContent = text;
    box.append(p);
  }
  if (actions.length) {
    const row = document.createElement("div");
    row.className = "actions";
    for (const a of actions) {
      const b = document.createElement("button");
      b.textContent = a.label;
      if (a.secondary) b.className = "secondary";
      b.addEventListener("click", a.onClick);
      row.append(b);
    }
    box.append(row);
  }
  stage.append(box);
}

// ---------------------------------------------------------------- controls

function bindControls() {
  let hideTimer;
  const reveal = () => {
    document.body.classList.add("show-controls");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!$("controls").matches(":hover, :focus-within")) document.body.classList.remove("show-controls");
    }, 3000);
  };
  document.addEventListener("mousemove", reveal);
  document.addEventListener("keydown", (e) => {
    // The dialog has its own form controls (typing into a number field, Space on a
    // toggle), which these shortcuts would otherwise steal or interfere with.
    if (settingsModal.open) return;
    if (e.target.tagName === "SELECT") return;
    switch (e.key) {
      case "ArrowRight": case "PageDown": next(); break;
      case "ArrowLeft": case "PageUp": prev(); break;
      case " ": e.preventDefault(); togglePause(); break;
      case "f": case "F": toggleFullscreen(); break;
      case "r": case "R": load({ first: true }); break;
      case "1": setAudience("all"); break;
      case "2": setAudience("staff"); break;
      case "3": setAudience("community"); break;
      case "4": setAudience("students"); break;
      case "Tab": reveal(); break;
    }
  });
  // Presenter clickers send PageUp/PageDown; also allow clicking the sheet edge.
  $("nextBtn").addEventListener("click", next);
  $("prevBtn").addEventListener("click", prev);
  $("pauseBtn").addEventListener("click", togglePause);
  $("fsBtn").addEventListener("click", toggleFullscreen);
  $("refreshBtn").addEventListener("click", () => load({ first: true }));
  $("settingsBtn").addEventListener("click", () => openLocalSettings());
  document.querySelectorAll(".controls .seg button").forEach((b) =>
    b.addEventListener("click", () => setAudience(b.dataset.aud)));
  $("overrideSel").addEventListener("change", async (e) => {
    const item = state.slides[state.index];
    if (!item) return;
    await setOverride(item.newsFeedItemId, e.target.value);
    state.overrides = await getOverrides();
    applyFilter({ keepCurrent: true }); // moves on if the item no longer belongs in this view
    e.target.blur();
  });
  // A clicked button keeps the browser's focus outline afterwards, which is what the idle
  // timer above checks for (:focus-within) so it won't hide the toolbar out from under someone
  // still using it. Left alone, that focus never clears on its own, so once anything in here
  // was clicked once the toolbar would stay up forever instead of hiding again after 3 seconds.
  $("controls").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn) btn.blur();
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "sync" || !changes[CompassToolkit.SETTINGS_KEY]) return;
    const before = state.settings;
    const aud = before.audience; // keep the per-tab audience choice
    state.settings = await getSettings();
    const params = new URLSearchParams(location.search);
    state.settings.audience = params.get("audience") || aud;
    // Every toolkit setting sits in the one stored blob, so ignore changes that aren't this feature's.
    if (JSON.stringify(before) === JSON.stringify(state.settings)) return;
    if (!state.settings.enabled) { showOff(); return; }
    if (state.settings.schoolUrl !== before.schoolUrl) state.client = new CompassClient(state.settings.schoolUrl);
    updateAudienceUi();
    load({ first: true });
  });
}

// Raises the Compass Toolkit's own menu, for the Compass address and connection
// tools, which live there rather than here. Chrome can open it from here, but not
// in every window, so `button` (the one clicked) is told if it couldn't.
async function openSettings(button) {
  try {
    await chrome.action.openPopup();
  } catch (e) {
    if (!button) return;
    const original = button.textContent;
    button.textContent = "Use the toolbar menu";
    setTimeout(() => { button.textContent = original; }, 4000);
  }
}

// ---------------------------------------------------------------- display settings

// Everything about how the display looks and behaves day to day: which class,
// how long each item stays up, and so on. The Compass address and connection
// tools stay in the Compass Toolkit menu instead, since they're set up once
// rather than adjusted from the room the display is actually in.
function bindSettingsModal() {
  $("openToolkitBtn").addEventListener("click", (e) => openSettings(e.currentTarget));
  settingsModal.addEventListener("close", () => document.body.classList.remove("modal-open"));
}

function newsfeedSettingDef(key) {
  return CompassToolkit.FEATURE_BY_KEY.newsfeedProjector.settings.find((s) => s.key === key);
}

// Every display setting sits in the one settings blob shared with the rest of the
// toolkit, so saving one means reading, changing and writing back the whole thing.
async function saveDisplaySetting(key, value) {
  const all = await CompassToolkit.getSettings();
  all.newsfeedProjector[key] = value;
  await CompassToolkit.saveSettings(all);
}

function settingRowShell(def) {
  const row = document.createElement("div");
  row.className = "setting-row";
  const text = document.createElement("div");
  text.className = "setting-text";
  const label = document.createElement("div");
  label.className = "setting-label";
  label.textContent = def.label;
  text.append(label);
  if (def.description) {
    const desc = document.createElement("div");
    desc.className = "setting-desc";
    desc.textContent = def.description;
    text.append(desc);
  }
  row.append(text);
  return row;
}

function toggleRow(key) {
  const def = newsfeedSettingDef(key);
  const row = settingRowShell(def);
  const wrap = document.createElement("label");
  wrap.className = "switch setting-control";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!state.settings[key];
  input.setAttribute("aria-label", def.label);
  input.addEventListener("change", () => saveDisplaySetting(key, input.checked));
  const slider = document.createElement("span");
  slider.className = "slider";
  wrap.append(input, slider);
  row.append(wrap);
  return row;
}

function selectRow(key) {
  const def = newsfeedSettingDef(key);
  const row = settingRowShell(def);
  const select = document.createElement("select");
  select.className = "setting-control";
  select.setAttribute("aria-label", def.label);
  def.options.forEach((o) => select.add(new Option(o.label, o.value)));
  select.value = state.settings[key];
  select.addEventListener("change", () => saveDisplaySetting(key, select.value));
  row.append(select);
  return row;
}

function numberRow(key) {
  const def = newsfeedSettingDef(key);
  const row = settingRowShell(def);
  const input = document.createElement("input");
  input.type = "number";
  input.className = "setting-control";
  input.min = def.min;
  input.max = def.max;
  input.value = state.settings[key];
  input.setAttribute("aria-label", def.label);
  input.addEventListener("change", () => {
    // Blank or nonsense falls back to the default, and anything outside the range
    // is pulled back into it, the same way the toolkit popup's own number fields do.
    const typed = input.value.trim() === "" ? NaN : Number(input.value);
    const value = Math.max(def.min, Math.min(def.max, isNaN(typed) ? def.default : typed));
    input.value = value;
    saveDisplaySetting(key, value);
  });
  row.append(input);
  return row;
}

// The class year level isn't a fixed list of options like the others; it comes from
// Compass itself, so it's built by hand rather than from the schema like the rest.
function yearLevelRow() {
  const row = settingRowShell({
    label: "Class year level",
    description:
      "In the Students & parents and Students only views, only show news sent to this year level. Whole-school news is always shown."
  });
  const select = document.createElement("select");
  select.className = "setting-control";
  select.setAttribute("aria-label", "Class year level");
  select.add(new Option("All year levels", "any"));
  select.value = "any";
  row.append(select);
  // Only there once signed in; "All year levels" still works either way.
  state.client.getYearLevels()
    .then((levels) => {
      levels.forEach((y) => select.add(new Option(y.name, String(y.id))));
      select.value = String(state.settings.yearLevel);
      if (select.value === "") select.value = "any";
    })
    .catch(() => {});
  select.addEventListener("change", () => saveDisplaySetting("yearLevel", select.value));
  return row;
}

function settingsGroup(title, rows) {
  const group = document.createElement("div");
  group.className = "settings-group";
  const h = document.createElement("h3");
  h.textContent = title;
  group.append(h, ...rows);
  return group;
}

function openLocalSettings() {
  const body = $("settingsBody");
  body.innerHTML = "";
  body.append(
    settingsGroup("What to show", [
      selectRow("audience"),
      yearLevelRow(),
      toggleRow("includeUnknown"),
      numberRow("maxItems"),
      numberRow("maxAgeDays"),
      toggleRow("priorityFirst")
    ]),
    settingsGroup("Display", [
      numberRow("slideSeconds"),
      numberRow("imageSeconds"),
      selectRow("scrollSpeed"),
      numberRow("refreshMinutes"),
      toggleRow("hideAuthor"),
      toggleRow("showClock")
    ])
  );
  document.body.classList.add("modal-open");
  settingsModal.showModal();
  // Otherwise the browser focuses the first focusable element instead, which is the
  // close button: pressing Space (also this display's own pause key) would then
  // immediately close the dialog again, since a focused button activates on Space.
  settingsModal.focus();
}

function showOff() {
  clearTimeout(state.refreshTimer);
  clearTimeout(state.retryTimer);
  showStatus("Newsfeed Projector is turned off", "Turn it on in the Compass Toolkit menu, then reload this page.");
}

function next() { if (state.slides.length) show(state.index + 1); }
function prev() { if (state.slides.length) show(state.index - 1); }

function togglePause() {
  state.paused = !state.paused;
  $("pauseBtn").textContent = state.paused ? "Play" : "Pause";
  $("pauseBtn").title = state.paused ? "Play (Space)" : "Pause (Space)";
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

async function setAudience(aud) {
  if (!AUDIENCE_LABELS[aud] || aud === state.settings.audience) return;
  state.settings.audience = aud;
  const url = new URL(location.href);
  url.searchParams.set("audience", aud);
  history.replaceState(null, "", url);
  updateAudienceUi();
  if (state.allItems.length) applyFilter();
  else load({ first: true });
}

function updateAudienceUi() {
  const aud = state.settings.audience;
  const pill = $("audiencePill");
  pill.textContent = AUDIENCE_LABELS[aud];
  pill.dataset.aud = aud;
  document.title = `Newsfeed: ${AUDIENCE_LABELS[aud]}`;
  document.querySelectorAll(".controls .seg button").forEach((b) =>
    b.setAttribute("aria-checked", String(b.dataset.aud === aud)));
}

// ---------------------------------------------------------------- clock & dates

function startClock() {
  const el = $("clock");
  const render = () => {
    if (!state.settings.showClock) { el.hidden = true; return; }
    el.hidden = false;
    const d = new Date();
    // hour12 is explicit: left to the locale default, some systems show 24-hour time even in English.
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
    const day = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    el.innerHTML = "";
    el.append(time);
    const small = document.createElement("small");
    small.textContent = day;
    el.append(small);
  };
  render();
  setInterval(render, 15000);
}

function formatWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (days === 0) return "posted today";
  if (days === 1) return "posted yesterday";
  if (days < 7) return `posted ${d.toLocaleDateString(undefined, { weekday: "long" })}`;
  return `posted ${d.toLocaleDateString(undefined, { day: "numeric", month: "long" })}`;
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}
