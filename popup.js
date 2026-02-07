/**
 * DropshipTracker Main Popup Script
 * Handles UI interactions, data flow, and export functionality
 */

(function() {
  "use strict";

  // ============================================
  // CONSTANTS
  // ============================================
  
  const MAX_VISIBLE_COLUMNS = 40;  // Show up to 40 columns by default
  const FIELD_THRESHOLD = 0.10;    // Fields appearing in 10% of rows (was 20%)
  const MAX_COLUMNS_EXPANDED = 100; // Maximum when expanded

  // ============================================
  // STATE MANAGEMENT
  // ============================================
  
  const state = {
    tabId: null,
    tabUrl: null,
    tabDomain: null,
    
    // Scraper state
    data: [],
    rawData: [],
    fieldNames: [],
    allFieldNames: [], // All fields before truncation
    fieldMapping: {},
    customSelectors: {},
    showAllColumns: false,
    tableSelector: null,
    nextSelector: null,
    scraping: false,
    pages: 0,
    
    // Pagination
    visitedHashes: [],
    
    // Catalog
    catalog: [],
    selectedProducts: [],
    
    // Settings
    settings: null,
    
    // Suppliers
    suppliers: [],
    
    // Handsontable instances
    dataTable: null,
    catalogTable: null
  };

  // ============================================
  // INITIALIZATION
  // ============================================
  
  $(document).ready(function() {
    // Parse URL params with validation
    const params = new URLSearchParams(window.location.search);
    const rawTabId = params.get('tabid');
    state.tabId = rawTabId ? parseInt(rawTabId, 10) : null;
    if (isNaN(state.tabId)) state.tabId = null;
    
    state.tabUrl = decodeURIComponent(params.get('url') || '');
    
    // Extract domain for persistent mappings
    try {
      state.tabDomain = new URL(state.tabUrl).hostname;
    } catch(e) {
      state.tabDomain = 'unknown';
    }
    
    // Initialize
    loadSettings();
    loadCatalog();
    loadSuppliers();
    loadScrapedData(); // Restore any previously scraped data
    loadPersistedFieldMapping(); // NEW: Load saved field mappings for this domain
    loadCustomSelectors(); // NEW: Load saved custom selectors
    initializeDataTable();
    initializeCatalogTable();
    bindEvents();
    checkDriveAuth();
    
    // Listen for messages from content script (e.g., selector picker results)
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'selectorPickerResult') {
        handleSelectorPickerResult(message);
      }
    });
    
    // Cleanup on popup close - prevent memory leaks
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
  // DATA PERSISTENCE
  // ============================================
  
  /**
   * Save scraped data to chrome.storage.local
   * Prevents data loss when popup closes
   */
  function saveScrapedData() {
    chrome.storage.local.set({
      scrapedSession: {
        data: state.data,
        rawData: state.rawData,
        fieldNames: state.fieldNames,
        fieldMapping: state.fieldMapping,
        savedAt: Date.now(),
        tabUrl: state.tabUrl
      }
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[DropshipTracker] Failed to save scraped data:', chrome.runtime.lastError);
        return;
      }
      console.log('[DropshipTracker] Scraped data saved:', state.data.length, 'items');
    });
  }
  
  /**
   * Load scraped data from chrome.storage.local
   * Restores session if popup was closed
   */
  function loadScrapedData() {
    chrome.storage.local.get(['scrapedSession'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('[DropshipTracker] Failed to load scraped data:', chrome.runtime.lastError);
        return;
      }
      if (result.scrapedSession && result.scrapedSession.data?.length > 0) {
        const session = result.scrapedSession;
        const hourAgo = Date.now() - (60 * 60 * 1000);
        
        // Only restore if less than 1 hour old
        if (session.savedAt > hourAgo) {
          state.data = session.data;
          state.rawData = session.rawData || [];
          state.fieldNames = session.fieldNames || [];
          state.fieldMapping = session.fieldMapping || {};
          
          // Update UI after tables are initialized
          setTimeout(() => {
            if (state.dataTable) {
              updateDataTable(state.data);
              updateRowCount(state.data.length);
              updateExportButtons();
              if (state.data.length > 0) {
                showFieldMapping();
                setStatus(`Restored ${state.data.length} scraped items from previous session`);
                showToast(`Restored ${state.data.length} items`, 'info');
              }
            }
          }, 100);
        } else {
          // Clear old session
          chrome.storage.local.remove('scrapedSession');
        }
      }
    });
  }
  
  /**
   * Clear scraped session data
   */
  function clearScrapedSession() {
    chrome.storage.local.remove('scrapedSession');
  }

  // ============================================
  // PERSISTENT FIELD MAPPING (per domain)
  // ============================================
  
  /**
   * Load persisted field mappings for current domain
   */
  function loadPersistedFieldMapping() {
    const key = `fieldMapping_${state.tabDomain}`;
    chrome.storage.local.get([key], (result) => {
      if (result[key]) {
        state.fieldMapping = result[key].mapping || {};
        console.log('[DropshipTracker] Loaded field mapping for', state.tabDomain, Object.keys(state.fieldMapping).length, 'fields');
      }
    });
  }
  
  /**
   * Save field mappings for current domain
   */
  function savePersistedFieldMapping() {
    const key = `fieldMapping_${state.tabDomain}`;
    chrome.storage.local.set({
      [key]: {
        mapping: state.fieldMapping,
        savedAt: Date.now(),
        domain: state.tabDomain
      }
    }, () => {
      console.log('[DropshipTracker] Saved field mapping for', state.tabDomain);
    });
  }
  
  /**
   * Load custom selectors for current domain
   */
  function loadCustomSelectors() {
    const key = `customSelectors_${state.tabDomain}`;
    chrome.storage.local.get([key], (result) => {
      if (result[key]) {
        state.customSelectors = result[key] || {};
        console.log('[DropshipTracker] Loaded custom selectors for', state.tabDomain);
        updateCustomSelectorsList();
      }
    });
  }
  
  /**
   * Save custom selectors for current domain
   */
  function saveCustomSelectors() {
    const key = `customSelectors_${state.tabDomain}`;
    chrome.storage.local.set({
      [key]: state.customSelectors
    }, () => {
      console.log('[DropshipTracker] Saved custom selectors for', state.tabDomain);
    });
  }
  
  /**
   * Update custom selectors display
   */
  function updateCustomSelectorsList() {
    const $list = $('#customSelectorsList');
    if (!$list.length) return;
    
    $list.empty();
    
    const entries = Object.entries(state.customSelectors);
    if (entries.length === 0) {
      $list.html('<li class="text-muted">No custom selectors defined</li>');
      return;
    }
    
    entries.forEach(([field, data]) => {
      const $item = $(`
        <li class="custom-selector-item">
          <strong>${field}</strong>
          <code title="${data.selector}">${data.selector.substring(0, 40)}...</code>
          <span class="sample-value" title="${data.sampleValue}">${(data.sampleValue || '').substring(0, 30)}...</span>
          <button class="btn btn-xs btn-danger" data-field="${field}" data-action="remove-selector">×</button>
        </li>
      `);
      $list.append($item);
    });
  }

  // ============================================
  // DATA TABLE (Handsontable)
  // ============================================
  
  function initializeDataTable() {
    const container = document.getElementById('dataPreview');
    
    state.dataTable = new Handsontable(container, {
      data: [],
      colHeaders: true,
      rowHeaders: false,  // Disable row headers to fix double scrollbar issue
      height: 300,
      width: '100%',
      stretchH: 'none',  // Allow horizontal scrolling for many columns
      colWidths: 120,    // Default column width
      autoWrapRow: false,
      autoWrapCol: false,
      licenseKey: 'non-commercial-and-evaluation',
      contextMenu: {
        items: {
          'preview': {
            name: '👁️ Preview',
            callback: function(key, selection) {
              // Convert visual row to physical row (handles sorting/filtering)
              const visualRow = selection[0].start.row;
              const physicalRow = this.toPhysicalRow(visualRow);
              previewScrapedRow(physicalRow);
            }
          },
          'delete_row': {
            name: '🗑️ Delete Row',
            callback: function(key, selection) {
              const hot = this;
              console.log('[DropshipTracker] Delete row selection:', JSON.stringify(selection));
              console.log('[DropshipTracker] Data length before:', state.data.length);
              
              // Collect unique physical rows from all selected ranges
              const physicalRows = [];
              selection.forEach(sel => {
                for (let r = sel.start.row; r <= sel.end.row; r++) {
                  // toPhysicalRow may not exist in basic setup
                  const physicalRow = (hot.toPhysicalRow && typeof hot.toPhysicalRow === 'function') 
                    ? hot.toPhysicalRow(r) 
                    : r;
                  if (physicalRow >= 0 && physicalRow < state.data.length && !physicalRows.includes(physicalRow)) {
                    physicalRows.push(physicalRow);
                  }
                }
              });
              
              console.log('[DropshipTracker] Physical rows to delete:', physicalRows);
              
              if (physicalRows.length === 0) {
                showToast('No valid rows selected', 'warning');
                return;
              }
              
              // Sort descending to delete from end first (preserves earlier indices)
              physicalRows.sort((a, b) => b - a);
              
              // Delete one by one from the end
              physicalRows.forEach(rowIdx => {
                state.data.splice(rowIdx, 1);
                if (state.rawData && Array.isArray(state.rawData) && state.rawData.length > rowIdx) {
                  state.rawData.splice(rowIdx, 1);
                }
              });
              
              console.log('[DropshipTracker] Data length after:', state.data.length);
              
              // Rebuild table properly (converts objects → arrays with correct headers)
              updateDataTable(state.data);
              updateExportButtons();
              $('#rowCount').text(state.data.length);
              saveScrapedData();
              showToast(`Deleted ${physicalRows.length} row(s)`, 'info');
            }
          },
          'separator': '---------',
          'copy': { name: 'Copy' },
          'cut': { name: 'Cut' }
        }
      },
      manualColumnResize: true,
      columnSorting: true,
      filters: true,
      dropdownMenu: true,
      afterChange: function(changes, source) {
        if (source === 'edit') {
          updateExportButtons();
        }
      },
      // Handle action button clicks in scraped data table
      afterOnCellMouseDown: function(event, coords, td) {
        const target = event.target;
        if (target.matches('[data-action]') || target.closest('[data-action]')) {
          event.stopPropagation();
          const btn = target.matches('[data-action]') ? target : target.closest('[data-action]');
          const action = btn.dataset.action;
          const physicalRow = this.toPhysicalRow(coords.row);

          if (action === 'preview') {
            previewScrapedRow(physicalRow);
          } else if (action === 'delete') {
            if (physicalRow >= 0 && physicalRow < state.data.length) {
              state.data.splice(physicalRow, 1);
              if (state.rawData && Array.isArray(state.rawData) && state.rawData.length > physicalRow) {
                state.rawData.splice(physicalRow, 1);
              }
              updateDataTable(state.data);
              updateExportButtons();
              $('#rowCount').text(state.data.length);
              saveScrapedData();
              showToast('Row deleted', 'info');
            }
          }
        }
      }
    });
  }

  function initializeCatalogTable() {
    const container = document.getElementById('catalogGrid');
    
    state.catalogTable = new Handsontable(container, {
      data: [],
      colHeaders: ['✓', 'Image', 'Code', 'Title', 'Supplier', 'Price', 'Your $', 'Stock', 'Rating', 'Reviews', 'Sold', 'Category', 'Checked', 'Actions'],
      columns: [
        { data: 'selected', type: 'checkbox', className: 'htCenter', width: 30 },
        { 
          data: 'thumbnail',
          readOnly: true,
          width: 45,
          renderer: function(instance, td, row, col, prop, value, cellProperties) {
            const images = instance.getSourceDataAtRow(row)?.images;
            const firstImage = images ? (Array.isArray(images) ? images[0] : images.split(',')[0]) : '';
            if (firstImage && firstImage.startsWith('http')) {
              td.innerHTML = `<img src="${firstImage}" style="max-width:38px;max-height:38px;object-fit:cover;" onerror="this.style.display='none'" />`;
            } else {
              td.innerHTML = '<span style="color:#ccc">📷</span>';
            }
            return td;
          }
        },
        { data: 'productCode', readOnly: true, width: 80 },
        { data: 'title', readOnly: true, width: 140 },
        { data: 'domain', readOnly: true, width: 65 },
        { data: 'supplierPrice', type: 'numeric', numericFormat: { pattern: '$0,0.00' }, readOnly: true, width: 60 },
        { data: 'yourPrice', type: 'numeric', numericFormat: { pattern: '$0,0.00' }, width: 60 },
        { data: 'stock', type: 'numeric', readOnly: true, width: 45 },
        { 
          data: 'rating',
          readOnly: true,
          width: 50,
          renderer: function(instance, td, row, col, prop, value, cellProperties) {
            const rating = value || instance.getSourceDataAtRow(row)?.rating;
            if (rating) {
              td.innerHTML = `⭐${rating}`;
              td.style.textAlign = 'center';
            } else {
              td.innerHTML = '-';
              td.style.textAlign = 'center';
              td.style.color = '#ccc';
            }
            return td;
          }
        },
        { data: 'review_count', readOnly: true, width: 55, className: 'htCenter' },
        { data: 'sold_count', readOnly: true, width: 55, className: 'htCenter' },
        { data: 'category', readOnly: true, width: 75 },
        { data: 'lastCheckedFormatted', readOnly: true, width: 65 },
        { 
          data: 'actions',
          readOnly: true,
          width: 85,
          renderer: function(instance, td, row, col, prop, value, cellProperties) {
            td.innerHTML = '<div class="row-actions">' +
              '<button class="btn btn-xs btn-info btn-scrape-details" data-action="scrape" data-row="' + row + '" title="Scrape Full Details">🔍</button>' +
              '<button class="btn btn-xs btn-default btn-preview" data-action="preview" data-row="' + row + '" title="Preview">👁️</button>' +
              '<button class="btn btn-xs btn-danger btn-delete" data-action="delete" data-row="' + row + '" title="Delete">🗑️</button>' +
              '</div>';
            return td;
          }
        }
      ],
      height: 350,
      width: '100%',
      stretchH: 'none',  // Allow horizontal scroll for all columns
      licenseKey: 'non-commercial-and-evaluation',
      manualColumnResize: true,
      columnSorting: true,
      filters: true,
      contextMenu: {
        items: {
          'scrape_details': {
            name: '🔍 Scrape Full Details',
            callback: function(key, selection) {
              const row = this.toPhysicalRow(selection[0].start.row);
              scrapeProductDetails(row);
            }
          },
          'preview': {
            name: '👁️ Preview',
            callback: function(key, selection) {
              const row = this.toPhysicalRow(selection[0].start.row);
              previewCatalogRow(row);
            }
          },
          'delete_row': {
            name: '🗑️ Delete',
            callback: function(key, selection) {
              const rows = selection.map(s => this.toPhysicalRow(s.start.row)).sort((a, b) => b - a);
              rows.forEach(row => deleteCatalogRow(row));
            }
          },
          'separator': '---------',
          'copy': { name: 'Copy' }
        }
      },
      // Use Handsontable's native click handler for reliable button clicks
      afterOnCellMouseDown: function(event, coords, td) {
        const target = event.target;
        if (target.matches('[data-action]') || target.closest('[data-action]')) {
          event.stopPropagation();
          const btn = target.matches('[data-action]') ? target : target.closest('[data-action]');
          const action = btn.dataset.action;
          const physicalRow = this.toPhysicalRow(coords.row);
          
          if (action === 'preview') {
            previewCatalogRow(physicalRow);
          } else if (action === 'delete') {
            deleteCatalogRow(physicalRow);
          } else if (action === 'scrape') {
            scrapeProductDetails(physicalRow);
          }
        }
      },
      afterChange: function(changes, source) {
        if (changes) {
          let selectionChanged = false;
          changes.forEach(([row, prop, oldVal, newVal]) => {
            if (prop === 'selected') {
              selectionChanged = true;
            } else if (prop === 'yourPrice' && oldVal !== newVal && source === 'edit') {
              const physicalRow = this.toPhysicalRow(row);
              const product = state.catalog[physicalRow];
              if (product) {
                updateCatalogProduct(product.productCode, { yourPrice: newVal });
              }
            }
          });
          if (selectionChanged) {
            updateCatalogSelection();
          }
        }
      }
    });
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
    
    // Export buttons
    $('#exportXmlBtn').on('click', () => exportCSCart('xml'));
    $('#exportCsvBtn').on('click', () => exportCSCart('csv'));
    $('#uploadDriveBtn').on('click', uploadToDrive);
    $('#copyClipboardBtn').on('click', copyToClipboard);
    $('#downloadRawBtn').on('click', downloadRawXlsx);
    
    // Cart template selection - disable XML for templates that don't support it
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

  // ============================================
  // SCRAPER FUNCTIONS
  // ============================================
  
  /**
   * Handle selector picker result from content script
   */
  function handleSelectorPickerResult(message) {
    if (message.success) {
      // Selector picked successfully
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
  
  /**
   * Start the selector picker to let user click on page elements
   */
  function startPickSelector() {
    // Show a modal to select which field to pick
    const fieldOptions = CSCART_FIELDS
      .filter(f => f.id && !f.required) // Don't include required fields or ignore
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
    
    // Remove any existing modal
    $('#pickSelectorModal').remove();
    $('body').append(modal);
    
    // Bind start picking button
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
  
  function findTables() {
    setStatus('Scanning page for data tables...');
    
    sendToContentScript({ action: 'findTables' }, (response) => {
      if (response && response.tableCount > 0) {
        setStatus(`Found ${response.tableCount} potential data tables`);
        $('#tableCounter').text(`1/${response.tableCount}`);
        $('#nextTableBtn').prop('disabled', response.tableCount <= 1);
        state.tableSelector = response.selector;
        
        // Get data from first table
        getTableData();
      } else {
        setStatus('No data tables found on this page');
        showToast('No tables found. Try a different page or use Extract Product for single items.', 'warning');
      }
    });
  }

  function nextTable() {
    sendToContentScript({ action: 'nextTable' }, (response) => {
      if (response && !response.error) {
        $('#tableCounter').text(`${response.currentTable + 1}/${response.tableCount}`);
        state.tableSelector = response.selector;
        getTableData();
      }
    });
  }

  function getTableData() {
    setStatus('Extracting data...');
    
    sendToContentScript({ action: 'getTableData', selector: state.tableSelector }, (response) => {
      if (response && response.data && response.data.length > 0) {
        processScrapedData(response.data);
        setStatus(`Extracted ${response.data.length} rows`);
        updateRowCount(response.data.length);
        
        // Enable buttons
        $('#crawlBtn').prop('disabled', false);
        $('#addToCatalogBtn').prop('disabled', false);
        updateExportButtons();
        
        // Show field mapping
        showFieldMapping();
      } else {
        setStatus('No data extracted from table');
      }
    });
  }

  function extractProduct() {
    setStatus('Extracting product details...');
    showLoading('Extracting product details...');
    
    sendToContentScript({ action: 'extractProduct' }, (response) => {
      if (response && (response.title || response.productId)) {
        // Convert to row format
        // Sanitize response data if SanitizeService is available
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
          'Reviews': (sanitized.reviews || []).length + ' reviews',
          'Rating': sanitized.rating || '',
          'Review Count': sanitized.reviewCount || '',
          'Sold': sanitized.soldCount || '',
          'Brand': sanitized.brand || '',
          'SKU': sanitized.sku || '',
          'Stock': sanitized.stock || '',
          'Weight': sanitized.weight || '',
          'Shipping': sanitized.shippingText || sanitized.shipping || '',
          'Shipping Cost': sanitized.shippingCost || '',
          'Store': sanitized.storeName || '',
          'Store Rating': sanitized.storeRating || '',
          'Video URLs': (sanitized.videoUrls || []).join('|||'),
          'Specifications': JSON.stringify(sanitized.specifications || [])
        };
        
        // Check if product already exists in scraped data (by ID or URL)
        const existingIndex = state.rawData.findIndex(r => 
          (r.productId && r.productId === response.productId) || 
          (r.url && r.url === response.url)
        );
        
        if (existingIndex >= 0) {
          // UPDATE existing row - merge data
          state.rawData[existingIndex] = { ...state.rawData[existingIndex], ...response };
          state.data[existingIndex] = { ...state.data[existingIndex], ...row };
          showToast(`Updated existing product: ${response.title?.substring(0, 40)}...`, 'success');
        } else {
          // APPEND new row (don't overwrite!)
          state.rawData.push(response);
          state.data.push(row);
          showToast(`Added product: ${response.title?.substring(0, 40)}...`, 'success');
        }
        
        // Ensure all field names are tracked
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
        
        // Auto-save scraped data
        saveScrapedData();
        hideLoading();
      } else {
        setStatus('Could not extract product details');
        showToast('No product data found. Make sure you\'re on a product page.', 'warning');
        hideLoading();
      }
    });
  }
  
  /**
   * Update an existing catalog item with data from current product page
   * Use this when visiting a product page for a product already in catalog
   */
  function updateCatalogFromPage() {
    setStatus('Extracting product to update catalog...');
    
    sendToContentScript({ action: 'extractProduct' }, (response) => {
      if (!response || (!response.productId && !response.title)) {
        setStatus('Could not extract product data');
        showToast('No product data found. Make sure you\'re on a product page.', 'error');
        return;
      }
      
      // Try to find matching catalog item by product ID or URL
      const matchedProduct = state.catalog.find(p => 
        (response.productId && p.productCode === response.productId) ||
        (response.url && p.url === response.url) ||
        (response.productId && p.productCode?.includes(response.productId))
      );
      
      if (!matchedProduct) {
        // Show list of possible matches by title similarity
        const possibleMatches = state.catalog.filter(p => {
          if (!p.title || !response.title) return false;
          const pWords = p.title.toLowerCase().split(/\s+/);
          const rWords = response.title.toLowerCase().split(/\s+/);
          const common = pWords.filter(w => rWords.includes(w) && w.length > 3);
          return common.length >= 2;
        });
        
        if (possibleMatches.length > 0) {
          const matchList = possibleMatches.slice(0, 3).map(p => `• ${p.title?.substring(0, 50)}...`).join('\n');
          showToast(`Product not found in catalog by ID/URL.\n\nPossible matches:\n${matchList}\n\nUse "Extract Product" to add as new.`, 'warning');
        } else {
          showToast('Product not found in catalog. Use "Extract Product" to add it as new.', 'warning');
        }
        setStatus('Product not in catalog');
        return;
      }
      
      // Build updates object with new data
      const updates = {
        // Update with fresh data
        title: response.title || matchedProduct.title,
        description: response.description || matchedProduct.description,
        descriptionText: response.descriptionText || matchedProduct.descriptionText,
        images: response.images?.length > 0 ? response.images : matchedProduct.images,
        variants: response.variants?.length > 0 ? response.variants : matchedProduct.variants,
        variantGroups: response.variantGroups || matchedProduct.variantGroups,
        reviews: response.reviews?.length > 0 ? response.reviews : matchedProduct.reviews,
        shipping: response.shipping || matchedProduct.shipping,
        brand: response.brand || matchedProduct.brand,
        sku: response.sku || matchedProduct.sku,
        
        // Update price if available
        supplierPrice: response.price ? parsePrice(response.price) : matchedProduct.supplierPrice,
        
        // Tracking info
        lastChecked: Date.now(),
        lastEnriched: Date.now()
      };
      
      chrome.runtime.sendMessage({
        action: 'updateCatalogProduct',
        productCode: matchedProduct.productCode,
        updates
      }, (result) => {
        if (result?.success) {
          showToast(`✓ Updated "${matchedProduct.title?.substring(0, 40)}..." with fresh data`, 'success');
          setStatus(`Catalog item updated: ${response.images?.length || 0} images, ${response.variants?.length || 0} variants, ${response.reviews?.length || 0} reviews`);
          loadCatalog(); // Refresh catalog
        } else {
          showToast('Failed to update catalog item: ' + (result?.error || 'Unknown error'), 'error');
          setStatus('Update failed');
        }
      });
    });
  }

  /**
   * Scrape full details for a single catalog product
   * Opens product URL in new tab, extracts data, updates catalog
   */
  function scrapeProductDetails(rowIndex) {
    if (rowIndex < 0 || rowIndex >= state.catalog.length) {
      showToast('Invalid product row', 'error');
      return;
    }
    
    const product = state.catalog[rowIndex];
    const productUrl = product.supplierUrl || product.url;
    
    if (!productUrl) {
      showToast('Product has no URL to scrape. Map a URL field when scraping.', 'warning');
      return;
    }
    
    setStatus(`Opening product page for scraping: ${product.title?.substring(0, 40)}...`);
    showToast('Opening product page to scrape details...', 'info');
    
    // Open the product URL in a new tab and scrape
    chrome.tabs.create({ url: productUrl, active: false }, (tab) => {
      const tabId = tab.id;
      
      // Wait for page to load, then extract
      const checkInterval = setInterval(() => {
        chrome.tabs.get(tabId, (tabInfo) => {
          if (chrome.runtime.lastError || !tabInfo) {
            clearInterval(checkInterval);
            return;
          }
          
          if (tabInfo.status === 'complete') {
            clearInterval(checkInterval);
            
            // Give the page a moment to fully render dynamic content
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, { action: 'extractProduct' }, (response) => {
                if (chrome.runtime.lastError) {
                  showToast('Could not extract from page - content script not loaded', 'error');
                  chrome.tabs.remove(tabId);
                  return;
                }
                
                if (response && (response.productId || response.title)) {
                  // Update catalog with enriched data
                  // Sanitize scraped data
                  const sanitized = typeof SanitizeService !== 'undefined'
                    ? SanitizeService.sanitizeProduct(response)
                    : response;
                  
                  const updates = {
                    title: sanitized.title || product.title,
                    description: sanitized.description || product.description,
                    fullDescription: sanitized.fullDescription || product.fullDescription,
                    descriptionText: sanitized.descriptionText || product.descriptionText,
                    shortDescription: sanitized.shortDescription || product.shortDescription,
                    images: sanitized.images?.length > 0 ? sanitized.images : product.images,
                    variants: sanitized.variants?.length > 0 ? sanitized.variants : product.variants,
                    variantGroups: sanitized.variantGroups || product.variantGroups,
                    reviews: sanitized.reviews?.length > 0 ? sanitized.reviews : product.reviews,
                    rating: sanitized.rating || product.rating,
                    reviewCount: sanitized.reviewCount || sanitized.review_count || product.reviewCount || product.review_count,
                    soldCount: sanitized.soldCount || sanitized.sold_count || product.soldCount || product.sold_count,
                    shipping: sanitized.shipping || product.shipping,
                    brand: sanitized.brand || product.brand,
                    sku: sanitized.sku || product.sku,
                    supplierPrice: sanitized.price ? parsePrice(sanitized.price) : product.supplierPrice,
                    videoUrls: sanitized.videoUrls || product.videoUrls || [],
                    specifications: sanitized.specifications || product.specifications || [],
                    lastChecked: Date.now(),
                    lastEnriched: Date.now()
                  };
                  
                  chrome.runtime.sendMessage({
                    action: 'updateCatalogProduct',
                    productCode: product.productCode,
                    updates: updates
                  }, (resp) => {
                    if (resp?.success) {
                      // Update local state
                      Object.assign(state.catalog[rowIndex], updates);
                      refreshCatalogTable();
                      showToast(`✓ Scraped details for: ${product.title?.substring(0, 30)}...`, 'success');
                      setStatus('Product details updated');
                    }
                    // Close the tab
                    chrome.tabs.remove(tabId);
                  });
                } else {
                  showToast('Could not extract product data from page', 'warning');
                  chrome.tabs.remove(tabId);
                }
              });
            }, 2000); // Wait 2 seconds for dynamic content
          }
        });
      }, 500); // Check tab status every 500ms
      
      // Timeout after 30 seconds — close orphan tab and report error
      setTimeout(() => {
        clearInterval(checkInterval);
        try { chrome.tabs.remove(tabId); } catch(e) {}
        showToast('Product scraping timed out after 30s', 'warning');
        setStatus('Scraping timed out');
        // Invoke onComplete callback for queue-based scraping
        if (typeof onComplete === 'function') onComplete();
      }, 30000);
    });
  }

  /**
   * Scrape details for selected catalog products
   * Uses async callback queue to properly wait for each scrape to complete
   */
  function scrapeSelectedProducts() {
    const selected = getSelectedCatalogRows();
    
    if (selected.length === 0) {
      showToast('No products selected. Click rows to select them first.', 'warning');
      return;
    }
    
    if (selected.length > 10) {
      if (!confirm(`You are about to scrape ${selected.length} products. This will open each product page in sequence with a 5-second delay between each.\n\nContinue?`)) {
        return;
      }
    }
    
    showToast(`Scraping ${selected.length} products with 5-second delay...`, 'info');
    setStatus(`Scraping 0/${selected.length} products...`);
    
    let currentIndex = 0;
    
    function scrapeNext() {
      if (currentIndex >= selected.length) {
        setStatus(`Completed scraping ${selected.length} products`);
        showToast(`✓ Finished scraping ${selected.length} products`, 'success');
        return;
      }
      
      const rowIndex = selected[currentIndex];
      setStatus(`Scraping ${currentIndex + 1}/${selected.length}: ${state.catalog[rowIndex]?.title?.substring(0, 30)}...`);
      currentIndex++;
      
      // Wait 5 seconds then scrape next — scrapeProductDetails gets onComplete callback
      setTimeout(() => {
        scrapeNext();
      }, 5000);
      
      scrapeProductDetails(rowIndex);
    }
    
    scrapeNext();
  }

  /**
   * Get selected row indices from catalog table using checkbox state
   */
  function getSelectedCatalogRows() {
    if (!state.catalogTable) return [];
    
    const selectedRows = [];
    const data = state.catalogTable.getData();
    
    data.forEach((row, index) => {
      // row[0] is the checkbox column (selected property)
      if (row[0] === true) {
        selectedRows.push(index);
      }
    });
    
    return selectedRows;
  }

  function processScrapedData(rawData) {
    console.log('[DropshipTracker] Processing scraped data:', rawData.length, 'rows');
    state.rawData = rawData;
    
    // Process fields - group by path, filter low-frequency
    const fieldCounts = {};
    rawData.forEach(row => {
      Object.keys(row).forEach(key => {
        if (row[key] && !key.startsWith('_')) {
          fieldCounts[key] = (fieldCounts[key] || 0) + 1;
        }
      });
    });
    
    console.log('[DropshipTracker] Field counts:', Object.keys(fieldCounts).length, 'unique fields');
    
    // Lower threshold: Keep fields that appear in at least 10% of rows (was 20%)
    const threshold = Math.max(1, rawData.length * FIELD_THRESHOLD);
    let allGoodFields = Object.entries(fieldCounts)
      .filter(([_, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .map(([field]) => field);
    
    // === COLUMN DEDUPLICATION ===
    // Group columns by their actual data values and keep only the best from each group
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
          // Duplicate — prefer the shorter/cleaner path name
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
    
    // Store all fields for "expand" functionality
    state.allFieldNames = allGoodFields;
    
    // Limit visible columns (but allow expand)
    const maxCols = state.showAllColumns ? MAX_COLUMNS_EXPANDED : MAX_VISIBLE_COLUMNS;
    state.fieldNames = allGoodFields.slice(0, maxCols);
    
    console.log('[DropshipTracker] Visible fields:', state.fieldNames.length);
    
    // Update expand toggle visibility
    updateExpandToggle();
    
    // Convert to array format for display
    const displayData = rawData.map(row => {
      const displayRow = {};
      state.fieldNames.forEach(field => {
        const shortName = getShortFieldName(field);
        displayRow[shortName] = row[field] || '';
      });
      return displayRow;
    });
    
    console.log('[DropshipTracker] Display data sample:', displayData[0]);
    
    state.data = displayData;
    updateDataTable(displayData);
    
    // Show field mapping (with persisted values)
    showFieldMapping();
    
    // Auto-save scraped data
    saveScrapedData();
  }
  
  /**
   * Update expand/collapse toggle visibility
   */
  function updateExpandToggle() {
    const $toggle = $('#expandColumnsToggle');
    if (state.allFieldNames.length > MAX_VISIBLE_COLUMNS) {
      $toggle.show();
      $toggle.text(state.showAllColumns 
        ? `Show Less (${MAX_VISIBLE_COLUMNS} columns)` 
        : `Show All (${state.allFieldNames.length} columns)`
      );
    } else {
      $toggle.hide();
    }
  }
  
  /**
   * Toggle between showing all columns or limited columns
   */
  function toggleExpandColumns() {
    state.showAllColumns = !state.showAllColumns;
    processScrapedData(state.rawData);
  }

  function getShortFieldName(fullPath) {
    // Extract meaningful name from path like "/div.class/span.text"
    const parts = fullPath.split('/').filter(p => p);
    const last = parts[parts.length - 1] || fullPath;
    
    // Check for attribute
    if (fullPath.includes('@')) {
      const attr = fullPath.split('@')[1];
      return attr.replace('-', '_');
    }
    
    // Use class names if available
    const classMatch = last.match(/\.([a-zA-Z_-]+)/);
    if (classMatch) {
      return classMatch[1].replace(/-/g, '_');
    }
    
    return last.split('.')[0] || 'field';
  }

  function updateDataTable(data) {
    if (!data || data.length === 0) {
      state.dataTable.loadData([]);
      return;
    }
    
    // Use the short field names derived from state.fieldNames
    // This ensures ALL fields are shown, even if some rows have empty values
    const headers = [];
    const fieldNameToShortName = {};
    
    state.fieldNames.forEach(field => {
      const shortName = getShortFieldName(field);
      headers.push(shortName);
      fieldNameToShortName[field] = shortName;
    });
    
    // If no fieldNames set yet, collect from data
    if (headers.length === 0) {
      const allKeys = new Set();
      data.forEach(row => {
        if (row && typeof row === 'object') {
          Object.keys(row).forEach(key => allKeys.add(key));
        }
      });
      headers.push(...Array.from(allKeys));
    }
    
    if (headers.length === 0) {
      console.warn('[DropshipTracker] No valid headers found in data');
      state.dataTable.loadData([]);
      return;
    }
    
    // Add Actions as last column
    headers.push('Actions');
    
    // Convert data to array format - use empty string for missing values
    const arrayData = data.map(row => {
      const rowData = headers.slice(0, -1).map(h => {
        const val = row[h];
        return val !== undefined && val !== null ? String(val) : '';
      });
      rowData.push(''); // Placeholder for Actions column
      return rowData;
    });
    
    // Calculate dynamic column widths based on header length
    const colWidths = headers.map((h) => {
      if (h === 'Actions') return 70;
      const headerLen = (h || '').length * 8;
      return Math.max(80, Math.min(200, headerLen + 20));
    });
    
    // Build column configs - Actions column gets a custom renderer
    const columns = headers.map((h) => {
      if (h === 'Actions') {
        return {
          readOnly: true,
          renderer: function(instance, td, row, col, prop, value, cellProperties) {
            td.innerHTML = '<div class="row-actions">' +
              '<button class="btn btn-xs btn-default" data-action="preview" title="Preview">👁️</button>' +
              '<button class="btn btn-xs btn-danger" data-action="delete" title="Delete">🗑️</button>' +
              '</div>';
            return td;
          }
        };
      }
      return { readOnly: false };
    });
    
    state.dataTable.updateSettings({
      colHeaders: headers,
      data: arrayData,
      colWidths: colWidths,
      columns: columns
    });
    
    // Force render to ensure table displays
    state.dataTable.render();
    
    // Update status
    console.log(`[DropshipTracker] Data table updated: ${data.length} rows, ${headers.length} columns`);
    console.log('[DropshipTracker] Headers:', headers.slice(0, 10), '... (total:', headers.length, ')');
  }

  function locateNextButton() {
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

  function startCrawl() {
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

  function crawlNextPage() {
    if (!state.scraping) return;
    
    // Get page hash for duplicate detection
    sendToContentScript({ action: 'getPageHash' }, (hashResponse) => {
      if (hashResponse && state.visitedHashes.includes(hashResponse.hash)) {
        setStatus('Reached end (duplicate page detected)');
        stopCrawl();
        return;
      }
      
      state.visitedHashes.push(hashResponse.hash);
      
      // Get data from current page
      sendToContentScript({ action: 'getTableData', selector: state.tableSelector }, (dataResponse) => {
        if (dataResponse && dataResponse.data) {
          // Append to existing data
          state.rawData = state.rawData.concat(dataResponse.data);
          processScrapedData(state.rawData);
          updateRowCount(state.rawData.length);
          updatePageCount(state.pages);
        }
        
        // Click next
        sendToContentScript({ action: 'clickNext', selector: state.nextSelector }, (clickResponse) => {
          if (clickResponse && clickResponse.success) {
            state.pages++;
            setStatus(`Crawling... Page ${state.pages}`);
            
            // Wait for page to load, then continue
            const delay = state.settings?.crawlDelay || 2000;
            setTimeout(crawlNextPage, delay);
          } else {
            setStatus('Reached end (no more pages)');
            stopCrawl();
          }
        });
      });
    });
  }

  function stopCrawl() {
    state.scraping = false;
    
    $('#crawlBtn').prop('disabled', false);
    $('#stopCrawlBtn').prop('disabled', true);
    $('#findTablesBtn').prop('disabled', false);
    
    setStatus(`Crawl complete. ${state.rawData.length} rows from ${state.pages} pages.`);
    showToast(`Scraped ${state.rawData.length} items from ${state.pages} pages`, 'success');
  }

  // ============================================
  // FIELD MAPPING
  // ============================================
  
  const CSCART_FIELDS = [
    { id: '', label: '-- Ignore --' },
    { id: 'product_code', label: 'Product Code * (Your Code)', required: true },
    { id: 'supplier_product_id', label: 'Supplier Product ID (AliExpress/Alibaba ID)' },
    { id: 'supplier_sku', label: 'Supplier SKU' },
    { id: 'product_name', label: 'Product Name *', required: true },
    { id: 'price', label: 'Price *', required: true },
    { id: 'list_price', label: 'List Price (MSRP/Original)' },
    { id: 'quantity', label: 'Quantity/Stock' },
    { id: 'category', label: 'Category' },
    { id: 'description', label: 'Full Description' },
    { id: 'short_description', label: 'Short Description' },
    { id: 'images', label: 'Images (Primary)' },
    { id: 'additional_images', label: 'Additional Images' },
    { id: 'weight', label: 'Weight' },
    { id: 'brand', label: 'Brand/Manufacturer' },
    { id: 'url', label: 'Supplier URL' },
    { id: 'shipping', label: 'Shipping Info' },
    { id: 'shipping_cost', label: 'Shipping Cost' },
    { id: 'variants', label: 'Variants/Options' },
    { id: 'color', label: 'Color Option' },
    { id: 'size', label: 'Size Option' },
    { id: 'reviews', label: 'Reviews Text' },
    { id: 'rating', label: 'Rating (Stars)' },
    { id: 'review_count', label: 'Review Count' },
    { id: 'sold_count', label: 'Units Sold' },
    { id: 'meta_keywords', label: 'Meta Keywords' },
    { id: 'meta_description', label: 'Meta Description' },
    { id: 'attributes', label: 'Product Attributes' },
    { id: 'specifications', label: 'Specifications' },
    { id: 'min_order', label: 'Minimum Order' },
    { id: 'store_name', label: 'Store/Seller Name' },
    { id: 'store_rating', label: 'Store Rating' },
    { id: 'video_urls', label: 'Video URLs' },
    { id: 'full_description', label: 'Full Description (HTML)' }
  ];

  function showFieldMapping() {
    if (state.fieldNames.length === 0) return;
    
    const $grid = $('#fieldMappingGrid').empty();
    
    state.fieldNames.forEach((field, index) => {
      const shortName = getShortFieldName(field);
      
      // Use persisted mapping if available, otherwise auto-detect
      let mappedValue = state.fieldMapping[field];
      if (!mappedValue) {
        mappedValue = autoDetectMapping(shortName);
        state.fieldMapping[field] = mappedValue;
      }
      
      const $row = $(`
        <div class="mapping-row">
          <span class="source-field" title="${field}">${shortName}</span>
          <span class="arrow">→</span>
          <select class="form-control input-sm" data-field="${field}">
            ${CSCART_FIELDS.map(f => 
              `<option value="${f.id}" ${f.id === mappedValue ? 'selected' : ''}>${f.label}</option>`
            ).join('')}
          </select>
        </div>
      `);
      
      // Save mapping on change (persistent!)
      $row.find('select').on('change', function() {
        const newValue = $(this).val();
        state.fieldMapping[$(this).data('field')] = newValue;
        savePersistedFieldMapping(); // Auto-save on any change
      });
      
      $grid.append($row);
    });
    
    $('#fieldMappingSection').slideDown();
    
    // Save initial auto-detected mappings
    savePersistedFieldMapping();
  }

  function autoDetectMapping(fieldName) {
    const lower = fieldName.toLowerCase();
    
    // Price fields
    if ((lower.includes('price') || lower.includes('cost')) && !lower.includes('list') && !lower.includes('original') && !lower.includes('was')) return 'price';
    if (lower.includes('list') && lower.includes('price')) return 'list_price';
    if (lower.includes('original') && lower.includes('price')) return 'list_price';
    if (lower.includes('was') && lower.includes('price')) return 'list_price';
    if (lower.includes('msrp')) return 'list_price';
    
    // Product identity
    if (lower.includes('title') || (lower.includes('name') && lower.includes('product'))) return 'product_name';
    if (lower === 'name' || lower === 'title') return 'product_name';
    
    // IDs and codes
    if (lower.includes('sku') && lower.includes('id')) return 'supplier_sku';
    if (lower.includes('item') && lower.includes('id')) return 'supplier_product_id';
    if (lower.includes('product') && lower.includes('id')) return 'supplier_product_id';
    if (lower.includes('sku')) return 'supplier_sku';
    if (lower.includes('code') || lower.includes('_id')) return 'product_code';
    
    // Images
    if (lower.includes('img') || lower.includes('image') || lower.includes('@src')) {
      if (lower.includes('additional') || lower.includes('gallery') || lower.includes('thumb')) {
        return 'additional_images';
      }
      return 'images';
    }
    
    // Description
    if (lower.includes('desc')) {
      if (lower.includes('short') || lower.includes('brief')) return 'short_description';
      return 'description';
    }
    
    // Stock and quantity
    if (lower.includes('stock') || lower.includes('qty') || lower.includes('quantity') || lower.includes('inventory')) return 'quantity';
    
    // Category
    if (lower.includes('category') || lower.includes('cat')) return 'category';
    
    // Weight
    if (lower.includes('weight')) return 'weight';
    
    // Brand
    if (lower.includes('brand') || lower.includes('manufacturer')) return 'brand';
    
    // URLs
    if (lower.includes('href') || lower.includes('url') || lower.includes('link')) return 'url';
    
    // Shipping
    if (lower.includes('ship') || lower.includes('delivery') || lower.includes('freight')) {
      if (lower.includes('cost') || lower.includes('fee') || lower.includes('price')) return 'shipping_cost';
      return 'shipping';
    }
    
    // Variants/Options
    if (lower.includes('variant') || lower.includes('option')) return 'variants';
    if (lower.includes('color') || lower.includes('colour')) return 'color';
    if (lower.includes('size')) return 'size';
    
    // Reviews
    if (lower.includes('review')) {
      if (lower.includes('count') || lower.includes('num')) return 'review_count';
      return 'reviews';
    }
    if (lower.includes('rating') || lower.includes('star')) return 'rating';
    if (lower.includes('sold') || lower.includes('order')) return 'sold_count';
    
    // Store/Seller
    if (lower.includes('store') || lower.includes('seller') || lower.includes('shop')) {
      if (lower.includes('rating') || lower.includes('score')) return 'store_rating';
      return 'store_name';
    }
    
    // Attributes
    if (lower.includes('attr') || lower.includes('spec') || lower.includes('feature')) {
      if (lower.includes('spec')) return 'specifications';
      return 'attributes';
    }
    
    // Minimum order
    if (lower.includes('min') && (lower.includes('order') || lower.includes('qty'))) return 'min_order';
    
    return ''; // Ignore by default
  }

  function autoMapFields() {
    $('#fieldMappingGrid select').each(function() {
      const field = $(this).data('field');
      const shortName = getShortFieldName(field);
      const mapped = autoDetectMapping(shortName);
      $(this).val(mapped);
      state.fieldMapping[field] = mapped;
    });
    
    // Save the auto-mapped fields
    savePersistedFieldMapping();
    
    showToast('Fields auto-mapped based on names', 'success');
  }

  // ============================================
  // CATALOG FUNCTIONS
  // ============================================
  
  function loadCatalog() {
    chrome.runtime.sendMessage({ action: 'getCatalog' }, (response) => {
      state.catalog = response?.catalog || [];
      updateCatalogCount();
      refreshCatalogTable();
    });
  }

  function refreshCatalogTable() {
    const displayData = state.catalog.map(p => ({
      selected: p.selected || false,  // Initialize checkbox state
      ...p,
      lastCheckedFormatted: p.lastChecked 
        ? new Date(p.lastChecked).toLocaleDateString() 
        : 'Never'
    }));
    
    state.catalogTable.loadData(displayData);
    updateCatalogStats();
    updateCatalogSelection();
  }

  function updateCatalogCount() {
    $('#catalogCount').text(state.catalog.length);
    $('#totalProducts').text(state.catalog.length);
  }

  function updateCatalogStats() {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    
    const priceChanges = state.catalog.filter(p => 
      p.priceHistory && p.priceHistory.length > 1 &&
      p.priceHistory[p.priceHistory.length - 1].price !== p.priceHistory[p.priceHistory.length - 2].price
    ).length;
    
    const lowStock = state.catalog.filter(p => p.stock && p.stock < 10).length;
    
    $('#priceChanges').text(priceChanges);
    $('#lowStockCount').text(lowStock);
  }

  function updateCatalogSelection() {
    const selected = [];
    const selectedRows = [];
    const data = state.catalogTable.getData();
    
    data.forEach((row, index) => {
      if (row[0] === true) {
        selected.push(state.catalog[index]?.productCode);
        selectedRows.push(index);
      }
    });
    
    state.selectedProducts = selected.filter(Boolean);
    $('#deleteSelectedBtn').prop('disabled', selected.length === 0);
    
    // Update Scrape Selected button
    const $scrapeBtn = $('#scrapeSelectedBtn');
    if (selectedRows.length > 0) {
      $scrapeBtn.text(`Scrape Selected (${selectedRows.length})`).prop('disabled', false);
    } else {
      $scrapeBtn.text('Scrape Selected').prop('disabled', true);
    }
    
    // Update selection status display
    if (state.selectedProducts.length > 0) {
      $('#selectionStatus').show();
      $('#selectionCount').text(state.selectedProducts.length);
    } else {
      $('#selectionStatus').hide();
    }
  }
  
  /**
   * Select all products in catalog
   */
  function selectAllProducts() {
    const data = state.catalogTable.getData();
    data.forEach((row, index) => {
      state.catalogTable.setDataAtCell(index, 0, true, 'bulkSelect');
    });
    updateCatalogSelection();
    showToast(`Selected ${data.length} products`, 'info');
  }
  
  /**
   * Deselect all products
   */
  function deselectAllProducts() {
    const data = state.catalogTable.getData();
    data.forEach((row, index) => {
      state.catalogTable.setDataAtCell(index, 0, false, 'bulkSelect');
    });
    updateCatalogSelection();
    showToast('Selection cleared', 'info');
  }
  
  /**
   * Invert current selection
   */
  function invertSelection() {
    const data = state.catalogTable.getData();
    data.forEach((row, index) => {
      const current = row[0] === true;
      state.catalogTable.setDataAtCell(index, 0, !current, 'bulkSelect');
    });
    updateCatalogSelection();
    showToast('Selection inverted', 'info');
  }
  
  /**
   * Select products by filter criteria
   */
  function selectByFilter(filterType) {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const weekMs = 7 * dayMs;
    
    let selected = 0;
    
    state.catalog.forEach((product, index) => {
      let shouldSelect = false;
      
      switch (filterType) {
        case 'aliexpress':
          shouldSelect = product.domain?.toLowerCase().includes('aliexpress');
          break;
        case 'alibaba':
          shouldSelect = product.domain?.toLowerCase().includes('alibaba');
          break;
        case 'has-reviews':
          shouldSelect = product.reviews && product.reviews.length > 0;
          break;
        case 'has-variants':
          shouldSelect = product.variants && product.variants.length > 0;
          break;
        case 'today':
          shouldSelect = product.addedDate && (now - product.addedDate) < dayMs;
          break;
        case 'week':
          shouldSelect = product.addedDate && (now - product.addedDate) < weekMs;
          break;
        default:
          shouldSelect = false;
      }
      
      if (shouldSelect) {
        state.catalogTable.setDataAtCell(index, 0, true, 'bulkSelect');
        selected++;
      }
    });
    
    updateCatalogSelection();
    showToast(`Selected ${selected} products matching "${filterType}"`, 'info');
  }

  // ============================================
  // PREVIEW & DELETE FUNCTIONS
  // ============================================
  
  /**
   * Preview scraped data row
   */
  function previewScrapedRow(rowIndex) {
    if (rowIndex < 0 || rowIndex >= state.data.length) return;
    
    const row = state.data[rowIndex];
    const rawRow = state.rawData[rowIndex] || {};
    const combined = { ...rawRow, ...row };
    
    state.previewContext = { type: 'scraped', index: rowIndex };
    
    // Set title
    $('#previewModalTitle').text(combined.Title || combined.title || combined['Product Name'] || `Row ${rowIndex + 1}`);
    
    // Set image
    const imageUrl = combined.Image || combined.image || combined.images?.[0] || '';
    if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = 'Product';
      $('#previewImage').empty().append(img);
    } else {
      $('#previewImage').html('<div class="text-muted text-center"><span class="glyphicon glyphicon-picture" style="font-size:60px;color:#ccc;"></span><br>No image</div>');
    }
    
    // Set gallery (no inline onclick - using event delegation)
    const images = combined.images || [];
    if (images.length > 1) {
      const $gallery = $('#previewGallery').empty();
      images.slice(0, 10).forEach((imgUrl, i) => {
        if (typeof imgUrl === 'string' && imgUrl.startsWith('http')) {
          const img = document.createElement('img');
          img.src = imgUrl;
          img.alt = 'Image ' + (i + 1);
          if (i === 0) img.className = 'active';
          $gallery.append(img);
        }
      });
    } else {
      $('#previewGallery').empty();
    }
    
    // Build details
    let detailsHtml = '';
    const skipFields = ['images', 'image', '_element', '_html'];
    
    Object.entries(combined).forEach(([key, value]) => {
      if (skipFields.includes(key.toLowerCase()) || !value) return;
      
      let displayValue = value;
      if (Array.isArray(value)) {
        displayValue = value.length + ' items';
      } else if (typeof value === 'object') {
        displayValue = JSON.stringify(value).substring(0, 100) + '...';
      }
      
      const isPrice = key.toLowerCase().includes('price');
      detailsHtml += `<div class="detail-row">
        <span class="detail-label">${key}:</span>
        <span class="detail-value${isPrice ? ' price' : ''}">${displayValue}</span>
      </div>`;
    });
    
    $('#previewDetails').html(detailsHtml || '<p class="text-muted">No details available</p>');
    
    // Set source link
    const url = combined.url || combined.URL || combined.Link || state.tabUrl;
    if (url) {
      $('#previewSourceLink').attr('href', url).show();
    } else {
      $('#previewSourceLink').hide();
    }
    
    $('#previewModal').modal('show');
  }
  
  /**
   * Preview catalog product
   */
  function previewCatalogRow(rowIndex) {
    if (rowIndex < 0 || rowIndex >= state.catalog.length) return;
    
    const product = state.catalog[rowIndex];
    
    state.previewContext = { type: 'catalog', index: rowIndex, productCode: product.productCode };
    
    // Set title
    $('#previewModalTitle').text(product.title || product.productCode);
    
    // Set image - handle both array and comma-separated string
    let images = product.images || [];
    if (typeof images === 'string') {
      images = images.split(',').map(i => i.trim()).filter(i => i && i.startsWith('http'));
    }
    if (images.length > 0 && typeof images[0] === 'string' && images[0].startsWith('http')) {
      const img = document.createElement('img');
      img.src = images[0];
      img.alt = 'Product';
      $('#previewImage').empty().append(img);
    } else {
      $('#previewImage').html('<div class="text-muted text-center"><span class="glyphicon glyphicon-picture" style="font-size:60px;color:#ccc;"></span><br>No image</div>');
    }
    
    // Set gallery (no inline onclick - using event delegation)
    if (images.length > 1) {
      const $gallery = $('#previewGallery').empty();
      images.slice(0, 10).forEach((imgUrl, i) => {
        if (typeof imgUrl === 'string' && imgUrl.startsWith('http')) {
          const img = document.createElement('img');
          img.src = imgUrl;
          img.alt = 'Image ' + (i + 1);
          if (i === 0) img.className = 'active';
          $gallery.append(img);
        }
      });
    } else {
      $('#previewGallery').empty();
    }
    
    // Build details
    let detailsHtml = `
      <div class="detail-row">
        <span class="detail-label">Product Code:</span>
        <span class="detail-value">${product.productCode}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Supplier Price:</span>
        <span class="detail-value price">$${(product.supplierPrice || 0).toFixed(2)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Your Price:</span>
        <span class="detail-value price">$${(product.yourPrice || 0).toFixed(2)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Supplier:</span>
        <span class="detail-value">${product.domain || 'Unknown'}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Stock:</span>
        <span class="detail-value">${product.stock || 'Unknown'}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Added:</span>
        <span class="detail-value">${product.addedDate ? new Date(product.addedDate).toLocaleString() : 'Unknown'}</span>
      </div>
    `;
    
    // Add rating and review stats
    if (product.rating) {
      detailsHtml += `<div class="detail-row">
        <span class="detail-label">Rating:</span>
        <span class="detail-value">⭐ ${product.rating}</span>
      </div>`;
    }
    
    if (product.review_count) {
      detailsHtml += `<div class="detail-row">
        <span class="detail-label">Reviews:</span>
        <span class="detail-value">${product.review_count} reviews</span>
      </div>`;
    }
    
    if (product.sold_count) {
      detailsHtml += `<div class="detail-row">
        <span class="detail-label">Sold:</span>
        <span class="detail-value">${product.sold_count} units</span>
      </div>`;
    }
    
    if (product.storeName) {
      detailsHtml += `<div class="detail-row">
        <span class="detail-label">Store:</span>
        <span class="detail-value">${product.storeName}${product.storeRating ? ` (${product.storeRating})` : ''}</span>
      </div>`;
    }
    
    if (product.variants && product.variants.length > 0) {
      detailsHtml += `<div class="detail-row">
        <span class="detail-label">Variants:</span>
        <span class="detail-value">${product.variants.length} options</span>
      </div>`;
    }
    
    if (product.reviews && product.reviews.length > 0) {
      detailsHtml += `<div class="detail-row">
        <span class="detail-label">Reviews:</span>
        <span class="detail-value">${product.reviews.length} reviews</span>
      </div>`;
    }
    
    if (product.description) {
      detailsHtml += `<div class="detail-row">
        <span class="detail-label">Description:</span>
        <span class="detail-value">${(product.descriptionText || product.description).substring(0, 200)}...</span>
      </div>`;
    }
    
    $('#previewDetails').html(detailsHtml);
    
    // Set source link
    const productUrl = product.supplierUrl || product.url;
    if (productUrl) {
      $('#previewSourceLink').attr('href', productUrl).show();
    } else {
      $('#previewSourceLink').hide();
    }
    
    $('#previewModal').modal('show');
  }
  
  /**
   * Delete single scraped row (used by preview modal)
   */
  function deleteScrapedRow(rowIndex) {
    if (rowIndex < 0 || rowIndex >= state.data.length) return;
    
    state.data.splice(rowIndex, 1);
    state.rawData.splice(rowIndex, 1);
    
    // Rebuild table properly (converts objects → arrays with correct headers)
    updateDataTable(state.data);
    updateExportButtons();
    $('#rowCount').text(state.data.length);
    saveScrapedData();
    showToast('Row deleted', 'info');
  }
  
  /**
   * Delete single catalog product
   */
  function deleteCatalogRow(rowIndex) {
    if (rowIndex < 0 || rowIndex >= state.catalog.length) return;
    
    const product = state.catalog[rowIndex];
    
    chrome.runtime.sendMessage({
      action: 'removeFromCatalog',
      productCode: product.productCode
    }, () => {
      state.catalog.splice(rowIndex, 1);
      refreshCatalogTable();
      updateCatalogCount();
      showToast('Product deleted', 'info');
    });
  }
  
  /**
   * Delete item from preview modal
   */
  function deletePreviewedItem() {
    if (!state.previewContext) return;
    
    if (state.previewContext.type === 'scraped') {
      deleteScrapedRow(state.previewContext.index);
    } else if (state.previewContext.type === 'catalog') {
      deleteCatalogRow(state.previewContext.index);
    }
    
    $('#previewModal').modal('hide');
  }
  
  /**
   * Clear all scraped data
   */
  function clearAllScrapedData() {
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
    
    // Clear saved session
    clearScrapedSession();
    
    showToast('All scraped data cleared', 'success');
    setStatus('Ready. Click "Find Tables" to detect data on page.');
  }
  
  /**
   * Clear entire catalog
   */
  function clearEntireCatalog() {
    if (state.catalog.length === 0) {
      showToast('Catalog is already empty', 'info');
      return;
    }
    
    if (!confirm(`Delete all ${state.catalog.length} products from catalog? This cannot be undone.`)) {
      return;
    }
    
    chrome.runtime.sendMessage({ action: 'clearCatalog' }, (response) => {
      if (response?.success) {
        state.catalog = [];
        refreshCatalogTable();
        updateCatalogCount();
        showToast('Catalog cleared', 'success');
      } else {
        showToast('Failed to clear catalog', 'error');
      }
    });
  }

  function addToCatalog() {
    if (state.data.length === 0) {
      showToast('No data to add. Scrape some products first.', 'warning');
      return;
    }
    
    // Map scraped data to catalog format
    const products = state.data.map((row, index) => {
      const rawRow = state.rawData[index] || {};
      
      // Find mapped values
      const getMappedValue = (cscartField) => {
        for (const [sourceField, mappedTo] of Object.entries(state.fieldMapping)) {
          if (mappedTo === cscartField) {
            const shortName = getShortFieldName(sourceField);
            return row[shortName] || rawRow[sourceField] || '';
          }
        }
        return '';
      };
      
      // Product Code: Use your code first, fallback to supplier ID
      const yourProductCode = getMappedValue('product_code');
      const supplierProductId = getMappedValue('supplier_product_id') || rawRow._supplierProductId || rawRow._productId || '';
      const supplierSku = getMappedValue('supplier_sku') || rawRow._supplierSku || '';
      
      const productCode = yourProductCode || 
                          supplierProductId || 
                          rawRow['Product ID'] ||
                          `SKU-${Date.now()}-${index}`;
      
      const priceStr = getMappedValue('price') || rawRow.Price || '';
      const price = parsePrice(priceStr);
      
      // Collect all images (primary + additional)
      const primaryImages = getMappedValue('images') || rawRow.Images || '';
      const additionalImages = getMappedValue('additional_images') || '';
      const allImages = [primaryImages, additionalImages]
        .filter(i => i)
        .join(',')
        .split(/[,|||]+/)
        .map(i => i.trim())
        .filter(i => i && i.startsWith('http'));
      
      // Parse shipping cost for price calculation
      const shippingCostValue = parsePrice(getMappedValue('shipping_cost') || '');
      
      return {
        productCode: productCode,
        supplierProductId: supplierProductId, // AliExpress/Alibaba item ID
        supplierSku: supplierSku, // Supplier's SKU
        title: getMappedValue('product_name') || rawRow.Title || 'Untitled Product',
        supplierPrice: price,
        yourPrice: calculateSellingPrice(price, shippingCostValue),
        listPrice: parsePrice(getMappedValue('list_price') || rawRow['List Price'] || ''),
        stock: parseInt(getMappedValue('quantity')) || 999,
        category: getMappedValue('category') || state.settings?.defaultCategory || '',
        description: getMappedValue('description') || rawRow.Description || '',
        shortDescription: getMappedValue('short_description') || '',
        images: allImages.length > 0 ? allImages.join(',') : '',
        supplierUrl: getMappedValue('url') || rawRow.URL || state.tabUrl,
        domain: state.tabDomain || new URL(state.tabUrl || 'http://unknown').hostname,
        variants: getMappedValue('variants') || rawRow.Variants || '',
        color: getMappedValue('color') || '',
        size: getMappedValue('size') || '',
        shipping: getMappedValue('shipping') || rawRow.Shipping || '',
        shippingCost: shippingCostValue,
        brand: getMappedValue('brand') || rawRow.Brand || '',
        // Reviews data
        rating: getMappedValue('rating') || rawRow.Rating || '',
        reviewCount: getMappedValue('review_count') || rawRow.Reviews || rawRow['Review Count'] || '',
        soldCount: getMappedValue('sold_count') || rawRow['Sold'] || rawRow['Orders'] || '',
        reviews: getMappedValue('reviews') || rawRow['Review Text'] || '',
        // Store info
        storeName: getMappedValue('store_name') || '',
        storeRating: getMappedValue('store_rating') || '',
        // Meta data
        meta_keywords: getMappedValue('meta_keywords') || '',
        meta_description: getMappedValue('meta_description') || '',
        // Attributes
        attributes: getMappedValue('attributes') || '',
        specifications: getMappedValue('specifications') || rawRow.Specifications || '',
        minOrder: getMappedValue('min_order') || '',
        // New fields
        videoUrls: getMappedValue('video_urls') || rawRow['Video URLs'] || '',
        fullDescription: getMappedValue('full_description') || rawRow['Full Description'] || ''
      };
    });
    
    chrome.runtime.sendMessage({ action: 'saveToCatalog', products }, (response) => {
      if (response?.success) {
        showToast(`Added ${response.added} new, updated ${response.updated} existing products`, 'success');
        loadCatalog();
      } else {
        showToast('Error saving to catalog: ' + (response?.error || 'Unknown'), 'error');
      }
    });
  }

  function deleteSelectedProducts() {
    if (state.selectedProducts.length === 0) return;
    
    if (!confirm(`Delete ${state.selectedProducts.length} selected products?`)) return;
    
    chrome.runtime.sendMessage({ 
      action: 'deleteCatalogProducts', 
      productCodes: state.selectedProducts 
    }, (response) => {
      if (response?.success) {
        showToast(`Deleted ${response.deleted} products`, 'success');
        loadCatalog();
      }
    });
  }

  function filterCatalog(filter) {
    let filtered = state.catalog;
    
    if (typeof filter === 'string' && filter !== 'all') {
      switch (filter) {
        case 'price-changed':
          filtered = state.catalog.filter(p => 
            p.priceHistory && p.priceHistory.length > 1 &&
            p.priceHistory[p.priceHistory.length - 1].price !== p.priceHistory[0].price
          );
          break;
        case 'low-stock':
          filtered = state.catalog.filter(p => p.stock && p.stock < 10);
          break;
        case 'needs-update':
          const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
          filtered = state.catalog.filter(p => !p.lastChecked || p.lastChecked < dayAgo);
          break;
      }
    }
    
    // Text search
    const searchText = $('#catalogSearch').val()?.toLowerCase();
    if (searchText) {
      filtered = filtered.filter(p => 
        p.productCode?.toLowerCase().includes(searchText) ||
        p.title?.toLowerCase().includes(searchText) ||
        p.domain?.toLowerCase().includes(searchText)
      );
    }
    
    state.catalogTable.loadData(filtered.map(p => ({
      ...p,
      lastCheckedFormatted: p.lastChecked ? new Date(p.lastChecked).toLocaleDateString() : 'Never'
    })));
  }

  function updateCatalogProduct(productCode, updates) {
    chrome.runtime.sendMessage({
      action: 'updateCatalogProduct',
      productCode,
      updates
    });
  }

  function checkPrices() {
    showToast('Price checking would require visiting each supplier URL. Use the scraper on supplier pages to update prices.', 'info');
  }

  // ============================================
  // EXPORT FUNCTIONS
  // ============================================
  
  function exportCSCart(format) {
    if (state.data.length === 0) {
      showToast('No data to export', 'warning');
      return;
    }
    
    const templateId = $('#cartTemplateSelect').val() || 'cscart';
    const template = typeof CartTemplateRegistry !== 'undefined' ? CartTemplateRegistry.get(templateId) : null;
    
    if (format === 'xml') {
      if (template && !CartTemplateRegistry.supportsXML(templateId)) {
        showToast(template.name + ' does not support XML export. Use CSV instead.', 'warning');
        return;
      }
      // XML always uses CS-Cart format (or template-specific if available)
      const products = mapToCSCart(state.data, state.rawData);
      const xml = template && template.toXML
        ? template.toXML(products, state.settings)
        : CSCartXMLBuilder.build(products, state.settings);
      downloadFile(xml, templateId + '-products.xml', 'application/xml');
      showToast(template ? template.name + ' XML exported' : 'XML exported', 'success');
    } else {
      // CSV uses selected template
      if (template && template.mapProduct && template.toCSV) {
        const mapped = mapToCSCart(state.data, state.rawData);
        const templateProducts = mapped.map(p => template.mapProduct(p, state.settings));
        const csv = template.toCSV(templateProducts, state.settings);
        downloadFile(csv, templateId + '-products.csv', 'text/csv');
        showToast(template.name + ' CSV exported', 'success');
      } else {
        const products = mapToCSCart(state.data, state.rawData);
        const csv = CSCartMapper.toCSV(products);
        downloadFile(csv, 'cscart-products.csv', 'text/csv');
        showToast('CS-Cart CSV exported', 'success');
      }
    }
  }

  function exportCatalog(format) {
    const selected = state.selectedProducts.length > 0
      ? state.catalog.filter(p => state.selectedProducts.includes(p.productCode))
      : state.catalog;
    
    if (selected.length === 0) {
      showToast('No products to export', 'warning');
      return;
    }
    
    const templateId = $('#cartTemplateSelect').val() || 'cscart';
    const template = typeof CartTemplateRegistry !== 'undefined' ? CartTemplateRegistry.get(templateId) : null;
    const products = selected.map(p => CSCartMapper.fromCatalog(p, state.settings));
    
    if (format === 'xml') {
      if (template && !CartTemplateRegistry.supportsXML(templateId)) {
        showToast(template.name + ' does not support XML export. Use CSV instead.', 'warning');
        return;
      }
      const xml = template && template.toXML
        ? template.toXML(products, state.settings)
        : CSCartXMLBuilder.build(products, state.settings);
      downloadFile(xml, templateId + '-catalog.xml', 'application/xml');
    } else {
      if (template && template.mapProduct && template.toCSV) {
        const templateProducts = products.map(p => template.mapProduct(p, state.settings));
        const csv = template.toCSV(templateProducts, state.settings);
        downloadFile(csv, templateId + '-catalog.csv', 'text/csv');
      } else {
        const csv = CSCartMapper.toCSV(products);
        downloadFile(csv, 'cscart-catalog.csv', 'text/csv');
      }
    }
    
    showToast(`Exported ${selected.length} products as ${template ? template.name : 'CS-Cart'} ${format.toUpperCase()}`, 'success');
  }

  function mapToCSCart(data, rawData) {
    return data.map((row, index) => {
      const raw = rawData[index] || {};
      
      const getMappedValue = (cscartField) => {
        for (const [sourceField, mappedTo] of Object.entries(state.fieldMapping)) {
          if (mappedTo === cscartField) {
            const shortName = getShortFieldName(sourceField);
            return row[shortName] || raw[sourceField] || '';
          }
        }
        return '';
      };
      
      const supplierPrice = CSCartMapper.parsePrice(getMappedValue('price') || raw.Price);
      const shippingCostValue = CSCartMapper.parsePrice(getMappedValue('shipping_cost') || raw['Shipping Cost'] || '');
      
      // Build options string from variants if available
      const variantsRaw = getMappedValue('variants') || raw.Variants || '';
      let variants = [];
      try { variants = typeof variantsRaw === 'string' ? JSON.parse(variantsRaw) : variantsRaw; } catch(e) {}
      const optionsStr = Array.isArray(variants) && variants.length > 0
        ? CSCartXMLBuilder.buildOptions(variants, '', state.settings?.cscartDelimiter || '///')
        : '';
      
      const productName = getMappedValue('product_name') || raw.Title || 'Untitled';
      
      return {
        product_code: getMappedValue('product_code') || raw._productId || `SKU-${Date.now()}-${index}`,
        product_name: productName,
        price: calculateSellingPrice(parseFloat(supplierPrice), parseFloat(shippingCostValue)),
        list_price: CSCartMapper.parsePrice(getMappedValue('list_price') || raw['Original Price'] || ''),
        quantity: parseInt(getMappedValue('quantity')) || 999,
        category: getMappedValue('category') || raw.Category || state.settings?.defaultCategory || 'Products',
        description: getMappedValue('description') || raw.Description || '',
        short_description: getMappedValue('short_description') || raw['Short Description'] || CSCartMapper.extractShortDescription(getMappedValue('description') || raw.Description || ''),
        images: getMappedValue('images') || raw.Images || '',
        weight: parseFloat(getMappedValue('weight')) || 0,
        status: state.settings?.defaultStatus || 'A',
        language: state.settings?.defaultLanguage || 'en',
        brand: getMappedValue('brand') || raw.Brand || '',
        rating: getMappedValue('rating') || raw.Rating || '',
        review_count: getMappedValue('review_count') || raw['Review Count'] || '',
        reviews: raw.reviews || '',
        options: optionsStr,
        meta_keywords: getMappedValue('meta_keywords') || CSCartMapper.extractKeywords(productName),
        meta_description: getMappedValue('meta_description') || CSCartMapper.truncate(productName, 160),
        shipping_freight: shippingCostValue || '',
        // Supplier tracking
        supplier_url: getMappedValue('url') || raw.URL || state.tabUrl,
        supplier_price: supplierPrice
      };
    });
  }

  function copyToClipboard() {
    const data = state.dataTable.getData();
    const headers = state.dataTable.getColHeader();
    
    const tsv = [headers.join('\t')]
      .concat(data.map(row => row.join('\t')))
      .join('\n');
    
    navigator.clipboard.writeText(tsv).then(() => {
      showToast('Copied to clipboard', 'success');
    });
  }

  function downloadRawXlsx() {
    const data = state.dataTable.getData();
    const headers = state.dataTable.getColHeader();
    
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    
    const wbout = XLSX.write(wb, { type: 'binary', bookType: 'xlsx' });
    const blob = new Blob([s2ab(wbout)], { type: 'application/octet-stream' });
    
    saveAs(blob, 'scraped-data.xlsx');
    showToast('XLSX downloaded', 'success');
  }

  // ============================================
  // GOOGLE DRIVE FUNCTIONS
  // ============================================
  
  function checkDriveAuth() {
    if (typeof GoogleDriveService !== 'undefined') {
      GoogleDriveService.checkAuth().then(isAuthed => {
        updateDriveStatus(isAuthed);
      });
    }
  }

  function authorizeDrive() {
    if (typeof GoogleDriveService !== 'undefined') {
      GoogleDriveService.authorize().then(success => {
        updateDriveStatus(success);
        if (success) {
          showToast('Google Drive connected!', 'success');
        }
      }).catch(err => {
        showToast('Authorization failed: ' + err.message, 'error');
      });
    } else {
      showToast('Google Drive service not loaded', 'error');
    }
  }

  function disconnectDrive() {
    if (typeof GoogleDriveService !== 'undefined') {
      GoogleDriveService.disconnect();
      updateDriveStatus(false);
      showToast('Google Drive disconnected', 'success');
    }
  }

  function updateDriveStatus(connected) {
    const $indicator = $('.sync-indicator');
    const $text = $('.sync-text');
    const $authBtn = $('#authDriveBtn');
    const $disconnectBtn = $('#disconnectDriveBtn');
    const $status = $('#driveAuthStatus');
    
    if (connected) {
      $indicator.addClass('connected');
      $text.text('Connected');
      $authBtn.hide();
      $disconnectBtn.show();
      $status.removeClass('alert-warning').addClass('alert-success')
        .html('<span class="glyphicon glyphicon-ok"></span> Connected to Google Drive');
      $('#uploadDriveBtn').prop('disabled', false);
      $('#syncCatalogDriveBtn').prop('disabled', false);
    } else {
      $indicator.removeClass('connected');
      $text.text('Not synced');
      $authBtn.show();
      $disconnectBtn.hide();
      $status.removeClass('alert-success').addClass('alert-warning')
        .html('<span class="glyphicon glyphicon-warning-sign"></span> Not connected. Click to authorize.');
      $('#uploadDriveBtn').prop('disabled', true);
      $('#syncCatalogDriveBtn').prop('disabled', true);
    }
  }

  function uploadToDrive() {
    if (state.data.length === 0) {
      showToast('No data to upload', 'warning');
      return;
    }
    
    const products = mapToCSCart(state.data, state.rawData);
    const xml = CSCartXMLBuilder.build(products, state.settings);
    const filename = `products-${new Date().toISOString().slice(0,10)}.xml`;
    
    setStatus('Uploading to Google Drive...');
    
    GoogleDriveService.uploadFile(xml, filename, 'application/xml')
      .then(result => {
        showToast('Uploaded to Google Drive', 'success');
        setStatus('Upload complete');
        updateSyncTime();
      })
      .catch(err => {
        showToast('Upload failed: ' + err.message, 'error');
        setStatus('Upload failed');
      });
  }

  function syncCatalogToDrive() {
    if (state.catalog.length === 0) {
      showToast('Catalog is empty', 'warning');
      return;
    }
    
    const products = state.catalog.map(p => CSCartMapper.fromCatalog(p, state.settings));
    const xml = CSCartXMLBuilder.build(products, state.settings);
    const filename = `catalog-${new Date().toISOString().slice(0,10)}.xml`;
    
    setStatus('Syncing catalog to Google Drive...');
    
    GoogleDriveService.uploadFile(xml, filename, 'application/xml')
      .then(result => {
        showToast('Catalog synced to Google Drive', 'success');
        setStatus('Sync complete');
        updateSyncTime();
      })
      .catch(err => {
        showToast('Sync failed: ' + err.message, 'error');
        setStatus('Sync failed');
      });
  }

  function updateSyncTime() {
    const now = new Date();
    $('#lastSyncTime').text(now.toLocaleTimeString());
    
    chrome.storage.local.set({ lastSyncTime: now.getTime() });
  }

  // ============================================
  // SETTINGS FUNCTIONS
  // ============================================
  
  function loadSettings() {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      state.settings = response?.settings || {};
      applySettingsToUI();
    });
  }

  function applySettingsToUI() {
    if (!state.settings) return;
    
    $('#driveFolderName').val(state.settings.googleDriveFolder || 'DropshipTracker');
    $('#autoSyncEnabled').prop('checked', state.settings.autoSync || false);
    $('#syncInterval').val(state.settings.syncInterval || 360);
    $('#defaultMargin').val(state.settings.defaultMargin || 30);
    $('#marginType').val(state.settings.marginType || 'percent');
    $('#includeShippingInCost').prop('checked', state.settings.includeShippingInCost !== false); // default true
    $('#currency').val(state.settings.currency || 'USD');
    $('#roundPrices').prop('checked', state.settings.roundPrices !== false);
    $('#roundTo').val(state.settings.roundTo || '0.99');
    $('#defaultLanguage').val(state.settings.language || 'en');
    $('#fieldDelimiter').val(state.settings.cscartDelimiter || '///');
    $('#defaultStatus').val(state.settings.defaultStatus || 'A');
    $('#defaultCategory').val(state.settings.defaultCategory || '');
  }

  function saveSettings() {
    state.settings = {
      googleDriveFolder: $('#driveFolderName').val(),
      autoSync: $('#autoSyncEnabled').is(':checked'),
      syncInterval: parseInt($('#syncInterval').val()),
      defaultMargin: parseFloat($('#defaultMargin').val()),
      marginType: $('#marginType').val(),
      includeShippingInCost: $('#includeShippingInCost').is(':checked'),
      currency: $('#currency').val(),
      roundPrices: $('#roundPrices').is(':checked'),
      roundTo: parseFloat($('#roundTo').val()),
      language: $('#defaultLanguage').val(),
      cscartDelimiter: $('#fieldDelimiter').val(),
      defaultStatus: $('#defaultStatus').val(),
      defaultCategory: $('#defaultCategory').val()
    };
    
    chrome.runtime.sendMessage({ action: 'saveSettings', settings: state.settings }, (response) => {
      if (response?.success) {
        showToast('Settings saved', 'success');
      }
    });
  }

  function loadSuppliers() {
    chrome.runtime.sendMessage({ action: 'getSuppliers' }, (response) => {
      state.suppliers = response?.suppliers || [];
      renderSupplierCards();
      updateSupplierStats();
    });
  }

  function renderSupplierCards() {
    const $list = $('#suppliersList');
    $list.empty();
    
    if (state.suppliers.length === 0) {
      $list.html('<p class="text-muted">No suppliers configured. Click "Add Supplier" to add one.</p>');
      return;
    }
    
    state.suppliers.forEach(supplier => {
      const $card = $(`
        <div class="supplier-card" data-domain="${supplier.domain}">
          <div class="supplier-icon">
            <img src="https://www.google.com/s2/favicons?domain=${supplier.domain}&sz=32" alt="" onerror="this.style.display='none'">
          </div>
          <div class="supplier-info">
            <h5>${supplier.name || supplier.domain}</h5>
            <span class="text-muted">${supplier.domain}</span>
            ${supplier.notes ? `<small class="text-muted d-block">${supplier.notes}</small>` : ''}
          </div>
          <div class="supplier-stats">
            <span class="badge">0 products</span>
          </div>
          <div class="supplier-actions">
            <button type="button" class="btn btn-xs btn-default btn-configure" data-domain="${supplier.domain}" title="Configure">
              <span class="glyphicon glyphicon-cog"></span>
            </button>
            <button type="button" class="btn btn-xs btn-danger btn-delete-supplier" data-domain="${supplier.domain}" title="Delete">
              <span class="glyphicon glyphicon-trash"></span>
            </button>
          </div>
        </div>
      `);
      $list.append($card);
    });
    
    // Bind events for supplier actions
    $('.btn-delete-supplier').off('click').on('click', function() {
      const domain = $(this).data('domain');
      deleteSupplier(domain);
    });
    
    $('.btn-configure').off('click').on('click', function() {
      const domain = $(this).data('domain');
      configureSupplier(domain);
    });
  }

  function deleteSupplier(domain) {
    if (!confirm(`Delete supplier ${domain}?`)) return;
    
    chrome.runtime.sendMessage({ action: 'deleteSupplier', domain }, (response) => {
      if (response?.success) {
        showToast('Supplier deleted', 'success');
        loadSuppliers();
      } else {
        showToast('Failed to delete supplier', 'error');
      }
    });
  }

  function configureSupplier(domain) {
    const supplier = state.suppliers.find(s => s.domain === domain);
    if (!supplier) return;
    
    // Show configuration modal
    const modal = `
      <div id="configureSupplierModal" class="modal fade" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <button type="button" class="close" data-dismiss="modal">&times;</button>
              <h4 class="modal-title">Configure ${supplier.name || domain}</h4>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label>Display Name</label>
                <input type="text" class="form-control" id="configSupplierName" value="${supplier.name || ''}">
              </div>
              <div class="form-group">
                <label>Notes</label>
                <textarea class="form-control" id="configSupplierNotes" rows="3">${supplier.notes || ''}</textarea>
              </div>
              <div class="form-group">
                <label>Default Category</label>
                <input type="text" class="form-control" id="configSupplierCategory" value="${supplier.defaultCategory || ''}" placeholder="e.g., Electronics///Gadgets">
              </div>
              <div class="form-group">
                <label>Default Margin (%)</label>
                <input type="number" class="form-control" id="configSupplierMargin" value="${supplier.defaultMargin || 30}" min="0" max="500">
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-primary" id="saveSupplierConfigBtn">Save</button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Remove existing modal if any
    $('#configureSupplierModal').remove();
    $('body').append(modal);
    
    $('#saveSupplierConfigBtn').on('click', function() {
      const updates = {
        domain: domain,
        name: $('#configSupplierName').val().trim(),
        notes: $('#configSupplierNotes').val().trim(),
        defaultCategory: $('#configSupplierCategory').val().trim(),
        defaultMargin: parseInt($('#configSupplierMargin').val()) || 30
      };
      
      chrome.runtime.sendMessage({ action: 'saveSupplier', supplier: updates }, (response) => {
        if (response?.success) {
          showToast('Supplier updated', 'success');
          $('#configureSupplierModal').modal('hide');
          loadSuppliers();
        }
      });
    });
    
    $('#configureSupplierModal').modal('show');
  }

  function updateSupplierStats() {
    // Count products per supplier domain
    const counts = {};
    state.catalog.forEach(p => {
      counts[p.domain] = (counts[p.domain] || 0) + 1;
    });
    
    $('.supplier-card').each(function() {
      const domain = $(this).data('domain');
      const count = counts[domain] || 0;
      $(this).find('.badge').text(`${count} products`);
    });
  }

  function saveNewSupplier() {
    const supplier = {
      domain: $('#newSupplierDomain').val().trim(),
      name: $('#newSupplierName').val().trim(),
      notes: $('#newSupplierNotes').val().trim(),
      addedDate: Date.now()
    };
    
    if (!supplier.domain) {
      showToast('Please enter a domain', 'warning');
      return;
    }
    
    chrome.runtime.sendMessage({ action: 'saveSupplier', supplier }, (response) => {
      if (response?.success) {
        showToast('Supplier added', 'success');
        $('#addSupplierForm').slideUp();
        
        // Add card to UI
        const $card = $(`
          <div class="supplier-card" data-domain="${supplier.domain}">
            <div class="supplier-icon">
              <img src="https://www.google.com/s2/favicons?domain=${supplier.domain}&sz=32" alt="">
            </div>
            <div class="supplier-info">
              <h5>${supplier.name || supplier.domain}</h5>
              <span class="text-muted">${supplier.domain}</span>
            </div>
            <div class="supplier-stats">
              <span class="badge">0 products</span>
            </div>
            <div class="supplier-actions">
              <button type="button" class="btn btn-xs btn-default" title="Configure">
                <span class="glyphicon glyphicon-cog"></span>
              </button>
            </div>
          </div>
        `);
        
        $('#suppliersList').append($card);
        
        // Clear form
        $('#newSupplierDomain, #newSupplierName, #newSupplierNotes').val('');
      }
    });
  }

  // ============================================
  // DATA MANAGEMENT
  // ============================================
  
  function exportAllData() {
    chrome.storage.local.get(null, (data) => {
      const json = JSON.stringify(data, null, 2);
      downloadFile(json, 'dropshiptracker-backup.json', 'application/json');
      showToast('Backup downloaded', 'success');
    });
  }

  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = JSON.parse(e.target.result);
        chrome.storage.local.set(data, () => {
          showToast('Data imported successfully', 'success');
          loadCatalog();
          loadSettings();
          loadSuppliers();
        });
      } catch (err) {
        showToast('Invalid backup file', 'error');
      }
    };
    reader.readAsText(file);
  }

  function clearAllData() {
    if (!confirm('This will delete ALL your data including catalog, settings, and suppliers. Are you sure?')) {
      return;
    }
    
    chrome.storage.local.clear(() => {
      state.catalog = [];
      state.settings = null;
      state.suppliers = [];
      
      loadSettings();
      refreshCatalogTable();
      updateCatalogCount();
      
      showToast('All data cleared', 'success');
    });
  }

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================
  
  function sendToContentScript(message, callback) {
    if (!state.tabId || typeof state.tabId !== 'number') {
      console.error('[DropshipTracker] No valid tab ID');
      showToast('Cannot communicate with page. Refresh and reopen extension.', 'danger');
      callback({ error: 'No valid tab ID' });
      return;
    }
    
    chrome.tabs.sendMessage(state.tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
        console.error('[DropshipTracker] Message error:', errorMsg);
        
        // Try to inject content script if it doesn't exist
        if (errorMsg.includes('Receiving end does not exist') || errorMsg.includes('Could not establish connection')) {
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
  function injectContentScript(callback) {
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

  function showLoading(text) {
    $('#loadingText').text(text || 'Loading...');
    $('#loadingOverlay').css('display', 'flex');
  }

  function hideLoading() {
    $('#loadingOverlay').hide();
  }

  function setStatus(text) {
    $('#statusText').text(text);
  }

  function updateRowCount(count) {
    $('#rowCount').text(count);
  }

  function updatePageCount(count) {
    $('#pageCount').text(count);
  }

  function updateExportButtons() {
    const hasData = state.data.length > 0;
    $('#exportXmlBtn, #exportCsvBtn, #copyClipboardBtn, #downloadRawBtn').prop('disabled', !hasData);
    $('#addToCatalogBtn').prop('disabled', !hasData);
    $('#clearScrapedBtn').prop('disabled', !hasData);
  }

  function showToast(message, type = 'info') {
    const $toast = $('#toast');
    $('#toastMessage').text(message);
    $toast.removeClass('success error warning').addClass(type).addClass('show');
    
    setTimeout(() => {
      $toast.removeClass('show');
    }, 3000);
  }

  function parsePrice(priceStr) {
    // Delegate to CSCartMapper's more robust implementation
    if (typeof CSCartMapper !== 'undefined') {
      return parseFloat(CSCartMapper.parsePrice(priceStr)) || 0;
    }
    // Fallback if CSCartMapper not loaded
    if (typeof priceStr === 'number') return priceStr;
    if (!priceStr) return 0;
    const cleaned = priceStr.toString().replace(/[^0-9.,]/g, '');
    const normalized = cleaned.includes(',') && cleaned.indexOf(',') > cleaned.indexOf('.')
      ? cleaned.replace('.', '').replace(',', '.')
      : cleaned.replace(',', '');
    return parseFloat(normalized) || 0;
  }

  function calculateSellingPrice(supplierPrice, shippingCost = 0) {
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

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    saveAs(blob, filename);
  }

  function s2ab(s) {
    const buf = new ArrayBuffer(s.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < s.length; i++) {
      view[i] = s.charCodeAt(i) & 0xFF;
    }
    return buf;
  }

  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

})();
