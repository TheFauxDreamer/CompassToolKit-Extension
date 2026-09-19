import {
  normalizeItem, describeWhen, eventToItem, toExistingPayload, editChanges, eventFingerprint,
  zonedParts, ymdString, hmString, addDays, parseDate,
  eventRepeat, describeRepeat, seriesKey, seriesItem, seriesFingerprint, seriesEditPayload, seriesDeletePayload,
} from './lib.js';
import { buildRepeatControls, fillRepeat, readRepeat } from './repeat-ui.js';
import {
  $, state, callService, fetchEvents, refreshCompass, refreshNote, setStatus, currentLayer, isFamilyLayer, pause, plural,
} from './compass-api.js';

const m = { items: [], selected: new Set(), confirming: false, editing: null, loaded: false };

// ---------- Loading ----------

function setDefaultRange() {
  if ($('mFrom').value) return;
  const today = zonedParts(new Date(), state.tz).date;
  $('mFrom').value = ymdString(today);
  $('mTo').value = ymdString(addDays(today, 56));
}

// Re-reads items from Compass so edits and deletes always use current data.
async function fetchLayerItems(fromYmd, toYmd, layerId) {
  const events = await fetchEvents(ymdString(fromYmd), ymdString(toYmd));
  return events.filter((e) => e.calendarId === layerId && e.activityType === 7);
}

export async function loadItems() {
  const status = $('mStatus');
  const from = parseDate($('mFrom').value);
  const to = parseDate($('mTo').value);
  if (!from || !to) { setStatus(status, 'Choose a start and end date.', 'bad'); return; }
  if (ymdString(to) < ymdString(from)) { setStatus(status, 'The end date is before the start date.', 'bad'); return; }

  const layer = currentLayer();
  const filter = $('mFilter').value.trim().toLowerCase();
  $('mLoad').disabled = true;
  setStatus(status, 'Loading items…');
  try {
    // Compass's end date is exclusive-ish; ask for a day either side, then trim to the chosen range.
    const events = await fetchLayerItems(addDays(from, -1), addDays(to, 1), layer.id);
    const lo = ymdString(from), hi = ymdString(to);
    const inRange = (item) => ymdString(item.date) <= hi && ymdString(item.endDate || item.date) >= lo;
    const matches = (ev) => !filter || (ev.title || '').toLowerCase().includes(filter);
    const singles = [];
    const series = new Map();
    for (const ev of events) {
      if (!matches(ev)) continue;
      const item = eventToItem(ev, state.tz);
      if (!inRange(item)) continue;
      if (ev.isRecurring) {
        // Every session of a repeating item comes back as its own record sharing one instanceId.
        const key = seriesKey(ev);
        const entry = series.get(key);
        if (entry) { entry.sessions++; continue; }
        series.set(key, {
          series: true, ev, key, sessions: 1, repeat: eventRepeat(ev, state.tz), yearly: Number(ev.repeatType) === 3,
          item: seriesItem(ev, state.tz), fingerprint: seriesFingerprint(ev), firstInRange: item,
        });
      } else {
        const key = `${ev.activityId}|${ev.instanceId}`;
        if (singles.some((e) => e.key === key)) continue;
        singles.push({ series: false, ev, key, item, fingerprint: eventFingerprint(ev), firstInRange: item });
      }
    }
    m.items = [...singles, ...series.values()]
      .sort((a, b) => ymdString(a.firstInRange.date).localeCompare(ymdString(b.firstInRange.date)) || a.ev.title.localeCompare(b.ev.title));
    m.selected.clear();
    m.loaded = true;
    setStatus(status, '');
  } catch (e) {
    setStatus(status, e.message, 'bad');
  } finally {
    $('mLoad').disabled = false;
  }
  endConfirm();
  renderList();
}

// ---------- List ----------

