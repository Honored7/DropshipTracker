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
      // Updated selectors for 2026 AliExpress structure
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
      // Get ALL images, not just first
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
      shippingSelectors: ['.product-shipping', '[class*="Shipping"]', '[class*="delivery"]']
    },
    'alibaba.com': {
      productIdPattern: /\/product\/(\d+)\.html/,
      titleSelectors: [
        'h1.ma-title',
        '.detail-title',
        'h1[class*="title"]',
        '.module-pdp-title h1'
      ],
      priceSelectors: [
        '.ma-ref-price',
        '.price-original',
        '[class*="price"]',
        '.module-pdp-price'
      ],
      imageSelectors: [
        '.detail-gallery-turn img',
        '.main-image img',
        '[class*="gallery"] img',
        '.thumb-list img'
      ],
      variantSelectors: ['.sku-attr-item', '.obj-attr-item', '[class*="sku-prop"]'],
      reviewSelectors: ['.rating-item', '[class*="review"]'],
      shippingSelectors: ['.shipping-content', '[class*="logistics"]']
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
    
    // Extract data from each row - COMPREHENSIVE MODE
    rowElements.forEach((row, index) => {
      const rowData = extractElementData(row, '', { comprehensive: true });
      rowData._rowIndex = index;
      rowData._supplierProductId = extractProductIdFromElement(row);
      rowData._supplierSku = extractSupplierSku(row);
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
   * COMPREHENSIVE MODE: Capture everything, filter later in popup
   */
  function extractElementData(element, path, options = {}) {
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
    
    // Get ALL attributes in comprehensive mode (for table scraping)
    // Only filter in restrictive mode (for single product pages)
    const comprehensiveMode = options.comprehensive !== false;
    
    if (element.href) {
      if (comprehensiveMode || isValidProductUrl(element.href)) {
        data[currentPath + ' @href'] = comprehensiveMode ? element.href : cleanProductUrl(element.href);
      }
    }
    
    // Capture ALL images in comprehensive mode
    if (element.src) {
      if (comprehensiveMode || isValidImageUrl(element.src)) {
        data[currentPath + ' @src'] = element.src;
      }
    }
    
    // Get data-src (lazy loaded images)
    const dataSrc = element.getAttribute('data-src') || element.getAttribute('data-lazy-src');
    if (dataSrc && dataSrc.startsWith('http')) {
      data[currentPath + ' @data-src'] = dataSrc;
    }
    
    if (element.alt) data[currentPath + ' @alt'] = element.alt;
    if (element.title && element.title.length < 200) data[currentPath + ' @title'] = element.title;
    
    // Get data attributes
    for (const attr of element.attributes) {
      if (attr.name.startsWith('data-') && attr.value && attr.value.length < 500) {
        // Skip only the most egregious tracking attributes
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
    
    // Recurse into children
    for (const child of element.children) {
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(child.tagName)) continue;
      Object.assign(data, extractElementData(child, currentPath, options));
    }
    
    return data;
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
    
    // Try JSON-LD structured data FIRST (most reliable)
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const jsonLd of jsonLdScripts) {
      try {
        const data = JSON.parse(jsonLd.textContent);
        const prod = data['@type'] === 'Product' ? data : (data.product || null);
        if (prod) {
          product.title = prod.name;
          product.description = prod.description;
          product.price = prod.offers?.price || prod.offers?.lowPrice;
          product.currency = prod.offers?.priceCurrency;
          product.sku = prod.sku;
          product.brand = prod.brand?.name || prod.brand;
          if (prod.image) {
            product.images = Array.isArray(prod.image) ? prod.image : [prod.image];
          }
          break;
        }
      } catch (e) {}
    }
    
    // Try meta tags for price
    if (!product.price) {
      const priceMeta = document.querySelector('meta[property="product:price:amount"], meta[itemprop="price"], meta[name="price"]');
      if (priceMeta) {
        product.price = priceMeta.content;
      }
    }
    
    // Try site-specific selectors
    if (config) {
      if (!product.title) product.title = trySelectors(config.titleSelectors);
      if (!product.price) product.price = trySelectors(config.priceSelectors);
      product.shipping = trySelectors(config.shippingSelectors);
    }
    
    // Fallback title from h1 (but avoid discount/promo text)
    if (!product.title) {
      const h1s = document.querySelectorAll('h1');
      for (const h1 of h1s) {
        const text = h1.textContent?.trim();
        // Skip if looks like discount text
        if (text && text.length > 10 && !text.match(/^\d+%|off|save|discount/i)) {
          product.title = text;
          break;
        }
      }
    }
    
    // Better price extraction
    if (!product.price) {
      const pricePatterns = [
        /[\$€£¥₦]\s*[\d,]+\.?\d*/g,
        /[\d,]+\.?\d*\s*[\$€£¥₦]/g,
        /NGN\s*[\d,]+\.?\d*/gi,
        /USD\s*[\d,]+\.?\d*/gi
      ];
      const priceElements = document.querySelectorAll('[class*="price" i]:not([class*="compare"]):not([class*="original"]):not([class*="old"])');
      
      outer: for (const el of priceElements) {
        // Skip if inside a "was price" or "original price" container
        if (el.closest('[class*="original"], [class*="was"], [class*="old"], [class*="compare"]')) continue;
        
        const text = el.textContent;
        for (const pattern of pricePatterns) {
          const matches = text.match(pattern);
          if (matches) {
            for (const match of matches) {
              const num = parseFloat(match.replace(/[^\d.]/g, ''));
              if (num > 1 && num < 1000000) {
                product.price = num;
                product.priceRaw = match;
                break outer;
              }
            }
          }
        }
      }
    }
    
    // Extract ALL images
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
    
    // Extract variants with full details
    product.variantGroups = extractVariantGroups(config);
    product.variants = product.variantGroups.allVariants || [];
    
    // Extract reviews
    product.reviews = extractReviewsData(config);
    
    // Get description
    if (!product.description) {
      const descEl = document.querySelector(
        '[class*="description"], [class*="Description"], #product-description, .product-description, [class*="detail-desc"]'
      );
      if (descEl) {
        product.description = descEl.innerHTML;
        product.descriptionText = descEl.textContent?.trim();
      }
    }
    
    callback(product);
  }
  
  /**
   * Clean image URL - convert thumbnail to full size
   */
  function cleanImageUrl(src) {
    if (!src) return '';
    // Remove size suffixes
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
    
    // Find variant property groups
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
            // Skip if it's the title element
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
    // Try star count (filled stars)
    const stars = element.querySelectorAll('[class*="star"][class*="full"], .star-icon.fill, [class*="star-on"], [class*="starFilled"]');
    if (stars.length > 0 && stars.length <= 5) return stars.length;
    
    // Try percentage width
    const percent = element.querySelector('[style*="width"]');
    if (percent && percent.style.width) {
      const match = percent.style.width.match(/(\d+)/);
      if (match) return Math.round(parseInt(match[1]) / 20);
    }
    
    // Try aria-label
    const ariaRating = element.querySelector('[aria-label*="star"], [aria-label*="rating"]');
    if (ariaRating) {
      const match = ariaRating.getAttribute('aria-label').match(/(\d+(?:\.\d+)?)/);
      if (match) return parseFloat(match[1]);
    }
    
    // Try text pattern
    const text = element.textContent;
    const match = text.match(/(\d+(?:\.\d+)?)\s*(?:star|★|\/\s*5)/i);
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
  
  // ============================================
  // SELECTOR PICKER - Let users click to select elements
  // ============================================
  
  /**
   * Start selector picker mode
   */
  function startSelectorPicker(callback, fieldName) {
    selectorPickerActive = true;
    selectorPickerCallback = callback;
    selectorPickerField = fieldName;
    
    // Add picker styles
    if (!document.getElementById('dropship-picker-styles')) {
      const style = document.createElement('style');
      style.id = 'dropship-picker-styles';
      style.textContent = `
        .dropship-picker-hover {
          outline: 3px solid #00ff00 !important;
          outline-offset: 2px;
          cursor: crosshair !important;
        }
        .dropship-picker-selected {
          outline: 3px solid #0066ff !important;
          outline-offset: 2px;
        }
        .dropship-picker-overlay {
          position: fixed;
          top: 10px;
          left: 50%;
          transform: translateX(-50%);
          background: #333;
          color: #fff;
          padding: 10px 20px;
          border-radius: 5px;
          z-index: 999999;
          font-family: sans-serif;
          font-size: 14px;
        }
      `;
      document.head.appendChild(style);
    }
    
    // Add overlay instructions
    const overlay = document.createElement('div');
    overlay.id = 'dropship-picker-overlay';
    overlay.className = 'dropship-picker-overlay';
    overlay.innerHTML = `Click on the element to select for <strong>${fieldName}</strong>. Press ESC to cancel.`;
    document.body.appendChild(overlay);
    
    // Add event listeners
    document.addEventListener('mouseover', pickerHoverHandler, true);
    document.addEventListener('mouseout', pickerUnhoverHandler, true);
    document.addEventListener('click', pickerClickHandler, true);
    document.addEventListener('keydown', pickerEscHandler, true);
    
    callback({ started: true, field: fieldName });
  }
  
  function pickerHoverHandler(e) {
    if (!selectorPickerActive) return;
    e.target.classList.add('dropship-picker-hover');
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
    
    // Mark as selected
    element.classList.remove('dropship-picker-hover');
    element.classList.add('dropship-picker-selected');
    
    // Store the selector
    customSelectors[selectorPickerField] = {
      selector: selector,
      sampleValue: sampleValue,
      savedAt: Date.now()
    };
    
    // Clean up
    stopSelectorPicker();
    
    // Callback with result
    if (selectorPickerCallback) {
      selectorPickerCallback({
        success: true,
        field: selectorPickerField,
        selector: selector,
        sampleValue: sampleValue
      });
    }
  }
  
  function pickerEscHandler(e) {
    if (e.key === 'Escape' && selectorPickerActive) {
      stopSelectorPicker();
      if (selectorPickerCallback) {
        selectorPickerCallback({ cancelled: true });
      }
    }
  }
  
  function stopSelectorPicker() {
    selectorPickerActive = false;
    
    // Remove listeners
    document.removeEventListener('mouseover', pickerHoverHandler, true);
    document.removeEventListener('mouseout', pickerUnhoverHandler, true);
    document.removeEventListener('click', pickerClickHandler, true);
    document.removeEventListener('keydown', pickerEscHandler, true);
    
    // Remove overlay
    const overlay = document.getElementById('dropship-picker-overlay');
    if (overlay) overlay.remove();
    
    // Remove hover highlights
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
    
    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      
      // Use ID if unique
      if (current.id && document.querySelectorAll('#' + CSS.escape(current.id)).length === 1) {
        selector = '#' + CSS.escape(current.id);
        parts.unshift(selector);
        break;
      }
      
      // Use data attributes if available (often stable)
      const stableAttrs = ['data-product-id', 'data-item-id', 'data-sku', 'data-testid', 'role'];
      for (const attr of stableAttrs) {
        const val = current.getAttribute(attr);
        if (val && !val.includes(' ')) {
          selector += `[${attr}="${CSS.escape(val)}"]`;
          parts.unshift(selector);
          // Check if unique
          if (document.querySelectorAll(parts.join(' > ')).length === 1) {
            return parts.join(' > ');
          }
          break;
        }
      }
      
      // Use classes (filter dynamic ones)
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/)
          .filter(c => c && !/^\d|--|__|index-\d/.test(c))
          .slice(0, 3);
        if (classes.length > 0) {
          selector += '.' + classes.map(c => CSS.escape(c)).join('.');
        }
      }
      
      // Add nth-child if needed for uniqueness
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
    // Try to get the most meaningful value
    if (element.tagName === 'IMG') {
      return element.src || element.getAttribute('data-src') || '';
    }
    if (element.tagName === 'A') {
      return element.href || element.textContent?.trim() || '';
    }
    if (element.tagName === 'INPUT' || element.tagName === 'SELECT') {
      return element.value || '';
    }
    
    // For other elements, get text content
    return element.textContent?.trim().substring(0, 200) || '';
  }
  
  /**
   * Get custom selectors for a field
   */
  function getCustomSelector(field) {
    return customSelectors[field] || null;
  }
  
  /**
   * Extract data using custom selector
   */
  function extractWithCustomSelector(selector) {
    const element = document.querySelector(selector);
    if (!element) return null;
    
    return extractSampleValue(element);
  }
  
  /**
   * Extract data from ALL matching elements (for multiple images, reviews, etc.)
   */
  function extractAllWithSelector(selector) {
    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) return [];
    
    return Array.from(elements).map(el => extractSampleValue(el)).filter(v => v);
  }
  
  /**
   * Load custom selectors from storage
   */
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
  
  /**
   * Save custom selectors to storage
   */
  function saveCustomSelectors(callback) {
    const domain = window.location.hostname;
    const key = `customSelectors_${domain}`;
    
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [key]: customSelectors }, () => {
        callback && callback({ success: true });
      });
    }
  }
  
  /**
   * Get all custom selectors
   */
  function getAllCustomSelectors(callback) {
    callback(customSelectors);
  }
  
  // Load custom selectors on init
  loadCustomSelectors();
  
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
        
      // New selector picker actions
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
