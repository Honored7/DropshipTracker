/**
 * CS-Cart XML Builder
 * Generates XML files compatible with CS-Cart import format
 * Supports products, variants, and standard CS-Cart field structure
 */

const CSCartXMLBuilder = (function() {
  "use strict";

  /**
   * Build complete CS-Cart XML from products array
   * @param {Array} products - Array of product objects
   * @param {Object} settings - Export settings (delimiter, language, etc.)
   * @returns {string} XML string
   */
  function build(products, settings = {}) {
    const delimiter = settings.cscartDelimiter || '///';
    const language = settings.language || 'en';
    
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<data>\n';
    xml += '  <products>\n';
    
    products.forEach(product => {
      xml += buildProductNode(product, delimiter, language);
    });
    
    xml += '  </products>\n';
    xml += '</data>';
    
    return xml;
  }

  /**
   * Build single product XML node
   */
  function buildProductNode(product, delimiter, language) {
    let xml = '    <product>\n';
    
    // Required fields
    xml += `      <product_code>${escapeXml(product.product_code || '')}</product_code>\n`;
    xml += `      <language>${escapeXml(language)}</language>\n`;
    xml += `      <product>${escapeXml(product.product_name || product.title || '')}</product>\n`;
    
    // Price fields
    xml += `      <price>${formatPrice(product.price)}</price>\n`;
    if (product.list_price) {
      xml += `      <list_price>${formatPrice(product.list_price)}</list_price>\n`;
    }
    
    // Status
    xml += `      <status>${product.status || 'A'}</status>\n`;
    
    // Quantity/Stock
    xml += `      <quantity>${parseInt(product.quantity) || 0}</quantity>\n`;
    
    // Category - uses delimiter for hierarchy
    if (product.category) {
      xml += `      <category>${escapeXml(formatCategory(product.category, delimiter))}</category>\n`;
    }
    
    // Weight
    if (product.weight) {
      xml += `      <weight>${parseFloat(product.weight).toFixed(2)}</weight>\n`;
    }
    
    // Description - wrap in CDATA for HTML content
    if (product.description) {
      xml += `      <description><![CDATA[${escapeCDATA(product.description)}]]></description>\n`;
    }
    
    if (product.short_description) {
      xml += `      <short_description><![CDATA[${escapeCDATA(product.short_description)}]]></short_description>\n`;
    }
    
    // Images - multiple images separated by delimiter
    if (product.images) {
      const images = formatImages(product.images, delimiter);
      xml += `      <images>${escapeXml(images)}</images>\n`;
    }
    
    // Features/Attributes
    if (product.brand) {
      xml += `      <features>Brand: E[${escapeXml(product.brand)}]</features>\n`;
    }
    
    // Options/Variants
    if (product.options) {
      xml += `      <options>${escapeXml(product.options)}</options>\n`;
    }
    
    // Meta data
    if (product.meta_keywords) {
      xml += `      <meta_keywords>${escapeXml(product.meta_keywords)}</meta_keywords>\n`;
    }
    
    if (product.meta_description) {
      xml += `      <meta_description>${escapeXml(product.meta_description)}</meta_description>\n`;
    }
    
    // Page title (SEO)
    if (product.page_title) {
      xml += `      <page_title>${escapeXml(product.page_title)}</page_title>\n`;
    }
    
    // Custom: Supplier tracking (stored in feature or custom field)
    if (product.supplier_url) {
      xml += `      <!-- Supplier: ${escapeXml(product.supplier_url)} -->\n`;
      xml += `      <!-- Supplier Price: ${formatPrice(product.supplier_price)} -->\n`;
    }
    
    // Reviews export (stored in custom field or as separate data)
    if (product.reviews && product.reviews.length > 0) {
      xml += '      <reviews>\n';
      product.reviews.forEach(review => {
        xml += buildReviewNode(review);
      });
      xml += '      </reviews>\n';
    }
    
    xml += '    </product>\n';
    
    return xml;
  }
  
  /**
   * Build single review XML node
   */
  function buildReviewNode(review) {
    let xml = '        <review>\n';
    
    if (review.author) {
      xml += `          <author>${escapeXml(review.author)}</author>\n`;
    }
    if (review.rating) {
      xml += `          <rating>${parseInt(review.rating)}</rating>\n`;
    }
    if (review.date) {
      xml += `          <date>${escapeXml(review.date)}</date>\n`;
    }
    if (review.text) {
      xml += `          <text><![CDATA[${escapeCDATA(review.text)}]]></text>\n`;
    }
    if (review.country) {
      xml += `          <country>${escapeXml(review.country)}</country>\n`;
    }
    if (review.images && review.images.length > 0) {
      xml += `          <images>${review.images.map(escapeXml).join('///')}</images>\n`;
    }
    
    xml += '        </review>\n';
    return xml;
  }

  /**
   * Build CS-Cart options string from variants data
   * Format: (Storefront) Option name: Option type[Variant1///modifier=value, Variant2]///settings
   */
  function buildOptions(variants, storefront, delimiter) {
    if (!variants || variants.length === 0) return '';
    
    // Group variants by type (e.g., Color, Size)
    const groups = {};
    
    variants.forEach(v => {
      const type = v.type || v.name || 'Option';
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(v);
    });
    
    const options = [];
    
    Object.entries(groups).forEach(([typeName, values]) => {
      const variants = values.map(v => {
        let variantStr = v.value || v.name;
        if (v.priceModifier) {
          variantStr += `${delimiter}modifier=${v.priceModifier}`;
          variantStr += `${delimiter}modifier_type=${v.priceModifierType || 'A'}`;
        }
        if (v.image) {
          variantStr += `${delimiter}image=${v.image}`;
        }
        return variantStr;
      }).join(', ');
      
      // Default to select box (SG) type
      const prefix = storefront ? `(${storefront}) ` : '';
      options.push(`${prefix}${typeName}: SG[${variants}]${delimiter}required=N`);
    });
    
    return options.join('; ');
  }

  /**
   * Format category with proper delimiter
   * Handles nested categories: "Electronics > Phones > Smartphones"
   */
  function formatCategory(category, delimiter) {
    if (!category) return '';
    
    // Already uses correct delimiter
    if (category.includes(delimiter)) {
      return category;
    }
    
    // Convert common separators
    return category
      .replace(/\s*>\s*/g, delimiter)
      .replace(/\s*\/\s*/g, delimiter)
      .replace(/\s*\|\s*/g, delimiter);
  }

  /**
   * Format images with delimiter
   */
  function formatImages(images, delimiter) {
    if (!images) return '';
    
    // Already string with delimiter
    if (typeof images === 'string') {
      // Convert common separators to standard delimiter
      return images
        .replace(/\|\|\|/g, delimiter)
        .replace(/\s*,\s*/g, delimiter)
        .replace(/\s*;\s*/g, delimiter);
    }
    
    // Array of URLs
    if (Array.isArray(images)) {
      return images.filter(Boolean).join(delimiter);
    }
    
    return '';
  }

  /**
   * Format price to 2 decimal places
   */
  function formatPrice(price) {
    const num = parseFloat(price);
    return isNaN(num) ? '0.00' : num.toFixed(2);
  }

  /**
   * Escape XML special characters
   */
  function escapeXml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Escape CDATA closing sequence to prevent injection
   * Splits ]]> into ]]]]><![CDATA[>
   */
  function escapeCDATA(str) {
    if (!str) return '';
    return String(str).replace(/\]\]>/g, ']]]]><![CDATA[>');
  }

  // Public API
  return {
    build,
    buildProductNode,
    buildReviewNode,
    buildOptions,
    formatCategory,
    formatImages,
    formatPrice,
    escapeXml,
    escapeCDATA
  };
})();

// Export for Node.js if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CSCartXMLBuilder;
}
