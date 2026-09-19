import {
  parseStaffExport, planBirthdays, planLeavers, yearlyCreatePayload, seriesDeletePayload, dayAndMonth,
  zonedParts, ymdString, addDays, compareDays, REPEAT_YEARLY, DELETE_ALL_SESSIONS, DELETE_THIS_AND_FUTURE,
} from './lib.js';
import {
  $, state, callService, fetchEvents, refreshCompass, refreshNote, setStatus, currentLayer, isFamilyLayer, pause, plural,
} from './compass-api.js';

const DEFAULT_TEMPLATE = '{name}\u2019s birthday';

const b = {
  text: '', rows: [], existing: new Map(), leavers: [], selectedLeavers: new Set(),
  batch: [], confirmingRemove: false, busy: false,
};

const today = () => zonedParts(new Date(), state.tz).date;

// ---------- Talking to Compass ----------

// Yearly items only show up in the year they fall in, so look a full year ahead (in chunks, to keep responses small).
// Returns instanceId -> that series' sessions in the window, earliest first.
async function fetchYearlySessions(layerId, onProgress) {
  const start = today();
  const series = new Map();
  const seen = new Set();
  const CHUNK = 92;
  for (let offset = -1, n = 1; offset < 366; offset += CHUNK, n++) {
    if (onProgress) onProgress(n);
    const events = await fetchEvents(ymdString(addDays(start, offset)), ymdString(addDays(start, Math.min(offset + CHUNK, 367))));
    for (const ev of events) {
      if (ev.calendarId !== layerId || !ev.isRecurring || Number(ev.repeatType) !== REPEAT_YEARLY) continue;
      const key = `${ev.instanceId}|${ev.start}`;
      if (seen.has(key)) continue; // chunks overlap by a day
      seen.add(key);
      if (!series.has(ev.instanceId)) series.set(ev.instanceId, []);
      series.get(ev.instanceId).push(ev);
    }
  }
  for (const list of series.values()) list.sort((x, y) => new Date(x.start) - new Date(y.start));
  return series;
}

const localDate = (iso) => zonedParts(new Date(iso), state.tz).date;
const futureSessions = (sessions) => sessions.filter((ev) => compareDays(localDate(ev.start), today()) > 0);

// Birthdays still running on the calendar, by title. Ones already stopped (no sessions after today and not
// repeating forever) are left out, so someone who comes back is added again.
function existingByTitle(sessionsById) {
  const map = new Map();
  for (const [instanceId, sessions] of sessionsById) {
    const first = sessions[0];
    if (!first.repeatForever && !futureSessions(sessions).length) continue;
    const startDate = localDate(first.recurringStart || first.start);
    map.set((first.title || '').trim().toLowerCase(), {
      title: first.title, monthDay: [startDate[1], startDate[2]], startYear: startDate[0], instanceId, record: first,
    });
  }
  return map;
}

// Sends each deletion from a current session, then re-reads the calendar to check it worked.
// jobs: [{ instanceId, title, mode }] where mode is DELETE_ALL_SESSIONS or DELETE_THIS_AND_FUTURE.
async function runDeletions(jobs, status, verb) {
  const layer = currentLayer();
  setStatus(status, 'Finding the items in Compass…');
  const before = await fetchYearlySessions(layer.id);
  const failures = [];
  const skipped = [];
  const sent = [];
  for (const [i, job] of jobs.entries()) {
    const sessions = before.get(job.instanceId);
    if (!sessions) { skipped.push(`${job.title} (already gone)`); continue; }
    let from = sessions[0];
    let mode = job.mode;
    if (mode === DELETE_THIS_AND_FUTURE) {
      // Delete from the next birthday after today, so this year's (if it has happened) stays.
      const next = futureSessions(sessions)[0];
      if (!next) { skipped.push(`${job.title} (no future birthdays left)`); continue; }
      // If the series hasn't had a birthday yet, there's nothing to keep: remove it entirely.
      if (compareDays(localDate(next.recurringStart || next.start), localDate(next.start)) === 0) mode = DELETE_ALL_SESSIONS;
      from = next;
    }
    setStatus(status, `${verb} ${i + 1} of ${jobs.length}…`);
    try {
      await callService('CancelEvent', seriesDeletePayload(from, mode));
      sent.push({ ...job, mode });
    } catch (e) {
      failures.push(`“${job.title}”: ${e.message}`);
      if (/not signed in/.test(e.message)) break;
    }
    await pause(250);
  }
  setStatus(status, 'Checking the calendar…');
  const after = await fetchYearlySessions(layer.id);
  const notDone = sent.filter((job) => {
    const left = after.get(job.instanceId);
    if (!left) return false;
    return job.mode === DELETE_ALL_SESSIONS ? true : futureSessions(left).length > 0;
  });
  return { done: sent.length - notDone.length, notDone: notDone.map((j) => j.title), skipped, failures, sent };
}

