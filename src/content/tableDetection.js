/**
 * Table detection algorithm (from InstantDataScrapper)
 * Scores elements by: area * childCount^2
 * Detects repeating data structures in the DOM
 */

import { contentState } from './contentState.js';

// ============================================
// TABLE DETECTION
// ============================================

/**
 * Table Detection Algorithm
 * Scores elements by: area * childCount^2
 * Higher score = more likely to be data table
 */
export function findTables(callback) {
  const pageArea = document.body.offsetWidth * document.body.offsetHeight;
  const candidates = [];

  document.querySelectorAll("body *").forEach(function(element) {
    if (!element.offsetParent && element.tagName !== 'BODY') return;
    if (['SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT'].includes(element.tagName)) return;

    const rect = element.getBoundingClientRect();
    const area = rect.width * rect.height;

    if (area < 0.02 * pageArea) return;

    const childInfo = getConsistentChildren(element);
    if (childInfo.count < 3) return;

    const score = area * childInfo.count * childInfo.count;

    candidates.push({
      element: element,
      selector: buildSelector(element),
      childCount: childInfo.count,
      childSelector: childInfo.selector,
      score: score,
      area: area
    });
  });

  candidates.sort((a, b) => b.score - a.score);

  contentState.detectedTables = candidates.slice(0, 10);
  contentState.currentTableIndex = 0;

  if (contentState.detectedTables.length > 0) {
    highlightTable(contentState.detectedTables[0]);
  }

  callback({
    found: contentState.detectedTables.length,
    tables: contentState.detectedTables.map((t, i) => ({
      index: i,
      selector: t.selector,
      childCount: t.childCount,
      score: Math.round(t.score)
    }))
  });
}

/**
 * Get consistent children of an element
 * Uses 3 strategies (full class-set, individual class, all non-empty children)
 */
export function getConsistentChildren(container, maxSample) {
  const children = Array.from(container.children).filter(
    child => !['SCRIPT', 'STYLE', 'BR', 'HR'].includes(child.tagName)
  );

  if (children.length < 3) return { count: 0, selector: null };

  // Strategy 1: Group by full class set
  const classCounts = {};
  children.forEach(child => {
    const classes = (child.className || '').toString().split(/\s+/).filter(c => c);
    const key = classes.sort().join(' ') || child.tagName.toLowerCase();
    classCounts[key] = (classCounts[key] || 0) + 1;
  });

  // Find most common class pattern with 3+ instances
  let bestClass = null;
  let bestCount = 0;
  for (const [cls, count] of Object.entries(classCounts)) {
    if (count > bestCount && count >= 3) {
      bestClass = cls;
      bestCount = count;
    }
  }

  if (bestClass && bestCount >= 3) {
    return {
      count: bestCount,
      selector: bestClass.includes(' ') ? '.' + bestClass.split(' ').join('.') : (bestClass.includes('.') ? bestClass : '.' + bestClass)
    };
  }

  // Strategy 2: Group by individual class names
  const individualClassCounts = {};
  children.forEach(child => {
    const classes = (child.className || '').toString().split(/\s+/).filter(c => c);
    classes.forEach(cls => {
      individualClassCounts[cls] = (individualClassCounts[cls] || 0) + 1;
    });
  });

  let bestIndividualClass = null;
  let bestIndividualCount = 0;
  for (const [cls, count] of Object.entries(individualClassCounts)) {
    if (count > bestIndividualCount && count >= 3) {
      bestIndividualClass = cls;
      bestIndividualCount = count;
    }
  }

  if (bestIndividualClass && bestIndividualCount >= 3) {
    return { count: bestIndividualCount, selector: '.' + bestIndividualClass };
  }

  // Strategy 3: All non-empty children
  const nonEmptyChildren = children.filter(child => {
    const text = child.textContent?.trim();
    return text && text.length > 5;
  });

  if (nonEmptyChildren.length >= 3) {
    return { count: nonEmptyChildren.length, selector: '*' };
  }

  return { count: 0, selector: null };
}

/**
 * Build a CSS selector for an element
 */
export function buildSelector(element) {
  const parts = [];
  let current = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector = '#' + CSS.escape(current.id);
      parts.unshift(selector);
      break;
    }

    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(c => c).slice(0, 2);
      if (classes.length > 0) {
        selector += '.' + classes.map(c => CSS.escape(c)).join('.');
      }
    }

    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += ':nth-child(' + index + ')';
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

/**
 * Highlight the currently detected table
 */
export function highlightTable(table) {
  // Remove previous highlights
  document.querySelectorAll('.dropship-table-highlight').forEach(el => {
    el.classList.remove('dropship-table-highlight');
    el.style.outline = '';
  });

  if (table && table.element) {
    table.element.style.outline = '3px dashed #0066ff';
    table.element.classList.add('dropship-table-highlight');
    table.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/**
 * Cycle to next detected table
 */
export function nextTable(callback) {
  if (contentState.detectedTables.length === 0) {
    callback({ error: "No tables detected" });
    return;
  }

  contentState.currentTableIndex = (contentState.currentTableIndex + 1) % contentState.detectedTables.length;
  const table = contentState.detectedTables[contentState.currentTableIndex];

  highlightTable(table);

  callback({
    index: contentState.currentTableIndex,
    total: contentState.detectedTables.length,
    selector: table.selector,
    childCount: table.childCount
  });
}
