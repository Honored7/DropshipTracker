/**
 * DropshipTracker Content Script
 * Based on InstantDataScrapper's proven table detection algorithm
 * Enhanced with manual selector picker and comprehensive data extraction
 */

(function() {
  "use strict";
  
  // Detected tables storage
  let detectedTables = [];
  let currentTableIndex = 0;
  let nextButtonSelector = null;
  
  // Custom selectors defined by user (loaded from storage)
  let customSelectors = {};
  
  // Selector picker state
  let selectorPickerActive = false;
  let selectorPickerCallback = null;
  let selectorPickerField = null;
  
  // Site-specific configurations
  const SITE_CONFIGS = {
    'aliexpress.com': {
      productIdPattern: /\/item\/(\d+)\.html/,
      productIdAttr: 'data-product-id',
      titleSelectors: [
        'h1[data-pl="product-title"]',
        '.product-title-text',
        'h1.pdp-title',
        '[class*="ProductTitle--text"]',
        '[class*="title--wrap"] h1',
        '[class*="HalfLayout--title"]',
        '.product-title',
        'h1'
      ],
      priceSelectors: [
        '[class*="Price--currentPriceText"]',
        '[class*="es--wrap--"] [class*="es--char--"]',
        '.product-price-current span',
        '[class*="uniform-banner-box-price"]',
        '[class*="price"] [class*="current"]',
        '.product-price-value'
      ],
      originalPriceSelectors: [
        '[class*="Price--originalText"]',
        '[class*="price--original"]',
        '.product-price-original',
        '[class*="price"] del',
        '[class*="price"] s',
        '[class*="price--compare"]',
        '[class*="price"] [class*="del"]'
      ],
      imageSelectors: [
        '.images-view-list img',
        '[class*="slider--wrap"] img',
        '[class*="Gallery"] img[src*="aliexpress"]',
        '.pdp-info-image img',
        '[class*="image-view"] img'
      ],
      variantSelectors: [
        '.sku-property',
        '[class*="Sku--property"]',
        '[class*="skuItem"]',
        '[class*="sku-item"]'
      ],
      reviewSelectors: [
        '.feedback-item',
        '[class*="Review--wrap"]',
        '[class*="reviewItem"]',
        '[class*="review-item"]'
      ],
      shippingSelectors: ['.product-shipping', '[class*="Shipping"]', '[class*="delivery"]'],
      breadcrumbSelectors: [
        '[class*="breadcrumb"] a',
        '.breadcrumb a',
        'nav[aria-label*="breadcrumb"] a',
        '[class*="CategoryPath"] a',
        '[class*="category-path"] a'
      ],
      storeSelectors: [
        '[class*="store-name"]',
        '[class*="StoreName"]',
        '.shop-name a',
        '[class*="shopName"]',
        '[class*="seller-name"]'
      ],
      storeRatingSelectors: [
        '[class*="store-rating"]',
        '[class*="StoreRating"]',
        '[class*="seller-rating"]',
        '[class*="store"] [class*="score"]'
      ],
      stockSelectors: [
        '[class*="quantity--info"]',
        '[class*="stock"]',
        '[class*="Quantity--available"]',
        '[class*="inventory"]'
      ],
      descriptionSelectors: [
        '.pdp-description-text',
        '[class*="description"]',
        '[class*="Description"]',
        '#product-description',
        '.product-description',
        '[class*="detail-desc"]'
      ],
      specSelectors: [
        '.pdp-mod-product-specs',
        '[class*="specification"]',
        '[class*="Specification"]',
        '.product-specs',
        '[class*="product-prop"]',
        '.product-property-list'
      ],
      videoSelectors: [
        'video source',
        'iframe[src*="video"]',
        '[class*="video"] video',
        '[class*="Video"] source'
      ],
      // JSON data patterns embedded in page scripts
      jsonPatterns: [
        '_initData\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;',
        '__INITIAL_STATE__\\s*=\\s*(\\{[\\s\\S]*?\\});',
        'window\\.__state__\\s*=\\s*(\\{[\\s\\S]*?\\});',
        'data:\\s*(\\{[\\s\\S]*?"offers"[\\s\\S]*?\\})'
      ]
    },
    'alibaba.com': {
      productIdPattern: /\/product\/([\d-]+)\.html|product_detail[^?]*?([\d]{5,})|offer\/([\d]+)/,
      titleSelectors: [
        'h1.ma-title',
        '.detail-title',
        '.module-pdp-title h1',
        'h1[class*="title"]'
      ],
      priceSelectors: [
        '.ma-ref-price .ma-ref-price-value',
        '.ma-ref-price',
        '.price-original .price-value',
        '.price-original',
        '.module-pdp-price .price-value',
        '.module-pdp-price .price'
      ],
      originalPriceSelectors: [
        '[class*="price--original"]',
        '[class*="ref-price"]',
        '[class*="price"] del',
        '[class*="price"] s'
      ],
      imageSelectors: [
        '.detail-gallery-turn img',
        '.main-image img',
        '[class*="gallery"] img',
        '.thumb-list img'
      ],
      variantSelectors: ['.sku-attr-item', '.obj-attr-item', '[class*="sku-prop"]'],
      reviewSelectors: ['.rating-item', '[class*="review"]'],
      shippingSelectors: ['.shipping-content', '[class*="logistics"]'],
      breadcrumbSelectors: [
        '.breadcrumb a',
        '[class*="breadcrumb"] a',
        'nav[aria-label*="breadcrumb"] a',
        '.category-nav a'
      ],
      storeSelectors: [
        '.company-name a',
        '[class*="supplierName"]',
        '[class*="company-name"]',
        '.shop-name'
      ],
      storeRatingSelectors: [
        '[class*="supplier-rating"]',
        '[class*="score"]'
      ],
      stockSelectors: [
        '[class*="stock"]',
        '[class*="inventory"]'
      ],
      moqSelectors: [
        '[class*="min-order"]',
        '[class*="moq"]',
        '[class*="minimum"]'
      ],
      descriptionSelectors: [
        '.do-entry-item-description',
        '[class*="description"]',
        '[class*="Description"]',
        '.module-pdp-desc'
      ],
      specSelectors: [
        '[class*="Spec"]',
        '.do-entry-item',
        '.product-attr-list',
        '.attribute-list'
      ],
      videoSelectors: [
        'video source',
        'iframe[src*="video"]'
      ],
      // JSON data patterns embedded in page scripts
      jsonPatterns: [
        '__INITIAL_STATE__\\s*=\\s*(\\{[\\s\\S]*?\\});?',
        'window\\.__data__\\s*=\\s*(\\{[\\s\\S]*?\\});?',
        '_init_data_\\s*=\\s*(\\{[\\s\\S]*?\\})'
      ]
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
      if (match) {
        // Return first non-null capture group (pattern may have alternations)
        return match[1] || match[2] || match[3] || match[0];
      }
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
   * Scores elements by: area * childCount^2
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
      
      // Score = area * childCount^2
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
    
    // Track class frequency — skip noise elements (IDS: script, img, meta, style)
    // and skip empty-text children (IDS filters these before counting)
    const classFrequency = {};
    const singleClassFrequency = {};
    
    children.forEach(child => {
      if (['SCRIPT', 'STYLE', 'META', 'IMG', 'NOSCRIPT', 'LINK'].includes(child.tagName)) return;
      // IDS key insight: skip children with no visible text — they're decorative
      if (!child.textContent || !child.textContent.trim().length) return;
      
      const classes = (child.className || '').toString().split(/\s+/).filter(c => c);
      const classKey = classes.sort().join(' ') || child.tagName.toLowerCase();
      
      classFrequency[classKey] = (classFrequency[classKey] || 0) + 1;
      
      // Also track individual class frequency (IDS fallback strategy)
      classes.forEach(c => {
        singleClassFrequency[c] = (singleClassFrequency[c] || 0) + 1;
      });
    });
    
    // Find classes that appear frequently enough (lenient threshold from IDS)
    // Using length/2 - 2 instead of length * 0.5 to detect tables with
    // heterogeneous header/footer rows mixed in
    const threshold = Math.max(2, Math.floor(children.length / 2) - 2);
    
    // STRATEGY 1: Full class-set matching (primary)
    let goodClasses = Object.entries(classFrequency)
      .filter(([_, count]) => count >= threshold)
      .map(([classes]) => classes);
    
    // STRATEGY 2 (IDS fallback): Individual class matching
    // When children share SOME classes but not all (e.g. "card card-featured" vs "card card-normal")
    if (goodClasses.length === 0) {
      const goodSingleClasses = Object.entries(singleClassFrequency)
        .filter(([_, count]) => count >= threshold)
        .map(([cls]) => cls);
      
      if (goodSingleClasses.length > 0) {
        // Filter children that have at least one of the good individual classes
        const matchingChildren = children.filter(child => {
          if (['SCRIPT', 'STYLE', 'META', 'IMG', 'NOSCRIPT', 'LINK'].includes(child.tagName)) return false;
          if (!child.textContent || !child.textContent.trim().length) return false;
          const classes = (child.className || '').toString().split(/\s+/).filter(c => c);
          return goodSingleClasses.some(gc => classes.includes(gc));
        });
        
        if (matchingChildren.length >= 3) {
          return {
            count: matchingChildren.length,
            goodClasses: goodSingleClasses
          };
        }
      }
    }
    
    // STRATEGY 3 (IDS fallback): Return ALL non-empty children if no class patterns found
    // IDS never gives up — it always returns something for elements with enough children
    if (goodClasses.length === 0) {
      const nonEmptyChildren = children.filter(child => {
        if (['SCRIPT', 'STYLE', 'META', 'IMG', 'NOSCRIPT', 'LINK'].includes(child.tagName)) return false;
        return child.textContent && child.textContent.trim().length > 0;
      });
      
      if (nonEmptyChildren.length >= 3) {
        return {
          count: nonEmptyChildren.length,
          goodClasses: [] // Empty = accept all when filtering in getTableData
        };
      }
      
      return { count: 0, goodClasses: [] };
    }
    
    // Count children matching good classes (Strategy 1 succeeded)
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
   * Uses comprehensive mode to capture ALL data - filtering happens in popup
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
    
    // Lazy-scroll each row element into view first (triggers lazy images/content)
    // then extract data from each row in COMPREHENSIVE MODE
    lazyScrollElements(rowElements, () => {
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
        // Try each custom selector relative to this row element first, then page-wide
        if (customSelectors && Object.keys(customSelectors).length > 0) {
          for (const [fieldId, config] of Object.entries(customSelectors)) {
            if (!config || !config.selector) continue;
            try {
              // First try within the row element (for table/list pages with repeating items)
              let el = row.querySelector(config.selector);
              if (!el) {
                // Try a relative match: if the selector targets a class, look for it inside the row
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
        tableIndex: currentTableIndex,
        tableSelector: table.selector,
        rowCount: rows.length,
        productId: extractProductId()
      });
    });
  }
  
  /**
   * Recursively extract data from element
   *
   * TWO MODES (ported from IDS analysis):
   *
   * mode: 'table' (default for list/table scraping)
   *   IDS-like extraction — only captures 3 things per element:
   *   1. Direct text (own text, not from children)
   *   2. href property (on anchors)
   *   3. src property (on images)
   *   This produces clean, column-friendly data with 5-15 columns instead of 50+.
   *
   * mode: 'product' (for single product detail pages)
   *   Full comprehensive extraction — text, href, src, data-*, alt, title,
   *   combined @link fields, image deduplication, etc.
   *   Preserved for extractProductDetails() which needs rich data.
   */
  function extractElementData(element, path, options = {}) {
    const mode = options.mode || 'product'; // 'table' or 'product'
    const data = {};
    const tag = element.tagName.toLowerCase();
    const classes = (element.className || '').toString().trim().split(/\s+/).filter(c => c).slice(0, 2);
    
    const currentPath = path + '/' + tag + (classes.length ? '.' + classes.join('.') : '');
    
    // =====================================================
    // TABLE MODE: IDS-like lean extraction (text + href + src)
    // =====================================================
    if (mode === 'table') {
      // 1. Direct text — IDS approach: clone, remove children, get remaining text
      // Using text-node filtering (equivalent without jQuery)
      const directText = Array.from(element.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent.trim())
        .filter(t => t)
        .join(' ');
      
      if (directText) {
        data[currentPath] = directText;
      }
      
      // 2. href — on anchor tags
      if (element.tagName === 'A' && element.href) {
        data[currentPath + ' href'] = element.href;
      }
      
      // 3. src — on images and other elements with src
      if (element.src) {
        data[currentPath + ' src'] = element.src;
      }
      
      // Recurse into children (skip noise)
      for (const child of element.children) {
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'].includes(child.tagName)) continue;
        Object.assign(data, extractElementData(child, currentPath, options));
      }
      
      return data;
    }
    
    // =====================================================
    // PRODUCT MODE: Full comprehensive extraction
    // =====================================================
    
    // Get text content (direct, not from children)
    const directText = Array.from(element.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent.trim())
      .filter(t => t)
      .join(' ');
    
    if (directText) {
      data[currentPath] = directText;
    }
    
    // For <a> tags, capture text + href together as a combined field
    if (element.tagName === 'A' && element.href) {
      const linkText = element.textContent?.trim();
      const href = element.href;
      data[currentPath + ' @href'] = href;
      // Combined link field for easier mapping
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
    
    // Get data-src (lazy loaded images) - deduplicated
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
  
  /**
   * Normalize image URL for deduplication
   */
  function normalizeImageUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      // Remove common size/quality params
      u.search = '';
      return u.href.replace(/_\d+x\d+[^.]*/g, '').replace(/\?.*$/, '');
    } catch (e) {
      return url.replace(/\?.*$/, '');
    }
  }
  
  /**
   * Check if URL is a valid product URL (not tracking/redirect)
   */
  function isValidProductUrl(url) {
    if (!url || typeof url !== 'string') return false;
    
    // Reject tracking/redirect URLs
    const trackingPatterns = [
      'click.alibaba.com',
      'us-click.alibaba.com',
      'click.aliexpress.com',
      'ae-click.aliexpress.com',
      'gw.alicdn.com/tps',
      '/ci_bb',
      '/ot=local',
      'beacon.',
      'tracker.',
      'analytics.',
      'ads.alibaba',
      'ad.alibaba',
      'click?',
      'redirect?',
      'track?'
    ];
    
    const lower = url.toLowerCase();
    if (trackingPatterns.some(pattern => lower.includes(pattern))) {
      return false;
    }
    
    // Must be a normal product URL
    return url.startsWith('http') && (
      url.includes('/item/') ||
      url.includes('/product/') ||
      url.includes('/dp/') ||
      url.includes('.html') ||
      url.includes('/p/')
    );
  }
  
  /**
   * Clean product URL - extract real URL from redirect
   */
  function cleanProductUrl(url) {
    if (!url) return '';
    
    // Try to extract real URL from redirect
    try {
      const urlObj = new URL(url);
      const targetParam = urlObj.searchParams.get('url') || 
                          urlObj.searchParams.get('target') ||
                          urlObj.searchParams.get('redirect');
      if (targetParam && targetParam.startsWith('http')) {
        return decodeURIComponent(targetParam);
      }
    } catch(e) {}
    
    return url;
  }
  
  /**
   * Check if URL is a valid image URL
   */
  function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (!url.startsWith('http')) return false;
    
    // Reject tracking pixels and tiny images
    const rejectPatterns = ['1x1', 'pixel', 'beacon', 'tracker', 'analytics', 'stat.'];
    if (rejectPatterns.some(p => url.toLowerCase().includes(p))) return false;
    
    // Should be an image
    return url.match(/\.(jpg|jpeg|png|gif|webp)/i) || 
           url.includes('alicdn.com') || 
           url.includes('imgur.') ||
           url.includes('cloudfront.');
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
   * Extract supplier SKU from element (separate from product ID)
   */
  function extractSupplierSku(element) {
    // Check SKU-specific data attributes
    const sku = element.getAttribute('data-sku') || 
                element.getAttribute('data-product-sku') ||
                element.getAttribute('data-sku-id');
    if (sku) return sku;
    
    // Look for SKU text
    const skuEl = element.querySelector('[class*="sku"], [class*="itemId"], [class*="product-id"]');
    if (skuEl) {
      const text = skuEl.textContent?.trim();
      if (text && text.length < 50) return text;
    }
    
    return null;
  }
  
  /**
   * Parse a price string into a numeric value
   */
  function parsePriceText(text) {
    if (!text) return null;
    const pricePatterns = [
      /[\$\u20AC\u00A3\u00A5\u20A6]\s*([\d,]+\.?\d*)/,     // $12.99, EUR12.99, etc.
      /([\d,]+\.?\d*)\s*[\$\u20AC\u00A3\u00A5\u20A6]/,     // 12.99$
      /(?:NGN|USD|EUR|GBP)\s*([\d,]+\.?\d*)/i,  // NGN 1234
      /([\d,]+\.?\d*)\s*(?:NGN|USD|EUR|GBP)/i   // 1234 NGN
    ];
    for (const pattern of pricePatterns) {
      const match = text.match(pattern);
      if (match) {
        const num = parseFloat(match[1].replace(/,/g, ''));
        if (num > 0.01 && num < 10000000) return num;
      }
    }
    return null;
  }
  
  /**
   * Detect currency from text or meta
   */
  function detectCurrency() {
    // Try meta tags
    const currencyMeta = document.querySelector(
      'meta[property="product:price:currency"], meta[itemprop="priceCurrency"], meta[name="currency"]'
    );
    if (currencyMeta) return currencyMeta.content;
    
    // Try from price text on page
    const priceEl = document.querySelector('[class*="price" i]');
    if (priceEl) {
      const text = priceEl.textContent || '';
      if (text.includes('$') || /USD/i.test(text)) return 'USD';
      if (text.includes('\u20AC') || /EUR/i.test(text)) return 'EUR';
      if (text.includes('\u00A3') || /GBP/i.test(text)) return 'GBP';
      if (text.includes('\u00A5') || /JPY|CNY/i.test(text)) return 'CNY';
      if (text.includes('\u20A6') || /NGN/i.test(text)) return 'NGN';
    }
    
    return null;
  }
  
  /**
   * Extract product data from embedded JSON in page scripts
   * This is 85-95% more stable than CSS selectors since JSON structures
   * rarely change on site redesigns. Ported from cscart-export project.
   */
  function extractEmbeddedJSON(config) {
    const result = {};
    
    // Try JSON patterns from site config
    if (config && config.jsonPatterns) {
      const scripts = document.querySelectorAll('script:not([type]), script[type="text/javascript"]');
      for (const script of scripts) {
        const text = script.textContent;
        if (!text || text.length < 50) continue;
        
        for (const patternStr of config.jsonPatterns) {
          try {
            const regex = new RegExp(patternStr);
            const match = text.match(regex);
            if (match && match[1]) {
              const jsonStr = match[1];
              const data = JSON.parse(jsonStr);
              mergeJSONProductData(result, data, config);
              // Do NOT early return — keep scanning all scripts for more data
            }
          } catch(e) {
            // JSON parse failures are expected for partial matches
          }
        }
      }
    }
    
    return Object.keys(result).length > 0 ? result : null;
  }
  
  /**
   * Walk JSON data structure to find product fields
   * Handles common e-commerce JSON structures from AliExpress, Alibaba, etc.
   * Extended with AliExpress module paths (skuModule, specsModule, etc.)
   */
  function mergeJSONProductData(result, data, config) {
    if (!data || typeof data !== 'object') return;
    
    // Walk known paths for product data — including AliExpress page modules
    const searchPaths = [
      data,
      data.data,
      data.pageData,
      data.productData,
      data.product,
      data.item,
      data.storeModule,
      data.priceModule,
      data.titleModule,
      data.descriptionModule,
      // AliExpress-specific modules
      data.skuModule,
      data.specsModule,
      data.orderModule,
      data.imageModule,
      data.shippingModule,
      data.commonModule,
      data.quantityModule,
      data.reviewModule,
      data.couponModule,
      data.buyerProtectionModule,
      // Nested data paths
      data.data?.product,
      data.data?.priceInfo,
      data.data?.skuInfo,
      data.data?.specsInfo,
      data.result,
      data.result?.product,
    ].filter(Boolean);
    
    for (const obj of searchPaths) {
      // Title
      if (!result.title) {
        result.title = obj.title || obj.name || obj.productTitle || 
                       obj.subject || obj.productName || null;
      }
      
      // Price
      if (!result.price) {
        const priceObj = obj.price || obj.priceInfo || obj.formatedActivityPrice || 
                         obj.activityPrice || obj.minPrice || obj.salePrice || null;
        if (typeof priceObj === 'object' && priceObj) {
          result.price = priceObj.value || priceObj.minPrice || priceObj.formatedPrice || 
                         priceObj.actPrice || priceObj.salePrice || priceObj.discountPrice?.minPrice ||
                         priceObj.formatedActivityPrice || null;
          result.originalPrice = result.originalPrice || priceObj.originalPrice || priceObj.maxPrice || 
                                 priceObj.formatedBiggestPrice || priceObj.formatedPrice || null;
          result.currency = result.currency || priceObj.currency || priceObj.currencySymbol || 
                            priceObj.currencyCode || null;
        } else if (priceObj) {
          result.price = priceObj;
        }
      }
      
      // Images
      if (!result.images || result.images.length === 0) {
        const imgs = obj.images || obj.imagePathList || obj.imagePaths || 
                     obj.gallery || obj.imageList || obj.productImages || null;
        if (Array.isArray(imgs) && imgs.length > 0) {
          result.images = imgs.map(img => {
            if (typeof img === 'string') return img.startsWith('//') ? 'https:' + img : img;
            return img.url || img.src || img.imgUrl || img.imageUrl || '';
          }).filter(Boolean).slice(0, 15);
        }
      }
      
      // SKU
      if (!result.sku) {
        result.sku = obj.sku || obj.productId || obj.itemId || obj.id || null;
      }
      
      // Category
      if (!result.category && obj.breadcrumb) {
        const crumbs = Array.isArray(obj.breadcrumb) ? obj.breadcrumb : [obj.breadcrumb];
        result.category = crumbs
          .map(c => typeof c === 'string' ? c : (c.name || c.title || ''))
          .filter(Boolean).join(' > ');
      }
      // AliExpress categoryPath
      if (!result.category && obj.categoryPath) {
        result.category = obj.categoryPath;
      }
      
      // Rating
      if (!result.rating) {
        result.rating = obj.averageStar || obj.averageRating || obj.rating || 
                        obj.evarageStar || obj.starRating || null;
      }
      if (!result.reviewCount) {
        result.reviewCount = obj.totalReviews || obj.reviewCount || obj.tradeCount || 
                             obj.totalCount || obj.feedbackCount || null;
      }
      
      // Order count (AliExpress)
      if (!result.orders) {
        result.orders = obj.tradeCount || obj.orderCount || obj.totalOrder || null;
      }
      
      // Description
      if (!result.description) {
        result.description = obj.description || obj.detailDesc || obj.productDescription || null;
      }
      
      // Brand
      if (!result.brand) {
        result.brand = obj.brand || obj.brandName || 
                       (typeof obj.brand === 'object' ? obj.brand?.name : null) || null;
      }
      
      // Stock / quantity
      if (result.stock === undefined) {
        const stock = obj.stock || obj.quantity || obj.totalAvailQuantity || 
                      obj.availQuantity || obj.totalStock || null;
        if (stock !== null && stock !== undefined) {
          result.stock = typeof stock === 'number' ? stock : parseInt(stock, 10) || stock;
        }
      }
      
      // Shipping
      if (!result.shipping) {
        const ship = obj.shippingFee || obj.freightAmount || obj.shippingPrice || null;
        if (ship) {
          result.shipping = typeof ship === 'object' ? (ship.formatedAmount || ship.value || ship) : ship;
        }
        if (!result.shipping && obj.freeShipping) {
          result.shipping = 'Free Shipping';
        }
      }
      
      // Min order (Alibaba)
      if (!result.minOrder) {
        result.minOrder = obj.minOrder || obj.moq || obj.minOrderQuantity || null;
      }
      
      // Variants / SKU properties
      if ((!result.variants || result.variants.length === 0) && obj.skuPriceList) {
        result.variants = obj.skuPriceList.map(sku => ({
          id: sku.skuId || sku.id,
          price: sku.skuVal?.actSkuCalPrice || sku.skuVal?.skuCalPrice || sku.price,
          stock: sku.skuVal?.availQuantity || sku.stock,
          attributes: sku.skuAttr || sku.skuPropIds || ''
        }));
      }
      if ((!result.variants || result.variants.length === 0) && obj.productSKUPropertyList) {
        // AliExpress property groups (color, size, etc.)
        result.variantGroups = obj.productSKUPropertyList.map(group => ({
          name: group.skuPropertyName,
          values: (group.skuPropertyValues || []).map(v => ({
            name: v.propertyValueDisplayName || v.propertyValueName,
            image: v.skuPropertyImagePath || null
          }))
        }));
      }
      
      // Specifications
      if (!result.specifications && obj.specifications) {
        result.specifications = obj.specifications;
      }
      if (!result.specifications && obj.properties) {
        const props = Array.isArray(obj.properties) ? obj.properties : [];
        result.specifications = props.map(p => ({
          name: p.name || p.attrName || p.key || '',
          value: p.value || p.attrValue || p.val || ''
        })).filter(s => s.name && s.value);
      }
      // AliExpress attrList
      if (!result.specifications && obj.attrList) {
        result.specifications = obj.attrList.map(a => ({
          name: a.attrName || a.name || '',
          value: a.attrValue || a.value || ''
        })).filter(s => s.name && s.value);
      }
    }
  }

  /**
   * Lazy-scroll rows into view before extraction
   * Triggers lazy loading of images and dynamic content
   * Ported from InstantDataScrapper's function E
   */
  function lazyScrollElements(elements, callback) {
    if (!elements || elements.length === 0) {
      callback();
      return;
    }
    
    // Adaptive delay: faster for fewer elements
    const delay = elements.length > 50 ? 30 : elements.length > 20 ? 50 : 80;
    let index = 0;
    
    function scrollNext() {
      if (index >= elements.length) {
        callback();
        return;
      }
      
      const el = elements[index];
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
      index++;
      setTimeout(scrollNext, delay);
    }
    
    scrollNext();
  }
  
  /**
   * Find the nearest scrollable parent of an element
   * Ported from InstantDataScrapper's function N
   */
  function findScrollableParent(element) {
    let current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
        return current;
      }
      current = current.parentElement;
    }
    return document.scrollingElement || document.body;
  }
  
  /**
   * Full mouse event simulation for clicking elements
   * Ported from InstantDataScrapper's function C
   * Some SPAs (React/Vue) require mousedown + click + mouseup sequence
   */
  function simulateFullClick(element) {
    if (!element) return;
    
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    
    const eventOpts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x + window.screenX,
      screenY: y + window.screenY
    };
    
    element.dispatchEvent(new MouseEvent('mousedown', eventOpts));
    element.dispatchEvent(new MouseEvent('click', eventOpts));
    element.dispatchEvent(new MouseEvent('mouseup', eventOpts));
  }

  /**
   * Extract video URLs from the page
   */
  function extractVideoUrls(config) {
    const urls = new Set();
    
    const selectors = config?.videoSelectors || [
      'video source',
      'iframe[src*="video"]',
      '[class*="video"] video',
      'video[src]'
    ];
    
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach(el => {
          const src = el.src || el.getAttribute('src') || el.getAttribute('data-src');
          if (src && src.startsWith('http')) urls.add(src);
        });
      } catch(e) {}
    }
    
    return Array.from(urls);
  }
  
  /**
   * Extract specifications/attributes table
   */
  function extractSpecifications(config) {
    const specs = [];
    const seen = new Set();
    
    const selectors = config?.specSelectors || [
      '.product-specs',
      '[class*="specification"]',
      '[class*="Specification"]',
      '.product-property-list'
    ];
    
    // Try site-specific spec selectors first
    for (const sel of selectors) {
      try {
        const container = document.querySelector(sel);
        if (!container) continue;
        
        // Try key-value pairs within the container
        container.querySelectorAll('li, tr, .do-entry-item, [class*="prop-item"], [class*="attr-item"]').forEach(item => {
          const nameEl = item.querySelector('[class*="name"], [class*="label"], [class*="key"], th, td:first-child, dt, .prop-name');
          const valueEl = item.querySelector('[class*="value"], [class*="val"], td:last-child, dd, .prop-value');
          
          if (nameEl && valueEl) {
            const name = nameEl.textContent?.trim();
            const value = valueEl.textContent?.trim();
            const key = (name + ':' + value).toLowerCase();
            if (name && value && name !== value && !seen.has(key)) {
              seen.add(key);
              specs.push({ name, value });
            }
          }
        });
        
        if (specs.length > 0) break;
      } catch(e) {}
    }
    
    // Fallback: Look for definition lists
    if (specs.length === 0) {
      document.querySelectorAll('dl').forEach(dl => {
        const dts = dl.querySelectorAll('dt');
        const dds = dl.querySelectorAll('dd');
        const count = Math.min(dts.length, dds.length);
        for (let i = 0; i < count; i++) {
          const name = dts[i].textContent?.trim();
          const value = dds[i].textContent?.trim();
          const key = (name + ':' + value).toLowerCase();
          if (name && value && !seen.has(key)) {
            seen.add(key);
            specs.push({ name, value });
          }
        }
      });
    }
    
    return specs;
  }

  /**
   * Site-specific product extraction (for single product pages)
   * Now also checks custom selectors from Pick Selector feature
   * ENHANCED: Extracts original price, short description, category,
   * stock, weight, store info, shipping cost, currency, Open Graph tags
   * NEW: JSON-first extraction strategy + videos + specifications
   */
  function extractProductDetails(callback) {
    const config = getSiteConfig();
    const product = {
      productId: extractProductId(),
      url: window.location.href,
      domain: window.location.hostname,
      extractedAt: Date.now()
    };
    
    // Helper to try custom selector first, then fallback
    const tryCustomOrFallback = (field, fallbackFn) => {
      const custom = customSelectors[field];
      if (custom && custom.selector) {
        try {
          const el = document.querySelector(custom.selector);
          if (el) {
            const value = extractSampleValue(el);
            if (value) return value;
          }
        } catch(e) {}
      }
      return fallbackFn ? fallbackFn() : null;
    };
    
    // === EMBEDDED JSON DATA (highest reliability, from cscart-export project) ===
    const jsonData = extractEmbeddedJSON(config);
    if (jsonData) {
      // Merge JSON-extracted data as base layer
      if (jsonData.title) product.title = jsonData.title;
      if (jsonData.price) product.price = jsonData.price;
      if (jsonData.originalPrice) product.originalPrice = jsonData.originalPrice;
      if (jsonData.currency) product.currency = jsonData.currency;
      if (jsonData.description) product.description = jsonData.description;
      if (jsonData.images && jsonData.images.length > 0) product.images = jsonData.images;
      if (jsonData.sku) product.sku = jsonData.sku;
      if (jsonData.brand) product.brand = jsonData.brand;
      if (jsonData.category) product.category = jsonData.category;
      if (jsonData.stock !== undefined) product.stock = jsonData.stock;
      if (jsonData.rating) product.rating = jsonData.rating;
      if (jsonData.reviewCount) product.reviewCount = jsonData.reviewCount;
      if (jsonData.variants) product.variants = jsonData.variants;
      if (jsonData.specifications) product.specifications = jsonData.specifications;
    }
    
    // === JSON-LD STRUCTURED DATA ===
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const jsonLd of jsonLdScripts) {
      try {
        const data = JSON.parse(jsonLd.textContent);
        const prod = data['@type'] === 'Product' ? data : (data.product || null);
        if (prod) {
          product.title = prod.name;
          product.description = prod.description;
          product.price = prod.offers?.price || prod.offers?.lowPrice;
          product.originalPrice = prod.offers?.highPrice || null;
          product.currency = prod.offers?.priceCurrency;
          product.sku = prod.sku;
          product.brand = prod.brand?.name || prod.brand;
          product.availability = prod.offers?.availability;
          if (prod.image) {
            product.images = Array.isArray(prod.image) ? prod.image : [prod.image];
          }
          if (prod.aggregateRating) {
            product.rating = prod.aggregateRating.ratingValue;
            product.reviewCount = prod.aggregateRating.reviewCount;
          }
          if (prod.weight) {
            product.weight = typeof prod.weight === 'object' ? prod.weight.value : prod.weight;
          }
          break;
        }
        
        // Extract breadcrumbs from JSON-LD
        const breadcrumb = data['@type'] === 'BreadcrumbList' ? data : null;
        if (breadcrumb && breadcrumb.itemListElement) {
          product.category = breadcrumb.itemListElement
            .sort((a, b) => (a.position || 0) - (b.position || 0))
            .map(item => item.name || item.item?.name || '')
            .filter(n => n)
            .join(' > ');
        }
      } catch (e) {}
    }
    
    // === OPEN GRAPH & META TAGS (universal fallbacks) ===
    if (!product.title) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) product.title = ogTitle.content;
    }
    if (!product.description) {
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) product.description = ogDesc.content;
    }
    if (!product.images || product.images.length === 0) {
      const ogImage = document.querySelector('meta[property="og:image"]');
      if (ogImage && ogImage.content) product.images = [ogImage.content];
    }
    if (!product.shortDescription) {
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) product.shortDescription = metaDesc.content;
    }
    
    // === META KEYWORDS & META DESCRIPTION ===
    if (!product.metaKeywords) {
      const metaKw = document.querySelector('meta[name="keywords"]');
      if (metaKw && metaKw.content) product.metaKeywords = metaKw.content;
    }
    if (!product.metaDescription) {
      const metaD = document.querySelector('meta[name="description"]');
      if (metaD && metaD.content) product.metaDescription = metaD.content;
    }
    
    // === CUSTOM SELECTORS (user-defined, highest priority) ===
    const customTitle = tryCustomOrFallback('product_name');
    const customPrice = tryCustomOrFallback('price');
    const customOriginalPrice = tryCustomOrFallback('list_price') || tryCustomOrFallback('original_price');
    const customShipping = tryCustomOrFallback('shipping') || tryCustomOrFallback('shipping_cost');
    const customDescription = tryCustomOrFallback('description');
    const customShortDescription = tryCustomOrFallback('short_description');
    const customBrand = tryCustomOrFallback('brand');
    const customRating = tryCustomOrFallback('rating');
    const customReviews = tryCustomOrFallback('review_count');
    const customCategory = tryCustomOrFallback('category');
    const customStock = tryCustomOrFallback('quantity');
    const customWeight = tryCustomOrFallback('weight');
    const customStoreName = tryCustomOrFallback('store_name');
    
    // Apply custom values
    if (customTitle) product.title = customTitle;
    if (customPrice) product.price = customPrice;
    if (customOriginalPrice) product.originalPrice = customOriginalPrice;
    if (customShipping) product.shipping = customShipping;
    if (customDescription) product.description = customDescription;
    if (customShortDescription) product.shortDescription = customShortDescription;
    if (customBrand) product.brand = customBrand;
    if (customRating) product.rating = customRating;
    if (customReviews) product.reviewCount = customReviews;
    if (customCategory) product.category = customCategory;
    if (customStock) product.stock = customStock;
    if (customWeight) product.weight = customWeight;
    if (customStoreName) product.storeName = customStoreName;
    
    // === META TAG PRICE ===
    if (!product.price) {
      const priceMeta = document.querySelector('meta[property="product:price:amount"], meta[itemprop="price"], meta[name="price"]');
      if (priceMeta) product.price = priceMeta.content;
    }
    
    // === SITE-SPECIFIC SELECTORS ===
    if (config) {
      if (!product.title) product.title = trySelectors(config.titleSelectors);
      if (!product.price) product.price = tryPriceSelectors(config.priceSelectors);
      if (!product.shipping) product.shipping = trySelectors(config.shippingSelectors);
      
      // Original/list price from site-specific selectors
      if (!product.originalPrice && config.originalPriceSelectors) {
        product.originalPrice = tryPriceSelectors(config.originalPriceSelectors);
      }
      
      // Breadcrumbs/category from site-specific selectors
      if (!product.category && config.breadcrumbSelectors) {
        const crumbs = trySelectorsAll(config.breadcrumbSelectors);
        if (crumbs.length > 0) {
          product.category = crumbs.join(' > ');
        }
      }
      
      // Store/seller info from site-specific selectors
      if (!product.storeName && config.storeSelectors) {
        product.storeName = trySelectors(config.storeSelectors);
      }
      if (!product.storeRating && config.storeRatingSelectors) {
        product.storeRating = trySelectors(config.storeRatingSelectors);
      }
      
      // Stock from site-specific selectors
      if (!product.stock && config.stockSelectors) {
        const stockText = trySelectors(config.stockSelectors);
        if (stockText) {
          const match = stockText.match(/(\d+)/);
          product.stock = match ? parseInt(match[1]) : stockText;
        }
      }
      
      // MOQ for Alibaba
      if (config.moqSelectors) {
        product.minOrder = trySelectors(config.moqSelectors);
      }
    }
    
    // === FALLBACK TITLE from h1 ===
    if (!product.title) {
      const h1s = document.querySelectorAll('h1');
      for (const h1 of h1s) {
        const text = h1.textContent?.trim();
        if (text && text.length > 10 && !text.match(/^\d+%|off|save|discount/i)) {
          product.title = text;
          break;
        }
      }
    }
    
    // === BETTER PRICE EXTRACTION ===
    if (!product.price) {
      const priceElements = document.querySelectorAll('[class*="price" i]:not([class*="compare"]):not([class*="original"]):not([class*="old"])');
      
      for (const el of priceElements) {
        // Skip if inside a "was price" or "original price" container
        if (el.closest('[class*="original"], [class*="was"], [class*="old"], [class*="compare"]')) continue;
        
        const parsed = parsePriceText(el.textContent);
        if (parsed) {
          product.price = parsed;
          product.priceRaw = el.textContent.trim();
          break;
        }
      }
    }
    
    // === ORIGINAL/LIST PRICE ===
    if (!product.originalPrice) {
      // Look for strikethrough, "was", "original", "compare" prices
      const originalPriceSelectors = [
        '[class*="original" i] [class*="price" i]',
        '[class*="price" i] del',
        '[class*="price" i] s',
        '[class*="compare" i]',
        '[class*="was" i]',
        '[class*="old" i] [class*="price" i]',
        '[class*="Price--original"]',
        '[class*="list-price"]',
        '[class*="msrp"]',
        '[class*="rrp"]'
      ];
      for (const sel of originalPriceSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            const parsed = parsePriceText(el.textContent);
            if (parsed && parsed !== product.price) {
              product.originalPrice = parsed;
              break;
            }
          }
        } catch (e) {}
      }
    }
    
    // === CURRENCY ===
    if (!product.currency) {
      product.currency = detectCurrency();
    }
    
    // === CATEGORY / BREADCRUMBS ===
    if (!product.category) {
      const breadcrumbSelectors = [
        'nav[aria-label*="breadcrumb" i] a',
        'nav[aria-label*="breadcrumb" i] span',
        '.breadcrumb a',
        '.breadcrumb li',
        '[class*="breadcrumb" i] a',
        '[class*="breadcrumb" i] li',
        '[itemtype*="BreadcrumbList"] [itemprop="name"]'
      ];
      for (const sel of breadcrumbSelectors) {
        try {
          const els = document.querySelectorAll(sel);
          if (els.length >= 2) {
            const crumbs = Array.from(els)
              .map(el => el.textContent?.trim())
              .filter(t => t && t.length > 1 && !/home|main/i.test(t));
            if (crumbs.length >= 1) {
              product.category = crumbs.join(' > ');
              break;
            }
          }
        } catch (e) {}
      }
    }
    
    // === STOCK / AVAILABILITY ===
    if (!product.stock && !product.availability) {
      // Try schema.org availability
      const availMeta = document.querySelector('[itemprop="availability"]');
      if (availMeta) {
        const val = availMeta.content || availMeta.href || availMeta.textContent;
        product.availability = val;
        if (/InStock/i.test(val)) product.stock = 999;
        else if (/OutOfStock/i.test(val)) product.stock = 0;
      }
      
      // Try visible stock elements
      if (!product.stock) {
        const stockSelectors = [
          '[class*="stock" i]',
          '[class*="inventory" i]',
          '[class*="availability" i]',
          '[class*="quantity" i][class*="available" i]'
        ];
        for (const sel of stockSelectors) {
          try {
            const el = document.querySelector(sel);
            if (el) {
              const text = el.textContent?.trim();
              if (text) {
                const match = text.match(/(\d+)\s*(?:available|in stock|left|remaining|pieces)/i);
                if (match) {
                  product.stock = parseInt(match[1]);
                  break;
                }
                if (/in\s*stock/i.test(text)) { product.stock = 999; break; }
                if (/out\s*of\s*stock|sold\s*out|unavailable/i.test(text)) { product.stock = 0; break; }
              }
            }
          } catch (e) {}
        }
      }
    }
    
    // === WEIGHT / DIMENSIONS ===
    if (!product.weight) {
      const weightSelectors = [
        '[class*="weight" i]',
        '[itemprop="weight"]',
        'td:has(+ td)',  // Specs tables
        'th:has(+ td)'
      ];
      // Simple approach: look for weight-labeled elements
      const allText = document.body.innerText;
      const weightMatch = allText.match(/(?:weight|net\s*weight|package\s*weight)\s*[:=]\s*([\d.]+)\s*(kg|g|lb|oz)/i);
      if (weightMatch) {
        let w = parseFloat(weightMatch[1]);
        const unit = weightMatch[2].toLowerCase();
        // Convert to kg
        if (unit === 'g') w = w / 1000;
        else if (unit === 'lb') w = w * 0.4536;
        else if (unit === 'oz') w = w * 0.0283;
        product.weight = Math.round(w * 1000) / 1000;
        product.weightUnit = 'kg';
      }
    }
    
    // === STORE / SELLER INFO ===
    if (!product.storeName) {
      const genericStoreSelectors = [
        '[class*="store" i][class*="name" i]',
        '[class*="seller" i][class*="name" i]',
        '[class*="shop" i][class*="name" i]',
        '[class*="vendor" i]',
        'a[href*="store"]'
      ];
      for (const sel of genericStoreSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            const text = el.textContent?.trim();
            if (text && text.length > 1 && text.length < 100) {
              product.storeName = text;
              if (el.href) product.storeUrl = el.href;
              break;
            }
          }
        } catch (e) {}
      }
    }
    
    // === SHIPPING COST AS NUMBER ===
    if (product.shipping && typeof product.shipping === 'string') {
      product.shippingText = product.shipping;
      const shippingParsed = parsePriceText(product.shipping);
      if (shippingParsed !== null) {
        product.shippingCost = shippingParsed;
      } else if (/free/i.test(product.shipping)) {
        product.shippingCost = 0;
      }
    }
    
    // === EXTRACT ALL IMAGES ===
    const imageUrls = new Set();
    
    // Strategy 1: Site-specific selectors
    if (config && config.imageSelectors) {
      for (const selector of config.imageSelectors) {
        try {
          document.querySelectorAll(selector).forEach(img => {
            let src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
            if (src) {
              src = cleanImageUrl(src);
              if (isValidProductImage(src)) imageUrls.add(src);
            }
          });
        } catch(e) {}
      }
    }
    
    // Strategy 2: Gallery/carousel images
    document.querySelectorAll('[class*="gallery"] img, [class*="Gallery"] img, .images-view-list img, [class*="slider"] img, [class*="carousel"] img, [class*="thumb"] img').forEach(img => {
      let src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
      if (src) {
        src = cleanImageUrl(src);
        if (isValidProductImage(src)) imageUrls.add(src);
      }
    });
    
    // Strategy 3: Large product images
    document.querySelectorAll('img').forEach(img => {
      if (img.width > 200 || img.height > 200) {
        let src = img.src || img.getAttribute('data-src');
        if (src) {
          src = cleanImageUrl(src);
          if (isValidProductImage(src)) imageUrls.add(src);
        }
      }
    });
    
    product.images = Array.from(imageUrls).slice(0, 15);
    
    // === VARIANTS ===
    product.variantGroups = extractVariantGroups(config);
    product.variants = product.variantGroups.allVariants || [];
    
    // === REVIEWS ===
    product.reviews = extractReviewsData(config);
    
    // === FULL DESCRIPTION (HTML) ===
    if (!product.description) {
      const descSelectors = config?.descriptionSelectors || [
        '[class*="description"]', '[class*="Description"]',
        '#product-description', '.product-description', '[class*="detail-desc"]'
      ];
      for (const sel of descSelectors) {
        try {
          const descEl = document.querySelector(sel);
          if (descEl && descEl.textContent?.trim().length > 20) {
            product.fullDescription = descEl.innerHTML;
            product.description = descEl.innerHTML;
            product.descriptionText = descEl.textContent?.trim();
            break;
          }
        } catch(e) {}
      }
    }
    
    // === SHORT DESCRIPTION ===
    if (!product.shortDescription && (product.descriptionText || product.description)) {
      const plainText = (product.descriptionText || product.description)
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (plainText.length > 200) {
        const cut = plainText.substring(0, 200);
        const lastPeriod = cut.lastIndexOf('.');
        const lastSpace = cut.lastIndexOf(' ');
        product.shortDescription = plainText.substring(0, (lastPeriod > 150 ? lastPeriod + 1 : lastSpace)) + '...';
      } else {
        product.shortDescription = plainText;
      }
    }
    
    // === VIDEO URLs ===
    product.videoUrls = extractVideoUrls(config);
    
    // === SPECIFICATIONS ===
    if (!product.specifications || product.specifications.length === 0) {
      product.specifications = extractSpecifications(config);
    }
    
    // === BRAND (fallback) ===
    if (!product.brand) {
      const brandSelectors = [
        '[itemprop="brand"]',
        '[class*="brand" i]',
        '[class*="manufacturer" i]'
      ];
      for (const sel of brandSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            const text = el.textContent?.trim();
            if (text && text.length > 1 && text.length < 80) {
              product.brand = text;
              break;
            }
          }
        } catch (e) {}
      }
    }
    
    // === RATING ===
    if (!product.rating) {
      const ratingSelectors = [
        '[class*="rating"] [class*="score"], [class*="Rating"] [class*="Score"]',
        '[class*="star-rating"] [class*="current"]',
        '[itemprop="ratingValue"]',
        '[aria-label*="star"], [aria-label*="rating"]'
      ];
      for (const sel of ratingSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            const text = el.textContent || el.getAttribute('aria-label') || '';
            const match = text.match(/(\d+(?:\.\d+)?)/);
            if (match) {
              product.rating = parseFloat(match[1]);
              break;
            }
          }
        } catch(e) {}
      }
    }
    
    // === REVIEW COUNT ===
    if (!product.reviewCount) {
      const reviewCountSelectors = [
        '[class*="review"] [class*="count"], [class*="Review"] [class*="Count"]',
        '[class*="rating"] [class*="num"], [class*="Rating"] [class*="Num"]',
        '[itemprop="reviewCount"]',
        '[class*="feedback-count"]'
      ];
      for (const sel of reviewCountSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            const text = el.textContent || '';
            const match = text.match(/(\d+(?:,\d+)*)/);
            if (match) {
              product.reviewCount = parseInt(match[1].replace(/,/g, ''));
              break;
            }
          }
        } catch(e) {}
      }
    }
    
    // === SOLD / ORDERS COUNT ===
    if (!product.soldCount) {
      const soldSelectors = [
        '[class*="sold"], [class*="Sold"]',
        '[class*="orders"], [class*="Orders"]',
        '[class*="trade"] [class*="count"]'
      ];
      for (const sel of soldSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            const text = el.textContent || '';
            const match = text.match(/(\d+(?:,\d+)*)/);
            if (match) {
              product.soldCount = parseInt(match[1].replace(/,/g, ''));
              break;
            }
          }
        } catch(e) {}
      }
    }
    
    // === SPA RETRY ===
    // If title + price are still empty, page may be SPA (React/Vue hydration pending).
    // Wait 2s and retry JSON + DOM extraction once.
    if (!product.title && !product.price && !product._retried) {
      product._retried = true;
      console.log('[DropshipTracker] Missing title+price — retrying in 2s (SPA hydration)');
      setTimeout(() => {
        // Re-run JSON extraction
        const retryJSON = extractEmbeddedJSON(config);
        if (retryJSON) {
          if (retryJSON.title) product.title = retryJSON.title;
          if (retryJSON.price) product.price = retryJSON.price;
          if (retryJSON.originalPrice) product.originalPrice = product.originalPrice || retryJSON.originalPrice;
          if (retryJSON.currency) product.currency = product.currency || retryJSON.currency;
          if (retryJSON.images?.length > 0) product.images = product.images?.length ? product.images : retryJSON.images;
          if (retryJSON.rating) product.rating = product.rating || retryJSON.rating;
          if (retryJSON.reviewCount) product.reviewCount = product.reviewCount || retryJSON.reviewCount;
          if (retryJSON.description) product.description = product.description || retryJSON.description;
          if (retryJSON.sku) product.sku = product.sku || retryJSON.sku;
          if (retryJSON.brand) product.brand = product.brand || retryJSON.brand;
          if (retryJSON.stock !== undefined) product.stock = product.stock ?? retryJSON.stock;
          if (retryJSON.orders) product.orders = product.orders || retryJSON.orders;
        }
        // Retry h1 fallback
        if (!product.title) {
          const h1 = document.querySelector('h1');
          if (h1) product.title = h1.textContent?.trim();
        }
        // Retry price fallback
        if (!product.price) {
          const priceEl = document.querySelector('[class*="price" i]:not([class*="original"]):not([class*="old"])');
          if (priceEl) product.price = parsePriceText(priceEl.textContent);
        }
        delete product._retried;
        callback(product);
      }, 2000);
      return;
    }
    
    delete product._retried;
    callback(product);
  }
  
  /**
   * Clean image URL - convert thumbnail to full size
   */
  function cleanImageUrl(src) {
    if (!src) return '';
    return src
      .replace(/_\d+x\d+[^.]*\./g, '.')
      .replace(/\/_[^/]*\.webp/, '.jpg')
      .replace(/_Q\d+\.jpg/, '.jpg')
      .replace(/\.jpg_\d+x\d+.*$/, '.jpg')
      .replace(/\?.*$/, ''); // Remove query params for deduplication
  }
  
  /**
   * Check if URL is a valid product image
   */
  function isValidProductImage(src) {
    if (!src || !src.includes('http')) return false;
    const exclude = ['avatar', 'logo', 'icon', 'sprite', 'banner', 'flag', 'badge', 'loading', 'placeholder'];
    const lower = src.toLowerCase();
    return !exclude.some(ex => lower.includes(ex)) && (lower.includes('product') || lower.includes('item') || lower.includes('aliexpress') || lower.includes('alibaba') || src.match(/\.(jpg|jpeg|png|webp)/i));
  }
  
  /**
   * Extract variant groups (Color, Size, etc.) with details
   */
  function extractVariantGroups(config) {
    const groups = {};
    const allVariants = [];
    
    const groupSelectors = [
      '.sku-property',
      '[class*="Sku--property"]',
      '[class*="sku-property"]',
      '[class*="product-sku"]',
      '.sku-attr'
    ];
    
    for (const selector of groupSelectors) {
      try {
        document.querySelectorAll(selector).forEach(group => {
          const groupName = group.querySelector('[class*="title"], [class*="name"], .sku-title, label')?.textContent?.trim()?.replace(':', '') || 'Option';
          
          if (!groups[groupName]) groups[groupName] = [];
          
          group.querySelectorAll('[class*="item"], .sku-property-item, button[class*="sku"], [class*="value"]').forEach(item => {
            if (item.querySelector('[class*="title"]')) return;
            
            const variant = {
              type: groupName,
              name: item.getAttribute('title') || item.getAttribute('data-spm-anchor-id')?.split('.').pop() || item.textContent?.trim(),
              value: item.getAttribute('data-value') || item.getAttribute('data-sku-id') || item.getAttribute('data-id'),
              image: item.querySelector('img')?.src || item.style.backgroundImage?.replace(/url\(['"]?|['"]?\)/g, ''),
              selected: item.classList.contains('selected') || item.classList.contains('active') || item.hasAttribute('checked'),
              available: !item.classList.contains('disabled') && !item.classList.contains('unavailable'),
              priceModifier: item.getAttribute('data-price') || null
            };
            
            if (variant.name && variant.name.length < 100) {
              groups[groupName].push(variant);
              allVariants.push(variant);
            }
          });
        });
        
        if (Object.keys(groups).length > 0) break;
      } catch(e) {}
    }
    
    return { groups, allVariants };
  }
  
  /**
   * Extract reviews data
   */
  function extractReviewsData(config) {
    const reviews = [];
    
    const reviewSelectors = config?.reviewSelectors || [
      '.feedback-item',
      '[class*="review-item"]',
      '[class*="Review--wrap"]',
      '.review-content',
      '[class*="reviewItem"]'
    ];
    
    for (const selector of reviewSelectors) {
      try {
        document.querySelectorAll(selector).forEach(el => {
          const review = {
            author: el.querySelector('[class*="user"], [class*="name"], .user-name, [class*="buyer"]')?.textContent?.trim(),
            rating: extractRating(el),
            date: el.querySelector('[class*="date"], time, [class*="time"]')?.textContent?.trim(),
            text: el.querySelector('[class*="content"], [class*="text"], .review-content, [class*="comment"]')?.textContent?.trim(),
            images: Array.from(el.querySelectorAll('img')).map(img => img.src).filter(s => s && !s.includes('avatar') && !s.includes('icon')),
            country: el.querySelector('[class*="country"], [class*="flag"]')?.getAttribute('title') || el.querySelector('[class*="country"]')?.textContent?.trim()
          };
          
          if (review.text || review.rating) {
            reviews.push(review);
          }
        });
        
        if (reviews.length > 0) break;
      } catch(e) {}
    }
    
    return reviews;
  }
  
  /**
   * Extract star rating from element
   */
  function extractRating(element) {
    const stars = element.querySelectorAll('[class*="star"][class*="full"], .star-icon.fill, [class*="star-on"], [class*="starFilled"]');
    if (stars.length > 0 && stars.length <= 5) return stars.length;
    
    const percent = element.querySelector('[style*="width"]');
    if (percent && percent.style.width) {
      const match = percent.style.width.match(/(\d+)/);
      if (match) return Math.round(parseInt(match[1]) / 20);
    }
    
    const ariaRating = element.querySelector('[aria-label*="star"], [aria-label*="rating"]');
    if (ariaRating) {
      const match = ariaRating.getAttribute('aria-label').match(/(\d+(?:\.\d+)?)/);
      if (match) return parseFloat(match[1]);
    }
    
    const text = element.textContent;
    const match = text.match(/(\d+(?:\.\d+)?)\s*(?:star|\/\s*5)/i);
    if (match) return parseFloat(match[1]);
    
    return null;
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
          const text = el.textContent?.trim() || el.value;
          if (text) return text;
        }
      } catch (e) {}
    }
    return null;
  }

  /**
   * Try selectors specifically for price fields — returns parsed numeric price
   * Avoids returning raw concatenated text from container elements
   */
  function tryPriceSelectors(selectors) {
    if (!selectors) return null;
    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          // For price, try innermost text nodes first to avoid concatenation
          const directText = getDirectTextContent(el);
          const parsed = parsePriceText(directText || el.textContent);
          if (parsed && parsed < 1000000) return parsed; // Sanity check
        }
      } catch (e) {}
    }
    return null;
  }

  /**
   * Get direct text content of an element (not from children)
   */
  function getDirectTextContent(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return text.trim() || null;
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
    nextButtonSelector = selector;
    
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
  
  /**
   * Click the next button using full mouse event simulation
   * Full mousedown + click + mouseup sequence for SPA compatibility
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
    
    // Use full mouse event simulation for React/Vue SPA compatibility
    simulateFullClick(button);
    callback({ success: true, clicked: sel });
  }
  
  /**
   * Incremental scroll for infinite scroll pages
   * Ported from IDS: scrolls 1000px at a time, monitors child count + scroll position
   * Stops when no new children load and scroll position doesn't change
   */
  function scrollDown(callback) {
    const table = detectedTables[currentTableIndex];
    const tableElement = table?.element;
    const scrollTarget = tableElement
      ? findScrollableParent(tableElement)
      : (document.scrollingElement || document.body);

    // Count children of the detected table container (like IDS)
    const countChildren = () => {
      if (tableElement) return tableElement.children.length;
      return 0;
    };

    let prevChildCount = countChildren();
    let prevScrollTop = scrollTarget.scrollTop;
    let iterations = 0;
    const maxIterations = 30; // Safety limit

    function scrollStep() {
      iterations++;
      if (iterations > maxIterations) {
        callback({ scrolled: true, heightChanged: false, reason: 'max_iterations' });
        return;
      }

      // Scroll down by 1000px (incremental, like IDS)
      scrollTarget.scrollTop += 1000;

      setTimeout(() => {
        const currChildCount = countChildren();
        const currScrollTop = scrollTarget.scrollTop;

        const childrenChanged = currChildCount !== prevChildCount;
        const scrollStuck = currScrollTop === prevScrollTop;

        if (childrenChanged) {
          // New children loaded — infinite scroll content appeared
          callback({ scrolled: true, heightChanged: true, newChildren: currChildCount });
          return;
        }

        if (scrollStuck) {
          // Can't scroll further — reached bottom
          callback({ scrolled: true, heightChanged: false, reason: 'bottom_reached' });
          return;
        }

        // Still scrolling but no new children yet — keep going
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
  function getPageHash(callback) {
    // Hash the detected table's text, not the entire page body
    const table = detectedTables[currentTableIndex];
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
  
  // ============================================
  // SELECTOR PICKER - Let users click to select elements
  // ============================================
  
  function startSelectorPicker(callback, fieldName) {
    if (selectorPickerActive) {
      stopSelectorPicker();
    }
    
    selectorPickerActive = true;
    selectorPickerCallback = null;
    selectorPickerField = fieldName;
    
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
    if (!selectorPickerActive) return;
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
    if (!selectorPickerActive) return;
    e.target.classList.remove('dropship-picker-hover');
  }
  
  function pickerClickHandler(e) {
    if (!selectorPickerActive) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const element = e.target;
    const selector = buildUniqueSelector(element);
    const sampleValue = extractSampleValue(element);
    
    element.classList.remove('dropship-picker-hover');
    element.classList.add('dropship-picker-selected');
    
    customSelectors[selectorPickerField] = {
      selector: selector,
      sampleValue: sampleValue,
      savedAt: Date.now()
    };
    
    const fieldName = selectorPickerField;
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
    if (e.key === 'Escape' && selectorPickerActive) {
      const field = selectorPickerField;
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
  
  function stopSelectorPicker() {
    selectorPickerActive = false;
    
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
  function buildUniqueSelector(element) {
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
  
  /**
   * Extract sample value from element
   */
  function extractSampleValue(element) {
    if (element.tagName === 'IMG') {
      return element.src || element.getAttribute('data-src') || '';
    }
    if (element.tagName === 'A') {
      return element.href || element.textContent?.trim() || '';
    }
    if (element.tagName === 'INPUT' || element.tagName === 'SELECT') {
      return element.value || '';
    }
    return element.textContent?.trim().substring(0, 200) || '';
  }
  
  function getCustomSelector(field) {
    return customSelectors[field] || null;
  }
  
  function extractWithCustomSelector(selector) {
    const element = document.querySelector(selector);
    if (!element) return null;
    return extractSampleValue(element);
  }
  
  function extractAllWithSelector(selector) {
    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) return [];
    return Array.from(elements).map(el => extractSampleValue(el)).filter(v => v);
  }
  
  function loadCustomSelectors(callback) {
    const domain = window.location.hostname;
    const key = `customSelectors_${domain}`;
    
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([key], (result) => {
        customSelectors = result[key] || {};
        callback && callback(customSelectors);
      });
    } else {
      callback && callback({});
    }
  }
  
  function saveCustomSelectors(callback) {
    const domain = window.location.hostname;
    const key = `customSelectors_${domain}`;
    
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [key]: customSelectors }, () => {
        callback && callback({ success: true });
      });
    }
  }
  
  function getAllCustomSelectors(callback) {
    callback(customSelectors);
  }
  
  // Load custom selectors on init
  loadCustomSelectors();
  
  // Message listener
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
        customSelectors = request.selectors || {};
        saveCustomSelectors(sendResponse);
        return true;
        
      case 'extractWithSelector':
        sendResponse({
          value: extractWithCustomSelector(request.selector),
          allValues: extractAllWithSelector(request.selector)
        });
        return true;
        
      case 'ping':
        sendResponse({ alive: true, url: window.location.href });
        return true;
    }
  });
  
  console.log("[DropshipTracker] Content script loaded on", window.location.hostname);
})();