/**
 * Popup utility functions
 */
/* global $, CSCartMapper, saveAs, chrome */

import { state } from './state.js';

export function sendToContentScript(message, callback) {
  // Restricted pages (chrome://, about:, devtools://, etc.) cannot receive
  // content script messages — fail silently so no toast/error is shown.
  if (state.tabRestricted) {
    callback({ error: 'restricted_page' });
    return;
  }

  if (!state.tabId || typeof state.tabId !== 'number') {
    console.warn('[DropshipTracker] No valid tab ID');
    callback({ error: 'No valid tab ID' });
    return;
  }

  chrome.tabs.sendMessage(state.tabId, message, (response) => {
    if (chrome.runtime.lastError) {
      const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
      console.error('[DropshipTracker] Message error:', errorMsg);

      // Try to inject content script if it doesn't exist
      if (errorMsg.includes('Receiving end does not exist') || errorMsg.includes('Could not establish connection')) {
        // If the tab URL is a restricted scheme, don't bother trying to inject
        if (state.tabRestricted) {
          callback({ error: 'restricted_page' });
          return;
        }
        console.log('[DropshipTracker] Attempting to inject content script...');
        injectContentScript(() => {
          // Retry the message after injection
          setTimeout(() => {
            chrome.tabs.sendMessage(state.tabId, message, (retryResponse) => {
              if (chrome.runtime.lastError) {
                showToast('Content script injection failed. Please refresh the page.', 'danger');
                callback({ error: chrome.runtime.lastError.message });
              } else {
                callback(retryResponse || {});
              }
            });
          }, 500);
        });
        return;
      }
      callback({ error: errorMsg });
      return;
    }
    callback(response || {});
  });
}

/**
 * Programmatically inject content script into the current tab
 */
export function injectContentScript(callback) {
  if (state.tabRestricted) {
    console.warn('[DropshipTracker] injectContentScript: tab is restricted, skipping');
    callback && callback();
    return;
  }
  // Ping first to avoid double-injection
  chrome.tabs.sendMessage(state.tabId, { action: 'ping' }, (response) => {
    if (!chrome.runtime.lastError && response && response.pong) {
      console.log('[DropshipTracker] Content script already loaded, skipping injection');
      callback && callback();
      return;
    }
    // Not loaded yet — inject
    chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      files: ['js/jquery-3.1.1.min.js', 'js/sha256.min.js', 'onload.js']
    }).then(() => {
      console.log('[DropshipTracker] Content script injected successfully');
      chrome.scripting.insertCSS({
        target: { tabId: state.tabId },
        files: ['onload.css']
      }).then(() => {
        callback && callback();
      }).catch(e => {
        console.error('[DropshipTracker] CSS injection failed:', e);
        callback && callback();
      });
    }).catch(e => {
      console.error('[DropshipTracker] Script injection failed:', e);
      showToast('Could not inject script. Page may be restricted.', 'danger');
      callback && callback();
    });
  });
}

export function showLoading(text) {
  $('#loadingText').text(text || 'Loading...');
  $('#loadingOverlay').css('display', 'flex');
}

export function hideLoading() {
  $('#loadingOverlay').hide();
}

export function setStatus(text) {
  $('#statusText').text(text);
}

export function updateRowCount(count) {
  $('#rowCount').text(count);
}

export function updatePageCount(count) {
  $('#pageCount').text(count);
}

export function updateExportButtons() {
  const hasData = state.data.length > 0;
  $('#exportXmlBtn, #exportCsvBtn, #copyClipboardBtn, #downloadRawBtn').prop('disabled', !hasData);
  $('#addToCatalogBtn').prop('disabled', !hasData);
  $('#clearScrapedBtn').prop('disabled', !hasData);
}

export function showToast(message, type = 'info') {
  const $toast = $('#toast');
  $('#toastMessage').text(message);
  $toast.removeClass('success error warning').addClass(type).addClass('show');

  setTimeout(() => {
    $toast.removeClass('show');
  }, 3000);
}

export function parsePrice(priceStr) {
  // Delegate to CSCartMapper's more robust implementation
  if (typeof CSCartMapper !== 'undefined') {
    return parseFloat(CSCartMapper.parsePrice(priceStr)) || 0;
  }
  // Fallback if CSCartMapper not loaded
  if (typeof priceStr === 'number') return priceStr > 1000000 ? 0 : priceStr;
  if (!priceStr) return 0;
  // Extract first price-like number (with currency symbol nearby)
  const priceMatch = priceStr.toString().match(/[\$\u20AC\u00A3\u00A5\u20A6]?\s*([\d,]+\.?\d{0,2})\b/);
  if (priceMatch) {
    const num = parseFloat(priceMatch[1].replace(/,/g, ''));
    if (num > 0.01 && num < 1000000) return num;
  }
  // Final fallback: strip non-numeric
  const cleaned = priceStr.toString().replace(/[^0-9.,]/g, '');
  const normalized = cleaned.includes(',') && cleaned.indexOf(',') > cleaned.indexOf('.')
    ? cleaned.replace('.', '').replace(',', '.')
    : cleaned.replace(',', '');
  const result = parseFloat(normalized) || 0;
  return result < 1000000 ? result : 0; // Sanity cap
}

