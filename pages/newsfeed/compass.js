// Talks to the same JSON services the Compass home page uses (captured from the HAR):
//   POST /Services/Feed.svc/GetFeedItems            -> the newsfeed the signed-in user sees
//   POST /Services/Newsfeed.svc/GetNewsItemById     -> one news item incl. its audience targets
//   POST /Services/Feed.svc/GetViewAsFeedItems      -> "View newsfeed as" parent/student (admins)
// All requests ride on the teacher's existing Compass sign-in cookies.

export class NotSignedInError extends Error {
  constructor() { super("Not signed in to Compass"); this.name = "NotSignedInError"; }
}

export class CompassError extends Error {
  constructor(message, status) { super(message); this.name = "CompassError"; this.status = status; }
}

// Compass.enums.UserBaseRole
const ROLE = { Student: 1, Staff: 2, Parent: 3 };

// Kept on this device, under the toolkit's shared storage keys.
const KEYS = CompassToolkit.DATA_KEYS;
const AUDIENCE_CACHE_KEY = KEYS.newsfeedAudiences;
const GROUPS_KEY = KEYS.newsfeedGroups;
const YEAR_LEVELS_KEY = KEYS.newsfeedYearLevels;
const AUDIENCE_TTL_MS = 6 * 60 * 60 * 1000;

export class CompassClient {
  constructor(baseUrl) {
    this.base = baseUrl.replace(/\/$/, "");
  }

