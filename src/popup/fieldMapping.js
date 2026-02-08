/**
 * Field mapping – EXPORT_FIELDS constant, auto-detect, and mapping UI
 */
/* global $ */

import { state } from './state.js';
import { getShortFieldName, showToast } from './utils.js';
import { savePersistedFieldMapping } from './persistence.js';

export const EXPORT_FIELDS = [
  { id: '', label: '-- Ignore --' },
  { id: 'product_code', label: 'Product ID * (Supplier Item #)', required: true },
  { id: 'supplier_sku', label: 'SKU (Optional Supplier Code)' },
  { id: 'product_name', label: 'Product Name *', required: true },
  { id: 'price', label: 'Price *', required: true },
  { id: 'list_price', label: 'Original / List Price' },
  { id: 'quantity', label: 'Quantity / Stock' },
  { id: 'category', label: 'Category' },
  { id: 'description', label: 'Full Description' },
  { id: 'short_description', label: 'Short Description' },
  { id: 'images', label: 'Images (Primary)' },
  { id: 'additional_images', label: 'Additional Images' },
  { id: 'weight', label: 'Weight' },
  { id: 'brand', label: 'Brand / Manufacturer' },
  { id: 'url', label: 'Supplier URL' },
  { id: 'shipping', label: 'Shipping Info' },
  { id: 'shipping_cost', label: 'Shipping Cost' },
  { id: 'variants', label: 'Variants / Options' },
  { id: 'color', label: 'Color Option' },
  { id: 'size', label: 'Size Option' },
  { id: 'reviews', label: 'Reviews Text' },
  { id: 'rating', label: 'Rating (Stars)' },
  { id: 'review_count', label: 'Review Count' },
  { id: 'sold_count', label: 'Units Sold / Orders' },
  { id: 'meta_keywords', label: 'Meta Keywords' },
  { id: 'meta_description', label: 'Meta Description' },
  { id: 'attributes', label: 'Product Attributes' },
  { id: 'specifications', label: 'Specifications' },
  { id: 'min_order', label: 'Minimum Order' },
  { id: 'store_name', label: 'Store / Seller Name' },
  { id: 'store_rating', label: 'Store Rating' },
  { id: 'video_urls', label: 'Video URLs' },
  { id: 'full_description', label: 'Full Description (HTML)' },
  { id: 'currency', label: 'Currency' },
  { id: 'availability', label: 'Availability' }
];

// Keep backward compat alias
export const CSCART_FIELDS = EXPORT_FIELDS;

export function showFieldMapping() {
  if (state.fieldNames.length === 0) return;

  const $grid = $('#fieldMappingGrid').empty();
  const smartNames = state.smartNames || {};

  state.fieldNames.forEach((field, index) => {
    // Use the same smart name that appears as the table column header
    const displayName = smartNames[field] || getShortFieldName(field);

    // Use persisted mapping if available, otherwise auto-detect using display name
    let mappedValue = state.fieldMapping[field];
    if (!mappedValue) {
      mappedValue = autoDetectMapping(displayName);
      state.fieldMapping[field] = mappedValue;
    }

    const $row = $(`
      <div class="mapping-row">
        <span class="source-field" title="${field}">${displayName}</span>
        <span class="arrow">→</span>
        <select class="form-control input-sm" data-field="${field}">
          ${EXPORT_FIELDS.map(f =>
            `<option value="${f.id}" ${f.id === mappedValue ? 'selected' : ''}>${f.label}</option>`
          ).join('')}
        </select>
      </div>
    `);

    // Save mapping on change (persistent!)
    $row.find('select').on('change', function() {
      const newValue = $(this).val();
      state.fieldMapping[$(this).data('field')] = newValue;
      savePersistedFieldMapping(); // Auto-save on any change
    });

    $grid.append($row);
  });

  // Update the header to reflect the selected cart template
  const selectedTemplate = $('#cartTemplateSelect').val() || 'export';
  const templateNames = { cscart: 'CS-Cart', shopify: 'Shopify', woocommerce: 'WooCommerce', prestashop: 'PrestaShop', magento: 'Magento', bigcommerce: 'BigCommerce' };
  const templateLabel = templateNames[selectedTemplate] || 'Export';
  $('#mappingHeaderText').text('Map Fields for ' + templateLabel);

  $('#fieldMappingSection').slideDown();

  // Save initial auto-detected mappings
  savePersistedFieldMapping();
}

