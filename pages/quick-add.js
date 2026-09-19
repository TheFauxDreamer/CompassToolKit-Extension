import {
  DEFAULT_TZ, isValidTimeZone, normalizeItem, toCreatePayload, toExistingPayload, itemKey, lookupRange,
  describeWhen, describeRepeat, parseBulk,
} from './quick-add/lib.js';
import { buildRepeatControls, followStartDate, readRepeat, resetRepeat } from './quick-add/repeat-ui.js';
import {
  $, state, callService, fetchEvents, findCompassTab, inPage, pageContext, refreshCompass, refreshNote,
  setStatus, currentLayer, isFamilyLayer, pause, plural,
} from './quick-add/compass-api.js';
import { initManage, onManageShown, resetManage } from './quick-add/manage.js';
import { initBirthdays, onBirthdaysShown, resetBirthdays } from './quick-add/birthdays.js';

// The page wears the feature's colours from the toolkit settings, so it always matches the menu row.
const featureColour = CompassToolkit.FEATURE_BY_KEY.calendarQuickAdd.colour;
document.documentElement.style.setProperty('--accent', featureColour.base);
document.documentElement.style.setProperty('--accent-soft', featureColour.soft);

// Which calendar was last used, kept on this device by the toolkit's shared storage helpers.
const LAST_LAYER_KEY = CompassToolkit.DATA_KEYS.quickAddLayer;

let bulkRows = [];
let lastBatch = []; // records Compass returned for the most recent paste, for undo

function block(title, detail) {
  $('app').hidden = true;
  $('blocker').hidden = false;
  $('blocker').innerHTML = '';
  const b = document.createElement('b'); b.textContent = title;
  const p = document.createElement('div'); p.textContent = detail;
  $('blocker').append(b, p);
}

// ---------- Duplicates ----------

async function existingKeys(items, calendarId) {
  if (!state.userId || !items.length) return null;
  const { startDate, endDate } = lookupRange(items);
  const events = await fetchEvents(startDate, endDate);
  return new Set(events.filter((e) => e.calendarId === calendarId).map((e) => itemKey(e.title, e.start)));
}

// ---------- One item ----------

function readOneForm() {
  const allDay = $('allDay').checked;
  const repeats = $('oneRepeat').checked;
  const result = normalizeItem({
    title: $('title').value, date: $('date').value, endDate: repeats ? '' : $('endDate').value,
    startTime: allDay ? '' : $('startTime').value, endTime: allDay ? '' : $('endTime').value,
    description: $('description').value,
  });
  if (!repeats) return { ...result, repeat: null };
  const r = readRepeat('one', result.item);
  return { item: r.repeat ? result.item : null, errors: [...result.errors, ...r.errors], repeat: r.repeat };
}

let confirmDuplicate = null;

function updatePreview() {
  $('pvTitle').textContent = $('title').value.trim() || 'Your item';
  const { item, errors, repeat } = readOneForm();
  if (item) $('pvWhen').textContent = describeWhen(item);
  else $('pvWhen').textContent = $('date').value ? errors.filter((e) => !/Title/.test(e))[0] || '' : 'Pick a date';
  $('pvRepeat').hidden = !repeat;
  $('pvRepeat').textContent = repeat ? describeRepeat(repeat) : '';
  confirmDuplicate = null;
  $('addOne').textContent = 'Add to calendar';
}

