// Pure helpers with no Chrome APIs, so they can be tested in Node.

export const DEFAULT_TZ = 'Australia/Perth';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// ---------- Dates & times ----------

function validYmd(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? [y, m, d] : null;
}

// Accepts 2026-08-11, 11/8/2026, 11/08/26, 11.8.2026, 11 Aug 2026, Tue 11 Aug 2026.
// Slash dates are read day-first (Australian format).
export function parseDate(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return validYmd(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return validYmd(y, +m[2], +m[1]);
  }
  if ((m = s.match(/^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/))) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mi < 0 ? null : validYmd(+m[3], mi + 1, +m[1]);
  }
  return null;
}

// Returns [h, m], null for blank, or undefined for unreadable input.
// Accepts 9:00, 09:30, 14:30, 9am, 2:30pm, 9.15am. A bare "9" is rejected as ambiguous.
export function parseTime(input) {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a|p)?$/);
  if (!m) return undefined;
  let h = +m[1];
  const mi = m[2] ? +m[2] : 0;
  const ap = m[3];
  if (ap) {
    if (h < 1 || h > 12) return undefined;
    if (ap[0] === 'p' && h !== 12) h += 12;
    if (ap[0] === 'a' && h === 12) h = 0;
  } else if (!m[2]) {
    return undefined;
  }
  if (h > 23 || mi > 59) return undefined;
  return [h, mi];
}

function tzOffsetMinutes(tz, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}

// Wall-clock time in the school's timezone -> UTC Date. Handles DST schools too.
export function zonedToUtc([y, m, d], [h, mi], tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off1 = tzOffsetMinutes(tz, new Date(guess));
  let t = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(tz, new Date(t));
  if (off2 !== off1) t = guess - off2 * 60000;
  return new Date(t);
}

export function isValidTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

const dayNumber = ([y, m, d]) => Date.UTC(y, m - 1, d) / 86400000;

// ---------- Items ----------

// raw: { title, date, endDate, startTime, endTime, description, location } (strings)
export function normalizeItem(raw) {
  const errors = [];
  const title = (raw.title || '').trim();
  if (!title) errors.push('Title is missing');

  const date = parseDate(raw.date);
  if (!date) errors.push(raw.date ? `Can't read date “${raw.date}”` : 'Date is missing');

  let endDate = null;
  if (raw.endDate && String(raw.endDate).trim()) {
    endDate = parseDate(raw.endDate);
    if (!endDate) errors.push(`Can't read end date “${raw.endDate}”`);
  }

  const startTime = parseTime(raw.startTime);
  const endTime = parseTime(raw.endTime);
  if (startTime === undefined) errors.push(`Can't read start time “${raw.startTime}” (try 9:00 or 9am)`);
  if (endTime === undefined) errors.push(`Can't read end time “${raw.endTime}” (try 3:30pm)`);
  if (!startTime && endTime) errors.push('End time given without a start time');

  const allDay = !startTime;
  const last = endDate || date;

  if (date && endDate && dayNumber(endDate) < dayNumber(date)) errors.push('End date is before the start date');

  if (date && !allDay && startTime && endTime && last && errors.length === 0) {
    const s = dayNumber(date) * 1440 + startTime[0] * 60 + startTime[1];
    const e = dayNumber(last) * 1440 + endTime[0] * 60 + endTime[1];
    if (e <= s) errors.push('Finishes before it starts');
  }

  return {
    errors,
    item: errors.length ? null : {
      title, date, endDate, allDay,
      startTime: startTime || null,
      endTime: endTime || null,
      description: (raw.description || '').trim(),
      location: (raw.location || '').trim(),
    },
  };
}

export function itemTimes(item, tz) {
  const last = item.endDate || item.date;
  if (item.allDay) {
    // Matches what Compass stores for all-day items: 00:00 on the first day to 01:00 on the last day.
    return { start: zonedToUtc(item.date, [0, 0], tz), finish: zonedToUtc(last, [1, 0], tz) };
  }
  const start = zonedToUtc(item.date, item.startTime, tz);
  const finish = item.endTime
    ? zonedToUtc(last, item.endTime, tz)
    : new Date(zonedToUtc(last, item.startTime, tz).getTime() + 60 * 60000);
  return { start, finish };
}

