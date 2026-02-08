# DropshipTracker — Comprehensive Refactoring Audit

**Generated:** 2026-02-08  
**Files audited:** `popup.js` (3536 lines), `onload.js` (2626 lines), `background.js` (319 lines), `manifest.json`, 8 service files  

---

## 1. MANIFEST STRUCTURE

```
manifest_version: 3
background:     background.js (service_worker)
content_scripts: [jquery-3.1.1.min.js, sha256.min.js, onload.js] + onload.css
popup scripts:  (loaded via popup.html)
  - jquery, bootstrap, handsontable, papaparse, xlsx, FileSaver (vendor libs)
  - services/cscartMapper.js
  - services/xmlBuilder.js
  - services/googleDriveService.js
  - services/cartTemplates.js
  - services/sanitize.js
  - services/shopifyTemplate.js
  - services/woocommerceTemplate.js
  - services/prestashopTemplate.js
  - services/magentoTemplate.js
  - services/bigcommerceTemplate.js
  - popup.js (main)

permissions: activeTab, storage, identity, alarms, downloads, scripting, webRequest
host_permissions: *://*/*
```

---

## 2. COMPLETE FUNCTION CATALOG

### 2A. popup.js (3536 lines)

| # | Function | Lines | Description | Dependencies | Module |
|---|----------|-------|-------------|-------------|--------|
| 1 | `(IIFE wrapper)` | 6-3536 | Module wrapper | — | main/init |
| 2 | `state` (object) | 24-56 | Central state singleton | — | **state** |
| 3 | `$(document).ready` | 60-101 | Initialization: parse URL params, call all loaders, bind events | loadSettings, loadCatalog, loadSuppliers, loadScrapedData, loadPersistedFieldMapping, loadCustomSelectors, initializeDataTable, initializeCatalogTable, bindEvents, checkDriveAuth | **main/init** |
| 4 | `saveScrapedData` | 108-125 | Save scraped data to chrome.storage.local | state | **persistence** |
| 5 | `loadScrapedData` | 131-161 | Restore scraped session from chrome.storage.local | state, updateDataTable, updateRowCount, updateExportButtons, showFieldMapping, setStatus, showToast | **persistence** |
| 6 | `clearScrapedSession` | 166-168 | Remove scraped session from storage | — | **persistence** |
| 7 | `loadPersistedFieldMapping` | 176-185 | Load field mappings for current domain from storage | state | **persistence** |
| 8 | `savePersistedFieldMapping` | 190-199 | Save field mappings for current domain | state | **persistence** |
| 9 | `loadCustomSelectors` | 204-214 | Load custom selectors from storage | state, updateCustomSelectorsList | **persistence** |
| 10 | `saveCustomSelectors` | 219-226 | Save custom selectors to storage | state | **persistence** |
| 11 | `updateCustomSelectorsList` | 231-258 | Render custom selectors list in UI | state | **settings** |
| 12 | `initializeDataTable` | 264-370 | Create Handsontable for scraped data with context menu | state, previewScrapedRow, updateDataTable, updateExportButtons, saveScrapedData, showToast | **dataTable** |
| 13 | `initializeCatalogTable` | 372-530 | Create Handsontable for catalog with column configs, renderers, context menu | state, previewCatalogRow, deleteCatalogRow, scrapeProductDetails, updateCatalogSelection, updateCatalogProduct | **catalogTable** |
| 14 | `bindEvents` | 536-648 | Bind all UI event handlers (buttons, tabs, modals) | findTables, nextTable, extractProduct, updateCatalogFromPage, locateNextButton, startCrawl, stopCrawl, addToCatalog, clearAllScrapedData, testScrape, exportCSCart, uploadToDrive, copyToClipboard, downloadRawXlsx, autoMapFields, toggleExpandColumns, startPickSelector, filterCatalog, deleteSelectedProducts, clearEntireCatalog, exportCatalog, checkPrices, syncCatalogToDrive, selectAllProducts, deselectAllProducts, invertSelection, selectByFilter, deletePreviewedItem, scrapeSelectedProducts, saveNewSupplier, authorizeDrive, disconnectDrive, saveSettings, exportAllData, importData, clearAllData, debounce | **main/init** |
| 15 | `handleSelectorPickerResult` | 657-670 | Process selector picker result from content script | state, saveCustomSelectors, updateCustomSelectorsList, showToast | **scraper** |
| 16 | `startPickSelector` | 675-740 | Show modal to pick element selector, send to content script | EXPORT_FIELDS, sendToContentScript, showToast | **scraper** |
| 17 | `findTables` | 742-758 | Send findTables action to content script | setStatus, sendToContentScript, showToast, getTableData, state | **scraper** |
| 18 | `nextTable` | 760-768 | Send nextTable action to content script | sendToContentScript, state, getTableData | **scraper** |
| 19 | `getTableData` | 770-793 | Send getTableData to content script, process results | setStatus, sendToContentScript, processScrapedData, updateRowCount, updateExportButtons, showFieldMapping, state | **scraper** |
| 20 | `extractProduct` | 795-866 | Extract single product from page via content script | setStatus, showLoading, sendToContentScript, SanitizeService, state, updateDataTable, updateRowCount, updateExportButtons, showFieldMapping, saveScrapedData, hideLoading, showToast | **scraper** |
| 21 | `updateCatalogFromPage` | 873-949 | Re-extract product on current page and update matching catalog item | setStatus, sendToContentScript, state, parsePrice, showToast, loadCatalog | **catalog** |
| 22 | `scrapeProductDetails` | 958-1156 | Open product URL in background tab, extract data, update catalog item | state, showToast, setStatus, parsePrice, calculateSellingPrice, SanitizeService, refreshCatalogTable, loadCatalog | **catalog** |
| 23 | `scrapeSelectedProducts` | 1163-1198 | Batch scrape selected catalog products sequentially | getSelectedCatalogRows, state, setStatus, showToast, scrapeProductDetails | **catalog** |
| 24 | `getSelectedCatalogRows` | 1203-1215 | Get selected row indices from catalog checkbox column | state | **catalogTable** |
| 25 | `processScrapedData` | 1217-1333 | Process raw scraped data: threshold/dedup/noise filter columns, build display data | state, FIELD_THRESHOLD, MAX_VISIBLE_COLUMNS, MAX_COLUMNS_EXPANDED, updateExpandToggle, buildSmartColumnNames, getShortFieldName, filterNoiseColumns, updateDataTable, showFieldMapping, saveScrapedData | **scraper** |
| 26 | `updateExpandToggle` | 1338-1348 | Show/hide expand columns toggle | state, MAX_VISIBLE_COLUMNS | **dataTable** |
| 27 | `toggleExpandColumns` | 1353-1356 | Toggle between showing all/limited columns | state, processScrapedData | **dataTable** |
| 28 | `getShortFieldName` | 1358-1375 | Extract meaningful name from DOM path | — | **utils** |
| 29 | `buildSmartColumnNames` | 1384-1453 | IDS-ported smart column naming (least-frequent CSS class) | — | **utils** |
| 30 | `filterNoiseColumns` | 1459-1477 | Remove identical-value/empty columns | — | **utils** |
| 31 | `updateDataTable` | 1479-1575 | Refresh Handsontable with scraped data (build headers, array format, columns) | state | **dataTable** |
| 32 | `locateNextButton` | 1577-1590 | Let user click "next" button on page | setStatus, sendToContentScript, showToast, state | **scraper** |
| 33 | `startCrawl` | 1592-1607 | Begin multi-page crawl | state, setStatus, crawlNextPage | **scraper** |
| 34 | `waitForNetworkIdle` | 1616-1676 | Network-aware page load detection via webRequest | state, chrome.webRequest, chrome.tabs | **scraper** |
| 35 | `deduplicateRows` | 1682-1688 | Remove duplicate rows by JSON.stringify | — | **utils** |
| 36 | `crawlNextPage` | 1690-1735 | Crawl next page: hash check, extract data, click next, recurse | state, sendToContentScript, processScrapedData, updateRowCount, updatePageCount, waitForNetworkIdle, stopCrawl, deduplicateRows | **scraper** |
| 37 | `stopCrawl` | 1737-1746 | Stop multi-page crawl, update UI | state, setStatus, showToast | **scraper** |
| 38 | `testScrape` | 1755-1788 | Run diagnostic test scrape, show results in modal | sendToContentScript, renderTestDiagnostic, state | **scraper** |
| 39 | `renderTestDiagnostic` | 1790-1866 | Render test scrape results table with score | — | **scraper** |
| 40 | `EXPORT_FIELDS` (const) | 1872-1915 | Array of export field definitions | — | **fieldMapping** |
| 41 | `CSCART_FIELDS` (alias) | 1917 | Backward compat alias for EXPORT_FIELDS | EXPORT_FIELDS | **fieldMapping** |
| 42 | `showFieldMapping` | 1919-1970 | Render field mapping UI grid with dropdowns | state, EXPORT_FIELDS, getShortFieldName, autoDetectMapping, savePersistedFieldMapping | **fieldMapping** |
| 43 | `autoDetectMapping` | 1972-2073 | Auto-detect field mapping by name heuristics | — | **fieldMapping** |
| 44 | `autoMapFields` | 2075-2087 | Apply auto-detection to all mapping dropdowns | getShortFieldName, autoDetectMapping, savePersistedFieldMapping, showToast, state | **fieldMapping** |
| 45 | `loadCatalog` | 2094-2099 | Load catalog from background via message | state, updateCatalogCount, refreshCatalogTable | **catalog** |
| 46 | `refreshCatalogTable` | 2101-2117 | Refresh catalog Handsontable with current data | state, updateCatalogStats, updateCatalogSelection | **catalogTable** |
| 47 | `updateCatalogCount` | 2119-2122 | Update catalog count display | state | **catalogTable** |
| 48 | `updateCatalogStats` | 2124-2137 | Compute and display price changes / low stock stats | state | **catalogTable** |
| 49 | `updateCatalogSelection` | 2139-2164 | Track selected catalog rows, update buttons/status | state | **catalogTable** |
| 50 | `selectAllProducts` | 2169-2174 | Check all catalog checkboxes | state, updateCatalogSelection, showToast | **catalogTable** |
| 51 | `deselectAllProducts` | 2179-2184 | Uncheck all catalog checkboxes | state, updateCatalogSelection, showToast | **catalogTable** |
| 52 | `invertSelection` | 2189-2194 | Toggle all catalog checkboxes | state, updateCatalogSelection, showToast | **catalogTable** |
| 53 | `selectByFilter` | 2199-2239 | Select products matching filter (domain, has-reviews, date range, etc.) | state, updateCatalogSelection, showToast | **catalogTable** |
| 54 | `previewScrapedRow` | 2246-2304 | Show scraped row in preview modal | state | **preview** |
| 55 | `previewCatalogRow` | 2309-2414 | Show catalog product in preview modal | state | **preview** |
| 56 | `deleteScrapedRow` | 2419-2430 | Delete a single scraped data row | state, updateDataTable, updateExportButtons, saveScrapedData, showToast | **dataTable** |
| 57 | `deleteCatalogRow` | 2435-2448 | Delete a single catalog product (sends to background) | state, refreshCatalogTable, updateCatalogCount, showToast | **catalog** |
| 58 | `deletePreviewedItem` | 2453-2463 | Delete item shown in preview modal | state, deleteScrapedRow, deleteCatalogRow | **preview** |
| 59 | `clearAllScrapedData` | 2468-2492 | Clear all scraped data + UI | state, updateExportButtons, clearScrapedSession, showToast, setStatus | **scraper** |
| 60 | `clearEntireCatalog` | 2497-2514 | Delete all catalog products | state, refreshCatalogTable, updateCatalogCount, showToast | **catalog** |
| 61 | `addToCatalog` | 2516-2709 | Map scraped data to catalog format and save via background | state, getShortFieldName, parsePrice, calculateSellingPrice, showToast, loadCatalog | **catalog** |
| 62 | `deleteSelectedProducts` | 2711-2722 | Delete selected catalog products | state, showToast, loadCatalog | **catalog** |
| 63 | `filterCatalog` | 2724-2763 | Filter catalog by criteria or search text | state | **catalogTable** |
| 64 | `updateCatalogProduct` | 2765-2771 | Send update to background for single product | — | **catalog** |
| 65 | `checkPrices` | 2773-2775 | Stub for price checking | showToast | **catalog** |
| 66 | `exportCSCart` | 2781-2820 | Export scraped data as CSV/XML for selected cart template | state, mapToCSCart, CSCartXMLBuilder, CSCartMapper, CartTemplateRegistry, downloadFile, showToast | **export** |
| 67 | `exportCatalog` | 2822-2855 | Export catalog as CSV/XML for selected template | state, CSCartMapper, CSCartXMLBuilder, CartTemplateRegistry, downloadFile, showToast | **export** |
| 68 | `mapToCSCart` | 2857-2906 | Map scraped data to CS-Cart product format | state, getShortFieldName, CSCartMapper, CSCartXMLBuilder, calculateSellingPrice | **export** |
| 69 | `copyToClipboard` | 2908-2918 | Copy table data as TSV to clipboard | state, showToast | **export** |
| 70 | `downloadRawXlsx` | 2920-2933 | Download scraped data as XLSX | state, XLSX, saveAs, s2ab, showToast | **export** |
| 71 | `checkDriveAuth` | 2939-2944 | Check Google Drive authorization status | GoogleDriveService, updateDriveStatus | **googleDrive** |
| 72 | `authorizeDrive` | 2946-2957 | Authorize Google Drive | GoogleDriveService, updateDriveStatus, showToast | **googleDrive** |
| 73 | `disconnectDrive` | 2959-2965 | Disconnect Google Drive | GoogleDriveService, updateDriveStatus, showToast | **googleDrive** |
| 74 | `updateDriveStatus` | 2967-2991 | Update Drive connection UI indicators | — | **googleDrive** |
| 75 | `uploadToDrive` | 2993-3012 | Upload scraped data XML to Google Drive | state, mapToCSCart, CSCartXMLBuilder, GoogleDriveService, setStatus, updateSyncTime, showToast | **googleDrive** |
| 76 | `syncCatalogToDrive` | 3014-3034 | Sync catalog XML to Google Drive | state, CSCartMapper, CSCartXMLBuilder, GoogleDriveService, setStatus, updateSyncTime, showToast | **googleDrive** |
| 77 | `updateSyncTime` | 3036-3040 | Update last sync time in UI and storage | — | **googleDrive** |
| 78 | `loadSettings` | 3046-3051 | Load settings from background | state, applySettingsToUI | **settings** |
| 79 | `applySettingsToUI` | 3053-3067 | Populate settings form from state | state | **settings** |
| 80 | `saveSettings` | 3069-3096 | Save settings to background | state, showToast | **settings** |
| 81 | `loadSuppliers` | 3098-3103 | Load suppliers from background | state, renderSupplierCards, updateSupplierStats | **settings** |
| 82 | `renderSupplierCards` | 3105-3152 | Render supplier cards UI | state, deleteSupplier, configureSupplier | **settings** |
| 83 | `deleteSupplier` | 3154-3163 | Delete supplier via background | showToast, loadSuppliers | **settings** |
| 84 | `configureSupplier` | 3165-3237 | Show supplier configuration modal | state, showToast, loadSuppliers | **settings** |
| 85 | `updateSupplierStats` | 3239-3249 | Count products per supplier domain, update badges | state | **settings** |
| 86 | `saveNewSupplier` | 3251-3301 | Save new supplier via background | state, showToast | **settings** |
| 87 | `exportAllData` | 3307-3313 | Download full chrome.storage.local as JSON | downloadFile, showToast | **settings** |
| 88 | `importData` | 3315-3330 | Import data from JSON backup file | loadCatalog, loadSettings, loadSuppliers, showToast | **settings** |
| 89 | `clearAllData` | 3332-3347 | Clear all chrome.storage.local data | state, loadSettings, refreshCatalogTable, updateCatalogCount, showToast | **settings** |
| 90 | `sendToContentScript` | 3353-3393 | Send message to content script with retry/injection | state, injectContentScript, showToast | **utils** |
| 91 | `injectContentScript` | 3398-3425 | Programmatically inject content script into tab | state, chrome.scripting, showToast | **utils** |
| 92 | `showLoading` | 3427-3430 | Show loading overlay | — | **utils** |
| 93 | `hideLoading` | 3432-3434 | Hide loading overlay | — | **utils** |
| 94 | `setStatus` | 3436-3438 | Set status bar text | — | **utils** |
| 95 | `updateRowCount` | 3440-3442 | Update row count display | — | **utils** |
| 96 | `updatePageCount` | 3444-3446 | Update page count display | — | **utils** |
| 97 | `updateExportButtons` | 3448-3453 | Enable/disable export buttons based on data | state | **utils** |
| 98 | `showToast` | 3455-3461 | Show toast notification | — | **utils** |
| 99 | `parsePrice` | 3463-3479 | Parse price string to number (delegates to CSCartMapper) | CSCartMapper | **utils** |
| 100 | `calculateSellingPrice` | 3481-3504 | Calculate selling price with margin + rounding | state.settings, parsePrice | **utils** |
| 101 | `downloadFile` | 3506-3509 | Download content as file via saveAs | saveAs | **utils** |
| 102 | `s2ab` | 3511-3517 | String to ArrayBuffer conversion (for XLSX) | — | **utils** |
| 103 | `debounce` | 3519-3524 | Debounce utility | — | **utils** |

