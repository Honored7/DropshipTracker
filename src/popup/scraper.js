/**
 * Scraper functions – find tables, extract products, crawl pagination,
 * process scraped data, test scrape diagnostic, selector picker
 */
/* global $, chrome, SanitizeService, CartTemplateRegistry */

import { state, MAX_VISIBLE_COLUMNS, FIELD_THRESHOLD, MAX_COLUMNS_EXPANDED } from './state.js';
import {
  sendToContentScript, showLoading, hideLoading, setStatus,
  updateRowCount, updatePageCount, updateExportButtons,
  showToast, parsePrice, calculateSellingPrice, debounce,
  getShortFieldName, buildSmartColumnNames, filterNoiseColumns, deduplicateRows
} from './utils.js';
import { saveScrapedData, clearScrapedSession, saveCustomSelectors, updateCustomSelectorsList } from './persistence.js';
import { updateDataTable, updateExpandToggle } from './dataTable.js';
import { showFieldMapping, EXPORT_FIELDS, autoDetectMapping } from './fieldMapping.js';
import { isBackendAvailable, extractViaBackend, resetBackendCache } from './backendClient.js';

// ============================================
// SELECTOR PICKER
// ============================================

export function handleSelectorPickerResult(message) {
  if (message.success) {
    state.customSelectors[message.field] = {
      selector: message.selector,
      sampleValue: message.sampleValue,
      savedAt: Date.now()
    };
    saveCustomSelectors();
    updateCustomSelectorsList();
    showToast(`✓ Selector saved for "${message.field}": ${message.sampleValue?.substring(0, 50)}...`, 'success');
  } else if (message.cancelled) {
    showToast('Selector picking cancelled', 'info');
  }
}

export function startPickSelector() {
  const fieldOptions = EXPORT_FIELDS
    .filter(f => f.id)
    .map(f => `<option value="${f.id}">${f.label}</option>`)
    .join('');

  const modal = `
    <div id="pickSelectorModal" class="modal fade" tabindex="-1">
      <div class="modal-dialog modal-sm">
        <div class="modal-content">
          <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal">&times;</button>
            <h4 class="modal-title">🎯 Pick Element Selector</h4>
          </div>
          <div class="modal-body">
            <p>Select the field you want to define a custom selector for:</p>
            <select id="pickerFieldSelect" class="form-control">
              ${fieldOptions}
            </select>
            <div class="alert alert-info" style="margin-top:12px;font-size:12px;padding:8px;">
              <strong>Works on any page!</strong><br>
              • <strong>List pages:</strong> Improves table scraping<br>
              • <strong>Product pages:</strong> Used by Extract Product<br>
              <hr style="margin:6px 0;">
              Hover over elements to preview, click to select. Press <kbd>ESC</kbd> to cancel.
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="startPickingBtn">🎯 Start Picking</button>
          </div>
        </div>
      </div>
    </div>
  `;

  $('#pickSelectorModal').remove();
  $('body').append(modal);

  $('#startPickingBtn').on('click', function() {
    const field = $('#pickerFieldSelect').val();
    if (!field) {
      showToast('Please select a field', 'warning');
      return;
    }

    $('#pickSelectorModal').modal('hide');

    sendToContentScript({ action: 'startSelectorPicker', field: field }, (response) => {
      if (response && response.started) {
        showToast(`Picker active for "${field}". Click element on page or ESC to cancel.`, 'info');
      } else {
        showToast('Failed to start selector picker. Reload the page and try again.', 'danger');
      }
    });
  });

  $('#pickSelectorModal').modal('show');
}

// ============================================
// TABLE SCRAPING
// ============================================

export function findTables() {
  setStatus('Scanning page for data tables...');

  sendToContentScript({ action: 'findTables' }, (response) => {
    if (response && response.tableCount > 0) {
      setStatus(`Found ${response.tableCount} potential data tables`);
      $('#tableCounter').text(`1/${response.tableCount}`);
      $('#nextTableBtn').prop('disabled', response.tableCount <= 1);
      state.tableSelector = response.selector;
      getTableData();
    } else {
      setStatus('No data tables found on this page');
      showToast('No tables found. Try a different page or use Extract Product for single items.', 'warning');
    }
  });
}

