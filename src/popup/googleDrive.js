/**
 * Google Drive integration – auth, upload, sync
 */
/* global $, GoogleDriveService, CSCartMapper, CSCartXMLBuilder, chrome */

import { state } from './state.js';
import { showToast, setStatus } from './utils.js';
import { mapToCSCart } from './export.js';

export function checkDriveAuth() {
  if (typeof GoogleDriveService !== 'undefined') {
    GoogleDriveService.checkAuth().then(isAuthed => {
      updateDriveStatus(isAuthed);
    });
  }
}

export function authorizeDrive() {
  if (typeof GoogleDriveService !== 'undefined') {
    GoogleDriveService.authorize().then(success => {
      updateDriveStatus(success);
      if (success) {
        showToast('Google Drive connected!', 'success');
      }
    }).catch(err => {
      showToast('Authorization failed: ' + err.message, 'error');
    });
  } else {
    showToast('Google Drive service not loaded', 'error');
  }
}

export function disconnectDrive() {
  if (typeof GoogleDriveService !== 'undefined') {
    GoogleDriveService.disconnect();
    updateDriveStatus(false);
    showToast('Google Drive disconnected', 'success');
  }
}

export function updateDriveStatus(connected) {
  const $indicator = $('.sync-indicator');
  const $text = $('.sync-text');
  const $authBtn = $('#authDriveBtn');
  const $disconnectBtn = $('#disconnectDriveBtn');
  const $status = $('#driveAuthStatus');

  if (connected) {
    $indicator.addClass('connected');
    $text.text('Connected');
    $authBtn.hide();
    $disconnectBtn.show();
    $status.removeClass('alert-warning').addClass('alert-success')
      .html('<span class="glyphicon glyphicon-ok"></span> Connected to Google Drive');
    $('#uploadDriveBtn').prop('disabled', false);
    $('#syncCatalogDriveBtn').prop('disabled', false);
  } else {
    $indicator.removeClass('connected');
    $text.text('Not synced');
    $authBtn.show();
    $disconnectBtn.hide();
    $status.removeClass('alert-success').addClass('alert-warning')
      .html('<span class="glyphicon glyphicon-warning-sign"></span> Not connected. Click to authorize.');
    $('#uploadDriveBtn').prop('disabled', true);
    $('#syncCatalogDriveBtn').prop('disabled', true);
  }
}

export function uploadToDrive() {
  if (state.data.length === 0) {
    showToast('No data to upload', 'warning');
    return;
  }

  const products = mapToCSCart(state.data, state.rawData);
  const xml = CSCartXMLBuilder.build(products, state.settings);
  const filename = `products-${new Date().toISOString().slice(0,10)}.xml`;

  setStatus('Uploading to Google Drive...');

  GoogleDriveService.uploadFile(xml, filename, 'application/xml')
    .then(result => {
      showToast('Uploaded to Google Drive', 'success');
      setStatus('Upload complete');
      updateSyncTime();
    })
    .catch(err => {
      showToast('Upload failed: ' + err.message, 'error');
      setStatus('Upload failed');
    });
}

export function syncCatalogToDrive() {
  if (state.catalog.length === 0) {
    showToast('Catalog is empty', 'warning');
    return;
  }

  const products = state.catalog.map(p => CSCartMapper.fromCatalog(p, state.settings));
  const xml = CSCartXMLBuilder.build(products, state.settings);
  const filename = `catalog-${new Date().toISOString().slice(0,10)}.xml`;

  setStatus('Syncing catalog to Google Drive...');

  GoogleDriveService.uploadFile(xml, filename, 'application/xml')
    .then(result => {
      showToast('Catalog synced to Google Drive', 'success');
      setStatus('Sync complete');
      updateSyncTime();
    })
    .catch(err => {
      showToast('Sync failed: ' + err.message, 'error');
      setStatus('Sync failed');
    });
}

export function updateSyncTime() {
  const now = new Date();
  $('#lastSyncTime').text(now.toLocaleTimeString());
  chrome.storage.local.set({ lastSyncTime: now.getTime() });
}