// Mirrors the body the Compass calendar page sends to Calendar.svc/CreateEvent.
// The Compass page sends allDay=true only when an item crosses midnight; Compass itself then marks
// 00:00-01:00 items as all-day. Sending the same flag keeps requests identical to the page's.
export function pageAllDayFlag(start, finish, tz) {
  const a = zonedParts(start, tz).date, b = zonedParts(new Date(finish.getTime() + 1), tz).date;
  return a.join('-') !== b.join('-');
}

export function toCreatePayload(item, calendarId, tz, repeat = null) {
  const { start, finish } = itemTimes(item, tz);
  return {
    guid: '', calendarId, title: item.title, RecurRule: '', Location: item.location || '', Notes: '', Url: '',
    allDay: pageAllDayFlag(start, finish, tz), Reminder: '', isRecurring: false, eventSetupStatus: null, CategoryIds: '',
    targetStudentId: 0, longTitle: '', longTitleWithoutTime: '', instanceId: '', managerId: 0, activityId: 0,
    rollMarked: false, activityType: 0, backgroundColor: '', textColor: '', description: item.description || '',
    runningStatus: 0, attendanceMode: 0, unavailablePd: '', inClassStatus: null, lessonPlanConfigured: false,
    learningTaskId: null, learningTaskActivityId: null, subjectId: null, repeat: false, repeatFrequency: 0,
    repeatDays: null, repeatUntil: null, teachingDaysOnly: false, repeatForever: false, repeatType: 1,
    modificationMode: 0, minutesMeetingId: '', period: '',
    start: start.toISOString(), finish: finish.toISOString(),
    recurringStart: null, recurringFinish: null, occurrenceStart: null,
    ...(repeat ? repeatFields(repeat, tz) : {}),
  };
}

export const itemKey = (title, startIso) =>
  `${String(title).trim().toLowerCase()}|${new Date(startIso).toISOString()}`;

// Local date range (yyyy-mm-dd) to ask Compass for when checking duplicates.
export function lookupRange(items) {
  let lo = Infinity, hi = -Infinity;
  for (const it of items) {
    lo = Math.min(lo, dayNumber(it.date));
    hi = Math.max(hi, dayNumber(it.endDate || it.date));
  }
  const fmt = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
  return { startDate: fmt(lo - 1), endDate: fmt(hi + 1) };
}

// ---------- Display ----------

const fmtDay = ([y, m, d], withYear) => new Intl.DateTimeFormat('en-AU', {
  timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
}).format(new Date(Date.UTC(y, m - 1, d)));

export const fmtTime = ([h, mi]) => `${h % 12 || 12}:${String(mi).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;

export function describeWhen(item) {
  const multi = item.endDate && dayNumber(item.endDate) !== dayNumber(item.date);
  const days = multi ? `${fmtDay(item.date)} – ${fmtDay(item.endDate, true)}` : fmtDay(item.date, true);
  if (item.allDay) return `${days}, all day`;
  const end = item.endTime ? item.endTime : [(item.startTime[0] + 1) % 24, item.startTime[1]];
  return `${days}, ${fmtTime(item.startTime)}–${fmtTime(end)}`;
}

// ---------- Bulk paste ----------

export const COLUMN_ORDER = ['date', 'endDate', 'title', 'startTime', 'endTime', 'description'];

const HEADER_ALIASES = {
  date: ['date', 'start date', 'from', 'day', 'from date', 'start day'],
  endDate: ['end date', 'to', 'until', 'finish date', 'end day', 'to date'],
  title: ['title', 'event', 'name', 'item', 'what', 'event name'],
  startTime: ['start time', 'start', 'time', 'from time'],
  endTime: ['end time', 'end', 'finish', 'finish time', 'to time'],
  description: ['description', 'notes', 'details', 'note', 'desc'],
  location: ['location', 'where', 'venue', 'place'],
};

function headerKey(cell) {
  const c = cell.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return Object.keys(HEADER_ALIASES).find((k) => HEADER_ALIASES[k].includes(c)) || null;
}

// Tab-separated (pasted from Excel/Sheets) or CSV with quotes.
export function parseDelimited(text) {
  const delim = text.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell.trim() === '') { quoted = true; cell = ''; }
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

export function parseBulk(text) {
  const table = parseDelimited(text || '');
  if (!table.length) return { rows: [], hasHeader: false, error: null };

  let columns = COLUMN_ORDER;
  let hasHeader = false;
  const first = table[0];
  if (!first.some((c) => parseDate(c))) {
    const keys = first.map(headerKey);
    if (keys.includes('date') && keys.includes('title')) {
      columns = keys;
      hasHeader = true;
    } else if (keys.some(Boolean)) {
      return { rows: [], hasHeader: true, error: 'The header row needs at least a “Date” and a “Title” column.' };
    }
  }

  const rows = table.slice(hasHeader ? 1 : 0).map((cells, i) => {
    const raw = {};
    columns.forEach((key, ci) => { if (key && cells[ci] != null && raw[key] == null) raw[key] = cells[ci]; });
    const { item, errors } = normalizeItem(raw);
    return { line: i + 1 + (hasHeader ? 1 : 0), raw, item, errors };
  });
  return { rows, hasHeader, error: null };
}

// ---------- Existing items (edit & delete) ----------

// UTC Date -> wall-clock parts in the school's timezone.
export function zonedParts(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: [+p.year, +p.month, +p.day], time: [+p.hour, +p.minute] };
}

export const ymdString = ([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const hmString = ([h, mi]) => `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
export const addDays = (ymd, n) => {
  const t = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2] + n));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
};

