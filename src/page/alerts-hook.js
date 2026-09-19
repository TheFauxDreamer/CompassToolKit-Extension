/* Compass Toolkit: alerts hook (MAIN world).
 *
 * Runs in the page itself before Compass's scripts, and watches for the
 * homepage's own GetMyAlerts request. It hands the request details and the
 * response to the content script, so the Attendance Note Watcher learns the
 * exact address and method Compass uses and records what the homepage showed
 * you. Like the interceptor it is passive: nothing here changes a request.
 */
(function () {
  "use strict";

  const RE = /\/GetMyAlerts\b/i;

  function post(data) {
    window.postMessage(
      { source: "compass-toolkit", type: "CT_ALERTS_SEEN", data: data },
      location.origin
    );
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const promise = origFetch.apply(this, arguments);
    try {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (RE.test(url)) {
        const method = (init && init.method) || (input && input.method) || "GET";
        const body = init && typeof init.body === "string" ? init.body : null;
        promise
          .then(function (response) {
            return response.clone().text();
          })
          .then(function (text) {
            post({ url: new URL(url, location.href).href, method: method, body: body, text: text });
          })
          .catch(function () {});
      }
    } catch (e) {}
    return promise;
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ctAlertsRequest = { method: method, url: String(url) };
    return open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const request = this.__ctAlertsRequest;
    if (request && RE.test(request.url)) {
      this.addEventListener("load", () => {
        try {
          post({
            url: new URL(request.url, location.href).href,
            method: request.method,
            body: typeof body === "string" ? body : null,
            text: this.responseText
          });
        } catch (e) {}
      });
    }
    return send.apply(this, arguments);
  };
})();