function renderList() {
  const wrap = $('mList');
  wrap.innerHTML = '';
  $('mActions').hidden = true;
  if (!m.loaded) return;

  if (!m.items.length) {
    const p = document.createElement('p');
    p.className = 'help';
    p.textContent = `No items on ${currentLayer().title.trim()} in that range${$('mFilter').value.trim() ? ' matching that title' : ''}.`;
    wrap.append(p);
    return;
  }

  const table = document.createElement('table');
  table.className = 'rows';
  const tbody = document.createElement('tbody');
  for (const entry of m.items) {
    const { ev, item } = entry;
    const { key } = entry;
    const tr = document.createElement('tr');

    const c1 = document.createElement('td');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = m.selected.has(key);
    // Weekly repeating items can be deleted (all sessions). Other kinds of repeat are left to Compass.
    box.disabled = entry.series && !entry.repeat && !entry.yearly;
    if (box.disabled) box.title = 'Delete this kind of repeating item in Compass';
    box.setAttribute('aria-label', entry.series ? `Select every session of ${ev.title}` : `Select ${ev.title}`);
    box.addEventListener('change', () => {
      if (box.checked) m.selected.add(key); else m.selected.delete(key);
      endConfirm();
      updateActions();
    });
    c1.append(box);

    const c2 = document.createElement('td');
    const t = document.createElement('div'); t.textContent = ev.title;
    const w = document.createElement('div'); w.className = 'sub';
    c2.append(t, w);
    if (entry.series) {
      w.textContent = entry.repeat ? describeRepeat(entry.repeat) : entry.yearly ? 'Repeats every year' : 'Repeating item';
      const n = document.createElement('div'); n.className = 'sub';
      n.textContent = `${plural(entry.sessions, 'session')} in this range, from ${describeWhen(entry.firstInRange)}`;
      c2.append(n);
    } else {
      w.textContent = describeWhen(item);
    }
    if (item.description) {
      const d = document.createElement('div'); d.className = 'sub'; d.textContent = item.description;
      c2.append(d);
    }

    const c3 = document.createElement('td');
    c3.className = 'act';
    if (entry.series && !entry.repeat) {
      c3.textContent = 'Change it in Compass';
      c3.classList.add('sub');
    } else {
      const btn = document.createElement('button');
      btn.className = 'link';
      btn.textContent = entry.series ? 'Edit all' : 'Edit';
      btn.setAttribute('aria-label', `${entry.series ? 'Edit all sessions of' : 'Edit'} ${ev.title}`);
      btn.addEventListener('click', () => openEditor(entry));
      c3.append(btn);
    }
    tr.append(c1, c2, c3);
    tbody.append(tr);
  }
  table.append(tbody);
  const scroll = document.createElement('div');
  scroll.className = 'scroll';
  scroll.append(table);
  wrap.append(scroll);
  $('mActions').hidden = false;
  updateActions();
}

function selectable() { return m.items.filter((e) => !e.series || e.repeat || e.yearly); }

function updateActions() {
  const n = m.selected.size;
  const all = selectable();
  $('mAll').checked = all.length > 0 && all.every((e) => m.selected.has(e.key));
  $('mDelete').disabled = n === 0;
  $('mDelete').textContent = m.confirming ? `Yes, delete ${plural(n, 'item')}` : (n ? `Delete ${plural(n, 'item')}` : 'Delete selected');
}

function endConfirm() {
  m.confirming = false;
  $('mKeep').hidden = true;
  $('mDelete').classList.remove('armed');
  if (m.loaded) updateActions();
}

// ---------- Delete ----------