// A Compass event record -> the same item shape the add form uses.
export function eventToItem(ev, tz) {
  const start = new Date(ev.start);
  const finish = new Date(ev.finish);
  const s = zonedParts(start, tz);
  if (ev.allDay) {
    // All-day items end at 01:00 (or 23:59:59) on the last day; step back a minute so a 00:00 end counts as the day before.
    const last = zonedParts(new Date(Math.max(start.getTime(), finish.getTime() - 60000)), tz).date;
    const sameDay = ymdString(last) === ymdString(s.date);
    return { title: ev.title || '', date: s.date, endDate: sameDay ? null : last, allDay: true,
      startTime: null, endTime: null, description: ev.description || '', location: '' };
  }
  const f = zonedParts(finish, tz);
  const sameDay = ymdString(f.date) === ymdString(s.date);
  return { title: ev.title || '', date: s.date, endDate: sameDay ? null : f.date, allDay: false,
    startTime: s.time, endTime: f.time, description: ev.description || '', location: '' };
}

// Mirrors the body the Compass calendar page sends to UpdateEvent ('update') and CancelEvent ('delete').
// `ev` must be a record fetched from Compass (or returned by CreateEvent/UpdateEvent).
export function toExistingPayload(ev, kind, changes = {}) {
  const iso = (v) => (v ? new Date(v).toISOString() : v);
  return {
    guid: ev.guid, calendarId: ev.calendarId, title: ev.title, RecurRule: '', Location: '', Notes: '', Url: '',
    allDay: !!ev.allDay, Reminder: '', isRecurring: !!ev.isRecurring, eventSetupStatus: ev.eventSetupStatus ?? null,
    CategoryIds: '', targetStudentId: kind === 'update' ? (ev.targetStudentId || 0) : 0,
    longTitle: ev.longTitle || '', longTitleWithoutTime: ev.longTitleWithoutTime || '', instanceId: ev.instanceId,
    managerId: ev.managerId || 0, activityId: ev.activityId, rollMarked: !!ev.rollMarked, activityType: ev.activityType,
    backgroundColor: ev.backgroundColor || '', textColor: ev.textColor || '', description: ev.description || '',
    runningStatus: ev.runningStatus ?? 1, attendanceMode: ev.attendanceMode ?? 2, unavailablePd: ev.unavailablePd ?? null,
    inClassStatus: ev.inClassStatus ?? null, lessonPlanConfigured: !!ev.lessonPlanConfigured,
    learningTaskId: ev.learningTaskId ?? null, learningTaskActivityId: ev.learningTaskActivityId ?? null,
    subjectId: ev.subjectId ?? null, repeat: false, repeatFrequency: ev.repeatFrequency || 0, repeatDays: ev.repeatDays ?? null,
    repeatUntil: ev.repeatUntil ?? null, teachingDaysOnly: !!ev.teachingDaysOnly, repeatForever: !!ev.repeatForever,
    repeatType: kind === 'update' ? 1 : 0, modificationMode: 0, minutesMeetingId: ev.minutesMeetingId || '',
    period: ev.period || '', start: iso(ev.start), finish: iso(ev.finish),
    recurringStart: null, recurringFinish: null, occurrenceStart: null,
    ...changes,
  };
}

