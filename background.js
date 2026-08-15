/* Compass Toolkit — service worker.
 *
 * There is very little to do here: features run in content scripts and read
 * their own settings, and captured data goes straight to chrome.storage. This
 * only seeds the defaults on install so the popup opens with real values
 * rather than an empty object.
 */

importScripts("src/shared/settings.js");

chrome.runtime.onInstalled.addListener(function (details) {
  // Goes through the shared helpers so `runtime.lastError` is always read —
  // an unread one is reported as an extension error.
  CompassToolkit.getSettings().then(function (settings) {
    return CompassToolkit.saveSettings(settings).then(function () {
      console.log("[Compass Toolkit] Settings ready (" + details.reason + ")");
    });
  });
});
