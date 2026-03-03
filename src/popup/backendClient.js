/**
 * backendClient.js
 *
 * Thin wrapper around the local Scrapling FastAPI backend
 * (default: http://127.0.0.1:8000).
 *
 * Usage:
 *   import { extractViaBackend, isBackendAvailable } from './backendClient.js';
 *
 *   const available = await isBackendAvailable();
 *   if (available) {
 *     const product = await extractViaBackend(url);
 *   }
 *
 * The backend is completely optional — every call has a try/catch so the
 * extension degrades gracefully when the Python server is not running.
 */

const BACKEND_BASE = 'http://127.0.0.1:8000';
const HEALTH_TIMEOUT_MS = 2000;   // Fast probe — don't block the UI
const EXTRACT_TIMEOUT_MS = 30000; // Scrapling may need to render JS

// In-memory cache so we don't re-probe every click
let _backendAvailable = null;    // null = unknown, true/false = confirmed
let _lastProbeTime   = 0;
const PROBE_TTL_MS   = 30_000;   // Re-check every 30 s

// ---------------------------------------------------------------------------
// Health probe
// ---------------------------------------------------------------------------
/**
 * Returns true if the backend is up and reachable within HEALTH_TIMEOUT_MS.
 * Result is cached for PROBE_TTL_MS ms to avoid hammering the server.
 *
 * @returns {Promise<boolean>}
 */
export async function isBackendAvailable() {
  const now = Date.now();
  if (_backendAvailable !== null && (now - _lastProbeTime) < PROBE_TTL_MS) {
    return _backendAvailable;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    const res = await fetch(`${BACKEND_BASE}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);

    _backendAvailable = res.ok;
    _lastProbeTime    = now;
    if (_backendAvailable) {
      const data = await res.json().catch(() => ({}));
      console.log(
        `[DropshipTracker] Backend available — Scrapling ${data.scrapling_version ?? 'unknown'}`
      );
    }
    return _backendAvailable;
  } catch {
    _backendAvailable = false;
    _lastProbeTime    = now;
    return false;
  }
}

/**
 * Reset the cached availability state (useful after the user starts the
 * server while the extension is open).
 */
export function resetBackendCache() {
  _backendAvailable = null;
  _lastProbeTime    = 0;
}

// ---------------------------------------------------------------------------
// Extract a single product
// ---------------------------------------------------------------------------
/**
 * POST /extract — extract a product by URL using Scrapling.
 *
 * The returned object matches the shape expected by extractProduct() in
 * scraper.js (ProductResult as returned by the FastAPI backend).
 *
 * @param {string} url
 * @returns {Promise<object>} Product data object
 * @throws {Error} if the server returns an error or times out
 */
export async function extractViaBackend(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${BACKEND_BASE}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail ?? ''; } catch { /* ignore */ }
    throw new Error(`Backend /extract failed (${res.status}): ${detail}`);
  }

  const data = await res.json();
  // Normalise backend response → scraper.js field names
  return _normaliseBackendProduct(data);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
/**
 * POST /search — keyword search on AliExpress or Alibaba.
 *
 * @param {object} params
 * @param {string} params.query
 * @param {'aliexpress'|'alibaba'} [params.platform='aliexpress']
 * @param {number} [params.max_results=20]
 * @param {number|null} [params.min_price]
 * @param {number|null} [params.max_price]
 * @returns {Promise<object[]>} Array of SearchResultItem objects
 */
export async function searchViaBackend({ query, platform = 'aliexpress', max_results = 20, min_price, max_price } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

  const body = { query, platform, max_results };
  if (min_price != null) body.min_price = min_price;
  if (max_price != null) body.max_price = max_price;

  let res;
  try {
    res = await fetch(`${BACKEND_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail ?? ''; } catch { /* ignore */ }
    throw new Error(`Backend /search failed (${res.status}): ${detail}`);
  }

  const data = await res.json();
  return data.results ?? [];
}

// ---------------------------------------------------------------------------
// Internal: normalise ProductResult → scraper.js expected shape
// ---------------------------------------------------------------------------
/**
 * Maps the backend's snake_case ProductResult fields to the camelCase fields
 * that the existing extractProduct() handler already knows how to display.
 */
function _normaliseBackendProduct(p) {
  return {
    // Identity
    productId: p.product_id ?? p.productId ?? '',
    url:       p.url ?? '',
    domain:    p.domain ?? _domainFromUrl(p.url),

    // Text
    title:           p.title ?? '',
    shortDescription: p.short_description ?? p.shortDescription ?? '',
    description:     p.description ?? '',
    descriptionText: p.description ?? '',
    fullDescription: p.full_description ?? p.description ?? '',
    category:        p.category ?? '',
    brand:           p.brand ?? '',
    sku:             p.sku ?? '',
    metaKeywords:    p.meta_keywords ?? p.metaKeywords ?? '',
    metaDescription: p.meta_description ?? p.metaDescription ?? p.short_description ?? '',

    // Pricing
    price:         p.price         != null ? String(p.price)          : '',
    originalPrice: p.original_price != null ? String(p.original_price) : '',
    currency:      p.currency ?? 'USD',
    shippingCost:  p.shipping_cost  != null ? String(p.shipping_cost)  : '',
    shippingText:  p.shipping_text ?? p.shippingText ?? '',
    shipping:      p.shipping_text ?? '',
    minOrder:      p.min_order ?? p.minOrder ?? '',

    // Availability
    stock:        p.stock        != null ? String(p.stock) : '',
    availability: p.availability ?? '',
    soldCount:    p.sold_count   != null ? String(p.sold_count) : '',
    orders:       p.sold_count   != null ? String(p.sold_count) : '',

    // Media
    images:    Array.isArray(p.images)     ? p.images     : [],
    videoUrls: Array.isArray(p.video_urls) ? p.video_urls : [],

    // Store
    storeName:   p.store_name   ?? p.storeName   ?? '',
    storeRating: p.store_rating != null ? String(p.store_rating) : '',

    // Ratings / reviews
    rating:      p.rating       != null ? String(p.rating)       : '',
    reviewCount: p.review_count != null ? String(p.review_count) : '',
    reviews:     Array.isArray(p.reviews) ? p.reviews : [],

    // Logistics
    weight: p.weight ?? '',

    // Rich product data
    variants:      Array.isArray(p.variants)       ? p.variants       : [],
    variantGroups: Array.isArray(p.variant_groups) ? p.variant_groups :
                   Array.isArray(p.variantGroups)  ? p.variantGroups  : [],
    specifications: Array.isArray(p.specifications) ? p.specifications : [],

    // Backend metadata
    extractionMethod: p.extraction_method ?? 'scrapling-backend',
    _source: 'backend',
  };
}

function _domainFromUrl(url = '') {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