**Total: 103 functions/objects** in popup.js

---

### 2B. onload.js (2626 lines)

| # | Function | Lines | Description | Dependencies | Module |
|---|----------|-------|-------------|-------------|--------|
| 1 | `(IIFE wrapper)` | 4-2626 | Module wrapper | — | main/init |
| 2 | `SITE_CONFIGS` (const) | 19-175 | Site config objects for aliexpress.com and alibaba.com (selectors, patterns) | — | **siteConfigs** |
| 3 | `getSiteConfig` | 178-184 | Get config for current domain | SITE_CONFIGS | **siteConfigs** |
| 4 | `extractProductId` | 187-224 | Extract product ID from URL or page elements | getSiteConfig | **productExtraction** |
| 5 | `findTables` | 233-271 | Table detection algorithm — score elements by area × childCount² | getConsistentChildren, buildSelector, highlightTable | **tableDetection** |
| 6 | `getConsistentChildren` | 276-353 | Find children with consistent class structure (3 strategies) | — | **tableDetection** |
| 7 | `buildSelector` | 358-384 | Build CSS selector for element (up to first ID) | — | **utils** |
| 8 | `highlightTable` | 389-399 | Add highlight CSS class to table element | — | **tableDetection** |
| 9 | `nextTable` | 404-418 | Switch to next detected table | highlightTable | **tableDetection** |
| 10 | `getTableData` | 425-562 | Extract data from current table (comprehensive mode) | extractElementData, extractProductIdFromElement, extractSupplierSku, customSelectors, extractSampleValue, lazyScrollElements | **tableExtraction** |
| 11 | `extractElementData` | 573-680 | Recursively extract data from element (TABLE or PRODUCT mode) | normalizeImageUrl | **tableExtraction** |
| 12 | `normalizeImageUrl` | 685-694 | Normalize image URL for deduplication | — | **utils** |
| 13 | `isValidProductUrl` | 699-722 | Check if URL is a valid product URL (not tracking) | — | **utils** |
| 14 | `cleanProductUrl` | 727-740 | Extract real URL from redirect URL | — | **utils** |
| 15 | `isValidImageUrl` | 745-756 | Check if URL is a valid image URL | — | **utils** |
| 16 | `extractProductIdFromElement` | 761-786 | Try to find product ID in element's data attributes or links | — | **productExtraction** |
| 17 | `extractSupplierSku` | 791-806 | Extract supplier SKU from element | — | **productExtraction** |
| 18 | `parsePriceText` | 811-826 | Parse a price string into numeric value | — | **utils** |
| 19 | `detectCurrency` | 831-844 | Detect currency from meta tags or page text | — | **utils** |
| 20 | `extractEmbeddedJSON` | 856-885 | Extract product data from embedded JSON in page scripts | mergeJSONProductData | **productExtraction** |
| 21 | `mergeJSONProductData` | 893-1111 | Walk JSON data structure to find product fields | — | **productExtraction** |
| 22 | `lazyScrollElements` | 1119-1141 | Lazy-scroll rows into view before extraction | — | **utils** |
| 23 | `findScrollableParent` | 1147-1157 | Find nearest scrollable parent of element | — | **utils** |
| 24 | `simulateFullClick` | 1163-1181 | Full mouse event simulation (mousedown+click+mouseup) | — | **utils** |
| 25 | `extractVideoUrls` | 1186-1202 | Extract video URLs from page | — | **productExtraction** |
| 26 | `extractSpecifications` | 1207-1262 | Extract specifications/attributes table | — | **productExtraction** |
| 27 | `extractProductDetails` | 1274-1893 | Main product extraction function (JSON → JSON-LD → meta → selectors → fallbacks) | extractProductId, getSiteConfig, extractEmbeddedJSON, tryCustomOrFallback, parsePriceText, detectCurrency, trySelectors, tryPriceSelectors, trySelectorsAll, extractVariantGroups, extractReviewsData, extractVideoUrls, extractSpecifications, cleanImageUrl, isValidProductImage | **productExtraction** |
| 28 | `cleanImageUrl` | 1899-1907 | Convert thumbnail URL to full size | — | **utils** |
| 29 | `isValidProductImage` | 1912-1919 | Check if URL is a valid product image | — | **utils** |
| 30 | `extractVariantGroups` | 1924-1981 | Extract variant groups (Color, Size, etc.) with details | — | **productExtraction** |
| 31 | `extractReviewsData` | 1986-2016 | Extract reviews data from page | extractRating | **productExtraction** |
| 32 | `extractRating` | 2021-2042 | Extract star rating from element | — | **productExtraction** |
| 33 | `trySelectors` | 2047-2057 | Try multiple selectors, return first text match | — | **utils** |
| 34 | `tryPriceSelectors` | 2063-2076 | Try selectors specifically for price fields (numeric) | parsePriceText, getDirectTextContent | **utils** |
| 35 | `getDirectTextContent` | 2081-2089 | Get direct text content (not from children) | — | **utils** |
| 36 | `trySelectorsAll` | 2094-2111 | Try selectors, get all matches | — | **utils** |
| 37 | `selectNextButton` | 2116-2128 | Let user click to select navigation button | buildSelector, nextButtonClickHandler, highlightHoverHandler | **navigation** |
| 38 | `nextButtonClickHandler` | 2130-2148 | Handle click on next button during selection | buildSelector | **navigation** |
| 39 | `highlightHoverHandler` | 2150-2155 | Highlight hovered element during selection | — | **navigation** |
| 40 | `clickNextButton` | 2161-2175 | Click the next button using simulateFullClick | simulateFullClick | **navigation** |
| 41 | `scrollDown` | 2182-2224 | Incremental scroll for infinite scroll pages | findScrollableParent | **navigation** |
| 42 | `getPageHash` | 2230-2244 | Get page hash for duplicate detection | sha256 | **navigation** |
| 43 | `startSelectorPicker` | 2250-2302 | Initialize selector picker mode (overlay, event listeners) | buildUniqueSelector, extractSampleValue, pickerHoverHandler, pickerUnhoverHandler, pickerClickHandler, pickerEscHandler | **selectorPicker** |
| 44 | `pickerHoverHandler` | 2304-2314 | Handle hover during picker mode | buildUniqueSelector, extractSampleValue | **selectorPicker** |
| 45 | `pickerUnhoverHandler` | 2316-2319 | Handle unhover during picker mode | — | **selectorPicker** |
| 46 | `pickerClickHandler` | 2321-2346 | Handle click during picker mode (save selector, notify popup) | buildUniqueSelector, extractSampleValue, stopSelectorPicker | **selectorPicker** |
| 47 | `pickerEscHandler` | 2348-2358 | Handle ESC key during picker mode | stopSelectorPicker | **selectorPicker** |
| 48 | `stopSelectorPicker` | 2360-2375 | Clean up picker mode (remove listeners, overlays) | — | **selectorPicker** |
| 49 | `buildUniqueSelector` | 2380-2430 | Build unique CSS selector for any element | — | **utils** |
| 50 | `extractSampleValue` | 2435-2445 | Extract text/src/href value from element | — | **utils** |
| 51 | `getCustomSelector` | 2447-2449 | Get custom selector for field | customSelectors | **selectorPicker** |
| 52 | `extractWithCustomSelector` | 2451-2455 | Extract value using custom selector | extractSampleValue | **selectorPicker** |
| 53 | `extractAllWithSelector` | 2457-2462 | Extract all values using custom selector | extractSampleValue | **selectorPicker** |
| 54 | `loadCustomSelectors` (onload) | 2464-2474 | Load custom selectors from chrome.storage (per-domain) | — | **persistence** |
| 55 | `saveCustomSelectors` (onload) | 2476-2484 | Save custom selectors to chrome.storage | — | **persistence** |
| 56 | `getAllCustomSelectors` | 2486-2488 | Return all custom selectors | — | **selectorPicker** |
| 57 | `message listener` | 2493-2559 | chrome.runtime.onMessage listener (handles all actions) | findTables, nextTable, getTableData, extractProductDetails, selectNextButton, clickNextButton, scrollDown, getPageHash, startSelectorPicker, stopSelectorPicker, getAllCustomSelectors, saveCustomSelectors, extractWithCustomSelector, extractAllWithSelector | **main/init** |