async function onDelete() {
  const status = $('mStatus');
  const chosen = m.items.filter((e) => m.selected.has(e.key));
  if (!chosen.length) return;
  const layer = currentLayer();

  if (!m.confirming) {
    m.confirming = true;
    $('mKeep').hidden = false;
    $('mDelete').classList.add('armed');
    updateActions();
    const repeating = chosen.filter((e) => e.series);
    const seriesNote = repeating.length === 1
      ? ` “${repeating[0].ev.title}” repeats, so every one of its sessions will go, including ones outside these dates.`
      : repeating.length > 1
        ? ` ${repeating.length} of them repeat, so every session of those will go, including ones outside these dates.`
        : '';
    setStatus(status, `This removes ${plural(chosen.length, 'item')} from ${layer.title.trim()} for everyone and can’t be undone.` +
      seriesNote + (isFamilyLayer(layer) ? ' Families will no longer see them.' : ''), 'bad');
    return;
  }

  endConfirm();
  $('mDelete').disabled = true;
  $('mLoad').disabled = true;
  let done = 0, skipped = 0, failed = 0;
  const problems = [];
  try {
    setStatus(status, 'Checking the items haven’t changed…');
    const dates = chosen.flatMap((e) => [e.firstInRange.date, e.firstInRange.endDate || e.firstInRange.date]).map(ymdString).sort();
    const fresh = await fetchLayerItems(addDays(parseDate(dates[0]), -1), addDays(parseDate(dates[dates.length - 1]), 1), layer.id);

    for (const [i, entry] of chosen.entries()) {
      setStatus(status, `Deleting ${i + 1} of ${chosen.length}…`);
      const current = entry.series
        ? fresh.find((ev) => ev.isRecurring && seriesKey(ev) === entry.key)
        : fresh.find((ev) => !ev.isRecurring && ev.activityId === entry.ev.activityId && ev.instanceId === entry.ev.instanceId)
          || fresh.find((ev) => !ev.isRecurring && ev.activityId === entry.ev.activityId);
      if (!current) { skipped++; continue; } // already gone
      const unchanged = entry.series ? seriesFingerprint(current) === entry.fingerprint : eventFingerprint(current) === entry.fingerprint;
      if (!unchanged) {
        skipped++;
        problems.push(`“${entry.ev.title}” was changed in Compass since you loaded the list, so it was left alone.`);
        continue;
      }
      try {
        await callService('CancelEvent', entry.series ? seriesDeletePayload(current) : toExistingPayload(current, 'delete'));
        done++;
      } catch (e) {
        failed++;
        problems.push(`“${entry.ev.title}”: ${e.message}`);
        if (/not signed in/.test(e.message)) break;
      }
      await pause(250);
    }
  } catch (e) {
    problems.push(e.message);
  }

  const refreshed = done ? await refreshCompass() : false;
  await loadItems();
  const parts = [`Deleted ${plural(done, 'item')}.`];
  if (skipped) parts.push(`${skipped} skipped.`);
  if (failed) parts.push(`${failed} failed.`);
  if (done) parts.push(refreshNote(refreshed, done > 1));
  setStatus(status, [...parts, ...problems].join(' '), failed || problems.length ? 'bad' : 'good');
}

// ---------- Edit ----------

function openEditor(entry) {
  m.editing = entry;
  endConfirm();
  const { item, ev } = entry;
  $('mBrowse').hidden = true;
  $('mEdit').hidden = false;
  $('eTitle').value = ev.title;
  $('eDate').value = ymdString(item.date);
  $('eEndDate').value = item.endDate ? ymdString(item.endDate) : '';
  $('eAllDay').checked = item.allDay;
  $('eTimes').hidden = item.allDay;
  $('eStart').value = item.startTime ? hmString(item.startTime) : '09:00';
  $('eEnd').value = item.endTime ? hmString(item.endTime) : '10:00';
  $('eDescription').value = item.description;
  $('eSeriesLabel').hidden = !entry.series;
  $('eRepeatBox').hidden = !entry.series;
  $('eEndDateField').hidden = entry.series;
  if (entry.series) fillRepeat('e', entry.repeat);
  setStatus($('mStatus'), '');
  updateEditPreview();
  $('eTitle').focus();
}

function closeEditor() {
  m.editing = null;
  $('mEdit').hidden = true;
  $('mBrowse').hidden = false;
}