export function nextTable() {
  sendToContentScript({ action: 'nextTable' }, (response) => {
    if (response && !response.error) {
      $('#tableCounter').text(`${response.currentTable + 1}/${response.tableCount}`);
      state.tableSelector = response.selector;
      getTableData();
    }
  });
}

export function getTableData() {
  setStatus('Extracting data...');

  sendToContentScript({ action: 'getTableData', selector: state.tableSelector }, (response) => {
    if (response && response.data && response.data.length > 0) {
      processScrapedData(response.data);
      setStatus(`Extracted ${response.data.length} rows`);
      updateRowCount(response.data.length);

      $('#crawlBtn').prop('disabled', false);
      $('#addToCatalogBtn').prop('disabled', false);
      updateExportButtons();
      showFieldMapping();
    } else {
      setStatus('No data extracted from table');
    }
  });
}

export function extractProduct() {
  setStatus('Extracting product details...');
  showLoading('Extracting product details...');

  // Try Scrapling backend first; fall back to the in-page content script if
  // the backend is not running or returns an error.
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tabUrl = tabs?.[0]?.url ?? '';
    let usedBackend = false;

    try {
      const backendUp = await isBackendAvailable();
      if (backendUp && tabUrl) {
        try {
          const backendResponse = await extractViaBackend(tabUrl);
          if (backendResponse && (backendResponse.title || backendResponse.productId)) {
            usedBackend = true;
            console.log('[DropshipTracker] Product extracted via Scrapling backend');
            _handleExtractedProduct(backendResponse);
            return;
          }
        } catch (backendErr) {
          console.warn('[DropshipTracker] Backend extraction failed, falling back to content script:', backendErr.message);
          // Reset cache so next call re-probes
          resetBackendCache();
        }
      }
    } catch (probeErr) {
      console.warn('[DropshipTracker] Backend probe error:', probeErr.message);
    }

    // Fallback: in-page content script extraction
    if (!usedBackend) {
      sendToContentScript({ action: 'extractProduct' }, (response) => {
        if (response && (response.title || response.productId)) {
          _handleExtractedProduct(response);
        } else {
          setStatus('Could not extract product details');
          showToast('No product data found. Make sure you\'re on a product page.', 'warning');
          hideLoading();
        }
      });
    }
  });
}

/**
 * Shared handler for extracted product data — works for both backend and
 * content-script responses.  Matches the original extractProduct() flow.
 *
 * @param {object} response
 */