  async post(path, body = {}) {
    let res;
    try {
      res = await fetch(this.base + path, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new CompassError(`Couldn't reach ${this.base}. Check the school address and your internet connection.`);
    }
    const type = res.headers.get("content-type") || "";
    // An expired session redirects to the login page, which comes back as HTML.
    if (res.redirected && /login/i.test(res.url)) throw new NotSignedInError();
    if (res.status === 401) throw new NotSignedInError();
    if (!type.includes("json")) {
      if (res.ok) throw new NotSignedInError();
      throw new CompassError(`Compass replied ${res.status} for ${path}`, res.status);
    }
    const json = await res.json();
    if (!res.ok) throw new CompassError(json?.Message || `Compass replied ${res.status}`, res.status);
    return json.d;
  }

  async get(path) {
    const res = await fetch(this.base + path, { credentials: "include" });
    if (!res.ok) throw new CompassError(`Compass replied ${res.status}`, res.status);
    return res;
  }

  // ---- Feed ---------------------------------------------------------------

  async getFeed({ maxItems = 20, maxAgeDays = 0 } = {}) {
    const items = [];
    const seen = new Set();
    const cutoff = maxAgeDays > 0 ? Date.now() - maxAgeDays * 86400000 : 0;
    let cursor;
    for (let page = 0; page < 12 && items.length < maxItems; page++) {
      const body = { count: 10, sortBy: 2, filterOptions: { isSavedOnly: false, readFilter: 0, tags: [] } };
      if (cursor) body.cursor = cursor;
      const batch = await this.post("/Services/Feed.svc/GetFeedItems", body);
      if (!Array.isArray(batch) || batch.length === 0) break;
      let oldReached = false;
      for (const it of batch) {
        if (seen.has(it.feedItemId)) continue;
        seen.add(it.feedItemId);
        // Only true newsfeed posts (not class-change or chronicle entries).
        if (!it.newsFeedItemId) continue;
        const when = Date.parse(it.start || it.createdTimestamp);
        if (cutoff && when < cutoff && !it.isPriority) { oldReached = true; continue; }
        items.push(it);
      }
      cursor = String(batch[batch.length - 1].feedItemId);
      if (oldReached) break;
    }
    return items.slice(0, maxItems);
  }

  // ---- Audience -----------------------------------------------------------

  /**
   * Returns a Map newsFeedItemId -> audience info:
   * { kind: "community" | "staff" | "unknown", students, parents, staff, public,
   *   yearLevels: number[], classTargeted: boolean, source: "targets" | "view-as" | "none" }
   */
  async getAudiences(items, { yearLevels = [] } = {}) {
    const cache = await loadAudienceCache();
    const result = new Map();
    const needFallback = [];
    const customGroups = await this.getCustomGroupRoles();

    // 0) Bulk: the newsfeed management lists return every current item with its targets
    //    in a few requests. Only newsfeed admins can use them; anyone else falls through.
    const uncached = items.filter((it) => {
      const c = cache[it.newsFeedItemId];
      return !(c && Date.now() - c.at < AUDIENCE_TTL_MS && c.source !== "none");
    });
    const bulk = uncached.length > 3 ? await this.getCurrentNewsItemsBulk().catch((e) => {
      if (e instanceof NotSignedInError) throw e;
      return null;
    }) : null;
    if (bulk) {
      for (const it of uncached) {
        const news = bulk.get(String(it.newsFeedItemId));
        if (!news) continue;
        const info = parseTargets(news, customGroups);
        cache[it.newsFeedItemId] = { at: Date.now(), source: info.source, info };
      }
    }

    // 1) Ask for each item's own audience targets (works for authors and newsfeed admins/power users).
    await runLimited(items, 4, async (it) => {
      const id = it.newsFeedItemId;
      const cached = cache[id];
      if (cached && Date.now() - cached.at < AUDIENCE_TTL_MS && cached.source !== "none") {
        result.set(id, cached.info);
        return;
      }
      try {
        const news = await this.post("/Services/Newsfeed.svc/GetNewsItemById", { newsItemId: id });
        if (!news || !Array.isArray(news.NewsItemGroupTargets)) throw new Error("No targets");
        const info = parseTargets(news, customGroups);
        result.set(id, info);
        cache[id] = { at: Date.now(), source: info.source, info };
      } catch (e) {
        if (e instanceof NotSignedInError) throw e;
        needFallback.push(it);
      }
    });

    // 2) Fall back to "View newsfeed as" parent/student for anything we couldn't read.
    if (needFallback.length) {
      let visible = null;
      try {
        visible = await this.viewAsVisibility(yearLevels);
      } catch (e) {
        if (e instanceof NotSignedInError) throw e;
      }
      for (const it of needFallback) {
        const id = it.newsFeedItemId;
        let info;
        if (visible) {
          const v = visible.get(id);
          info = v
            ? { kind: "community", students: v.students, parents: v.parents, staff: true, public: false,
                yearLevels: [...v.yearLevels], classTargeted: false, source: "view-as" }
            : { kind: "staff", students: false, parents: false, staff: true, public: false,
                yearLevels: [], classTargeted: false, source: "view-as" };
          cache[id] = { at: Date.now(), source: "view-as", info };
        } else {
          info = { kind: "unknown", students: false, parents: false, staff: false, public: false,
                   yearLevels: [], classTargeted: false, source: "none" };
        }
        result.set(id, info);
      }
    }

    await saveAudienceCache(cache);
    return result;
  }

  // Newsfeed management lists (admin only). Returns Map NewsItemId(string) -> NewsItem.
  async getCurrentNewsItemsBulk() {
    const map = new Map();
    for (const path of ["/Services/Newsfeed.svc/GetMyOwnNewsItems", "/Services/Newsfeed.svc/GetAllOtherCurrentNewsItems"]) {
      // The server may cap the page size, so page by what actually came back.
      for (let start = 0, page = 0; page < 20; page++) {
        const d = await this.post(path, { limit: 100, sort: "string", start, filterOptions: {} });
        const rows = d?.data || [];
        rows.forEach((n) => map.set(String(n.NewsItemId), n));
        start += rows.length;
        if (!rows.length || start >= (d?.total || 0)) break;
      }
    }
    return map;
  }

  // Custom groups carry a base role (1 student, 2 staff, 3 parent). Map id -> role.
  async getCustomGroupRoles() {
    const customGroups = (await chrome.storage.local.get(GROUPS_KEY))[GROUPS_KEY];
    if (customGroups?.base === this.base && Date.now() - customGroups.at < 86400000) return customGroups.roles;
    try {
      const d = await this.post("/Services/PeopleManagement.svc/GetCustomGroups", { page: 1, start: 0, limit: 500 });
      const roles = Object.fromEntries((d || []).map((g) => [g.id, g.userBaseRole]));
      await chrome.storage.local.set({ [GROUPS_KEY]: { at: Date.now(), base: this.base, roles } });
      return roles;
    } catch (e) {
      if (e instanceof NotSignedInError) throw e;
      return {};
    }
  }

  // Build newsFeedItemId -> {students, parents, yearLevels:Set} by viewing the feed as each role/year level.
  async viewAsVisibility(yearLevels) {
    if (!yearLevels.length) yearLevels = (await this.getYearLevels()).map((y) => y.id);
    const visible = new Map();
    const jobs = [];
    for (const yl of yearLevels) {
      jobs.push({ yl, role: ROLE.Student }, { yl, role: ROLE.Parent });
    }
    let anySuccess = false;
    await runLimited(jobs, 3, async ({ yl, role }) => {
      let cursor;
      for (let page = 0; page < 4; page++) {
        const body = { count: 20, yearLevel: yl, future: false, baseRole: role, alum: false };
        if (cursor) body.cursor = cursor;
        const batch = await this.post("/Services/Feed.svc/GetViewAsFeedItems", body);
        anySuccess = true;
        if (!Array.isArray(batch) || !batch.length) break;
        for (const it of batch) {
          if (!it.newsFeedItemId) continue;
          const v = visible.get(it.newsFeedItemId) || { students: false, parents: false, yearLevels: new Set() };
          if (role === ROLE.Student) v.students = true; else v.parents = true;
          v.yearLevels.add(yl);
          visible.set(it.newsFeedItemId, v);
        }
        cursor = String(batch[batch.length - 1].feedItemId);
      }
    });
    if (!anySuccess) throw new CompassError("View-as not permitted");
    return visible;
  }

  // Year levels are embedded in the Compass home page as `Compass.yearLevels = [...]`.
  async getYearLevels() {
    const yearLevels = (await chrome.storage.local.get(YEAR_LEVELS_KEY))[YEAR_LEVELS_KEY];
    if (yearLevels?.at && Date.now() - yearLevels.at < 7 * 86400000 && yearLevels.base === this.base) {
      return sortYearLevels(yearLevels.list);
    }
    const res = await fetch(this.base + "/", { credentials: "include" });
    const html = await res.text();
    const m = html.match(/Compass\.yearLevels\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) {
      if (/login/i.test(res.url)) throw new NotSignedInError();
      return [];
    }
    const list = JSON.parse(m[1])
      .filter((y) => y.id !== -1 && y.id !== 99) // "No YL" and "Cross Year"
      .map((y) => ({ id: y.id, name: y.n }));
    await chrome.storage.local.set({ [YEAR_LEVELS_KEY]: { at: Date.now(), base: this.base, list } });
    return sortYearLevels(list);
  }

  // ---- Images -------------------------------------------------------------

  imageUrlForAttachment(att) {
    // This is the preview URL the Compass feed itself loads for image attachments.
    return `${this.base}/Services/FileDownload/FileRequestHandler?FileDownloadType=71&attachmentId=${att.attachmentId}&preview=true&source=feed&v=1`;
  }

  absolute(url) {
    if (!url) return url;
    if (/^(data:|blob:)/.test(url)) return url;
    return new URL(url, this.base + "/").href;
  }
}

// Mirrors how Compass itself summarises "Targeted audience" in the editor.
export function parseTargets(news, customGroupRoles = {}) {
  const has = (a) => Array.isArray(a) && a.length > 0;
  const info = {
    kind: "unknown", students: false, parents: false, staff: false,
    public: !!news.PublicWebsite, yearLevels: [], classTargeted: false, source: "targets"
  };
  const yl = new Set();
  for (const t of news.NewsItemGroupTargets || []) {
    const active = has(t.YearLevels) || has(t.FormGroups) || has(t.Houses) || has(t.ActivityIds) || t.TargetAll === true;
    if (!active) continue;
    if (t.BaseRole === ROLE.Staff) { info.staff = true; continue; }
    if (t.Future) continue; // future (next year's) enrolments aren't in the classroom yet
    if (t.BaseRole === ROLE.Student) info.students = true;
    if (t.BaseRole === ROLE.Parent) info.parents = true;
    if (t.BaseRole === ROLE.Student || t.BaseRole === ROLE.Parent) {
      (t.YearLevels || []).forEach((y) => yl.add(y));
      if (has(t.ActivityIds)) info.classTargeted = true;
    }
  }
  info.yearLevels = [...yl];
  const groupIds = news.NewsItemCustomGroupTargets?.CustomGroupIds || [];
  let unknownGroup = false;
  for (const g of groupIds) {
    const role = customGroupRoles[g];
    if (role === ROLE.Student) info.students = true;
    else if (role === ROLE.Parent) info.parents = true;
    else if (role === ROLE.Staff) info.staff = true;
    else unknownGroup = true;
  }
  if (info.students || info.parents || info.public) info.kind = "community";
  else if (unknownGroup) info.kind = "unknown"; // a custom group we couldn't look up
  // No current student/parent targets: only staff can see it. (Compass often leaves the
  // staff target empty even though staff still see the item, as in the captured edit.)
  else info.kind = "staff";
  return info;
}

// School order: Kindergarten, Pre-Primary, Year 1, Year 2, ...
// (Compass gives Kindergarten id 100, which would otherwise sort last.)
function sortYearLevels(list) {
  const rank = (y) => (/kind/i.test(y.name) ? -2 : /pre.?primary|^pp$/i.test(y.name) ? -1 : y.id);
  return [...list].sort((a, b) => rank(a) - rank(b));
}

async function loadAudienceCache() {
  const { [AUDIENCE_CACHE_KEY]: c = {} } = await chrome.storage.local.get(AUDIENCE_CACHE_KEY);
  return c;
}

async function saveAudienceCache(cache) {
  // Keep the cache from growing forever.
  const entries = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, 300);
  await chrome.storage.local.set({ [AUDIENCE_CACHE_KEY]: Object.fromEntries(entries) });
}

