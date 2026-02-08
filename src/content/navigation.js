/**
 * Navigation — next button selection, clicking, scrolling, page hash
 */

import { contentState } from './contentState.js';
import { buildSelector } from './tableDetection.js';
import { findScrollableParent, simulateFullClick } from './utils.js';

// ============================================
// NEXT BUTTON SELECTION
// ============================================

/**
 * Let user select next button by clicking
 */
export function selectNextButton(callback) {
  document.removeEventListener('click', nextButtonClickHandler, true);
  document.removeEventListener('mouseover', highlightHoverHandler, true);

  window._nextButtonCallback = callback;

  document.addEventListener('click', nextButtonClickHandler, true);
  document.addEventListener('mouseover', highlightHoverHandler, true);

  document.body.classList.add('dropship-selecting-next');
}

function nextButtonClickHandler(e) {
  e.preventDefault();
  e.stopPropagation();

  const selector = buildSelector(e.target);
  contentState.nextButtonSelector = selector;

  document.removeEventListener('click', nextButtonClickHandler, true);
  document.removeEventListener('mouseover', highlightHoverHandler, true);
  document.body.classList.remove('dropship-selecting-next');

  document.querySelectorAll('.dropship-hover-highlight').forEach(el => {
    el.classList.remove('dropship-hover-highlight');
  });

  e.target.classList.add('dropship-next-button');

  if (window._nextButtonCallback) {
    window._nextButtonCallback({ selector, element: e.target.outerHTML.substring(0, 200) });
  }
}

function highlightHoverHandler(e) {
  document.querySelectorAll('.dropship-hover-highlight').forEach(el => {
    el.classList.remove('dropship-hover-highlight');
  });
  e.target.classList.add('dropship-hover-highlight');
}

// ============================================
// NEXT BUTTON CLICK
// ============================================

/**
 * Click the next button using full mouse event simulation
 */
export function clickNextButton(callback, selector) {
  const sel = selector || contentState.nextButtonSelector;
  if (!sel) {
    callback({ error: "No next button selector" });
    return;
  }

  const button = document.querySelector(sel);
  if (!button) {
    callback({ error: "Next button not found", selector: sel });
    return;
  }

  simulateFullClick(button);
  callback({ success: true, clicked: sel });
}

// ============================================
// SCROLL & PAGE HASH
// ============================================

/**
 * Incremental scroll for infinite scroll pages
 * Scrolls 1000px at a time, monitors child count + scroll position
 */
export function scrollDown(callback) {
  const table = contentState.detectedTables[contentState.currentTableIndex];
  const tableElement = table?.element;
  const scrollTarget = tableElement
    ? findScrollableParent(tableElement)
    : (document.scrollingElement || document.body);

  const countChildren = () => {
    if (tableElement) return tableElement.children.length;
    return 0;
  };

  let prevChildCount = countChildren();
  let prevScrollTop = scrollTarget.scrollTop;
  let iterations = 0;
  const maxIterations = 30;

  function scrollStep() {
    iterations++;
    if (iterations > maxIterations) {
      callback({ scrolled: true, heightChanged: false, reason: 'max_iterations' });
      return;
    }

    scrollTarget.scrollTop += 1000;

    setTimeout(() => {
      const currChildCount = countChildren();
      const currScrollTop = scrollTarget.scrollTop;

      const childrenChanged = currChildCount !== prevChildCount;
      const scrollStuck = currScrollTop === prevScrollTop;

      if (childrenChanged) {
        callback({ scrolled: true, heightChanged: true, newChildren: currChildCount });
        return;
      }

      if (scrollStuck) {
        callback({ scrolled: true, heightChanged: false, reason: 'bottom_reached' });
        return;
      }

      prevChildCount = currChildCount;
      prevScrollTop = currScrollTop;
      scrollStep();
    }, 1000);
  }

  scrollStep();
}

/**
 * Get page hash for duplicate detection
 * Uses detected table text instead of body text for precision
 */
export function getPageHash(callback) {
  const table = contentState.detectedTables[contentState.currentTableIndex];
  const content = table?.element
    ? table.element.innerText.substring(0, 10000)
    : document.body.innerText.substring(0, 10000);

  if (typeof sha256 !== 'undefined') {
    const hash = sha256.create();
    hash.update(content);
    callback({ hash: hash.hex() });
  } else {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    callback({ hash: hash.toString(16) });
  }
}