async function addOne() {
  const status = $('oneStatus');
  const { item, errors, repeat } = readOneForm();
  if (!item) { setStatus(status, errors.join('. ') + '.', 'bad'); return; }
  const layer = currentLayer();
  const payload = toCreatePayload(item, layer.id, state.tz, repeat);
  const key = itemKey(item.title, payload.start);

  $('addOne').disabled = true;
  try {
    if (confirmDuplicate !== key) {
      setStatus(status, 'Checking the calendar…');
      const keys = await existingKeys([item], layer.id);
      if (keys && keys.has(key)) {
        confirmDuplicate = key;
        $('addOne').textContent = 'Add it again anyway';
        setStatus(status, `“${item.title}” is already on ${layer.title.trim()} at that time.`, 'bad');
        return;
      }
    }
    setStatus(status, 'Adding…');
    await callService('CreateEvent', payload);
    $('title').value = '';
    $('description').value = '';
    const refreshed = await refreshCompass();
    const what = repeat ? `the repeating item “${item.title}”` : `“${item.title}”`;
    setStatus(status, `Added ${what}. ${refreshNote(refreshed)} To change or remove it, use the Change or delete tab.`, 'good');
    if (repeat) { $('oneRepeat').checked = false; $('oneRepeatBox').hidden = true; $('endDateField').hidden = false; resetRepeat('one'); }
    updatePreview();
  } catch (e) {
    setStatus(status, e.message, 'bad');
  } finally {
    $('addOne').disabled = false;
  }
}

// ---------- Many items ----------

const shouldAdd = (r) => r.item && !r.done && (!r.duplicate || $('allowDupes').checked);

function renderBulk() {
  const wrap = $('bulkResult');
  wrap.innerHTML = '';
  if (!bulkRows.length) { $('addMany').hidden = true; return; }

  const table = document.createElement('table');
  table.className = 'rows';
  table.innerHTML = '<thead><tr><th>Row</th><th>Item</th><th>Status</th></tr></thead>';
  const tbody = document.createElement('tbody');
  for (const r of bulkRows) {
    const tr = document.createElement('tr');
    const c1 = document.createElement('td'); c1.textContent = r.line; c1.className = 'sub';
    const c2 = document.createElement('td');
    if (r.item) {
      const t = document.createElement('div'); t.textContent = r.item.title;
      const w = document.createElement('div'); w.className = 'sub'; w.textContent = describeWhen(r.item);
      c2.append(t, w);
    } else {
      c2.textContent = Object.values(r.raw).filter(Boolean).join(' | ');
      c2.className = 'sub';
    }
    const c3 = document.createElement('td');
    c3.textContent = r.statusText;
    c3.className = r.statusKind || '';
    r.statusCell = c3;
    tr.append(c1, c2, c3);
    tbody.append(tr);
  }
  table.append(tbody);
  const scroll = document.createElement('div');
  scroll.className = 'scroll';
  scroll.append(table);
  wrap.append(scroll);

  const n = bulkRows.filter(shouldAdd).length;
  $('addMany').hidden = n === 0;
  $('addMany').disabled = false;
  $('addMany').textContent = `Add ${plural(n, 'item')} to ${currentLayer().title.trim()}`;
}

async function checkRows() {
  const status = $('manyStatus');
  setStatus(status, '');
  $('undoMany').hidden = true;
  const parsed = parseBulk($('bulk').value);
  if (parsed.error) { bulkRows = []; renderBulk(); setStatus(status, parsed.error, 'bad'); return; }
  if (!parsed.rows.length) { bulkRows = []; renderBulk(); setStatus(status, 'Paste some rows first.', 'bad'); return; }

  const layer = currentLayer();
  const seen = new Set();
  for (const r of parsed.rows) {
    if (!r.item) { r.statusText = r.errors.join('. '); r.statusKind = 'bad'; continue; }
    r.payload = toCreatePayload(r.item, layer.id, state.tz);
    r.key = itemKey(r.item.title, r.payload.start);
    if (seen.has(r.key)) { r.duplicate = true; r.statusText = 'Repeats an earlier row'; r.statusKind = 'bad'; }
    else { r.statusText = 'Ready'; r.statusKind = ''; }
    seen.add(r.key);
  }

  $('checkRows').disabled = true;
  try {
    const good = parsed.rows.filter((r) => r.item);
    setStatus(status, 'Checking the calendar for items that are already there…');
    const keys = await existingKeys(good.map((r) => r.item), layer.id);
    for (const r of good) {
      if (keys && keys.has(r.key)) { r.duplicate = true; r.statusText = 'Already on this calendar'; r.statusKind = 'bad'; }
    }
    const bad = parsed.rows.length - good.length;
    setStatus(status, keys
      ? (bad ? `${plural(bad, 'row')} need fixing in your spreadsheet and will be skipped.` : '')
      : 'Couldn’t check for items that are already there. Open the Calendar page in Compass to include that check.');
  } catch (e) {
    setStatus(status, e.message, 'bad');
  } finally {
    $('checkRows').disabled = false;
  }
  bulkRows = parsed.rows;
  renderBulk();
}

