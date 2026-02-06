/**
 * DropshipTracker Background Service Worker
 * Handles: popup window creation, periodic sync alarms, message routing
 */

// Open popup as separate window when extension icon clicked
chrome.action.onClicked.addListener(function(tab) {
  chrome.windows.create({
    url: chrome.runtime.getURL("popup.html?tabid=" + encodeURIComponent(tab.id) + "&url=" + encodeURIComponent(tab.url)),
    type: "popup",
    width: 900,
    height: 700
  });
});

// Setup periodic sync alarm (every 6 hours)
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("priceStockCheck", { periodInMinutes: 360 });
  console.log("[DropshipTracker] Extension installed, sync alarm created");
});

// Handle alarm triggers
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "priceStockCheck") {
    console.log("[DropshipTracker] Price/stock check alarm triggered");
    checkPriceStockUpdates();
  }
});

// Check for price/stock changes in catalog
async function checkPriceStockUpdates() {
  try {
    const data = await chrome.storage.local.get(['catalog', 'settings']);
    const catalog = data.catalog || [];
    const settings = data.settings || {};
    
    if (!settings.autoSync || catalog.length === 0) {
      return;
    }
    
    // Flag products that need checking (older than 24 hours)
    const now = Date.now();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    const needsCheck = catalog.filter(p => 
      !p.lastChecked || (now - p.lastChecked) > staleThreshold
    );
    
    if (needsCheck.length > 0) {
      // Store products needing update
      await chrome.storage.local.set({ 
        pendingChecks: needsCheck.map(p => p.supplierUrl) 
      });
      
      // Create notification
      console.log(`[DropshipTracker] ${needsCheck.length} products need price/stock check`);
    }
  } catch (error) {
    console.error("[DropshipTracker] Error checking price/stock:", error);
  }
}

// Message handler for cross-component communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'getCatalog':
      chrome.storage.local.get(['catalog'], (data) => {
        sendResponse({ catalog: data.catalog || [] });
      });
      return true; // Async response
      
    case 'saveToCatalog':
      saveToCatalog(request.products).then(result => {
        sendResponse(result);
      });
      return true;
      
    case 'updateCatalogProduct':
      updateCatalogProduct(request.productCode, request.updates).then(result => {
        sendResponse(result);
      });
      return true;
      
    case 'deleteCatalogProducts':
      deleteCatalogProducts(request.productCodes).then(result => {
        sendResponse(result);
      });
      return true;
      
    case 'removeFromCatalog':
      deleteCatalogProducts([request.productCode]).then(result => {
        sendResponse(result);
      });
      return true;
      
    case 'clearCatalog':
      clearCatalog().then(result => {
        sendResponse(result);
      });
      return true;
      
    case 'getSettings':
      chrome.storage.local.get(['settings'], (data) => {
        sendResponse({ settings: data.settings || getDefaultSettings() });
      });
      return true;
      
    case 'saveSettings':
      chrome.storage.local.set({ settings: request.settings }, () => {
        sendResponse({ success: true });
      });
      return true;
      
    case 'getSuppliers':
      chrome.storage.local.get(['suppliers'], (data) => {
        sendResponse({ suppliers: data.suppliers || [] });
      });
      return true;
      
    case 'saveSupplier':
      saveSupplier(request.supplier).then(result => {
        sendResponse(result);
      });
      return true;
      
    case 'deleteSupplier':
      deleteSupplier(request.domain).then(result => {
        sendResponse(result);
      });
      return true;
  }
});

// Delete supplier
async function deleteSupplier(domain) {
  try {
    const data = await chrome.storage.local.get(['suppliers']);
    const suppliers = (data.suppliers || []).filter(s => s.domain !== domain);
    await chrome.storage.local.set({ suppliers });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Save products to catalog
async function saveToCatalog(products) {
  try {
    const data = await chrome.storage.local.get(['catalog']);
    const catalog = data.catalog || [];
    
    let added = 0, updated = 0;
    
    for (const product of products) {
      const existingIndex = catalog.findIndex(p => p.productCode === product.productCode);
      
      if (existingIndex >= 0) {
        // Update existing - preserve history
        const existing = catalog[existingIndex];
        catalog[existingIndex] = {
          ...existing,
          ...product,
          priceHistory: [
            ...(existing.priceHistory || []),
            { price: product.supplierPrice, date: Date.now() }
          ].slice(-30), // Keep last 30 price points
          lastUpdated: Date.now()
        };
        updated++;
      } else {
        // Add new
        catalog.push({
          ...product,
          addedDate: Date.now(),
          lastChecked: Date.now(),
          priceHistory: [{ price: product.supplierPrice, date: Date.now() }]
        });
        added++;
      }
    }
    
    await chrome.storage.local.set({ catalog });
    return { success: true, added, updated, total: catalog.length };
  } catch (error) {
    console.error("[DropshipTracker] Error saving to catalog:", error);
    return { success: false, error: error.message };
  }
}

// Update single catalog product
async function updateCatalogProduct(productCode, updates) {
  try {
    const data = await chrome.storage.local.get(['catalog']);
    const catalog = data.catalog || [];
    
    const index = catalog.findIndex(p => p.productCode === productCode);
    if (index >= 0) {
      catalog[index] = { ...catalog[index], ...updates, lastUpdated: Date.now() };
      await chrome.storage.local.set({ catalog });
      return { success: true };
    }
    return { success: false, error: "Product not found" };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Delete products from catalog
async function deleteCatalogProducts(productCodes) {
  try {
    const data = await chrome.storage.local.get(['catalog']);
    let catalog = data.catalog || [];
    
    const initialCount = catalog.length;
    catalog = catalog.filter(p => !productCodes.includes(p.productCode));
    
    await chrome.storage.local.set({ catalog });
    return { success: true, deleted: initialCount - catalog.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Clear entire catalog
async function clearCatalog() {
  try {
    await chrome.storage.local.set({ catalog: [] });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Save supplier configuration
async function saveSupplier(supplier) {
  try {
    const data = await chrome.storage.local.get(['suppliers']);
    const suppliers = data.suppliers || [];
    
    const existingIndex = suppliers.findIndex(s => s.domain === supplier.domain);
    if (existingIndex >= 0) {
      suppliers[existingIndex] = { ...suppliers[existingIndex], ...supplier };
    } else {
      suppliers.push(supplier);
    }
    
    await chrome.storage.local.set({ suppliers });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Default settings
function getDefaultSettings() {
  return {
    autoSync: false,
    syncInterval: 360, // minutes
    defaultMargin: 30, // percent
    marginType: 'percent', // 'percent' or 'fixed'
    currency: 'USD',
    googleDriveFolder: 'DropshipTracker',
    cscartDelimiter: '///',
    language: 'en',
    roundPrices: true,
    roundTo: 0.99 // Round to x.99
  };
}

console.log("[DropshipTracker] Background service worker loaded");
