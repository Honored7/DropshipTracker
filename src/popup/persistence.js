/**
 * Data persistence – save/load scraped sessions, field mappings & custom selectors
 */
/* global $, chrome */

import { state } from './state.js';
import { updateDataTable } from './dataTable.js';
import { showFieldMapping } from './fieldMapping.js';
import { updateRowCount, updateExportButtons, setStatus, showToast } from './utils.js';

/**
 * Save scraped data to chrome.storage.local
 * Prevents data loss when popup closes
 */
export function saveScrapedData() {
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
export function loadScrapedData() {
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
export function clearScrapedSession() {
  chrome.storage.local.remove('scrapedSession');
}

// ============================================
// PERSISTENT FIELD MAPPING (per domain)
// ============================================

/**
 * Load persisted field mappings for current domain
 */
export function loadPersistedFieldMapping() {
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
export function savePersistedFieldMapping() {
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
export function loadCustomSelectors() {
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
export function saveCustomSelectors() {
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
export function updateCustomSelectorsList() {
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
