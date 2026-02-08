/**
 * Site-specific configurations for content extraction
 * Contains selectors, patterns, and JSON extraction rules per domain
 */

export const SITE_CONFIGS = {
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
    jsonPatterns: [
      '_initData\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;',
      '__INITIAL_STATE__\\s*=\\s*(\\{[\\s\\S]*?\\});',
      'window\\.__state__\\s*=\\s*(\\{[\\s\\S]*?\\});',
      'data:\\s*(\\{[\\s\\S]*?"offers"[\\s\\S]*?\\})'
    ]
  },
  'alibaba.com': {
    productIdPattern: /\/product\/(\d+)\.html|product-detail\/[^_]*_(\d{5,})\.html|offer\/(\d+)/,
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
      '.detail-gallery-turn img:not([src$=".svg"])',
      '.main-image img:not([src$=".svg"])',
      '[class*="gallery"] img:not([src$=".svg"])',
      '.thumb-list img:not([src$=".svg"])',
      'img[src*="alicdn.com"][src$=".jpg"]'
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
    jsonPatterns: [
      '__INITIAL_STATE__\\s*=\\s*(\\{[\\s\\S]*?\\});?',
      'window\\.__data__\\s*=\\s*(\\{[\\s\\S]*?\\});?',
      '_init_data_\\s*=\\s*(\\{[\\s\\S]*?\\})'
    ]
  }
};

/**
 * Get site config for current domain
 */
export function getSiteConfig() {
  const hostname = window.location.hostname;
  for (const [domain, config] of Object.entries(SITE_CONFIGS)) {
    if (hostname.includes(domain.replace('.com', ''))) {
      return { domain, ...config };
    }
  }
  return null;
}