**Total: 57 functions/objects** in onload.js

---

### 2C. background.js (319 lines)

| # | Function | Lines | Description | Module |
|---|----------|-------|-------------|--------|
| 1 | `popupWindowId` (var) | 7 | Track popup window ID | state |
| 2 | `chrome.action.onClicked` | 10-30 | Open/focus popup window | main/init |
| 3 | `createPopupWindow` | 32-39 | Create popup window | main/init |
| 4 | `chrome.windows.onRemoved` | 42-46 | Clear window ID on close | main/init |
| 5 | `chrome.runtime.onInstalled` | 49-52 | Create periodic sync alarm | main/init |
| 6 | `chrome.alarms.onAlarm` | 55-59 | Handle alarm triggers | main/init |
| 7 | `checkPriceStockUpdates` | 62-103 | Check catalog for stale products | catalog |
| 8 | `chrome.runtime.onMessage` | 106-175 | Message handler (12 actions) | main/init |
| 9 | `deleteSupplier` | 178-184 | Delete supplier from storage | suppliers |
| 10 | `saveToCatalog` | 187-228 | Save/update products in catalog | catalog |
| 11 | `updateCatalogProduct` | 231-244 | Update single catalog product | catalog |
| 12 | `deleteCatalogProducts` | 247-257 | Delete products from catalog | catalog |
| 13 | `clearCatalog` | 260-266 | Clear entire catalog | catalog |
| 14 | `saveSupplier` | 269-284 | Save supplier config | suppliers |
| 15 | `getDefaultSettings` | 287-298 | Return default settings object | settings |

