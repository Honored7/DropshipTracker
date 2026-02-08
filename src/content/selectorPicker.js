/**
 * Selector Picker — let users click page elements to define custom selectors
 * Creates CSS selectors for clicked elements and stores them for extraction
 */

import { contentState } from './contentState.js';
import { extractSampleValue } from './utils.js';

// ============================================
// SELECTOR PICKER
// ============================================

/**
 * Start the selector picker mode
 */
export function startSelectorPicker(callback, fieldName) {
  if (contentState.selectorPickerActive) {
    stopSelectorPicker();
  }

  contentState.selectorPickerActive = true;
  contentState.selectorPickerCallback = null;
  contentState.selectorPickerField = fieldName;

  if (!document.getElementById('dropship-picker-styles')) {
    const style = document.createElement('style');
    style.id = 'dropship-picker-styles';
    style.textContent = `
      .dropship-picker-hover {
        outline: 3px dashed #00ff00 !important;
        outline-offset: 2px;
        cursor: crosshair !important;
        background-color: rgba(0, 255, 0, 0.1) !important;
      }
      .dropship-picker-selected {
        outline: 3px solid #0066ff !important;
        outline-offset: 2px;
        background-color: rgba(0, 102, 255, 0.1) !important;
      }
      .dropship-picker-overlay {
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: #fff;
        padding: 12px 24px;
        border-radius: 8px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        pointer-events: none;
      }
      .dropship-picker-info {
        position: fixed;
        bottom: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.85);
        color: #fff;
        padding: 8px 16px;
        border-radius: 6px;
        z-index: 2147483647;
        font-family: monospace;
        font-size: 11px;
        max-width: 80%;
        word-break: break-all;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.id = 'dropship-picker-overlay';
  overlay.className = 'dropship-picker-overlay';
  overlay.textContent = 'Click element for "' + fieldName + '" | Press ESC to cancel';
  document.body.appendChild(overlay);

  const info = document.createElement('div');
  info.id = 'dropship-picker-info';
  info.className = 'dropship-picker-info';
  info.textContent = 'Hover over elements to see selector...';
  document.body.appendChild(info);

  document.addEventListener('mouseover', pickerHoverHandler, true);
  document.addEventListener('mouseout', pickerUnhoverHandler, true);
  document.addEventListener('click', pickerClickHandler, true);
  document.addEventListener('keydown', pickerEscHandler, true);

  callback({ started: true, field: fieldName });
}

function pickerHoverHandler(e) {
  if (!contentState.selectorPickerActive) return;
  e.target.classList.add('dropship-picker-hover');

  const info = document.getElementById('dropship-picker-info');
  if (info) {
    const selector = buildUniqueSelector(e.target);
    const value = extractSampleValue(e.target);
    info.textContent = 'Selector: ' + selector.substring(0, 80) + (selector.length > 80 ? '...' : '') +
      ' | Value: ' + (value || '').substring(0, 60) + ((value || '').length > 60 ? '...' : '');
  }
}

function pickerUnhoverHandler(e) {
  if (!contentState.selectorPickerActive) return;
  e.target.classList.remove('dropship-picker-hover');
}

function pickerClickHandler(e) {
  if (!contentState.selectorPickerActive) return;

  e.preventDefault();
  e.stopPropagation();

  const element = e.target;
  const selector = buildUniqueSelector(element);
  const sampleValue = extractSampleValue(element);

  element.classList.remove('dropship-picker-hover');
  element.classList.add('dropship-picker-selected');

  contentState.customSelectors[contentState.selectorPickerField] = {
    selector: selector,
    sampleValue: sampleValue,
    savedAt: Date.now()
  };

  const fieldName = contentState.selectorPickerField;
  stopSelectorPicker();

  try {
    chrome.runtime.sendMessage({
      action: 'selectorPickerResult',
      success: true,
      field: fieldName,
      selector: selector,
      sampleValue: sampleValue,
      domain: window.location.hostname
    });
  } catch (e) {
    console.log('[DropshipTracker] Could not send picker result:', e);
  }
}

function pickerEscHandler(e) {
  if (e.key === 'Escape' && contentState.selectorPickerActive) {
    const field = contentState.selectorPickerField;
    stopSelectorPicker();
    try {
      chrome.runtime.sendMessage({
        action: 'selectorPickerResult',
        cancelled: true,
        field: field
      });
    } catch (err) {
      console.log('[DropshipTracker] Could not send cancel:', err);
    }
  }
}

/**
 * Stop the selector picker mode
 */
export function stopSelectorPicker() {
  contentState.selectorPickerActive = false;

  document.removeEventListener('mouseover', pickerHoverHandler, true);
  document.removeEventListener('mouseout', pickerUnhoverHandler, true);
  document.removeEventListener('click', pickerClickHandler, true);
  document.removeEventListener('keydown', pickerEscHandler, true);

  const overlay = document.getElementById('dropship-picker-overlay');
  if (overlay) overlay.remove();
  const info = document.getElementById('dropship-picker-info');
  if (info) info.remove();

  document.querySelectorAll('.dropship-picker-hover').forEach(el => {
    el.classList.remove('dropship-picker-hover');
  });
}

/**
 * Build a unique CSS selector for an element
 */
export function buildUniqueSelector(element) {
  const parts = [];
  let current = element;
  let maxIterations = 50;

  while (current && current !== document.body && current !== document.documentElement && maxIterations-- > 0) {
    let selector = current.tagName.toLowerCase();

    if (current.id && document.querySelectorAll('#' + CSS.escape(current.id)).length === 1) {
      selector = '#' + CSS.escape(current.id);
      parts.unshift(selector);
      break;
    }

    const stableAttrs = ['data-product-id', 'data-item-id', 'data-sku', 'data-testid', 'role'];
    for (const attr of stableAttrs) {
      const val = current.getAttribute(attr);
      if (val && !val.includes(' ')) {
        selector += `[${attr}="${CSS.escape(val)}"]`;
        parts.unshift(selector);
        if (document.querySelectorAll(parts.join(' > ')).length === 1) {
          return parts.join(' > ');
        }
        break;
      }
    }

    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/)
        .filter(c => c && !/^\d|--|__|index-\d/.test(c))
        .slice(0, 3);
      if (classes.length > 0) {
        selector += '.' + classes.map(c => CSS.escape(c)).join('.');
      }
    }

    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

// ============================================
// CUSTOM SELECTOR HELPERS
// ============================================

export function getCustomSelector(field) {
  return contentState.customSelectors[field] || null;
}

export function extractWithCustomSelector(selector) {
  const element = document.querySelector(selector);
  if (!element) return null;
  return extractSampleValue(element);
}

export function extractAllWithSelector(selector) {
  const elements = document.querySelectorAll(selector);
  if (elements.length === 0) return [];
  return Array.from(elements).map(el => extractSampleValue(el)).filter(v => v);
}

export function getAllCustomSelectors(callback) {
  callback(contentState.customSelectors);
}
