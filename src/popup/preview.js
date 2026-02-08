/**
 * Preview & delete functions for scraped rows and catalog products
 */
/* global $, chrome */

import { state } from './state.js';
import { updateExportButtons, showToast } from './utils.js';
import { updateDataTable } from './dataTable.js';
import { saveScrapedData } from './persistence.js';
import { deleteCatalogRow } from './catalog.js';

/**
 * Preview scraped data row
 */
export function previewScrapedRow(rowIndex) {
  if (rowIndex < 0 || rowIndex >= state.data.length) return;

  const row = state.data[rowIndex];
  const rawRow = state.rawData[rowIndex] || {};
  const combined = { ...rawRow, ...row };

  state.previewContext = { type: 'scraped', index: rowIndex };

  // Set title
  $('#previewModalTitle').text(combined.Title || combined.title || combined['Product Name'] || `Row ${rowIndex + 1}`);

  // Set image
  const imageUrl = combined.Image || combined.image || combined.images?.[0] || '';
  if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = 'Product';
    $('#previewImage').empty().append(img);
  } else {
    $('#previewImage').html('<div class="text-muted text-center"><span class="glyphicon glyphicon-picture" style="font-size:60px;color:#ccc;"></span><br>No image</div>');
  }

  // Set gallery (no inline onclick - using event delegation)
  const images = combined.images || [];
  if (images.length > 1) {
    const $gallery = $('#previewGallery').empty();
    images.slice(0, 10).forEach((imgUrl, i) => {
      if (typeof imgUrl === 'string' && imgUrl.startsWith('http')) {
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = 'Image ' + (i + 1);
        if (i === 0) img.className = 'active';
        $gallery.append(img);
      }
    });
  } else {
    $('#previewGallery').empty();
  }

  // Build details
  let detailsHtml = '';
  const skipFields = ['images', 'image', '_element', '_html'];

  Object.entries(combined).forEach(([key, value]) => {
    if (skipFields.includes(key.toLowerCase()) || !value) return;

    let displayValue = value;
    if (Array.isArray(value)) {
      displayValue = value.length + ' items';
    } else if (typeof value === 'object') {
      displayValue = JSON.stringify(value).substring(0, 100) + '...';
    }

    const isPrice = key.toLowerCase().includes('price');
    detailsHtml += `<div class="detail-row">
      <span class="detail-label">${key}:</span>
      <span class="detail-value${isPrice ? ' price' : ''}">${displayValue}</span>
    </div>`;
  });

  $('#previewDetails').html(detailsHtml || '<p class="text-muted">No details available</p>');

  // Set source link
  const url = combined.url || combined.URL || combined.Link || state.tabUrl;
  if (url) {
    $('#previewSourceLink').attr('href', url).show();
  } else {
    $('#previewSourceLink').hide();
  }

  $('#previewModal').modal('show');
}

/**
 * Preview catalog product
 */
