/**
 * XHR / Fetch Interceptor
 *
 * Injects a script into the PAGE's execution context (not the content-script
 * isolated world) so it can override window.XMLHttpRequest and window.fetch.
 * Responses that match known review/product API endpoints are dispatched back
 * to the content script via a CustomEvent on the window.
 *
 * Why injection? Chrome MV3 content scripts live in an isolated world and
 * cannot directly override the page's XHR / fetch constructors.
 */

import { contentState } from './contentState.js';

// -----------------------------------------------------------------------
// URL patterns that carry review / product data we want to capture
// Add more patterns here as new endpoints are discovered.
// -----------------------------------------------------------------------
const CAPTURE_PATTERNS = [
  /\/feedback\/(\d+)\//,              // AliExpress review endpoint
  /\/call_action\/getProductDetail/,  // AliExpress product detail API
  /\/review\/list/,                   // Generic review list
  /\/reviews\.json/,                  // Various shops
  /\/product\/review/i,
  /ae-feedback\.aliexpress\.com/,
  /\/search\/feedback\.htm/,
  /\/feedback\.do/,
];

// -----------------------------------------------------------------------
// Page-level interceptor (stringified and injected as a <script> tag)
// It CANNOT reference any variable from this module's closure.
// -----------------------------------------------------------------------
function pageInterceptorCode() {
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
    return PATTERNS.some(p => p.test(url));
  }

  function dispatch(url, data) {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { url, data } }));
  }

  // ---- Intercept XHR ----
  const OrigXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const xhr = new OrigXHR(...arguments);
    let _url = '';

    const origOpen = xhr.open.bind(xhr);
    xhr.open = function (method, url, ...rest) {
      _url = url || '';
      return origOpen(method, url, ...rest);
    };

    xhr.addEventListener('load', function () {
      try {
        if (shouldCapture(_url) && xhr.responseText) {
          const json = JSON.parse(xhr.responseText);
          dispatch(_url, json);
        }
      } catch (_) { /* ignore non-JSON */ }
    });

    return xhr;
  };

  // Preserve static properties (e.g. DONE, LOADING constants)
  Object.assign(window.XMLHttpRequest, OrigXHR);

  // ---- Intercept Fetch ----
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input?.url || '');
    return origFetch.call(this, input, init).then(response => {
      if (shouldCapture(url)) {
        response.clone().json().then(json => {
          dispatch(url, json);
        }).catch(() => { /* not JSON */ });
      }
      return response;
    });
  };
}

// -----------------------------------------------------------------------
// Content-script side: inject & listen
// -----------------------------------------------------------------------

/** Install the page-level interceptor and start listening for captured data. */
export function installInterceptor() {
  // Inject the interceptor into the page's execution context
  try {
    const scriptEl = document.createElement('script');
    scriptEl.textContent = `(${pageInterceptorCode.toString()})();`;
    (document.head || document.documentElement).prepend(scriptEl);
    scriptEl.remove(); // The code runs immediately; the element is no longer needed
  } catch (e) {
    console.warn('[DropshipTracker] Could not inject interceptor:', e.message);
    return;
  }

  // Listen for events dispatched by the injected script
  window.addEventListener('__dropship_intercepted__', (event) => {
    const { url, data } = event.detail || {};
    if (!url || !data) return;
    handleInterceptedData(url, data);
  });

  console.log('[DropshipTracker] XHR/Fetch interceptor installed');
}

/**
 * Process intercepted API responses.
 * Merges captured review data and product data into contentState.
 */
function handleInterceptedData(url, data) {
  // ---- Review data ----
  // AliExpress review responses typically look like:
  //   { data: { evaViewList: [...reviews...] } }
  //   { result: { reviews: [...] } }
  const reviewList =
    data?.data?.evaViewList ||
    data?.result?.reviews ||
    data?.feedbackList ||
    data?.reviewList ||
    data?.data?.feedbackList ||
    null;

  if (Array.isArray(reviewList) && reviewList.length > 0) {
    if (!contentState.interceptedReviews) contentState.interceptedReviews = [];

    for (const r of reviewList) {
      contentState.interceptedReviews.push({
        author: r.buyerName || r.userName || r.authorName || r.nickName || null,
        rating: r.buyerEval || r.starRating || r.rating || null,
        date: r.evalDate || r.date || r.createTime || null,
        text: r.buyerFeedback || r.content || r.text || r.comment || null,
        country: r.buyerCountry || r.country || null,
        images: (r.images || r.picList || []).map(img =>
          typeof img === 'string' ? img : (img.imgUrl || img.url || '')
        ).filter(Boolean)
      });
    }

    console.log(`[DropshipTracker] Interceptor captured ${reviewList.length} reviews from ${url}`);
  }

  // ---- Product / price data from API ----
  const productData =
    data?.data?.product ||
    data?.result?.product ||
    data?.productInfo ||
    null;

  if (productData) {
    if (!contentState.interceptedProductData) contentState.interceptedProductData = {};
    Object.assign(contentState.interceptedProductData, productData);
    console.log('[DropshipTracker] Interceptor captured product data from', url);
  }
}

/**
 * Retrieve reviews captured by the interceptor and merge them with DOM-scraped reviews.
 * Called from productExtraction.js after extractReviewsData().
 *
 * @param {Array} domReviews - Reviews already extracted from the DOM
 * @returns {Array} Merged, deduplicated review list
 */
export function mergeInterceptedReviews(domReviews = []) {
  const captured = contentState.interceptedReviews || [];
  if (captured.length === 0) return domReviews;

  // Simple dedup by text content
  const seen = new Set(domReviews.map(r => (r.text || '').substring(0, 60)));
  const merged = [...domReviews];

  for (const r of captured) {
    const key = (r.text || '').substring(0, 60);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(r);
    }
  }

  return merged;
}