// Changes to send when an item is edited through the form.
export function editChanges(item, tz) {
  const { start, finish } = itemTimes(item, tz);
  return { title: item.title, description: item.description, allDay: pageAllDayFlag(start, finish, tz),
    start: start.toISOString(), finish: finish.toISOString() };
}

// Fields that tell us whether someone else changed the item since it was loaded.
export const eventFingerprint = (ev) =>
  JSON.stringify([ev.title || '', ev.description || '', new Date(ev.start).toISOString(), new Date(ev.finish).toISOString()]);


// ---------- Repeating items ----------
// Compass: repeatType 1 = weekly, repeatDays 0 = Sunday ... 6 = Saturday, repeatFrequency = every N weeks,
// repeatUntil = midnight (school time) at the start of the last day. modificationMode 0 = just this session,
// 1 = this and future sessions, 2 = all sessions.

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const weekday = ([y, m, d]) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

// raw: { every, days: [0-6], until, teachingDaysOnly }
export function normalizeRepeat(raw, item) {
  const errors = [];
  const every = Number(raw.every);
  if (!Number.isInteger(every) || every < 1 || every > 52) errors.push('Repeat every must be a whole number of weeks from 1 to 52');
  const days = [...new Set((raw.days || []).map(Number))].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (!days.length) errors.push('Choose at least one day to repeat on');
  const until = parseDate(raw.until);
  if (!until) errors.push(raw.until ? `Can't read repeat-until date “${raw.until}”` : 'Choose the date the repeats stop');
  else if (item && dayNumber(until) < dayNumber(item.date)) errors.push('Repeats stop before the first date');
  else if (item && dayNumber(until) - dayNumber(item.date) > 800) errors.push('Repeats can run for at most two years');
  if (item && item.endDate && dayNumber(item.endDate) !== dayNumber(item.date)) errors.push('Repeating items must start and finish on the same day');
  return { errors, repeat: errors.length ? null : { every, days, until, teachingDaysOnly: !!raw.teachingDaysOnly } };
}

export function repeatFields(repeat, tz) {
  return {
    repeat: true, repeatType: 1, repeatFrequency: repeat.every, repeatDays: repeat.days,
    repeatUntil: zonedToUtc(repeat.until, [0, 0], tz).toISOString(),
    teachingDaysOnly: repeat.teachingDaysOnly, repeatForever: false,
  };
}

const listDays = (days) => {
  const names = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY_NAMES[d]); // Monday first
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
};

export function describeRepeat(repeat) {
  const often = repeat.every === 1 ? 'every week' : `every ${repeat.every} weeks`;
  return `Repeats ${often} on ${listDays(repeat.days)} until ${fmtDay(repeat.until, true)}` +
    (repeat.teachingDaysOnly ? ', teaching days only' : '');
}

// The repeat settings stored on a Compass record, or null for non-weekly/forever series we don't handle.
export function eventRepeat(ev, tz) {
  if (!ev.isRecurring) return null;
  if ((ev.repeatType || 1) !== 1 || ev.repeatForever || !ev.repeatUntil || !ev.repeatDays || !ev.repeatDays.length) return null;
  return {
    every: ev.repeatFrequency || 1, days: [...ev.repeatDays].sort((a, b) => a - b),
    until: zonedParts(new Date(ev.repeatUntil), tz).date, teachingDaysOnly: !!ev.teachingDaysOnly,
  };
}

export const seriesKey = (ev) => `series|${ev.calendarId}|${ev.instanceId}`;

// The series' first session as an item, for the "edit all sessions" form.
export const seriesItem = (ev, tz) =>
  eventToItem({ ...ev, start: ev.recurringStart || ev.start, finish: ev.recurringFinish || ev.finish }, tz);

export const seriesFingerprint = (ev) => JSON.stringify([
  ev.title || '', ev.description || '', ev.recurringStart, ev.recurringFinish, ev.repeatDays, ev.repeatUntil,
  ev.repeatFrequency, !!ev.teachingDaysOnly,
].map((v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v).toISOString() : v)));

// Mirrors what the Compass page sends for "Edit all sessions".
export function seriesEditPayload(ev, item, repeat, tz) {
  const changes = editChanges(item, tz);
  return toExistingPayload(ev, 'update', {
    ...changes, ...repeatFields(repeat, tz), isRecurring: true, modificationMode: 2,
    recurringStart: changes.start, recurringFinish: changes.finish,
  });
}

