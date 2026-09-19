import { DEFAULT_TZ } from './lib.js';

export const $ = (id) => document.getElementById(id);

export const state = {
  tabId: null, tz: DEFAULT_TZ, userId: null, onCalendar: false, host: '', layers: [],
};

const SVC = '/Services/Calendar.svc/';
const EVENTS_QUERY = 'GetCalendarEventsByUser?sessionstate=readonly&includeEvents=true&includeExams=true' +
  '&includeVolunteeringEvent=true&ExcludeNonRelevantPd=false&includeClubs=true&includeCompassExams=true';

// ---------- Functions injected into the Compass tab (must be self-contained) ----------

export function pageContext() {
  const C = window.Compass || {};
  const G = window.GlobalCalendarData || null;
  return {
    tz: (C.attributes && C.attributes.SchoolTimezone) || null,
    userId: (G && G.viewingUserId) || C.organisationUserId || null,
    editableIds: G ? G.editableCalendarLayerIds : null,
    onCalendar: location.pathname.toLowerCase().startsWith('/organise/calendar'),
    host: location.host,
  };
}

async function pagePost(path, body) {
  try {
    const r = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body),
    });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { status: 0, text: String(e) };
  }
}

async function pageGet(path) {
  try {
    const r = await fetch(path, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { status: 0, text: String(e) };
  }
}

function pageRefreshCalendar() {
  try {
    const cal = window.Ext && Ext.ComponentQuery.query('calendarmanagerwidget')[0];
    const view = cal && cal.getActiveView && cal.getActiveView();
    if (view && view.refresh) { view.refresh(true); return true; }
  } catch (e) { /* fall through */ }
  return false;
}

// ---------- Plumbing ----------

export async function inPage(func, args = []) {
  let res;
  try {
    [res] = await chrome.scripting.executeScript({ target: { tabId: state.tabId }, world: 'MAIN', func, args });
  } catch (e) {
    // This page stays open, so the Compass tab it was using may have been closed since.
    throw new Error(`Could not reach the Compass tab (${e.message}). Keep a Compass tab open, then reload this page.`);
  }
  if (!res) throw new Error('Could not reach the Compass tab. Reload it and try again.');
  return res.result;
}

function readResponse({ status, text }) {
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (status === 200 && json && 'd' in json) return json.d;
  if (status === 0) throw new Error(`Couldn't connect to Compass: ${text}`);
  if (status === 401 || status === 403 || (!json && /<html/i.test(text))) {
    throw new Error('Compass says you are not signed in. Sign in again in the Compass tab, then retry.');
  }
  const msg = (json && (json.Message || json.message || json.ExceptionMessage)) || text.slice(0, 200) || 'no details';
  throw new Error(`Compass rejected the request (HTTP ${status}): ${msg}`);
}

export async function callService(method, body) {
  const path = SVC + (method.includes('?') ? method : `${method}?sessionstate=readonly`);
  return readResponse(await inPage(pagePost, [path, body]));
}

// School terms, as the calendar page loads them. Returns [] if unavailable.
export async function fetchTerms() {
  try {
    return (await readResponse(await inPage(pageGet, ['/Services/ReferenceDataCache.svc/GetAllTerms?page=1&start=0&limit=25']))) || [];
  } catch {
    return [];
  }
}

// startDate/endDate are local yyyy-mm-dd strings, as the Compass calendar page sends them.
export async function fetchEvents(startDate, endDate) {
  if (!state.userId) throw new Error('Compass didn’t say who is signed in. Open the Calendar page in Compass and try again.');
  const events = await callService(EVENTS_QUERY, {
    userId: state.userId, homePage: false, activityId: null, subjectId: null, locationId: null, staffIds: null,
    startDate, endDate, page: 1, start: 0, limit: 25,
  });
  return events || [];
}

export async function findCompassTab() {
  const isCompass = (t) => t && t.url && /^https:\/\/[^/]+\.compass\.education\//.test(t.url);
  // The toolkit menu passes along the tab it was opened from, which is the one the popup used to look at.
  const opener = Number(new URLSearchParams(location.search).get('tab'));
  if (opener) {
    const from = await chrome.tabs.get(opener).catch(() => null);
    if (isCompass(from)) return from;
  }
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (isCompass(active)) return active;
  const tabs = await chrome.tabs.query({ url: 'https://*.compass.education/*' });
  return tabs[0] || null;
}

export async function refreshCompass() {
  if (!state.onCalendar) return false;
  try { return await inPage(pageRefreshCalendar); } catch { return false; }
}

export const refreshNote = (refreshed, plural = false) =>
  refreshed ? 'The Compass tab has been refreshed.' : `Reload the Compass calendar to see ${plural ? 'the changes' : 'the change'}.`;

// ---------- Small UI helpers ----------

export function setStatus(el, text, kind = '') {
  el.textContent = text;
  el.className = `status ${kind}`;
}

export const currentLayer = () => state.layers.find((l) => String(l.id) === $('layer').value);

export const isFamilyLayer = (layer) => /parent|student|public|community/i.test(layer.title);

export const pause = (ms) => new Promise((res) => setTimeout(res, ms));

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
