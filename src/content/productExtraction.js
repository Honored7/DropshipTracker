/**
 * Product detail page extraction
 * Extracts comprehensive product data from single product pages
 * Uses JSON-first strategy, then JSON-LD, then CSS selectors, then fallbacks
 */

import { contentState } from './contentState.js';
import { getSiteConfig } from './siteConfigs.js';
import {
  extractProductId,
  normalizeImageUrl,
  isValidProductImage,
  cleanImageUrl,
  parsePriceText,
  detectCurrency,
  trySelectors,
  tryPriceSelectors,
  trySelectorsAll,
  extractSampleValue
} from './utils.js';

// ============================================
// EMBEDDED JSON EXTRACTION
// ============================================

/**
 * Extract product data from embedded JSON in page scripts
 * 85-95% more stable than CSS selectors since JSON structures rarely change
 */
export function extractEmbeddedJSON(config) {
  const result = {};

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
 * Handles common e-commerce JSON structures
 */
export function mergeJSONProductData(result, data, config) {
  if (!data || typeof data !== 'object') return;

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

    // Order count
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
    if (!result.specifications && obj.attrList) {
      result.specifications = obj.attrList.map(a => ({
        name: a.attrName || a.name || '',
        value: a.attrValue || a.value || ''
      })).filter(s => s.name && s.value);
    }
  }
}

// ============================================
// VIDEO & SPECS EXTRACTION
// ============================================

/**
 * Extract video URLs from the page
 */
export function extractVideoUrls(config) {
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
export function extractSpecifications(config) {
  const specs = [];
  const seen = new Set();

  const selectors = config?.specSelectors || [
    '.product-specs',
    '[class*="specification"]',
    '[class*="Specification"]',
    '.product-property-list'
  ];

  for (const sel of selectors) {
    try {
      const container = document.querySelector(sel);
      if (!container) continue;

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
 * Extract variant groups (Color, Size, etc.) with details
 */
export function extractVariantGroups(config) {
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
export function extractReviewsData(config) {
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
export function extractRating(element) {
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

// ============================================
// MAIN PRODUCT EXTRACTION
// ============================================

/**
 * Site-specific product extraction (for single product pages)
 * JSON-first extraction strategy + CSS selectors + fallbacks
 */
export function extractProductDetails(callback) {
  const config = getSiteConfig();
  const { customSelectors } = contentState;
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

  // === EMBEDDED JSON DATA (highest reliability) ===
  const jsonData = extractEmbeddedJSON(config);
  if (jsonData) {
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
        if (!product.title && prod.name) product.title = prod.name;
        if (!product.description && prod.description) product.description = prod.description;
        if (!product.price) product.price = prod.offers?.price || prod.offers?.lowPrice;
        if (!product.originalPrice) product.originalPrice = prod.offers?.highPrice || null;
        if (!product.currency && prod.offers?.priceCurrency) product.currency = prod.offers?.priceCurrency;
        if (!product.sku && prod.sku) product.sku = prod.sku;
        if (!product.brand) product.brand = prod.brand?.name || prod.brand;
        if (!product.availability) product.availability = prod.offers?.availability;
        if (prod.image && (!product.images || product.images.length === 0)) {
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

  // === OPEN GRAPH & META TAGS ===
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

    if (!product.originalPrice && config.originalPriceSelectors) {
      product.originalPrice = tryPriceSelectors(config.originalPriceSelectors);
    }

    if (!product.category && config.breadcrumbSelectors) {
      const crumbs = trySelectorsAll(config.breadcrumbSelectors);
      if (crumbs.length > 0) {
        product.category = crumbs.join(' > ');
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

  // === CLEAN TITLE: strip SEO spam ===
  if (product.title) {
    product.title = product.title
      .replace(/\s*-\s*Buy\s+.*/i, '')
      .replace(/\s*\|\s*[A-Za-z]+\.com.*$/i, '')
      .trim();
  }

  // === BETTER PRICE EXTRACTION ===
  if (!product.price) {
    const priceElements = document.querySelectorAll('[class*="price" i]:not([class*="compare"]):not([class*="original"]):not([class*="old"])');

    for (const el of priceElements) {
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
    const availMeta = document.querySelector('[itemprop="availability"]');
    if (availMeta) {
      const val = availMeta.content || availMeta.href || availMeta.textContent;
      product.availability = val;
      if (/InStock/i.test(val)) product.stock = 999;
      else if (/OutOfStock/i.test(val)) product.stock = 0;
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
    const allText = document.body.innerText;
    const weightMatch = allText.match(/(?:weight|net\s*weight|package\s*weight)\s*[:=]\s*([\d.]+)\s*(kg|g|lb|oz)/i);
    if (weightMatch) {
      let w = parseFloat(weightMatch[1]);
      const unit = weightMatch[2].toLowerCase();
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

  document.querySelectorAll('[class*="gallery"] img, [class*="Gallery"] img, .images-view-list img, [class*="slider"] img, [class*="carousel"] img, [class*="thumb"] img').forEach(img => {
    let src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
    if (src) {
      src = cleanImageUrl(src);
      if (isValidProductImage(src)) imageUrls.add(src);
    }
  });

  document.querySelectorAll('img').forEach(img => {
    if (img.width > 200 || img.height > 200) {
      let src = img.src || img.getAttribute('data-src');
      if (src) {
        src = cleanImageUrl(src);
        if (isValidProductImage(src)) imageUrls.add(src);
      }
    }
  });

  // Merge DOM-discovered images with any already found from JSON/JSON-LD
  const domImages = Array.from(imageUrls).slice(0, 15);
  if (!product.images || product.images.length === 0) {
    product.images = domImages;
  } else {
    const existing = new Set(product.images.map(u => u.replace(/^https?:/, '')));
    for (const img of domImages) {
      if (!existing.has(img.replace(/^https?:/, ''))) {
        product.images.push(img);
      }
    }
    product.images = product.images.slice(0, 20);
  }

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
          const text = el.textContent || el.getAttribute('aria-label') || '';
          const match = text.match(/(\d+(?:\.\d+)?)/);
          if (match) {
            const val = parseFloat(match[1]);
            if (val <= 10) {
              product.rating = val;
              break;
            }
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
  if (!product.title && !product.price && !product._retried) {
    product._retried = true;
    console.log('[DropshipTracker] Missing title+price — retrying in 2s (SPA hydration)');
    setTimeout(() => {
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
      if (!product.title) {
        const h1 = document.querySelector('h1');
        if (h1) product.title = h1.textContent?.trim();
      }
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