async function addMany() {
  const status = $('manyStatus');
  const todo = bulkRows.filter(shouldAdd);
  $('addMany').disabled = true;
  $('checkRows').disabled = true;
  let ok = 0, failed = 0;
  lastBatch = [];
  for (const [i, r] of todo.entries()) {
    setStatus(status, `Adding ${i + 1} of ${todo.length}…`);
    try {
      const created = await callService('CreateEvent', r.payload);
      if (created && created.activityId) lastBatch.push(created);
      r.done = true; ok++;
      r.statusCell.textContent = 'Added'; r.statusCell.className = 'good';
    } catch (e) {
      failed++;
      r.statusCell.textContent = e.message; r.statusCell.className = 'bad';
      if (/not signed in/.test(e.message)) break;
    }
    await pause(250);
  }
  $('checkRows').disabled = false;
  const refreshed = ok ? await refreshCompass() : false;
  const summary = `Added ${plural(ok, 'item')}.` + (failed ? ` ${failed} failed; see the table.` : '') +
    (ok ? ` ${refreshNote(refreshed, ok > 1)}` : '');
  setStatus(status, summary, failed || !ok ? 'bad' : 'good');
  $('undoMany').hidden = lastBatch.length === 0;
  $('undoMany').textContent = `Undo: delete the ${plural(lastBatch.length, 'item')} just added`;
  const left = bulkRows.filter(shouldAdd).length;
  $('addMany').hidden = left === 0;
  $('addMany').disabled = false;
  $('addMany').textContent = `Retry ${plural(left, 'item')}`;
}

async function undoMany() {
  const status = $('manyStatus');
  if (!lastBatch.length) return;
  $('undoMany').disabled = true;
  let removed = 0;
  const failures = [];
  for (const [i, record] of lastBatch.entries()) {
    setStatus(status, `Deleting ${i + 1} of ${lastBatch.length}…`);
    try {
      await callService('CancelEvent', toExistingPayload(record, 'delete'));
      removed++;
    } catch (e) {
      failures.push(`“${record.title}”: ${e.message}`);
    }
    await pause(250);
  }
  lastBatch = [];
  $('undoMany').hidden = true;
  $('undoMany').disabled = false;
  for (const r of bulkRows) {
    if (r.done) { r.done = false; r.statusCell.textContent = 'Removed again'; r.statusCell.className = ''; }
  }
  const refreshed = removed ? await refreshCompass() : false;
  setStatus(status, [`Deleted ${plural(removed, 'item')}.`, removed ? refreshNote(refreshed, true) : '', ...failures].join(' '),
    failures.length ? 'bad' : 'good');
  $('addMany').hidden = true;
}

// ---------- Setup ----------

const TABS = { One: 'panelOne', Many: 'panelMany', Manage: 'panelManage', Birthdays: 'panelBirthdays' };

function selectTab(name) {
  for (const [key, panel] of Object.entries(TABS)) {
    const on = key === name;
    $(`tab${key}`).setAttribute('aria-selected', String(on));
    $(panel).hidden = !on;
  }
  if (name === 'Manage') onManageShown();
  if (name === 'Birthdays') onBirthdaysShown();
}

