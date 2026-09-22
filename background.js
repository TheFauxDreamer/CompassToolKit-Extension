/* Compass Toolkit: service worker.
 *
 * Most features run in content scripts and read their own settings, and
 * captured data goes straight to chrome.storage, so there is little to do
 * here. This seeds the defaults on install so the popup opens with real values
 * rather than an empty object, and loads the two features that work in the
 * background: the Attendance Note Watcher and the Newsfeed Projector's request
 * headers.
 */

importScripts(
  "src/shared/settings.js",
  "src/shared/alerts.js",
  "src/background/attendance-watcher.js",
  "src/background/newsfeed-headers.js"
);

chrome.runtime.onInstalled.addListener(function (details) {
  // Goes through the shared helpers so `runtime.lastError` is always read,
  // because an unread one is reported as an extension error.
  CompassToolkit.getSettings().then(function (settings) {
    return CompassToolkit.saveSettings(settings).then(function () {
      console.log("[Compass Toolkit] Settings ready (" + details.reason + ")");
    });
  });
});
