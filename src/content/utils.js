/**
 * Content script utility functions
 * URL validation, image processing, price parsing, DOM helpers, etc.
 */

import { getSiteConfig } from './siteConfigs.js';

// ============================================
// PRODUCT ID EXTRACTION
// ============================================

/**
 * Extract product ID from URL or page
 */
export function extractProductId() {
  const config = getSiteConfig();
  const url = window.location.href;

  if (config && config.productIdPattern) {
    const match = url.match(config.productIdPattern);
    if (match) {
      return match[1] || match[2] || match[3] || match[0];
    }
  }

  const patterns = [
    /\/dp\/([A-Z0-9]{10})/,
    /\/item\/(\d+)/,
    /\/product\/(\d+)/,
    /product[_-]?id[=:](\w+)/i,
    /\/p\/([a-zA-Z0-9-]+)/,
    /[?&]id=(\w+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  const idElement = document.querySelector('[data-product-id], [data-item-id], [data-sku]');
  if (idElement) {
    return idElement.getAttribute('data-product-id') ||
           idElement.getAttribute('data-item-id') ||
           idElement.getAttribute('data-sku');
  }

  return null;
}

/**
 * Try to find product ID in element
 */
export function extractProductIdFromElement(element) {
  const dataId = element.getAttribute('data-product-id') ||
                 element.getAttribute('data-item-id') ||
                 element.getAttribute('data-id');
  if (dataId) return dataId;

  const link = element.querySelector('a[href*="item/"], a[href*="product/"], a[href*="/dp/"]');
  if (link) {
    const href = link.href;
    const patterns = [
      /\/item\/(\d+)/,
      /\/product\/(\d+)/,
      /\/dp\/([A-Z0-9]{10})/
    ];
    for (const pattern of patterns) {
      const match = href.match(pattern);
      if (match) return match[1];
    }
  }

  return null;
}

/**
 * Extract supplier SKU from element (separate from product ID)
 */
export function extractSupplierSku(element) {
  const sku = element.getAttribute('data-sku') ||
              element.getAttribute('data-product-sku') ||
              element.getAttribute('data-sku-id');
  if (sku) return sku;

  const skuEl = element.querySelector('[class*="sku"], [class*="itemId"], [class*="product-id"]');
  if (skuEl) {
    const text = skuEl.textContent?.trim();
    if (text && text.length < 50) return text;
  }

  return null;
}

// ============================================
// IMAGE URL HELPERS
// ============================================

/**
 * Normalize image URL for deduplication
 */
export function normalizeImageUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.search = '';
    return u.href.replace(/_\d+x\d+[^.]*/g, '').replace(/\?.*$/, '');
  } catch (e) {
    return url.replace(/\?.*$/, '');
  }
}

/**
 * Check if URL is a valid product URL (not tracking/redirect)
 */
export function isValidProductUrl(url) {
  if (!url || typeof url !== 'string') return false;

  const trackingPatterns = [
    'click.alibaba.com',
    'us-click.alibaba.com',
    'click.aliexpress.com',
    'ae-click.aliexpress.com',
    'gw.alicdn.com/tps',
    '/ci_bb',
    '/ot=local',
    'beacon.',
    'tracker.',
    'analytics.',
    'ads.alibaba',
    'ad.alibaba',
    'click?',
    'redirect?',
    'track?'
  ];

  const lower = url.toLowerCase();
  if (trackingPatterns.some(pattern => lower.includes(pattern))) {
    return false;
  }

  return url.startsWith('http') && (
    url.includes('/item/') ||
    url.includes('/product/') ||
    url.includes('/dp/') ||
    url.includes('.html') ||
    url.includes('/p/')
  );
}

/**
 * Clean product URL - extract real URL from redirect
 */
export function cleanProductUrl(url) {
  if (!url) return '';

  try {
    const urlObj = new URL(url);
    const targetParam = urlObj.searchParams.get('url') ||
                        urlObj.searchParams.get('target') ||
                        urlObj.searchParams.get('redirect');
    if (targetParam && targetParam.startsWith('http')) {
      return decodeURIComponent(targetParam);
    }
  } catch(e) {}

  return url;
}

/**
 * Check if URL is a valid image URL
 */
export function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http')) return false;

  const rejectPatterns = ['1x1', 'pixel', 'beacon', 'tracker', 'analytics', 'stat.'];
  if (rejectPatterns.some(p => url.toLowerCase().includes(p))) return false;

  return url.match(/\.(jpg|jpeg|png|gif|webp)/i) ||
         url.includes('alicdn.com') ||
         url.includes('imgur.') ||
         url.includes('cloudfront.');
}

/**
 * Clean image URL - convert thumbnail to full size
 */
export function cleanImageUrl(src) {
  if (!src) return '';
  return src
    .replace(/_\d+x\d+[^.]*\./g, '.')
    .replace(/\/_[^/]*\.webp/, '.jpg')
    .replace(/_Q\d+\.jpg/, '.jpg')
    .replace(/\.jpg_\d+x\d+.*$/, '.jpg')
    .replace(/\?.*$/, '');
}

/**
 * Check if URL is a valid product image
 */