// ---------- Checking the export ----------

function layerProblem(layer) {
  if (isFamilyLayer(layer)) {
    return { block: true, text: `Birthdays can’t be added to “${layer.title.trim()}” because families can see it. Choose a staff-only calendar above.` };
  }
  if (!/birthday/i.test(layer.title)) {
    return { block: false, text: `You’re working on “${layer.title.trim()}”. Once the Birthdays calendar has been set up in Compass, choose it above.` };
  }
  return null;
}

function templateError(template) {
  if (!/\{name\}/i.test(template)) return 'The title needs {name} in it, where each person’s name goes.';
  if (template.replace(/\{name\}/gi, '').trim().length < 2) return 'Add some words to the title, e.g. {name}’s birthday.';
  return '';
}

async function checkList() {
  if (b.busy) return;
  const status = $('bStatus');
  const layer = currentLayer();
  const problem = layerProblem(layer);
  if (problem && problem.block) { setStatus(status, problem.text, 'bad'); return; }

  const text = $('bText').value.trim() ? $('bText').value : b.text;
  if (!text.trim()) { setStatus(status, 'Choose the staff export file first, or paste its rows.', 'bad'); return; }
  const template = $('bTemplate').value.trim();
  const tErr = templateError(template);
  if (tErr) { setStatus(status, tErr, 'bad'); return; }

  const parsed = parseStaffExport(text);
  if (parsed.error) { setStatus(status, parsed.error, 'bad'); clearResults(); return; }

  b.busy = true;
  $('bCheck').disabled = true;
  b.batch = [];
  $('bUndo').hidden = true;
  try {
    const sessions = await fetchYearlySessions(layer.id, (n) => setStatus(status, `Checking what’s already on ${layer.title.trim()} (${n} of 4)…`));
    b.existing = existingByTitle(sessions);
    b.rows = planBirthdays(parsed.people, { today: today(), template, feb29To28: $('bFeb29').checked, existing: b.existing });

    // Birthdays on the calendar (in this title format) for people who aren't active staff in the export.
    // An export with no active staff at all is more likely a wrong or filtered file than everyone leaving,
    // so the birthdays are still listed but none are ticked.
    const activeInExport = b.rows.some((r) => r.title);
    b.leavers = planLeavers(b.existing, b.rows, parsed.people, { template, today: today() });
    b.noActiveStaff = !activeInExport && b.leavers.length > 0;
    if (b.noActiveStaff) b.leavers.forEach((l) => { l.preselect = false; });
    b.selectedLeavers = new Set(b.leavers.filter((l) => l.preselect).map((l) => l.instanceId));
    b.confirmingRemove = false;
    setStatus(status, '');
    render();
  } catch (e) {
    setStatus(status, e.message, 'bad');
  } finally {
    b.busy = false;
    $('bCheck').disabled = false;
  }
}

function clearResults() {
  b.rows = []; b.leavers = []; b.selectedLeavers.clear(); b.batch = [];
  $('bSummary').textContent = '';
  $('bResult').innerHTML = '';
  $('bAdd').hidden = true;
  $('bUndo').hidden = true;
  $('bLeavers').hidden = true;
}

// ---------- Rendering ----------