function _handleExtractedProduct(response) {
      const sanitized = typeof SanitizeService !== 'undefined'
        ? SanitizeService.sanitizeProduct(response)
        : response;

      const row = {
        'Product ID': sanitized.productId || '',
        'Title': sanitized.title || '',
        'Price': sanitized.price || '',
        'Original Price': sanitized.originalPrice || '',
        'Currency': sanitized.currency || 'USD',
        'Short Description': sanitized.shortDescription || '',
        'Description': sanitized.descriptionText || sanitized.description || '',
        'Full Description': sanitized.fullDescription || '',
        'Category': sanitized.category || '',
        'Images': (sanitized.images || []).join('|||'),
        'URL': sanitized.url || '',
        'Domain': sanitized.domain || '',
        'Variants': JSON.stringify(sanitized.variants || []),
        'Variant Groups': JSON.stringify(sanitized.variantGroups || []),
        'Reviews': JSON.stringify(sanitized.reviews || []),
        'Rating': sanitized.rating || '',
        'Review Count': sanitized.reviewCount || '',
        'Sold': sanitized.soldCount || sanitized.orders || '',
        'Brand': sanitized.brand || '',
        'SKU': sanitized.sku || '',
        'Stock': sanitized.stock || '',
        'Availability': sanitized.availability || '',
        'Weight': sanitized.weight || '',
        'Shipping': sanitized.shippingText || sanitized.shipping || '',
        'Shipping Cost': sanitized.shippingCost || '',
        'Store': sanitized.storeName || '',
        'Store Rating': sanitized.storeRating || '',
        'Min Order': sanitized.minOrder || '',
        'Video URLs': (sanitized.videoUrls || []).join('|||'),
        'Specifications': JSON.stringify(sanitized.specifications || []),
        'Meta Keywords': sanitized.metaKeywords || '',
        'Meta Description': sanitized.metaDescription || sanitized.shortDescription || ''
      };

      const existingIndex = state.rawData.findIndex(r =>
        (r.productId && r.productId === response.productId) ||
        (r.url && r.url === response.url)
      );

      if (existingIndex >= 0) {
        state.rawData[existingIndex] = { ...state.rawData[existingIndex], ...response };
        state.data[existingIndex] = { ...state.data[existingIndex], ...row };
        showToast(`Updated existing product: ${response.title?.substring(0, 40)}...`, 'success');
      } else {
        state.rawData.push(response);
        state.data.push(row);
        showToast(`Added product: ${response.title?.substring(0, 40)}...`, 'success');
      }

      Object.keys(row).forEach(key => {
        if (!state.fieldNames.includes(key)) {
          state.fieldNames.push(key);
        }
      });

      updateDataTable(state.data);
      setStatus(`${state.data.length} products in scraper`);
      updateRowCount(state.data.length);

      $('#addToCatalogBtn').prop('disabled', false);
      updateExportButtons();
      showFieldMapping();
      saveScrapedData();
      hideLoading();
}

// ============================================
// PROCESS SCRAPED DATA
// ============================================