**Total: 15 functions** in background.js

---

### 2D. Service Files Summary

| File | Global Symbol | Key Functions |
|------|--------------|---------------|
| `cscartMapper.js` | `CSCartMapper` | `fromScraped`, `fromCatalog`, `toCSV`, `sanitizeProductCode`, `parsePrice`, `calculatePrice`, `formatCategory`, `formatImages`, `extractShortDescription`, `extractKeywords`, `truncate`, `csvEscape`, `validate` |
| `xmlBuilder.js` | `CSCartXMLBuilder` | `build`, `buildProductNode`, `buildReviewNode`, `buildOptions`, `formatCategory`, `formatImages`, `formatPrice`, `escapeXml`, `escapeCDATA` |
| `googleDriveService.js` | `GoogleDriveService` | `checkAuth`, `authorize`, `disconnect`, `apiRequest`, `getAppFolder`, `uploadFile`, `updateFile`, `findFile`, `listFiles`, `downloadFile`, `deleteFile`, `getFileMetadata`, `createSubfolder` |
| `cartTemplates.js` | `CartTemplateRegistry` | `register`, `get`, `getAll`, `mapProduct`, `toCSV`, `toXML`, `supportsXML`, `buildCSV` |
| `sanitize.js` | `SanitizeService` | `sanitizeText`, `decodeHTMLEntities`, `sanitizeUrl`, `sanitizeImageUrl`, `normalizePrice`, `normalizeRating`, `normalizeWeight`, `sanitizeProduct`, `escapeCSV`, `escapeCDATA`, `escapeXML` |
| `shopifyTemplate.js` | (registers via CartTemplateRegistry) | `generateHandle`, `mapProduct`, `toCSV` |
| `woocommerceTemplate.js` | (registers) | `mapProduct`, `toCSV` |
| `prestashopTemplate.js` | (registers) | `generateUrlRewrite`, `mapProduct`, `toCSV` |
| `magentoTemplate.js` | (registers) | `generateUrlKey`, `mapProduct`, `toCSV` |
| `bigcommerceTemplate.js` | (registers) | `generateProductUrl`, `mapProduct`, `toCSV` |

