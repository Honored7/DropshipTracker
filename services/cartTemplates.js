/**
 * Cart Template Registry
 * Pluggable system for supporting multiple shopping cart export formats.
 * Templates register themselves; popup.js uses the registry to export.
 *
 * Load order: cartTemplates.js (this) -> shopifyTemplate.js -> woocommerceTemplate.js
 * CS-Cart is auto-registered here using existing CSCartMapper/CSCartXMLBuilder.
 */

const CartTemplateRegistry = (function() {
  "use strict";

  const templates = {};

  function register(template) {
    if (!template.id || !template.name) {
      console.error('[CartTemplateRegistry] Template must have id and name');
      return;
    }
    if (!template.mapProduct || typeof template.mapProduct !== 'function') {
      console.error('[CartTemplateRegistry] Template must have mapProduct function');
      return;
    }
    if (!template.toCSV || typeof template.toCSV !== 'function') {
      console.error('[CartTemplateRegistry] Template must have toCSV function');
      return;
    }
    templates[template.id] = template;
    console.log('[CartTemplateRegistry] Registered:', template.id, '-', template.name);
  }

  function get(id) {
    return templates[id] || null;
  }

  function getAll() {
    return Object.values(templates);
  }

  function mapProduct(templateId, product, settings) {
    const tpl = templates[templateId];
    if (!tpl || !tpl.mapProduct) return product;
    return tpl.mapProduct(product, settings);
  }

  function toCSV(templateId, products, settings) {
    const tpl = templates[templateId];
    if (!tpl || !tpl.toCSV) return '';
    return tpl.toCSV(products, settings);
  }

  function toXML(templateId, products, settings) {
    const tpl = templates[templateId];
    if (!tpl || !tpl.toXML) return '';
    return tpl.toXML(products, settings);
  }

  function supportsXML(templateId) {
    const tpl = templates[templateId];
    return tpl ? !!tpl.supportsXML : false;
  }

  /**
   * Utility: build CSV string from column definitions and mapped product rows
   */
  function buildCSV(columns, products) {
    const escape = (val) => {
      if (val == null) return '';
      const str = String(val);
      if (str.includes('"') || str.includes(',') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const header = columns.map(c => escape(c.header)).join(',');
    const rows = products.map(p =>
      columns.map(c => escape(p[c.key] != null ? p[c.key] : '')).join(',')
    );
    return header + '\n' + rows.join('\n');
  }

  // Auto-register CS-Cart template using existing mapper/builder
  if (typeof CSCartMapper !== 'undefined') {
    register({
      id: 'cscart',
      name: 'CS-Cart',
      version: 'XML/CSV',
      supportsXML: true,
      fields: [
        { key: 'product_code', label: 'Product Code' },
        { key: 'product_name', label: 'Product Name' },
        { key: 'price', label: 'Price' },
        { key: 'list_price', label: 'List Price' },
        { key: 'quantity', label: 'Quantity' },
        { key: 'category', label: 'Category' },
        { key: 'description', label: 'Description' },
        { key: 'short_description', label: 'Short Description' },
        { key: 'images', label: 'Images' },
        { key: 'weight', label: 'Weight' },
        { key: 'status', label: 'Status' },
        { key: 'language', label: 'Language' },
        { key: 'brand', label: 'Brand' },
        { key: 'meta_keywords', label: 'Meta Keywords' },
        { key: 'meta_description', label: 'Meta Description' },
        { key: 'shipping_freight', label: 'Shipping Freight' }
      ],
      mapProduct: function(product, settings) {
        return product; // Already in CS-Cart format from mapToCSCart()
      },
      toCSV: function(products, settings) {
        return CSCartMapper.toCSV(products);
      },
      toXML: function(products, settings) {
        return CSCartXMLBuilder.build(products, settings);
      }
    });
  }

  return {
    register,
    get,
    getAll,
    mapProduct,
    toCSV,
    toXML,
    supportsXML,
    buildCSV
  };
})();