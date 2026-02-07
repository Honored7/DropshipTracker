/**
 * Shopify CSV Export Template
 * Generates CSV files compatible with Shopify product import
 * Reference: https://help.shopify.com/en/manual/products/import-export/using-csv
 *
 * Note: Shopify uses multi-row format - first row is the product,
 * subsequent rows with same Handle add additional images.
 */

(function() {
  "use strict";

  const SHOPIFY_COLUMNS = [
    { key: 'Handle', header: 'Handle' },
    { key: 'Title', header: 'Title' },
    { key: 'BodyHTML', header: 'Body (HTML)' },
    { key: 'Vendor', header: 'Vendor' },
    { key: 'ProductCategory', header: 'Product Category' },
    { key: 'Type', header: 'Type' },
    { key: 'Tags', header: 'Tags' },
    { key: 'Published', header: 'Published' },
    { key: 'Option1Name', header: 'Option1 Name' },
    { key: 'Option1Value', header: 'Option1 Value' },
    { key: 'Option2Name', header: 'Option2 Name' },
    { key: 'Option2Value', header: 'Option2 Value' },
    { key: 'Option3Name', header: 'Option3 Name' },
    { key: 'Option3Value', header: 'Option3 Value' },
    { key: 'VariantSKU', header: 'Variant SKU' },
    { key: 'VariantGrams', header: 'Variant Grams' },
    { key: 'VariantInventoryTracker', header: 'Variant Inventory Tracker' },
    { key: 'VariantInventoryQty', header: 'Variant Inventory Qty' },
    { key: 'VariantInventoryPolicy', header: 'Variant Inventory Policy' },
    { key: 'VariantFulfillmentService', header: 'Variant Fulfillment Service' },
    { key: 'VariantPrice', header: 'Variant Price' },
    { key: 'VariantCompareAtPrice', header: 'Variant Compare At Price' },
    { key: 'VariantRequiresShipping', header: 'Variant Requires Shipping' },
    { key: 'VariantTaxable', header: 'Variant Taxable' },
    { key: 'ImageSrc', header: 'Image Src' },
    { key: 'ImagePosition', header: 'Image Position' },
    { key: 'ImageAltText', header: 'Image Alt Text' },
    { key: 'SEOTitle', header: 'SEO Title' },
    { key: 'SEODescription', header: 'SEO Description' },
    { key: 'Status', header: 'Status' }
  ];

  /**
   * Generate URL-safe handle from product name
   */
  function generateHandle(name) {
    return (name || 'product')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 100);
  }

  function mapProduct(product, settings) {
    const images = (product.images || '').split(/[,;|]+/).map(s => s.trim()).filter(s => s.startsWith('http'));

    // Parse variants for options
    let variants = [];
    try {
      if (product.variants) {
        variants = typeof product.variants === 'string' ? JSON.parse(product.variants) : product.variants;
      }
    } catch (e) {}

    // Group variants by type (max 3 options for Shopify)
    const variantGroups = {};
    if (Array.isArray(variants)) {
      variants.forEach(v => {
        const type = v.type || 'Option';
        if (!variantGroups[type]) variantGroups[type] = [];
        variantGroups[type].push(v.name || v.value || '');
      });
    }

    const groupEntries = Object.entries(variantGroups).slice(0, 3);

    // Convert category separators to Shopify format
    const category = (product.category || '')
      .replace(/\/\/\//g, ' > ')
      .replace(/\s*>\s*/g, ' > ');

    // Weight in grams (Shopify default)
    const weightGrams = product.weight ? Math.round(parseFloat(product.weight) * 1000) : '';

    const handle = generateHandle(product.product_name || product.title);

    return {
      Handle: handle,
      Title: product.product_name || product.title || '',
      BodyHTML: product.description || '',
      Vendor: product.brand || settings?.defaultVendor || '',
      ProductCategory: category,
      Type: category ? category.split(' > ').pop() : '',
      Tags: product.meta_keywords || '',
      Published: product.status === 'A' || product.status === 'active' ? 'true' : 'false',
      Option1Name: groupEntries[0] ? groupEntries[0][0] : 'Title',
      Option1Value: groupEntries[0] ? groupEntries[0][1].join(', ') : 'Default Title',
      Option2Name: groupEntries[1] ? groupEntries[1][0] : '',
      Option2Value: groupEntries[1] ? groupEntries[1][1].join(', ') : '',
      Option3Name: groupEntries[2] ? groupEntries[2][0] : '',
      Option3Value: groupEntries[2] ? groupEntries[2][1].join(', ') : '',
      VariantSKU: product.product_code || product.sku || '',
      VariantGrams: weightGrams,
      VariantInventoryTracker: 'shopify',
      VariantInventoryQty: product.quantity || '0',
      VariantInventoryPolicy: 'deny',
      VariantFulfillmentService: 'manual',
      VariantPrice: product.price || '0.00',
      VariantCompareAtPrice: product.list_price || '',
      VariantRequiresShipping: 'true',
      VariantTaxable: 'true',
      ImageSrc: images[0] || '',
      ImagePosition: images[0] ? '1' : '',
      ImageAltText: product.product_name || product.title || '',
      SEOTitle: (product.product_name || product.title || '').substring(0, 70),
      SEODescription: product.meta_description || (product.short_description || '').substring(0, 320),
      Status: product.status === 'A' || product.status === 'active' ? 'active' : 'draft',
      _extraImages: images.slice(1), // Used by toCSV for multi-row output
      _handle: handle
    };
  }

  /**
   * Shopify CSV uses multi-row format: additional images get their own rows
   * with only Handle, Image Src, and Image Position filled in.
   */
  function toCSV(products, settings) {
    const escape = (val) => {
      if (val == null) return '';
      const str = String(val);
      if (str.includes('"') || str.includes(',') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const header = SHOPIFY_COLUMNS.map(c => escape(c.header)).join(',');
    const rows = [];

    products.forEach(p => {
      // Main product row
      const mainRow = SHOPIFY_COLUMNS.map(c => escape(p[c.key] != null ? p[c.key] : '')).join(',');
      rows.push(mainRow);

      // Additional image rows (Shopify multi-row format)
      const extraImages = p._extraImages || [];
      extraImages.forEach((imgUrl, i) => {
        const imageRow = SHOPIFY_COLUMNS.map(c => {
          if (c.key === 'Handle') return escape(p.Handle);
          if (c.key === 'ImageSrc') return escape(imgUrl);
          if (c.key === 'ImagePosition') return escape(String(i + 2));
          if (c.key === 'ImageAltText') return escape(p.Title || '');
          return '';
        }).join(',');
        rows.push(imageRow);
      });
    });

    return header + '\n' + rows.join('\n');
  }

  // Register with the template registry
  if (typeof CartTemplateRegistry !== 'undefined') {
    CartTemplateRegistry.register({
      id: 'shopify',
      name: 'Shopify',
      version: 'CSV',
      supportsXML: false,
      fields: SHOPIFY_COLUMNS.map(c => ({ key: c.key, label: c.header })),
      mapProduct: mapProduct,
      toCSV: toCSV
    });
  }
})();