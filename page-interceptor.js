/**
 * page-interceptor.js
 *
 * Runs in the MAIN world (declared in manifest.json with "world": "MAIN").
 * Has direct access to the page's window.XMLHttpRequest and window.fetch.
 *
 * Dispatches captured API payloads to the isolated-world content script via
 * CustomEvents on window. The content script (interceptor.js) listens for
 * '__dropship_intercepted__' and processes the data.
 *
 * NOTE: This file must NOT use ES module syntax (no import/export).
 *       It is injected as a plain classic script.
 */
(function () {
  'use strict';

  const EVENT_NAME = '__dropship_intercepted__';

  const PATTERNS = [
    /\/feedback\/(\d+)\//,
    /\/call_action\/getProductDetail/,
    /\/review\/list/,
    /\/reviews\.json/,
    /\/product\/review/i,
    /ae-feedback\.aliexpress\.com/,
    /\/search\/feedback\.htm/,
    /\/feedback\.do/,
  ];

  function shouldCapture(url) {
    return PATTERNS.some(function (p) { return p.test(url); });
  }

  function dispatch(url, data) {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { url: url, data: data } }));
  }

  // ---- Intercept XHR ----
  var OrigXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    var xhr = new OrigXHR();
    var _url = '';

    var origOpen = xhr.open.bind(xhr);
    xhr.open = function (method, url) {
      _url = url || '';
      return origOpen.apply(xhr, arguments);
    };

    xhr.addEventListener('load', function () {
      try {
        if (shouldCapture(_url) && xhr.responseText) {
          var json = JSON.parse(xhr.responseText);
          dispatch(_url, json);
        }
      } catch (_) { /* ignore non-JSON */ }
    });

    return xhr;
  };

  // Preserve static properties (DONE, LOADING, etc.)
  Object.assign(window.XMLHttpRequest, OrigXHR);

  // ---- Intercept Fetch ----
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    return origFetch.call(this, input, init).then(function (response) {
      if (shouldCapture(url)) {
        response.clone().json().then(function (json) {
          dispatch(url, json);
        }).catch(function () { /* not JSON */ });
      }
      return response;
    });
  };
})();