export function autoDetectMapping(fieldName) {
  const lower = fieldName.toLowerCase();

  // Price fields
  if ((lower.includes('price') || lower.includes('cost')) && !lower.includes('list') && !lower.includes('original') && !lower.includes('was')) return 'price';
  if (lower.includes('list') && lower.includes('price')) return 'list_price';
  if (lower.includes('original') && lower.includes('price')) return 'list_price';
  if (lower.includes('was') && lower.includes('price')) return 'list_price';
  if (lower.includes('msrp')) return 'list_price';

  // Product identity
  if (lower.includes('title') || (lower.includes('name') && lower.includes('product'))) return 'product_name';
  if (lower === 'name' || lower === 'title') return 'product_name';

  // IDs and codes — Product ID = supplier item number (primary identifier)
  if (lower === 'product id' || lower === 'product_id') return 'product_code';
  if (lower.includes('item') && lower.includes('id')) return 'product_code';
  if (lower.includes('product') && lower.includes('id')) return 'product_code';
  if (lower.includes('sku')) return 'supplier_sku';
  if (lower.includes('code') || lower.includes('_id')) return 'product_code';

  // Images
  if (lower.includes('img') || lower.includes('image') || lower.includes('@src')) {
    if (lower.includes('additional') || lower.includes('gallery') || lower.includes('thumb')) {
      return 'additional_images';
    }
    return 'images';
  }

  // Description
  if (lower.includes('desc')) {
    if (lower.includes('short') || lower.includes('brief')) return 'short_description';
    return 'description';
  }

  // Stock and quantity
  if (lower.includes('stock') || lower.includes('qty') || lower.includes('quantity') || lower.includes('inventory')) return 'quantity';

  // Category
  if (lower.includes('category') || lower.includes('cat')) return 'category';

  // Weight
  if (lower.includes('weight')) return 'weight';

  // Brand
  if (lower.includes('brand') || lower.includes('manufacturer')) return 'brand';

  // URLs
  if (lower.includes('href') || lower.includes('url') || lower.includes('link')) return 'url';

  // Shipping
  if (lower.includes('ship') || lower.includes('delivery') || lower.includes('freight')) {
    if (lower.includes('cost') || lower.includes('fee') || lower.includes('price')) return 'shipping_cost';
    return 'shipping';
  }

  // Variants/Options
  if (lower.includes('variant') || lower.includes('option')) return 'variants';
  if (lower.includes('color') || lower.includes('colour')) return 'color';
  if (lower.includes('size')) return 'size';

  // Reviews
  if (lower.includes('review')) {
    if (lower.includes('count') || lower.includes('num')) return 'review_count';
    return 'reviews';
  }
  if (lower.includes('rating') || lower.includes('star')) return 'rating';
  if (lower.includes('sold') || lower.includes('order')) return 'sold_count';

  // Store/Seller
  if (lower.includes('store') || lower.includes('seller') || lower.includes('shop')) {
    if (lower.includes('rating') || lower.includes('score')) return 'store_rating';
    return 'store_name';
  }

  // Attributes
  if (lower.includes('attr') || lower.includes('spec') || lower.includes('feature')) {
    if (lower.includes('spec')) return 'specifications';
    return 'attributes';
  }

  // Minimum order
  if (lower.includes('min') && (lower.includes('order') || lower.includes('qty'))) return 'min_order';

  return ''; // Ignore by default
}

export function autoMapFields() {
  $('#fieldMappingGrid select').each(function() {
    const field = $(this).data('field');
    const shortName = getShortFieldName(field);
    const mapped = autoDetectMapping(shortName);
    $(this).val(mapped);
    state.fieldMapping[field] = mapped;
  });

  // Save the auto-mapped fields
  savePersistedFieldMapping();

  showToast('Fields auto-mapped based on names', 'success');
}
