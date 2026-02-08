/**
 * Content script entry point
 * Loads custom selectors on init, registers chrome.runtime.onMessage dispatcher
 */

import { contentState } from './contentState.js';
import { findTables, nextTable } from './tableDetection.js';
import { getTableData } from './tableExtraction.js';
import { extractProductDetails } from './productExtraction.js';
import { selectNextButton, clickNextButton, scrollDown, getPageHash } from './navigation.js';
import {
  startSelectorPicker,
  stopSelectorPicker,
  getAllCustomSelectors,
  extractWithCustomSelector,
  extractAllWithSelector
} from './selectorPicker.js';

// ============================================
// CUSTOM SELECTORS PERSISTENCE
// ============================================

function loadCustomSelectors(callback) {
  const domain = window.location.hostname;
  const key = `customSelectors_${domain}`;

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([key], (result) => {
      contentState.customSelectors = result[key] || {};
      callback && callback(contentState.customSelectors);
    });
  } else {
    callback && callback({});
  }
}

function saveCustomSelectors(callback) {
  const domain = window.location.hostname;
  const key = `customSelectors_${domain}`;

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ [key]: contentState.customSelectors }, () => {
      callback && callback({ success: true });
    });
  }
}

// ============================================
// INIT
// ============================================

// Load custom selectors on init
loadCustomSelectors();

// ============================================
// MESSAGE LISTENER
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'ping':
      sendResponse({ pong: true });
      return false;

    case 'findTables':
      findTables(sendResponse);
      return true;

    case 'nextTable':
      nextTable(sendResponse);
      return true;

    case 'getTableData':
      getTableData(sendResponse, request.selector);
      return true;

    case 'extractProduct':
      extractProductDetails(sendResponse);
      return true;

    case 'selectNextButton':
      selectNextButton(sendResponse);
      return true;

    case 'clickNext':
      clickNextButton(sendResponse, request.selector);
      return true;

    case 'scrollDown':
      scrollDown(sendResponse);
      return true;

    case 'getPageHash':
      getPageHash(sendResponse);
      return true;

    case 'startSelectorPicker':
      startSelectorPicker(sendResponse, request.field);
      return true;

    case 'stopSelectorPicker':
      stopSelectorPicker();
      sendResponse({ stopped: true });
      return true;

    case 'getCustomSelectors':
      getAllCustomSelectors(sendResponse);
      return true;

    case 'saveCustomSelectors':
      contentState.customSelectors = request.selectors || {};
      saveCustomSelectors(sendResponse);
      return true;

    case 'extractWithSelector':
      sendResponse({
        value: extractWithCustomSelector(request.selector),
        allValues: extractAllWithSelector(request.selector)
      });
      return true;
  }
});

console.log("[DropshipTracker] Content script loaded on", window.location.hostname);
