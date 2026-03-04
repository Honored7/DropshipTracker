/**
 * Catalog CRUD – load, add, scrape details, delete, update, check prices
 */
/* global $, chrome, SanitizeService */

import { state } from './state.js';
import {
  sendToContentScript, setStatus, showToast, showLoading, hideLoading,
  parsePrice, calculateSellingPrice, getShortFieldName
} from './utils.js';
import { isBackendAvailable, extractViaBackend, resetBackendCache } from './backendClient.js';
import { refreshCatalogTable, updateCatalogCount, getSelectedCatalogRows } from './catalogTable.js';

export function loadCatalog() {
  chrome.runtime.sendMessage({ action: 'getCatalog' }, (response) => {
    state.catalog = response?.catalog || [];
    updateCatalogCount();
    refreshCatalogTable();
  });
}

export function addToCatalog() {
  if (state.data.length === 0) {
    showToast('No data to add. Scrape some products first.', 'warning');
    return;
  }

  const products = state.data.map((row, index) => {
    const rawRow = state.rawData[index] || {};

    // rawRow can come from two sources:
    //   a) "Find Tables" scrape → arbitrary TitleCase or original-page keys
    //   b) "Extract Product" response → camelCase keys (title, price, images[], etc.)
    // Helper reads both so neither path drops data.
    const raw = (camel, titled) => {
      const v = rawRow[camel];
      if (v !== undefined && v !== null && v !== '') return v;
      return titled ? rawRow[titled] : undefined;
    };

    const toStr = (v) => {
      if (v === undefined || v === null) return '';
      if (Array.isArray(v)) return v.join(',');
      return String(v);
    };

    const getMappedValue = (exportField) => {
      const smartNames = state.smartNames || {};
      for (const [sourceField, mappedTo] of Object.entries(state.fieldMapping)) {
        if (mappedTo === exportField) {
          const displayName = smartNames[sourceField] || getShortFieldName(sourceField);
          return row[displayName] || rawRow[sourceField] || '';
        }
      }
      return '';
    };

    const findProductUrl = () => {
      // For product-extraction rows rawRow.url is already set
      if (rawRow.url && rawRow.url.startsWith('http')) return rawRow.url;

      const candidates = [];
      for (const [key, val] of Object.entries(rawRow)) {
        if (!val || typeof val !== 'string') continue;
        if (!key.endsWith('href') && !key.endsWith('@href') && !key.endsWith('@link')) continue;

        let url = val;
        if (key.endsWith('@link') && val.includes('|||')) {
          url = val.split('|||').pop().trim();
        }

        if (!url.startsWith('http')) continue;
        if (/click\.|\/track|\/ad[\/\?]|google-analytics|advertis/i.test(url)) continue;

        const isProductUrl = /\/product[-_]?detail|\/item\/\d|\/product\/\d|\/dp\/|\/p\/|\.html/i.test(url);
        candidates.push({ url, priority: isProductUrl ? 1 : 2 });
      }

      if (candidates.length === 0) return '';
      candidates.sort((a, b) => a.priority - b.priority);
      return candidates[0].url;
    };

    const supplierProductId = getMappedValue('product_code') ||
      rawRow._supplierProductId ||
      toStr(raw('productId', 'Product ID')) || '';

    const supplierSku = getMappedValue('supplier_sku') ||
      rawRow._supplierSku ||
      toStr(raw('sku', 'SKU')) || '';

    const productCode = supplierProductId ||
                        toStr(raw('productId', 'Product ID')) ||
                        `PROD-${Date.now()}-${index}`;

    const priceStr = getMappedValue('price') ||
      toStr(raw('price', 'Price')) || '';
    const price = parsePrice(priceStr);

    // Images: rawRow.images may be an array (from extractProduct)
    const rawImages = raw('images', 'Images');
    const primaryImages = getMappedValue('images') ||
      (Array.isArray(rawImages) ? rawImages.join(',') : toStr(rawImages)) || '';
    const additionalImages = getMappedValue('additional_images') || '';
    const allImages = [primaryImages, additionalImages]
      .filter(i => i)
      .join(',')
      .split(/[,|]+/)
      .map(i => i.replace(/^\|+|\|+$/g, '').trim())
      .filter(i => i && i.startsWith('http'));

    const shippingCostValue = parsePrice(
      getMappedValue('shipping_cost') ||
      toStr(raw('shippingCost', 'Shipping Cost')) || ''
    );

    // Variants: rawRow.variants may be an array
    const rawVariants = raw('variants', 'Variants');
    const variantsStr = getMappedValue('variants') ||
      (Array.isArray(rawVariants) ? JSON.stringify(rawVariants) : toStr(rawVariants)) || '';

    const rawVariantGroups = raw('variantGroups', 'Variant Groups');
    const variantGroupsStr = Array.isArray(rawVariantGroups)
      ? JSON.stringify(rawVariantGroups)
      : toStr(rawVariantGroups);

    // Reviews: rawRow.reviews may be an array
    const rawReviews = raw('reviews', 'Reviews');
    const reviewsStr = getMappedValue('reviews') ||
      (Array.isArray(rawReviews) ? JSON.stringify(rawReviews) : toStr(rawReviews)) ||
      toStr(rawRow['Review Text']) || '';

    // Specifications: may be an array
    const rawSpecs = raw('specifications', 'Specifications');
    const specificationsStr = getMappedValue('specifications') ||
      (Array.isArray(rawSpecs) ? JSON.stringify(rawSpecs) : toStr(rawSpecs)) || '';

    // Video URLs: may be an array
    const rawVideos = raw('videoUrls', 'Video URLs');
    const videoUrlsStr = getMappedValue('video_urls') ||
      (Array.isArray(rawVideos) ? rawVideos.join(',') : toStr(rawVideos)) || '';

    return {
      productCode,
      supplierProductId,
      supplierSku,
      title: getMappedValue('product_name') ||
        toStr(raw('title', 'Title')) || 'Untitled Product',
      supplierPrice: price,
      yourPrice: calculateSellingPrice(price, shippingCostValue),
      listPrice: parsePrice(
        getMappedValue('list_price') ||
        toStr(raw('originalPrice', 'Original Price')) ||
        toStr(rawRow['List Price']) || ''
      ),
      stock: parseInt(getMappedValue('quantity')) ||
        parseInt(toStr(raw('stock', 'Stock'))) || 999,
      category: getMappedValue('category') ||
        toStr(raw('category', 'Category')) ||
        state.settings?.defaultCategory || '',
      description: getMappedValue('description') ||
        toStr(raw('description', 'Description')) ||
        toStr(raw('descriptionText', null)) || '',
      shortDescription: getMappedValue('short_description') ||
        toStr(raw('shortDescription', 'Short Description')) || '',
      fullDescription: getMappedValue('full_description') ||
        toStr(raw('fullDescription', 'Full Description')) || '',
      images: allImages.length > 0 ? allImages.join(',') : '',
      supplierUrl: getMappedValue('url') ||
        findProductUrl() ||
        toStr(rawRow.URL) || state.tabUrl,
      domain: state.tabDomain ||
        (() => { try { return new URL(state.tabUrl || 'http://unknown').hostname; } catch(e) { return 'unknown'; } })(),
      variants: variantsStr,
      variantGroups: variantGroupsStr,
      color: getMappedValue('color') || '',
      size: getMappedValue('size') || '',
      shipping: getMappedValue('shipping') ||
        toStr(raw('shipping', 'Shipping')) ||
        toStr(raw('shippingText', null)) || '',
      shippingCost: shippingCostValue,
      brand: getMappedValue('brand') ||
        toStr(raw('brand', 'Brand')) || '',
      rating: getMappedValue('rating') ||
        toStr(raw('rating', 'Rating')) || '',
      reviewCount: getMappedValue('review_count') ||
        toStr(raw('reviewCount', 'Review Count')) ||
        toStr(raw('review_count', null)) || '',
      soldCount: getMappedValue('sold_count') ||
        toStr(raw('soldCount', 'Sold')) ||
        toStr(raw('orders', 'Orders')) || '',
      reviews: reviewsStr,
      storeName: getMappedValue('store_name') ||
        toStr(raw('storeName', 'Store')) ||
        toStr(raw('store_name', null)) || '',
      storeRating: getMappedValue('store_rating') ||
        toStr(raw('storeRating', 'Store Rating')) || '',
      metaKeywords: getMappedValue('meta_keywords') ||
        toStr(raw('metaKeywords', 'Meta Keywords')) || '',
      metaDescription: getMappedValue('meta_description') ||
        toStr(raw('metaDescription', 'Meta Description')) || '',
      attributes: getMappedValue('attributes') || '',
      specifications: specificationsStr,
      minOrder: getMappedValue('min_order') ||
        toStr(raw('minOrder', 'Min Order')) || '',
      videoUrls: videoUrlsStr,
      sku: supplierSku || toStr(raw('sku', 'SKU')) || '',
      currency: toStr(raw('currency', 'Currency')) || 'USD',
      weight: toStr(raw('weight', 'Weight')) || ''
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

export function updateCatalogFromPage() {
  setStatus('Extracting product to update catalog...');

  // Try Scrapling backend first, then fall back to content script
  const _doExtract = async () => {
    try {
      const up = await isBackendAvailable();
      if (up && state.tabUrl) {
        try {
          const r = await extractViaBackend(state.tabUrl);
          if (r && (r.title || r.productId)) return r;
        } catch (e) {
          console.warn('[DropshipTracker] updateCatalog: backend failed, falling back:', e.message);
          resetBackendCache();
        }
      }
    } catch (e) { /* probe error */ }
    return null;
  };

  _doExtract().then(backendResponse => {
    if (backendResponse) {
      _processUpdateResponse(backendResponse);
      return;
    }
    sendToContentScript({ action: 'extractProduct' }, (response) => {
      _processUpdateResponse(response);
    });
  });
}

function _processUpdateResponse(response) {
    if (!response || (!response.productId && !response.title)) {
      setStatus('Could not extract product data');
      showToast('No product data found. Make sure you\'re on a product page.', 'error');
      return;
    }

    const matchedProduct = state.catalog.find(p =>
      (response.productId && p.productCode === response.productId) ||
      (response.url && p.url === response.url) ||
      (response.productId && p.productCode?.includes(response.productId))
    );

    if (!matchedProduct) {
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
      action: 'updateCatalogProduct',
      productCode: matchedProduct.productCode,
      updates
    }, (result) => {
      if (result?.success) {
        showToast(`✓ Updated "${matchedProduct.title?.substring(0, 40)}..." with fresh data`, 'success');
        setStatus(`Catalog item updated: ${response.images?.length || 0} images, ${response.variants?.length || 0} variants, ${response.reviews?.length || 0} reviews`);
        loadCatalog();
      } else {
        showToast('Failed to update catalog item: ' + (result?.error || 'Unknown error'), 'error');
        setStatus('Update failed');
      }
    });
}

export function scrapeProductDetails(rowIndex, onComplete) {
  const done = (msg) => {
    if (msg) console.log('[DropshipTracker]', msg);
    if (typeof onComplete === 'function') onComplete();
  };

  if (rowIndex < 0 || rowIndex >= state.catalog.length) {
    showToast('Invalid product row', 'error');
    done('Invalid rowIndex');
    return;
  }

  const product = state.catalog[rowIndex];
  const productUrl = product.supplierUrl || product.url;

  if (!productUrl) {
    showToast('Product has no URL to scrape. Map a URL field when scraping.', 'warning');
    done('No URL');
    return;
  }

  try {
    const urlObj = new URL(productUrl);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      showToast('Invalid product URL: ' + productUrl.substring(0, 50), 'warning');
      done('Invalid protocol');
      return;
    }
  } catch(e) {
    showToast('Malformed product URL: ' + productUrl.substring(0, 50), 'warning');
    done('Malformed URL');
    return;
  }

  // ── Backend fast path: POST URL to Scrapling, no tab needed ──────────────
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
        console.warn('[DropshipTracker] scrapeProductDetails backend failed, opening tab:', e.message);
        resetBackendCache();
      }
    }
    // Fall back to background-tab + content-script approach
    _scrapeViaTab(productUrl, product, rowIndex, done);
  }).catch(() => _scrapeViaTab(productUrl, product, rowIndex, done));
}

