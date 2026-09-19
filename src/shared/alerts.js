/* Compass Toolkit: alerts request helpers.
 *
 * Used by the Attendance Note Watcher, both in the background worker and in
 * the content script. Replays the homepage's own GetMyAlerts request and reads
 * the attendance notes alert out of what comes back.
 */

var CompassToolkitAlerts = (function () {
  "use strict";

  /* Confirmed address from the homepage. The method is learned from the
   * homepage on first load; until then POST (like the other Compass services)
   * is tried first. */
  const GUESSED_ENDPOINTS = [
    { url: "/Services/Newsfeed.svc/GetMyAlerts", method: "POST", body: "{}" },
    { url: "/Services/Newsfeed.svc/GetMyAlerts", method: "GET", body: null }
  ];

  /* Replays a GetMyAlerts request. Resolves { text } or { error }. */
  async function fetchAlerts(origin, endpoint) {
    const url = new URL(endpoint.url, origin);
    if (url.searchParams.has("_dc")) {
      url.searchParams.set("_dc", String(Date.now()));
    }
    const method = (endpoint.method || "POST").toUpperCase();
    const init = {
      method: method,
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" }
    };
    if (method !== "GET") {
      init.headers["Content-Type"] = "application/json";
      init.body = endpoint.body == null ? "{}" : endpoint.body;
    }
    try {
      const r = await fetch(url.href, init);
      if (r.redirected && /login/i.test(r.url)) return { error: "signed-out" };
      if (r.status === 401 || r.status === 403) return { error: "signed-out" };
      if (!r.ok) {
        return { error: "Compass replied with HTTP " + r.status, status: r.status };
      }
      return { text: await r.text() };
    } catch (e) {
      return { error: "Couldn't reach Compass (" + (e.message || e) + ")" };
    }
  }

  /* Turns a GetMyAlerts response into { found, count, title, linkUrl } or
   * { error }. Example alert Title: "There are 6 Attendance Notes that require
   * review." */
  function parseAlerts(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // An HTML page instead of JSON almost always means the login page.
      return { error: /<html/i.test(text) ? "signed-out" : "unexpected-response" };
    }
    const items = Array.isArray(data && data.d)
      ? data.d
      : Array.isArray(data)
        ? data
        : null;
    if (!items) return { error: "unexpected-response" };

    function plain(s) {
      return String(s || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    const alert = items.find(function (a) {
      return /attendance notes?/i.test(plain(a.Title) + " " + plain(a.Content));
    });
    if (!alert) return { found: false };

    const title = plain(alert.Title) || plain(alert.Content);
    const match = (title + " " + plain(alert.Content)).match(
      /(\d+)\s+attendance notes?/i
    );
    return {
      found: true,
      count: match ? Number(match[1]) : null,
      title: title,
      linkUrl: alert.LinkUrl || "/Organise/Attendance/"
    };
  }

  return {
    GUESSED_ENDPOINTS: GUESSED_ENDPOINTS,
    fetchAlerts: fetchAlerts,
    parseAlerts: parseAlerts
  };
})();