export function calculateSellingPrice(supplierPrice, shippingCost = 0) {
  if (!supplierPrice || !state.settings) return supplierPrice;

  // Start with supplier price
  let costBasis = parseFloat(supplierPrice) || 0;

  // Add shipping to cost basis if enabled (default: true)
  if (state.settings.includeShippingInCost !== false && shippingCost > 0) {
    costBasis += parseFloat(shippingCost) || 0;
  }

  let price;
  const margin = state.settings.defaultMargin || 30;

  if (state.settings.marginType === 'percent') {
    price = costBasis * (1 + margin / 100);
  } else {
    price = costBasis + margin;
  }

  // Round if enabled
  if (state.settings.roundPrices) {
    const roundTo = parseFloat(state.settings.roundTo) || 0.99;
    price = Math.floor(price) + roundTo;
  }

  return Math.round(price * 100) / 100;
}

export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  saveAs(blob, filename);
}

export function s2ab(s) {
  const buf = new ArrayBuffer(s.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < s.length; i++) {
    view[i] = s.charCodeAt(i) & 0xFF;
  }
  return buf;
}

export function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

export function getShortFieldName(fullPath) {
  // Extract meaningful name from path like "/div.class/span.text"
  const parts = fullPath.split('/').filter(p => p);
  const last = parts[parts.length - 1] || fullPath;

  // Check for attribute suffix (href, src)
  let suffix = '';
  if (fullPath.includes(' ')) {
    suffix = fullPath.split(' ').slice(1).join(' ').replace('@', '');
  }

  // Use class names if available
  const classMatch = last.match(/\.([a-zA-Z_-]+)/);
  if (classMatch) {
    const name = classMatch[1].replace(/-/g, '_');
    return suffix ? name + ' ' + suffix : name;
  }

  const tagName = last.split('.')[0] || 'field';
  return suffix ? tagName + ' ' + suffix : tagName;
}

/**
 * IDS-ported smart column naming algorithm
 * Walks DOM path segments in reverse, picks the most specific CSS class
 * (the one used least often across all field paths = most unique)
 *
 * @param {string[]} allFieldPaths - All field paths across all rows
 * @returns {Object} Map of fullPath → friendlyName
 */
export function buildSmartColumnNames(allFieldPaths) {
  // 1. Build class frequency across ALL paths — classes appearing in fewer paths are more specific
  const classPathCount = {};  // className → count of paths containing it
  allFieldPaths.forEach(path => {
    const seen = new Set();
    const segments = path.split(' ')[0].split('/').filter(p => p);
    segments.forEach(seg => {
      const classes = seg.split('.').slice(1);
      classes.forEach(cls => {
        if (!seen.has(cls)) {
          seen.add(cls);
          classPathCount[cls] = (classPathCount[cls] || 0) + 1;
        }
      });
    });
  });

  // 2. For each path, find the most specific (least-frequent) class name
  const nameMap = {};   // fullPath → friendlyName
  const nameUsage = {}; // friendlyName → count (for collision handling)

  allFieldPaths.forEach(path => {
    // Extract suffix (href, src, etc.)
    let suffix = '';
    const spaceParts = path.split(' ');
    if (spaceParts.length > 1) {
      suffix = spaceParts.slice(1).join(' ').replace(/@/g, '');
    }

    // Walk segments in REVERSE (deepest = most specific)
    const segments = spaceParts[0].split('/').filter(p => p);
    let bestClass = '';
    let bestScore = Infinity;

    for (let i = segments.length - 1; i >= 0; i--) {
      const classes = segments[i].split('.').slice(1);
      for (const cls of classes) {
        if (!cls) continue;
        // Skip generic container/wrapper classes
        if (/^(container|wrapper|wrap|inner|outer|row|col|content|main|section|block|box|item|list|group|div)$/i.test(cls)) continue;

        const score = classPathCount[cls] || 0;
        // Prefer classes that appear in fewer paths (more specific)
        // On tie, prefer deeper (later in reverse = current i is smaller, so earlier segment)
        if (score < bestScore) {
          bestScore = score;
          bestClass = cls;
        }
      }
    }

    // Fallback: use tag name of deepest element
    if (!bestClass) {
      const lastSeg = segments[segments.length - 1] || '';
      bestClass = lastSeg.split('.')[0] || 'field';
    }

    // Clean up the name
    let friendlyName = bestClass
      .replace(/--/g, '-')     // collapse double dashes
      .replace(/^-|-$/g, '')   // trim dashes
      .replace(/-/g, '_');     // dashes to underscores

    if (suffix) friendlyName += ' ' + suffix;

    // Handle collisions — append counter
    nameUsage[friendlyName] = (nameUsage[friendlyName] || 0) + 1;
    if (nameUsage[friendlyName] > 1) {
      friendlyName += ' ' + nameUsage[friendlyName];
    }

    nameMap[path] = friendlyName;
  });

  return nameMap;
}

/**
 * Filter out noise columns from scraped data (ported from IDS)
 * Removes: identical-value columns, very low fill-rate columns
 */
export function filterNoiseColumns(fields, rawData) {
  return fields.filter(field => {
    // Collect non-empty values for this field
    const values = [];
    rawData.forEach(row => {
      const v = row[field];
      if (v !== undefined && v !== null && v !== '') {
        values.push(String(v).trim());
      }
    });

    // Drop columns with no data
    if (values.length === 0) return false;

    // Drop columns where ALL values are identical (boilerplate: headers, footers, badges)
    const unique = new Set(values);
    if (unique.size === 1 && values.length > 2) return false;

    return true;
  });
}

/**
 * Deduplicate rows using JSON string comparison (ported from IDS).
 * Removes exact duplicate rows from accumulated data.
 */
export function deduplicateRows(data) {
  const seen = new Set();
  return data.filter(row => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