function summaryText() {
  const ready = b.rows.filter((r) => r.status === 'ready').length;
  const already = b.rows.filter((r) => r.onCalendar).length;
  const reasons = new Map();
  for (const r of b.rows) {
    if (r.status === 'ready' || r.onCalendar) continue;
    const key = r.reason.startsWith('Status is') ? 'not active' : r.reason.startsWith('Can’t read') ? 'unreadable date of birth' : r.reason.toLowerCase();
    reasons.set(key, (reasons.get(key) || 0) + 1);
  }
  const parts = [`${plural(b.rows.length, 'person')} in the export.`.replace('persons', 'people')];
  parts.push(`${ready} to add.`);
  if (already) parts.push(`${already} already on the calendar.`);
  if (reasons.size) parts.push(`Skipped: ${[...reasons].map(([k, n]) => `${n} ${k === 'service account' && n > 1 ? 'service accounts' : k}`).join(', ')}.`);
  if (b.leavers.length) parts.push(`${plural(b.leavers.length, 'birthday')} on the calendar ${b.leavers.length === 1 ? 'is' : 'are'} for people no longer active in the export (see below).`);
  return parts.join(' ');
}

function render() {
  $('bSummary').textContent = b.rows.length ? summaryText() : '';

  const table = document.createElement('table');
  table.className = 'rows';
  table.innerHTML = '<thead><tr><th>Name</th><th>Birthday</th><th>Status</th></tr></thead>';
  const tbody = document.createElement('tbody');
  const ordered = [...b.rows].sort((x, y) => (x.status === 'ready' ? 0 : 1) - (y.status === 'ready' ? 0 : 1));
  for (const r of ordered) {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = r.name || '(no name)';
    const when = document.createElement('td');
    when.className = 'sub';
    when.textContent = r.monthDay ? dayAndMonth(r.monthDay) : '';
    const st = document.createElement('td');
    if (r.status === 'ready') {
      st.textContent = r.done ? 'Added' : r.error || (r.note ? `Ready. ${r.note}` : 'Ready');
      st.className = r.done ? 'good' : r.error ? 'bad' : '';
    } else {
      st.textContent = r.reason;
      st.className = r.onCalendar ? 'sub' : 'bad';
    }
    r.statusCell = st;
    tr.append(name, when, st);
    tbody.append(tr);
  }
  table.append(tbody);
  const scroll = document.createElement('div');
  scroll.className = 'scroll';
  scroll.append(table);
  $('bResult').replaceChildren(b.rows.length ? scroll : '');

  const n = b.rows.filter((r) => r.status === 'ready' && !r.done).length;
  $('bAdd').hidden = n === 0;
  $('bAdd').disabled = false;
  $('bAdd').textContent = `Add ${plural(n, 'birthday')} to ${currentLayer().title.trim()}`;
  $('bUndo').hidden = b.batch.length === 0;
  $('bUndo').textContent = `Undo: remove the ${plural(b.batch.length, 'birthday')} just added`;
  renderLeavers();
}

function renderLeavers() {
  $('bLeavers').hidden = b.leavers.length === 0;
  if (!b.leavers.length) return;

  // A filtered export (one role, one site) would make lots of current staff look like leavers.
  const share = b.existing.size ? b.leavers.length / b.existing.size : 0;
  const filtered = b.leavers.length >= 5 && share >= 0.25;
  const warning = b.noActiveStaff
    ? 'This export has no active staff at all, so nothing has been ticked. If that’s right (for example a test file), tick the birthdays to stop.'
    : filtered
      ? `This would stop ${b.leavers.length} of the ${b.existing.size} birthdays on the calendar. If the export was filtered (for example to one role), don’t stop them.`
      : '';
  $('bLeaverWarn').hidden = !warning;
  $('bLeaverWarn').textContent = warning;

  const list = document.createElement('table');
  list.className = 'rows leavers';
  const tbody = document.createElement('tbody');
  for (const leaver of b.leavers) {
    const id = leaver.instanceId;
    const tr = document.createElement('tr');
    const c1 = document.createElement('td');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = b.selectedLeavers.has(id);
    box.setAttribute('aria-label', `Stop ${leaver.title}`);
    box.addEventListener('change', () => {
      if (box.checked) b.selectedLeavers.add(id); else b.selectedLeavers.delete(id);
      endRemoveConfirm();
    });
    c1.append(box);
    const c2 = document.createElement('td');
    const t = document.createElement('div');
    t.textContent = leaver.title;
    const why = document.createElement('div');
    why.className = 'sub';
    why.textContent = leaver.action === 'all'
      ? `${leaver.reason}. Hasn’t had a birthday on the calendar yet, so it will be removed.`
      : `${leaver.reason}. This year’s stays; later years go.`;
    c2.append(t, why);
    if (leaver.note) {
      const n = document.createElement('div');
      n.className = 'sub warn-text';
      n.textContent = leaver.note;
      c2.append(n);
    }
    const c3 = document.createElement('td');
    c3.className = 'sub';
    c3.textContent = dayAndMonth(leaver.monthDay);
    tr.append(c1, c2, c3);
    tbody.append(tr);
  }
  list.append(tbody);
  const scroll = document.createElement('div');
  scroll.className = 'scroll';
  scroll.append(list);
  $('bLeaverList').replaceChildren(scroll);
  updateRemoveButton();
}