export async function clearAudienceCache() {
  await chrome.storage.local.remove([AUDIENCE_CACHE_KEY, YEAR_LEVELS_KEY, GROUPS_KEY]);
}

async function runLimited(list, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) {
      const item = list[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

// Decide whether an item belongs in the chosen view.
export function matchesAudience(item, info, override, settings) {
  if (override === "hidden") return false;
  const kind = override === "staff" || override === "community" ? override : info?.kind || "unknown";
  switch (settings.audience) {
    case "all":
      return true;
    case "staff":
      return kind === "staff";
    case "community": {
      if (kind === "unknown") return !!settings.includeUnknown;
      if (kind !== "community") return false;
      if (settings.yearLevel === "any" || override === "community") return true;
      const want = Number(settings.yearLevel);
      if (!info) return true;
      // Whole-school, public, or class-targeted posts still count for any year level.
      return info.public || info.classTargeted || info.yearLevels.length === 0 || info.yearLevels.includes(want);
    }
    case "students": {
      if (kind === "unknown") return !!settings.includeUnknown;
      if (kind !== "community") return false;
      // "community" only says the item reaches families; whether that includes students
      // specifically is in info.students. A manual override can't say that, so an overridden
      // item is taken on trust rather than hidden for lacking a flag it was never asked for.
      if (override !== "community" && info && !info.students) return false;
      if (settings.yearLevel === "any" || override === "community") return true;
      const want = Number(settings.yearLevel);
      if (!info) return true;
      return info.public || info.classTargeted || info.yearLevels.length === 0 || info.yearLevels.includes(want);
    }
    default:
      return true;
  }
}