/**
 * Open a background tab, wait for it to load, send extractProduct message.
 */
function _scrapeViaTab(productUrl, product, rowIndex, done) {
  const ERROR_PAGE_PATTERNS = /^(HTTP\s*Status\s*\d|4\d{2}\s|5\d{2}\s|Access\s*Denied|Forbidden|Not\s*Found|Bad\s*Request|Service\s*Unavailable|Error|Page\s*Not\s*Found|Server\s*Error|Unauthorized)/i;

  setStatus(`Opening product page for scraping: ${product.title?.substring(0, 40)}...`);
  chrome.tabs.create({ url: productUrl, active: false }, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      showToast('Failed to open product page', 'error');
      done('Tab create failed');
      return;
    }

    const tabId = tab.id;
    let completed = false;

    const finish = (tabIdToClose) => {
      if (completed) return;
      completed = true;
      try { chrome.tabs.remove(tabIdToClose); } catch(e) {}
      done('Completed');
    };

    const checkInterval = setInterval(() => {
      if (completed) { clearInterval(checkInterval); return; }

      chrome.tabs.get(tabId, (tabInfo) => {
        if (chrome.runtime.lastError || !tabInfo) {
          clearInterval(checkInterval);
          finish(tabId);
          return;
        }

        if (tabInfo.status === 'complete') {
          clearInterval(checkInterval);

          if (tabInfo.title && ERROR_PAGE_PATTERNS.test(tabInfo.title.trim())) {
            showToast(`⚠ Skipped "${product.title?.substring(0, 25) || 'product'}" — page returned: ${tabInfo.title.substring(0, 50)}. Check the product URL.`, 'warning');
            setStatus('Product page error — URL may be invalid or expired');
            finish(tabId);
            return;
          }

          setTimeout(() => {
            if (completed) return;

            chrome.tabs.sendMessage(tabId, { action: 'extractProduct' }, (response) => {
              if (chrome.runtime.lastError) {
                showToast('Content script not loaded on product page. Try refreshing.', 'warning');
                finish(tabId);
                return;
              }

              const title = response?.title || '';
              const isErrorPage = ERROR_PAGE_PATTERNS.test(title.trim());
              if (isErrorPage) {
                showToast(`⚠ Error page detected for: ${product.title?.substring(0, 30)}...`, 'warning');
                setStatus('Error page — product not updated');
                finish(tabId);
                return;
              }

              if (response && (response.productId || (response.title && response.title.length > 5))) {
                _applyScrapedUpdates(response, product, rowIndex, () => finish(tabId));
              } else {
                showToast('Could not extract product data from page', 'warning');
                finish(tabId);
              }
            });
          }, 3000);
        }
      });
    }, 500);

    setTimeout(() => {
      if (!completed) {
        clearInterval(checkInterval);
        showToast('Product scraping timed out after 30s', 'warning');
        setStatus('Scraping timed out');
        finish(tabId);
      }
    }, 30000);
  });
}

