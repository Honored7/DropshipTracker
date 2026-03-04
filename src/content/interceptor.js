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
// Content-script side: listen for events from the MAIN-world interceptor
// -----------------------------------------------------------------------
// The actual XHR/Fetch interception runs in page-interceptor.js (declared in
// manifest.json with "world": "MAIN", "run_at": "document_start").
// That script dispatches CustomEvents; the listener below receives them.

/** Install the page-level interceptor and start listening for captured data.
 *
 * The actual XHR/fetch overriding happens in page-interceptor.js which is
 * declared in manifest.json as a "world": "MAIN" content script running at
 * document_start. This function only needs to set up the CustomEvent listener
 * in the isolated-world content script.
 */
export function installInterceptor() {
  // Listen for events dispatched by the MAIN-world page-interceptor.js
  window.addEventListener('__dropship_intercepted__', (event) => {
    const { url, data } = event.detail || {};
    if (!url || !data) return;
    handleInterceptedData(url, data);
  });

  console.log('[DropshipTracker] XHR/Fetch interceptor listener installed');
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
