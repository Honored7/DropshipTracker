/**
 * Catalog Table (Handsontable) – initialization, refresh, selection, filtering
 */
/* global $, Handsontable, chrome */

import { state } from './state.js';
import { showToast } from './utils.js';
import { previewCatalogRow } from './preview.js';
import { scrapeProductDetails, deleteCatalogRow, updateCatalogProduct } from './catalog.js';

export function initializeCatalogTable() {
  const container = document.getElementById('catalogGrid');

  state.catalogTable = new Handsontable(container, {
    data: [],
    colHeaders: ['✓', 'Image', 'Code', 'Title', 'Supplier', 'Price', 'Your $', 'Stock', 'Rating', 'Reviews', 'Sold', 'Category', 'Checked', 'Actions'],
    columns: [
      { data: 'selected', type: 'checkbox', className: 'htCenter', width: 30 },
      {
        data: 'thumbnail',
        readOnly: true,
        width: 45,
        renderer: function(instance, td, row, col, prop, value, cellProperties) {
          const images = instance.getSourceDataAtRow(row)?.images;
          const firstImage = images ? (Array.isArray(images) ? images[0] : images.split(',')[0]) : '';
          if (firstImage && firstImage.startsWith('http')) {
            td.innerHTML = `<img src="${firstImage}" style="max-width:38px;max-height:38px;object-fit:cover;" onerror="this.style.display='none'" />`;
          } else {
            td.innerHTML = '<span style="color:#ccc">📷</span>';
          }
          return td;
        }
      },
      { data: 'productCode', readOnly: true, width: 80 },
      { data: 'title', readOnly: true, width: 140 },
      { data: 'domain', readOnly: true, width: 65 },
      { data: 'supplierPrice', type: 'numeric', numericFormat: { pattern: '$0,0.00' }, readOnly: true, width: 60 },
      { data: 'yourPrice', type: 'numeric', numericFormat: { pattern: '$0,0.00' }, width: 60 },
      { data: 'stock', type: 'numeric', readOnly: true, width: 45 },
      {
        data: 'rating',
        readOnly: true,
        width: 50,
        renderer: function(instance, td, row, col, prop, value, cellProperties) {
          const rating = value || instance.getSourceDataAtRow(row)?.rating;
          if (rating) {
            td.innerHTML = `⭐${rating}`;
            td.style.textAlign = 'center';
          } else {
            td.innerHTML = '-';
            td.style.textAlign = 'center';
            td.style.color = '#ccc';
          }
          return td;
        }
      },
      { data: 'reviewCount', readOnly: true, width: 55, className: 'htCenter' },
      { data: 'soldCount', readOnly: true, width: 55, className: 'htCenter' },
      { data: 'category', readOnly: true, width: 75 },
      { data: 'lastCheckedFormatted', readOnly: true, width: 65 },
      {
        data: 'actions',
        readOnly: true,
        width: 85,
        renderer: function(instance, td, row, col, prop, value, cellProperties) {
          td.innerHTML = '<div class="row-actions">' +
            '<button class="btn btn-xs btn-info btn-scrape-details" data-action="scrape" data-row="' + row + '" title="Scrape Full Details">🔍</button>' +
            '<button class="btn btn-xs btn-default btn-preview" data-action="preview" data-row="' + row + '" title="Preview">👁️</button>' +
            '<button class="btn btn-xs btn-danger btn-delete" data-action="delete" data-row="' + row + '" title="Delete">🗑️</button>' +
            '</div>';
          return td;
        }
      }
    ],
    height: 350,
    width: '100%',
    stretchH: 'none',
    licenseKey: 'non-commercial-and-evaluation',
    manualColumnResize: true,
    columnSorting: true,
    filters: true,
    contextMenu: {
      items: {
        'scrape_details': {
          name: '🔍 Scrape Full Details',
          callback: function(key, selection) {
            const row = this.toPhysicalRow(selection[0].start.row);
            scrapeProductDetails(row);
          }
        },
        'preview': {
          name: '👁️ Preview',
          callback: function(key, selection) {
            const row = this.toPhysicalRow(selection[0].start.row);
            previewCatalogRow(row);
          }
        },
        'delete_row': {
          name: '🗑️ Delete',
          callback: function(key, selection) {
            const rows = selection.map(s => this.toPhysicalRow(s.start.row)).sort((a, b) => b - a);
            rows.forEach(row => deleteCatalogRow(row));
          }
        },
        'separator': '---------',
        'copy': { name: 'Copy' }
      }
    },
    afterOnCellMouseDown: function(event, coords, td) {
      const target = event.target;
      if (target.matches('[data-action]') || target.closest('[data-action]')) {
        event.stopPropagation();
        const btn = target.matches('[data-action]') ? target : target.closest('[data-action]');
        const action = btn.dataset.action;
        const physicalRow = this.toPhysicalRow(coords.row);

        if (action === 'preview') {
          previewCatalogRow(physicalRow);
        } else if (action === 'delete') {
          deleteCatalogRow(physicalRow);
        } else if (action === 'scrape') {
          scrapeProductDetails(physicalRow);
        }
      }
    },
    afterChange: function(changes, source) {
      if (changes) {
        let selectionChanged = false;
        changes.forEach(([row, prop, oldVal, newVal]) => {
          if (prop === 'selected') {
            selectionChanged = true;
          } else if (prop === 'yourPrice' && oldVal !== newVal && source === 'edit') {
            const physicalRow = this.toPhysicalRow(row);
            const product = state.catalog[physicalRow];
            if (product) {
              updateCatalogProduct(product.productCode, { yourPrice: newVal });
            }
          }
        });
        if (selectionChanged) {
          updateCatalogSelection();
        }
      }
    }
  });
}

