(() => {
  var __defProp = Object.defineProperty;
  var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

  // src/content/contentState.js
  var contentState = {
    detectedTables: [],
    currentTableIndex: 0,
    nextButtonSelector: null,
    customSelectors: {},
    selectorPickerActive: false,
    selectorPickerCallback: null,
    selectorPickerField: null,
    // Populated by the XHR/fetch interceptor (interceptor.js)
    interceptedReviews: [],
    interceptedProductData: null
  };

  // src/content/tableDetection.js
  function findTables(callback) {
    const pageArea = document.body.offsetWidth * document.body.offsetHeight;
    const candidates = [];
    document.querySelectorAll("body *").forEach(function(element) {
      if (!element.offsetParent && element.tagName !== "BODY")
        return;
      if (["SCRIPT", "STYLE", "META", "LINK", "NOSCRIPT"].includes(element.tagName))
        return;
      const rect = element.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area < 0.02 * pageArea)
        return;
      const childInfo = getConsistentChildren(element);
      if (childInfo.count < 3)
        return;
      const score = area * childInfo.count * childInfo.count;
      candidates.push({
        element,
        selector: buildSelector(element),
        childCount: childInfo.count,
        childSelector: childInfo.selector,
        score,
        area
      });
    });
    candidates.sort((a, b) => b.score - a.score);
    contentState.detectedTables = candidates.slice(0, 10);
    contentState.currentTableIndex = 0;
    if (contentState.detectedTables.length > 0) {
      highlightTable(contentState.detectedTables[0]);
    }
    callback({
      tableCount: contentState.detectedTables.length,
      selector: contentState.detectedTables.length > 0 ? contentState.detectedTables[0].selector : null,
      tables: contentState.detectedTables.map((t, i) => ({
        index: i,
        selector: t.selector,
        childCount: t.childCount,
        score: Math.round(t.score)
      }))
    });
  }
  __name(findTables, "findTables");
  function getConsistentChildren(container, maxSample) {
    const children = Array.from(container.children).filter(
      (child) => !["SCRIPT", "STYLE", "BR", "HR"].includes(child.tagName)
    );
    if (children.length < 3)
      return { count: 0, selector: null };
    const classCounts = {};
    children.forEach((child) => {
      const classes = (child.className || "").toString().split(/\s+/).filter((c) => c);
      const key = classes.sort().join(" ") || child.tagName.toLowerCase();
      classCounts[key] = (classCounts[key] || 0) + 1;
    });
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
        selector: bestClass.includes(" ") ? "." + bestClass.split(" ").join(".") : bestClass.includes(".") ? bestClass : "." + bestClass
      };
    }
    const individualClassCounts = {};
    children.forEach((child) => {
      const classes = (child.className || "").toString().split(/\s+/).filter((c) => c);
      classes.forEach((cls) => {
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
      return { count: bestIndividualCount, selector: "." + bestIndividualClass };
    }
    const nonEmptyChildren = children.filter((child) => {
      const text = child.textContent?.trim();
      return text && text.length > 5;
    });
    if (nonEmptyChildren.length >= 3) {
      return { count: nonEmptyChildren.length, selector: "*" };
    }
    return { count: 0, selector: null };
  }
  __name(getConsistentChildren, "getConsistentChildren");
  function buildSelector(element) {
    const parts = [];
    let current = element;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = "#" + CSS.escape(current.id);
        parts.unshift(selector);
        break;
      }
      if (current.className && typeof current.className === "string") {
        const classes = current.className.trim().split(/\s+/).filter((c) => c).slice(0, 2);
        if (classes.length > 0) {
          selector += "." + classes.map((c) => CSS.escape(c)).join(".");
        }
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += ":nth-child(" + index + ")";
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }
  __name(buildSelector, "buildSelector");
  function highlightTable(table) {
    document.querySelectorAll(".dropship-table-highlight").forEach((el) => {
      el.classList.remove("dropship-table-highlight");
      el.style.outline = "";
    });
    if (table && table.element) {
      table.element.style.outline = "3px dashed #0066ff";
      table.element.classList.add("dropship-table-highlight");
      table.element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
  __name(highlightTable, "highlightTable");
  function nextTable(callback) {
    if (contentState.detectedTables.length === 0) {
      callback({ error: "No tables detected" });
      return;
    }
    contentState.currentTableIndex = (contentState.currentTableIndex + 1) % contentState.detectedTables.length;
    const table = contentState.detectedTables[contentState.currentTableIndex];
    highlightTable(table);
    callback({
      currentTable: contentState.currentTableIndex,
      tableCount: contentState.detectedTables.length,
      selector: table.selector,
      childCount: table.childCount
    });
  }
  __name(nextTable, "nextTable");

  // src/content/siteConfigs.js
  var SITE_CONFIGS = {
    "aliexpress.com": {
      productIdPattern: /\/item\/(\d+)\.html/,
      productIdAttr: "data-product-id",
      titleSelectors: [
        'h1[data-pl="product-title"]',
        ".product-title-text",
        "h1.pdp-title",
        '[class*="ProductTitle--text"]',
        '[class*="title--wrap"] h1',
        '[class*="HalfLayout--title"]',
        ".product-title",
        "h1"
      ],
      priceSelectors: [
        '[class*="Price--currentPriceText"]',
        '[class*="es--wrap--"] [class*="es--char--"]',
        ".product-price-current span",
        '[class*="uniform-banner-box-price"]',
        '[class*="price"] [class*="current"]',
        ".product-price-value"
      ],
      originalPriceSelectors: [
        '[class*="Price--originalText"]',
        '[class*="price--original"]',
        ".product-price-original",
        '[class*="price"] del',
        '[class*="price"] s',
        '[class*="price--compare"]',
        '[class*="price"] [class*="del"]'
      ],
      imageSelectors: [
        ".images-view-list img",
        '[class*="slider--wrap"] img',
        '[class*="Gallery"] img[src*="aliexpress"]',
        ".pdp-info-image img",
        '[class*="image-view"] img'
      ],
      variantSelectors: [
        ".sku-property",
        '[class*="Sku--property"]',
        '[class*="skuItem"]',
        '[class*="sku-item"]'
      ],
      reviewSelectors: [
        ".feedback-item",
        '[class*="Review--wrap"]',
        '[class*="reviewItem"]',
        '[class*="review-item"]'
      ],
      shippingSelectors: [".product-shipping", '[class*="Shipping"]', '[class*="delivery"]'],
      breadcrumbSelectors: [
        '[class*="breadcrumb"] a',
        ".breadcrumb a",
        'nav[aria-label*="breadcrumb"] a',
        '[class*="CategoryPath"] a',
        '[class*="category-path"] a'
      ],
      storeSelectors: [
        '[class*="store-name"]',
        '[class*="StoreName"]',
        ".shop-name a",
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
        ".pdp-description-text",
        '[class*="description"]',
        '[class*="Description"]',
        "#product-description",
        ".product-description",
        '[class*="detail-desc"]'
      ],
      specSelectors: [
        ".pdp-mod-product-specs",
        '[class*="specification"]',
        '[class*="Specification"]',
        ".product-specs",
        '[class*="product-prop"]',
        ".product-property-list"
      ],
      videoSelectors: [
        "video source",
        'iframe[src*="video"]',
        '[class*="video"] video',
        '[class*="Video"] source'
      ],
      // Patterns locate the START of the JSON object; brace-counting finishes extraction.
      // window.runParams is AliExpress's primary product data container (added 2024+).
      jsonPatterns: [
        "window\\.runParams\\s*[=,]\\s*\\{",
        "window\\.__runParams__\\s*=\\s*\\{",
        "_initData\\s*=\\s*\\{",
        "__INITIAL_STATE__\\s*=\\s*\\{",
        "window\\.__state__\\s*=\\s*\\{",
        '"offers"\\s*:\\s*\\{'
      ]
    },
    "alibaba.com": {
      productIdPattern: /\/product\/(\d+)\.html|product-detail\/[^_]*_(\d{5,})\.html|offer\/(\d+)/,
      titleSelectors: [
        "h1.ma-title",
        ".detail-title",
        ".module-pdp-title h1",
        'h1[class*="title"]'
      ],
      priceSelectors: [
        ".ma-ref-price .ma-ref-price-value",
        ".ma-ref-price",
        ".price-original .price-value",
        ".price-original",
        ".module-pdp-price .price-value",
        ".module-pdp-price .price"
      ],
      originalPriceSelectors: [
        '[class*="price--original"]',
        '[class*="ref-price"]',
        '[class*="price"] del',
        '[class*="price"] s'
      ],
      imageSelectors: [
        '.detail-gallery-turn img:not([src$=".svg"])',
        '.main-image img:not([src$=".svg"])',
        '[class*="gallery"] img:not([src$=".svg"])',
        '.thumb-list img:not([src$=".svg"])',
        'img[src*="alicdn.com"][src$=".jpg"]'
      ],
      variantSelectors: [".sku-attr-item", ".obj-attr-item", '[class*="sku-prop"]'],
      reviewSelectors: [".rating-item", '[class*="review"]'],
      shippingSelectors: [".shipping-content", '[class*="logistics"]'],
      breadcrumbSelectors: [
        ".breadcrumb a",
        '[class*="breadcrumb"] a',
        'nav[aria-label*="breadcrumb"] a',
        ".category-nav a"
      ],
      storeSelectors: [
        ".company-name a",
        '[class*="supplierName"]',
        '[class*="company-name"]',
        ".shop-name"
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
        ".do-entry-item-description",
        '[class*="description"]',
        '[class*="Description"]',
        ".module-pdp-desc"
      ],
      specSelectors: [
        '[class*="Spec"]',
        ".do-entry-item",
        ".product-attr-list",
        ".attribute-list"
      ],
      videoSelectors: [
        "video source",
        'iframe[src*="video"]'
      ],
      // Patterns locate the START of the JSON object; brace-counting finishes extraction.
      jsonPatterns: [
        "__INITIAL_STATE__\\s*=\\s*\\{",
        "window\\.__data__\\s*=\\s*\\{",
        "_init_data_\\s*=\\s*\\{"
      ]
    }
  };
  function getSiteConfig() {
    const hostname = window.location.hostname;
    for (const [domain, config] of Object.entries(SITE_CONFIGS)) {
      if (hostname.includes(domain.replace(".com", ""))) {
        return { domain, ...config };
      }
    }
    return null;
  }
  __name(getSiteConfig, "getSiteConfig");

  // src/content/utils.js
  function extractProductId() {
    const config = getSiteConfig();
    const url = window.location.href;
    if (config && config.productIdPattern) {
      const match = url.match(config.productIdPattern);
      if (match) {
        return match[1] || match[2] || match[3] || match[0];
      }
    }
    const patterns = [
      /\/dp\/([A-Z0-9]{10})/,
      /\/item\/(\d+)/,
      /\/product\/(\d+)/,
      /product[_-]?id[=:](\w+)/i,
      /\/p\/([a-zA-Z0-9-]+)/,
      /[?&]id=(\w+)/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match)
        return match[1];
    }
    const idElement = document.querySelector("[data-product-id], [data-item-id], [data-sku]");
    if (idElement) {
      return idElement.getAttribute("data-product-id") || idElement.getAttribute("data-item-id") || idElement.getAttribute("data-sku");
    }
    return null;
  }
  __name(extractProductId, "extractProductId");
  function extractProductIdFromElement(element) {
    const dataId = element.getAttribute("data-product-id") || element.getAttribute("data-item-id") || element.getAttribute("data-id");
    if (dataId)
      return dataId;
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
        if (match)
          return match[1];
      }
    }
    return null;
  }
  __name(extractProductIdFromElement, "extractProductIdFromElement");
  function extractSupplierSku(element) {
    const sku = element.getAttribute("data-sku") || element.getAttribute("data-product-sku") || element.getAttribute("data-sku-id");
    if (sku)
      return sku;
    const skuEl = element.querySelector('[class*="sku"], [class*="itemId"], [class*="product-id"]');
    if (skuEl) {
      const text = skuEl.textContent?.trim();
      if (text && text.length < 50)
        return text;
    }
    return null;
  }
  __name(extractSupplierSku, "extractSupplierSku");
  function normalizeImageUrl(url) {
    if (!url)
      return "";
    try {
      const u = new URL(url);
      u.search = "";
      return u.href.replace(/_\d+x\d+[^.]*/g, "").replace(/\?.*$/, "");
    } catch (e) {
      return url.replace(/\?.*$/, "");
    }
  }
  __name(normalizeImageUrl, "normalizeImageUrl");
  function cleanImageUrl(src) {
    if (!src)
      return "";
    return src.replace(/_\d+x\d+[^.]*\./g, ".").replace(/\/_[^/]*\.webp/, ".jpg").replace(/_Q\d+\.jpg/, ".jpg").replace(/\.jpg_\d+x\d+.*$/, ".jpg").replace(/\?.*$/, "");
  }
  __name(cleanImageUrl, "cleanImageUrl");
  function isValidProductImage(src) {
    if (!src || !src.includes("http"))
      return false;
    if (/\.svg(\?|$)/i.test(src))
      return false;
    if (/tps-\d{1,2}-\d{1,2}|_\d{1,2}x\d{1,2}/i.test(src))
      return false;
    const exclude = ["avatar", "logo", "icon", "sprite", "banner", "flag", "badge", "loading", "placeholder", "spacer", "pixel", "tracking"];
    const lower = src.toLowerCase();
    return !exclude.some((ex) => lower.includes(ex)) && (lower.includes("product") || lower.includes("item") || lower.includes("aliexpress") || lower.includes("alibaba") || lower.includes("alicdn") || src.match(/\.(jpg|jpeg|png|webp)/i));
  }
  __name(isValidProductImage, "isValidProductImage");
  function parsePriceText(text) {
    if (!text)
      return null;
    const pricePatterns = [
      /[\$\u20AC\u00A3\u00A5\u20A6]\s*([\d,]+\.?\d*)/,
      /([\d,]+\.?\d*)\s*[\$\u20AC\u00A3\u00A5\u20A6]/,
      /(?:NGN|USD|EUR|GBP)\s*([\d,]+\.?\d*)/i,
      /([\d,]+\.?\d*)\s*(?:NGN|USD|EUR|GBP)/i
    ];
    for (const pattern of pricePatterns) {
      const match = text.match(pattern);
      if (match) {
        const num = parseFloat(match[1].replace(/,/g, ""));
        if (num > 0.01 && num < 1e7)
          return num;
      }
    }
    return null;
  }
  __name(parsePriceText, "parsePriceText");
  function detectCurrency() {
    const currencyMeta = document.querySelector(
      'meta[property="product:price:currency"], meta[itemprop="priceCurrency"], meta[name="currency"]'
    );
    if (currencyMeta)
      return currencyMeta.content;
    const priceEl = document.querySelector('[class*="price" i]');
    if (priceEl) {
      const text = priceEl.textContent || "";
      if (text.includes("$") || /USD/i.test(text))
        return "USD";
      if (text.includes("\u20AC") || /EUR/i.test(text))
        return "EUR";
      if (text.includes("\xA3") || /GBP/i.test(text))
        return "GBP";
      if (text.includes("\xA5") || /JPY|CNY/i.test(text))
        return "CNY";
      if (text.includes("\u20A6") || /NGN/i.test(text))
        return "NGN";
    }
    return null;
  }
  __name(detectCurrency, "detectCurrency");
  function lazyScrollElements(elements, callback) {
    if (!elements || elements.length === 0) {
      callback();
      return;
    }
    const delay = elements.length > 50 ? 30 : elements.length > 20 ? 50 : 80;
    let index = 0;
    function scrollNext() {
      if (index >= elements.length) {
        callback();
        return;
      }
      const el = elements[index];
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ behavior: "instant", block: "center" });
      }
      index++;
      setTimeout(scrollNext, delay);
    }
    __name(scrollNext, "scrollNext");
    scrollNext();
  }
  __name(lazyScrollElements, "lazyScrollElements");
  function findScrollableParent(element) {
    let current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight) {
        return current;
      }
      current = current.parentElement;
    }
    return document.scrollingElement || document.body;
  }
  __name(findScrollableParent, "findScrollableParent");
  function simulateFullClick(element) {
    if (!element)
      return;
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
    element.dispatchEvent(new MouseEvent("mousedown", eventOpts));
    element.dispatchEvent(new MouseEvent("click", eventOpts));
    element.dispatchEvent(new MouseEvent("mouseup", eventOpts));
  }
  __name(simulateFullClick, "simulateFullClick");
  function trySelectors(selectors) {
    if (!selectors)
      return null;
    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          const text = el.textContent?.trim() || el.value;
          if (text)
            return text;
        }
      } catch (e) {
      }
    }
    return null;
  }
  __name(trySelectors, "trySelectors");
  function tryPriceSelectors(selectors) {
    if (!selectors)
      return null;
    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          const directText = getDirectTextContent(el);
          const parsed = parsePriceText(directText || el.textContent);
          if (parsed && parsed < 1e6)
            return parsed;
        }
      } catch (e) {
      }
    }
    return null;
  }
  __name(tryPriceSelectors, "tryPriceSelectors");
  function getDirectTextContent(el) {
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return text.trim() || null;
  }
  __name(getDirectTextContent, "getDirectTextContent");
  function trySelectorsAll(selectors, attr = null) {
    if (!selectors)
      return [];
    const results = [];
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach((el) => {
          const value = attr ? el[attr] || el.getAttribute(attr) : el.textContent?.trim();
          if (value && !results.includes(value)) {
            results.push(value);
          }
        });
        if (results.length > 0)
          break;
      } catch (e) {
      }
    }
    return results;
  }
  __name(trySelectorsAll, "trySelectorsAll");
  function extractSampleValue(element) {
    if (element.tagName === "IMG") {
      return element.src || element.getAttribute("data-src") || "";
    }
    if (element.tagName === "A") {
      return element.href || element.textContent?.trim() || "";
    }
    if (element.tagName === "INPUT" || element.tagName === "SELECT") {
      return element.value || "";
    }
    return element.textContent?.trim().substring(0, 200) || "";
  }
  __name(extractSampleValue, "extractSampleValue");

  // src/content/tableExtraction.js
  function getTableData(callback, customSelector) {
    const table = customSelector ? { element: document.querySelector(customSelector), selector: customSelector } : contentState.detectedTables[contentState.currentTableIndex];
    if (!table || !table.element) {
      callback({ error: "No table selected" });
      return;
    }
    const rows = [];
    const childInfo = getConsistentChildren(table.element);
    let rowElements = Array.from(table.element.children).filter(
      (child) => !["SCRIPT", "STYLE", "BR", "HR"].includes(child.tagName)
    );
    const classCounts = {};
    rowElements.forEach((child) => {
      const classes = (child.className || "").toString().split(/\s+/).filter((c) => c);
      const key = classes.sort().join(" ") || child.tagName.toLowerCase();
      classCounts[key] = (classCounts[key] || 0) + 1;
    });
    const goodClasses = Object.entries(classCounts).filter(([, count]) => count >= 3).map(([cls]) => cls);
    if (goodClasses.length > 0) {
      rowElements = rowElements.filter((child) => {
        const classes = (child.className || "").toString().split(/\s+/).filter((c) => c);
        const classKey = classes.sort().join(" ") || child.tagName.toLowerCase();
        return goodClasses.includes(classKey);
      });
    }
    lazyScrollElements(rowElements, () => {
      const { customSelectors } = contentState;
      rowElements.forEach((row, index) => {
        const tag = row.tagName.toLowerCase();
        if (["nav", "footer", "header", "aside"].includes(tag))
          return;
        if (row.getAttribute("role") === "navigation")
          return;
        const cls = (row.className || "").toString().toLowerCase();
        if (/\b(ad|ads|advert|banner|promo|sponsor)\b/.test(cls))
          return;
        const rowData = extractElementData(row, "", { mode: "table" });
        rowData._rowIndex = index;
        rowData._supplierProductId = extractProductIdFromElement(row);
        rowData._supplierSku = extractSupplierSku(row);
        if (customSelectors && Object.keys(customSelectors).length > 0) {
          for (const [fieldId, config] of Object.entries(customSelectors)) {
            if (!config || !config.selector)
              continue;
            try {
              let el = row.querySelector(config.selector);
              if (!el) {
                const simpleClass = config.selector.match(/\.([a-zA-Z0-9_-]+)/);
                if (simpleClass) {
                  el = row.querySelector("." + simpleClass[1]);
                }
              }
              if (el) {
                const value = extractSampleValue(el);
                if (value) {
                  rowData["_custom_" + fieldId] = value;
                }
              }
            } catch (e) {
            }
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
  __name(getTableData, "getTableData");
  function extractElementData(element, path, options = {}) {
    const mode = options.mode || "product";
    const data = {};
    const tag = element.tagName.toLowerCase();
    const classes = (element.className || "").toString().trim().split(/\s+/).filter((c) => c).slice(0, 2);
    const currentPath = path + "/" + tag + (classes.length ? "." + classes.join(".") : "");
    if (mode === "table") {
      const directText2 = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent.trim()).filter((t) => t).join(" ");
      if (directText2) {
        data[currentPath] = directText2;
      }
      if (element.tagName === "A" && element.href) {
        data[currentPath + " href"] = element.href;
      }
      if (element.src) {
        data[currentPath + " src"] = element.src;
      }
      for (const child of element.children) {
        if (["SCRIPT", "STYLE", "NOSCRIPT", "SVG"].includes(child.tagName))
          continue;
        Object.assign(data, extractElementData(child, currentPath, options));
      }
      return data;
    }
    const directText = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent.trim()).filter((t) => t).join(" ");
    if (directText) {
      data[currentPath] = directText;
    }
    if (element.tagName === "A" && element.href) {
      const linkText = element.textContent?.trim();
      const href = element.href;
      data[currentPath + " @href"] = href;
      if (linkText && linkText.length > 3 && linkText.length < 300) {
        data[currentPath + " @link"] = linkText + " ||| " + href;
      }
    } else if (element.href) {
      data[currentPath + " @href"] = element.href;
    }
    const seenImages = options._seenImages || /* @__PURE__ */ new Set();
    if (element.src) {
      const normalizedSrc = normalizeImageUrl(element.src);
      if (!seenImages.has(normalizedSrc)) {
        seenImages.add(normalizedSrc);
        data[currentPath + " @src"] = element.src;
      }
    }
    const dataSrc = element.getAttribute("data-src") || element.getAttribute("data-lazy-src");
    if (dataSrc && dataSrc.startsWith("http")) {
      const normalizedDataSrc = normalizeImageUrl(dataSrc);
      if (!seenImages.has(normalizedDataSrc)) {
        seenImages.add(normalizedDataSrc);
        data[currentPath + " @data-src"] = dataSrc;
      }
    }
    if (element.alt)
      data[currentPath + " @alt"] = element.alt;
    if (element.title && element.title.length < 200)
      data[currentPath + " @title"] = element.title;
    for (const attr of element.attributes) {
      if (attr.name.startsWith("data-") && attr.value && attr.value.length < 500) {
        const skipAttrs = ["data-spm", "data-aplus", "data-beacon"];
        if (!skipAttrs.some((s) => attr.name.startsWith(s))) {
          data[currentPath + " @" + attr.name] = attr.value;
        }
      }
    }
    if (element.children.length === 0) {
      const text = element.textContent?.trim();
      if (text && !data[currentPath]) {
        data[currentPath] = text;
      }
    }
    for (const child of element.children) {
      if (["SCRIPT", "STYLE", "NOSCRIPT", "SVG"].includes(child.tagName))
        continue;
      Object.assign(data, extractElementData(child, currentPath, { ...options, _seenImages: seenImages }));
    }
    return data;
  }
  __name(extractElementData, "extractElementData");

  // src/content/interceptor.js
  function installInterceptor() {
    window.addEventListener("__dropship_intercepted__", (event) => {
      const { url, data } = event.detail || {};
      if (!url || !data)
        return;
      handleInterceptedData(url, data);
    });
    console.log("[DropshipTracker] XHR/Fetch interceptor listener installed");
  }
  __name(installInterceptor, "installInterceptor");
  function handleInterceptedData(url, data) {
    const reviewList = data?.data?.evaViewList || data?.result?.reviews || data?.feedbackList || data?.reviewList || data?.data?.feedbackList || null;
    if (Array.isArray(reviewList) && reviewList.length > 0) {
      if (!contentState.interceptedReviews)
        contentState.interceptedReviews = [];
      for (const r of reviewList) {
        contentState.interceptedReviews.push({
          author: r.buyerName || r.userName || r.authorName || r.nickName || null,
          rating: r.buyerEval || r.starRating || r.rating || null,
          date: r.evalDate || r.date || r.createTime || null,
          text: r.buyerFeedback || r.content || r.text || r.comment || null,
          country: r.buyerCountry || r.country || null,
          images: (r.images || r.picList || []).map(
            (img) => typeof img === "string" ? img : img.imgUrl || img.url || ""
          ).filter(Boolean)
        });
      }
      console.log(`[DropshipTracker] Interceptor captured ${reviewList.length} reviews from ${url}`);
    }
    const productData = data?.data?.product || data?.result?.product || data?.productInfo || null;
    if (productData) {
      if (!contentState.interceptedProductData)
        contentState.interceptedProductData = {};
      Object.assign(contentState.interceptedProductData, productData);
      console.log("[DropshipTracker] Interceptor captured product data from", url);
    }
  }
  __name(handleInterceptedData, "handleInterceptedData");
  function mergeInterceptedReviews(domReviews = []) {
    const captured = contentState.interceptedReviews || [];
    if (captured.length === 0)
      return domReviews;
    const seen = new Set(domReviews.map((r) => (r.text || "").substring(0, 60)));
    const merged = [...domReviews];
    for (const r of captured) {
      const key = (r.text || "").substring(0, 60);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }
    return merged;
  }
  __name(mergeInterceptedReviews, "mergeInterceptedReviews");

  // src/content/productExtraction.js
  function extractBalancedJSONAt(text, fromIndex) {
    const start = text.indexOf("{", fromIndex);
    if (start === -1)
      return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\" && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString)
        continue;
      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          return text.substring(start, i + 1);
        }
      }
    }
    return null;
  }
  __name(extractBalancedJSONAt, "extractBalancedJSONAt");
  function extractEmbeddedJSON(config) {
    const result = {};
    if (config && config.jsonPatterns) {
      const scripts = document.querySelectorAll('script:not([type]), script[type="text/javascript"]');
      for (const script of scripts) {
        const text = script.textContent;
        if (!text || text.length < 50)
          continue;
        for (const patternStr of config.jsonPatterns) {
          try {
            const regex = new RegExp(patternStr);
            const match = regex.exec(text);
            if (!match)
              continue;
            const searchFrom = match.index + match[0].length - 1;
            const jsonStr = extractBalancedJSONAt(text, searchFrom);
            if (!jsonStr)
              continue;
            const data = JSON.parse(jsonStr);
            mergeJSONProductData(result, data, config);
          } catch (e) {
          }
        }
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }
  __name(extractEmbeddedJSON, "extractEmbeddedJSON");
  function mergeJSONProductData(result, data, config) {
    if (!data || typeof data !== "object")
      return;
    const propLookup = {};
    const findPropList = /* @__PURE__ */ __name((obj) => obj?.productSKUPropertyList || obj?.data?.productSKUPropertyList || obj?.data?.product?.productSKUPropertyList || obj?.skuModule?.productSKUPropertyList || null, "findPropList");
    let propList = findPropList(data);
    if (Array.isArray(propList)) {
      for (const group of propList) {
        const groupName = group.skuPropertyName || "";
        for (const val of group.skuPropertyValues || []) {
          const key = `${group.skuPropertyId}:${val.propertyValueId}`;
          propLookup[key] = {
            group: groupName,
            name: val.propertyValueDisplayName || val.propertyValueName || "",
            image: val.skuPropertyImagePath || null
          };
        }
      }
    }
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
      data.data?.product,
      data.data?.priceInfo,
      data.data?.skuInfo,
      data.data?.specsInfo,
      data.result,
      data.result?.product
    ].filter(Boolean);
    for (const obj of searchPaths) {
      if (!result.title) {
        result.title = obj.title || obj.name || obj.productTitle || obj.subject || obj.productName || null;
      }
      if (!result.price) {
        if (!result.price && obj.actPrice)
          result.price = String(obj.actPrice);
        if (!result.price && obj.discountPrice?.minAmount)
          result.price = String(obj.discountPrice.minAmount);
        if (!result.originalPrice && obj.originalPrice?.formatedPrice)
          result.originalPrice = obj.originalPrice.formatedPrice;
        const priceObj = obj.price || obj.priceInfo || obj.formatedActivityPrice || obj.activityPrice || obj.minPrice || obj.salePrice || null;
        if (typeof priceObj === "object" && priceObj) {
          result.price = result.price || priceObj.actPrice || priceObj.value || priceObj.minPrice || priceObj.formatedPrice || priceObj.salePrice || priceObj.discountPrice?.minPrice || priceObj.discountPrice?.minAmount || priceObj.formatedActivityPrice || null;
          result.originalPrice = result.originalPrice || priceObj.originalPrice || priceObj.originalPrice?.formatedPrice || priceObj.maxPrice || priceObj.formatedBiggestPrice || priceObj.formatedPrice || null;
          result.currency = result.currency || priceObj.currency || priceObj.currencySymbol || priceObj.currencyCode || null;
        } else if (priceObj) {
          result.price = priceObj;
        }
      }
      if (!result.images || result.images.length === 0) {
        const imgs = obj.images || obj.imagePathList || obj.imagePaths || obj.gallery || obj.imageList || obj.productImages || null;
        if (Array.isArray(imgs) && imgs.length > 0) {
          result.images = imgs.map((img) => {
            if (typeof img === "string")
              return img.startsWith("//") ? "https:" + img : img;
            return img.url || img.src || img.imgUrl || img.imageUrl || "";
          }).filter(Boolean).slice(0, 15);
        }
      }
      if (!result.sku) {
        result.sku = obj.sku || obj.productId || obj.itemId || obj.id || null;
      }
      if (!result.category && obj.breadcrumb) {
        const crumbs = Array.isArray(obj.breadcrumb) ? obj.breadcrumb : [obj.breadcrumb];
        result.category = crumbs.map((c) => typeof c === "string" ? c : c.name || c.title || "").filter(Boolean).join(" > ");
      }
      if (!result.category && obj.categoryPath) {
        result.category = obj.categoryPath;
      }
      if (!result.rating) {
        result.rating = obj.averageStar || obj.averageRating || obj.rating || obj.evarageStar || obj.starRating || null;
      }
      if (!result.reviewCount) {
        result.reviewCount = obj.totalReviews || obj.reviewCount || obj.tradeCount || obj.totalCount || obj.feedbackCount || null;
      }
      if (!result.orders) {
        result.orders = obj.tradeCount || obj.orderCount || obj.totalOrder || null;
      }
      if (!result.description) {
        result.description = obj.description || obj.detailDesc || obj.productDescription || null;
      }
      if (!result.brand) {
        result.brand = obj.brand || obj.brandName || (typeof obj.brand === "object" ? obj.brand?.name : null) || null;
      }
      if (result.stock === void 0) {
        const stock = obj.stock || obj.quantity || obj.totalAvailQuantity || obj.availQuantity || obj.totalStock || null;
        if (stock !== null && stock !== void 0) {
          result.stock = typeof stock === "number" ? stock : parseInt(stock, 10) || stock;
        }
      }
      if (!result.shipping) {
        const ship = obj.shippingFee || obj.freightAmount || obj.shippingPrice || null;
        if (ship) {
          result.shipping = typeof ship === "object" ? ship.formatedAmount || ship.value || ship : ship;
        }
        if (!result.shipping && obj.freeShipping) {
          result.shipping = "Free Shipping";
        }
      }
      if (!result.minOrder) {
        result.minOrder = obj.minOrder || obj.moq || obj.minOrderQuantity || null;
      }
      if ((!result.variants || result.variants.length === 0) && obj.skuPriceList) {
        result.variants = obj.skuPriceList.map((sku) => {
          const attrDecoded = {};
          const rawAttr = sku.skuAttr || sku.skuPropIds || "";
          if (rawAttr && Object.keys(propLookup).length > 0) {
            rawAttr.split(";").forEach((pair) => {
              const entry = propLookup[pair.trim()];
              if (entry) {
                attrDecoded[entry.group] = entry.name;
              }
            });
          }
          return {
            id: sku.skuId || sku.id,
            price: sku.skuVal?.actSkuCalPrice || sku.skuVal?.skuCalPrice || sku.price,
            stock: sku.skuVal?.availQuantity ?? sku.stock,
            attributes: Object.keys(attrDecoded).length > 0 ? attrDecoded : rawAttr,
            attributesRaw: rawAttr
          };
        });
      }
      if ((!result.variantGroups || result.variantGroups.length === 0) && obj.productSKUPropertyList) {
        result.variantGroups = obj.productSKUPropertyList.map((group) => ({
          name: group.skuPropertyName,
          values: (group.skuPropertyValues || []).map((v) => ({
            name: v.propertyValueDisplayName || v.propertyValueName,
            id: v.propertyValueId,
            image: v.skuPropertyImagePath || null
          }))
        }));
      }
      if (!result.specifications && obj.specifications) {
        result.specifications = obj.specifications;
      }
      if (!result.specifications && obj.properties) {
        const props = Array.isArray(obj.properties) ? obj.properties : [];
        result.specifications = props.map((p) => ({
          name: p.name || p.attrName || p.key || "",
          value: p.value || p.attrValue || p.val || ""
        })).filter((s) => s.name && s.value);
      }
      if (!result.specifications && obj.attrList) {
        result.specifications = obj.attrList.map((a) => ({
          name: a.attrName || a.name || "",
          value: a.attrValue || a.value || ""
        })).filter((s) => s.name && s.value);
      }
    }
  }
  __name(mergeJSONProductData, "mergeJSONProductData");
  function extractVideoUrls(config) {
    const urls = /* @__PURE__ */ new Set();
    const selectors = config?.videoSelectors || [
      "video source",
      'iframe[src*="video"]',
      '[class*="video"] video',
      "video[src]"
    ];
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          const src = el.src || el.getAttribute("src") || el.getAttribute("data-src");
          if (src && src.startsWith("http"))
            urls.add(src);
        });
      } catch (e) {
      }
    }
    return Array.from(urls);
  }
  __name(extractVideoUrls, "extractVideoUrls");
  function extractSpecifications(config) {
    const specs = [];
    const seen = /* @__PURE__ */ new Set();
    const selectors = config?.specSelectors || [
      ".product-specs",
      '[class*="specification"]',
      '[class*="Specification"]',
      ".product-property-list"
    ];
    for (const sel of selectors) {
      try {
        const container = document.querySelector(sel);
        if (!container)
          continue;
        container.querySelectorAll('li, tr, .do-entry-item, [class*="prop-item"], [class*="attr-item"]').forEach((item) => {
          const nameEl = item.querySelector('[class*="name"], [class*="label"], [class*="key"], th, td:first-child, dt, .prop-name');
          const valueEl = item.querySelector('[class*="value"], [class*="val"], td:last-child, dd, .prop-value');
          if (nameEl && valueEl) {
            const name = nameEl.textContent?.trim();
            const value = valueEl.textContent?.trim();
            const key = (name + ":" + value).toLowerCase();
            if (name && value && name !== value && !seen.has(key)) {
              seen.add(key);
              specs.push({ name, value });
            }
          }
        });
        if (specs.length > 0)
          break;
      } catch (e) {
      }
    }
    if (specs.length === 0) {
      document.querySelectorAll("dl").forEach((dl) => {
        const dts = dl.querySelectorAll("dt");
        const dds = dl.querySelectorAll("dd");
        const count = Math.min(dts.length, dds.length);
        for (let i = 0; i < count; i++) {
          const name = dts[i].textContent?.trim();
          const value = dds[i].textContent?.trim();
          const key = (name + ":" + value).toLowerCase();
          if (name && value && !seen.has(key)) {
            seen.add(key);
            specs.push({ name, value });
          }
        }
      });
    }
    if (specs.length === 0) {
      const containers = document.querySelectorAll(
        'ul, ol, .product-specs, [class*="spec"], [class*="Spec"], [class*="attribute"], [class*="Attribute"], [class*="property"], [class*="Property"]'
      );
      for (const container of containers) {
        for (const item of container.querySelectorAll("li, div, p")) {
          const spans = item.querySelectorAll("span");
          if (spans.length >= 2) {
            const name = spans[0].textContent?.trim().replace(/:$/, "");
            const value = spans[spans.length - 1].textContent?.trim();
            const key = (name + ":" + value).toLowerCase();
            if (name && value && name !== value && name.length > 1 && value.length > 0 && !seen.has(key)) {
              seen.add(key);
              specs.push({ name, value });
            }
          }
        }
        if (specs.length > 0)
          break;
      }
    }
    return specs;
  }
  __name(extractSpecifications, "extractSpecifications");
  function extractVariantGroups(config) {
    const groups = {};
    const allVariants = [];
    const groupSelectors = [
      ".sku-property",
      '[class*="Sku--property"]',
      '[class*="sku-property"]',
      '[class*="product-sku"]',
      ".sku-attr"
    ];
    for (const selector of groupSelectors) {
      try {
        document.querySelectorAll(selector).forEach((group) => {
          const groupName = group.querySelector('[class*="title"], [class*="name"], .sku-title, label')?.textContent?.trim()?.replace(":", "") || "Option";
          if (!groups[groupName])
            groups[groupName] = [];
          group.querySelectorAll('[class*="item"], .sku-property-item, button[class*="sku"], [class*="value"]').forEach((item) => {
            if (item.querySelector('[class*="title"]'))
              return;
            const variant = {
              type: groupName,
              name: item.getAttribute("title") || item.getAttribute("data-spm-anchor-id")?.split(".").pop() || item.textContent?.trim(),
              value: item.getAttribute("data-value") || item.getAttribute("data-sku-id") || item.getAttribute("data-id"),
              image: item.querySelector("img")?.src || item.style.backgroundImage?.replace(/url\(['"]?|['"]?\)/g, ""),
              selected: item.classList.contains("selected") || item.classList.contains("active") || item.hasAttribute("checked"),
              available: !item.classList.contains("disabled") && !item.classList.contains("unavailable"),
              priceModifier: item.getAttribute("data-price") || null
            };
            if (variant.name && variant.name.length < 100) {
              groups[groupName].push(variant);
              allVariants.push(variant);
            }
          });
        });
        if (Object.keys(groups).length > 0)
          break;
      } catch (e) {
      }
    }
    return { groups, allVariants };
  }
  __name(extractVariantGroups, "extractVariantGroups");
  function extractReviewsData(config) {
    const reviews = [];
    const reviewSelectors = config?.reviewSelectors || [
      ".feedback-item",
      '[class*="review-item"]',
      '[class*="Review--wrap"]',
      ".review-content",
      '[class*="reviewItem"]'
    ];
    for (const selector of reviewSelectors) {
      try {
        document.querySelectorAll(selector).forEach((el) => {
          const review = {
            author: el.querySelector('[class*="user"], [class*="name"], .user-name, [class*="buyer"]')?.textContent?.trim(),
            rating: extractRating(el),
            date: el.querySelector('[class*="date"], time, [class*="time"]')?.textContent?.trim(),
            text: el.querySelector('[class*="content"], [class*="text"], .review-content, [class*="comment"]')?.textContent?.trim(),
            images: Array.from(el.querySelectorAll("img")).map((img) => img.src).filter((s) => s && !s.includes("avatar") && !s.includes("icon")),
            country: el.querySelector('[class*="country"], [class*="flag"]')?.getAttribute("title") || el.querySelector('[class*="country"]')?.textContent?.trim()
          };
          if (review.text || review.rating) {
            reviews.push(review);
          }
        });
        if (reviews.length > 0)
          break;
      } catch (e) {
      }
    }
    return reviews;
  }
  __name(extractReviewsData, "extractReviewsData");
  function extractRating(element) {
    const stars = element.querySelectorAll('[class*="star"][class*="full"], .star-icon.fill, [class*="star-on"], [class*="starFilled"]');
    if (stars.length > 0 && stars.length <= 5)
      return stars.length;
    const percent = element.querySelector('[style*="width"]');
    if (percent && percent.style.width) {
      const match2 = percent.style.width.match(/(\d+)/);
      if (match2)
        return Math.round(parseInt(match2[1]) / 20);
    }
    const ariaRating = element.querySelector('[aria-label*="star"], [aria-label*="rating"]');
    if (ariaRating) {
      const match2 = ariaRating.getAttribute("aria-label").match(/(\d+(?:\.\d+)?)/);
      if (match2)
        return parseFloat(match2[1]);
    }
    const text = element.textContent;
    const match = text.match(/(\d+(?:\.\d+)?)\s*(?:star|\/\s*5)/i);
    if (match)
      return parseFloat(match[1]);
    return null;
  }
  __name(extractRating, "extractRating");
  function extractProductDetails(callback) {
    const config = getSiteConfig();
    const { customSelectors } = contentState;
    const product = {
      productId: extractProductId(),
      url: window.location.href,
      domain: window.location.hostname,
      extractedAt: Date.now()
    };
    const tryCustomOrFallback = /* @__PURE__ */ __name((field, fallbackFn) => {
      const custom = customSelectors[field];
      if (custom && custom.selector) {
        try {
          const el = document.querySelector(custom.selector);
          if (el) {
            const value = extractSampleValue(el);
            if (value)
              return value;
          }
        } catch (e) {
        }
      }
      return fallbackFn ? fallbackFn() : null;
    }, "tryCustomOrFallback");
    const jsonData = extractEmbeddedJSON(config);
    if (jsonData) {
      if (jsonData.title)
        product.title = jsonData.title;
      if (jsonData.price)
        product.price = jsonData.price;
      if (jsonData.originalPrice)
        product.originalPrice = jsonData.originalPrice;
      if (jsonData.currency)
        product.currency = jsonData.currency;
      if (jsonData.description)
        product.description = jsonData.description;
      if (jsonData.images && jsonData.images.length > 0)
        product.images = jsonData.images;
      if (jsonData.sku)
        product.sku = jsonData.sku;
      if (jsonData.brand)
        product.brand = jsonData.brand;
      if (jsonData.category)
        product.category = jsonData.category;
      if (jsonData.stock !== void 0)
        product.stock = jsonData.stock;
      if (jsonData.rating)
        product.rating = jsonData.rating;
      if (jsonData.reviewCount)
        product.reviewCount = jsonData.reviewCount;
      if (jsonData.variants)
        product.variants = jsonData.variants;
      if (jsonData.specifications)
        product.specifications = jsonData.specifications;
    }
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const jsonLd of jsonLdScripts) {
      try {
        const data = JSON.parse(jsonLd.textContent);
        const prod = data["@type"] === "Product" ? data : data.product || null;
        if (prod) {
          if (!product.title && prod.name)
            product.title = prod.name;
          if (!product.description && prod.description)
            product.description = prod.description;
          if (!product.price)
            product.price = prod.offers?.price || prod.offers?.lowPrice;
          if (!product.originalPrice)
            product.originalPrice = prod.offers?.highPrice || null;
          if (!product.currency && prod.offers?.priceCurrency)
            product.currency = prod.offers?.priceCurrency;
          if (!product.sku && prod.sku)
            product.sku = prod.sku;
          if (!product.brand)
            product.brand = prod.brand?.name || prod.brand;
          if (!product.availability)
            product.availability = prod.offers?.availability;
          if (prod.image && (!product.images || product.images.length === 0)) {
            product.images = Array.isArray(prod.image) ? prod.image : [prod.image];
          }
          if (prod.aggregateRating) {
            product.rating = prod.aggregateRating.ratingValue;
            product.reviewCount = prod.aggregateRating.reviewCount;
          }
          if (prod.weight) {
            product.weight = typeof prod.weight === "object" ? prod.weight.value : prod.weight;
          }
          break;
        }
        const breadcrumb = data["@type"] === "BreadcrumbList" ? data : null;
        if (breadcrumb && breadcrumb.itemListElement) {
          product.category = breadcrumb.itemListElement.sort((a, b) => (a.position || 0) - (b.position || 0)).map((item) => item.name || item.item?.name || "").filter((n) => n).join(" > ");
        }
      } catch (e) {
      }
    }
    if (!product.title) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle)
        product.title = ogTitle.content;
    }
    if (!product.description) {
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc)
        product.description = ogDesc.content;
    }
    if (!product.images || product.images.length === 0) {
      const ogImage = document.querySelector('meta[property="og:image"]');
      if (ogImage && ogImage.content)
        product.images = [ogImage.content];
    }
    if (!product.shortDescription) {
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc)
        product.shortDescription = metaDesc.content;
    }
    if (!product.metaKeywords) {
      const metaKw = document.querySelector('meta[name="keywords"]');
      if (metaKw && metaKw.content)
        product.metaKeywords = metaKw.content;
    }
    if (!product.metaDescription) {
      const metaD = document.querySelector('meta[name="description"]');
      if (metaD && metaD.content)
        product.metaDescription = metaD.content;
    }
    const customTitle = tryCustomOrFallback("product_name");
    const customPrice = tryCustomOrFallback("price");
    const customOriginalPrice = tryCustomOrFallback("list_price") || tryCustomOrFallback("original_price");
    const customShipping = tryCustomOrFallback("shipping") || tryCustomOrFallback("shipping_cost");
    const customDescription = tryCustomOrFallback("description");
    const customShortDescription = tryCustomOrFallback("short_description");
    const customBrand = tryCustomOrFallback("brand");
    const customRating = tryCustomOrFallback("rating");
    const customReviews = tryCustomOrFallback("review_count");
    const customCategory = tryCustomOrFallback("category");
    const customStock = tryCustomOrFallback("quantity");
    const customWeight = tryCustomOrFallback("weight");
    const customStoreName = tryCustomOrFallback("store_name");
    if (customTitle)
      product.title = customTitle;
    if (customPrice)
      product.price = customPrice;
    if (customOriginalPrice)
      product.originalPrice = customOriginalPrice;
    if (customShipping)
      product.shipping = customShipping;
    if (customDescription)
      product.description = customDescription;
    if (customShortDescription)
      product.shortDescription = customShortDescription;
    if (customBrand)
      product.brand = customBrand;
    if (customRating)
      product.rating = customRating;
    if (customReviews)
      product.reviewCount = customReviews;
    if (customCategory)
      product.category = customCategory;
    if (customStock)
      product.stock = customStock;
    if (customWeight)
      product.weight = customWeight;
    if (customStoreName)
      product.storeName = customStoreName;
    if (!product.price) {
      const priceMeta = document.querySelector('meta[property="product:price:amount"], meta[itemprop="price"], meta[name="price"]');
      if (priceMeta)
        product.price = priceMeta.content;
    }
    if (config) {
      if (!product.title)
        product.title = trySelectors(config.titleSelectors);
      if (!product.price)
        product.price = tryPriceSelectors(config.priceSelectors);
      if (!product.shipping)
        product.shipping = trySelectors(config.shippingSelectors);
      if (!product.originalPrice && config.originalPriceSelectors) {
        product.originalPrice = tryPriceSelectors(config.originalPriceSelectors);
      }
      if (!product.category && config.breadcrumbSelectors) {
        const crumbs = trySelectorsAll(config.breadcrumbSelectors);
        if (crumbs.length > 0) {
          product.category = crumbs.join(" > ");
        }
      }
      if (!product.storeName && config.storeSelectors) {
        product.storeName = trySelectors(config.storeSelectors);
      }
      if (!product.storeRating && config.storeRatingSelectors) {
        product.storeRating = trySelectors(config.storeRatingSelectors);
      }
      if (!product.stock && config.stockSelectors) {
        const stockText = trySelectors(config.stockSelectors);
        if (stockText) {
          const match = stockText.match(/(\d+)/);
          product.stock = match ? parseInt(match[1]) : stockText;
        }
      }
      if (config.moqSelectors) {
        product.minOrder = trySelectors(config.moqSelectors);
      }
    }
    if (!product.title) {
      const h1s = document.querySelectorAll("h1");
      for (const h1 of h1s) {
        const text = h1.textContent?.trim();
        if (text && text.length > 10 && !text.match(/^\d+%|off|save|discount/i)) {
          product.title = text;
          break;
        }
      }
    }
    if (product.title) {
      product.title = product.title.replace(/\s*-\s*Buy\s+.*/i, "").replace(/\s*\|\s*[A-Za-z]+\.com.*$/i, "").trim();
    }
    if (!product.price) {
      const priceElements = document.querySelectorAll('[class*="price" i]:not([class*="compare"]):not([class*="original"]):not([class*="old"])');
      for (const el of priceElements) {
        if (el.closest('[class*="original"], [class*="was"], [class*="old"], [class*="compare"]'))
          continue;
        const parsed = parsePriceText(el.textContent);
        if (parsed) {
          product.price = parsed;
          product.priceRaw = el.textContent.trim();
          break;
        }
      }
    }
    if (!product.originalPrice) {
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
        } catch (e) {
        }
      }
    }
    if (!product.currency) {
      product.currency = detectCurrency();
    }
    if (!product.category) {
      const breadcrumbSelectors = [
        'nav[aria-label*="breadcrumb" i] a',
        'nav[aria-label*="breadcrumb" i] span',
        ".breadcrumb a",
        ".breadcrumb li",
        '[class*="breadcrumb" i] a',
        '[class*="breadcrumb" i] li',
        '[itemtype*="BreadcrumbList"] [itemprop="name"]'
      ];
      for (const sel of breadcrumbSelectors) {
        try {
          const els = document.querySelectorAll(sel);
          if (els.length >= 2) {
            const crumbs = Array.from(els).map((el) => el.textContent?.trim()).filter((t) => t && t.length > 1 && !/home|main/i.test(t));
            if (crumbs.length >= 1) {
              product.category = crumbs.join(" > ");
              break;
            }
          }
        } catch (e) {
        }
      }
    }
    if (!product.stock && !product.availability) {
      const availMeta = document.querySelector('[itemprop="availability"]');
      if (availMeta) {
        const val = availMeta.content || availMeta.href || availMeta.textContent;
        product.availability = val;
        if (/InStock/i.test(val))
          product.stock = 999;
        else if (/OutOfStock/i.test(val))
          product.stock = 0;
      }
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
                if (/in\s*stock/i.test(text)) {
                  product.stock = 999;
                  break;
                }
                if (/out\s*of\s*stock|sold\s*out|unavailable/i.test(text)) {
                  product.stock = 0;
                  break;
                }
              }
            }
          } catch (e) {
          }
        }
      }
    }
    if (!product.weight) {
      const allText = document.body.innerText;
      const weightMatch = allText.match(/(?:weight|net\s*weight|package\s*weight)\s*[:=]\s*([\d.]+)\s*(kg|g|lb|oz)/i);
      if (weightMatch) {
        let w = parseFloat(weightMatch[1]);
        const unit = weightMatch[2].toLowerCase();
        if (unit === "g")
          w = w / 1e3;
        else if (unit === "lb")
          w = w * 0.4536;
        else if (unit === "oz")
          w = w * 0.0283;
        product.weight = Math.round(w * 1e3) / 1e3;
        product.weightUnit = "kg";
      }
    }
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
              if (el.href)
                product.storeUrl = el.href;
              break;
            }
          }
        } catch (e) {
        }
      }
    }
    if (product.shipping && typeof product.shipping === "string") {
      product.shippingText = product.shipping;
      const shippingParsed = parsePriceText(product.shipping);
      if (shippingParsed !== null) {
        product.shippingCost = shippingParsed;
      } else if (/free/i.test(product.shipping)) {
        product.shippingCost = 0;
      }
    }
    const imageUrls = /* @__PURE__ */ new Set();
    if (config && config.imageSelectors) {
      for (const selector of config.imageSelectors) {
        try {
          document.querySelectorAll(selector).forEach((img) => {
            let src = img.src || img.getAttribute("data-src") || img.getAttribute("data-lazy-src");
            if (src) {
              src = cleanImageUrl(src);
              if (isValidProductImage(src))
                imageUrls.add(src);
            }
          });
        } catch (e) {
        }
      }
    }
    document.querySelectorAll('[class*="gallery"] img, [class*="Gallery"] img, .images-view-list img, [class*="slider"] img, [class*="carousel"] img, [class*="thumb"] img').forEach((img) => {
      let src = img.src || img.getAttribute("data-src") || img.getAttribute("data-lazy-src");
      if (src) {
        src = cleanImageUrl(src);
        if (isValidProductImage(src))
          imageUrls.add(src);
      }
    });
    document.querySelectorAll("img").forEach((img) => {
      if (img.width > 200 || img.height > 200) {
        let src = img.src || img.getAttribute("data-src");
        if (src) {
          src = cleanImageUrl(src);
          if (isValidProductImage(src))
            imageUrls.add(src);
        }
      }
    });
    const domImages = Array.from(imageUrls).slice(0, 15);
    if (!product.images || product.images.length === 0) {
      product.images = domImages;
    } else {
      const existing = new Set(product.images.map((u) => u.replace(/^https?:/, "")));
      for (const img of domImages) {
        if (!existing.has(img.replace(/^https?:/, ""))) {
          product.images.push(img);
        }
      }
      product.images = product.images.slice(0, 20);
    }
    if (!product.variantGroups || !Array.isArray(product.variantGroups) || product.variantGroups.length === 0) {
      const domVars = extractVariantGroups(config);
      product.variantGroups = Object.entries(domVars.groups || {}).map(([name, vals]) => ({
        name,
        values: vals.map((v) => ({ name: v.name, id: v.value || null, image: v.image || null }))
      }));
      if (!product.variants || product.variants.length === 0) {
        product.variants = domVars.allVariants || [];
      }
    }
    product.reviews = mergeInterceptedReviews(extractReviewsData(config));
    if (!product.description) {
      const descSelectors = config?.descriptionSelectors || [
        '[class*="description"]',
        '[class*="Description"]',
        "#product-description",
        ".product-description",
        '[class*="detail-desc"]'
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
        } catch (e) {
        }
      }
    }
    if (!product.shortDescription && (product.descriptionText || product.description)) {
      const plainText = (product.descriptionText || product.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (plainText.length > 200) {
        const cut = plainText.substring(0, 200);
        const lastPeriod = cut.lastIndexOf(".");
        const lastSpace = cut.lastIndexOf(" ");
        product.shortDescription = plainText.substring(0, lastPeriod > 150 ? lastPeriod + 1 : lastSpace) + "...";
      } else {
        product.shortDescription = plainText;
      }
    }
    product.videoUrls = extractVideoUrls(config);
    if (!product.specifications || product.specifications.length === 0) {
      product.specifications = extractSpecifications(config);
    }
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
        } catch (e) {
        }
      }
    }
    if (!product.rating) {
      const ratingSelectors = [
        '[itemprop="ratingValue"]',
        '[class*="rating"] [class*="score"]:not([class*="count"]):not([class*="num"])',
        '[class*="Rating"] [class*="Score"]:not([class*="count"]):not([class*="num"])',
        '[class*="star-rating"] [class*="current"]',
        '[aria-label*="star"], [aria-label*="rating"]'
      ];
      for (const sel of ratingSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            const text = el.textContent || el.getAttribute("aria-label") || "";
            const match = text.match(/(\d+(?:\.\d+)?)/);
            if (match) {
              const val = parseFloat(match[1]);
              if (val <= 10) {
                product.rating = val;
                break;
              }
            }
          }
        } catch (e) {
        }
      }
    }
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
            const text = el.textContent || "";
            const match = text.match(/(\d+(?:,\d+)*)/);
            if (match) {
              product.reviewCount = parseInt(match[1].replace(/,/g, ""));
              break;
            }
          }
        } catch (e) {
        }
      }
    }
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
            const text = el.textContent || "";
            const match = text.match(/(\d+(?:,\d+)*)/);
            if (match) {
              product.soldCount = parseInt(match[1].replace(/,/g, ""));
              break;
            }
          }
        } catch (e) {
        }
      }
    }
    let _responseSent = false;
    const safeCallback = /* @__PURE__ */ __name((data) => {
      if (_responseSent)
        return;
      _responseSent = true;
      try {
        callback(data);
      } catch (e) {
        console.warn("[DropshipTracker] sendResponse already closed:", e.message);
      }
    }, "safeCallback");
    if (!product.title && !product.price && !product._retried) {
      product._retried = true;
      console.log("[DropshipTracker] Missing title+price \u2014 retrying in 2s (SPA hydration)");
      setTimeout(() => {
        const retryJSON = extractEmbeddedJSON(config);
        if (retryJSON) {
          if (retryJSON.title)
            product.title = retryJSON.title;
          if (retryJSON.price)
            product.price = retryJSON.price;
          if (retryJSON.originalPrice)
            product.originalPrice = product.originalPrice || retryJSON.originalPrice;
          if (retryJSON.currency)
            product.currency = product.currency || retryJSON.currency;
          if (retryJSON.images?.length > 0)
            product.images = product.images?.length ? product.images : retryJSON.images;
          if (retryJSON.rating)
            product.rating = product.rating || retryJSON.rating;
          if (retryJSON.reviewCount)
            product.reviewCount = product.reviewCount || retryJSON.reviewCount;
          if (retryJSON.description)
            product.description = product.description || retryJSON.description;
          if (retryJSON.sku)
            product.sku = product.sku || retryJSON.sku;
          if (retryJSON.brand)
            product.brand = product.brand || retryJSON.brand;
          if (retryJSON.stock !== void 0)
            product.stock = product.stock ?? retryJSON.stock;
          if (retryJSON.orders)
            product.orders = product.orders || retryJSON.orders;
        }
        if (!product.title) {
          const h1 = document.querySelector("h1");
          if (h1)
            product.title = h1.textContent?.trim();
        }
        if (!product.price) {
          const priceEl = document.querySelector('[class*="price" i]:not([class*="original"]):not([class*="old"])');
          if (priceEl)
            product.price = parsePriceText(priceEl.textContent);
        }
        delete product._retried;
        safeCallback(product);
      }, 2e3);
      return;
    }
    delete product._retried;
    safeCallback(product);
  }
  __name(extractProductDetails, "extractProductDetails");

  // src/content/navigation.js
  function selectNextButton(callback) {
    document.removeEventListener("click", nextButtonClickHandler, true);
    document.removeEventListener("mouseover", highlightHoverHandler, true);
    window._nextButtonCallback = callback;
    document.addEventListener("click", nextButtonClickHandler, true);
    document.addEventListener("mouseover", highlightHoverHandler, true);
    document.body.classList.add("dropship-selecting-next");
  }
  __name(selectNextButton, "selectNextButton");
  function nextButtonClickHandler(e) {
    e.preventDefault();
    e.stopPropagation();
    const selector = buildSelector(e.target);
    contentState.nextButtonSelector = selector;
    document.removeEventListener("click", nextButtonClickHandler, true);
    document.removeEventListener("mouseover", highlightHoverHandler, true);
    document.body.classList.remove("dropship-selecting-next");
    document.querySelectorAll(".dropship-hover-highlight").forEach((el) => {
      el.classList.remove("dropship-hover-highlight");
    });
    e.target.classList.add("dropship-next-button");
    if (window._nextButtonCallback) {
      window._nextButtonCallback({ selector, element: e.target.outerHTML.substring(0, 200) });
    }
  }
  __name(nextButtonClickHandler, "nextButtonClickHandler");
  function highlightHoverHandler(e) {
    document.querySelectorAll(".dropship-hover-highlight").forEach((el) => {
      el.classList.remove("dropship-hover-highlight");
    });
    e.target.classList.add("dropship-hover-highlight");
  }
  __name(highlightHoverHandler, "highlightHoverHandler");
  function clickNextButton(callback, selector) {
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
  __name(clickNextButton, "clickNextButton");
  function scrollDown(callback) {
    const table = contentState.detectedTables[contentState.currentTableIndex];
    const tableElement = table?.element;
    const scrollTarget = tableElement ? findScrollableParent(tableElement) : document.scrollingElement || document.body;
    const countChildren = /* @__PURE__ */ __name(() => {
      if (tableElement)
        return tableElement.children.length;
      return 0;
    }, "countChildren");
    let prevChildCount = countChildren();
    let prevScrollTop = scrollTarget.scrollTop;
    let iterations = 0;
    const maxIterations = 30;
    function scrollStep() {
      iterations++;
      if (iterations > maxIterations) {
        callback({ scrolled: true, heightChanged: false, reason: "max_iterations" });
        return;
      }
      scrollTarget.scrollTop += 1e3;
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
          callback({ scrolled: true, heightChanged: false, reason: "bottom_reached" });
          return;
        }
        prevChildCount = currChildCount;
        prevScrollTop = currScrollTop;
        scrollStep();
      }, 1e3);
    }
    __name(scrollStep, "scrollStep");
    scrollStep();
  }
  __name(scrollDown, "scrollDown");
  function getPageHash(callback) {
    const table = contentState.detectedTables[contentState.currentTableIndex];
    const content = table?.element ? table.element.innerText.substring(0, 1e4) : document.body.innerText.substring(0, 1e4);
    if (typeof sha256 !== "undefined") {
      const hash = sha256.create();
      hash.update(content);
      callback({ hash: hash.hex() });
    } else {
      let hash = 0;
      for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      callback({ hash: hash.toString(16) });
    }
  }
  __name(getPageHash, "getPageHash");

  // src/content/selectorPicker.js
  function startSelectorPicker(callback, fieldName) {
    if (contentState.selectorPickerActive) {
      stopSelectorPicker();
    }
    contentState.selectorPickerActive = true;
    contentState.selectorPickerCallback = null;
    contentState.selectorPickerField = fieldName;
    if (!document.getElementById("dropship-picker-styles")) {
      const style = document.createElement("style");
      style.id = "dropship-picker-styles";
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
    const overlay = document.createElement("div");
    overlay.id = "dropship-picker-overlay";
    overlay.className = "dropship-picker-overlay";
    overlay.textContent = 'Click element for "' + fieldName + '" | Press ESC to cancel';
    document.body.appendChild(overlay);
    const info = document.createElement("div");
    info.id = "dropship-picker-info";
    info.className = "dropship-picker-info";
    info.textContent = "Hover over elements to see selector...";
    document.body.appendChild(info);
    document.addEventListener("mouseover", pickerHoverHandler, true);
    document.addEventListener("mouseout", pickerUnhoverHandler, true);
    document.addEventListener("click", pickerClickHandler, true);
    document.addEventListener("keydown", pickerEscHandler, true);
    callback({ started: true, field: fieldName });
  }
  __name(startSelectorPicker, "startSelectorPicker");
  function pickerHoverHandler(e) {
    if (!contentState.selectorPickerActive)
      return;
    e.target.classList.add("dropship-picker-hover");
    const info = document.getElementById("dropship-picker-info");
    if (info) {
      const selector = buildUniqueSelector(e.target);
      const value = extractSampleValue(e.target);
      info.textContent = "Selector: " + selector.substring(0, 80) + (selector.length > 80 ? "..." : "") + " | Value: " + (value || "").substring(0, 60) + ((value || "").length > 60 ? "..." : "");
    }
  }
  __name(pickerHoverHandler, "pickerHoverHandler");
  function pickerUnhoverHandler(e) {
    if (!contentState.selectorPickerActive)
      return;
    e.target.classList.remove("dropship-picker-hover");
  }
  __name(pickerUnhoverHandler, "pickerUnhoverHandler");
  function pickerClickHandler(e) {
    if (!contentState.selectorPickerActive)
      return;
    e.preventDefault();
    e.stopPropagation();
    const element = e.target;
    const selector = buildUniqueSelector(element);
    const sampleValue = extractSampleValue(element);
    element.classList.remove("dropship-picker-hover");
    element.classList.add("dropship-picker-selected");
    contentState.customSelectors[contentState.selectorPickerField] = {
      selector,
      sampleValue,
      savedAt: Date.now()
    };
    const fieldName = contentState.selectorPickerField;
    stopSelectorPicker();
    try {
      chrome.runtime.sendMessage({
        action: "selectorPickerResult",
        success: true,
        field: fieldName,
        selector,
        sampleValue,
        domain: window.location.hostname
      });
    } catch (e2) {
      console.log("[DropshipTracker] Could not send picker result:", e2);
    }
  }
  __name(pickerClickHandler, "pickerClickHandler");
  function pickerEscHandler(e) {
    if (e.key === "Escape" && contentState.selectorPickerActive) {
      const field = contentState.selectorPickerField;
      stopSelectorPicker();
      try {
        chrome.runtime.sendMessage({
          action: "selectorPickerResult",
          cancelled: true,
          field
        });
      } catch (err) {
        console.log("[DropshipTracker] Could not send cancel:", err);
      }
    }
  }
  __name(pickerEscHandler, "pickerEscHandler");
  function stopSelectorPicker() {
    contentState.selectorPickerActive = false;
    document.removeEventListener("mouseover", pickerHoverHandler, true);
    document.removeEventListener("mouseout", pickerUnhoverHandler, true);
    document.removeEventListener("click", pickerClickHandler, true);
    document.removeEventListener("keydown", pickerEscHandler, true);
    const overlay = document.getElementById("dropship-picker-overlay");
    if (overlay)
      overlay.remove();
    const info = document.getElementById("dropship-picker-info");
    if (info)
      info.remove();
    document.querySelectorAll(".dropship-picker-hover").forEach((el) => {
      el.classList.remove("dropship-picker-hover");
    });
  }
  __name(stopSelectorPicker, "stopSelectorPicker");
  function buildUniqueSelector(element) {
    const parts = [];
    let current = element;
    let maxIterations = 50;
    while (current && current !== document.body && current !== document.documentElement && maxIterations-- > 0) {
      let selector = current.tagName.toLowerCase();
      if (current.id && document.querySelectorAll("#" + CSS.escape(current.id)).length === 1) {
        selector = "#" + CSS.escape(current.id);
        parts.unshift(selector);
        break;
      }
      const stableAttrs = ["data-product-id", "data-item-id", "data-sku", "data-testid", "role"];
      for (const attr of stableAttrs) {
        const val = current.getAttribute(attr);
        if (val && !val.includes(" ")) {
          selector += `[${attr}="${CSS.escape(val)}"]`;
          parts.unshift(selector);
          if (document.querySelectorAll(parts.join(" > ")).length === 1) {
            return parts.join(" > ");
          }
          break;
        }
      }
      if (current.className && typeof current.className === "string") {
        const classes = current.className.trim().split(/\s+/).filter((c) => c && !/^\d|--|__|index-\d/.test(c)).slice(0, 3);
        if (classes.length > 0) {
          selector += "." + classes.map((c) => CSS.escape(c)).join(".");
        }
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-child(${index})`;
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }
  __name(buildUniqueSelector, "buildUniqueSelector");
  function extractWithCustomSelector(selector) {
    const element = document.querySelector(selector);
    if (!element)
      return null;
    return extractSampleValue(element);
  }
  __name(extractWithCustomSelector, "extractWithCustomSelector");
  function extractAllWithSelector(selector) {
    const elements = document.querySelectorAll(selector);
    if (elements.length === 0)
      return [];
    return Array.from(elements).map((el) => extractSampleValue(el)).filter((v) => v);
  }
  __name(extractAllWithSelector, "extractAllWithSelector");
  function getAllCustomSelectors(callback) {
    callback(contentState.customSelectors);
  }
  __name(getAllCustomSelectors, "getAllCustomSelectors");

  // src/content/main.js
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
  __name(loadCustomSelectors, "loadCustomSelectors");
  function saveCustomSelectors(callback) {
    const domain = window.location.hostname;
    const key = `customSelectors_${domain}`;
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [key]: contentState.customSelectors }, () => {
        callback && callback({ success: true });
      });
    }
  }
  __name(saveCustomSelectors, "saveCustomSelectors");
  installInterceptor();
  loadCustomSelectors();
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case "ping":
        sendResponse({ pong: true });
        return false;
      case "findTables":
        findTables(sendResponse);
        return true;
      case "nextTable":
        nextTable(sendResponse);
        return true;
      case "getTableData":
        getTableData(sendResponse, request.selector);
        return true;
      case "extractProduct":
        extractProductDetails(sendResponse);
        return true;
      case "selectNextButton":
        selectNextButton(sendResponse);
        return true;
      case "clickNext":
        clickNextButton(sendResponse, request.selector);
        return true;
      case "scrollDown":
        scrollDown(sendResponse);
        return true;
      case "getPageHash":
        getPageHash(sendResponse);
        return true;
      case "startSelectorPicker":
        startSelectorPicker(sendResponse, request.field);
        return true;
      case "stopSelectorPicker":
        stopSelectorPicker();
        sendResponse({ stopped: true });
        return true;
      case "getCustomSelectors":
        getAllCustomSelectors(sendResponse);
        return true;
      case "saveCustomSelectors":
        contentState.customSelectors = request.selectors || {};
        saveCustomSelectors(sendResponse);
        return true;
      case "extractWithSelector":
        sendResponse({
          value: extractWithCustomSelector(request.selector),
          allValues: extractAllWithSelector(request.selector)
        });
        return true;
    }
  });
  console.log("[DropshipTracker] Content script loaded on", window.location.hostname);
})();
