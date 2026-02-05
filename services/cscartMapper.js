/**
 * CS-Cart Data Mapper
 * Maps scraped data to CS-Cart import format
 * Handles conversions, validations, and formatting
 */

const CSCartMapper = (function() {
  "use strict";

  /**
   * Map scraped product to CS-Cart format
   * @param {Object} product - Raw scraped product data
   * @param {Object} settings - Export settings
   * @returns {Object} CS-Cart formatted product
   */
  function fromScraped(product, settings = {}) {
    const delimiter = settings.cscartDelimiter || '///';
    
    return {
      product_code: sanitizeProductCode(product.product_code || product.productCode || product.sku || product.id),
      product_name: truncate(product.product_name || product.title || product.name, 255),
      price: parsePrice(product.price),
      list_price: parsePrice(product.list_price || product.msrp || product.original_price),
      quantity: parseInt(product.quantity || product.stock) || 999,
      category: formatCategory(product.category, delimiter),
      description: product.description || '',
      short_description: truncate(product.short_description || extractShortDescription(product.description), 500),
      images: formatImages(product.images, delimiter),
      weight: parseFloat(product.weight) || 0,
      status: product.status || settings.defaultStatus || 'A',
      language: settings.language || 'en',
      brand: product.brand || product.manufacturer || '',
      meta_keywords: extractKeywords(product.product_name || product.title),
      meta_description: truncate(product.short_description || product.product_name, 160),
      // Supplier tracking
      supplier_url: product.supplier_url || product.url || '',
      supplier_price: parsePrice(product.supplier_price || product.original_price || product.price)
    };
  }

  /**
   * Map catalog product to CS-Cart format
   * @param {Object} catalogProduct - Product from catalog storage
   * @param {Object} settings - Export settings
   * @returns {Object} CS-Cart formatted product
   */
  function fromCatalog(catalogProduct, settings = {}) {
    const delimiter = settings.cscartDelimiter || '///';
    
    return {
      product_code: catalogProduct.productCode,
      product_name: truncate(catalogProduct.title, 255),
      price: catalogProduct.yourPrice || calculatePrice(catalogProduct.supplierPrice, settings),
      list_price: catalogProduct.listPrice || '',
      quantity: catalogProduct.stock || 999,
      category: formatCategory(catalogProduct.category, delimiter),
      description: catalogProduct.description || '',
      short_description: truncate(catalogProduct.shortDescription || extractShortDescription(catalogProduct.description), 500),
      images: formatImages(catalogProduct.images, delimiter),
      weight: catalogProduct.weight || 0,
      status: catalogProduct.status || settings.defaultStatus || 'A',
      language: settings.language || 'en',
      brand: catalogProduct.brand || '',
      meta_keywords: extractKeywords(catalogProduct.title),
      meta_description: truncate(catalogProduct.title, 160),
      // Supplier tracking
      supplier_url: catalogProduct.supplierUrl,
      supplier_price: catalogProduct.supplierPrice
    };
  }

  /**
   * Convert products array to CSV format
   * @param {Array} products - Array of CS-Cart formatted products
   * @returns {string} CSV string
   */
  function toCSV(products) {
    if (!products || products.length === 0) return '';
    
    // CS-Cart standard column order
    const columns = [
      'Product code',
      'Language',
      'Product name',
      'Price',
      'List price',
      'Status',
      'Quantity',
      'Category',
      'Weight',
      'Short description',
      'Full description',
      'Images',
      'Features'
    ];
    
    const rows = [columns];
    
    products.forEach(p => {
      rows.push([
        p.product_code,
        p.language || 'en',
        csvEscape(p.product_name),
        p.price,
        p.list_price || '',
        p.status || 'A',
        p.quantity,
        csvEscape(p.category),
        p.weight || '',
        csvEscape(p.short_description || ''),
        csvEscape(p.description || ''),
        csvEscape(p.images || ''),
        p.brand ? `Brand: E[${p.brand}]` : ''
      ]);
    });
    
    return rows.map(row => row.join(',')).join('\n');
  }

  /**
   * Sanitize product code to meet CS-Cart requirements
   * Max 32 chars, alphanumeric with some special chars
   */
  function sanitizeProductCode(code) {
    if (!code) return `SKU-${Date.now()}`;
    
    return String(code)
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .substring(0, 32);
  }

  /**
   * Parse price string to number
   */
  function parsePrice(priceStr) {
    if (typeof priceStr === 'number') return priceStr.toFixed(2);
    if (!priceStr) return '0.00';
    
    // Remove currency symbols and whitespace
    const cleaned = String(priceStr).replace(/[^0-9.,]/g, '');
    
    // Handle European format (1.234,56) vs US format (1,234.56)
    let normalized;
    if (cleaned.includes(',') && cleaned.includes('.')) {
      // Determine format by position
      if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
        // European: 1.234,56
        normalized = cleaned.replace(/\./g, '').replace(',', '.');
      } else {
        // US: 1,234.56
        normalized = cleaned.replace(/,/g, '');
      }
    } else if (cleaned.includes(',')) {
      // Could be European decimal or US thousands
      const parts = cleaned.split(',');
      if (parts[parts.length - 1].length === 2) {
        // Likely European decimal
        normalized = cleaned.replace(',', '.');
      } else {
        // US thousands separator
        normalized = cleaned.replace(/,/g, '');
      }
    } else {
      normalized = cleaned;
    }
    
    const num = parseFloat(normalized);
    return isNaN(num) ? '0.00' : num.toFixed(2);
  }

  /**
   * Calculate selling price from supplier price with margin
   */
  function calculatePrice(supplierPrice, settings) {
    const price = parseFloat(supplierPrice) || 0;
    const margin = settings?.defaultMargin || 30;
    const marginType = settings?.marginType || 'percent';
    
    let sellingPrice;
    if (marginType === 'percent') {
      sellingPrice = price * (1 + margin / 100);
    } else {
      sellingPrice = price + margin;
    }
    
    // Round if enabled
    if (settings?.roundPrices) {
      const roundTo = parseFloat(settings.roundTo) || 0.99;
      sellingPrice = Math.floor(sellingPrice) + roundTo;
    }
    
    return sellingPrice.toFixed(2);
  }

  /**
   * Format category hierarchy with delimiter
   */
  function formatCategory(category, delimiter = '///') {
    if (!category) return '';
    
    // Already correct format
    if (category.includes(delimiter)) return category;
    
    // Convert common separators
    return String(category)
      .replace(/\s*>\s*/g, delimiter)
      .replace(/\s*\/\s*/g, delimiter)
      .replace(/\s*\|\s*/g, delimiter)
      .replace(/\s*->\s*/g, delimiter);
  }

  /**
   * Format images array to delimited string
   */
  function formatImages(images, delimiter = '///') {
    if (!images) return '';
    
    if (typeof images === 'string') {
      // Convert common separators
      return images
        .replace(/\|\|\|/g, delimiter)
        .replace(/\s*,\s*/g, delimiter)
        .replace(/\s*;\s*/g, delimiter)
        .replace(/\n/g, delimiter);
    }
    
    if (Array.isArray(images)) {
      return images.filter(Boolean).join(delimiter);
    }
    
    return '';
  }

  /**
   * Extract short description from full description
   */
  function extractShortDescription(fullDescription) {
    if (!fullDescription) return '';
    
    // Strip HTML
    const text = fullDescription.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Take first 200 chars at sentence boundary
    if (text.length <= 200) return text;
    
    const truncated = text.substring(0, 200);
    const lastPeriod = truncated.lastIndexOf('.');
    const lastSpace = truncated.lastIndexOf(' ');
    
    const cutoff = lastPeriod > 150 ? lastPeriod + 1 : lastSpace;
    return text.substring(0, cutoff) + '...';
  }

  /**
   * Extract keywords from product name
   */
  function extractKeywords(name) {
    if (!name) return '';
    
    // Remove common words
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
    
    const words = name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.includes(w))
      .slice(0, 10);
    
    return words.join(', ');
  }

  /**
   * Truncate string to max length
   */
  function truncate(str, maxLength) {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  /**
   * Escape value for CSV
   */
  function csvEscape(value) {
    if (!value) return '';
    const str = String(value);
    
    // If contains comma, quote, or newline, wrap in quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  /**
   * Validate product has required fields
   */
  function validate(product) {
    const errors = [];
    
    if (!product.product_code) {
      errors.push('Product code is required');
    }
    if (!product.product_name) {
      errors.push('Product name is required');
    }
    if (!product.price || parseFloat(product.price) <= 0) {
      errors.push('Valid price is required');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Public API
  return {
    fromScraped,
    fromCatalog,
    toCSV,
    sanitizeProductCode,
    parsePrice,
    calculatePrice,
    formatCategory,
    formatImages,
    extractShortDescription,
    extractKeywords,
    truncate,
    validate
  };
})();

// Export for Node.js if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CSCartMapper;
}