export function previewCatalogRow(rowIndex) {
  if (rowIndex < 0 || rowIndex >= state.catalog.length) return;

  const product = state.catalog[rowIndex];

  state.previewContext = { type: 'catalog', index: rowIndex, productCode: product.productCode };

  // Set title
  $('#previewModalTitle').text(product.title || product.productCode);

  // Set image - handle both array and comma-separated string
  let images = product.images || [];
  if (typeof images === 'string') {
    images = images.split(',').map(i => i.trim()).filter(i => i && i.startsWith('http'));
  }
  if (images.length > 0 && typeof images[0] === 'string' && images[0].startsWith('http')) {
    const img = document.createElement('img');
    img.src = images[0];
    img.alt = 'Product';
    $('#previewImage').empty().append(img);
  } else {
    $('#previewImage').html('<div class="text-muted text-center"><span class="glyphicon glyphicon-picture" style="font-size:60px;color:#ccc;"></span><br>No image</div>');
  }

  // Set gallery (no inline onclick - using event delegation)
  if (images.length > 1) {
    const $gallery = $('#previewGallery').empty();
    images.slice(0, 10).forEach((imgUrl, i) => {
      if (typeof imgUrl === 'string' && imgUrl.startsWith('http')) {
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = 'Image ' + (i + 1);
        if (i === 0) img.className = 'active';
        $gallery.append(img);
      }
    });
  } else {
    $('#previewGallery').empty();
  }

  // Build details
  let detailsHtml = `
    <div class="detail-row">
      <span class="detail-label">Product Code:</span>
      <span class="detail-value">${product.productCode}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Supplier Price:</span>
      <span class="detail-value price">$${(product.supplierPrice || 0).toFixed(2)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Your Price:</span>
      <span class="detail-value price">$${(product.yourPrice || 0).toFixed(2)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Supplier:</span>
      <span class="detail-value">${product.domain || 'Unknown'}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Stock:</span>
      <span class="detail-value">${product.stock || 'Unknown'}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Added:</span>
      <span class="detail-value">${product.addedDate ? new Date(product.addedDate).toLocaleString() : 'Unknown'}</span>
    </div>
  `;

  // Add rating and review stats
  if (product.rating) {
    detailsHtml += `<div class="detail-row">
      <span class="detail-label">Rating:</span>
      <span class="detail-value">⭐ ${product.rating}</span>
    </div>`;
  }

  if (product.reviewCount || product.review_count) {
    detailsHtml += `<div class="detail-row">
      <span class="detail-label">Reviews:</span>
      <span class="detail-value">${product.reviewCount || product.review_count} reviews</span>
    </div>`;
  }

  if (product.soldCount || product.sold_count) {
    detailsHtml += `<div class="detail-row">
      <span class="detail-label">Sold:</span>
      <span class="detail-value">${product.soldCount || product.sold_count} units</span>
    </div>`;
  }

  if (product.storeName) {
    detailsHtml += `<div class="detail-row">
      <span class="detail-label">Store:</span>
      <span class="detail-value">${product.storeName}${product.storeRating ? ` (${product.storeRating})` : ''}</span>
    </div>`;
  }

  if (product.variants && product.variants.length > 0) {
    detailsHtml += `<div class="detail-row">
      <span class="detail-label">Variants:</span>
      <span class="detail-value">${product.variants.length} options</span>
    </div>`;
  }

  if (product.reviews && product.reviews.length > 0) {
    detailsHtml += `<div class="detail-row">
      <span class="detail-label">Reviews:</span>
      <span class="detail-value">${product.reviews.length} reviews</span>
    </div>`;
  }

  if (product.description) {
    detailsHtml += `<div class="detail-row">
      <span class="detail-label">Description:</span>
      <span class="detail-value">${(product.descriptionText || product.description).substring(0, 200)}...</span>
    </div>`;
  }

  $('#previewDetails').html(detailsHtml);

  // Set source link
  const productUrl = product.supplierUrl || product.url;
  if (productUrl) {
    $('#previewSourceLink').attr('href', productUrl).show();
  } else {
    $('#previewSourceLink').hide();
  }

  $('#previewModal').modal('show');
}

/**
 * Delete single scraped row (used by preview modal)
 */
export function deleteScrapedRow(rowIndex) {
  if (rowIndex < 0 || rowIndex >= state.data.length) return;

  state.data.splice(rowIndex, 1);
  state.rawData.splice(rowIndex, 1);

  // Rebuild table properly (converts objects → arrays with correct headers)
  updateDataTable(state.data);
  updateExportButtons();
  $('#rowCount').text(state.data.length);
  saveScrapedData();
  showToast('Row deleted', 'info');
}

/**
 * Delete item from preview modal
 */
export function deletePreviewedItem() {
  if (!state.previewContext) return;

  if (state.previewContext.type === 'scraped') {
    deleteScrapedRow(state.previewContext.index);
  } else if (state.previewContext.type === 'catalog') {
    deleteCatalogRow(state.previewContext.index);
  }

  $('#previewModal').modal('hide');
}
