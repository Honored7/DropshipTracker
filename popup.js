/**
 * DropshipTracker Main Popup Script
 * Handles UI interactions, data flow, and export functionality
 */

(function() {
  "use strict";

  // ============================================
  // STATE MANAGEMENT
  // ============================================
  
  const state = {
    tabId: null,
    tabUrl: null,
    
    // Scraper state
    data: [],
    rawData: [],
    fieldNames: [],
    fieldMapping: {},
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
    // Parse URL params
    const params = new URLSearchParams(window.location.search);
    state.tabId = parseInt(params.get('tabid'));
    state.tabUrl = decodeURIComponent(params.get('url') || '');
    
    // Initialize
    loadSettings();
    loadCatalog();
    loadSuppliers();
    loadScrapedData(); // Restore any previously scraped data
    initializeDataTable();
    initializeCatalogTable();
    bindEvents();
    checkDriveAuth();
    
    console.log("[DropshipTracker] Popup initialized for tab", state.tabId);
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
      console.log('[DropshipTracker] Scraped data saved:', state.data.length, 'items');
    });
  }
  
  /**
   * Load scraped data from chrome.storage.local
   * Restores session if popup was closed
   */
  function loadScrapedData() {
    chrome.storage.local.get(['scrapedSession'], (result) => {
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
  // DATA TABLE (Handsontable)
  // ============================================
  
  function initializeDataTable() {
    const container = document.getElementById('dataPreview');
    
    state.dataTable = new Handsontable(container, {
      data: [],
      colHeaders: true,
      rowHeaders: true,
      height: 300,
      stretchH: 'all',
      autoWrapRow: true,
      autoWrapCol: true,
      licenseKey: 'non-commercial-and-evaluation',
      contextMenu: {
        items: {
          'preview': {
            name: '👁️ Preview',
            callback: function(key, selection) {
              const row = selection[0].start.row;
              previewScrapedRow(row);
            }
          },
          'delete_row': {
            name: '🗑️ Delete Row',
            callback: function(key, selection) {
              const rows = selection.map(s => s.start.row).sort((a, b) => b - a);
              rows.forEach(row => deleteScrapedRow(row));
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
      }
    });
  }

  function initializeCatalogTable() {
    const container = document.getElementById('catalogGrid');
    
    state.catalogTable = new Handsontable(container, {
      data: [],
      colHeaders: ['✓', 'Product Code', 'Title', 'Supplier', 'Supplier Price', 'Your Price', 'Stock', 'Last Checked', 'Actions'],
      columns: [
        { type: 'checkbox', className: 'htCenter', width: 30 },
        { data: 'productCode', readOnly: true, width: 100 },
        { data: 'title', readOnly: true, width: 200 },
        { data: 'domain', readOnly: true, width: 100 },
        { data: 'supplierPrice', type: 'numeric', numericFormat: { pattern: '$0,0.00' }, readOnly: true, width: 90 },
        { data: 'yourPrice', type: 'numeric', numericFormat: { pattern: '$0,0.00' }, width: 90 },
        { data: 'stock', type: 'numeric', readOnly: true, width: 60 },
        { data: 'lastCheckedFormatted', readOnly: true, width: 90 },
        { 
          data: 'actions',
          readOnly: true,
          width: 70,
          renderer: function(instance, td, row, col, prop, value, cellProperties) {
            td.innerHTML = '<div class="row-actions">' +
              '<button class="btn btn-xs btn-default btn-preview" onclick="window.previewCatalogRow(' + row + ')" title="Preview">👁️</button>' +
              '<button class="btn btn-xs btn-default btn-delete" onclick="window.deleteCatalogRow(' + row + ')" title="Delete">🗑️</button>' +
              '</div>';
            return td;
          }
        }
      ],
      height: 350,
      stretchH: 'all',
      licenseKey: 'non-commercial-and-evaluation',
      manualColumnResize: true,
      columnSorting: true,
      filters: true,
      contextMenu: {
        items: {
          'preview': {
            name: '👁️ Preview',
            callback: function(key, selection) {
              const row = selection[0].start.row;
              previewCatalogRow(row);
            }
          },
          'delete_row': {
            name: '🗑️ Delete',
            callback: function(key, selection) {
              const rows = selection.map(s => s.start.row).sort((a, b) => b - a);
              rows.forEach(row => deleteCatalogRow(row));
            }
          },
          'separator': '---------',
          'copy': { name: 'Copy' }
        }
      },
      afterChange: function(changes, source) {
        if (source === 'edit' && changes) {
          changes.forEach(([row, prop, oldVal, newVal]) => {
            if (prop === 'yourPrice' && oldVal !== newVal) {
              const product = state.catalog[row];
              if (product) {
                updateCatalogProduct(product.productCode, { yourPrice: newVal });
              }
            }
          });
        }
      },
      afterSelection: function() {
        updateCatalogSelection();
      }
    });
  }
  
  // Expose functions globally for inline onclick handlers
  window.previewCatalogRow = function(row) { previewCatalogRow(row); };
  window.deleteCatalogRow = function(row) { deleteCatalogRow(row); };

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
    
    // Field mapping
    $('#autoMapBtn').on('click', autoMapFields);

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
    
    sendToContentScript({ action: 'extractProduct' }, (response) => {
      if (response && (response.title || response.productId)) {
        // Convert to row format
        const row = {
          'Product ID': response.productId || '',
          'Title': response.title || '',
          'Price': response.price || '',
          'Currency': response.currency || 'USD',
          'Description': response.descriptionText || '',
          'Images': (response.images || []).join('|||'),
          'URL': response.url || '',
          'Domain': response.domain || '',
          'Variants': JSON.stringify(response.variants || []),
          'Reviews': (response.reviews || []).length + ' reviews',
          'Shipping': response.shipping || '',
          'Brand': response.brand || '',
          'SKU': response.sku || ''
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
      } else {
        setStatus('Could not extract product details');
        showToast('No product data found. Make sure you\'re on a product page.', 'warning');
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

  function processScrapedData(rawData) {
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
    
    // Keep fields that appear in at least 20% of rows
    const threshold = rawData.length * 0.2;
    const goodFields = Object.entries(fieldCounts)
      .filter(([_, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .map(([field]) => field)
      .slice(0, 20); // Max 20 columns
    
    state.fieldNames = goodFields;
    
    // Convert to array format for display
    const displayData = rawData.map(row => {
      const displayRow = {};
      goodFields.forEach(field => {
        const shortName = getShortFieldName(field);
        displayRow[shortName] = row[field] || '';
      });
      return displayRow;
    });
    
    state.data = displayData;
    updateDataTable(displayData);
    
    // Auto-save scraped data
    saveScrapedData();
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
    
    const headers = Object.keys(data[0]);
    const arrayData = data.map(row => headers.map(h => row[h]));
    
    state.dataTable.updateSettings({
      colHeaders: headers,
      data: arrayData
    });
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
    { id: 'product_code', label: 'Product Code *', required: true },
    { id: 'product_name', label: 'Product Name *', required: true },
    { id: 'price', label: 'Price *', required: true },
    { id: 'list_price', label: 'List Price (MSRP)' },
    { id: 'quantity', label: 'Quantity/Stock' },
    { id: 'category', label: 'Category' },
    { id: 'description', label: 'Description' },
    { id: 'short_description', label: 'Short Description' },
    { id: 'images', label: 'Images' },
    { id: 'weight', label: 'Weight' },
    { id: 'brand', label: 'Brand/Manufacturer' },
    { id: 'sku', label: 'SKU' },
    { id: 'url', label: 'Supplier URL' },
    { id: 'shipping', label: 'Shipping Info' },
    { id: 'variants', label: 'Variants/Options' }
  ];

  function showFieldMapping() {
    if (state.fieldNames.length === 0) return;
    
    const $grid = $('#fieldMappingGrid').empty();
    
    state.fieldNames.forEach((field, index) => {
      const shortName = getShortFieldName(field);
      const autoMapped = autoDetectMapping(shortName);
      state.fieldMapping[field] = autoMapped;
      
      const $row = $(`
        <div class="mapping-row">
          <span class="source-field" title="${field}">${shortName}</span>
          <span class="arrow">→</span>
          <select class="form-control input-sm" data-field="${field}">
            ${CSCART_FIELDS.map(f => 
              `<option value="${f.id}" ${f.id === autoMapped ? 'selected' : ''}>${f.label}</option>`
            ).join('')}
          </select>
        </div>
      `);
      
      $row.find('select').on('change', function() {
        state.fieldMapping[$(this).data('field')] = $(this).val();
      });
      
      $grid.append($row);
    });
    
    $('#fieldMappingSection').slideDown();
  }

  function autoDetectMapping(fieldName) {
    const lower = fieldName.toLowerCase();
    
    if (lower.includes('price') && !lower.includes('list')) return 'price';
    if (lower.includes('list') && lower.includes('price')) return 'list_price';
    if (lower.includes('title') || lower.includes('name')) return 'product_name';
    if (lower.includes('desc')) return 'description';
    if (lower.includes('img') || lower.includes('src') || lower.includes('image')) return 'images';
    if (lower.includes('stock') || lower.includes('qty') || lower.includes('quantity')) return 'quantity';
    if (lower.includes('category') || lower.includes('cat')) return 'category';
    if (lower.includes('weight')) return 'weight';
    if (lower.includes('brand') || lower.includes('manufacturer')) return 'brand';
    if (lower.includes('sku') || lower.includes('code') || lower.includes('id')) return 'product_code';
    if (lower.includes('href') || lower.includes('url') || lower.includes('link')) return 'url';
    if (lower.includes('ship')) return 'shipping';
    if (lower.includes('variant') || lower.includes('option')) return 'variants';
    
    return '';
  }

  function autoMapFields() {
    $('#fieldMappingGrid select').each(function() {
      const field = $(this).data('field');
      const shortName = getShortFieldName(field);
      const mapped = autoDetectMapping(shortName);
      $(this).val(mapped);
      state.fieldMapping[field] = mapped;
    });
    
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
      ...p,
      lastCheckedFormatted: p.lastChecked 
        ? new Date(p.lastChecked).toLocaleDateString() 
        : 'Never'
    }));
    
    state.catalogTable.loadData(displayData);
    updateCatalogStats();
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
    const data = state.catalogTable.getData();
    
    data.forEach((row, index) => {
      if (row[0] === true) {
        selected.push(state.catalog[index]?.productCode);
      }
    });
    
    state.selectedProducts = selected.filter(Boolean);
    $('#deleteSelectedBtn').prop('disabled', selected.length === 0);
    
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
          shouldSelect = product.addedAt && (now - product.addedAt) < dayMs;
          break;
        case 'week':
          shouldSelect = product.addedAt && (now - product.addedAt) < weekMs;
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
    if (imageUrl) {
      $('#previewImage').html(`<img src="${imageUrl}" alt="Product">`);
    } else {
      $('#previewImage').html('<div class="text-muted text-center"><span class="glyphicon glyphicon-picture" style="font-size:60px;color:#ccc;"></span><br>No image</div>');
    }
    
    // Set gallery
    const images = combined.images || [];
    if (images.length > 1) {
      $('#previewGallery').html(images.slice(0, 10).map((img, i) => 
        `<img src="${img}" alt="Image ${i+1}" onclick="$('#previewImage img').attr('src','${img}')" class="${i===0?'active':''}">`
      ).join(''));
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
    
    // Set image
    const images = product.images || [];
    if (images.length > 0) {
      $('#previewImage').html(`<img src="${images[0]}" alt="Product">`);
    } else {
      $('#previewImage').html('<div class="text-muted text-center"><span class="glyphicon glyphicon-picture" style="font-size:60px;color:#ccc;"></span><br>No image</div>');
    }
    
    // Set gallery
    if (images.length > 1) {
      $('#previewGallery').html(images.slice(0, 10).map((img, i) => 
        `<img src="${img}" alt="Image ${i+1}" onclick="$('#previewImage img').attr('src','${img}')" class="${i===0?'active':''}">`
      ).join(''));
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
        <span class="detail-value">${product.addedAt ? new Date(product.addedAt).toLocaleString() : 'Unknown'}</span>
      </div>
    `;
    
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
    if (product.url) {
      $('#previewSourceLink').attr('href', product.url).show();
    } else {
      $('#previewSourceLink').hide();
    }
    
    $('#previewModal').modal('show');
  }
  
  /**
   * Delete single scraped row
   */
  function deleteScrapedRow(rowIndex) {
    if (rowIndex < 0 || rowIndex >= state.data.length) return;
    
    state.data.splice(rowIndex, 1);
    state.rawData.splice(rowIndex, 1);
    
    state.dataTable.loadData(state.data);
    updateExportButtons();
    $('#rowCount').text(state.data.length);
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
      
      const productCode = getMappedValue('product_code') || 
                          rawRow._productId || 
                          rawRow['Product ID'] ||
                          `SKU-${Date.now()}-${index}`;
      
      const priceStr = getMappedValue('price') || rawRow.Price || '';
      const price = parsePrice(priceStr);
      
      return {
        productCode: productCode,
        title: getMappedValue('product_name') || rawRow.Title || 'Untitled Product',
        supplierPrice: price,
        yourPrice: calculateSellingPrice(price),
        stock: parseInt(getMappedValue('quantity')) || 999,
        category: getMappedValue('category') || state.settings?.defaultCategory || '',
        description: getMappedValue('description') || rawRow.Description || '',
        images: getMappedValue('images') || rawRow.Images || '',
        supplierUrl: getMappedValue('url') || rawRow.URL || state.tabUrl,
        domain: new URL(state.tabUrl || 'http://unknown').hostname,
        variants: getMappedValue('variants') || rawRow.Variants || '',
        shipping: getMappedValue('shipping') || rawRow.Shipping || '',
        brand: getMappedValue('brand') || rawRow.Brand || ''
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
    
    // Map data to CS-Cart format
    const products = mapToCSCart(state.data, state.rawData);
    
    if (format === 'xml') {
      const xml = CSCartXMLBuilder.build(products, state.settings);
      downloadFile(xml, 'cscart-products.xml', 'application/xml');
      showToast('CS-Cart XML exported', 'success');
    } else {
      const csv = CSCartMapper.toCSV(products);
      downloadFile(csv, 'cscart-products.csv', 'text/csv');
      showToast('CS-Cart CSV exported', 'success');
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
    
    const products = selected.map(p => CSCartMapper.fromCatalog(p, state.settings));
    
    if (format === 'xml') {
      const xml = CSCartXMLBuilder.build(products, state.settings);
      downloadFile(xml, 'cscart-catalog.xml', 'application/xml');
    } else {
      const csv = CSCartMapper.toCSV(products);
      downloadFile(csv, 'cscart-catalog.csv', 'text/csv');
    }
    
    showToast(`Exported ${selected.length} products as ${format.toUpperCase()}`, 'success');
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
      
      const supplierPrice = parsePrice(getMappedValue('price') || raw.Price);
      
      return {
        product_code: getMappedValue('product_code') || raw._productId || `SKU-${Date.now()}-${index}`,
        product_name: getMappedValue('product_name') || raw.Title || 'Untitled',
        price: calculateSellingPrice(supplierPrice),
        list_price: parsePrice(getMappedValue('list_price')),
        quantity: parseInt(getMappedValue('quantity')) || 999,
        category: getMappedValue('category') || state.settings?.defaultCategory || 'Products',
        description: getMappedValue('description') || raw.Description || '',
        short_description: getMappedValue('short_description') || '',
        images: getMappedValue('images') || raw.Images || '',
        weight: parseFloat(getMappedValue('weight')) || 0,
        status: state.settings?.defaultStatus || 'A',
        language: state.settings?.defaultLanguage || 'en',
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
      // Update supplier cards with product counts
      updateSupplierStats();
    });
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
    if (!state.tabId) {
      console.error('No tab ID');
      callback({ error: 'No tab ID' });
      return;
    }
    
    chrome.tabs.sendMessage(state.tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Message error:', chrome.runtime.lastError);
        callback({ error: chrome.runtime.lastError.message });
        return;
      }
      callback(response || {});
    });
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
    if (typeof priceStr === 'number') return priceStr;
    if (!priceStr) return 0;
    
    // Remove currency symbols and extract number
    const cleaned = priceStr.toString().replace(/[^0-9.,]/g, '');
    // Handle European format (1.234,56) vs US format (1,234.56)
    const normalized = cleaned.includes(',') && cleaned.indexOf(',') > cleaned.indexOf('.')
      ? cleaned.replace('.', '').replace(',', '.')
      : cleaned.replace(',', '');
    
    return parseFloat(normalized) || 0;
  }

  function calculateSellingPrice(supplierPrice) {
    if (!supplierPrice || !state.settings) return supplierPrice;
    
    let price;
    const margin = state.settings.defaultMargin || 30;
    
    if (state.settings.marginType === 'percent') {
      price = supplierPrice * (1 + margin / 100);
    } else {
      price = supplierPrice + margin;
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