function readEditForm() {
  const allDay = $('eAllDay').checked;
  const isSeries = !!(m.editing && m.editing.series);
  const result = normalizeItem({
    title: $('eTitle').value, date: $('eDate').value, endDate: isSeries ? '' : $('eEndDate').value,
    startTime: allDay ? '' : $('eStart').value, endTime: allDay ? '' : $('eEnd').value,
    description: $('eDescription').value,
  });
  if (!isSeries) return { ...result, repeat: null };
  const r = readRepeat('e', result.item);
  return { item: r.repeat ? result.item : null, errors: [...result.errors, ...r.errors], repeat: r.repeat };
}

function updateEditPreview() {
  const { item, errors, repeat } = readEditForm();
  $('eWhen').textContent = item
    ? (repeat ? `First session ${describeWhen(item)}. ${describeRepeat(repeat)}.` : describeWhen(item))
    : errors[0] || '';
}

async function onSave() {
  const status = $('mStatus');
  const entry = m.editing;
  const { item, errors, repeat } = readEditForm();
  if (!item) { setStatus(status, errors.join('. ') + '.', 'bad'); return; }
  const layer = currentLayer();

  $('eSave').disabled = true;
  try {
    setStatus(status, 'Checking the item hasn’t changed…');
    const around = entry.firstInRange;
    const fresh = await fetchLayerItems(addDays(around.date, -1), addDays(around.endDate || around.date, 1), layer.id);
    const current = entry.series
      ? fresh.find((ev) => ev.isRecurring && seriesKey(ev) === entry.key)
      : fresh.find((ev) => !ev.isRecurring && ev.activityId === entry.ev.activityId);
    if (!current) {
      setStatus(status, 'This item is no longer on the calendar. It may have been deleted or moved in Compass.', 'bad');
      return;
    }
    const nowPrint = entry.series ? seriesFingerprint(current) : eventFingerprint(current);
    if (nowPrint !== entry.fingerprint) {
      setStatus(status, 'Someone changed this item in Compass after you opened it. Go back to the list to see the latest version.', 'bad');
      return;
    }
    setStatus(status, 'Saving…');
    const payload = entry.series
      ? seriesEditPayload(current, item, repeat, state.tz)
      : toExistingPayload(current, 'update', editChanges(item, state.tz));
    await callService('UpdateEvent', payload);
    closeEditor();
    const refreshed = await refreshCompass();
    await loadItems();
    setStatus(status, `Saved “${item.title}”. ${refreshNote(refreshed)}`, 'good');
  } catch (e) {
    setStatus(status, e.message, 'bad');
  } finally {
    $('eSave').disabled = false;
  }
}

// ---------- Setup ----------

export function onManageShown() {
  setDefaultRange();
  if (!m.loaded) loadItems();
}

export function resetManage() {
  m.items = []; m.selected.clear(); m.loaded = false;
  closeEditor();
  endConfirm();
  renderList();
  setStatus($('mStatus'), '');
  if (!$('panelManage').hidden) loadItems();
}

export function initManage() {
  $('mLoad').addEventListener('click', loadItems);
  $('mFilter').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadItems(); });
  $('mAll').addEventListener('change', () => {
    for (const e of selectable()) { if ($('mAll').checked) m.selected.add(e.key); else m.selected.delete(e.key); }
    endConfirm();
    renderList();
  });
  $('mDelete').addEventListener('click', onDelete);
  $('mKeep').addEventListener('click', () => { endConfirm(); setStatus($('mStatus'), ''); });
  $('eAllDay').addEventListener('change', () => { $('eTimes').hidden = $('eAllDay').checked; updateEditPreview(); });
  for (const id of ['eDate', 'eEndDate', 'eStart', 'eEnd']) $(id).addEventListener('input', updateEditPreview);
  $('eSave').addEventListener('click', onSave);
  buildRepeatControls('e', updateEditPreview);
  $('eTitle').addEventListener('input', updateEditPreview);
  $('eCancel').addEventListener('click', () => { closeEditor(); setStatus($('mStatus'), ''); });
}