// ---------- School terms & weeks ----------
// Compass terms look like { n: "Term 3", s: "20/07/2026", f: "25/09/2026" }.

export function buildTerms(raw) {
  return (raw || [])
    .map((t) => ({ id: t.id, name: t.n, start: parseDate(t.s), finish: parseDate(t.f) }))
    .filter((t) => t.start && t.finish)
    .sort((a, b) => dayNumber(a.start) - dayNumber(b.start));
}

export const mondayOf = (ymd) => addDays(ymd, -((weekday(ymd) + 6) % 7));
export const sameDay = (a, b) => !!a && !!b && dayNumber(a) === dayNumber(b);
export const compareDays = (a, b) => dayNumber(a) - dayNumber(b);

// A "period" is a term plus the holidays that follow it, so nothing falls between the cracks.
export function termPeriods(terms) {
  return terms.map((t, i) => {
    const next = terms[i + 1];
    const end = next ? addDays(next.start, -1) : addDays(t.finish, 21);
    return { term: t, start: mondayOf(t.start), end, label: `${t.name}, ${t.start[0]}` };
  });
}

export function periodIndexFor(periods, ymd) {
  if (!periods.length) return -1;
  const n = dayNumber(ymd);
  const i = periods.findIndex((p) => n >= dayNumber(p.start) && n <= dayNumber(p.end));
  if (i >= 0) return i;
  return n < dayNumber(periods[0].start) ? 0 : periods.length - 1;
}

// Eight-week window used when Compass doesn't return terms.
export function fallbackPeriod(ymd, offsetWeeks = 0) {
  const start = addDays(mondayOf(ymd), offsetWeeks * 7);
  return { term: null, start, end: addDays(start, 55), label: `Weeks from ${fmtDay(start, true)}` };
}

export function weeksOf(period) {
  const weeks = [];
  for (let mon = mondayOf(period.start); dayNumber(mon) <= dayNumber(period.end); mon = addDays(mon, 7)) {
    const t = period.term;
    let label;
    if (!t) label = `Week of ${fmtDay(mon)}`;
    else if (dayNumber(mon) > dayNumber(t.finish)) label = 'Holidays';
    else label = `Week ${Math.floor((dayNumber(mon) - dayNumber(mondayOf(t.start))) / 7) + 1}`;
    weeks.push({ monday: mon, sunday: addDays(mon, 6), label });
  }
  return weeks;
}

// "Term 3 week 5", "school holidays" or null, for reading a date back to the user.
export function schoolWeekLabel(terms, ymd) {
  const n = dayNumber(ymd);
  const t = terms.find((x) => n >= dayNumber(mondayOf(x.start)) && n <= dayNumber(x.finish));
  if (t) return `${t.name} week ${Math.floor((dayNumber(mondayOf(ymd)) - dayNumber(mondayOf(t.start))) / 7) + 1}`;
  const inYear = terms.some((x) => x.start[0] === ymd[0]);
  return inYear ? 'school holidays' : null;
}

export const shortDay = ([y, m, d]) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short' })
  .format(new Date(Date.UTC(y, m - 1, d)));
export const dayMonth = ([y, m, d], withWeekday = true) => new Intl.DateTimeFormat('en-AU', {
  timeZone: 'UTC', day: 'numeric', month: 'short', ...(withWeekday ? { weekday: 'short' } : {}),
}).format(new Date(Date.UTC(y, m - 1, d))).replace(',', '');

// Short time label for a list row.
export function timeLabel(item) {
  if (item.allDay) return '';
  const end = item.endTime || [(item.startTime[0] + 1) % 24, item.startTime[1]];
  return `${fmtTime(item.startTime)}–${fmtTime(end)}`;
}

// "14–18 Sept", "28 Sept – 2 Oct", "29 Dec – 2 Jan 2027"
export function rangeLabel(a, b) {
  const month = (ymd) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', month: 'short' }).format(new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2])));
  if (a[0] !== b[0]) return `${a[2]} ${month(a)} ${a[0]} – ${b[2]} ${month(b)} ${b[0]}`;
  if (a[1] !== b[1]) return `${a[2]} ${month(a)} – ${b[2]} ${month(b)}`;
  return a[2] === b[2] ? `${a[2]} ${month(a)}` : `${a[2]}–${b[2]} ${month(b)}`;
}

