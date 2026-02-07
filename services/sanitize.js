/**
 * sanitize.js — Data sanitization utilities for DropshipTracker
 * Cleans and normalizes scraped data before export to cart platforms
 */

const SanitizeService = (() => {
  'use strict';

  // ========================
  // TEXT SANITIZATION
  // ========================

  /**
   * Strip HTML tags, decode entities, remove control characters
   * @param {string} text - Raw text (may contain HTML)
   * @param {object} [options]
   * @param {number} [options.maxLength=0] - Max output length (0 = unlimited)
   * @param {boolean} [options.preserveLineBreaks=false] - Keep \n from <br>/<p>
   * @returns {string}
   */
  function sanitizeText(text, options = {}) {
    if (!text || typeof text !== 'string') return '';
    const { maxLength = 0, preserveLineBreaks = false } = options;

    let clean = text;

    // Convert <br>, </p>, </div>, </li> to newlines if preserving
    if (preserveLineBreaks) {
      clean = clean.replace(/<br\s*\/?>/gi, '\n');
      clean = clean.replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n');
    }

    // Strip all remaining HTML tags
    clean = clean.replace(/<[^>]+>/g, ' ');

    // Decode common HTML entities
    clean = decodeHTMLEntities(clean);

    // Remove control characters (keep \n if preserving line breaks)
    if (preserveLineBreaks) {
      clean = clean.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');
    } else {
      clean = clean.replace(/[\x00-\x1F\x7F]/g, ' ');
    }

    // Collapse whitespace
    if (preserveLineBreaks) {
      clean = clean.replace(/[^\S\n]+/g, ' '); // collapse non-newline whitespace
      clean = clean.replace(/\n{3,}/g, '\n\n'); // max 2 consecutive newlines
    } else {
      clean = clean.replace(/\s+/g, ' ');
    }

    clean = clean.trim();

    // Truncate at word boundary if maxLength is set
    if (maxLength > 0 && clean.length > maxLength) {
      const truncated = clean.substring(0, maxLength);
      const lastSpace = truncated.lastIndexOf(' ');
      clean = truncated.substring(0, lastSpace > maxLength * 0.7 ? lastSpace : maxLength) + '...';
    }

    return clean;
  }

  /**
   * Decode HTML entities
   */
  function decodeHTMLEntities(text) {
    const entities = {
      '&amp;': '&', '&lt;': '<', '&gt;': '>',
      '&quot;': '"', '&#39;': "'", '&apos;': "'",
      '&nbsp;': ' ', '&ndash;': '–', '&mdash;': '—',
      '&laquo;': '«', '&raquo;': '»',
      '&copy;': '©', '&reg;': '®', '&trade;': '™',
      '&euro;': '€', '&pound;': '£', '&yen;': '¥',
      '&cent;': '¢', '&deg;': '°', '&times;': '×',
      '&divide;': '÷', '&plusmn;': '±', '&frac12;': '½',
      '&frac14;': '¼', '&frac34;': '¾'
    };
    let result = text;
    for (const [entity, char] of Object.entries(entities)) {
      result = result.split(entity).join(char);
    }
    // Decode numeric entities: &#123; or &#x1F;
    result = result.replace(/&#(\d+);/g, (_, code) => {
      const n = parseInt(code, 10);
      return n > 0 && n < 0x10FFFF ? String.fromCodePoint(n) : '';
    });
    result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const n = parseInt(hex, 16);
      return n > 0 && n < 0x10FFFF ? String.fromCodePoint(n) : '';
    });
    return result;
  }

  // ========================
  // URL SANITIZATION
  // ========================

  /**
   * Clean product/image URL:
   * - Remove UTM and tracking params
   * - Remove affiliate tags
   * - Ensure HTTPS
   * @param {string} url
   * @returns {string}
   */
  function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    url = url.trim();

    // Skip data: URIs and javascript:
    if (/^(data:|javascript:|blob:)/i.test(url)) return '';

    // Handle protocol-relative URLs
    if (url.startsWith('//')) {
      url = 'https:' + url;
    }

    try {
      const parsed = new URL(url);

      // Upgrade HTTP to HTTPS
      if (parsed.protocol === 'http:') {
        parsed.protocol = 'https:';
      }

      // Remove tracking/analytics parameters
      const trackingParams = [
        // UTM
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
        // AliExpress / Alibaba
        'spm', 'algo_pvid', 'algo_exp_id', 'btsid', 'ws_ab_test', 'aff_fcid',
        'aff_fsk', 'aff_platform', 'sk', 'aff_trace_key', 'terminal_id',
        'pdp_npi', '_t', 'scm', 'scm-url', 'pvid', 'gatewayAda498',
        // Generic
        'ref', 'ref_', 'fbclid', 'gclid', 'msclkid', 'dclid',
        'mc_cid', 'mc_eid', '_ga', '_gl', 'yclid',
        'clickid', 'click_id', 'trk', 'trkid'
      ];

      trackingParams.forEach(param => parsed.searchParams.delete(param));

      return parsed.toString();
    } catch (e) {
      // If URL parsing fails, return the original cleaned a bit
      return url;
    }
  }

  /**
   * Clean image URL specifically — also strips size constraints from AliExpress CDN
   * @param {string} url
   * @returns {string}
   */
  function sanitizeImageUrl(url) {
    if (!url) return '';
    let clean = sanitizeUrl(url);
    if (!clean) return '';

    // AliExpress CDN: remove size suffix like _640x640.jpg → .jpg
    // Pattern: _NNNxNNN or _NNNxNNN_Q80 before extension
    clean = clean.replace(/(_\d+x\d+(_Q\d+)?)(\.(?:jpg|jpeg|png|webp|gif))/i, '$3');

    // Remove .webp conversion in some CDNs
    // e.g., /img.jpg_.webp → /img.jpg
    clean = clean.replace(/\.(jpg|jpeg|png)_\.webp$/i, '.$1');

    return clean;
  }

  // ========================
  // PRICE SANITIZATION
  // ========================

  /**
   * Parse and normalize price string to number
   * Handles US (1,234.56), EU (1.234,56), and space (1 234,56) formats
   * @param {string|number} price
   * @param {string} [defaultCurrency='USD']
   * @returns {{ value: number, currency: string, formatted: string }}
   */
  function normalizePrice(price, defaultCurrency = 'USD') {
    if (typeof price === 'number') {
      return {
        value: Math.round(price * 100) / 100,
        currency: defaultCurrency,
        formatted: price.toFixed(2)
      };
    }

    if (!price || typeof price !== 'string') {
      return { value: 0, currency: defaultCurrency, formatted: '0.00' };
    }

    // Extract currency symbol/code
    let currency = defaultCurrency;
    const currencyMap = {
      '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY',
      '₹': 'INR', '₽': 'RUB', '₦': 'NGN', 'R$': 'BRL',
      'US': 'USD', 'EUR': 'EUR', 'GBP': 'GBP', 'JPY': 'JPY',
      'CAD': 'CAD', 'AUD': 'AUD'
    };
    for (const [symbol, code] of Object.entries(currencyMap)) {
      if (price.includes(symbol)) {
        currency = code;
        break;
      }
    }

    // Remove everything except digits, dots, commas
    let numStr = price.replace(/[^\d.,]/g, '');

    if (!numStr) return { value: 0, currency, formatted: '0.00' };

    // Detect format
    const lastDot = numStr.lastIndexOf('.');
    const lastComma = numStr.lastIndexOf(',');

    if (lastDot > lastComma) {
      // US format: 1,234.56 → remove commas
      numStr = numStr.replace(/,/g, '');
    } else if (lastComma > lastDot) {
      // EU format: 1.234,56 → remove dots, comma→dot
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else if (lastComma >= 0 && lastDot < 0) {
      // Only commas: could be EU decimal (3,50) or US thousands (1,000)
      const afterComma = numStr.substring(lastComma + 1);
      if (afterComma.length <= 2) {
        // Likely decimal: 3,50 → 3.50
        numStr = numStr.replace(',', '.');
      } else {
        // Likely thousands: 1,000 → 1000
        numStr = numStr.replace(/,/g, '');
      }
    }

    const value = parseFloat(numStr);
    if (isNaN(value) || value < 0) {
      return { value: 0, currency, formatted: '0.00' };
    }

    return {
      value: Math.round(value * 100) / 100,
      currency,
      formatted: value.toFixed(2)
    };
  }

  // ========================
  // RATING SANITIZATION
  // ========================

  /**
   * Normalize rating to 0-5 scale, rounded to nearest 0.5
   * Detects common scales: /5, /10, /100, percentages
   * @param {string|number} rating
   * @param {number} [maxScale=5]
   * @returns {number} Rating on 0-5 scale, rounded to 0.5
   */
  function normalizeRating(rating, maxScale = 5) {
    if (rating === null || rating === undefined || rating === '') return 0;

    let value;
    let detectedMax = maxScale;

    if (typeof rating === 'string') {
      // Try to extract "X out of Y" or "X/Y" pattern
      const ratioMatch = rating.match(/([\d.]+)\s*(?:out\s*of|\/)\s*([\d.]+)/i);
      if (ratioMatch) {
        value = parseFloat(ratioMatch[1]);
        detectedMax = parseFloat(ratioMatch[2]);
      } else {
        // Check for percentage
        const pctMatch = rating.match(/([\d.]+)\s*%/);
        if (pctMatch) {
          value = parseFloat(pctMatch[1]);
          detectedMax = 100;
        } else {
          value = parseFloat(rating.replace(/[^\d.]/g, ''));
        }
      }
    } else {
      value = Number(rating);
    }

    if (isNaN(value) || value < 0) return 0;

    // Normalize to 0-5 scale
    if (detectedMax !== 5 && detectedMax > 0) {
      value = (value / detectedMax) * 5;
    }

    // Clamp to 0-5
    value = Math.max(0, Math.min(5, value));

    // Round to nearest 0.5
    return Math.round(value * 2) / 2;
  }

  // ========================
  // WEIGHT / DIMENSIONS
  // ========================

  /**
   * Parse weight string to grams
   * @param {string} weight e.g. "1.5 kg", "200g", "0.3 lbs"
   * @returns {{ grams: number, kg: number, lbs: number }}
   */
  function normalizeWeight(weight) {
    if (!weight || typeof weight !== 'string') {
      return { grams: 0, kg: 0, lbs: 0 };
    }

    const match = weight.match(/([\d.,]+)\s*(kg|g|lb|lbs|oz|ounce|gram|kilogram|pound)/i);
    if (!match) return { grams: 0, kg: 0, lbs: 0 };

    const value = parseFloat(match[1].replace(',', '.'));
    const unit = match[2].toLowerCase();

    let grams;
    switch (unit) {
      case 'kg': case 'kilogram':
        grams = value * 1000; break;
      case 'g': case 'gram':
        grams = value; break;
      case 'lb': case 'lbs': case 'pound':
        grams = value * 453.592; break;
      case 'oz': case 'ounce':
        grams = value * 28.3495; break;
      default:
        grams = value;
    }

    return {
      grams: Math.round(grams),
      kg: Math.round(grams / 10) / 100,  // 2 decimal places
      lbs: Math.round(grams / 453.592 * 100) / 100
    };
  }

  // ========================
  // GENERAL PRODUCT DATA
  // ========================

  /**
   * Sanitize an entire product object
   * @param {object} product - Raw scraped product data
   * @returns {object} Cleaned product data
   */
  function sanitizeProduct(product) {
    if (!product || typeof product !== 'object') return {};

    const clean = { ...product };

    // Text fields
    if (clean.title) clean.title = sanitizeText(clean.title, { maxLength: 255 });
    if (clean.description) clean.description = sanitizeText(clean.description, { preserveLineBreaks: true });
    if (clean.fullDescription) clean.fullDescription = sanitizeText(clean.fullDescription, { preserveLineBreaks: true });
    if (clean.shortDescription) clean.shortDescription = sanitizeText(clean.shortDescription, { maxLength: 500 });
    if (clean.brand) clean.brand = sanitizeText(clean.brand, { maxLength: 100 });
    if (clean.category) clean.category = sanitizeText(clean.category, { maxLength: 200 });
    if (clean.sku) clean.sku = sanitizeText(clean.sku, { maxLength: 64 });

    // URLs
    if (clean.url) clean.url = sanitizeUrl(clean.url);
    if (clean.imageUrl) clean.imageUrl = sanitizeImageUrl(clean.imageUrl);
    if (clean.images && Array.isArray(clean.images)) {
      clean.images = clean.images
        .map(img => typeof img === 'string' ? sanitizeImageUrl(img) : img)
        .filter(img => img);
    }
    if (clean.videoUrls && Array.isArray(clean.videoUrls)) {
      clean.videoUrls = clean.videoUrls
        .map(v => sanitizeUrl(v))
        .filter(v => v);
    }

    // Price
    if (clean.price !== undefined) {
      const p = normalizePrice(clean.price);
      clean.priceValue = p.value;
      clean.priceCurrency = p.currency;
      clean.price = p.formatted;
    }
    if (clean.originalPrice !== undefined) {
      const p = normalizePrice(clean.originalPrice);
      clean.originalPriceValue = p.value;
      clean.originalPrice = p.formatted;
    }

    // Rating
    if (clean.rating !== undefined) {
      clean.ratingValue = normalizeRating(clean.rating);
      clean.rating = clean.ratingValue.toString();
    }

    // Weight
    if (clean.weight && typeof clean.weight === 'string') {
      clean.weightData = normalizeWeight(clean.weight);
    }

    // Review count — normalize property name
    if (clean.review_count !== undefined && clean.reviewCount === undefined) {
      clean.reviewCount = clean.review_count;
      delete clean.review_count;
    }
    if (clean.reviewCount && typeof clean.reviewCount === 'string') {
      clean.reviewCount = parseInt(clean.reviewCount.replace(/[^\d]/g, ''), 10) || 0;
    }

    return clean;
  }

  // ========================
  // CSV / XML SAFETY
  // ========================

  /**
   * Escape string for CSV output
   * Handles commas, quotes, newlines
   */
  function escapeCSV(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  /**
   * Escape string for XML CDATA — prevents CDATA injection
   * Splits ]]> sequences which would break CDATA sections
   */
  function escapeCDATA(text) {
    if (!text || typeof text !== 'string') return '';
    // Replace ]]> with ]]]]><![CDATA[> to prevent CDATA injection
    return text.replace(/\]\]>/g, ']]]]><![CDATA[>');
  }

  /**
   * Escape string for XML attribute values
   */
  function escapeXML(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ========================
  // PUBLIC API
  // ========================

  return {
    sanitizeText,
    sanitizeUrl,
    sanitizeImageUrl,
    normalizePrice,
    normalizeRating,
    normalizeWeight,
    sanitizeProduct,
    escapeCSV,
    escapeCDATA,
    escapeXML,
    decodeHTMLEntities
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.SanitizeService = SanitizeService;
}
