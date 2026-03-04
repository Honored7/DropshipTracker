(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/popup/state.js
  var MAX_VISIBLE_COLUMNS, FIELD_THRESHOLD, MAX_COLUMNS_EXPANDED, state;
  var init_state = __esm({
    "src/popup/state.js"() {
      MAX_VISIBLE_COLUMNS = 40;
      FIELD_THRESHOLD = 0.1;
      MAX_COLUMNS_EXPANDED = 100;
      state = {
        tabId: null,
        tabUrl: null,
        tabDomain: null,
        // Scraper state
        data: [],
        rawData: [],
        fieldNames: [],
        allFieldNames: [],
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
        catalogTable: null,
        // Preview context
        previewContext: null,
        // Smart column name mapping cache
        smartNames: null
      };
    }
  });

  // src/popup/utils.js
  function sendToContentScript(message, callback) {
    if (!state.tabId || typeof state.tabId !== "number") {
      console.error("[DropshipTracker] No valid tab ID");
      showToast("Cannot communicate with page. Refresh and reopen extension.", "danger");
      callback({ error: "No valid tab ID" });
      return;
    }
    chrome.tabs.sendMessage(state.tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || "Unknown error";
        console.error("[DropshipTracker] Message error:", errorMsg);
        if (errorMsg.includes("Receiving end does not exist") || errorMsg.includes("Could not establish connection")) {
          console.log("[DropshipTracker] Attempting to inject content script...");
          injectContentScript(() => {
            setTimeout(() => {
              chrome.tabs.sendMessage(state.tabId, message, (retryResponse) => {
                if (chrome.runtime.lastError) {
                  showToast("Content script injection failed. Please refresh the page.", "danger");
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
  function injectContentScript(callback) {
    chrome.tabs.sendMessage(state.tabId, { action: "ping" }, (response) => {
      if (!chrome.runtime.lastError && response && response.pong) {
        console.log("[DropshipTracker] Content script already loaded, skipping injection");
        callback && callback();
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: state.tabId },
        files: ["js/jquery-3.1.1.min.js", "js/sha256.min.js", "onload.js"]
      }).then(() => {
        console.log("[DropshipTracker] Content script injected successfully");
        chrome.scripting.insertCSS({
          target: { tabId: state.tabId },
          files: ["onload.css"]
        }).then(() => {
          callback && callback();
        }).catch((e) => {
          console.error("[DropshipTracker] CSS injection failed:", e);
          callback && callback();
        });
      }).catch((e) => {
        console.error("[DropshipTracker] Script injection failed:", e);
        showToast("Could not inject script. Page may be restricted.", "danger");
        callback && callback();
      });
    });
  }
  function showLoading(text) {
    $("#loadingText").text(text || "Loading...");
    $("#loadingOverlay").css("display", "flex");
  }
  function hideLoading() {
    $("#loadingOverlay").hide();
  }
  function setStatus(text) {
    $("#statusText").text(text);
  }
  function updateRowCount(count) {
    $("#rowCount").text(count);
  }
  function updatePageCount(count) {
    $("#pageCount").text(count);
  }
  function updateExportButtons() {
    const hasData = state.data.length > 0;
    $("#exportXmlBtn, #exportCsvBtn, #copyClipboardBtn, #downloadRawBtn").prop("disabled", !hasData);
    $("#addToCatalogBtn").prop("disabled", !hasData);
    $("#clearScrapedBtn").prop("disabled", !hasData);
  }
  function showToast(message, type = "info") {
    const $toast = $("#toast");
    $("#toastMessage").text(message);
    $toast.removeClass("success error warning").addClass(type).addClass("show");
    setTimeout(() => {
      $toast.removeClass("show");
    }, 3e3);
  }
  function parsePrice(priceStr) {
    if (typeof CSCartMapper !== "undefined") {
      return parseFloat(CSCartMapper.parsePrice(priceStr)) || 0;
    }
    if (typeof priceStr === "number")
      return priceStr > 1e6 ? 0 : priceStr;
    if (!priceStr)
      return 0;
    const priceMatch = priceStr.toString().match(/[\$\u20AC\u00A3\u00A5\u20A6]?\s*([\d,]+\.?\d{0,2})\b/);
    if (priceMatch) {
      const num = parseFloat(priceMatch[1].replace(/,/g, ""));
      if (num > 0.01 && num < 1e6)
        return num;
    }
    const cleaned = priceStr.toString().replace(/[^0-9.,]/g, "");
    const normalized = cleaned.includes(",") && cleaned.indexOf(",") > cleaned.indexOf(".") ? cleaned.replace(".", "").replace(",", ".") : cleaned.replace(",", "");
    const result = parseFloat(normalized) || 0;
    return result < 1e6 ? result : 0;
  }
  function calculateSellingPrice(supplierPrice, shippingCost = 0) {
    if (!supplierPrice || !state.settings)
      return supplierPrice;
    let costBasis = parseFloat(supplierPrice) || 0;
    if (state.settings.includeShippingInCost !== false && shippingCost > 0) {
      costBasis += parseFloat(shippingCost) || 0;
    }
    let price;
    const margin = state.settings.defaultMargin || 30;
    if (state.settings.marginType === "percent") {
      price = costBasis * (1 + margin / 100);
    } else {
      price = costBasis + margin;
    }
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
      view[i] = s.charCodeAt(i) & 255;
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
  function getShortFieldName(fullPath) {
    const parts = fullPath.split("/").filter((p) => p);
    const last = parts[parts.length - 1] || fullPath;
    let suffix = "";
    if (fullPath.includes(" ")) {
      suffix = fullPath.split(" ").slice(1).join(" ").replace("@", "");
    }
    const classMatch = last.match(/\.([a-zA-Z_-]+)/);
    if (classMatch) {
      const name = classMatch[1].replace(/-/g, "_");
      return suffix ? name + " " + suffix : name;
    }
    const tagName = last.split(".")[0] || "field";
    return suffix ? tagName + " " + suffix : tagName;
  }
  function buildSmartColumnNames(allFieldPaths) {
    const classPathCount = {};
    allFieldPaths.forEach((path) => {
      const seen = /* @__PURE__ */ new Set();
      const segments = path.split(" ")[0].split("/").filter((p) => p);
      segments.forEach((seg) => {
        const classes = seg.split(".").slice(1);
        classes.forEach((cls) => {
          if (!seen.has(cls)) {
            seen.add(cls);
            classPathCount[cls] = (classPathCount[cls] || 0) + 1;
          }
        });
      });
    });
    const nameMap = {};
    const nameUsage = {};
    allFieldPaths.forEach((path) => {
      let suffix = "";
      const spaceParts = path.split(" ");
      if (spaceParts.length > 1) {
        suffix = spaceParts.slice(1).join(" ").replace(/@/g, "");
      }
      const segments = spaceParts[0].split("/").filter((p) => p);
      let bestClass = "";
      let bestScore = Infinity;
      for (let i = segments.length - 1; i >= 0; i--) {
        const classes = segments[i].split(".").slice(1);
        for (const cls of classes) {
          if (!cls)
            continue;
          if (/^(container|wrapper|wrap|inner|outer|row|col|content|main|section|block|box|item|list|group|div)$/i.test(cls))
            continue;
          const score = classPathCount[cls] || 0;
          if (score < bestScore) {
            bestScore = score;
            bestClass = cls;
          }
        }
      }
      if (!bestClass) {
        const lastSeg = segments[segments.length - 1] || "";
        bestClass = lastSeg.split(".")[0] || "field";
      }
      let friendlyName = bestClass.replace(/--/g, "-").replace(/^-|-$/g, "").replace(/-/g, "_");
      if (suffix)
        friendlyName += " " + suffix;
      nameUsage[friendlyName] = (nameUsage[friendlyName] || 0) + 1;
      if (nameUsage[friendlyName] > 1) {
        friendlyName += " " + nameUsage[friendlyName];
      }
      nameMap[path] = friendlyName;
    });
    return nameMap;
  }
  function filterNoiseColumns(fields, rawData) {
    return fields.filter((field) => {
      const values = [];
      rawData.forEach((row) => {
        const v = row[field];
        if (v !== void 0 && v !== null && v !== "") {
          values.push(String(v).trim());
        }
      });
      if (values.length === 0)
        return false;
      const unique = new Set(values);
      if (unique.size === 1 && values.length > 2)
        return false;
      return true;
    });
  }
  function deduplicateRows(data) {
    const seen = /* @__PURE__ */ new Set();
    return data.filter((row) => {
      const key = JSON.stringify(row);
      if (seen.has(key))
        return false;
      seen.add(key);
      return true;
    });
  }
  var init_utils = __esm({
    "src/popup/utils.js"() {
      init_state();
      __name(sendToContentScript, "sendToContentScript");
      __name(injectContentScript, "injectContentScript");
      __name(showLoading, "showLoading");
      __name(hideLoading, "hideLoading");
      __name(setStatus, "setStatus");
      __name(updateRowCount, "updateRowCount");
      __name(updatePageCount, "updatePageCount");
      __name(updateExportButtons, "updateExportButtons");
      __name(showToast, "showToast");
      __name(parsePrice, "parsePrice");
      __name(calculateSellingPrice, "calculateSellingPrice");
      __name(downloadFile, "downloadFile");
      __name(s2ab, "s2ab");
      __name(debounce, "debounce");
      __name(getShortFieldName, "getShortFieldName");
      __name(buildSmartColumnNames, "buildSmartColumnNames");
      __name(filterNoiseColumns, "filterNoiseColumns");
      __name(deduplicateRows, "deduplicateRows");
    }
  });

  // src/popup/backendClient.js
  async function isBackendAvailable() {
    const now = Date.now();
    if (_backendAvailable !== null && now - _lastProbeTime < PROBE_TTL_MS) {
      return _backendAvailable;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      const res = await fetch(`${BACKEND_BASE}/health`, {
        method: "GET",
        signal: controller.signal
      });
      clearTimeout(timer);
      _backendAvailable = res.ok;
      _lastProbeTime = now;
      if (_backendAvailable) {
        const data = await res.json().catch(() => ({}));
        console.log(
          `[DropshipTracker] Backend available \u2014 Scrapling ${data.scrapling_version ?? "unknown"}`
        );
      }
      return _backendAvailable;
    } catch {
      _backendAvailable = false;
      _lastProbeTime = now;
      return false;
    }
  }
  function resetBackendCache() {
    _backendAvailable = null;
    _lastProbeTime = 0;
  }
  async function extractViaBackend(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${BACKEND_BASE}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).detail ?? "";
      } catch {
      }
      throw new Error(`Backend /extract failed (${res.status}): ${detail}`);
    }
    const data = await res.json();
    return _normaliseBackendProduct(data);
  }
  function _normaliseBackendProduct(p) {
    return {
      // Identity
      productId: p.product_id ?? p.productId ?? "",
      url: p.url ?? "",
      domain: p.domain ?? _domainFromUrl(p.url),
      // Text
      title: p.title ?? "",
      shortDescription: p.short_description ?? p.shortDescription ?? "",
      description: p.description ?? "",
      descriptionText: p.description ?? "",
      fullDescription: p.full_description ?? p.description ?? "",
      category: p.category ?? "",
      brand: p.brand ?? "",
      sku: p.sku ?? "",
      metaKeywords: p.meta_keywords ?? p.metaKeywords ?? "",
      metaDescription: p.meta_description ?? p.metaDescription ?? p.short_description ?? "",
      // Pricing
      price: p.price != null ? String(p.price) : "",
      originalPrice: p.original_price != null ? String(p.original_price) : "",
      currency: p.currency ?? "USD",
      shippingCost: p.shipping_cost != null ? String(p.shipping_cost) : "",
      shippingText: p.shipping_text ?? p.shippingText ?? "",
      shipping: p.shipping_text ?? "",
      minOrder: p.min_order ?? p.minOrder ?? "",
      // Availability
      stock: p.stock != null ? String(p.stock) : "",
      availability: p.availability ?? "",
      soldCount: p.sold_count != null ? String(p.sold_count) : "",
      orders: p.sold_count != null ? String(p.sold_count) : "",
      // Media
      images: Array.isArray(p.images) ? p.images : [],
      videoUrls: Array.isArray(p.video_urls) ? p.video_urls : [],
      // Store
      storeName: p.store_name ?? p.storeName ?? "",
      storeRating: p.store_rating != null ? String(p.store_rating) : "",
      // Ratings / reviews
      rating: p.rating != null ? String(p.rating) : "",
      reviewCount: p.review_count != null ? String(p.review_count) : "",
      reviews: Array.isArray(p.reviews) ? p.reviews : [],
      // Logistics
      weight: p.weight ?? "",
      // Rich product data
      variants: Array.isArray(p.variants) ? p.variants : [],
      variantGroups: Array.isArray(p.variant_groups) ? p.variant_groups : Array.isArray(p.variantGroups) ? p.variantGroups : [],
      specifications: Array.isArray(p.specifications) ? p.specifications : [],
      // Backend metadata
      extractionMethod: p.extraction_method ?? "scrapling-backend",
      _source: "backend"
    };
  }
  function _domainFromUrl(url = "") {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }
  var BACKEND_BASE, HEALTH_TIMEOUT_MS, EXTRACT_TIMEOUT_MS, _backendAvailable, _lastProbeTime, PROBE_TTL_MS;
  var init_backendClient = __esm({
    "src/popup/backendClient.js"() {
      BACKEND_BASE = "http://127.0.0.1:8000";
      HEALTH_TIMEOUT_MS = 2e3;
      EXTRACT_TIMEOUT_MS = 3e4;
      _backendAvailable = null;
      _lastProbeTime = 0;
      PROBE_TTL_MS = 3e4;
      __name(isBackendAvailable, "isBackendAvailable");
      __name(resetBackendCache, "resetBackendCache");
      __name(extractViaBackend, "extractViaBackend");
      __name(_normaliseBackendProduct, "_normaliseBackendProduct");
      __name(_domainFromUrl, "_domainFromUrl");
    }
  });

  // src/popup/catalogTable.js
  function initializeCatalogTable() {
    const container = document.getElementById("catalogGrid");
    state.catalogTable = new Handsontable(container, {
      data: [],
      colHeaders: ["\u2713", "Image", "Code", "Title", "Supplier", "Price", "Your $", "Stock", "Rating", "Reviews", "Sold", "Category", "Checked", "Actions"],
      columns: [
        { data: "selected", type: "checkbox", className: "htCenter", width: 30 },
        {
          data: "thumbnail",
          readOnly: true,
          width: 45,
          renderer: function(instance, td, row, col, prop, value, cellProperties) {
            const images = instance.getSourceDataAtRow(row)?.images;
            const firstImage = images ? Array.isArray(images) ? images[0] : images.split(",")[0] : "";
            if (firstImage && firstImage.startsWith("http")) {
              td.innerHTML = `<img src="${firstImage}" style="max-width:38px;max-height:38px;object-fit:cover;" onerror="this.style.display='none'" />`;
            } else {
              td.innerHTML = '<span style="color:#ccc">\u{1F4F7}</span>';
            }
            return td;
          }
        },
        { data: "productCode", readOnly: true, width: 80 },
        { data: "title", readOnly: true, width: 140 },
        { data: "domain", readOnly: true, width: 65 },
        { data: "supplierPrice", type: "numeric", numericFormat: { pattern: "$0,0.00" }, readOnly: true, width: 60 },
        { data: "yourPrice", type: "numeric", numericFormat: { pattern: "$0,0.00" }, width: 60 },
        { data: "stock", type: "numeric", readOnly: true, width: 45 },
        {
          data: "rating",
          readOnly: true,
          width: 50,
          renderer: function(instance, td, row, col, prop, value, cellProperties) {
            const rating = value || instance.getSourceDataAtRow(row)?.rating;
            if (rating) {
              td.innerHTML = `\u2B50${rating}`;
              td.style.textAlign = "center";
            } else {
              td.innerHTML = "-";
              td.style.textAlign = "center";
              td.style.color = "#ccc";
            }
            return td;
          }
        },
        { data: "reviewCount", readOnly: true, width: 55, className: "htCenter" },
        { data: "soldCount", readOnly: true, width: 55, className: "htCenter" },
        { data: "category", readOnly: true, width: 75 },
        { data: "lastCheckedFormatted", readOnly: true, width: 65 },
        {
          data: "actions",
          readOnly: true,
          width: 85,
          renderer: function(instance, td, row, col, prop, value, cellProperties) {
            td.innerHTML = '<div class="row-actions"><button class="btn btn-xs btn-info btn-scrape-details" data-action="scrape" data-row="' + row + '" title="Scrape Full Details">\u{1F50D}</button><button class="btn btn-xs btn-default btn-preview" data-action="preview" data-row="' + row + '" title="Preview">\u{1F441}\uFE0F</button><button class="btn btn-xs btn-danger btn-delete" data-action="delete" data-row="' + row + '" title="Delete">\u{1F5D1}\uFE0F</button></div>';
            return td;
          }
        }
      ],
      height: 350,
      width: "100%",
      stretchH: "none",
      licenseKey: "non-commercial-and-evaluation",
      manualColumnResize: true,
      columnSorting: true,
      filters: true,
      contextMenu: {
        items: {
          "scrape_details": {
            name: "\u{1F50D} Scrape Full Details",
            callback: function(key, selection) {
              const row = this.toPhysicalRow(selection[0].start.row);
              scrapeProductDetails(row);
            }
          },
          "preview": {
            name: "\u{1F441}\uFE0F Preview",
            callback: function(key, selection) {
              const row = this.toPhysicalRow(selection[0].start.row);
              previewCatalogRow(row);
            }
          },
          "delete_row": {
            name: "\u{1F5D1}\uFE0F Delete",
            callback: function(key, selection) {
              const rows = selection.map((s) => this.toPhysicalRow(s.start.row)).sort((a, b) => b - a);
              rows.forEach((row) => deleteCatalogRow(row));
            }
          },
          "separator": "---------",
          "copy": { name: "Copy" }
        }
      },
      afterOnCellMouseDown: function(event, coords, td) {
        const target = event.target;
        if (target.matches("[data-action]") || target.closest("[data-action]")) {
          event.stopPropagation();
          const btn = target.matches("[data-action]") ? target : target.closest("[data-action]");
          const action = btn.dataset.action;
          const physicalRow = this.toPhysicalRow(coords.row);
          if (action === "preview") {
            previewCatalogRow(physicalRow);
          } else if (action === "delete") {
            deleteCatalogRow(physicalRow);
          } else if (action === "scrape") {
            scrapeProductDetails(physicalRow);
          }
        }
      },
      afterChange: function(changes, source) {
        if (changes) {
          let selectionChanged = false;
          changes.forEach(([row, prop, oldVal, newVal]) => {
            if (prop === "selected") {
              selectionChanged = true;
            } else if (prop === "yourPrice" && oldVal !== newVal && source === "edit") {
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
  function refreshCatalogTable() {
    const displayData = state.catalog.map((p) => ({
      selected: p.selected || false,
      ...p,
      reviewCount: p.reviewCount || p.review_count || "",
      soldCount: p.soldCount || p.sold_count || p.orders || "",
      rating: p.rating || "",
      category: p.category || "",
      supplierPrice: p.supplierPrice || 0,
      lastCheckedFormatted: p.lastChecked ? new Date(p.lastChecked).toLocaleDateString() : "Never"
    }));
    state.catalogTable.loadData(displayData);
    updateCatalogStats();
    updateCatalogSelection();
  }
  function updateCatalogCount() {
    $("#catalogCount").text(state.catalog.length);
    $("#totalProducts").text(state.catalog.length);
  }
  function updateCatalogStats() {
    const priceChanges = state.catalog.filter(
      (p) => p.priceHistory && p.priceHistory.length > 1 && p.priceHistory[p.priceHistory.length - 1].price !== p.priceHistory[p.priceHistory.length - 2].price
    ).length;
    const lowStock = state.catalog.filter((p) => p.stock && p.stock < 10).length;
    $("#priceChanges").text(priceChanges);
    $("#lowStockCount").text(lowStock);
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
    $("#deleteSelectedBtn").prop("disabled", selected.length === 0);
    const $scrapeBtn = $("#scrapeSelectedBtn");
    if (selectedRows.length > 0) {
      $scrapeBtn.text(`Scrape Selected (${selectedRows.length})`).prop("disabled", false);
    } else {
      $scrapeBtn.text("Scrape Selected").prop("disabled", true);
    }
    if (state.selectedProducts.length > 0) {
      $("#selectionStatus").show();
      $("#selectionCount").text(state.selectedProducts.length);
    } else {
      $("#selectionStatus").hide();
    }
  }
  function selectAllProducts() {
    const data = state.catalogTable.getData();
    const changes = data.map((row, index) => [index, 0, true]);
    state.catalogTable.setDataAtCell(changes, "bulkSelect");
    updateCatalogSelection();
    showToast(`Selected ${data.length} products`, "info");
  }
  function deselectAllProducts() {
    const data = state.catalogTable.getData();
    const changes = data.map((row, index) => [index, 0, false]);
    state.catalogTable.setDataAtCell(changes, "bulkSelect");
    updateCatalogSelection();
    showToast("Selection cleared", "info");
  }
  function invertSelection() {
    const data = state.catalogTable.getData();
    const changes = data.map((row, index) => [index, 0, row[0] !== true]);
    state.catalogTable.setDataAtCell(changes, "bulkSelect");
    updateCatalogSelection();
    showToast("Selection inverted", "info");
  }
  function selectByFilter(filterType) {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1e3;
    const weekMs = 7 * dayMs;
    let selected = 0;
    state.catalog.forEach((product, index) => {
      let shouldSelect = false;
      switch (filterType) {
        case "aliexpress":
          shouldSelect = product.domain?.toLowerCase().includes("aliexpress");
          break;
        case "alibaba":
          shouldSelect = product.domain?.toLowerCase().includes("alibaba");
          break;
        case "has-reviews":
          shouldSelect = product.reviews && product.reviews.length > 0;
          break;
        case "has-variants":
          shouldSelect = product.variants && product.variants.length > 0;
          break;
        case "today":
          shouldSelect = product.addedDate && now - product.addedDate < dayMs;
          break;
        case "week":
          shouldSelect = product.addedDate && now - product.addedDate < weekMs;
          break;
        default:
          shouldSelect = false;
      }
      if (shouldSelect) {
        state.catalogTable.setDataAtCell(index, 0, true, "bulkSelect");
        selected++;
      }
    });
    updateCatalogSelection();
    showToast(`Selected ${selected} products matching "${filterType}"`, "info");
  }
  function getSelectedCatalogRows() {
    if (!state.catalogTable)
      return [];
    const selectedRows = [];
    const data = state.catalogTable.getData();
    data.forEach((row, index) => {
      if (row[0] === true) {
        selectedRows.push(index);
      }
    });
    return selectedRows;
  }
  function filterCatalog(filter) {
    let filtered = state.catalog;
    if (typeof filter === "string" && filter !== "all") {
      switch (filter) {
        case "price-changed":
          filtered = state.catalog.filter(
            (p) => p.priceHistory && p.priceHistory.length > 1 && p.priceHistory[p.priceHistory.length - 1].price !== p.priceHistory[0].price
          );
          break;
        case "low-stock":
          filtered = state.catalog.filter((p) => p.stock && p.stock < 10);
          break;
        case "needs-update":
          const dayAgo = Date.now() - 24 * 60 * 60 * 1e3;
          filtered = state.catalog.filter((p) => !p.lastChecked || p.lastChecked < dayAgo);
          break;
      }
    }
    const searchText = $("#catalogSearch").val()?.toLowerCase();
    if (searchText) {
      filtered = filtered.filter(
        (p) => p.productCode?.toLowerCase().includes(searchText) || p.title?.toLowerCase().includes(searchText) || p.domain?.toLowerCase().includes(searchText)
      );
    }
    state.catalogTable.loadData(filtered.map((p) => ({
      ...p,
      lastCheckedFormatted: p.lastChecked ? new Date(p.lastChecked).toLocaleDateString() : "Never"
    })));
  }
  var init_catalogTable = __esm({
    "src/popup/catalogTable.js"() {
      init_state();
      init_utils();
      init_preview();
      init_catalog();
      __name(initializeCatalogTable, "initializeCatalogTable");
      __name(refreshCatalogTable, "refreshCatalogTable");
      __name(updateCatalogCount, "updateCatalogCount");
      __name(updateCatalogStats, "updateCatalogStats");
      __name(updateCatalogSelection, "updateCatalogSelection");
      __name(selectAllProducts, "selectAllProducts");
      __name(deselectAllProducts, "deselectAllProducts");
      __name(invertSelection, "invertSelection");
      __name(selectByFilter, "selectByFilter");
      __name(getSelectedCatalogRows, "getSelectedCatalogRows");
      __name(filterCatalog, "filterCatalog");
    }
  });

  // src/popup/catalog.js
  function loadCatalog() {
    chrome.runtime.sendMessage({ action: "getCatalog" }, (response) => {
      state.catalog = response?.catalog || [];
      updateCatalogCount();
      refreshCatalogTable();
    });
  }
  function addToCatalog() {
    if (state.data.length === 0) {
      showToast("No data to add. Scrape some products first.", "warning");
      return;
    }
    const products = state.data.map((row, index) => {
      const rawRow = state.rawData[index] || {};
      const getMappedValue = /* @__PURE__ */ __name((exportField) => {
        const smartNames = state.smartNames || {};
        for (const [sourceField, mappedTo] of Object.entries(state.fieldMapping)) {
          if (mappedTo === exportField) {
            const displayName = smartNames[sourceField] || getShortFieldName(sourceField);
            return row[displayName] || rawRow[sourceField] || "";
          }
        }
        return "";
      }, "getMappedValue");
      const findProductUrl = /* @__PURE__ */ __name(() => {
        const candidates = [];
        for (const [key, val] of Object.entries(rawRow)) {
          if (!val || typeof val !== "string")
            continue;
          if (!key.endsWith("href") && !key.endsWith("@href") && !key.endsWith("@link"))
            continue;
          let url = val;
          if (key.endsWith("@link") && val.includes("|||")) {
            url = val.split("|||").pop().trim();
          }
          if (!url.startsWith("http"))
            continue;
          if (/click\.|\/track|\/ad[\/\?]|google-analytics|advertis/i.test(url))
            continue;
          const isProductUrl = /\/product[-_]?detail|\/item\/\d|\/product\/\d|\/dp\/|\/p\/|\.html/i.test(url);
          candidates.push({ url, priority: isProductUrl ? 1 : 2 });
        }
        if (candidates.length === 0)
          return "";
        candidates.sort((a, b) => a.priority - b.priority);
        return candidates[0].url;
      }, "findProductUrl");
      const supplierProductId = getMappedValue("product_code") || rawRow._supplierProductId || "";
      const supplierSku = getMappedValue("supplier_sku") || rawRow._supplierSku || "";
      const productCode = supplierProductId || rawRow["Product ID"] || `PROD-${Date.now()}-${index}`;
      const priceStr = getMappedValue("price") || rawRow.Price || "";
      const price = parsePrice(priceStr);
      const primaryImages = getMappedValue("images") || rawRow.Images || "";
      const additionalImages = getMappedValue("additional_images") || "";
      const allImages = [primaryImages, additionalImages].filter((i) => i).join(",").split(/[,|||]+/).map((i) => i.trim()).filter((i) => i && i.startsWith("http"));
      const shippingCostValue = parsePrice(getMappedValue("shipping_cost") || "");
      return {
        productCode,
        supplierProductId,
        supplierSku,
        title: getMappedValue("product_name") || rawRow.Title || "Untitled Product",
        supplierPrice: price,
        yourPrice: calculateSellingPrice(price, shippingCostValue),
        listPrice: parsePrice(getMappedValue("list_price") || rawRow["List Price"] || ""),
        stock: parseInt(getMappedValue("quantity")) || 999,
        category: getMappedValue("category") || state.settings?.defaultCategory || "",
        description: getMappedValue("description") || rawRow.Description || "",
        shortDescription: getMappedValue("short_description") || "",
        images: allImages.length > 0 ? allImages.join(",") : "",
        supplierUrl: getMappedValue("url") || findProductUrl() || rawRow.URL || state.tabUrl,
        domain: state.tabDomain || new URL(state.tabUrl || "http://unknown").hostname,
        variants: getMappedValue("variants") || rawRow.Variants || rawRow.variants || "",
        color: getMappedValue("color") || "",
        size: getMappedValue("size") || "",
        shipping: getMappedValue("shipping") || rawRow.Shipping || "",
        shippingCost: shippingCostValue,
        brand: getMappedValue("brand") || rawRow.Brand || "",
        rating: getMappedValue("rating") || rawRow.Rating || "",
        reviewCount: getMappedValue("review_count") || rawRow.Reviews || rawRow["Review Count"] || "",
        soldCount: getMappedValue("sold_count") || rawRow["Sold"] || rawRow["Orders"] || "",
        reviews: getMappedValue("reviews") || rawRow.Reviews || rawRow.reviews || rawRow["Review Text"] || "",
        storeName: getMappedValue("store_name") || "",
        storeRating: getMappedValue("store_rating") || "",
        meta_keywords: getMappedValue("meta_keywords") || "",
        meta_description: getMappedValue("meta_description") || "",
        attributes: getMappedValue("attributes") || "",
        specifications: getMappedValue("specifications") || rawRow.Specifications || "",
        minOrder: getMappedValue("min_order") || "",
        videoUrls: getMappedValue("video_urls") || rawRow["Video URLs"] || "",
        fullDescription: getMappedValue("full_description") || rawRow["Full Description"] || ""
      };
    });
    chrome.runtime.sendMessage({ action: "saveToCatalog", products }, (response) => {
      if (response?.success) {
        showToast(`Added ${response.added} new, updated ${response.updated} existing products`, "success");
        loadCatalog();
      } else {
        showToast("Error saving to catalog: " + (response?.error || "Unknown"), "error");
      }
    });
  }
  function updateCatalogFromPage() {
    setStatus("Extracting product to update catalog...");
    const _doExtract = /* @__PURE__ */ __name(async () => {
      try {
        const up = await isBackendAvailable();
        if (up && state.tabUrl) {
          try {
            const r = await extractViaBackend(state.tabUrl);
            if (r && (r.title || r.productId))
              return r;
          } catch (e) {
            console.warn("[DropshipTracker] updateCatalog: backend failed, falling back:", e.message);
            resetBackendCache();
          }
        }
      } catch (e) {
      }
      return null;
    }, "_doExtract");
    _doExtract().then((backendResponse) => {
      if (backendResponse) {
        _processUpdateResponse(backendResponse);
        return;
      }
      sendToContentScript({ action: "extractProduct" }, (response) => {
        _processUpdateResponse(response);
      });
    });
  }
  function _processUpdateResponse(response) {
    if (!response || !response.productId && !response.title) {
      setStatus("Could not extract product data");
      showToast("No product data found. Make sure you're on a product page.", "error");
      return;
    }
    const matchedProduct = state.catalog.find(
      (p) => response.productId && p.productCode === response.productId || response.url && p.url === response.url || response.productId && p.productCode?.includes(response.productId)
    );
    if (!matchedProduct) {
      const possibleMatches = state.catalog.filter((p) => {
        if (!p.title || !response.title)
          return false;
        const pWords = p.title.toLowerCase().split(/\s+/);
        const rWords = response.title.toLowerCase().split(/\s+/);
        const common = pWords.filter((w) => rWords.includes(w) && w.length > 3);
        return common.length >= 2;
      });
      if (possibleMatches.length > 0) {
        const matchList = possibleMatches.slice(0, 3).map((p) => `\u2022 ${p.title?.substring(0, 50)}...`).join("\n");
        showToast(`Product not found in catalog by ID/URL.

Possible matches:
${matchList}

Use "Extract Product" to add as new.`, "warning");
      } else {
        showToast('Product not found in catalog. Use "Extract Product" to add it as new.', "warning");
      }
      setStatus("Product not in catalog");
      return;
    }
    const updates = {
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
      supplierPrice: response.price ? parsePrice(response.price) : matchedProduct.supplierPrice,
      lastChecked: Date.now(),
      lastEnriched: Date.now()
    };
    chrome.runtime.sendMessage({
      action: "updateCatalogProduct",
      productCode: matchedProduct.productCode,
      updates
    }, (result) => {
      if (result?.success) {
        showToast(`\u2713 Updated "${matchedProduct.title?.substring(0, 40)}..." with fresh data`, "success");
        setStatus(`Catalog item updated: ${response.images?.length || 0} images, ${response.variants?.length || 0} variants, ${response.reviews?.length || 0} reviews`);
        loadCatalog();
      } else {
        showToast("Failed to update catalog item: " + (result?.error || "Unknown error"), "error");
        setStatus("Update failed");
      }
    });
  }
  function scrapeProductDetails(rowIndex, onComplete) {
    const done = /* @__PURE__ */ __name((msg) => {
      if (msg)
        console.log("[DropshipTracker]", msg);
      if (typeof onComplete === "function")
        onComplete();
    }, "done");
    if (rowIndex < 0 || rowIndex >= state.catalog.length) {
      showToast("Invalid product row", "error");
      done("Invalid rowIndex");
      return;
    }
    const product = state.catalog[rowIndex];
    const productUrl = product.supplierUrl || product.url;
    if (!productUrl) {
      showToast("Product has no URL to scrape. Map a URL field when scraping.", "warning");
      done("No URL");
      return;
    }
    try {
      const urlObj = new URL(productUrl);
      if (!["http:", "https:"].includes(urlObj.protocol)) {
        showToast("Invalid product URL: " + productUrl.substring(0, 50), "warning");
        done("Invalid protocol");
        return;
      }
    } catch (e) {
      showToast("Malformed product URL: " + productUrl.substring(0, 50), "warning");
      done("Malformed URL");
      return;
    }
    isBackendAvailable().then(async (backendUp) => {
      if (backendUp) {
        try {
          setStatus(`Scraping via backend: ${product.title?.substring(0, 35)}...`);
          const response = await extractViaBackend(productUrl);
          if (response && (response.title || response.productId)) {
            _applyScrapedUpdates(response, product, rowIndex, done);
            return;
          }
        } catch (e) {
          console.warn("[DropshipTracker] scrapeProductDetails backend failed, opening tab:", e.message);
          resetBackendCache();
        }
      }
      _scrapeViaTab(productUrl, product, rowIndex, done);
    }).catch(() => _scrapeViaTab(productUrl, product, rowIndex, done));
  }
  function _scrapeViaTab(productUrl, product, rowIndex, done) {
    const ERROR_PAGE_PATTERNS = /^(HTTP\s*Status\s*\d|4\d{2}\s|5\d{2}\s|Access\s*Denied|Forbidden|Not\s*Found|Bad\s*Request|Service\s*Unavailable|Error|Page\s*Not\s*Found|Server\s*Error|Unauthorized)/i;
    setStatus(`Opening product page for scraping: ${product.title?.substring(0, 40)}...`);
    chrome.tabs.create({ url: productUrl, active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        showToast("Failed to open product page", "error");
        done("Tab create failed");
        return;
      }
      const tabId = tab.id;
      let completed = false;
      const finish = /* @__PURE__ */ __name((tabIdToClose) => {
        if (completed)
          return;
        completed = true;
        try {
          chrome.tabs.remove(tabIdToClose);
        } catch (e) {
        }
        done("Completed");
      }, "finish");
      const checkInterval = setInterval(() => {
        if (completed) {
          clearInterval(checkInterval);
          return;
        }
        chrome.tabs.get(tabId, (tabInfo) => {
          if (chrome.runtime.lastError || !tabInfo) {
            clearInterval(checkInterval);
            finish(tabId);
            return;
          }
          if (tabInfo.status === "complete") {
            clearInterval(checkInterval);
            if (tabInfo.title && ERROR_PAGE_PATTERNS.test(tabInfo.title.trim())) {
              showToast(`\u26A0 Skipped "${product.title?.substring(0, 25) || "product"}" \u2014 page returned: ${tabInfo.title.substring(0, 50)}. Check the product URL.`, "warning");
              setStatus("Product page error \u2014 URL may be invalid or expired");
              finish(tabId);
              return;
            }
            setTimeout(() => {
              if (completed)
                return;
              chrome.tabs.sendMessage(tabId, { action: "extractProduct" }, (response) => {
                if (chrome.runtime.lastError) {
                  showToast("Content script not loaded on product page. Try refreshing.", "warning");
                  finish(tabId);
                  return;
                }
                const title = response?.title || "";
                const isErrorPage = ERROR_PAGE_PATTERNS.test(title.trim());
                if (isErrorPage) {
                  showToast(`\u26A0 Error page detected for: ${product.title?.substring(0, 30)}...`, "warning");
                  setStatus("Error page \u2014 product not updated");
                  finish(tabId);
                  return;
                }
                if (response && (response.productId || response.title && response.title.length > 5)) {
                  _applyScrapedUpdates(response, product, rowIndex, () => finish(tabId));
                } else {
                  showToast("Could not extract product data from page", "warning");
                  finish(tabId);
                }
              });
            }, 3e3);
          }
        });
      }, 500);
      setTimeout(() => {
        if (!completed) {
          clearInterval(checkInterval);
          showToast("Product scraping timed out after 30s", "warning");
          setStatus("Scraping timed out");
          finish(tabId);
        }
      }, 3e4);
    });
  }
  function _applyScrapedUpdates(response, product, rowIndex, onDone) {
    const sanitized = typeof SanitizeService !== "undefined" ? SanitizeService.sanitizeProduct(response) : response;
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
      reviewCount: sanitized.reviewCount || sanitized.review_count || product.reviewCount || "",
      soldCount: sanitized.soldCount || sanitized.sold_count || sanitized.orders || product.soldCount || "",
      shipping: sanitized.shipping || product.shipping,
      brand: sanitized.brand || product.brand,
      sku: sanitized.sku || product.sku,
      category: sanitized.category || product.category,
      stock: sanitized.stock !== void 0 ? sanitized.stock : product.stock,
      weight: sanitized.weight || product.weight,
      metaKeywords: sanitized.metaKeywords || product.metaKeywords,
      metaDescription: sanitized.metaDescription || product.metaDescription,
      supplierPrice: sanitized.price ? parsePrice(sanitized.price) : product.supplierPrice,
      originalPrice: sanitized.originalPrice || product.originalPrice,
      currency: sanitized.currency || product.currency,
      videoUrls: sanitized.videoUrls || product.videoUrls || [],
      specifications: sanitized.specifications || product.specifications || [],
      storeName: sanitized.storeName || product.storeName,
      lastChecked: Date.now(),
      lastEnriched: Date.now()
    };
    const scrapedId = sanitized.productId || sanitized.sku || "";
    if (scrapedId && product.productCode && product.productCode.startsWith("PROD-")) {
      updates.supplierProductId = scrapedId;
      updates.productCode = scrapedId;
    }
    if (sanitized.url && product.supplierUrl) {
      const isSearchUrl = /\/search|\/wholesale|SearchText|SearchScene|page\?/i.test(product.supplierUrl);
      if (isSearchUrl)
        updates.supplierUrl = sanitized.url;
    }
    if (updates.supplierPrice && updates.supplierPrice !== product.supplierPrice) {
      updates.yourPrice = calculateSellingPrice(updates.supplierPrice, parsePrice(updates.shipping || ""));
    }
    chrome.runtime.sendMessage({
      action: "updateCatalogProduct",
      productCode: product.productCode,
      updates
    }, (resp) => {
      if (resp?.success) {
        Object.assign(state.catalog[rowIndex], updates);
        refreshCatalogTable();
        showToast(`\u2713 Scraped: ${sanitized.title?.substring(0, 30) || product.title?.substring(0, 30)}...`, "success");
        setStatus(`Updated \u2014 ${sanitized._source === "backend" ? "via Scrapling backend" : "via content script"}`);
      } else {
        showToast("Failed to save scraped details", "warning");
      }
      if (typeof onDone === "function")
        onDone();
    });
  }
  function scrapeSelectedProducts() {
    const selected = getSelectedCatalogRows();
    if (selected.length === 0) {
      showToast("No products selected. Click rows to select them first.", "warning");
      return;
    }
    if (selected.length > 10) {
      if (!confirm(`You are about to scrape ${selected.length} products. This will open each product page in sequence with a 5-second delay between each.

Continue?`)) {
        return;
      }
    }
    showToast(`Scraping ${selected.length} products sequentially...`, "info");
    setStatus(`Scraping 0/${selected.length} products...`);
    let currentIndex = 0;
    function scrapeNext() {
      if (currentIndex >= selected.length) {
        setStatus(`Completed scraping ${selected.length} products`);
        showToast(`\u2713 Finished scraping ${selected.length} products`, "success");
        return;
      }
      const rowIndex = selected[currentIndex];
      setStatus(`Scraping ${currentIndex + 1}/${selected.length}: ${state.catalog[rowIndex]?.title?.substring(0, 30)}...`);
      currentIndex++;
      scrapeProductDetails(rowIndex, () => {
        setTimeout(scrapeNext, 3e3);
      });
    }
    __name(scrapeNext, "scrapeNext");
    scrapeNext();
  }
  function deleteCatalogRow(rowIndex) {
    if (rowIndex < 0 || rowIndex >= state.catalog.length)
      return;
    const product = state.catalog[rowIndex];
    chrome.runtime.sendMessage({
      action: "removeFromCatalog",
      productCode: product.productCode
    }, () => {
      state.catalog.splice(rowIndex, 1);
      refreshCatalogTable();
      updateCatalogCount();
      showToast("Product deleted", "info");
    });
  }
  function deleteSelectedProducts() {
    if (state.selectedProducts.length === 0)
      return;
    if (!confirm(`Delete ${state.selectedProducts.length} selected products?`))
      return;
    chrome.runtime.sendMessage({
      action: "deleteCatalogProducts",
      productCodes: state.selectedProducts
    }, (response) => {
      if (response?.success) {
        showToast(`Deleted ${response.deleted} products`, "success");
        loadCatalog();
      }
    });
  }
  function clearEntireCatalog() {
    if (state.catalog.length === 0) {
      showToast("Catalog is already empty", "info");
      return;
    }
    if (!confirm(`Delete all ${state.catalog.length} products from catalog? This cannot be undone.`)) {
      return;
    }
    chrome.runtime.sendMessage({ action: "clearCatalog" }, (response) => {
      if (response?.success) {
        state.catalog = [];
        refreshCatalogTable();
        updateCatalogCount();
        showToast("Catalog cleared", "success");
      } else {
        showToast("Failed to clear catalog", "error");
      }
    });
  }
  function updateCatalogProduct(productCode, updates) {
    chrome.runtime.sendMessage({
      action: "updateCatalogProduct",
      productCode,
      updates
    });
  }
  function checkPrices() {
    showToast("Price checking would require visiting each supplier URL. Use the scraper on supplier pages to update prices.", "info");
  }
  var init_catalog = __esm({
    "src/popup/catalog.js"() {
      init_state();
      init_utils();
      init_backendClient();
      init_catalogTable();
      __name(loadCatalog, "loadCatalog");
      __name(addToCatalog, "addToCatalog");
      __name(updateCatalogFromPage, "updateCatalogFromPage");
      __name(_processUpdateResponse, "_processUpdateResponse");
      __name(scrapeProductDetails, "scrapeProductDetails");
      __name(_scrapeViaTab, "_scrapeViaTab");
      __name(_applyScrapedUpdates, "_applyScrapedUpdates");
      __name(scrapeSelectedProducts, "scrapeSelectedProducts");
      __name(deleteCatalogRow, "deleteCatalogRow");
      __name(deleteSelectedProducts, "deleteSelectedProducts");
      __name(clearEntireCatalog, "clearEntireCatalog");
      __name(updateCatalogProduct, "updateCatalogProduct");
      __name(checkPrices, "checkPrices");
    }
  });

  // src/popup/preview.js
  function previewScrapedRow(rowIndex) {
    if (rowIndex < 0 || rowIndex >= state.data.length)
      return;
    const row = state.data[rowIndex];
    const rawRow = state.rawData[rowIndex] || {};
    const combined = { ...rawRow, ...row };
    state.previewContext = { type: "scraped", index: rowIndex };
    $("#previewModalTitle").text(combined.Title || combined.title || combined["Product Name"] || `Row ${rowIndex + 1}`);
    const imageUrl = combined.Image || combined.image || combined.images?.[0] || "";
    if (imageUrl && typeof imageUrl === "string" && imageUrl.startsWith("http")) {
      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = "Product";
      $("#previewImage").empty().append(img);
    } else {
      $("#previewImage").html('<div class="text-muted text-center"><span class="glyphicon glyphicon-picture" style="font-size:60px;color:#ccc;"></span><br>No image</div>');
    }
    const images = combined.images || [];
    if (images.length > 1) {
      const $gallery = $("#previewGallery").empty();
      images.slice(0, 10).forEach((imgUrl, i) => {
        if (typeof imgUrl === "string" && imgUrl.startsWith("http")) {
          const img = document.createElement("img");
          img.src = imgUrl;
          img.alt = "Image " + (i + 1);
          if (i === 0)
            img.className = "active";
          $gallery.append(img);
        }
      });
    } else {
      $("#previewGallery").empty();
    }
    let detailsHtml = "";
    const skipFields = ["images", "image", "_element", "_html"];
    Object.entries(combined).forEach(([key, value]) => {
      if (skipFields.includes(key.toLowerCase()) || !value)
        return;
      let displayValue = value;
      if (Array.isArray(value)) {
        displayValue = value.length + " items";
      } else if (typeof value === "object") {
        displayValue = JSON.stringify(value).substring(0, 100) + "...";
      }
      const isPrice = key.toLowerCase().includes("price");
      detailsHtml += `<div class="detail-row">
      <span class="detail-label">${key}:</span>
      <span class="detail-value${isPrice ? " price" : ""}">${displayValue}</span>
    </div>`;
    });
    $("#previewDetails").html(detailsHtml || '<p class="text-muted">No details available</p>');
    const url = combined.url || combined.URL || combined.Link || state.tabUrl;
    if (url) {
      $("#previewSourceLink").attr("href", url).show();
    } else {
      $("#previewSourceLink").hide();
    }
    $("#previewModal").modal("show");
  }
  function previewCatalogRow(rowIndex) {
    if (rowIndex < 0 || rowIndex >= state.catalog.length)
      return;
    const product = state.catalog[rowIndex];
    state.previewContext = { type: "catalog", index: rowIndex, productCode: product.productCode };
    $("#previewModalTitle").text(product.title || product.productCode);
    let images = product.images || [];
    if (typeof images === "string") {
      images = images.split(",").map((i) => i.trim()).filter((i) => i && i.startsWith("http"));
    }
    if (images.length > 0 && typeof images[0] === "string" && images[0].startsWith("http")) {
      const img = document.createElement("img");
      img.src = images[0];
      img.alt = "Product";
      $("#previewImage").empty().append(img);
    } else {
      $("#previewImage").html('<div class="text-muted text-center"><span class="glyphicon glyphicon-picture" style="font-size:60px;color:#ccc;"></span><br>No image</div>');
    }
    if (images.length > 1) {
      const $gallery = $("#previewGallery").empty();
      images.slice(0, 10).forEach((imgUrl, i) => {
        if (typeof imgUrl === "string" && imgUrl.startsWith("http")) {
          const img = document.createElement("img");
          img.src = imgUrl;
          img.alt = "Image " + (i + 1);
          if (i === 0)
            img.className = "active";
          $gallery.append(img);
        }
      });
    } else {
      $("#previewGallery").empty();
    }
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
      <span class="detail-value">${product.domain || "Unknown"}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Stock:</span>
      <span class="detail-value">${product.stock || "Unknown"}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Added:</span>
      <span class="detail-value">${product.addedDate ? new Date(product.addedDate).toLocaleString() : "Unknown"}</span>
    </div>
  `;
    if (product.rating) {
      detailsHtml += `<div class="detail-row">
      <span class="detail-label">Rating:</span>
      <span class="detail-value">\u2B50 ${product.rating}</span>
    </div>`;
    }
    if (product.reviewCount || product.review_count) {
      detailsHtml += `<div class="detail-row">
      <span class="detail-label">Reviews:</span>
      <span class="detail-value">${product.reviewCount || product.review_count} reviews</span>
    </div>`;
    }
    if (product.soldCount || product.sold_count) {
      detailsHtml += `<div class="detail-row">
      <span class="detail-label">Sold:</span>
      <span class="detail-value">${product.soldCount || product.sold_count} units</span>
    </div>`;
    }
    if (product.storeName) {
      detailsHtml += `<div class="detail-row">
      <span class="detail-label">Store:</span>
      <span class="detail-value">${product.storeName}${product.storeRating ? ` (${product.storeRating})` : ""}</span>
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
    $("#previewDetails").html(detailsHtml);
    const productUrl = product.supplierUrl || product.url;
    if (productUrl) {
      $("#previewSourceLink").attr("href", productUrl).show();
    } else {
      $("#previewSourceLink").hide();
    }
    $("#previewModal").modal("show");
  }
  function deleteScrapedRow(rowIndex) {
    if (rowIndex < 0 || rowIndex >= state.data.length)
      return;
    state.data.splice(rowIndex, 1);
    state.rawData.splice(rowIndex, 1);
    updateDataTable(state.data);
    updateExportButtons();
    $("#rowCount").text(state.data.length);
    saveScrapedData();
    showToast("Row deleted", "info");
  }
  function deletePreviewedItem() {
    if (!state.previewContext)
      return;
    if (state.previewContext.type === "scraped") {
      deleteScrapedRow(state.previewContext.index);
    } else if (state.previewContext.type === "catalog") {
      deleteCatalogRow(state.previewContext.index);
    }
    $("#previewModal").modal("hide");
  }
  var init_preview = __esm({
    "src/popup/preview.js"() {
      init_state();
      init_utils();
      init_dataTable();
      init_persistence();
      init_catalog();
      __name(previewScrapedRow, "previewScrapedRow");
      __name(previewCatalogRow, "previewCatalogRow");
      __name(deleteScrapedRow, "deleteScrapedRow");
      __name(deletePreviewedItem, "deletePreviewedItem");
    }
  });

  // src/popup/fieldMapping.js
  function showFieldMapping() {
    if (state.fieldNames.length === 0)
      return;
    const $grid = $("#fieldMappingGrid").empty();
    const smartNames = state.smartNames || {};
    state.fieldNames.forEach((field, index) => {
      const displayName = smartNames[field] || getShortFieldName(field);
      let mappedValue = state.fieldMapping[field];
      if (!mappedValue) {
        mappedValue = autoDetectMapping(displayName);
        state.fieldMapping[field] = mappedValue;
      }
      const $row = $(`
      <div class="mapping-row">
        <span class="source-field" title="${field}">${displayName}</span>
        <span class="arrow">\u2192</span>
        <select class="form-control input-sm" data-field="${field}">
          ${EXPORT_FIELDS.map(
        (f) => `<option value="${f.id}" ${f.id === mappedValue ? "selected" : ""}>${f.label}</option>`
      ).join("")}
        </select>
      </div>
    `);
      $row.find("select").on("change", function() {
        const newValue = $(this).val();
        state.fieldMapping[$(this).data("field")] = newValue;
        savePersistedFieldMapping();
      });
      $grid.append($row);
    });
    const selectedTemplate = $("#cartTemplateSelect").val() || "export";
    const templateNames = { cscart: "CS-Cart", shopify: "Shopify", woocommerce: "WooCommerce", prestashop: "PrestaShop", magento: "Magento", bigcommerce: "BigCommerce" };
    const templateLabel = templateNames[selectedTemplate] || "Export";
    $("#mappingHeaderText").text("Map Fields for " + templateLabel);
    $("#fieldMappingSection").slideDown();
    savePersistedFieldMapping();
  }
  function autoDetectMapping(fieldName) {
    const lower = fieldName.toLowerCase();
    if ((lower.includes("price") || lower.includes("cost")) && !lower.includes("list") && !lower.includes("original") && !lower.includes("was"))
      return "price";
    if (lower.includes("list") && lower.includes("price"))
      return "list_price";
    if (lower.includes("original") && lower.includes("price"))
      return "list_price";
    if (lower.includes("was") && lower.includes("price"))
      return "list_price";
    if (lower.includes("msrp"))
      return "list_price";
    if (lower.includes("title") || lower.includes("name") && lower.includes("product"))
      return "product_name";
    if (lower === "name" || lower === "title")
      return "product_name";
    if (lower === "product id" || lower === "product_id")
      return "product_code";
    if (lower.includes("item") && lower.includes("id"))
      return "product_code";
    if (lower.includes("product") && lower.includes("id"))
      return "product_code";
    if (lower.includes("sku"))
      return "supplier_sku";
    if (lower.includes("code") || lower.includes("_id"))
      return "product_code";
    if (lower.includes("img") || lower.includes("image") || lower.includes("@src")) {
      if (lower.includes("additional") || lower.includes("gallery") || lower.includes("thumb")) {
        return "additional_images";
      }
      return "images";
    }
    if (lower.includes("desc")) {
      if (lower.includes("short") || lower.includes("brief"))
        return "short_description";
      return "description";
    }
    if (lower.includes("stock") || lower.includes("qty") || lower.includes("quantity") || lower.includes("inventory"))
      return "quantity";
    if (lower.includes("category") || lower.includes("cat"))
      return "category";
    if (lower.includes("weight"))
      return "weight";
    if (lower.includes("brand") || lower.includes("manufacturer"))
      return "brand";
    if (lower.includes("href") || lower.includes("url") || lower.includes("link"))
      return "url";
    if (lower.includes("ship") || lower.includes("delivery") || lower.includes("freight")) {
      if (lower.includes("cost") || lower.includes("fee") || lower.includes("price"))
        return "shipping_cost";
      return "shipping";
    }
    if (lower.includes("variant") || lower.includes("option"))
      return "variants";
    if (lower.includes("color") || lower.includes("colour"))
      return "color";
    if (lower.includes("size"))
      return "size";
    if (lower.includes("review")) {
      if (lower.includes("count") || lower.includes("num"))
        return "review_count";
      return "reviews";
    }
    if (lower.includes("rating") || lower.includes("star"))
      return "rating";
    if (lower.includes("sold") || lower.includes("order"))
      return "sold_count";
    if (lower.includes("store") || lower.includes("seller") || lower.includes("shop")) {
      if (lower.includes("rating") || lower.includes("score"))
        return "store_rating";
      return "store_name";
    }
    if (lower.includes("attr") || lower.includes("spec") || lower.includes("feature")) {
      if (lower.includes("spec"))
        return "specifications";
      return "attributes";
    }
    if (lower.includes("min") && (lower.includes("order") || lower.includes("qty")))
      return "min_order";
    return "";
  }
  function autoMapFields() {
    $("#fieldMappingGrid select").each(function() {
      const field = $(this).data("field");
      const shortName = getShortFieldName(field);
      const mapped = autoDetectMapping(shortName);
      $(this).val(mapped);
      state.fieldMapping[field] = mapped;
    });
    savePersistedFieldMapping();
    showToast("Fields auto-mapped based on names", "success");
  }
  var EXPORT_FIELDS;
  var init_fieldMapping = __esm({
    "src/popup/fieldMapping.js"() {
      init_state();
      init_utils();
      init_persistence();
      EXPORT_FIELDS = [
        { id: "", label: "-- Ignore --" },
        { id: "product_code", label: "Product ID * (Supplier Item #)", required: true },
        { id: "supplier_sku", label: "SKU (Optional Supplier Code)" },
        { id: "product_name", label: "Product Name *", required: true },
        { id: "price", label: "Price *", required: true },
        { id: "list_price", label: "Original / List Price" },
        { id: "quantity", label: "Quantity / Stock" },
        { id: "category", label: "Category" },
        { id: "description", label: "Full Description" },
        { id: "short_description", label: "Short Description" },
        { id: "images", label: "Images (Primary)" },
        { id: "additional_images", label: "Additional Images" },
        { id: "weight", label: "Weight" },
        { id: "brand", label: "Brand / Manufacturer" },
        { id: "url", label: "Supplier URL" },
        { id: "shipping", label: "Shipping Info" },
        { id: "shipping_cost", label: "Shipping Cost" },
        { id: "variants", label: "Variants / Options" },
        { id: "color", label: "Color Option" },
        { id: "size", label: "Size Option" },
        { id: "reviews", label: "Reviews Text" },
        { id: "rating", label: "Rating (Stars)" },
        { id: "review_count", label: "Review Count" },
        { id: "sold_count", label: "Units Sold / Orders" },
        { id: "meta_keywords", label: "Meta Keywords" },
        { id: "meta_description", label: "Meta Description" },
        { id: "attributes", label: "Product Attributes" },
        { id: "specifications", label: "Specifications" },
        { id: "min_order", label: "Minimum Order" },
        { id: "store_name", label: "Store / Seller Name" },
        { id: "store_rating", label: "Store Rating" },
        { id: "video_urls", label: "Video URLs" },
        { id: "full_description", label: "Full Description (HTML)" },
        { id: "currency", label: "Currency" },
        { id: "availability", label: "Availability" }
      ];
      __name(showFieldMapping, "showFieldMapping");
      __name(autoDetectMapping, "autoDetectMapping");
      __name(autoMapFields, "autoMapFields");
    }
  });

  // src/popup/scraper.js
  var scraper_exports = {};
  __export(scraper_exports, {
    clearAllScrapedData: () => clearAllScrapedData,
    crawlNextPage: () => crawlNextPage,
    extractProduct: () => extractProduct,
    findTables: () => findTables,
    getTableData: () => getTableData,
    handleSelectorPickerResult: () => handleSelectorPickerResult,
    locateNextButton: () => locateNextButton,
    nextTable: () => nextTable,
    processScrapedData: () => processScrapedData,
    renderTestDiagnostic: () => renderTestDiagnostic,
    startCrawl: () => startCrawl,
    startPickSelector: () => startPickSelector,
    stopCrawl: () => stopCrawl,
    testScrape: () => testScrape,
    waitForNetworkIdle: () => waitForNetworkIdle
  });
  function handleSelectorPickerResult(message) {
    if (message.success) {
      state.customSelectors[message.field] = {
        selector: message.selector,
        sampleValue: message.sampleValue,
        savedAt: Date.now()
      };
      saveCustomSelectors();
      updateCustomSelectorsList();
      showToast(`\u2713 Selector saved for "${message.field}": ${message.sampleValue?.substring(0, 50)}...`, "success");
    } else if (message.cancelled) {
      showToast("Selector picking cancelled", "info");
    }
  }
  function startPickSelector() {
    const fieldOptions = EXPORT_FIELDS.filter((f) => f.id).map((f) => `<option value="${f.id}">${f.label}</option>`).join("");
    const modal = `
    <div id="pickSelectorModal" class="modal fade" tabindex="-1">
      <div class="modal-dialog modal-sm">
        <div class="modal-content">
          <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal">&times;</button>
            <h4 class="modal-title">\u{1F3AF} Pick Element Selector</h4>
          </div>
          <div class="modal-body">
            <p>Select the field you want to define a custom selector for:</p>
            <select id="pickerFieldSelect" class="form-control">
              ${fieldOptions}
            </select>
            <div class="alert alert-info" style="margin-top:12px;font-size:12px;padding:8px;">
              <strong>Works on any page!</strong><br>
              \u2022 <strong>List pages:</strong> Improves table scraping<br>
              \u2022 <strong>Product pages:</strong> Used by Extract Product<br>
              <hr style="margin:6px 0;">
              Hover over elements to preview, click to select. Press <kbd>ESC</kbd> to cancel.
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="startPickingBtn">\u{1F3AF} Start Picking</button>
          </div>
        </div>
      </div>
    </div>
  `;
    $("#pickSelectorModal").remove();
    $("body").append(modal);
    $("#startPickingBtn").on("click", function() {
      const field = $("#pickerFieldSelect").val();
      if (!field) {
        showToast("Please select a field", "warning");
        return;
      }
      $("#pickSelectorModal").modal("hide");
      sendToContentScript({ action: "startSelectorPicker", field }, (response) => {
        if (response && response.started) {
          showToast(`Picker active for "${field}". Click element on page or ESC to cancel.`, "info");
        } else {
          showToast("Failed to start selector picker. Reload the page and try again.", "danger");
        }
      });
    });
    $("#pickSelectorModal").modal("show");
  }
  function findTables() {
    setStatus("Scanning page for data tables...");
    sendToContentScript({ action: "findTables" }, (response) => {
      if (response && response.tableCount > 0) {
        setStatus(`Found ${response.tableCount} potential data tables`);
        $("#tableCounter").text(`1/${response.tableCount}`);
        $("#nextTableBtn").prop("disabled", response.tableCount <= 1);
        state.tableSelector = response.selector;
        getTableData();
      } else {
        setStatus("No data tables found on this page");
        showToast("No tables found. Try a different page or use Extract Product for single items.", "warning");
      }
    });
  }
  function nextTable() {
    sendToContentScript({ action: "nextTable" }, (response) => {
      if (response && !response.error) {
        $("#tableCounter").text(`${response.currentTable + 1}/${response.tableCount}`);
        state.tableSelector = response.selector;
        getTableData();
      }
    });
  }
  function getTableData() {
    setStatus("Extracting data...");
    sendToContentScript({ action: "getTableData", selector: state.tableSelector }, (response) => {
      if (response && response.data && response.data.length > 0) {
        processScrapedData(response.data);
        setStatus(`Extracted ${response.data.length} rows`);
        updateRowCount(response.data.length);
        $("#crawlBtn").prop("disabled", false);
        $("#addToCatalogBtn").prop("disabled", false);
        updateExportButtons();
        showFieldMapping();
      } else {
        setStatus("No data extracted from table");
      }
    });
  }
  function extractProduct() {
    setStatus("Extracting product details...");
    showLoading("Extracting product details...");
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabUrl = tabs?.[0]?.url ?? "";
      let usedBackend = false;
      try {
        const backendUp = await isBackendAvailable();
        if (backendUp && tabUrl) {
          try {
            const backendResponse = await extractViaBackend(tabUrl);
            if (backendResponse && (backendResponse.title || backendResponse.productId)) {
              usedBackend = true;
              console.log("[DropshipTracker] Product extracted via Scrapling backend");
              _handleExtractedProduct(backendResponse);
              return;
            }
          } catch (backendErr) {
            console.warn("[DropshipTracker] Backend extraction failed, falling back to content script:", backendErr.message);
            resetBackendCache();
          }
        }
      } catch (probeErr) {
        console.warn("[DropshipTracker] Backend probe error:", probeErr.message);
      }
      if (!usedBackend) {
        sendToContentScript({ action: "extractProduct" }, (response) => {
          if (response && (response.title || response.productId)) {
            _handleExtractedProduct(response);
          } else {
            setStatus("Could not extract product details");
            showToast("No product data found. Make sure you're on a product page.", "warning");
            hideLoading();
          }
        });
      }
    });
  }
  function _handleExtractedProduct(response) {
    const sanitized = typeof SanitizeService !== "undefined" ? SanitizeService.sanitizeProduct(response) : response;
    const row = {
      "Product ID": sanitized.productId || "",
      "Title": sanitized.title || "",
      "Price": sanitized.price || "",
      "Original Price": sanitized.originalPrice || "",
      "Currency": sanitized.currency || "USD",
      "Short Description": sanitized.shortDescription || "",
      "Description": sanitized.descriptionText || sanitized.description || "",
      "Full Description": sanitized.fullDescription || "",
      "Category": sanitized.category || "",
      "Images": (sanitized.images || []).join("|||"),
      "URL": sanitized.url || "",
      "Domain": sanitized.domain || "",
      "Variants": JSON.stringify(sanitized.variants || []),
      "Variant Groups": JSON.stringify(sanitized.variantGroups || []),
      "Reviews": JSON.stringify(sanitized.reviews || []),
      "Rating": sanitized.rating || "",
      "Review Count": sanitized.reviewCount || "",
      "Sold": sanitized.soldCount || sanitized.orders || "",
      "Brand": sanitized.brand || "",
      "SKU": sanitized.sku || "",
      "Stock": sanitized.stock || "",
      "Availability": sanitized.availability || "",
      "Weight": sanitized.weight || "",
      "Shipping": sanitized.shippingText || sanitized.shipping || "",
      "Shipping Cost": sanitized.shippingCost || "",
      "Store": sanitized.storeName || "",
      "Store Rating": sanitized.storeRating || "",
      "Min Order": sanitized.minOrder || "",
      "Video URLs": (sanitized.videoUrls || []).join("|||"),
      "Specifications": JSON.stringify(sanitized.specifications || []),
      "Meta Keywords": sanitized.metaKeywords || "",
      "Meta Description": sanitized.metaDescription || sanitized.shortDescription || ""
    };
    const existingIndex = state.rawData.findIndex(
      (r) => r.productId && r.productId === response.productId || r.url && r.url === response.url
    );
    if (existingIndex >= 0) {
      state.rawData[existingIndex] = { ...state.rawData[existingIndex], ...response };
      state.data[existingIndex] = { ...state.data[existingIndex], ...row };
      showToast(`Updated existing product: ${response.title?.substring(0, 40)}...`, "success");
    } else {
      state.rawData.push(response);
      state.data.push(row);
      showToast(`Added product: ${response.title?.substring(0, 40)}...`, "success");
    }
    Object.keys(row).forEach((key) => {
      if (!state.fieldNames.includes(key)) {
        state.fieldNames.push(key);
      }
    });
    updateDataTable(state.data);
    setStatus(`${state.data.length} products in scraper`);
    updateRowCount(state.data.length);
    $("#addToCatalogBtn").prop("disabled", false);
    updateExportButtons();
    showFieldMapping();
    saveScrapedData();
    hideLoading();
  }
  function processScrapedData(rawData) {
    console.log("[DropshipTracker] Processing scraped data:", rawData.length, "rows");
    state.rawData = rawData;
    const fieldCounts = {};
    rawData.forEach((row) => {
      Object.keys(row).forEach((key) => {
        if (row[key] && !key.startsWith("_")) {
          fieldCounts[key] = (fieldCounts[key] || 0) + 1;
        }
      });
    });
    console.log("[DropshipTracker] Field counts:", Object.keys(fieldCounts).length, "unique fields");
    const threshold = Math.max(1, rawData.length * FIELD_THRESHOLD);
    let allGoodFields = Object.entries(fieldCounts).filter(([_, count]) => count >= threshold).sort((a, b) => b[1] - a[1]).map(([field]) => field);
    const valueFingerprints = {};
    allGoodFields.forEach((field) => {
      const values = [];
      for (let i = 0; i < Math.min(rawData.length, 20); i++) {
        const v = rawData[i][field];
        if (v !== void 0 && v !== null && v !== "") {
          values.push(String(v).trim().substring(0, 100));
        }
      }
      const fingerprint = values.join("||||");
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
    allGoodFields = allGoodFields.filter((f) => dedupedFields.has(f));
    if (beforeDedup !== allGoodFields.length) {
      console.log(`[DropshipTracker] Column dedup: ${beforeDedup} \u2192 ${allGoodFields.length} fields`);
    }
    console.log("[DropshipTracker] Good fields after threshold + dedup:", allGoodFields.length);
    const beforeNoise = allGoodFields.length;
    allGoodFields = filterNoiseColumns(allGoodFields, rawData);
    if (beforeNoise !== allGoodFields.length) {
      console.log(`[DropshipTracker] Noise filter: ${beforeNoise} \u2192 ${allGoodFields.length} fields`);
    }
    state.allFieldNames = allGoodFields;
    const maxCols = state.showAllColumns ? MAX_COLUMNS_EXPANDED : MAX_VISIBLE_COLUMNS;
    state.fieldNames = allGoodFields.slice(0, maxCols);
    console.log("[DropshipTracker] Visible fields:", state.fieldNames.length);
    updateExpandToggle();
    const smartNames = buildSmartColumnNames(state.fieldNames);
    state.smartNames = smartNames;
    const displayData = rawData.map((row) => {
      const displayRow = {};
      state.fieldNames.forEach((field) => {
        const friendlyName = smartNames[field] || getShortFieldName(field);
        displayRow[friendlyName] = row[field] || "";
      });
      return displayRow;
    });
    console.log("[DropshipTracker] Display data sample:", displayData[0]);
    state.data = displayData;
    updateDataTable(displayData);
    showFieldMapping();
    saveScrapedData();
  }
  function locateNextButton() {
    setStatus('Click on the "Next" button on the page...');
    showToast('Click on the pagination "Next" button on the page', "info");
    sendToContentScript({ action: "selectNextButton" }, (response) => {
      if (response && response.selector) {
        state.nextSelector = response.selector;
        $("#nextSelectorInput").val(response.selector);
        $("#crawlBtn").prop("disabled", false);
        setStatus("Next button located");
        showToast('Next button selected! Click "Crawl" to start pagination.', "success");
      }
    });
  }
  function startCrawl() {
    if (!state.nextSelector) {
      showToast('Please locate the "Next" button first', "warning");
      return;
    }
    state.scraping = true;
    state.pages = 1;
    state.visitedHashes = [];
    $("#crawlBtn").prop("disabled", true);
    $("#stopCrawlBtn").prop("disabled", false);
    $("#findTablesBtn").prop("disabled", true);
    setStatus("Crawling... Page 1");
    crawlNextPage();
  }
  function crawlNextPage() {
    if (!state.scraping)
      return;
    sendToContentScript({ action: "getPageHash" }, (hashResponse) => {
      if (hashResponse && hashResponse.hash) {
        const hashes = state.visitedHashes;
        const h = hashResponse.hash;
        if (hashes.length >= 1 && hashes[hashes.length - 1] === h || hashes.length >= 2 && hashes[hashes.length - 2] === h) {
          setStatus("Reached end (duplicate page detected)");
          stopCrawl();
          return;
        }
        state.visitedHashes.push(h);
      }
      sendToContentScript({ action: "getTableData", selector: state.tableSelector }, (dataResponse) => {
        if (dataResponse && dataResponse.data) {
          state.rawData = deduplicateRows(state.rawData.concat(dataResponse.data));
          processScrapedData(state.rawData);
          updateRowCount(state.rawData.length);
          updatePageCount(state.pages);
        }
        waitForNetworkIdle(
          (done) => {
            sendToContentScript({ action: "clickNext", selector: state.nextSelector }, (clickResponse) => {
              if (clickResponse && clickResponse.success) {
                state.pages++;
                setStatus(`Crawling... Page ${state.pages}`);
                done();
              } else {
                setStatus("Reached end (no more pages)");
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
  function stopCrawl() {
    state.scraping = false;
    $("#crawlBtn").prop("disabled", false);
    $("#stopCrawlBtn").prop("disabled", true);
    $("#findTablesBtn").prop("disabled", false);
    setStatus(`Crawl complete. ${state.rawData.length} rows from ${state.pages} pages.`);
    showToast(`Scraped ${state.rawData.length} items from ${state.pages} pages`, "success");
  }
  function waitForNetworkIdle(actionFn, callback) {
    const tabId = state.tabId;
    const crawlDelay = state.settings?.crawlDelay || 2e3;
    const maxWait = state.settings?.maxWait || 5e3;
    const minIdleGap = 100;
    const pendingRequests = {};
    let lastRequestTime = null;
    let settled = false;
    let idleCheckEnabled = false;
    const filter = {
      urls: ["<all_urls>"],
      tabId,
      types: ["main_frame", "sub_frame", "stylesheet", "script", "font", "object", "xmlhttprequest", "other"]
    };
    function finish() {
      if (settled)
        return;
      settled = true;
      try {
        chrome.webRequest.onBeforeRequest.removeListener(onBefore);
        chrome.webRequest.onCompleted.removeListener(onDone);
        chrome.webRequest.onErrorOccurred.removeListener(onDone);
      } catch (e) {
      }
      callback();
    }
    __name(finish, "finish");
    function trySettle() {
      if (settled || !idleCheckEnabled)
        return;
      if (lastRequestTime && Date.now() - lastRequestTime < minIdleGap) {
        setTimeout(trySettle, minIdleGap);
        return;
      }
      if (Object.keys(pendingRequests).length > 0)
        return;
      chrome.tabs.sendMessage(tabId, { action: "ping" }, (resp) => {
        if (resp !== void 0) {
          finish();
        } else {
          setTimeout(trySettle, minIdleGap);
        }
      });
    }
    __name(trySettle, "trySettle");
    function onBefore(details) {
      pendingRequests[details.requestId] = 1;
      lastRequestTime = Date.now();
    }
    __name(onBefore, "onBefore");
    function onDone(details) {
      delete pendingRequests[details.requestId];
      if (lastRequestTime && Object.keys(pendingRequests).length === 0) {
        setTimeout(trySettle, minIdleGap);
      }
    }
    __name(onDone, "onDone");
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
  function testScrape() {
    $("#testScrapeLoading").show();
    $("#testScrapeResults").hide();
    $("#testScrapeModal").modal("show");
    let productResult = null;
    let tableResult = null;
    const timeout = setTimeout(() => {
      console.warn("[DropshipTracker] Test scrape timed out");
      renderTestDiagnostic(productResult, tableResult);
    }, 15e3);
    sendToContentScript({ action: "extractProduct" }, (response) => {
      productResult = response;
      sendToContentScript({ action: "getTableData", selector: state.tableSelector || "" }, (response2) => {
        tableResult = response2;
        clearTimeout(timeout);
        renderTestDiagnostic(productResult, tableResult);
      });
    });
  }
  function renderTestDiagnostic(product, table) {
    $("#testScrapeLoading").hide();
    $("#testScrapeResults").show();
    const criticalFields = [
      { key: "title", label: "Title" },
      { key: "price", label: "Price" },
      { key: "originalPrice", label: "Original Price" },
      { key: "currency", label: "Currency" },
      { key: "images", label: "Images", format: (v) => Array.isArray(v) ? `${v.length} images` : "none" },
      { key: "rating", label: "Rating" },
      { key: "reviewCount", label: "Review Count" },
      { key: "soldCount", label: "Sold / Orders" },
      { key: "description", label: "Description", format: (v) => v ? `${String(v).length} chars` : "none" },
      { key: "category", label: "Category" },
      { key: "brand", label: "Brand" },
      { key: "sku", label: "SKU (Supplier Code)" },
      { key: "stock", label: "Stock" },
      { key: "weight", label: "Weight" },
      { key: "shipping", label: "Shipping" },
      { key: "storeName", label: "Store Name" },
      { key: "specifications", label: "Specs", format: (v) => Array.isArray(v) ? `${v.length} specs` : v ? "yes" : "none" },
      { key: "variants", label: "Variants", format: (v) => Array.isArray(v) ? `${v.length} variants` : "none" }
    ];
    let html = "<thead><tr><th>Field</th><th>Status</th><th>Value</th></tr></thead><tbody>";
    let found = 0;
    for (const f of criticalFields) {
      const val = product ? product[f.key] : null;
      const hasValue = val !== null && val !== void 0 && val !== "" && !(Array.isArray(val) && val.length === 0);
      const display = hasValue ? f.format ? f.format(val) : String(val).substring(0, 80) : "";
      const icon = hasValue ? '<span class="glyphicon glyphicon-ok text-success"></span>' : '<span class="glyphicon glyphicon-remove text-danger"></span>';
      if (hasValue)
        found++;
      html += `<tr><td>${f.label}</td><td>${icon}</td><td><small>${display}</small></td></tr>`;
    }
    html += "</tbody>";
    $("#testProductTable").html(html);
    let tableSummary = "";
    if (table && table.data && table.data.length > 0) {
      const sampleRow = table.data[0];
      const cols = Object.keys(sampleRow);
      tableSummary = `<p><strong>${table.data.length}</strong> rows, <strong>${cols.length}</strong> columns</p>`;
      tableSummary += '<ul class="list-unstyled" style="max-height:150px;overflow:auto;">';
      for (const col of cols) {
        const sampleVal = sampleRow[col] || "";
        tableSummary += `<li><small><strong>${col}:</strong> ${String(sampleVal).substring(0, 60)}</small></li>`;
      }
      tableSummary += "</ul>";
    } else {
      tableSummary = '<p class="text-muted">No table detected. Click "Find Tables" first.</p>';
    }
    $("#testTableSummary").html(tableSummary);
    const pct = Math.round(found / criticalFields.length * 100);
    const color = pct >= 70 ? "success" : pct >= 40 ? "warning" : "danger";
    let scoreHtml = `<div class="text-${color}"><strong>${found}/${criticalFields.length} fields extracted (${pct}%)</strong></div>`;
    scoreHtml += `<div class="progress" style="margin-top:5px;"><div class="progress-bar progress-bar-${color}" style="width:${pct}%"></div></div>`;
    if (pct < 70) {
      scoreHtml += '<p class="text-muted" style="margin-top:5px;"><small>Tip: Try "Extract Product" on a product detail page. Use "Pick Selector" to map missing fields manually.</small></p>';
    }
    $("#testScrapeScore").html(scoreHtml);
    const jsonFields = [
      "title",
      "price",
      "originalPrice",
      "currency",
      "sku",
      "rating",
      "reviewCount",
      "brand",
      "category",
      "stock",
      "shipping",
      "orders"
    ];
    const jsonData = {};
    for (const k of jsonFields) {
      if (product && product[k] !== null && product[k] !== void 0) {
        jsonData[k] = product[k];
      }
    }
    $("#testJsonRaw").text(JSON.stringify(jsonData, null, 2));
  }
  function clearAllScrapedData() {
    if (state.data.length === 0) {
      showToast("No scraped data to clear", "info");
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
    $("#rowCount").text("0");
    $("#clearScrapedBtn").prop("disabled", true);
    $("#fieldMappingSection").hide();
    clearScrapedSession();
    showToast("All scraped data cleared", "success");
    setStatus('Ready. Click "Find Tables" to detect data on page.');
  }
  var init_scraper = __esm({
    "src/popup/scraper.js"() {
      init_state();
      init_utils();
      init_persistence();
      init_dataTable();
      init_fieldMapping();
      init_backendClient();
      __name(handleSelectorPickerResult, "handleSelectorPickerResult");
      __name(startPickSelector, "startPickSelector");
      __name(findTables, "findTables");
      __name(nextTable, "nextTable");
      __name(getTableData, "getTableData");
      __name(extractProduct, "extractProduct");
      __name(_handleExtractedProduct, "_handleExtractedProduct");
      __name(processScrapedData, "processScrapedData");
      __name(locateNextButton, "locateNextButton");
      __name(startCrawl, "startCrawl");
      __name(crawlNextPage, "crawlNextPage");
      __name(stopCrawl, "stopCrawl");
      __name(waitForNetworkIdle, "waitForNetworkIdle");
      __name(testScrape, "testScrape");
      __name(renderTestDiagnostic, "renderTestDiagnostic");
      __name(clearAllScrapedData, "clearAllScrapedData");
    }
  });

  // src/popup/dataTable.js
  function initializeDataTable() {
    const container = document.getElementById("dataPreview");
    state.dataTable = new Handsontable(container, {
      data: [],
      colHeaders: true,
      rowHeaders: false,
      height: 300,
      width: "100%",
      stretchH: "none",
      colWidths: 120,
      autoWrapRow: false,
      autoWrapCol: false,
      licenseKey: "non-commercial-and-evaluation",
      contextMenu: {
        items: {
          "preview": {
            name: "\u{1F441}\uFE0F Preview",
            callback: function(key, selection) {
              const visualRow = selection[0].start.row;
              const physicalRow = this.toPhysicalRow(visualRow);
              previewScrapedRow(physicalRow);
            }
          },
          "delete_row": {
            name: "\u{1F5D1}\uFE0F Delete Row",
            callback: function(key, selection) {
              const hot = this;
              console.log("[DropshipTracker] Delete row selection:", JSON.stringify(selection));
              console.log("[DropshipTracker] Data length before:", state.data.length);
              const physicalRows = [];
              selection.forEach((sel) => {
                for (let r = sel.start.row; r <= sel.end.row; r++) {
                  const physicalRow = hot.toPhysicalRow && typeof hot.toPhysicalRow === "function" ? hot.toPhysicalRow(r) : r;
                  if (physicalRow >= 0 && physicalRow < state.data.length && !physicalRows.includes(physicalRow)) {
                    physicalRows.push(physicalRow);
                  }
                }
              });
              console.log("[DropshipTracker] Physical rows to delete:", physicalRows);
              if (physicalRows.length === 0) {
                showToast("No valid rows selected", "warning");
                return;
              }
              physicalRows.sort((a, b) => b - a);
              physicalRows.forEach((rowIdx) => {
                state.data.splice(rowIdx, 1);
                if (state.rawData && Array.isArray(state.rawData) && state.rawData.length > rowIdx) {
                  state.rawData.splice(rowIdx, 1);
                }
              });
              console.log("[DropshipTracker] Data length after:", state.data.length);
              updateDataTable(state.data);
              updateExportButtons();
              $("#rowCount").text(state.data.length);
              saveScrapedData();
              showToast(`Deleted ${physicalRows.length} row(s)`, "info");
            }
          },
          "separator": "---------",
          "copy": { name: "Copy" },
          "cut": { name: "Cut" }
        }
      },
      manualColumnResize: true,
      columnSorting: true,
      filters: true,
      dropdownMenu: true,
      afterChange: function(changes, source) {
        if (source === "edit") {
          updateExportButtons();
        }
      },
      afterOnCellMouseDown: function(event, coords, td) {
        const target = event.target;
        if (target.matches("[data-action]") || target.closest("[data-action]")) {
          event.stopPropagation();
          const btn = target.matches("[data-action]") ? target : target.closest("[data-action]");
          const action = btn.dataset.action;
          const physicalRow = this.toPhysicalRow(coords.row);
          if (action === "preview") {
            previewScrapedRow(physicalRow);
          } else if (action === "delete") {
            if (physicalRow >= 0 && physicalRow < state.data.length) {
              state.data.splice(physicalRow, 1);
              if (state.rawData && Array.isArray(state.rawData) && state.rawData.length > physicalRow) {
                state.rawData.splice(physicalRow, 1);
              }
              updateDataTable(state.data);
              updateExportButtons();
              $("#rowCount").text(state.data.length);
              saveScrapedData();
              showToast("Row deleted", "info");
            }
          }
        }
      }
    });
  }
  function updateDataTable(data) {
    if (!data || data.length === 0) {
      state.dataTable.loadData([]);
      return;
    }
    let headers = [];
    const seen = /* @__PURE__ */ new Set();
    data.forEach((row) => {
      if (row && typeof row === "object") {
        Object.keys(row).forEach((key) => {
          if (!seen.has(key)) {
            seen.add(key);
            headers.push(key);
          }
        });
      }
    });
    if (headers.length === 0) {
      console.warn("[DropshipTracker] No valid headers found in data");
      state.dataTable.loadData([]);
      return;
    }
    headers.push("Actions");
    const arrayData = data.map((row) => {
      const rowData = headers.slice(0, -1).map((h) => {
        const val = row[h];
        return val !== void 0 && val !== null ? String(val) : "";
      });
      rowData.push("");
      return rowData;
    });
    const colWidths = headers.map((h) => {
      if (h === "Actions")
        return 70;
      const headerLen = (h || "").length * 8;
      return Math.max(80, Math.min(200, headerLen + 20));
    });
    const columns = headers.map((h) => {
      if (h === "Actions") {
        return {
          readOnly: true,
          renderer: function(instance, td, row, col, prop, value, cellProperties) {
            td.innerHTML = '<div class="row-actions"><button class="btn btn-xs btn-default" data-action="preview" title="Preview">\u{1F441}\uFE0F</button><button class="btn btn-xs btn-danger" data-action="delete" title="Delete">\u{1F5D1}\uFE0F</button></div>';
            return td;
          }
        };
      }
      return { readOnly: false };
    });
    state.dataTable.updateSettings({
      colHeaders: headers,
      data: arrayData,
      colWidths,
      columns
    });
    state.dataTable.render();
    console.log(`[DropshipTracker] Data table updated: ${data.length} rows, ${headers.length} columns`);
    console.log("[DropshipTracker] Headers:", headers.slice(0, 10), "... (total:", headers.length, ")");
  }
  function updateExpandToggle() {
    const $toggle = $("#expandColumnsToggle");
    if (state.allFieldNames.length > MAX_VISIBLE_COLUMNS) {
      $toggle.show();
      $toggle.text(
        state.showAllColumns ? `Show Less (${MAX_VISIBLE_COLUMNS} columns)` : `Show All (${state.allFieldNames.length} columns)`
      );
    } else {
      $toggle.hide();
    }
  }
  function toggleExpandColumns() {
    state.showAllColumns = !state.showAllColumns;
    Promise.resolve().then(() => (init_scraper(), scraper_exports)).then(({ processScrapedData: processScrapedData2 }) => {
      processScrapedData2(state.rawData);
    });
  }
  var init_dataTable = __esm({
    "src/popup/dataTable.js"() {
      init_state();
      init_utils();
      init_persistence();
      init_preview();
      __name(initializeDataTable, "initializeDataTable");
      __name(updateDataTable, "updateDataTable");
      __name(updateExpandToggle, "updateExpandToggle");
      __name(toggleExpandColumns, "toggleExpandColumns");
    }
  });

  // src/popup/persistence.js
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
        console.error("[DropshipTracker] Failed to save scraped data:", chrome.runtime.lastError);
        return;
      }
      console.log("[DropshipTracker] Scraped data saved:", state.data.length, "items");
    });
  }
  function loadScrapedData() {
    chrome.storage.local.get(["scrapedSession"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("[DropshipTracker] Failed to load scraped data:", chrome.runtime.lastError);
        return;
      }
      if (result.scrapedSession && result.scrapedSession.data?.length > 0) {
        const session = result.scrapedSession;
        const hourAgo = Date.now() - 60 * 60 * 1e3;
        if (session.savedAt > hourAgo) {
          state.data = session.data;
          state.rawData = session.rawData || [];
          state.fieldNames = session.fieldNames || [];
          state.fieldMapping = session.fieldMapping || {};
          setTimeout(() => {
            if (state.dataTable) {
              updateDataTable(state.data);
              updateRowCount(state.data.length);
              updateExportButtons();
              if (state.data.length > 0) {
                showFieldMapping();
                setStatus(`Restored ${state.data.length} scraped items from previous session`);
                showToast(`Restored ${state.data.length} items`, "info");
              }
            }
          }, 100);
        } else {
          chrome.storage.local.remove("scrapedSession");
        }
      }
    });
  }
  function clearScrapedSession() {
    chrome.storage.local.remove("scrapedSession");
  }
  function loadPersistedFieldMapping() {
    const key = `fieldMapping_${state.tabDomain}`;
    chrome.storage.local.get([key], (result) => {
      if (result[key]) {
        state.fieldMapping = result[key].mapping || {};
        console.log("[DropshipTracker] Loaded field mapping for", state.tabDomain, Object.keys(state.fieldMapping).length, "fields");
      }
    });
  }
  function savePersistedFieldMapping() {
    const key = `fieldMapping_${state.tabDomain}`;
    chrome.storage.local.set({
      [key]: {
        mapping: state.fieldMapping,
        savedAt: Date.now(),
        domain: state.tabDomain
      }
    }, () => {
      console.log("[DropshipTracker] Saved field mapping for", state.tabDomain);
    });
  }
  function loadCustomSelectors() {
    const key = `customSelectors_${state.tabDomain}`;
    chrome.storage.local.get([key], (result) => {
      if (result[key]) {
        state.customSelectors = result[key] || {};
        console.log("[DropshipTracker] Loaded custom selectors for", state.tabDomain);
        updateCustomSelectorsList();
      }
    });
  }
  function saveCustomSelectors() {
    const key = `customSelectors_${state.tabDomain}`;
    chrome.storage.local.set({
      [key]: state.customSelectors
    }, () => {
      console.log("[DropshipTracker] Saved custom selectors for", state.tabDomain);
    });
  }
  function updateCustomSelectorsList() {
    const $list = $("#customSelectorsList");
    if (!$list.length)
      return;
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
        <span class="sample-value" title="${data.sampleValue}">${(data.sampleValue || "").substring(0, 30)}...</span>
        <button class="btn btn-xs btn-danger" data-field="${field}" data-action="remove-selector">\xD7</button>
      </li>
    `);
      $list.append($item);
    });
  }
  var init_persistence = __esm({
    "src/popup/persistence.js"() {
      init_state();
      init_dataTable();
      init_fieldMapping();
      init_utils();
      __name(saveScrapedData, "saveScrapedData");
      __name(loadScrapedData, "loadScrapedData");
      __name(clearScrapedSession, "clearScrapedSession");
      __name(loadPersistedFieldMapping, "loadPersistedFieldMapping");
      __name(savePersistedFieldMapping, "savePersistedFieldMapping");
      __name(loadCustomSelectors, "loadCustomSelectors");
      __name(saveCustomSelectors, "saveCustomSelectors");
      __name(updateCustomSelectorsList, "updateCustomSelectorsList");
    }
  });

  // src/popup/main.js
  init_state();
  init_utils();
  init_persistence();
  init_dataTable();
  init_catalogTable();
  init_scraper();
  init_catalog();
  init_fieldMapping();

  // src/popup/export.js
  init_state();
  init_utils();
  function exportCSCart(format) {
    if (state.data.length === 0) {
      showToast("No data to export", "warning");
      return;
    }
    const templateId = $("#cartTemplateSelect").val() || "cscart";
    const template = typeof CartTemplateRegistry !== "undefined" ? CartTemplateRegistry.get(templateId) : null;
    if (format === "xml") {
      if (template && !CartTemplateRegistry.supportsXML(templateId)) {
        showToast(template.name + " does not support XML export. Use CSV instead.", "warning");
        return;
      }
      const products = mapToCSCart(state.data, state.rawData);
      const xml = template && template.toXML ? template.toXML(products, state.settings) : CSCartXMLBuilder.build(products, state.settings);
      downloadFile(xml, templateId + "-products.xml", "application/xml");
      showToast(template ? template.name + " XML exported" : "XML exported", "success");
    } else {
      if (template && template.mapProduct && template.toCSV) {
        const mapped = mapToCSCart(state.data, state.rawData);
        const templateProducts = mapped.map((p) => template.mapProduct(p, state.settings));
        const csv = template.toCSV(templateProducts, state.settings);
        downloadFile(csv, templateId + "-products.csv", "text/csv");
        showToast(template.name + " CSV exported", "success");
      } else {
        const products = mapToCSCart(state.data, state.rawData);
        const csv = CSCartMapper.toCSV(products);
        downloadFile(csv, "cscart-products.csv", "text/csv");
        showToast("CS-Cart CSV exported", "success");
      }
    }
  }
  __name(exportCSCart, "exportCSCart");
  function exportCatalog(format) {
    const selected = state.selectedProducts.length > 0 ? state.catalog.filter((p) => state.selectedProducts.includes(p.productCode)) : state.catalog;
    if (selected.length === 0) {
      showToast("No products to export", "warning");
      return;
    }
    const templateId = $("#cartTemplateSelect").val() || "cscart";
    const template = typeof CartTemplateRegistry !== "undefined" ? CartTemplateRegistry.get(templateId) : null;
    const products = selected.map((p) => CSCartMapper.fromCatalog(p, state.settings));
    if (format === "xml") {
      if (template && !CartTemplateRegistry.supportsXML(templateId)) {
        showToast(template.name + " does not support XML export. Use CSV instead.", "warning");
        return;
      }
      const xml = template && template.toXML ? template.toXML(products, state.settings) : CSCartXMLBuilder.build(products, state.settings);
      downloadFile(xml, templateId + "-catalog.xml", "application/xml");
    } else {
      if (template && template.mapProduct && template.toCSV) {
        const templateProducts = products.map((p) => template.mapProduct(p, state.settings));
        const csv = template.toCSV(templateProducts, state.settings);
        downloadFile(csv, templateId + "-catalog.csv", "text/csv");
      } else {
        const csv = CSCartMapper.toCSV(products);
        downloadFile(csv, "cscart-catalog.csv", "text/csv");
      }
    }
    showToast(`Exported ${selected.length} products as ${template ? template.name : "CS-Cart"} ${format.toUpperCase()}`, "success");
  }
  __name(exportCatalog, "exportCatalog");
  function mapToCSCart(data, rawData) {
    return data.map((row, index) => {
      const raw = rawData[index] || {};
      const smartNames = state.smartNames || {};
      const getMappedValue = /* @__PURE__ */ __name((exportField) => {
        for (const [sourceField, mappedTo] of Object.entries(state.fieldMapping)) {
          if (mappedTo === exportField) {
            const displayName = smartNames[sourceField] || getShortFieldName(sourceField);
            return row[displayName] || raw[sourceField] || "";
          }
        }
        return "";
      }, "getMappedValue");
      const supplierPrice = CSCartMapper.parsePrice(getMappedValue("price") || raw.Price);
      const shippingCostValue = CSCartMapper.parsePrice(getMappedValue("shipping_cost") || raw["Shipping Cost"] || "");
      const variantsRaw = getMappedValue("variants") || raw.Variants || "";
      let variants = [];
      try {
        variants = typeof variantsRaw === "string" ? JSON.parse(variantsRaw) : variantsRaw;
      } catch (e) {
      }
      const optionsStr = Array.isArray(variants) && variants.length > 0 ? CSCartXMLBuilder.buildOptions(variants, "", state.settings?.cscartDelimiter || "///") : "";
      const productName = getMappedValue("product_name") || raw.Title || "Untitled";
      return {
        product_code: getMappedValue("product_code") || raw._supplierProductId || `PROD-${Date.now()}-${index}`,
        product_name: productName,
        price: calculateSellingPrice(parseFloat(supplierPrice), parseFloat(shippingCostValue)),
        list_price: CSCartMapper.parsePrice(getMappedValue("list_price") || raw["Original Price"] || ""),
        quantity: parseInt(getMappedValue("quantity")) || 999,
        category: getMappedValue("category") || raw.Category || state.settings?.defaultCategory || "Products",
        description: getMappedValue("description") || raw.Description || "",
        short_description: getMappedValue("short_description") || raw["Short Description"] || CSCartMapper.extractShortDescription(getMappedValue("description") || raw.Description || ""),
        images: getMappedValue("images") || raw.Images || "",
        weight: parseFloat(getMappedValue("weight")) || 0,
        status: state.settings?.defaultStatus || "A",
        language: state.settings?.defaultLanguage || "en",
        brand: getMappedValue("brand") || raw.Brand || "",
        rating: getMappedValue("rating") || raw.Rating || "",
        review_count: getMappedValue("review_count") || raw["Review Count"] || "",
        reviews: raw.reviews || "",
        options: optionsStr,
        meta_keywords: getMappedValue("meta_keywords") || CSCartMapper.extractKeywords(productName),
        meta_description: getMappedValue("meta_description") || CSCartMapper.truncate(productName, 160),
        shipping_freight: shippingCostValue || "",
        supplier_url: getMappedValue("url") || raw.URL || state.tabUrl,
        supplier_price: supplierPrice
      };
    });
  }
  __name(mapToCSCart, "mapToCSCart");
  function copyToClipboard() {
    const data = state.dataTable.getData();
    const headers = state.dataTable.getColHeader();
    const tsv = [headers.join("	")].concat(data.map((row) => row.join("	"))).join("\n");
    navigator.clipboard.writeText(tsv).then(() => {
      showToast("Copied to clipboard", "success");
    });
  }
  __name(copyToClipboard, "copyToClipboard");
  function downloadRawXlsx() {
    const data = state.dataTable.getData();
    const headers = state.dataTable.getColHeader();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    const wbout = XLSX.write(wb, { type: "binary", bookType: "xlsx" });
    const blob = new Blob([s2ab(wbout)], { type: "application/octet-stream" });
    saveAs(blob, "scraped-data.xlsx");
    showToast("XLSX downloaded", "success");
  }
  __name(downloadRawXlsx, "downloadRawXlsx");

  // src/popup/main.js
  init_preview();

  // src/popup/googleDrive.js
  init_state();
  init_utils();
  function checkDriveAuth() {
    if (typeof GoogleDriveService !== "undefined") {
      GoogleDriveService.checkAuth().then((isAuthed) => {
        updateDriveStatus(isAuthed);
      });
    }
  }
  __name(checkDriveAuth, "checkDriveAuth");
  function authorizeDrive() {
    if (typeof GoogleDriveService !== "undefined") {
      GoogleDriveService.authorize().then((success) => {
        updateDriveStatus(success);
        if (success) {
          showToast("Google Drive connected!", "success");
        }
      }).catch((err) => {
        showToast("Authorization failed: " + err.message, "error");
      });
    } else {
      showToast("Google Drive service not loaded", "error");
    }
  }
  __name(authorizeDrive, "authorizeDrive");
  function disconnectDrive() {
    if (typeof GoogleDriveService !== "undefined") {
      GoogleDriveService.disconnect();
      updateDriveStatus(false);
      showToast("Google Drive disconnected", "success");
    }
  }
  __name(disconnectDrive, "disconnectDrive");
  function updateDriveStatus(connected) {
    const $indicator = $(".sync-indicator");
    const $text = $(".sync-text");
    const $authBtn = $("#authDriveBtn");
    const $disconnectBtn = $("#disconnectDriveBtn");
    const $status = $("#driveAuthStatus");
    if (connected) {
      $indicator.addClass("connected");
      $text.text("Connected");
      $authBtn.hide();
      $disconnectBtn.show();
      $status.removeClass("alert-warning").addClass("alert-success").html('<span class="glyphicon glyphicon-ok"></span> Connected to Google Drive');
      $("#uploadDriveBtn").prop("disabled", false);
      $("#syncCatalogDriveBtn").prop("disabled", false);
    } else {
      $indicator.removeClass("connected");
      $text.text("Not synced");
      $authBtn.show();
      $disconnectBtn.hide();
      $status.removeClass("alert-success").addClass("alert-warning").html('<span class="glyphicon glyphicon-warning-sign"></span> Not connected. Click to authorize.');
      $("#uploadDriveBtn").prop("disabled", true);
      $("#syncCatalogDriveBtn").prop("disabled", true);
    }
  }
  __name(updateDriveStatus, "updateDriveStatus");
  function uploadToDrive() {
    if (state.data.length === 0) {
      showToast("No data to upload", "warning");
      return;
    }
    const products = mapToCSCart(state.data, state.rawData);
    const xml = CSCartXMLBuilder.build(products, state.settings);
    const filename = `products-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.xml`;
    setStatus("Uploading to Google Drive...");
    GoogleDriveService.uploadFile(xml, filename, "application/xml").then((result) => {
      showToast("Uploaded to Google Drive", "success");
      setStatus("Upload complete");
      updateSyncTime();
    }).catch((err) => {
      showToast("Upload failed: " + err.message, "error");
      setStatus("Upload failed");
    });
  }
  __name(uploadToDrive, "uploadToDrive");
  function syncCatalogToDrive() {
    if (state.catalog.length === 0) {
      showToast("Catalog is empty", "warning");
      return;
    }
    const products = state.catalog.map((p) => CSCartMapper.fromCatalog(p, state.settings));
    const xml = CSCartXMLBuilder.build(products, state.settings);
    const filename = `catalog-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.xml`;
    setStatus("Syncing catalog to Google Drive...");
    GoogleDriveService.uploadFile(xml, filename, "application/xml").then((result) => {
      showToast("Catalog synced to Google Drive", "success");
      setStatus("Sync complete");
      updateSyncTime();
    }).catch((err) => {
      showToast("Sync failed: " + err.message, "error");
      setStatus("Sync failed");
    });
  }
  __name(syncCatalogToDrive, "syncCatalogToDrive");
  function updateSyncTime() {
    const now = /* @__PURE__ */ new Date();
    $("#lastSyncTime").text(now.toLocaleTimeString());
    chrome.storage.local.set({ lastSyncTime: now.getTime() });
  }
  __name(updateSyncTime, "updateSyncTime");

  // src/popup/settings.js
  init_state();
  init_utils();
  init_catalog();
  init_catalogTable();
  function loadSettings() {
    chrome.runtime.sendMessage({ action: "getSettings" }, (response) => {
      state.settings = response?.settings || {};
      applySettingsToUI();
    });
  }
  __name(loadSettings, "loadSettings");
  function applySettingsToUI() {
    if (!state.settings)
      return;
    $("#driveFolderName").val(state.settings.googleDriveFolder || "DropshipTracker");
    $("#autoSyncEnabled").prop("checked", state.settings.autoSync || false);
    $("#syncInterval").val(state.settings.syncInterval || 360);
    $("#defaultMargin").val(state.settings.defaultMargin || 30);
    $("#marginType").val(state.settings.marginType || "percent");
    $("#includeShippingInCost").prop("checked", state.settings.includeShippingInCost !== false);
    $("#currency").val(state.settings.currency || "USD");
    $("#roundPrices").prop("checked", state.settings.roundPrices !== false);
    $("#roundTo").val(state.settings.roundTo || "0.99");
    $("#defaultLanguage").val(state.settings.language || "en");
    $("#fieldDelimiter").val(state.settings.cscartDelimiter || "///");
    $("#defaultStatus").val(state.settings.defaultStatus || "A");
    $("#defaultCategory").val(state.settings.defaultCategory || "");
  }
  __name(applySettingsToUI, "applySettingsToUI");
  function saveSettings() {
    state.settings = {
      googleDriveFolder: $("#driveFolderName").val(),
      autoSync: $("#autoSyncEnabled").is(":checked"),
      syncInterval: parseInt($("#syncInterval").val()),
      defaultMargin: parseFloat($("#defaultMargin").val()),
      marginType: $("#marginType").val(),
      includeShippingInCost: $("#includeShippingInCost").is(":checked"),
      currency: $("#currency").val(),
      roundPrices: $("#roundPrices").is(":checked"),
      roundTo: parseFloat($("#roundTo").val()),
      language: $("#defaultLanguage").val(),
      cscartDelimiter: $("#fieldDelimiter").val(),
      defaultStatus: $("#defaultStatus").val(),
      defaultCategory: $("#defaultCategory").val()
    };
    chrome.runtime.sendMessage({ action: "saveSettings", settings: state.settings }, (response) => {
      if (response?.success) {
        showToast("Settings saved", "success");
      }
    });
  }
  __name(saveSettings, "saveSettings");
  function loadSuppliers() {
    chrome.runtime.sendMessage({ action: "getSuppliers" }, (response) => {
      state.suppliers = response?.suppliers || [];
      renderSupplierCards();
      updateSupplierStats();
    });
  }
  __name(loadSuppliers, "loadSuppliers");
  function renderSupplierCards() {
    const $list = $("#suppliersList");
    $list.empty();
    if (state.suppliers.length === 0) {
      $list.html('<p class="text-muted">No suppliers configured. Click "Add Supplier" to add one.</p>');
      return;
    }
    state.suppliers.forEach((supplier) => {
      const $card = $(`
      <div class="supplier-card" data-domain="${supplier.domain}">
        <div class="supplier-icon">
          <img src="https://www.google.com/s2/favicons?domain=${supplier.domain}&sz=32" alt="" onerror="this.style.display='none'">
        </div>
        <div class="supplier-info">
          <h5>${supplier.name || supplier.domain}</h5>
          <span class="text-muted">${supplier.domain}</span>
          ${supplier.notes ? `<small class="text-muted d-block">${supplier.notes}</small>` : ""}
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
    $(".btn-delete-supplier").off("click").on("click", function() {
      const domain = $(this).data("domain");
      deleteSupplier(domain);
    });
    $(".btn-configure").off("click").on("click", function() {
      const domain = $(this).data("domain");
      configureSupplier(domain);
    });
  }
  __name(renderSupplierCards, "renderSupplierCards");
  function deleteSupplier(domain) {
    if (!confirm(`Delete supplier ${domain}?`))
      return;
    chrome.runtime.sendMessage({ action: "deleteSupplier", domain }, (response) => {
      if (response?.success) {
        showToast("Supplier deleted", "success");
        loadSuppliers();
      } else {
        showToast("Failed to delete supplier", "error");
      }
    });
  }
  __name(deleteSupplier, "deleteSupplier");
  function configureSupplier(domain) {
    const supplier = state.suppliers.find((s) => s.domain === domain);
    if (!supplier)
      return;
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
              <input type="text" class="form-control" id="configSupplierName" value="${supplier.name || ""}">
            </div>
            <div class="form-group">
              <label>Notes</label>
              <textarea class="form-control" id="configSupplierNotes" rows="3">${supplier.notes || ""}</textarea>
            </div>
            <div class="form-group">
              <label>Default Category</label>
              <input type="text" class="form-control" id="configSupplierCategory" value="${supplier.defaultCategory || ""}" placeholder="e.g., Electronics///Gadgets">
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
    $("#configureSupplierModal").remove();
    $("body").append(modal);
    $("#saveSupplierConfigBtn").on("click", function() {
      const updates = {
        domain,
        name: $("#configSupplierName").val().trim(),
        notes: $("#configSupplierNotes").val().trim(),
        defaultCategory: $("#configSupplierCategory").val().trim(),
        defaultMargin: parseInt($("#configSupplierMargin").val()) || 30
      };
      chrome.runtime.sendMessage({ action: "saveSupplier", supplier: updates }, (response) => {
        if (response?.success) {
          showToast("Supplier updated", "success");
          $("#configureSupplierModal").modal("hide");
          loadSuppliers();
        }
      });
    });
    $("#configureSupplierModal").modal("show");
  }
  __name(configureSupplier, "configureSupplier");
  function updateSupplierStats() {
    const counts = {};
    state.catalog.forEach((p) => {
      counts[p.domain] = (counts[p.domain] || 0) + 1;
    });
    $(".supplier-card").each(function() {
      const domain = $(this).data("domain");
      const count = counts[domain] || 0;
      $(this).find(".badge").text(`${count} products`);
    });
  }
  __name(updateSupplierStats, "updateSupplierStats");
  function saveNewSupplier() {
    const supplier = {
      domain: $("#newSupplierDomain").val().trim(),
      name: $("#newSupplierName").val().trim(),
      notes: $("#newSupplierNotes").val().trim(),
      addedDate: Date.now()
    };
    if (!supplier.domain) {
      showToast("Please enter a domain", "warning");
      return;
    }
    chrome.runtime.sendMessage({ action: "saveSupplier", supplier }, (response) => {
      if (response?.success) {
        showToast("Supplier added", "success");
        $("#addSupplierForm").slideUp();
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
        $("#suppliersList").append($card);
        $("#newSupplierDomain, #newSupplierName, #newSupplierNotes").val("");
      }
    });
  }
  __name(saveNewSupplier, "saveNewSupplier");
  function exportAllData() {
    chrome.storage.local.get(null, (data) => {
      const json = JSON.stringify(data, null, 2);
      downloadFile(json, "dropshiptracker-backup.json", "application/json");
      showToast("Backup downloaded", "success");
    });
  }
  __name(exportAllData, "exportAllData");
  function importData(e) {
    const file = e.target.files[0];
    if (!file)
      return;
    const reader = new FileReader();
    reader.onload = function(e2) {
      try {
        const data = JSON.parse(e2.target.result);
        chrome.storage.local.set(data, () => {
          showToast("Data imported successfully", "success");
          loadCatalog();
          loadSettings();
          loadSuppliers();
        });
      } catch (err) {
        showToast("Invalid backup file", "error");
      }
    };
    reader.readAsText(file);
  }
  __name(importData, "importData");
  function clearAllData() {
    if (!confirm("This will delete ALL your data including catalog, settings, and suppliers. Are you sure?")) {
      return;
    }
    chrome.storage.local.clear(() => {
      state.catalog = [];
      state.settings = null;
      state.suppliers = [];
      loadSettings();
      refreshCatalogTable();
      updateCatalogCount();
      showToast("All data cleared", "success");
    });
  }
  __name(clearAllData, "clearAllData");

  // src/popup/main.js
  init_backendClient();
  $(document).ready(function() {
    const params = new URLSearchParams(window.location.search);
    const rawTabId = params.get("tabid");
    state.tabId = rawTabId ? parseInt(rawTabId, 10) : null;
    if (isNaN(state.tabId))
      state.tabId = null;
    state.tabUrl = decodeURIComponent(params.get("url") || "");
    try {
      state.tabDomain = new URL(state.tabUrl).hostname;
    } catch (e) {
      state.tabDomain = "unknown";
    }
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
    setInterval(_checkBackend, 3e4);
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "selectorPickerResult") {
        handleSelectorPickerResult(message);
      }
    });
    window.addEventListener("beforeunload", () => {
      if (state.dataTable) {
        try {
          state.dataTable.destroy();
        } catch (e) {
        }
      }
      if (state.catalogTable) {
        try {
          state.catalogTable.destroy();
        } catch (e) {
        }
      }
    });
    console.log("[DropshipTracker] Popup initialized for tab", state.tabId, "domain:", state.tabDomain);
  });
  async function _checkBackend() {
    resetBackendCache();
    const up = await isBackendAvailable();
    const dot = document.querySelector("#backendStatus .backend-dot");
    const wrap = document.getElementById("backendStatus");
    if (dot) {
      dot.classList.toggle("up", up);
      dot.classList.toggle("down", !up);
    }
    if (wrap) {
      wrap.title = up ? "Scrapling backend: running \u2713" : "Scrapling backend: offline \u2014 run: uvicorn backend.main:app --port 8000";
    }
  }
  __name(_checkBackend, "_checkBackend");
  function bindEvents() {
    $('a[data-toggle="tab"]').on("shown.bs.tab", function(e) {
      const target = $(e.target).attr("href");
      if (target === "#catalog") {
        refreshCatalogTable();
      }
    });
    $("#findTablesBtn").on("click", findTables);
    $("#nextTableBtn").on("click", nextTable);
    $("#extractProductBtn").on("click", extractProduct);
    $("#updateCatalogBtn").on("click", updateCatalogFromPage);
    $("#locateNextBtn").on("click", locateNextButton);
    $("#crawlBtn").on("click", startCrawl);
    $("#stopCrawlBtn").on("click", stopCrawl);
    $("#addToCatalogBtn").on("click", addToCatalog);
    $("#clearScrapedBtn").on("click", clearAllScrapedData);
    $("#testScrapeBtn").on("click", testScrape);
    $("#exportXmlBtn").on("click", () => exportCSCart("xml"));
    $("#exportCsvBtn").on("click", () => exportCSCart("csv"));
    $("#uploadDriveBtn").on("click", uploadToDrive);
    $("#copyClipboardBtn").on("click", copyToClipboard);
    $("#downloadRawBtn").on("click", downloadRawXlsx);
    $("#cartTemplateSelect").on("change", function() {
      const templateId = $(this).val();
      const supportsXml = typeof CartTemplateRegistry !== "undefined" && CartTemplateRegistry.supportsXML(templateId);
      $("#exportXmlBtn").prop("disabled", !supportsXml && state.data.length === 0).toggleClass("btn-success", supportsXml).toggleClass("btn-default", !supportsXml);
      if (!supportsXml) {
        $("#exportXmlBtn").attr("title", "This format does not support XML export");
      } else {
        $("#exportXmlBtn").attr("title", "");
      }
      const templateNames = { cscart: "CS-Cart", shopify: "Shopify", woocommerce: "WooCommerce", prestashop: "PrestaShop", magento: "Magento", bigcommerce: "BigCommerce" };
      const templateLabel = templateNames[templateId] || "Export";
      $("#mappingHeaderText").text("Map Fields for " + templateLabel);
    });
    $("#autoMapBtn").on("click", autoMapFields);
    $("#expandColumnsToggle").on("click", toggleExpandColumns);
    $("#pickSelectorBtn").on("click", startPickSelector);
    $("#customSelectorsList").on("click", '[data-action="remove-selector"]', function(e) {
      e.preventDefault();
      const field = $(this).data("field");
      delete state.customSelectors[field];
      saveCustomSelectors();
      updateCustomSelectorsList();
      showToast(`Removed custom selector for ${field}`, "info");
    });
    $("#catalogSearch").on("input", debounce(filterCatalog, 300));
    $("[data-filter]").on("click", function(e) {
      e.preventDefault();
      filterCatalog($(this).data("filter"));
    });
    $("#deleteSelectedBtn").on("click", deleteSelectedProducts);
    $("#clearCatalogBtn").on("click", clearEntireCatalog);
    $("#exportCatalogXmlBtn").on("click", () => exportCatalog("xml"));
    $("#exportCatalogCsvBtn").on("click", () => exportCatalog("csv"));
    $("#checkPricesBtn").on("click", checkPrices);
    $("#syncCatalogDriveBtn").on("click", syncCatalogToDrive);
    $("#selectAllBtn").on("click", selectAllProducts);
    $("#deselectAllBtn").on("click", deselectAllProducts);
    $("#invertSelectionBtn").on("click", invertSelection);
    $("#clearSelectionBtn").on("click", deselectAllProducts);
    $("[data-select-filter]").on("click", function(e) {
      e.preventDefault();
      selectByFilter($(this).data("select-filter"));
    });
    $("#previewDeleteBtn").on("click", deletePreviewedItem);
    $("#previewModal").on("hidden.bs.modal", function() {
      state.previewContext = null;
    });
    $("#scrapeSelectedBtn").on("click", scrapeSelectedProducts);
    $("#previewGallery").on("click", "img", function() {
      const src = $(this).attr("src");
      $("#previewImage img").attr("src", src);
      $("#previewGallery img").removeClass("active");
      $(this).addClass("active");
    });
    $("#addSupplierBtn").on("click", () => $("#addSupplierForm").slideDown());
    $("#cancelSupplierBtn").on("click", () => $("#addSupplierForm").slideUp());
    $("#saveSupplierBtn").on("click", saveNewSupplier);
    $("#authDriveBtn").on("click", authorizeDrive);
    $("#disconnectDriveBtn").on("click", disconnectDrive);
    $("#saveSettingsBtn").on("click", saveSettings);
    $("#exportAllDataBtn").on("click", exportAllData);
    $("#importDataBtn").on("click", () => $("#importDataFile").click());
    $("#importDataFile").on("change", importData);
    $("#clearAllDataBtn").on("click", clearAllData);
  }
  __name(bindEvents, "bindEvents");
})();
