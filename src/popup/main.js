/**
 * DropshipTracker Popup – main entry point
 * Initializes UI, binds events, and wires all modules together
 */
/* global $, chrome, CartTemplateRegistry */

import { state } from './state.js';
import { debounce, showToast } from './utils.js';
import { loadScrapedData, loadPersistedFieldMapping, loadCustomSelectors, saveCustomSelectors, updateCustomSelectorsList } from './persistence.js';
import { initializeDataTable, toggleExpandColumns } from './dataTable.js';
import { initializeCatalogTable, refreshCatalogTable, selectAllProducts, deselectAllProducts, invertSelection, selectByFilter, filterCatalog } from './catalogTable.js';
import { handleSelectorPickerResult, startPickSelector, findTables, nextTable, extractProduct, locateNextButton, startCrawl, stopCrawl, testScrape, clearAllScrapedData, enterTableMode } from './scraper.js';
import { loadCatalog, addToCatalog, updateCatalogFromPage, scrapeSelectedProducts, deleteSelectedProducts, clearEntireCatalog, checkPrices } from './catalog.js';
import { autoMapFields } from './fieldMapping.js';
import { exportCSCart, exportCatalog, copyToClipboard, downloadRawXlsx } from './export.js';
import { deletePreviewedItem } from './preview.js';
import { checkDriveAuth, authorizeDrive, disconnectDrive, uploadToDrive, syncCatalogToDrive } from './googleDrive.js';
import { loadSettings, saveSettings, loadSuppliers, saveNewSupplier, exportAllData, importData, clearAllData } from './settings.js';
import { isBackendAvailable, resetBackendCache } from './backendClient.js';

// ============================================
// INITIALIZATION
// ============================================

$(document).ready(function() {
  const params = new URLSearchParams(window.location.search);
  const rawTabId = params.get('tabid');
  state.tabId = rawTabId ? parseInt(rawTabId, 10) : null;
  if (isNaN(state.tabId)) state.tabId = null;

  state.tabUrl = decodeURIComponent(params.get('url') || '');

  // Detect restricted schemes where content scripts cannot be injected
  const RESTRICTED_SCHEMES = /^(chrome:|chrome-extension:|about:|data:|view-source:|devtools:|edge:|brave:|moz-extension:|javascript:)/i;
  state.tabRestricted = !state.tabUrl || RESTRICTED_SCHEMES.test(state.tabUrl);

  try {
    state.tabDomain = new URL(state.tabUrl).hostname;
  } catch(e) {
    state.tabDomain = 'unknown';
  }

  // Initialize
  loadSettings();
  loadCatalog();
  loadSuppliers();
  loadScrapedData();
  loadPersistedFieldMapping();
  loadCustomSelectors();
  initializeDataTable();
  initializeCatalogTable();
  bindEvents();
  checkDriveAuth();
  _checkBackend();
  setInterval(_checkBackend, 30000);

  // Show restricted-page banner and disable scraper buttons if needed
  if (state.tabRestricted) {
    $('#restrictedBanner').show();
    $('#findTablesBtn, #extractProductBtn, #updateCatalogBtn, #locateNextBtn, #crawlBtn, #stopCrawlBtn, #testScrapeBtn').prop('disabled', true);
    setStatus('Open a product/listing page to use the scraper.');
  }

  // Listen for messages from content script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'selectorPickerResult') {
      handleSelectorPickerResult(message);
    }
  });

  // Cleanup on popup close
  window.addEventListener('beforeunload', () => {
    if (state.dataTable) {
      try { state.dataTable.destroy(); } catch(e) {}
    }
    if (state.catalogTable) {
      try { state.catalogTable.destroy(); } catch(e) {}
    }
  });

  console.log("[DropshipTracker] Popup initialized for tab", state.tabId, "domain:", state.tabDomain);
});

// ============================================
// BACKEND STATUS
// ============================================

async function _checkBackend() {
  resetBackendCache();
  const up = await isBackendAvailable();
  const dot = document.querySelector('#backendStatus .backend-dot');
  const wrap = document.getElementById('backendStatus');
  if (dot) {
    dot.classList.toggle('up', up);
    dot.classList.toggle('down', !up);
  }
  if (wrap) {
    wrap.title = up
      ? 'Scrapling backend: running ✓'
      : 'Scrapling backend: offline — run: uvicorn backend.main:app --port 8000';
  }
}

// ============================================
// EVENT BINDINGS
// ============================================