---

## 3. DUPLICATE FUNCTIONS

### 3A. `parsePrice` — 4 implementations

| Location | Lines | Flavor |
|----------|-------|--------|
| `popup.js` | 3463-3479 | Delegates to CSCartMapper, fallback regex |
| `onload.js` (`parsePriceText`) | 846-826 | Multi-currency regex + sanity limits |
| `cscartMapper.js` | 145-182 | Most robust: handles comma/dot ambiguity, currency symbols, sanity cap |
| `sanitize.js` (`normalizePrice`) | 184-260 | Returns `{amount, currency}` object; most comprehensive |

**Recommendation:** Consolidate into single `parsePrice` in shared utils. The `normalizePrice` in sanitize.js is the most complete but returns an object — adapt it or use cscartMapper's version as the canonical numeric parser.

### 3B. CSV Escape — 3 implementations

| Location | Function |
|----------|----------|
| `cscartMapper.js:294` | `csvEscape(value)` |
| `sanitize.js:424` | `escapeCSV(value)` |
| `cartTemplates.js:67` | inline `escape` in `buildCSV` |
| `prestashopTemplate.js:141` | inline `escape` in `toCSV` |
| `shopifyTemplate.js:131` | inline `escape` in `toCSV` |

**Recommendation:** Single `escapeCSV` in shared utils, imported everywhere.