function onLayerChange() {
  const layer = currentLayer();
  CompassToolkit.setData({ [LAST_LAYER_KEY]: layer.id });
  document.documentElement.style.setProperty('--layer', layer.color || '#7742a9');
  $('layerNote').hidden = !isFamilyLayer(layer);
  $('layerNote').textContent = isFamilyLayer(layer) ? `Items on “${layer.title.trim()}” may be visible to families.` : '';
  updatePreview();
  if (bulkRows.length) { bulkRows = []; renderBulk(); setStatus($('manyStatus'), 'Calendar changed. Check rows again.'); }
  lastBatch = [];
  $('undoMany').hidden = true;
  resetManage();
  resetBirthdays();
}

async function init() {
  const settings = await CompassToolkit.getSettings();
  if (!settings.calendarQuickAdd.enabled) {
    block('Calendar Quick Add is turned off', 'Turn it on in the Compass Toolkit menu, then reload this page.');
    return;
  }

  const tab = await findCompassTab();
  if (!tab) {
    block('Open Compass first', 'Open your school’s Compass site in a tab and sign in, then reload this page.');
    return;
  }
  state.tabId = tab.id;

  let ctx;
  try { ctx = await inPage(pageContext); } catch (e) { block('Can’t reach Compass', e.message); return; }
  state.tz = ctx.tz && isValidTimeZone(ctx.tz) ? ctx.tz : DEFAULT_TZ;
  state.userId = ctx.userId;
  state.onCalendar = ctx.onCalendar;
  state.host = ctx.host;
  $('school').textContent = ctx.host;

  let layers;
  try {
    layers = await callService('GetCalendarsByUser?sessionstate=readonly&ExcludeNonRelevantPd=true', { page: 1, start: 0, limit: 25 });
  } catch (e) { block('Can’t load your calendars', e.message); return; }

  state.layers = (layers || []).filter((l) =>
    !l.isICal && !l.viewOnly && (!ctx.editableIds || ctx.editableIds.includes(l.id)));
  if (!state.layers.length) {
    block('No calendars you can change', 'Your Compass account doesn’t manage any calendar layers. Ask a Compass administrator to add you as a manager of the layer.');
    return;
  }

  const lastLayer = (await CompassToolkit.getData([LAST_LAYER_KEY]))[LAST_LAYER_KEY];
  for (const l of state.layers) {
    const o = document.createElement('option');
    o.value = l.id; o.textContent = l.title.trim();
    if (l.id === lastLayer) o.selected = true;
    $('layer').append(o);
  }

  $('app').hidden = false;
  $('layer').addEventListener('change', onLayerChange);
  for (const key of Object.keys(TABS)) $(`tab${key}`).addEventListener('click', () => selectTab(key));
  $('allDay').addEventListener('change', () => { $('times').hidden = $('allDay').checked; updatePreview(); });
  for (const id of ['title', 'date', 'endDate', 'startTime', 'endTime']) $(id).addEventListener('input', updatePreview);
  buildRepeatControls('one', updatePreview);
  $('date').addEventListener('input', () => { followStartDate('one', $('date').value); updatePreview(); });
  $('oneRepeat').addEventListener('change', () => {
    const on = $('oneRepeat').checked;
    $('oneRepeatBox').hidden = !on;
    $('endDateField').hidden = on;
    if (on) followStartDate('one', $('date').value);
    updatePreview();
  });
  $('addOne').addEventListener('click', addOne);
  $('checkRows').addEventListener('click', checkRows);
  $('addMany').addEventListener('click', addMany);
  $('undoMany').addEventListener('click', undoMany);
  $('allowDupes').addEventListener('change', () => bulkRows.length && renderBulk());
  $('bulk').addEventListener('input', () => { if (bulkRows.length) { bulkRows = []; renderBulk(); } });
  initManage();
  initBirthdays();
  onLayerChange();
}

init();