// Mirrors what the Compass page sends to CancelEvent for a repeating item, from the session that was clicked.
// mode 2 = all sessions; mode 1 = this session and every later one (Compass moves the series' end to the day before).
// The page sends most numbers as text here (e.g. "calendarId":"10001", "repeatDays":["2","5"]), so we do too.
export const DELETE_ALL_SESSIONS = 2;
export const DELETE_THIS_AND_FUTURE = 1;

export function seriesDeletePayload(session, mode = DELETE_ALL_SESSIONS) {
  const text = (v) => (v == null ? v : String(v));
  const iso = (v) => new Date(v).toISOString();
  const ev = session;
  return {
    guid: ev.guid, calendarId: text(ev.calendarId), title: ev.title, RecurRule: '', Location: '', Notes: '', Url: '',
    allDay: !!ev.allDay, Reminder: '', isRecurring: true, eventSetupStatus: ev.eventSetupStatus ?? null, CategoryIds: '',
    targetStudentId: text(ev.targetStudentId ?? 0), longTitle: ev.longTitle || '', longTitleWithoutTime: ev.longTitleWithoutTime || '',
    instanceId: ev.instanceId, managerId: text(ev.managerId ?? 0), activityId: text(ev.activityId ?? 0),
    rollMarked: !!ev.rollMarked, activityType: text(ev.activityType), backgroundColor: ev.backgroundColor || '',
    textColor: ev.textColor || '', description: ev.description || '', runningStatus: text(ev.runningStatus ?? 1),
    attendanceMode: text(ev.attendanceMode ?? 2), unavailablePd: ev.unavailablePd ?? null, inClassStatus: ev.inClassStatus ?? null,
    lessonPlanConfigured: !!ev.lessonPlanConfigured, learningTaskId: ev.learningTaskId ?? null,
    learningTaskActivityId: ev.learningTaskActivityId ?? null, subjectId: ev.subjectId ?? null, repeat: false,
    repeatFrequency: text(ev.repeatFrequency ?? 1), repeatDays: (ev.repeatDays || []).map(String),
    repeatUntil: ev.repeatUntil ?? null, teachingDaysOnly: !!ev.teachingDaysOnly, repeatForever: !!ev.repeatForever,
    repeatType: text(ev.repeatType ?? 1), modificationMode: text(mode), minutesMeetingId: ev.minutesMeetingId || '',
    period: ev.period || '', start: iso(ev.start), finish: iso(ev.finish),
    recurringStart: iso(ev.recurringStart || ev.start), recurringFinish: iso(ev.recurringFinish || ev.finish),
    occurrenceStart: null,
  };
}

// ---------- Staff birthdays (yearly repeating items) ----------
// Compass yearly repeat: repeatType 3, repeatFrequency 0, no repeat days, repeatForever true.
// The Compass page also sends repeatUntil (its date picker's default of today) even when Forever is ticked.

export const REPEAT_YEARLY = 3;

export const isServiceAccount = (name) => /\)\s*$/.test((name || '').trim()) || /replacement/i.test(name || '');

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayAndMonth = ([m, d]) => `${d} ${MONTH_SHORT[m - 1]}`;

// Reads the Compass staff export (CSV, or rows copied from Excel). Only name, date of birth and status are used.
export function parseStaffExport(text) {
  const table = parseDelimited(text || '');
  if (!table.length) return { error: 'There’s nothing in that file.' };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const find = (...names) => header.findIndex((h) => names.includes(h));
  const iName = find('full name', 'name', 'staff name');
  const iDob = find('date of birth', 'dob', 'birthday', 'birth date', 'date of birth (dd/mm/yyyy)');
  const iStatus = find('status');
  if (iName < 0 || iDob < 0) {
    return { error: 'This doesn’t look like the staff export. It needs “Full Name” and “Date Of Birth” columns.' };
  }
  const people = table.slice(1).map((cells) => ({
    name: (cells[iName] || '').trim(),
    dobText: (cells[iDob] || '').trim(),
    status: iStatus >= 0 ? (cells[iStatus] || '').trim() : '',
  })).filter((p) => p.name || p.dobText);
  return { people, hasStatus: iStatus >= 0 };
}

export const birthdayTitle = (template, name) => template.replace(/\{name\}/gi, name).trim();

// Turns "{name}'s birthday" into a matcher that pulls the name back out of an existing title.
export function titleMatcher(template) {
  const parts = template.split(/\{name\}/i).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`^${parts.join('(.+)')}$`, 'i');
  return (title) => { const m = (title || '').trim().match(re); return m ? m[1].trim() : null; };
}