/**
 * Shared: save a scraped response into a catalog product.
 * Called from both the backend path and the tab-based path.
 */
function _applyScrapedUpdates(response, product, rowIndex, onDone) {
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
    reviewCount: sanitized.reviewCount || sanitized.review_count || product.reviewCount || '',
    soldCount: sanitized.soldCount || sanitized.sold_count || sanitized.orders || product.soldCount || '',
    shipping: sanitized.shipping || product.shipping,
    brand: sanitized.brand || product.brand,
    sku: sanitized.sku || product.sku,
    category: sanitized.category || product.category,
    stock: sanitized.stock !== undefined ? sanitized.stock : product.stock,
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

  const scrapedId = sanitized.productId || sanitized.sku || '';
  if (scrapedId && product.productCode && product.productCode.startsWith('PROD-')) {
    updates.supplierProductId = scrapedId;
    updates.productCode = scrapedId;
  }

  if (sanitized.url && product.supplierUrl) {
    const isSearchUrl = /\/search|\/wholesale|SearchText|SearchScene|page\?/i.test(product.supplierUrl);
    if (isSearchUrl) updates.supplierUrl = sanitized.url;
  }

  if (updates.supplierPrice && updates.supplierPrice !== product.supplierPrice) {
    updates.yourPrice = calculateSellingPrice(updates.supplierPrice, parsePrice(updates.shipping || ''));
  }

  chrome.runtime.sendMessage({
    action: 'updateCatalogProduct',
    productCode: product.productCode,
    updates
  }, (resp) => {
    if (resp?.success) {
      Object.assign(state.catalog[rowIndex], updates);
      refreshCatalogTable();
      showToast(`✓ Scraped: ${sanitized.title?.substring(0, 30) || product.title?.substring(0, 30)}...`, 'success');
      setStatus(`Updated — ${sanitized._source === 'backend' ? 'via Scrapling backend' : 'via content script'}`);
    } else {
      showToast('Failed to save scraped details', 'warning');
    }
    if (typeof onDone === 'function') onDone();
  });
}

export function scrapeSelectedProducts() {
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

  showToast(`Scraping ${selected.length} products sequentially...`, 'info');
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

    scrapeProductDetails(rowIndex, () => {
      setTimeout(scrapeNext, 3000);
    });
  }

  scrapeNext();
}

export function deleteCatalogRow(rowIndex) {
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

export function deleteSelectedProducts() {
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

export function clearEntireCatalog() {
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

export function updateCatalogProduct(productCode, updates) {
  chrome.runtime.sendMessage({
    action: 'updateCatalogProduct',
    productCode,
    updates
  });
}

export function checkPrices() {
  showToast('Price checking would require visiting each supplier URL. Use the scraper on supplier pages to update prices.', 'info');
}