### 3C. XML Escape — 3 implementations

| Location | Function |
|----------|----------|
| `xmlBuilder.js:249` | `escapeXml(str)` |
| `sanitize.js:446` | `escapeXML(text)` |

Both do the same `&<>"'` entity replacement.

### 3D. CDATA Escape — 2 implementations

| Location | Function |
|----------|----------|
| `xmlBuilder.js:263` | `escapeCDATA(str)` |
| `sanitize.js:437` | `escapeCDATA(text)` |

Both replace `]]>` inside CDATA blocks.

### 3E. `formatImages` — 2 implementations

| Location | Lines |
|----------|-------|
| `cscartMapper.js:225` | `formatImages(images, delimiter)` — splits, cleans, joins |
| `xmlBuilder.js:218` | `formatImages(images, delimiter)` — nearly identical logic |

### 3F. `formatCategory` — 2 implementations

| Location | Lines |
|----------|-------|
| `cscartMapper.js:208` | `formatCategory(category, delimiter)` |
| `xmlBuilder.js:200` | `formatCategory(category, delimiter)` |

### 3G. `calculatePrice` / `calculateSellingPrice` — 2 implementations

| Location | Function |
|----------|----------|
| `popup.js:3481` | `calculateSellingPrice(supplierPrice, shippingCost)` — includes shipping, rounding |
| `cscartMapper.js:184` | `calculatePrice(supplierPrice, settings)` — margin only, rounding |

### 3H. Image parsing pattern — 5 duplicates

Every template (shopify, woo, presta, magento, bigcommerce) independently does:
```js
const images = (product.images || '').split(/[,;|]+/).map(s => s.trim()).filter(s => s.startsWith('http'));
```

### 3I. `buildSelector` / `buildUniqueSelector` — 2 implementations

| Location | Function |
|----------|----------|
| `onload.js:358` | `buildSelector(element)` — walks up DOM, uses ID/classes |
| `onload.js:2380` | `buildUniqueSelector(element)` — more thorough, checks uniqueness |

### 3J. URL validation — 2 overlapping implementations

| Location | Function |
|----------|----------|
| `onload.js:699` | `isValidProductUrl(url)` |
| `onload.js:745` | `isValidImageUrl(url)` |
| `onload.js:1912` | `isValidProductImage(src)` — overlaps with isValidImageUrl |

### 3K. `loadCustomSelectors` / `saveCustomSelectors` — duplicated in both files

Both `popup.js` (L204, L219) and `onload.js` (L2464, L2476) have their own version.

---

## 4. CROSS-FILE MESSAGE PROTOCOL

### 4A. popup.js → onload.js (via `chrome.tabs.sendMessage`)

| Action String | Sent From | Handled In | Response |
|---------------|-----------|------------|----------|
| `findTables` | popup.js `findTables()` | onload.js | `{tableCount, currentTable, selector}` |
| `nextTable` | popup.js `nextTable()` | onload.js | `{currentTable, tableCount, selector}` |
| `getTableData` | popup.js `getTableData()` | onload.js | `{data[], tableIndex, tableSelector, rowCount}` |
| `extractProduct` | popup.js `extractProduct()`, `updateCatalogFromPage()`, `scrapeProductDetails()`, `testScrape()` | onload.js | product object |
| `selectNextButton` | popup.js `locateNextButton()` | onload.js | `{selector, element}` |
| `clickNext` | popup.js `crawlNextPage()` | onload.js | `{success, clicked}` |
| `scrollDown` | (not directly called in popup.js) | onload.js | `{scrolled, heightChanged, ...}` |
| `getPageHash` | popup.js `crawlNextPage()` | onload.js | `{hash}` |
| `startSelectorPicker` | popup.js `startPickSelector()` | onload.js | `{started, field}` |
| `stopSelectorPicker` | (bound but not called in popup.js) | onload.js | `{stopped}` |
| `getCustomSelectors` | (not called in popup.js) | onload.js | `customSelectors` |
| `saveCustomSelectors` | (not called in popup.js) | onload.js | `{success}` |
| `extractWithSelector` | (not called in popup.js) | onload.js | `{value, allValues}` |
| `ping` | popup.js `waitForNetworkIdle()`, `injectContentScript()` | onload.js | `{pong: true}` |

