/**
 * PrestaShop CSV Export Template
 * Generates CSV files compatible with PrestaShop product import
 * Reference: https://doc.prestashop.com/display/PS17/Import
 *
 * PrestaShop uses semicolon-delimited CSV by default.
 * Multiple images are separated by commas.
 */

(function() {
  "use strict";

  const PRESTA_COLUMNS = [
    { key: 'ID', header: 'ID' },
    { key: 'Active', header: 'Active (0/1)' },
    { key: 'Name', header: 'Name *' },
    { key: 'Categories', header: 'Categories (x,y,z...)' },
    { key: 'Price', header: 'Price tax excl.' },
    { key: 'TaxRuleGroup', header: 'Tax rules ID' },
    { key: 'WholesalePrice', header: 'Wholesale price' },
    { key: 'OnSale', header: 'On sale (0/1)' },
    { key: 'DiscountAmount', header: 'Discount amount' },
    { key: 'DiscountPercent', header: 'Discount percent' },
    { key: 'Reference', header: 'Reference #' },
    { key: 'SupplierReference', header: 'Supplier reference #' },
    { key: 'Supplier', header: 'Supplier' },
    { key: 'Manufacturer', header: 'Manufacturer' },
    { key: 'EAN13', header: 'EAN13' },
    { key: 'UPC', header: 'UPC' },
    { key: 'Ecotax', header: 'Ecotax' },
    { key: 'Width', header: 'Width' },
    { key: 'Height', header: 'Height' },
    { key: 'Depth', header: 'Depth' },
    { key: 'Weight', header: 'Weight' },
    { key: 'Quantity', header: 'Quantity' },
    { key: 'MinimalQuantity', header: 'Minimal quantity' },
    { key: 'Visibility', header: 'Visibility' },
    { key: 'AdditionalShippingCost', header: 'Additional shipping cost' },
    { key: 'Unity', header: 'Unity' },
    { key: 'UnitPrice', header: 'Unit price' },
    { key: 'ShortDescription', header: 'Summary' },
    { key: 'Description', header: 'Description' },
    { key: 'Tags', header: 'Tags (x,y,z...)' },
    { key: 'MetaTitle', header: 'Meta title' },
    { key: 'MetaKeywords', header: 'Meta keywords' },
    { key: 'MetaDescription', header: 'Meta description' },
    { key: 'URLRewrite', header: 'URL rewritten' },
    { key: 'AvailableForOrder', header: 'Available for order (0 = No, 1 = Yes)' },
    { key: 'ProductAvailableDate', header: 'Product available date' },
    { key: 'ProductCreationDate', header: 'Product creation date' },
    { key: 'ShowPrice', header: 'Show price (0 = No, 1 = Yes)' },
    { key: 'ImageURLs', header: 'Image URLs (x,y,z...)' },
    { key: 'DeleteExistingImages', header: 'Delete existing images (0 = No, 1 = Yes)' },
    { key: 'Feature', header: 'Feature(Name:Value:Position)' },
    { key: 'AvailableOnlineOnly', header: 'Available online only (0 = No, 1 = Yes)' },
    { key: 'Condition', header: 'Condition' }
  ];

  function generateUrlRewrite(name) {
    return (name || 'product')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 128);
  }

  function mapProduct(product, settings) {
    const images = (product.images || '').split(/[,;|]+/).map(s => s.trim()).filter(s => s.startsWith('http'));

    // PrestaShop categories: comma-separated hierarchy
    const category = (product.category || '')
      .replace(/\/\/\//g, ',')
      .replace(/\s*>\s*/g, ',')
      .trim();

    const price = product.price || '0.00';
    const listPrice = product.list_price || '';
    const hasDiscount = listPrice && parseFloat(listPrice) > parseFloat(price);

    // Build feature string from specifications
    let features = '';
    try {
      const specs = product.specifications ? 
        (typeof product.specifications === 'string' ? JSON.parse(product.specifications) : product.specifications) : [];
      if (Array.isArray(specs)) {
        features = specs.map((s, i) => `${s.key || s.name}:${s.value}:${i + 1}`).join(',');
      }
    } catch(e) {}

    return {
      ID: '',
      Active: product.status === 'D' || product.status === 'draft' ? '0' : '1',
      Name: product.product_name || product.title || '',
      Categories: category || 'Home',
      Price: price,
      TaxRuleGroup: '',
      WholesalePrice: product.supplierPrice || price,
      OnSale: hasDiscount ? '1' : '0',
      DiscountAmount: hasDiscount ? (parseFloat(listPrice) - parseFloat(price)).toFixed(2) : '',
      DiscountPercent: '',
      Reference: product.product_code || product.sku || '',
      SupplierReference: product.supplierProductId || product.supplier_product_id || '',
      Supplier: product.storeName || product.store_name || '',
      Manufacturer: product.brand || '',
      EAN13: '',
      UPC: '',
      Ecotax: '0.00',
      Width: '',
      Height: '',
      Depth: '',
      Weight: product.weight || '',
      Quantity: product.quantity || '999',
      MinimalQuantity: product.minOrder || '1',
      Visibility: 'both',
      AdditionalShippingCost: product.shipping_freight || product.shippingCost || '0.00',
      Unity: '',
      UnitPrice: '',
      ShortDescription: product.short_description || '',
      Description: product.description || product.fullDescription || '',
      Tags: product.meta_keywords || '',
      MetaTitle: (product.product_name || product.title || '').substring(0, 70),
      MetaKeywords: product.meta_keywords || '',
      MetaDescription: product.meta_description || (product.short_description || '').substring(0, 512),
      URLRewrite: generateUrlRewrite(product.product_name || product.title),
      AvailableForOrder: '1',
      ProductAvailableDate: '',
      ProductCreationDate: new Date().toISOString().split('T')[0],
      ShowPrice: '1',
      ImageURLs: images.join(','),
      DeleteExistingImages: '0',
      Feature: features,
      AvailableOnlineOnly: '0',
      Condition: 'new'
    };
  }

  /**
   * PrestaShop uses semicolons as CSV delimiter by default
   */
  function toCSV(products, settings) {
    const escape = (val) => {
      if (val == null) return '';
      const str = String(val);
      if (str.includes('"') || str.includes(';') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const header = PRESTA_COLUMNS.map(c => escape(c.header)).join(';');
    const rows = products.map(p =>
      PRESTA_COLUMNS.map(c => escape(p[c.key] != null ? p[c.key] : '')).join(';')
    );
    return header + '\n' + rows.join('\n');
  }

  if (typeof CartTemplateRegistry !== 'undefined') {
    CartTemplateRegistry.register({
      id: 'prestashop',
      name: 'PrestaShop',
      version: 'CSV',
      supportsXML: false,
      fields: PRESTA_COLUMNS.map(c => ({ key: c.key, label: c.header })),
      mapProduct: mapProduct,
      toCSV: toCSV
    });
  }
})();