export function refreshCatalogTable() {
  const displayData = state.catalog.map(p => ({
    selected: p.selected || false,
    ...p,
    reviewCount: p.reviewCount || p.review_count || '',
    soldCount: p.soldCount || p.sold_count || p.orders || '',
    rating: p.rating || '',
    category: p.category || '',
    supplierPrice: p.supplierPrice || 0,
    lastCheckedFormatted: p.lastChecked
      ? new Date(p.lastChecked).toLocaleDateString()
      : 'Never'
  }));

  state.catalogTable.loadData(displayData);
  updateCatalogStats();
  updateCatalogSelection();
}

export function updateCatalogCount() {
  $('#catalogCount').text(state.catalog.length);
  $('#totalProducts').text(state.catalog.length);
}

export function updateCatalogStats() {
  const priceChanges = state.catalog.filter(p =>
    p.priceHistory && p.priceHistory.length > 1 &&
    p.priceHistory[p.priceHistory.length - 1].price !== p.priceHistory[p.priceHistory.length - 2].price
  ).length;

  const lowStock = state.catalog.filter(p => p.stock && p.stock < 10).length;

  $('#priceChanges').text(priceChanges);
  $('#lowStockCount').text(lowStock);
}

export function updateCatalogSelection() {
  const selected = [];
  const selectedRows = [];
  const data = state.catalogTable.getData();

  data.forEach((row, index) => {
    if (row[0] === true) {
      selected.push(state.catalog[index]?.productCode);
      selectedRows.push(index);
    }
  });

  state.selectedProducts = selected.filter(Boolean);
  $('#deleteSelectedBtn').prop('disabled', selected.length === 0);

  const $scrapeBtn = $('#scrapeSelectedBtn');
  if (selectedRows.length > 0) {
    $scrapeBtn.text(`Scrape Selected (${selectedRows.length})`).prop('disabled', false);
  } else {
    $scrapeBtn.text('Scrape Selected').prop('disabled', true);
  }

  if (state.selectedProducts.length > 0) {
    $('#selectionStatus').show();
    $('#selectionCount').text(state.selectedProducts.length);
  } else {
    $('#selectionStatus').hide();
  }
}

export function selectAllProducts() {
  const data = state.catalogTable.getData();
  const changes = data.map((row, index) => [index, 0, true]);
  state.catalogTable.setDataAtCell(changes, 'bulkSelect');
  updateCatalogSelection();
  showToast(`Selected ${data.length} products`, 'info');
}

export function deselectAllProducts() {
  const data = state.catalogTable.getData();
  const changes = data.map((row, index) => [index, 0, false]);
  state.catalogTable.setDataAtCell(changes, 'bulkSelect');
  updateCatalogSelection();
  showToast('Selection cleared', 'info');
}

export function invertSelection() {
  const data = state.catalogTable.getData();
  const changes = data.map((row, index) => [index, 0, row[0] !== true]);
  state.catalogTable.setDataAtCell(changes, 'bulkSelect');
  updateCatalogSelection();
  showToast('Selection inverted', 'info');
}

export function selectByFilter(filterType) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;

  let selected = 0;

  state.catalog.forEach((product, index) => {
    let shouldSelect = false;

    switch (filterType) {
      case 'aliexpress':
        shouldSelect = product.domain?.toLowerCase().includes('aliexpress');
        break;
      case 'alibaba':
        shouldSelect = product.domain?.toLowerCase().includes('alibaba');
        break;
      case 'has-reviews':
        shouldSelect = product.reviews && product.reviews.length > 0;
        break;
      case 'has-variants':
        shouldSelect = product.variants && product.variants.length > 0;
        break;
      case 'today':
        shouldSelect = product.addedDate && (now - product.addedDate) < dayMs;
        break;
      case 'week':
        shouldSelect = product.addedDate && (now - product.addedDate) < weekMs;
        break;
      default:
        shouldSelect = false;
    }

    if (shouldSelect) {
      state.catalogTable.setDataAtCell(index, 0, true, 'bulkSelect');
      selected++;
    }
  });

  updateCatalogSelection();
  showToast(`Selected ${selected} products matching "${filterType}"`, 'info');
}

export function getSelectedCatalogRows() {
  if (!state.catalogTable) return [];

  const selectedRows = [];
  const data = state.catalogTable.getData();

  data.forEach((row, index) => {
    if (row[0] === true) {
      selectedRows.push(index);
    }
  });

  return selectedRows;
}

export function filterCatalog(filter) {
  let filtered = state.catalog;

  if (typeof filter === 'string' && filter !== 'all') {
    switch (filter) {
      case 'price-changed':
        filtered = state.catalog.filter(p =>
          p.priceHistory && p.priceHistory.length > 1 &&
          p.priceHistory[p.priceHistory.length - 1].price !== p.priceHistory[0].price
        );
        break;
      case 'low-stock':
        filtered = state.catalog.filter(p => p.stock && p.stock < 10);
        break;
      case 'needs-update':
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        filtered = state.catalog.filter(p => !p.lastChecked || p.lastChecked < dayAgo);
        break;
    }
  }

  const searchText = $('#catalogSearch').val()?.toLowerCase();
  if (searchText) {
    filtered = filtered.filter(p =>
      p.productCode?.toLowerCase().includes(searchText) ||
      p.title?.toLowerCase().includes(searchText) ||
      p.domain?.toLowerCase().includes(searchText)
    );
  }

  state.catalogTable.loadData(filtered.map(p => ({
    ...p,
    lastCheckedFormatted: p.lastChecked ? new Date(p.lastChecked).toLocaleDateString() : 'Never'
  })));
}