### 4B. onload.js → popup.js (via `chrome.runtime.sendMessage`)

| Action String | Sent From | Handled In | Purpose |
|---------------|-----------|------------|---------|
| `selectorPickerResult` | onload.js `pickerClickHandler()`, `pickerEscHandler()` | popup.js listener (L91-93) | Notify popup of picked selector |

### 4C. popup.js → background.js (via `chrome.runtime.sendMessage`)

| Action String | Sent From | Purpose |
|---------------|-----------|---------|
| `getCatalog` | `loadCatalog()` | Get catalog array |
| `saveToCatalog` | `addToCatalog()` | Save scraped products |
| `updateCatalogProduct` | `updateCatalogProduct()`, `scrapeProductDetails()`, `updateCatalogFromPage()` | Update single product |
| `deleteCatalogProducts` | `deleteSelectedProducts()` | Delete multiple products |
| `removeFromCatalog` | `deleteCatalogRow()` | Delete single product |
| `clearCatalog` | `clearEntireCatalog()` | Clear all catalog |
| `getSettings` | `loadSettings()` | Get settings |
| `saveSettings` | `saveSettings()` | Save settings |
| `getSuppliers` | `loadSuppliers()` | Get suppliers |
| `saveSupplier` | `saveNewSupplier()`, `configureSupplier()` | Save supplier |
| `deleteSupplier` | `deleteSupplier()` | Delete supplier |

---

## 5. GLOBAL STATE

### 5A. popup.js — `state` object (L24-56)

```javascript
state = {
  tabId, tabUrl, tabDomain,                    // Tab identity
  data, rawData, fieldNames, allFieldNames,     // Scraper data
  fieldMapping, customSelectors,                // Mapping config
  showAllColumns, tableSelector, nextSelector,  // UI state
  scraping, pages, visitedHashes,               // Crawl state
  catalog, selectedProducts,                    // Catalog data
  settings, suppliers,                          // Settings
  dataTable, catalogTable,                      // Handsontable instances
  previewContext,                               // Preview modal context
  smartNames                                    // Column name mapping cache
}
```

### 5B. onload.js — Module-level variables (L8-17)

```javascript
detectedTables = []         // Detected table elements with scores
currentTableIndex = 0        // Currently selected table
nextButtonSelector = null    // Selector for next/pagination button
customSelectors = {}         // User-defined custom selectors
selectorPickerActive = false // Picker mode flag
selectorPickerCallback = null
selectorPickerField = null   // Current picker target field
```

### 5C. background.js — Module-level variables

```javascript
popupWindowId = null  // Track popup window ID
```

---

## 6. RECOMMENDED MODULE BOUNDARIES

### popup.js → Split into these modules:

```
popup/
├── state.js              — State singleton + constants
├── init.js               — $(document).ready, bindEvents
├── persistence.js        — saveScrapedData, loadScrapedData, clearScrapedSession,
│                           loadPersistedFieldMapping, savePersistedFieldMapping,
│                           loadCustomSelectors, saveCustomSelectors
├── dataTable.js          — initializeDataTable, updateDataTable, updateExpandToggle,
│                           toggleExpandColumns, deleteScrapedRow
├── catalogTable.js       — initializeCatalogTable, refreshCatalogTable, updateCatalogCount,
│                           updateCatalogStats, updateCatalogSelection, selectAllProducts,
│                           deselectAllProducts, invertSelection, selectByFilter,
│                           getSelectedCatalogRows, filterCatalog
├── scraper.js            — findTables, nextTable, getTableData, extractProduct,
│                           processScrapedData, locateNextButton, startCrawl, crawlNextPage,
│                           stopCrawl, waitForNetworkIdle, startPickSelector,
│                           handleSelectorPickerResult, testScrape, renderTestDiagnostic,
│                           clearAllScrapedData, updateCustomSelectorsList
├── catalog.js            — loadCatalog, addToCatalog, deleteCatalogRow, deleteSelectedProducts,
│                           updateCatalogProduct, updateCatalogFromPage, scrapeProductDetails,
│                           scrapeSelectedProducts, clearEntireCatalog, checkPrices
├── fieldMapping.js       — EXPORT_FIELDS, showFieldMapping, autoDetectMapping, autoMapFields
├── export.js             — exportCSCart, exportCatalog, mapToCSCart, copyToClipboard,
│                           downloadRawXlsx
├── preview.js            — previewScrapedRow, previewCatalogRow, deletePreviewedItem
├── googleDrive.js        — checkDriveAuth, authorizeDrive, disconnectDrive, updateDriveStatus,
│                           uploadToDrive, syncCatalogToDrive, updateSyncTime
├── settings.js           — loadSettings, applySettingsToUI, saveSettings, loadSuppliers,
│                           renderSupplierCards, deleteSupplier, configureSupplier,
│                           updateSupplierStats, saveNewSupplier, exportAllData, importData,
│                           clearAllData
└── utils.js              — sendToContentScript, injectContentScript, showLoading, hideLoading,
                            setStatus, updateRowCount, updatePageCount, updateExportButtons,
                            showToast, parsePrice, calculateSellingPrice, downloadFile,
                            s2ab, debounce, getShortFieldName, buildSmartColumnNames,
                            filterNoiseColumns, deduplicateRows
```

### onload.js → Split into these modules:

```
content/
├── siteConfigs.js        — SITE_CONFIGS, getSiteConfig
├── tableDetection.js     — findTables, getConsistentChildren, highlightTable, nextTable
├── tableExtraction.js    — getTableData, extractElementData
├── productExtraction.js  — extractProductDetails, extractProductId, extractProductIdFromElement,
│                           extractSupplierSku, extractEmbeddedJSON, mergeJSONProductData,
│                           extractVideoUrls, extractSpecifications, extractVariantGroups,
│                           extractReviewsData, extractRating
├── selectorPicker.js     — startSelectorPicker, pickerHoverHandler, pickerUnhoverHandler,
│                           pickerClickHandler, pickerEscHandler, stopSelectorPicker,
│                           buildUniqueSelector, extractSampleValue, getCustomSelector,
│                           extractWithCustomSelector, extractAllWithSelector,
│                           getAllCustomSelectors
├── navigation.js         — selectNextButton, nextButtonClickHandler, highlightHoverHandler,
│                           clickNextButton, scrollDown, getPageHash
├── persistence.js        — loadCustomSelectors, saveCustomSelectors (content-side)
├── utils.js              — buildSelector, normalizeImageUrl, isValidProductUrl, cleanProductUrl,
│                           isValidImageUrl, isValidProductImage, cleanImageUrl, parsePriceText,
│                           detectCurrency, lazyScrollElements, findScrollableParent,
│                           simulateFullClick, trySelectors, tryPriceSelectors,
│                           getDirectTextContent, trySelectorsAll
└── init.js               — chrome.runtime.onMessage listener, loadCustomSelectors call
```

### Shared utilities (new):

```
shared/
├── priceUtils.js         — Single parsePrice, currency detection
├── escapeUtils.js        — escapeCSV, escapeXML, escapeCDATA
├── formatUtils.js        — formatImages, formatCategory
└── imageUtils.js         — image parsing pattern shared across templates
```

---

## 7. IMPORT/EXPORT DEPENDENCY GRAPH

```
┌─────────────────────────────────────────────────┐
│                   popup.html                     │
│  Loads: vendor libs, services/*, popup.js        │
└──────────────┬──────────────────────────────────-┘
               │
    ┌──────────┼──────────────────────────────┐
    │          │                              │
    ▼          ▼                              ▼
┌────────┐ ┌────────────┐            ┌──────────────┐
│state.js│ │  init.js    │            │ services/    │
│        │ │  bindEvents │            │ (already     │
│        │ │             │            │  modular)    │
└───┬────┘ └──────┬──────┘            └──────────────┘
    │             │                          │
    │    ┌────────┼────────┬────────┐        │
    │    ▼        ▼        ▼        ▼        │
    │ ┌──────┐ ┌──────┐ ┌──────┐ ┌───────┐  │
    │ │scrape│ │catlog│ │export│ │preview│  │
    │ │r.js  │ │.js   │ │.js   │ │.js    │  │
    │ └──┬───┘ └──┬───┘ └──┬───┘ └───────┘  │
    │    │        │        │                 │
    ▼    ▼        ▼        ▼                 │
 ┌──────────────────────────────┐            │
 │         utils.js             │◄───────────┘
 │  (parsePrice, showToast,     │
 │   sendToContentScript, etc.) │
 └──────────────────────────────┘
               │
               │ chrome.tabs.sendMessage
               ▼
 ┌──────────────────────────────┐
 │       onload.js (content)    │
 │                              │
 │  siteConfigs ← tableDetect  │
 │       ↕           ↕          │
 │  productExtr ← tableExtr    │
 │       ↕                      │
 │  selectorPicker  navigation  │
 │       ↕                      │
 │    utils (shared concepts)   │
 └──────────────────────────────┘
               │
               │ chrome.runtime.sendMessage
               ▼
 ┌──────────────────────────────┐
 │       background.js          │
 │  chrome.storage.local CRUD   │
 │  alarm management            │
 │  popup window management     │
 └──────────────────────────────┘
```

---

## 8. KEY FINDINGS & RISK AREAS

### 8.1 Complexity Hotspots
- **`extractProductDetails`** (onload.js L1274-1893): 620 lines, most complex function
- **`addToCatalog`** (popup.js L2516-2709): 194 lines, heavy mapping logic
- **`scrapeProductDetails`** (popup.js L958-1156): 199 lines, complex async tab management
- **`processScrapedData`** (popup.js L1217-1333): 117 lines, column dedup + noise filtering
- **`initializeCatalogTable`** (popup.js L372-530): 159 lines, complex renderers
- **`mergeJSONProductData`** (onload.js L893-1111): 219 lines, deep JSON path walking

### 8.2 Circular Dependencies
- `scraper.js` ↔ `catalog.js`: `scrapeProductDetails` is called from both scraper buttons and catalog UI
- `fieldMapping.js` ↔ `utils.js`: `getShortFieldName` is used by both
- `state.js` is imported by everything

### 8.3 Content Script Constraints
- `onload.js` runs as a content script — cannot use ES modules (`import/export`)
- Must remain a single IIFE or use a bundler (webpack/rollup)
- Shares no code with popup.js at runtime — any shared utils must be duplicated or bundled separately

### 8.4 MV3 Constraints
- Service worker (`background.js`) has no DOM access
- Cannot share state between background and popup except via chrome.storage + messaging
- Already structured correctly for MV3

---

## 9. REFACTORING PRIORITY ORDER

1. **Extract shared utils** — `parsePrice`, `escapeCSV`, `escapeXML`, `escapeCDATA`, `formatImages`, `formatCategory` → single source of truth
2. **Split popup.js** — into 13 modules (state, init, persistence, dataTable, catalogTable, scraper, catalog, fieldMapping, export, preview, googleDrive, settings, utils)
3. **Split onload.js** — into 9 modules (siteConfigs, tableDetection, tableExtraction, productExtraction, selectorPicker, navigation, persistence, utils, init)
4. **Add a bundler** — Required because content scripts can't use ES modules; use Rollup or webpack to bundle content/ modules into single onload.js
5. **Deduplicate template image parsing** — Move shared pattern into a utility consumed by all cart templates
6. **Extract `extractProductDetails`** — Break 620-line function into sub-functions per extraction strategy (JSON, JSON-LD, meta, DOM selectors)
7. **Consolidate `addToCatalog` mapping** — Reuse `CSCartMapper.fromScraped()` instead of duplicating mapping logic