export function processScrapedData(rawData) {
  console.log('[DropshipTracker] Processing scraped data:', rawData.length, 'rows');
  state.rawData = rawData;

  const fieldCounts = {};
  rawData.forEach(row => {
    Object.keys(row).forEach(key => {
      if (row[key] && !key.startsWith('_')) {
        fieldCounts[key] = (fieldCounts[key] || 0) + 1;
      }
    });
  });

  console.log('[DropshipTracker] Field counts:', Object.keys(fieldCounts).length, 'unique fields');

  const threshold = Math.max(1, rawData.length * FIELD_THRESHOLD);
  let allGoodFields = Object.entries(fieldCounts)
    .filter(([_, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([field]) => field);

  // Column deduplication
  const valueFingerprints = {};
  allGoodFields.forEach(field => {
    const values = [];
    for (let i = 0; i < Math.min(rawData.length, 20); i++) {
      const v = rawData[i][field];
      if (v !== undefined && v !== null && v !== '') {
        values.push(String(v).trim().substring(0, 100));
      }
    }
    const fingerprint = values.join('||||');
    if (fingerprint && fingerprint.length > 0) {
      if (!valueFingerprints[fingerprint]) {
        valueFingerprints[fingerprint] = field;
      } else {
        const existing = valueFingerprints[fingerprint];
        if (field.length < existing.length) {
          valueFingerprints[fingerprint] = field;
        }
      }
    }
  });
  const dedupedFields = new Set(Object.values(valueFingerprints));
  const beforeDedup = allGoodFields.length;
  allGoodFields = allGoodFields.filter(f => dedupedFields.has(f));
  if (beforeDedup !== allGoodFields.length) {
    console.log(`[DropshipTracker] Column dedup: ${beforeDedup} → ${allGoodFields.length} fields`);
  }

  console.log('[DropshipTracker] Good fields after threshold + dedup:', allGoodFields.length);

  // Noise column filtering
  const beforeNoise = allGoodFields.length;
  allGoodFields = filterNoiseColumns(allGoodFields, rawData);
  if (beforeNoise !== allGoodFields.length) {
    console.log(`[DropshipTracker] Noise filter: ${beforeNoise} → ${allGoodFields.length} fields`);
  }

  state.allFieldNames = allGoodFields;

  const maxCols = state.showAllColumns ? MAX_COLUMNS_EXPANDED : MAX_VISIBLE_COLUMNS;
  state.fieldNames = allGoodFields.slice(0, maxCols);

  console.log('[DropshipTracker] Visible fields:', state.fieldNames.length);

  updateExpandToggle();

  // Smart column naming
  const smartNames = buildSmartColumnNames(state.fieldNames);
  state.smartNames = smartNames;

  const displayData = rawData.map(row => {
    const displayRow = {};
    state.fieldNames.forEach(field => {
      const friendlyName = smartNames[field] || getShortFieldName(field);
      displayRow[friendlyName] = row[field] || '';
    });
    return displayRow;
  });

  console.log('[DropshipTracker] Display data sample:', displayData[0]);

  state.data = displayData;
  updateDataTable(displayData);
  showFieldMapping();
  saveScrapedData();
}

// ============================================
// CRAWL / PAGINATION
// ============================================

export function locateNextButton() {
  setStatus('Click on the "Next" button on the page...');
  showToast('Click on the pagination "Next" button on the page', 'info');

  sendToContentScript({ action: 'selectNextButton' }, (response) => {
    if (response && response.selector) {
      state.nextSelector = response.selector;
      $('#nextSelectorInput').val(response.selector);
      $('#crawlBtn').prop('disabled', false);
      setStatus('Next button located');
      showToast('Next button selected! Click "Crawl" to start pagination.', 'success');
    }
  });
}

export function startCrawl() {
  if (!state.nextSelector) {
    showToast('Please locate the "Next" button first', 'warning');
    return;
  }

  state.scraping = true;
  state.pages = 1;
  state.visitedHashes = [];

  $('#crawlBtn').prop('disabled', true);
  $('#stopCrawlBtn').prop('disabled', false);
  $('#findTablesBtn').prop('disabled', true);

  setStatus('Crawling... Page 1');
  crawlNextPage();
}

export function crawlNextPage() {
  if (!state.scraping) return;

  sendToContentScript({ action: 'getPageHash' }, (hashResponse) => {
    if (hashResponse && hashResponse.hash) {
      const hashes = state.visitedHashes;
      const h = hashResponse.hash;
      if ((hashes.length >= 1 && hashes[hashes.length - 1] === h) ||
          (hashes.length >= 2 && hashes[hashes.length - 2] === h)) {
        setStatus('Reached end (duplicate page detected)');
        stopCrawl();
        return;
      }
      state.visitedHashes.push(h);
    }

    sendToContentScript({ action: 'getTableData', selector: state.tableSelector }, (dataResponse) => {
      if (dataResponse && dataResponse.data) {
        state.rawData = deduplicateRows(state.rawData.concat(dataResponse.data));
        processScrapedData(state.rawData);
        updateRowCount(state.rawData.length);
        updatePageCount(state.pages);
      }

      waitForNetworkIdle(
        (done) => {
          sendToContentScript({ action: 'clickNext', selector: state.nextSelector }, (clickResponse) => {
            if (clickResponse && clickResponse.success) {
              state.pages++;
              setStatus(`Crawling... Page ${state.pages}`);
              done();
            } else {
              setStatus('Reached end (no more pages)');
              stopCrawl();
            }
          });
        },
        () => {
          crawlNextPage();
        }
      );
    });
  });
}

export function stopCrawl() {
  state.scraping = false;

  $('#crawlBtn').prop('disabled', false);
  $('#stopCrawlBtn').prop('disabled', true);
  $('#findTablesBtn').prop('disabled', false);

  setStatus(`Crawl complete. ${state.rawData.length} rows from ${state.pages} pages.`);
  showToast(`Scraped ${state.rawData.length} items from ${state.pages} pages`, 'success');
}

export function waitForNetworkIdle(actionFn, callback) {
  const tabId = state.tabId;
  const crawlDelay = state.settings?.crawlDelay || 2000;
  const maxWait = state.settings?.maxWait || 5000;
  const minIdleGap = 100;

  const pendingRequests = {};
  let lastRequestTime = null;
  let settled = false;
  let idleCheckEnabled = false;

  const filter = {
    urls: ['<all_urls>'],
    tabId: tabId,
    types: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'font', 'object', 'xmlhttprequest', 'other']
  };

  function finish() {
    if (settled) return;
    settled = true;
    try {
      chrome.webRequest.onBeforeRequest.removeListener(onBefore);
      chrome.webRequest.onCompleted.removeListener(onDone);
      chrome.webRequest.onErrorOccurred.removeListener(onDone);
    } catch (e) { /* listeners may already be removed */ }
    callback();
  }

  function trySettle() {
    if (settled || !idleCheckEnabled) return;
    if (lastRequestTime && (Date.now() - lastRequestTime < minIdleGap)) {
      setTimeout(trySettle, minIdleGap);
      return;
    }
    if (Object.keys(pendingRequests).length > 0) return;
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, (resp) => {
      if (resp !== undefined) {
        finish();
      } else {
        setTimeout(trySettle, minIdleGap);
      }
    });
  }

  function onBefore(details) {
    pendingRequests[details.requestId] = 1;
    lastRequestTime = Date.now();
  }

  function onDone(details) {
    delete pendingRequests[details.requestId];
    if (lastRequestTime && Object.keys(pendingRequests).length === 0) {
      setTimeout(trySettle, minIdleGap);
    }
  }

  chrome.webRequest.onBeforeRequest.addListener(onBefore, filter);
  chrome.webRequest.onCompleted.addListener(onDone, filter);
  chrome.webRequest.onErrorOccurred.addListener(onDone, filter);

  actionFn(() => {
    setTimeout(() => {
      idleCheckEnabled = true;
      trySettle();
    }, crawlDelay);

    setTimeout(finish, maxWait);
  });
}

