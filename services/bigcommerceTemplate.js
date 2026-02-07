/**
 * BigCommerce CSV Export Template
 * Generates CSV files compatible with BigCommerce product import
 * Reference: https://support.bigcommerce.com/s/article/Importing-Exporting-Products
 *
 * BigCommerce uses comma-delimited CSV.
 * Multiple images separated by pipe (|) in some fields, comma in others.
 */

(function() {
  "use strict";

  const BC_COLUMNS = [
    { key: 'ItemType', header: 'Item Type' },
    { key: 'ProductID', header: 'Product ID' },
    { key: 'ProductName', header: 'Product Name' },
    { key: 'ProductType', header: 'Product Type' },
    { key: 'ProductCode', header: 'Product Code/SKU' },
    { key: 'BinPickingNumber', header: 'Bin Picking Number' },
    { key: 'BrandName', header: 'Brand Name' },
    { key: 'OptionSet', header: 'Option Set' },
    { key: 'OptionSetAlign', header: 'Option Set Align' },
    { key: 'ProductDescription', header: 'Product Description' },
    { key: 'Price', header: 'Price' },
    { key: 'CostPrice', header: 'Cost Price' },
    { key: 'RetailPrice', header: 'Retail Price' },
    { key: 'SalePrice', header: 'Sale Price' },
    { key: 'FixedShippingCost', header: 'Fixed Shipping Cost' },
    { key: 'FreeShipping', header: 'Free Shipping' },
    { key: 'ProductWeight', header: 'Product Weight' },
    { key: 'ProductWidth', header: 'Product Width' },
    { key: 'ProductHeight', header: 'Product Height' },
    { key: 'ProductDepth', header: 'Product Depth' },
    { key: 'AllowPurchases', header: 'Allow Purchases?' },
    { key: 'ProductVisible', header: 'Product Visible?' },
    { key: 'ProductAvailability', header: 'Product Availability' },
    { key: 'TrackInventory', header: 'Track Inventory' },
    { key: 'CurrentStockLevel', header: 'Current Stock Level' },
    { key: 'LowStockLevel', header: 'Low Stock Level' },
    { key: 'CategoryPath', header: 'Category' },
    { key: 'ProductImage1', header: 'Product Image File - 1' },
    { key: 'ProductImage2', header: 'Product Image File - 2' },
    { key: 'ProductImage3', header: 'Product Image File - 3' },
    { key: 'ProductImage4', header: 'Product Image File - 4' },
    { key: 'ProductImage5', header: 'Product Image File - 5' },
    { key: 'SearchKeywords', header: 'Search Keywords' },
    { key: 'PageTitle', header: 'Page Title' },
    { key: 'MetaKeywords', header: 'Meta Keywords' },
    { key: 'MetaDescription', header: 'Meta Description' },
    { key: 'ProductCondition', header: 'Product Condition' },
    { key: 'ProductURL', header: 'Product URL' },
    { key: 'ProductCustomFields', header: 'Product Custom Fields' }
  ];

  function generateProductUrl(name) {
    return '/' + (name || 'product')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 200) + '/';
  }

  function mapProduct(product, settings) {
    const images = (product.images || '').split(/[,;|]+/).map(s => s.trim()).filter(s => s.startsWith('http'));

    // BigCommerce categories: separated by /
    const category = (product.category || '')
      .replace(/\/\/\//g, '/')
      .replace(/\s*>\s*/g, '/')
      .trim();

    const price = product.price || product.supplierPrice || '0.00';
    const listPrice = product.list_price || '';
    const hasDiscount = listPrice && parseFloat(listPrice) > parseFloat(price);

    // Determine product type
    let variants = [];
    try {
      if (product.variants) {
        variants = typeof product.variants === 'string' ? JSON.parse(product.variants) : product.variants;
      }
    } catch (e) {}

    // Build custom fields from specifications
    let customFields = '';
    try {
      const specs = product.specifications ?
        (typeof product.specifications === 'string' ? JSON.parse(product.specifications) : product.specifications) : [];
      if (Array.isArray(specs) && specs.length > 0) {
        // BigCommerce format: "Name=Value;Name2=Value2"
        customFields = specs.map(s => `${s.key || s.name}=${s.value}`).join(';');
      }
    } catch(e) {}

    const shippingCost = product.shipping_freight || product.shippingCost || '';
    const freeShipping = !shippingCost || parseFloat(shippingCost) === 0;

    return {
      ItemType: 'Product',
      ProductID: '',
      ProductName: product.product_name || product.title || '',
      ProductType: Array.isArray(variants) && variants.length > 0 ? 'P' : 'P',
      ProductCode: product.product_code || product.sku || '',
      BinPickingNumber: '',
      BrandName: product.brand || '',
      OptionSet: '',
      OptionSetAlign: 'right',
      ProductDescription: product.description || product.fullDescription || '',
      Price: hasDiscount ? listPrice : price,
      CostPrice: product.supplierPrice || price,
      RetailPrice: listPrice || '',
      SalePrice: hasDiscount ? price : '',
      FixedShippingCost: shippingCost,
      FreeShipping: freeShipping ? 'Y' : 'N',
      ProductWeight: product.weight || '0',
      ProductWidth: '',
      ProductHeight: '',
      ProductDepth: '',
      AllowPurchases: 'Y',
      ProductVisible: product.status === 'D' || product.status === 'draft' ? 'N' : 'Y',
      ProductAvailability: 'available',
      TrackInventory: 'by_product',
      CurrentStockLevel: product.quantity || '999',
      LowStockLevel: '5',
      CategoryPath: category || 'Shop',
      ProductImage1: images[0] || '',
      ProductImage2: images[1] || '',
      ProductImage3: images[2] || '',
      ProductImage4: images[3] || '',
      ProductImage5: images[4] || '',
      SearchKeywords: product.meta_keywords || '',
      PageTitle: (product.product_name || product.title || '').substring(0, 255),
      MetaKeywords: product.meta_keywords || '',
      MetaDescription: product.meta_description || (product.short_description || '').substring(0, 255),
      ProductCondition: 'New',
      ProductURL: generateProductUrl(product.product_name || product.title),
      ProductCustomFields: customFields
    };
  }

  function toCSV(products, settings) {
    return CartTemplateRegistry.buildCSV(BC_COLUMNS, products);
  }

  if (typeof CartTemplateRegistry !== 'undefined') {
    CartTemplateRegistry.register({
      id: 'bigcommerce',
      name: 'BigCommerce',
      version: 'CSV',
      supportsXML: false,
      fields: BC_COLUMNS.map(c => ({ key: c.key, label: c.header })),
      mapProduct: mapProduct,
      toCSV: toCSV
    });
  }
})();