// people: from parseStaffExport. existing: Map of lower-case title -> { title, monthDay:[m,d] } for yearly items already on the calendar.
export function planBirthdays(people, { today, template, feb29To28 = true, existing = new Map() }) {
  const seen = new Map();
  return people.map((p) => {
    const row = { name: p.name, status: 'skip', reason: '', monthDay: null, title: '', item: null, note: '' };
    if (!p.name) { row.reason = 'No name'; return row; }
    if (isServiceAccount(p.name)) { row.reason = 'Service account'; return row; }
    if (p.status && !/^active$/i.test(p.status)) { row.reason = `Status is ${p.status}`; return row; }
    const dob = parseDate(p.dobText);
    if (!dob) { row.reason = p.dobText ? `Can’t read date of birth “${p.dobText}”` : 'No date of birth'; return row; }
    if (dayNumber(dob) > dayNumber(today)) { row.reason = 'Date of birth is in the future'; return row; }

    let [, m, d] = dob;
    if (m === 2 && d === 29) {
      if (!feb29To28) { row.reason = 'Born 29 February'; return row; }
      d = 28;
      row.note = 'Born 29 Feb, shown on 28 Feb';
    }
    row.monthDay = [m, d];
    row.title = birthdayTitle(template, p.name);
    const key = row.title.toLowerCase();

    if (seen.has(key)) { row.reason = 'Listed twice in the export'; return row; }
    seen.set(key, true);

    const there = existing.get(key);
    if (there) {
      row.reason = there.monthDay[0] === m && there.monthDay[1] === d
        ? 'Already on the calendar'
        : `Already on the calendar on ${dayAndMonth(there.monthDay)}`;
      if (there.startYear && there.startYear < today[0]) row.reason += `, repeating since ${there.startYear}`;
      row.onCalendar = true;
      return row;
    }
    // First session is this year's birthday, so the series lines up with the current calendar year.
    row.item = { title: row.title, date: [today[0], m, d], endDate: null, allDay: true, startTime: null, endTime: null, description: '', location: '' };
    row.status = 'ready';
    return row;
  });
}

// Mirrors the CreateEvent body the Compass page sends for an all-day item repeating yearly, forever.
export function yearlyCreatePayload(item, calendarId, tz, today) {
  return {
    ...toCreatePayload(item, calendarId, tz),
    repeat: true, repeatFrequency: 0, repeatDays: [], repeatUntil: zonedToUtc(today, [0, 0], tz).toISOString(),
    teachingDaysOnly: false, repeatForever: true, repeatType: REPEAT_YEARLY,
  };
}

// Which birthdays on the calendar should stop, and why.
// existing: Map from existingByTitle-style data { title, monthDay, startYear, record }.
export function planLeavers(existing, rows, people, { template, today }) {
  const nameFromTitle = titleMatcher(template);
  const keep = new Set(rows.filter((r) => r.title).map((r) => r.title.toLowerCase()));
  const byName = new Map();
  rows.forEach((r) => { if (r.name) byName.set(r.name.trim().toLowerCase(), r); });
  const adding = rows.filter((r) => r.status === 'ready');
  const leavers = [];
  for (const e of existing.values()) {
    const name = nameFromTitle(e.title);
    if (!name || keep.has(e.title.trim().toLowerCase())) continue;
    const row = byName.get(name.toLowerCase());
    let reason; let preselect = true; let note = '';
    if (!row) reason = 'Not in the export';
    else if (row.reason === 'Service account') reason = 'Now listed as a service account';
    else if (row.reason.startsWith('Status is')) reason = row.reason;
    else { reason = `${row.reason} in the export`; preselect = false; } // a data problem, not necessarily a leaver
    // A new person with the same birthday may be a name change rather than someone leaving.
    const twin = adding.find((r) => r.monthDay[0] === e.monthDay[0] && r.monthDay[1] === e.monthDay[1]);
    if (twin) { note = `Same birthday as ${twin.name}, who is being added. Check it isn’t a name change.`; preselect = false; }
    const startsFuture = compareDays([e.startYear, e.monthDay[0], e.monthDay[1]], today) > 0 && e.startYear >= today[0];
    leavers.push({ ...e, name, reason, note, preselect, action: startsFuture ? 'all' : 'future' });
  }
  return leavers.sort((x, y) => x.title.localeCompare(y.title));
}
