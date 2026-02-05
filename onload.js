/**
 * DropshipTracker Content Script
 * Based on InstantDataScrapper's proven table detection algorithm
 * Enhanced with site-specific extractors for AliExpress/Alibaba
 */

(function() {
  "use strict";
  
  // Detected tables storage
  let detectedTables = [];
  let currentTableIndex = 0;
  let nextButtonSelector = null;
  
  // Site-specific configurations
  const SITE_CONFIGS = {
    'aliexpress.com': {
      productIdPattern: /\/item\/(\d+)\.html/,
      productIdAttr: 'data-product-id',
      priceSelectors: ['.product-price-current', '.uniform-banner-box-price', '[class*="Price_price"]'],
      titleSelectors: ['h1.product-title', 'h1[data-pl="product-title"]', '[class*="Title_title"]'],
      imageSelectors: ['.images-view-item img', '.slider--img--src img', '[class*="Gallery"] img'],
      variantSelectors: ['.sku-property-item', '[class*="Sku_property"]'],
      reviewSelectors: ['.feedback-item', '[class*="Review_item"]'],
      shippingSelectors: ['.product-shipping', '[class*="Shipping_content"]']
    },
    'alibaba.com': {
      productIdPattern: /\/product\/(\d+)\.html/,
      priceSelectors: ['.ma-ref-price', '.price-original', '[class*="price"]'],
      titleSelectors: ['h1.ma-title', '.detail-title', 'h1[class*="title"]'],
      imageSelectors: ['.detail-gallery-turn img', '.main-image img'],
      variantSelectors: ['.sku-attr-item', '.obj-attr-item'],
      reviewSelectors: ['.rating-item'],
      shippingSelectors: ['.shipping-content']
    }
  };
  
  // Get site config for current domain
  function getSiteConfig() {
    const hostname = window.location.hostname;
    for (const [domain, config] of Object.entries(SITE_CONFIGS)) {
      if (hostname.includes(domain.replace('.com', ''))) {
        return { domain, ...config };
      }
    }
    return null;
  }
  
  // Extract product ID from URL or page
  function extractProductId() {
    const config = getSiteConfig();
    const url = window.location.href;
    
    if (config && config.productIdPattern) {
      const match = url.match(config.productIdPattern);
      if (match) return match[1];
    }
    
    // Try common patterns
    const patterns = [
      /\/dp\/([A-Z0-9]{10})/,           // Amazon ASIN
      /\/item\/(\d+)/,                   // AliExpress
      /\/product\/(\d+)/,                // Alibaba
      /product[_-]?id[=:](\w+)/i,        // Generic
      /\/p\/([a-zA-Z0-9-]+)/,            // Generic slug
      /[?&]id=(\w+)/                     // Query param
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    
    // Try page elements
    const idElement = document.querySelector('[data-product-id], [data-item-id], [data-sku]');
    if (idElement) {
      return idElement.getAttribute('data-product-id') || 
             idElement.getAttribute('data-item-id') || 
             idElement.getAttribute('data-sku');
    }
    
    return null;
  }
  
  /**
   * Table Detection Algorithm (from InstantDataScrapper)
   * Scores elements by: area × childCount²
   * Higher score = more likely to be data table
   */
  function findTables(callback) {
    const pageArea = document.body.offsetWidth * document.body.offsetHeight;
    const candidates = [];
    
    document.querySelectorAll("body *").forEach(function(element) {
      // Skip invisible, script, style elements
      if (!element.offsetParent && element.tagName !== 'BODY') return;
      if (['SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT'].includes(element.tagName)) return;
      
      const rect = element.getBoundingClientRect();
      const area = rect.width * rect.height;
      
      // Skip small elements (less than 2% of page)
      if (area < 0.02 * pageArea) return;
      
      // Get consistent children (same structure)
      const childInfo = getConsistentChildren(element);
      if (childInfo.count < 3) return; // Need at least 3 items
      
      // Score = area × childCount²
      const score = area * childInfo.count * childInfo.count;
      
      candidates.push({
        element: element,
        selector: buildSelector(element),
        score: score,
        childCount: childInfo.count,
        goodClasses: childInfo.goodClasses
      });
    });
    
    // Sort by score, keep top 5
    detectedTables = candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    
    currentTableIndex = 0;
    
    if (detectedTables.length > 0) {
      highlightTable(detectedTables[0].element);
    }
    
    callback({
      tableCount: detectedTables.length,
      currentTable: currentTableIndex,
      selector: detectedTables[0]?.selector || null
    });
  }
  
  /**
   * Find children with consistent structure
   */
  function getConsistentChildren(element) {
    const children = Array.from(element.children);
    if (children.length < 3) return { count: 0, goodClasses: [] };
    
    // Track class frequency
    const classFrequency = {};
    
    children.forEach(child => {
      if (['SCRIPT', 'STYLE', 'META'].includes(child.tagName)) return;
      
      const classes = (child.className || '').toString().split(/\s+/).filter(c => c);
      const classKey = classes.sort().join(' ') || child.tagName.toLowerCase();
      
      classFrequency[classKey] = (classFrequency[classKey] || 0) + 1;
    });
    
    // Find classes that appear in at least 50% of children
    const threshold = children.length * 0.5;
    const goodClasses = Object.entries(classFrequency)
      .filter(([_, count]) => count >= threshold)
      .map(([classes]) => classes);
    
    if (goodClasses.length === 0) return { count: 0, goodClasses: [] };
    
    // Count children matching good classes
    const consistentChildren = children.filter(child => {
      const classes = (child.className || '').toString().split(/\s+/).filter(c => c);
      const classKey = classes.sort().join(' ') || child.tagName.toLowerCase();
      return goodClasses.includes(classKey);
    });
    
    return {
      count: consistentChildren.length,
      goodClasses: goodClasses
    };
  }
  
  /**
   * Build CSS selector for element
   */
  function buildSelector(element) {
    const parts = [];
    let current = element;
    
    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      
      // Use ID if available and doesn't contain numbers (often dynamic)
      if (current.id && !/\d/.test(current.id)) {
        selector += '#' + CSS.escape(current.id);
        parts.unshift(selector);
        break; // ID is unique, stop here
      } 
      // Use classes
      else if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/)
          .filter(c => c && !/\d/.test(c)) // Skip classes with numbers
          .slice(0, 2); // Max 2 classes
        
        if (classes.length > 0) {
          selector += '.' + classes.map(c => CSS.escape(c)).join('.');
        }
      }
      
      parts.unshift(selector);
      current = current.parentElement;
    }
    
    return parts.join(' > ');
  }
  
  /**
   * Highlight current table
   */
  function highlightTable(element) {
    // Remove previous highlights
    document.querySelectorAll('.dropship-table-highlight').forEach(el => {
      el.classList.remove('dropship-table-highlight');
    });
    
    if (element) {
      element.classList.add('dropship-table-highlight');
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  
  /**
   * Switch to next detected table
   */
  function nextTable(callback) {
    if (detectedTables.length === 0) {
      callback({ error: "No tables found" });
      return;
    }
    
    currentTableIndex = (currentTableIndex + 1) % detectedTables.length;
    const table = detectedTables[currentTableIndex];
    
    highlightTable(table.element);
    
    callback({
      currentTable: currentTableIndex,
      tableCount: detectedTables.length,
      selector: table.selector
    });
  }
  
  /**
   * Extract data from current table
   */
  function getTableData(callback, customSelector) {
    const table = customSelector 
      ? { element: document.querySelector(customSelector), selector: customSelector }
      : detectedTables[currentTableIndex];
    
    if (!table || !table.element) {
      callback({ error: "No table selected" });
      return;
    }
    
    const rows = [];
    const goodClasses = table.goodClasses || [];
    
    // Get row elements
    let rowElements = Array.from(table.element.children);
    
    // Filter to consistent children if we have good classes
    if (goodClasses.length > 0) {
      rowElements = rowElements.filter(child => {
        const classes = (child.className || '').toString().split(/\s+/).filter(c => c);
        const classKey = classes.sort().join(' ') || child.tagName.toLowerCase();
        return goodClasses.includes(classKey);
      });
    }
    
    // Extract data from each row
    rowElements.forEach((row, index) => {
      const rowData = extractElementData(row, '');
      rowData._rowIndex = index;
      rowData._productId = extractProductIdFromElement(row);
      rows.push(rowData);
    });
    
    callback({
      data: rows,
      tableIndex: currentTableIndex,
      tableSelector: table.selector,
      rowCount: rows.length,
      productId: extractProductId()
    });
  }
  
  /**
   * Recursively extract all data from element
   */
  function extractElementData(element, path) {
    const data = {};
    const tag = element.tagName.toLowerCase();
    const classes = (element.className || '').toString().trim().split(/\s+/).filter(c => c).slice(0, 2);
    
    const currentPath = path + '/' + tag + (classes.length ? '.' + classes.join('.') : '');
    
    // Get text content (direct, not from children)
    const directText = Array.from(element.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent.trim())
      .filter(t => t)
      .join(' ');
    
    if (directText) {
      data[currentPath] = directText;
    }
    
    // Get attributes
    if (element.href) data[currentPath + ' @href'] = element.href;
    if (element.src) data[currentPath + ' @src'] = element.src;
    if (element.alt) data[currentPath + ' @alt'] = element.alt;
    if (element.title) data[currentPath + ' @title'] = element.title;
    
    // Get data attributes
    for (const attr of element.attributes) {
      if (attr.name.startsWith('data-') && attr.value) {
        data[currentPath + ' @' + attr.name] = attr.value;
      }
    }
    
    // Get computed text for leaf nodes
    if (element.children.length === 0) {
      const text = element.textContent?.trim();
      if (text && !data[currentPath]) {
        data[currentPath] = text;
      }
    }
    
    // Recurse into children
    for (const child of element.children) {
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(child.tagName)) continue;
      Object.assign(data, extractElementData(child, currentPath));
    }
    
    return data;
  }
  
  /**
   * Try to find product ID in element
   */
  function extractProductIdFromElement(element) {
    // Check data attributes
    const dataId = element.getAttribute('data-product-id') || 
                   element.getAttribute('data-item-id') ||
                   element.getAttribute('data-id');
    if (dataId) return dataId;
    
    // Check links
    const link = element.querySelector('a[href*="item/"], a[href*="product/"], a[href*="/dp/"]');
    if (link) {
      const href = link.href;
      const patterns = [
        /\/item\/(\d+)/,
        /\/product\/(\d+)/,
        /\/dp\/([A-Z0-9]{10})/
      ];
      for (const pattern of patterns) {
        const match = href.match(pattern);
        if (match) return match[1];
      }
    }
    
    return null;
  }
  
  /**
   * Site-specific product extraction (for single product pages)
   */
  function extractProductDetails(callback) {
    const config = getSiteConfig();
    const product = {
      productId: extractProductId(),
      url: window.location.href,
      domain: window.location.hostname,
      extractedAt: Date.now()
    };
    
    // Try site-specific selectors first
    if (config) {
      product.title = trySelectors(config.titleSelectors);
      product.price = trySelectors(config.priceSelectors);
      product.images = trySelectorsAll(config.imageSelectors, 'src');
      product.variants = extractVariants(config.variantSelectors);
      product.shipping = trySelectors(config.shippingSelectors);
    }
    
    // Fallback to generic extraction
    if (!product.title) {
      product.title = document.querySelector('h1')?.textContent?.trim();
    }
    
    if (!product.price) {
      // Look for price patterns
      const pricePattern = /[\$€£¥]\s*[\d,]+\.?\d*/;
      const priceElements = document.querySelectorAll('[class*="price"], [class*="Price"]');
      for (const el of priceElements) {
        const text = el.textContent;
        const match = text.match(pricePattern);
        if (match) {
          product.price = match[0];
          break;
        }
      }
    }
    
    if (!product.images || product.images.length === 0) {
      product.images = Array.from(document.querySelectorAll('img[src*="product"], img[src*="item"]'))
        .map(img => img.src)
        .filter(src => src && !src.includes('avatar') && !src.includes('logo'))
        .slice(0, 10);
    }
    
    // Try to get description
    product.description = document.querySelector(
      '[class*="description"], [class*="Description"], #product-description, .product-description'
    )?.innerHTML;
    
    // Try JSON-LD structured data
    const jsonLd = document.querySelector('script[type="application/ld+json"]');
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd.textContent);
        if (data['@type'] === 'Product' || data.product) {
          const prod = data.product || data;
          product.title = product.title || prod.name;
          product.description = product.description || prod.description;
          product.price = product.price || prod.offers?.price;
          product.currency = prod.offers?.priceCurrency;
          product.sku = prod.sku;
          product.brand = prod.brand?.name || prod.brand;
        }
      } catch (e) {}
    }
    
    callback(product);
  }
  
  /**
   * Try multiple selectors, return first match
   */
  function trySelectors(selectors) {
    if (!selectors) return null;
    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          return el.textContent?.trim() || el.value;
        }
      } catch (e) {}
    }
    return null;
  }
  
  /**
   * Try selectors and get all matches
   */
  function trySelectorsAll(selectors, attr = null) {
    if (!selectors) return [];
    const results = [];
    
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach(el => {
          const value = attr ? el[attr] || el.getAttribute(attr) : el.textContent?.trim();
          if (value && !results.includes(value)) {
            results.push(value);
          }
        });
        if (results.length > 0) break;
      } catch (e) {}
    }
    
    return results;
  }
  
  /**
   * Extract variant/option information
   */
  function extractVariants(selectors) {
    if (!selectors) return [];
    const variants = [];
    
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach(el => {
          variants.push({
            name: el.getAttribute('title') || el.textContent?.trim(),
            image: el.querySelector('img')?.src,
            selected: el.classList.contains('selected') || el.classList.contains('active'),
            value: el.getAttribute('data-value') || el.getAttribute('data-sku')
          });
        });
        if (variants.length > 0) break;
      } catch (e) {}
    }
    
    return variants;
  }
  
  /**
   * Let user select next button
   */
  function selectNextButton(callback) {
    // Remove existing listeners
    document.removeEventListener('click', nextButtonClickHandler, true);
    document.removeEventListener('mouseover', highlightHoverHandler, true);
    
    // Store callback
    window._nextButtonCallback = callback;
    
    // Add listeners
    document.addEventListener('click', nextButtonClickHandler, true);
    document.addEventListener('mouseover', highlightHoverHandler, true);
    
    // Add selection mode style
    document.body.classList.add('dropship-selecting-next');
  }
  
  function nextButtonClickHandler(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const selector = buildSelector(e.target);
    nextButtonSelector = selector;
    
    // Clean up
    document.removeEventListener('click', nextButtonClickHandler, true);
    document.removeEventListener('mouseover', highlightHoverHandler, true);
    document.body.classList.remove('dropship-selecting-next');
    
    // Remove hover highlight
    document.querySelectorAll('.dropship-hover-highlight').forEach(el => {
      el.classList.remove('dropship-hover-highlight');
    });
    
    // Mark as next button
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
  
  /**
   * Click the next button
   */
  function clickNextButton(callback, selector) {
    const sel = selector || nextButtonSelector;
    if (!sel) {
      callback({ error: "No next button selector" });
      return;
    }
    
    const button = document.querySelector(sel);
    if (!button) {
      callback({ error: "Next button not found", selector: sel });
      return;
    }
    
    button.click();
    callback({ success: true, clicked: sel });
  }
  
  /**
   * Scroll for infinite scroll pages
   */
  function scrollDown(callback) {
    const scrollTarget = document.scrollingElement || document.body;
    const beforeHeight = scrollTarget.scrollHeight;
    
    window.scrollTo(0, scrollTarget.scrollHeight);
    
    setTimeout(() => {
      const afterHeight = scrollTarget.scrollHeight;
      callback({
        scrolled: true,
        heightChanged: afterHeight > beforeHeight,
        newHeight: afterHeight
      });
    }, 1000);
  }
  
  /**
   * Get page hash for duplicate detection
   */
  function getPageHash(callback) {
    const content = document.body.innerText.substring(0, 10000);
    // Use existing sha256 library
    if (typeof sha256 !== 'undefined') {
      const hash = sha256.create();
      hash.update(content);
      callback({ hash: hash.hex() });
    } else {
      // Simple fallback hash
      let hash = 0;
      for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      callback({ hash: hash.toString(16) });
    }
  }
  
  // Message listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
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
        
      case 'ping':
        sendResponse({ alive: true, url: window.location.href });
        return true;
    }
  });
  
  console.log("[DropshipTracker] Content script loaded on", window.location.hostname);
})();
