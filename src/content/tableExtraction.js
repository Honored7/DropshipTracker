/**
 * Table data extraction
 * Extracts structured data from detected table elements
 * Two modes: 'table' (lean IDS-like) and 'product' (comprehensive)
 */

import { contentState } from './contentState.js';
import {
  extractProductId,
  extractProductIdFromElement,
  extractSupplierSku,
  normalizeImageUrl,
  lazyScrollElements,
  extractSampleValue
} from './utils.js';
import { getConsistentChildren } from './tableDetection.js';

// ============================================
// TABLE DATA EXTRACTION
// ============================================

/**
 * Extract data from the currently selected table
 */
export function getTableData(callback, customSelector) {
  const table = customSelector
    ? { element: document.querySelector(customSelector), selector: customSelector }
    : contentState.detectedTables[contentState.currentTableIndex];

  if (!table || !table.element) {
    callback({ error: "No table selected" });
    return;
  }

  const rows = [];
  const childInfo = getConsistentChildren(table.element);
  let rowElements = Array.from(table.element.children).filter(
    child => !['SCRIPT', 'STYLE', 'BR', 'HR'].includes(child.tagName)
  );

  // Determine which classes are "good" (consistent item classes)
  const classCounts = {};
  rowElements.forEach(child => {
    const classes = (child.className || '').toString().split(/\s+/).filter(c => c);
    const key = classes.sort().join(' ') || child.tagName.toLowerCase();
    classCounts[key] = (classCounts[key] || 0) + 1;
  });

  const goodClasses = Object.entries(classCounts)
    .filter(([, count]) => count >= 3)
    .map(([cls]) => cls);

  // Filter to consistent children if we have good classes
  if (goodClasses.length > 0) {
    rowElements = rowElements.filter(child => {
      const classes = (child.className || '').toString().split(/\s+/).filter(c => c);
      const classKey = classes.sort().join(' ') || child.tagName.toLowerCase();
      return goodClasses.includes(classKey);
    });
  }

  // Lazy-scroll each row element into view first (triggers lazy images/content)
  // then extract data from each row in COMPREHENSIVE MODE
  lazyScrollElements(rowElements, () => {
    const { customSelectors } = contentState;

    rowElements.forEach((row, index) => {
      // Skip noise elements (nav, footer, header, ads)
      const tag = row.tagName.toLowerCase();
      if (['nav', 'footer', 'header', 'aside'].includes(tag)) return;
      if (row.getAttribute('role') === 'navigation') return;
      const cls = (row.className || '').toString().toLowerCase();
      if (/\b(ad|ads|advert|banner|promo|sponsor)\b/.test(cls)) return;

      const rowData = extractElementData(row, '', { mode: 'table' });
      rowData._rowIndex = index;
      rowData._supplierProductId = extractProductIdFromElement(row);
      rowData._supplierSku = extractSupplierSku(row);

      // === CUSTOM SELECTORS: Append data from user-picked selectors ===
      if (customSelectors && Object.keys(customSelectors).length > 0) {
        for (const [fieldId, config] of Object.entries(customSelectors)) {
          if (!config || !config.selector) continue;
          try {
            let el = row.querySelector(config.selector);
            if (!el) {
              const simpleClass = config.selector.match(/\.([a-zA-Z0-9_-]+)/);
              if (simpleClass) {
                el = row.querySelector('.' + simpleClass[1]);
              }
            }
            if (el) {
              const value = extractSampleValue(el);
              if (value) {
                rowData['_custom_' + fieldId] = value;
              }
            }
          } catch(e) { /* selector syntax error — skip */ }
        }
      }

      rows.push(rowData);
    });

    callback({
      data: rows,
      tableIndex: contentState.currentTableIndex,
      tableSelector: table.selector,
      rowCount: rows.length,
      productId: extractProductId()
    });
  });
}

/**
 * Recursively extract data from element
 *
 * TWO MODES:
 *
 * mode: 'table' (default for list/table scraping)
 *   IDS-like extraction — only captures 3 things per element:
 *   1. Direct text (own text, not from children)
 *   2. href property (on anchors)
 *   3. src property (on images)
 *
 * mode: 'product' (for single product detail pages)
 *   Full comprehensive extraction — text, href, src, data-*, alt, title,
 *   combined @link fields, image deduplication, etc.
 */
export function extractElementData(element, path, options = {}) {
  const mode = options.mode || 'product';
  const data = {};
  const tag = element.tagName.toLowerCase();
  const classes = (element.className || '').toString().trim().split(/\s+/).filter(c => c).slice(0, 2);

  const currentPath = path + '/' + tag + (classes.length ? '.' + classes.join('.') : '');

  // =====================================================
  // TABLE MODE: IDS-like lean extraction (text + href + src)
  // =====================================================
  if (mode === 'table') {
    const directText = Array.from(element.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent.trim())
      .filter(t => t)
      .join(' ');

    if (directText) {
      data[currentPath] = directText;
    }

    if (element.tagName === 'A' && element.href) {
      data[currentPath + ' href'] = element.href;
    }

    if (element.src) {
      data[currentPath + ' src'] = element.src;
    }

    for (const child of element.children) {
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'].includes(child.tagName)) continue;
      Object.assign(data, extractElementData(child, currentPath, options));
    }

    return data;
  }

  // =====================================================
  // PRODUCT MODE: Full comprehensive extraction
  // =====================================================

  const directText = Array.from(element.childNodes)
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent.trim())
    .filter(t => t)
    .join(' ');

  if (directText) {
    data[currentPath] = directText;
  }

  if (element.tagName === 'A' && element.href) {
    const linkText = element.textContent?.trim();
    const href = element.href;
    data[currentPath + ' @href'] = href;
    if (linkText && linkText.length > 3 && linkText.length < 300) {
      data[currentPath + ' @link'] = linkText + ' ||| ' + href;
    }
  } else if (element.href) {
    data[currentPath + ' @href'] = element.href;
  }

  // Capture images with deduplication
  const seenImages = options._seenImages || new Set();
  if (element.src) {
    const normalizedSrc = normalizeImageUrl(element.src);
    if (!seenImages.has(normalizedSrc)) {
      seenImages.add(normalizedSrc);
      data[currentPath + ' @src'] = element.src;
    }
  }

  const dataSrc = element.getAttribute('data-src') || element.getAttribute('data-lazy-src');
  if (dataSrc && dataSrc.startsWith('http')) {
    const normalizedDataSrc = normalizeImageUrl(dataSrc);
    if (!seenImages.has(normalizedDataSrc)) {
      seenImages.add(normalizedDataSrc);
      data[currentPath + ' @data-src'] = dataSrc;
    }
  }

  if (element.alt) data[currentPath + ' @alt'] = element.alt;
  if (element.title && element.title.length < 200) data[currentPath + ' @title'] = element.title;

  // Get data attributes
  for (const attr of element.attributes) {
    if (attr.name.startsWith('data-') && attr.value && attr.value.length < 500) {
      const skipAttrs = ['data-spm', 'data-aplus', 'data-beacon'];
      if (!skipAttrs.some(s => attr.name.startsWith(s))) {
        data[currentPath + ' @' + attr.name] = attr.value;
      }
    }
  }

  // Get computed text for leaf nodes
  if (element.children.length === 0) {
    const text = element.textContent?.trim();
    if (text && !data[currentPath]) {
      data[currentPath] = text;
    }
  }

  // Recurse into children (skip noise)
  for (const child of element.children) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'].includes(child.tagName)) continue;
    Object.assign(data, extractElementData(child, currentPath, { ...options, _seenImages: seenImages }));
  }

  return data;
}
