/**
 * Settings, Suppliers, and Data Management
 */
/* global $, chrome */

import { state } from './state.js';
import { showToast, downloadFile } from './utils.js';
import { loadCatalog } from './catalog.js';
import { refreshCatalogTable, updateCatalogCount } from './catalogTable.js';

// ============================================
// SETTINGS
// ============================================

export function loadSettings() {
  chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
    state.settings = response?.settings || {};
    applySettingsToUI();
  });
}

export function applySettingsToUI() {
  if (!state.settings) return;

  $('#driveFolderName').val(state.settings.googleDriveFolder || 'DropshipTracker');
  $('#autoSyncEnabled').prop('checked', state.settings.autoSync || false);
  $('#syncInterval').val(state.settings.syncInterval || 360);
  $('#defaultMargin').val(state.settings.defaultMargin || 30);
  $('#marginType').val(state.settings.marginType || 'percent');
  $('#includeShippingInCost').prop('checked', state.settings.includeShippingInCost !== false);
  $('#currency').val(state.settings.currency || 'USD');
  $('#roundPrices').prop('checked', state.settings.roundPrices !== false);
  $('#roundTo').val(state.settings.roundTo || '0.99');
  $('#defaultLanguage').val(state.settings.language || 'en');
  $('#fieldDelimiter').val(state.settings.cscartDelimiter || '///');
  $('#defaultStatus').val(state.settings.defaultStatus || 'A');
  $('#defaultCategory').val(state.settings.defaultCategory || '');
}

export function saveSettings() {
  state.settings = {
    googleDriveFolder: $('#driveFolderName').val(),
    autoSync: $('#autoSyncEnabled').is(':checked'),
    syncInterval: parseInt($('#syncInterval').val()),
    defaultMargin: parseFloat($('#defaultMargin').val()),
    marginType: $('#marginType').val(),
    includeShippingInCost: $('#includeShippingInCost').is(':checked'),
    currency: $('#currency').val(),
    roundPrices: $('#roundPrices').is(':checked'),
    roundTo: parseFloat($('#roundTo').val()),
    language: $('#defaultLanguage').val(),
    cscartDelimiter: $('#fieldDelimiter').val(),
    defaultStatus: $('#defaultStatus').val(),
    defaultCategory: $('#defaultCategory').val()
  };

  chrome.runtime.sendMessage({ action: 'saveSettings', settings: state.settings }, (response) => {
    if (response?.success) {
      showToast('Settings saved', 'success');
    }
  });
}

// ============================================
// SUPPLIERS
// ============================================

export function loadSuppliers() {
  chrome.runtime.sendMessage({ action: 'getSuppliers' }, (response) => {
    state.suppliers = response?.suppliers || [];
    renderSupplierCards();
    updateSupplierStats();
  });
}

export function renderSupplierCards() {
  const $list = $('#suppliersList');
  $list.empty();

  if (state.suppliers.length === 0) {
    $list.html('<p class="text-muted">No suppliers configured. Click "Add Supplier" to add one.</p>');
    return;
  }

  state.suppliers.forEach(supplier => {
    const $card = $(`
      <div class="supplier-card" data-domain="${supplier.domain}">
        <div class="supplier-icon">
          <img src="https://www.google.com/s2/favicons?domain=${supplier.domain}&sz=32" alt="" onerror="this.style.display='none'">
        </div>
        <div class="supplier-info">
          <h5>${supplier.name || supplier.domain}</h5>
          <span class="text-muted">${supplier.domain}</span>
          ${supplier.notes ? `<small class="text-muted d-block">${supplier.notes}</small>` : ''}
        </div>
        <div class="supplier-stats">
          <span class="badge">0 products</span>
        </div>
        <div class="supplier-actions">
          <button type="button" class="btn btn-xs btn-default btn-configure" data-domain="${supplier.domain}" title="Configure">
            <span class="glyphicon glyphicon-cog"></span>
          </button>
          <button type="button" class="btn btn-xs btn-danger btn-delete-supplier" data-domain="${supplier.domain}" title="Delete">
            <span class="glyphicon glyphicon-trash"></span>
          </button>
        </div>
      </div>
    `);
    $list.append($card);
  });

  $('.btn-delete-supplier').off('click').on('click', function() {
    const domain = $(this).data('domain');
    deleteSupplier(domain);
  });

  $('.btn-configure').off('click').on('click', function() {
    const domain = $(this).data('domain');
    configureSupplier(domain);
  });
}

export function deleteSupplier(domain) {
  if (!confirm(`Delete supplier ${domain}?`)) return;

  chrome.runtime.sendMessage({ action: 'deleteSupplier', domain }, (response) => {
    if (response?.success) {
      showToast('Supplier deleted', 'success');
      loadSuppliers();
    } else {
      showToast('Failed to delete supplier', 'error');
    }
  });
}

