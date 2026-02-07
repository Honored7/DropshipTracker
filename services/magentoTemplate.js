/**
 * Magento CSV Export Template
 * Generates CSV files compatible with Magento 2 product import
 * Reference: https://docs.magento.com/user-guide/system/data-import-product.html
 *
 * Magento 2 uses comma-delimited CSV.
 * Multiple values use pipe (|) separator within fields.
 * Categories use forward slash (/) hierarchy.
 */

(function() {
  "use strict";

  const MAGENTO_COLUMNS = [
    { key: 'sku', header: 'sku' },
    { key: 'store_view_code', header: 'store_view_code' },
    { key: 'attribute_set_code', header: 'attribute_set_code' },
    { key: 'product_type', header: 'product_type' },
    { key: 'categories', header: 'categories' },
    { key: 'product_websites', header: 'product_websites' },
    { key: 'name', header: 'name' },
    { key: 'description', header: 'description' },
    { key: 'short_description', header: 'short_description' },
    { key: 'weight', header: 'weight' },
    { key: 'product_online', header: 'product_online' },
    { key: 'tax_class_name', header: 'tax_class_name' },
    { key: 'visibility', header: 'visibility' },
    { key: 'price', header: 'price' },
    { key: 'special_price', header: 'special_price' },
    { key: 'url_key', header: 'url_key' },
    { key: 'meta_title', header: 'meta_title' },
    { key: 'meta_keywords', header: 'meta_keywords' },
    { key: 'meta_description', header: 'meta_description' },
    { key: 'base_image', header: 'base_image' },
    { key: 'small_image', header: 'small_image' },
    { key: 'thumbnail_image', header: 'thumbnail_image' },
    { key: 'additional_images', header: 'additional_images' },
    { key: 'qty', header: 'qty' },
    { key: 'out_of_stock_qty', header: 'out_of_stock_qty' },
    { key: 'is_in_stock', header: 'is_in_stock' },
    { key: 'manage_stock', header: 'manage_stock' },
    { key: 'manufacturer', header: 'manufacturer' },
    { key: 'country_of_manufacture', header: 'country_of_manufacture' },
    { key: 'additional_attributes', header: 'additional_attributes' }
  ];

  function generateUrlKey(name) {
    return (name || 'product')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 255);
  }

  function mapProduct(product, settings) {
    const images = (product.images || '').split(/[,;|]+/).map(s => s.trim()).filter(s => s.startsWith('http'));
    const primaryImage = images[0] || '';
    const additionalImages = images.slice(1).join(',');

    // Magento categories use Default Category/SubCat/SubSubCat format
    const category = 'Default Category/' + (product.category || '')
      .replace(/\/\/\//g, '/')
      .replace(/\s*>\s*/g, '/')
      .replace(/^\/+|\/+$/g, '');

    // Determine product type
    let variants = [];
    try {
      if (product.variants) {
        variants = typeof product.variants === 'string' ? JSON.parse(product.variants) : product.variants;
      }
    } catch (e) {}
    const productType = Array.isArray(variants) && variants.length > 0 ? 'configurable' : 'simple';

    const price = product.price || product.supplierPrice || '0.00';
    const listPrice = product.list_price || '';
    const hasSpecial = listPrice && parseFloat(listPrice) > parseFloat(price);

    // Build additional_attributes from specifications
    let additionalAttrs = '';
    try {
      const specs = product.specifications ?
        (typeof product.specifications === 'string' ? JSON.parse(product.specifications) : product.specifications) : [];
      if (Array.isArray(specs) && specs.length > 0) {
        additionalAttrs = specs
          .map(s => `${(s.key || s.name || '').replace(/[=,|]/g, ' ')}=${(s.value || '').replace(/[=,|]/g, ' ')}`)
          .join(',');
      }
    } catch(e) {}

    return {
      sku: product.product_code || product.sku || '',
      store_view_code: '',
      attribute_set_code: 'Default',
      product_type: productType,
      categories: category,
      product_websites: 'base',
      name: product.product_name || product.title || '',
      description: product.description || product.fullDescription || '',
      short_description: product.short_description || '',
      weight: product.weight || '',
      product_online: product.status === 'D' || product.status === 'draft' ? '2' : '1',
      tax_class_name: 'Taxable Goods',
      visibility: 'Catalog, Search',
      price: hasSpecial ? listPrice : price,
      special_price: hasSpecial ? price : '',
      url_key: generateUrlKey(product.product_name || product.title),
      meta_title: (product.product_name || product.title || '').substring(0, 255),
      meta_keywords: product.meta_keywords || '',
      meta_description: product.meta_description || (product.short_description || '').substring(0, 255),
      base_image: primaryImage,
      small_image: primaryImage,
      thumbnail_image: primaryImage,
      additional_images: additionalImages,
      qty: product.quantity || '999',
      out_of_stock_qty: '0',
      is_in_stock: '1',
      manage_stock: '1',
      manufacturer: product.brand || '',
      country_of_manufacture: '',
      additional_attributes: additionalAttrs
    };
  }

  function toCSV(products, settings) {
    return CartTemplateRegistry.buildCSV(MAGENTO_COLUMNS, products);
  }

  if (typeof CartTemplateRegistry !== 'undefined') {
    CartTemplateRegistry.register({
      id: 'magento',
      name: 'Magento 2',
      version: 'CSV',
      supportsXML: false,
      fields: MAGENTO_COLUMNS.map(c => ({ key: c.key, label: c.header })),
      mapProduct: mapProduct,
      toCSV: toCSV
    });
  }
})();