export function isValidProductImage(src) {
  if (!src || !src.includes('http')) return false;
  if (/\.svg(\?|$)/i.test(src)) return false;
  if (/tps-\d{1,2}-\d{1,2}|_\d{1,2}x\d{1,2}/i.test(src)) return false;
  const exclude = ['avatar', 'logo', 'icon', 'sprite', 'banner', 'flag', 'badge', 'loading', 'placeholder', 'spacer', 'pixel', 'tracking'];
  const lower = src.toLowerCase();
  return !exclude.some(ex => lower.includes(ex)) && (lower.includes('product') || lower.includes('item') || lower.includes('aliexpress') || lower.includes('alibaba') || lower.includes('alicdn') || src.match(/\.(jpg|jpeg|png|webp)/i));
}

// ============================================
// PRICE PARSING
// ============================================

/**
 * Parse a price string into a numeric value
 */
export function parsePriceText(text) {
  if (!text) return null;
  const pricePatterns = [
    /[\$\u20AC\u00A3\u00A5\u20A6]\s*([\d,]+\.?\d*)/,
    /([\d,]+\.?\d*)\s*[\$\u20AC\u00A3\u00A5\u20A6]/,
    /(?:NGN|USD|EUR|GBP)\s*([\d,]+\.?\d*)/i,
    /([\d,]+\.?\d*)\s*(?:NGN|USD|EUR|GBP)/i
  ];
  for (const pattern of pricePatterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseFloat(match[1].replace(/,/g, ''));
      if (num > 0.01 && num < 10000000) return num;
    }
  }
  return null;
}

/**
 * Detect currency from text or meta
 */
export function detectCurrency() {
  const currencyMeta = document.querySelector(
    'meta[property="product:price:currency"], meta[itemprop="priceCurrency"], meta[name="currency"]'
  );
  if (currencyMeta) return currencyMeta.content;

  const priceEl = document.querySelector('[class*="price" i]');
  if (priceEl) {
    const text = priceEl.textContent || '';
    if (text.includes('$') || /USD/i.test(text)) return 'USD';
    if (text.includes('\u20AC') || /EUR/i.test(text)) return 'EUR';
    if (text.includes('\u00A3') || /GBP/i.test(text)) return 'GBP';
    if (text.includes('\u00A5') || /JPY|CNY/i.test(text)) return 'CNY';
    if (text.includes('\u20A6') || /NGN/i.test(text)) return 'NGN';
  }

  return null;
}

// ============================================
// DOM HELPERS
// ============================================

/**
 * Lazy-scroll rows into view before extraction
 * Triggers lazy loading of images and dynamic content
 */
export function lazyScrollElements(elements, callback) {
  if (!elements || elements.length === 0) {
    callback();
    return;
  }

  const delay = elements.length > 50 ? 30 : elements.length > 20 ? 50 : 80;
  let index = 0;

  function scrollNext() {
    if (index >= elements.length) {
      callback();
      return;
    }

    const el = elements[index];
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
    }
    index++;
    setTimeout(scrollNext, delay);
  }

  scrollNext();
}

/**
 * Find the nearest scrollable parent of an element
 */
export function findScrollableParent(element) {
  let current = element;
  while (current && current !== document.body && current !== document.documentElement) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return document.scrollingElement || document.body;
}

/**
 * Full mouse event simulation for clicking elements
 * Some SPAs (React/Vue) require mousedown + click + mouseup sequence
 */
export function simulateFullClick(element) {
  if (!element) return;

  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const eventOpts = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY
  };

  element.dispatchEvent(new MouseEvent('mousedown', eventOpts));
  element.dispatchEvent(new MouseEvent('click', eventOpts));
  element.dispatchEvent(new MouseEvent('mouseup', eventOpts));
}

/**
 * Try multiple selectors, return first match text
 */
export function trySelectors(selectors) {
  if (!selectors) return null;
  for (const selector of selectors) {
    try {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent?.trim() || el.value;
        if (text) return text;
      }
    } catch (e) {}
  }
  return null;
}

/**
 * Try selectors specifically for price fields — returns parsed numeric price
 */
export function tryPriceSelectors(selectors) {
  if (!selectors) return null;
  for (const selector of selectors) {
    try {
      const el = document.querySelector(selector);
      if (el) {
        const directText = getDirectTextContent(el);
        const parsed = parsePriceText(directText || el.textContent);
        if (parsed && parsed < 1000000) return parsed;
      }
    } catch (e) {}
  }
  return null;
}

/**
 * Get direct text content of an element (not from children)
 */
export function getDirectTextContent(el) {
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    }
  }
  return text.trim() || null;
}

/**
 * Try selectors and get all matches
 */
export function trySelectorsAll(selectors, attr = null) {
  if (!selectors) return [];
  const results = [];

  for (const selector of selectors) {
    try {
      document.querySelectorAll(selector).forEach(el => {
        const value = attr ? el[attr] || el.getAttribute(attr) : el.textContent?.trim();
        if (value && !results.includes(value)) {
          results.push(value);
        }
      });
      if (results.length > 0) break;
    } catch (e) {}
  }

  return results;
}

/**
 * Extract sample value from element (used by selector picker and table extraction)
 */
export function extractSampleValue(element) {
  if (element.tagName === 'IMG') {
    return element.src || element.getAttribute('data-src') || '';
  }
  if (element.tagName === 'A') {
    return element.href || element.textContent?.trim() || '';
  }
  if (element.tagName === 'INPUT' || element.tagName === 'SELECT') {
    return element.value || '';
  }
  return element.textContent?.trim().substring(0, 200) || '';
}