export function configureSupplier(domain) {
  const supplier = state.suppliers.find(s => s.domain === domain);
  if (!supplier) return;

  const modal = `
    <div id="configureSupplierModal" class="modal fade" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal">&times;</button>
            <h4 class="modal-title">Configure ${supplier.name || domain}</h4>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>Display Name</label>
              <input type="text" class="form-control" id="configSupplierName" value="${supplier.name || ''}">
            </div>
            <div class="form-group">
              <label>Notes</label>
              <textarea class="form-control" id="configSupplierNotes" rows="3">${supplier.notes || ''}</textarea>
            </div>
            <div class="form-group">
              <label>Default Category</label>
              <input type="text" class="form-control" id="configSupplierCategory" value="${supplier.defaultCategory || ''}" placeholder="e.g., Electronics///Gadgets">
            </div>
            <div class="form-group">
              <label>Default Margin (%)</label>
              <input type="number" class="form-control" id="configSupplierMargin" value="${supplier.defaultMargin || 30}" min="0" max="500">
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="saveSupplierConfigBtn">Save</button>
          </div>
        </div>
      </div>
    </div>
  `;

  $('#configureSupplierModal').remove();
  $('body').append(modal);

  $('#saveSupplierConfigBtn').on('click', function() {
    const updates = {
      domain: domain,
      name: $('#configSupplierName').val().trim(),
      notes: $('#configSupplierNotes').val().trim(),
      defaultCategory: $('#configSupplierCategory').val().trim(),
      defaultMargin: parseInt($('#configSupplierMargin').val()) || 30
    };

    chrome.runtime.sendMessage({ action: 'saveSupplier', supplier: updates }, (response) => {
      if (response?.success) {
        showToast('Supplier updated', 'success');
        $('#configureSupplierModal').modal('hide');
        loadSuppliers();
      }
    });
  });

  $('#configureSupplierModal').modal('show');
}

export function updateSupplierStats() {
  const counts = {};
  state.catalog.forEach(p => {
    counts[p.domain] = (counts[p.domain] || 0) + 1;
  });

  $('.supplier-card').each(function() {
    const domain = $(this).data('domain');
    const count = counts[domain] || 0;
    $(this).find('.badge').text(`${count} products`);
  });
}

export function saveNewSupplier() {
  const supplier = {
    domain: $('#newSupplierDomain').val().trim(),
    name: $('#newSupplierName').val().trim(),
    notes: $('#newSupplierNotes').val().trim(),
    addedDate: Date.now()
  };

  if (!supplier.domain) {
    showToast('Please enter a domain', 'warning');
    return;
  }

  chrome.runtime.sendMessage({ action: 'saveSupplier', supplier }, (response) => {
    if (response?.success) {
      showToast('Supplier added', 'success');
      $('#addSupplierForm').slideUp();

      const $card = $(`
        <div class="supplier-card" data-domain="${supplier.domain}">
          <div class="supplier-icon">
            <img src="https://www.google.com/s2/favicons?domain=${supplier.domain}&sz=32" alt="">
          </div>
          <div class="supplier-info">
            <h5>${supplier.name || supplier.domain}</h5>
            <span class="text-muted">${supplier.domain}</span>
          </div>
          <div class="supplier-stats">
            <span class="badge">0 products</span>
          </div>
          <div class="supplier-actions">
            <button type="button" class="btn btn-xs btn-default" title="Configure">
              <span class="glyphicon glyphicon-cog"></span>
            </button>
          </div>
        </div>
      `);

      $('#suppliersList').append($card);
      $('#newSupplierDomain, #newSupplierName, #newSupplierNotes').val('');
    }
  });
}

// ============================================
// DATA MANAGEMENT
// ============================================

export function exportAllData() {
  chrome.storage.local.get(null, (data) => {
    const json = JSON.stringify(data, null, 2);
    downloadFile(json, 'dropshiptracker-backup.json', 'application/json');
    showToast('Backup downloaded', 'success');
  });
}

export function importData(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      chrome.storage.local.set(data, () => {
        showToast('Data imported successfully', 'success');
        loadCatalog();
        loadSettings();
        loadSuppliers();
      });
    } catch (err) {
      showToast('Invalid backup file', 'error');
    }
  };
  reader.readAsText(file);
}

export function clearAllData() {
  if (!confirm('This will delete ALL your data including catalog, settings, and suppliers. Are you sure?')) {
    return;
  }

  chrome.storage.local.clear(() => {
    state.catalog = [];
    state.settings = null;
    state.suppliers = [];

    loadSettings();
    refreshCatalogTable();
    updateCatalogCount();

    showToast('All data cleared', 'success');
  });
}
