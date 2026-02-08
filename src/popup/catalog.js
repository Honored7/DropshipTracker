/**
 * Catalog CRUD – load, add, scrape details, delete, update, check prices
 */
/* global $, chrome, SanitizeService */

import { state } from './state.js';
import {
  sendToContentScript, setStatus, showToast, showLoading, hideLoading,
  parsePrice, calculateSellingPrice, getShortFieldName
} from './utils.js';
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

    const supplierProductId = getMappedValue('product_code') || rawRow._supplierProductId || '';
    const supplierSku = getMappedValue('supplier_sku') || rawRow._supplierSku || '';

    const productCode = supplierProductId ||
                        rawRow['Product ID'] ||
                        `PROD-${Date.now()}-${index}`;

    const priceStr = getMappedValue('price') || rawRow.Price || '';
    const price = parsePrice(priceStr);

    const primaryImages = getMappedValue('images') || rawRow.Images || '';
    const additionalImages = getMappedValue('additional_images') || '';
    const allImages = [primaryImages, additionalImages]
      .filter(i => i)
      .join(',')
      .split(/[,|||]+/)
      .map(i => i.trim())
      .filter(i => i && i.startsWith('http'));

    const shippingCostValue = parsePrice(getMappedValue('shipping_cost') || '');

    return {
      productCode: productCode,
      supplierProductId: supplierProductId,
      supplierSku: supplierSku,
      title: getMappedValue('product_name') || rawRow.Title || 'Untitled Product',
      supplierPrice: price,
      yourPrice: calculateSellingPrice(price, shippingCostValue),
      listPrice: parsePrice(getMappedValue('list_price') || rawRow['List Price'] || ''),
      stock: parseInt(getMappedValue('quantity')) || 999,
      category: getMappedValue('category') || state.settings?.defaultCategory || '',
      description: getMappedValue('description') || rawRow.Description || '',
      shortDescription: getMappedValue('short_description') || '',
      images: allImages.length > 0 ? allImages.join(',') : '',
      supplierUrl: getMappedValue('url') || findProductUrl() || rawRow.URL || state.tabUrl,
      domain: state.tabDomain || new URL(state.tabUrl || 'http://unknown').hostname,
      variants: getMappedValue('variants') || rawRow.Variants || rawRow.variants || '',
      color: getMappedValue('color') || '',
      size: getMappedValue('size') || '',
      shipping: getMappedValue('shipping') || rawRow.Shipping || '',
      shippingCost: shippingCostValue,
      brand: getMappedValue('brand') || rawRow.Brand || '',
      rating: getMappedValue('rating') || rawRow.Rating || '',
      reviewCount: getMappedValue('review_count') || rawRow.Reviews || rawRow['Review Count'] || '',
      soldCount: getMappedValue('sold_count') || rawRow['Sold'] || rawRow['Orders'] || '',
      reviews: getMappedValue('reviews') || rawRow.Reviews || rawRow.reviews || rawRow['Review Text'] || '',
      storeName: getMappedValue('store_name') || '',
      storeRating: getMappedValue('store_rating') || '',
      meta_keywords: getMappedValue('meta_keywords') || '',
      meta_description: getMappedValue('meta_description') || '',
      attributes: getMappedValue('attributes') || '',
      specifications: getMappedValue('specifications') || rawRow.Specifications || '',
      minOrder: getMappedValue('min_order') || '',
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

export function updateCatalogFromPage() {
  setStatus('Extracting product to update catalog...');

  sendToContentScript({ action: 'extractProduct' }, (response) => {
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

  setStatus(`Opening product page for scraping: ${product.title?.substring(0, 40)}...`);

  const ERROR_PAGE_PATTERNS = /^(HTTP\s*Status\s*\d|4\d{2}\s|5\d{2}\s|Access\s*Denied|Forbidden|Not\s*Found|Bad\s*Request|Service\s*Unavailable|Error|Page\s*Not\s*Found|Server\s*Error|Unauthorized)/i;

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
                  if (isSearchUrl) {
                    updates.supplierUrl = sanitized.url;
                  }
                }

                if (updates.supplierPrice && updates.supplierPrice !== product.supplierPrice) {
                  updates.yourPrice = calculateSellingPrice(updates.supplierPrice, parsePrice(updates.shipping || ''));
                }

                chrome.runtime.sendMessage({
                  action: 'updateCatalogProduct',
                  productCode: product.productCode,
                  updates: updates
                }, (resp) => {
                  if (resp?.success) {
                    Object.assign(state.catalog[rowIndex], updates);
                    refreshCatalogTable();
                    showToast(`✓ Scraped details for: ${sanitized.title?.substring(0, 30) || product.title?.substring(0, 30)}...`, 'success');
                    setStatus('Product details updated');
                  } else {
                    showToast('Failed to save scraped details', 'warning');
                  }
                  finish(tabId);
                });
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