// ============================================
// TEST SCRAPE DIAGNOSTIC
// ============================================

export function testScrape() {
  $('#testScrapeLoading').show();
  $('#testScrapeResults').hide();
  $('#testScrapeModal').modal('show');

  let productResult = null;
  let tableResult = null;

  const timeout = setTimeout(() => {
    console.warn('[DropshipTracker] Test scrape timed out');
    renderTestDiagnostic(productResult, tableResult);
  }, 15000);

  sendToContentScript({ action: 'extractProduct' }, (response) => {
    productResult = response;

    sendToContentScript({ action: 'getTableData', selector: state.tableSelector || '' }, (response2) => {
      tableResult = response2;
      clearTimeout(timeout);
      renderTestDiagnostic(productResult, tableResult);
    });
  });
}

export function renderTestDiagnostic(product, table) {
  $('#testScrapeLoading').hide();
  $('#testScrapeResults').show();

  const criticalFields = [
    { key: 'title', label: 'Title' },
    { key: 'price', label: 'Price' },
    { key: 'originalPrice', label: 'Original Price' },
    { key: 'currency', label: 'Currency' },
    { key: 'images', label: 'Images', format: v => Array.isArray(v) ? `${v.length} images` : 'none' },
    { key: 'rating', label: 'Rating' },
    { key: 'reviewCount', label: 'Review Count' },
    { key: 'soldCount', label: 'Sold / Orders' },
    { key: 'description', label: 'Description', format: v => v ? `${String(v).length} chars` : 'none' },
    { key: 'category', label: 'Category' },
    { key: 'brand', label: 'Brand' },
    { key: 'sku', label: 'SKU (Supplier Code)' },
    { key: 'stock', label: 'Stock' },
    { key: 'weight', label: 'Weight' },
    { key: 'shipping', label: 'Shipping' },
    { key: 'storeName', label: 'Store Name' },
    { key: 'specifications', label: 'Specs', format: v => Array.isArray(v) ? `${v.length} specs` : (v ? 'yes' : 'none') },
    { key: 'variants', label: 'Variants', format: v => Array.isArray(v) ? `${v.length} variants` : 'none' },
  ];

  let html = '<thead><tr><th>Field</th><th>Status</th><th>Value</th></tr></thead><tbody>';
  let found = 0;
  for (const f of criticalFields) {
    const val = product ? product[f.key] : null;
    const hasValue = val !== null && val !== undefined && val !== '' &&
                     !(Array.isArray(val) && val.length === 0);
    const display = hasValue ? (f.format ? f.format(val) : String(val).substring(0, 80)) : '';
    const icon = hasValue
      ? '<span class="glyphicon glyphicon-ok text-success"></span>'
      : '<span class="glyphicon glyphicon-remove text-danger"></span>';
    if (hasValue) found++;
    html += `<tr><td>${f.label}</td><td>${icon}</td><td><small>${display}</small></td></tr>`;
  }
  html += '</tbody>';
  $('#testProductTable').html(html);

  let tableSummary = '';
  if (table && table.data && table.data.length > 0) {
    const sampleRow = table.data[0];
    const cols = Object.keys(sampleRow);
    tableSummary = `<p><strong>${table.data.length}</strong> rows, <strong>${cols.length}</strong> columns</p>`;
    tableSummary += '<ul class="list-unstyled" style="max-height:150px;overflow:auto;">';
    for (const col of cols) {
      const sampleVal = sampleRow[col] || '';
      tableSummary += `<li><small><strong>${col}:</strong> ${String(sampleVal).substring(0, 60)}</small></li>`;
    }
    tableSummary += '</ul>';
  } else {
    tableSummary = '<p class="text-muted">No table detected. Click "Find Tables" first.</p>';
  }
  $('#testTableSummary').html(tableSummary);

  const pct = Math.round((found / criticalFields.length) * 100);
  const color = pct >= 70 ? 'success' : pct >= 40 ? 'warning' : 'danger';
  let scoreHtml = `<div class="text-${color}"><strong>${found}/${criticalFields.length} fields extracted (${pct}%)</strong></div>`;
  scoreHtml += `<div class="progress" style="margin-top:5px;"><div class="progress-bar progress-bar-${color}" style="width:${pct}%"></div></div>`;
  if (pct < 70) {
    scoreHtml += '<p class="text-muted" style="margin-top:5px;"><small>Tip: Try "Extract Product" on a product detail page. Use "Pick Selector" to map missing fields manually.</small></p>';
  }
  $('#testScrapeScore').html(scoreHtml);

  const jsonFields = ['title', 'price', 'originalPrice', 'currency', 'sku', 'rating',
                      'reviewCount', 'brand', 'category', 'stock', 'shipping', 'orders'];
  const jsonData = {};
  for (const k of jsonFields) {
    if (product && product[k] !== null && product[k] !== undefined) {
      jsonData[k] = product[k];
    }
  }
  $('#testJsonRaw').text(JSON.stringify(jsonData, null, 2));
}

// ============================================
// CLEAR
// ============================================

export function clearAllScrapedData() {
  if (state.data.length === 0) {
    showToast('No scraped data to clear', 'info');
    return;
  }

  if (!confirm(`Clear all ${state.data.length} scraped rows? This cannot be undone.`)) {
    return;
  }

  state.data = [];
  state.rawData = [];
  state.fieldNames = [];
  state.fieldMapping = {};

  state.dataTable.loadData([]);
  updateExportButtons();
  $('#rowCount').text('0');
  $('#clearScrapedBtn').prop('disabled', true);
  $('#fieldMappingSection').hide();

  clearScrapedSession();

  showToast('All scraped data cleared', 'success');
  setStatus('Ready. Click "Find Tables" to detect data on page.');
}