function updateRemoveButton() {
  const n = b.selectedLeavers.size;
  $('bRemove').disabled = n === 0;
  $('bRemove').textContent = b.confirmingRemove ? `Yes, stop ${plural(n, 'birthday')}` : (n ? `Stop ${plural(n, 'birthday')}` : 'Stop selected');
}

function endRemoveConfirm() {
  b.confirmingRemove = false;
  $('bKeep').hidden = true;
  $('bRemove').classList.remove('armed');
  updateRemoveButton();
}

// ---------- Actions ----------

async function addBirthdays() {
  if (b.busy) return;
  const status = $('bStatus');
  const layer = currentLayer();
  const problem = layerProblem(layer);
  if (problem && problem.block) { setStatus(status, problem.text, 'bad'); return; }

  const todo = b.rows.filter((r) => r.status === 'ready' && !r.done);
  b.busy = true;
  $('bAdd').disabled = true;
  $('bCheck').disabled = true;
  b.batch = [];
  let failed = 0;
  for (const [i, r] of todo.entries()) {
    setStatus(status, `Adding ${i + 1} of ${todo.length}…`);
    try {
      const created = await callService('CreateEvent', yearlyCreatePayload(r.item, layer.id, state.tz, today()));
      if (created && created.instanceId) { b.batch.push(created.instanceId); r.createdId = created.instanceId; }
      r.done = true;
      r.error = '';
      r.statusCell.textContent = 'Added';
      r.statusCell.className = 'good';
    } catch (e) {
      failed++;
      r.error = e.message;
      r.statusCell.textContent = e.message;
      r.statusCell.className = 'bad';
      if (/not signed in/.test(e.message)) break;
    }
    await pause(250);
  }
  b.busy = false;
  $('bCheck').disabled = false;
  const added = todo.filter((r) => r.done).length;
  const refreshed = added ? await refreshCompass() : false;
  render();
  setStatus(status, `Added ${plural(added, 'birthday')}.` + (failed ? ` ${failed} couldn’t be added; see the list.` : '') +
    (added ? ` ${refreshNote(refreshed, added > 1)}` : ''), failed ? 'bad' : 'good');
}

async function undoBatch() {
  if (b.busy || !b.batch.length) return;
  const status = $('bStatus');
  b.busy = true;
  $('bUndo').disabled = true;
  try {
    const titles = new Map(b.rows.filter((r) => r.createdId).map((r) => [r.createdId, r.title]));
    const result = await runDeletions(b.batch.map((id) => ({ instanceId: id, title: titles.get(id) || 'birthday', mode: DELETE_ALL_SESSIONS })), status, 'Removing');
    result.removed = result.done;
    result.stillThere = result.notDone;
    b.batch = [];
    for (const r of b.rows) if (r.done) { r.done = false; }
    const refreshed = result.removed ? await refreshCompass() : false;
    render();
    const msgs = [`Removed ${plural(result.removed, 'birthday')}.`];
    if (result.stillThere.length) msgs.push(`Compass still shows ${result.stillThere.join(', ')}. Delete ${result.stillThere.length === 1 ? 'it' : 'them'} in Compass.`);
    msgs.push(...result.failures);
    if (result.removed) msgs.push(refreshNote(refreshed, true));
    setStatus(status, msgs.join(' '), result.stillThere.length || result.failures.length ? 'bad' : 'good');
  } catch (e) {
    setStatus(status, e.message, 'bad');
  } finally {
    b.busy = false;
    $('bUndo').disabled = false;
  }
}