function bindEvents() {
  // Tab switching
  $('a[data-toggle="tab"]').on('shown.bs.tab', function(e) {
    const target = $(e.target).attr('href');
    if (target === '#catalog') {
      refreshCatalogTable();
    }
  });

  // === SCRAPER TAB ===
  $('#findTablesBtn').on('click', findTables);
  $('#nextTableBtn').on('click', nextTable);
  $('#extractProductBtn').on('click', extractProduct);
  $('#updateCatalogBtn').on('click', updateCatalogFromPage);
  $('#locateNextBtn').on('click', locateNextButton);
  $('#crawlBtn').on('click', startCrawl);
  $('#stopCrawlBtn').on('click', stopCrawl);
  $('#addToCatalogBtn').on('click', addToCatalog);
  $('#clearScrapedBtn').on('click', clearAllScrapedData);
  $('#testScrapeBtn').on('click', testScrape);

  // Product panel buttons
  $('#ppAddBtn').on('click', addToCatalog);
  $('#ppClearBtn').on('click', clearAllScrapedData);
  $('#ppSwitchToTableBtn, #ppTableViewBtn').on('click', enterTableMode);

  // Export buttons
  $('#exportXmlBtn').on('click', () => exportCSCart('xml'));
  $('#exportCsvBtn').on('click', () => exportCSCart('csv'));
  $('#uploadDriveBtn').on('click', uploadToDrive);
  $('#copyClipboardBtn').on('click', copyToClipboard);
  $('#downloadRawBtn').on('click', downloadRawXlsx);

  // Cart template selection
  $('#cartTemplateSelect').on('change', function() {
    const templateId = $(this).val();
    const supportsXml = typeof CartTemplateRegistry !== 'undefined' && CartTemplateRegistry.supportsXML(templateId);
    $('#exportXmlBtn').prop('disabled', !supportsXml && state.data.length === 0)
      .toggleClass('btn-success', supportsXml)
      .toggleClass('btn-default', !supportsXml);
    if (!supportsXml) {
      $('#exportXmlBtn').attr('title', 'This format does not support XML export');
    } else {
      $('#exportXmlBtn').attr('title', '');
    }

    const templateNames = { cscart: 'CS-Cart', shopify: 'Shopify', woocommerce: 'WooCommerce', prestashop: 'PrestaShop', magento: 'Magento', bigcommerce: 'BigCommerce' };
    const templateLabel = templateNames[templateId] || 'Export';
    $('#mappingHeaderText').text('Map Fields for ' + templateLabel);
  });

  // Field mapping
  $('#autoMapBtn').on('click', autoMapFields);

  // Expand columns toggle
  $('#expandColumnsToggle').on('click', toggleExpandColumns);

  // Custom selector picker
  $('#pickSelectorBtn').on('click', startPickSelector);
  $('#customSelectorsList').on('click', '[data-action="remove-selector"]', function(e) {
    e.preventDefault();
    const field = $(this).data('field');
    delete state.customSelectors[field];
    saveCustomSelectors();
    updateCustomSelectorsList();
    showToast(`Removed custom selector for ${field}`, 'info');
  });

  // === CATALOG TAB ===
  $('#catalogSearch').on('input', debounce(filterCatalog, 300));
  $('[data-filter]').on('click', function(e) {
    e.preventDefault();
    filterCatalog($(this).data('filter'));
  });
  $('#deleteSelectedBtn').on('click', deleteSelectedProducts);
  $('#clearCatalogBtn').on('click', clearEntireCatalog);
  $('#exportCatalogXmlBtn').on('click', () => exportCatalog('xml'));
  $('#exportCatalogCsvBtn').on('click', () => exportCatalog('csv'));
  $('#checkPricesBtn').on('click', checkPrices);
  $('#syncCatalogDriveBtn').on('click', syncCatalogToDrive);

  // Bulk selection buttons
  $('#selectAllBtn').on('click', selectAllProducts);
  $('#deselectAllBtn').on('click', deselectAllProducts);
  $('#invertSelectionBtn').on('click', invertSelection);
  $('#clearSelectionBtn').on('click', deselectAllProducts);
  $('[data-select-filter]').on('click', function(e) {
    e.preventDefault();
    selectByFilter($(this).data('select-filter'));
  });

  // Preview modal
  $('#previewDeleteBtn').on('click', deletePreviewedItem);
  $('#previewModal').on('hidden.bs.modal', function() {
    state.previewContext = null;
  });

  // Scrape Selected button
  $('#scrapeSelectedBtn').on('click', scrapeSelectedProducts);

  // Event delegation for preview gallery images
  $('#previewGallery').on('click', 'img', function() {
    const src = $(this).attr('src');
    $('#previewImage img').attr('src', src);
    $('#previewGallery img').removeClass('active');
    $(this).addClass('active');
  });

  // === SUPPLIERS TAB ===
  $('#addSupplierBtn').on('click', () => $('#addSupplierForm').slideDown());
  $('#cancelSupplierBtn').on('click', () => $('#addSupplierForm').slideUp());
  $('#saveSupplierBtn').on('click', saveNewSupplier);

  // === SETTINGS TAB ===
  $('#authDriveBtn').on('click', authorizeDrive);
  $('#disconnectDriveBtn').on('click', disconnectDrive);
  $('#saveSettingsBtn').on('click', saveSettings);
  $('#exportAllDataBtn').on('click', exportAllData);
  $('#importDataBtn').on('click', () => $('#importDataFile').click());
  $('#importDataFile').on('change', importData);
  $('#clearAllDataBtn').on('click', clearAllData);
}