async function removeLeavers() {
  if (b.busy || !b.selectedLeavers.size) return;
  const status = $('bStatus');
  const layer = currentLayer();
  const chosen = b.leavers.filter((l) => b.selectedLeavers.has(l.instanceId));
  if (!b.confirmingRemove) {
    b.confirmingRemove = true;
    $('bKeep').hidden = false;
    $('bRemove').classList.add('armed');
    updateRemoveButton();
    const whole = chosen.filter((l) => l.action === 'all').length;
    setStatus(status, `${plural(chosen.length, 'birthday')} will stop showing on ${layer.title.trim()} from the next one onwards.` +
      (whole ? ` ${whole} ${whole === 1 ? 'hasn’t' : 'haven’t'} happened yet this year, so ${whole === 1 ? 'it goes' : 'they go'} completely.` : ` This year’s ${chosen.length === 1 ? 'birthday stays' : 'birthdays stay'}.`) +
      ' This can’t be undone from here.', 'bad');
    return;
  }
  endRemoveConfirm();
  b.busy = true;
  $('bRemove').disabled = true;
  try {
    const jobs = chosen.map((l) => ({ instanceId: l.instanceId, title: l.title, mode: l.action === 'all' ? DELETE_ALL_SESSIONS : DELETE_THIS_AND_FUTURE }));
    const result = await runDeletions(jobs, status, 'Stopping');
    const refreshed = result.done ? await refreshCompass() : false;
    b.busy = false;
    await checkList(); // refresh both lists
    const msgs = [`Stopped ${plural(result.done, 'birthday')}.`];
    if (result.notDone.length) msgs.push(`Compass still shows future birthdays for ${result.notDone.join(', ')}. Delete ${result.notDone.length === 1 ? 'it' : 'them'} in Compass.`);
    if (result.skipped.length) msgs.push(`Skipped ${result.skipped.join(', ')}.`);
    msgs.push(...result.failures);
    if (result.done) msgs.push(refreshNote(refreshed, true));
    setStatus(status, msgs.join(' '), result.notDone.length || result.failures.length ? 'bad' : 'good');
  } catch (e) {
    setStatus(status, e.message, 'bad');
  } finally {
    b.busy = false;
  }
}

// ---------- Setup ----------

export function onBirthdaysShown() {
  const problem = layerProblem(currentLayer());
  $('bLayerNote').hidden = !problem;
  $('bLayerNote').textContent = problem ? problem.text : '';
  $('bLayerNote').classList.toggle('warn', !!(problem && problem.block));
  $('bCheck').disabled = !!(problem && problem.block);
}

export function resetBirthdays() {
  clearResults();
  setStatus($('bStatus'), '');
  if (!$('panelBirthdays').hidden) onBirthdaysShown();
}

export function initBirthdays() {
  $('bTemplate').value = DEFAULT_TEMPLATE;
  $('bFile').addEventListener('change', async () => {
    const file = $('bFile').files[0];
    if (!file) return;
    b.text = await file.text();
    $('bText').value = '';
    clearResults();
    setStatus($('bStatus'), `Loaded ${file.name}. Click Check staff list.`);
  });
  const changed = () => { if (b.rows.length) { clearResults(); setStatus($('bStatus'), 'Settings changed. Check the staff list again.'); } };
  $('bText').addEventListener('input', changed);
  $('bTemplate').addEventListener('input', changed);
  $('bFeb29').addEventListener('change', changed);
  $('bCheck').addEventListener('click', checkList);
  $('bAdd').addEventListener('click', addBirthdays);
  $('bUndo').addEventListener('click', undoBatch);
  $('bRemove').addEventListener('click', removeLeavers);
  $('bKeep').addEventListener('click', () => { endRemoveConfirm(); setStatus($('bStatus'), ''); });
}
