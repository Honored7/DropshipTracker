/**
 * Data Table (Handsontable) – initialization, update, expand/collapse columns
 */
/* global $, Handsontable */

import { state, MAX_VISIBLE_COLUMNS } from './state.js';
import { updateExportButtons, showToast } from './utils.js';
import { saveScrapedData } from './persistence.js';
import { previewScrapedRow } from './preview.js';

export function initializeDataTable() {
  const container = document.getElementById('dataPreview');

  state.dataTable = new Handsontable(container, {
    data: [],
    colHeaders: true,
    rowHeaders: false,
    height: 300,
    width: '100%',
    stretchH: 'none',
    colWidths: 120,
    autoWrapRow: false,
    autoWrapCol: false,
    licenseKey: 'non-commercial-and-evaluation',
    contextMenu: {
      items: {
        'preview': {
          name: '👁️ Preview',
          callback: function(key, selection) {
            const visualRow = selection[0].start.row;
            const physicalRow = this.toPhysicalRow(visualRow);
            previewScrapedRow(physicalRow);
          }
        },
        'delete_row': {
          name: '🗑️ Delete Row',
          callback: function(key, selection) {
            const hot = this;
            console.log('[DropshipTracker] Delete row selection:', JSON.stringify(selection));
            console.log('[DropshipTracker] Data length before:', state.data.length);

            const physicalRows = [];
            selection.forEach(sel => {
              for (let r = sel.start.row; r <= sel.end.row; r++) {
                const physicalRow = (hot.toPhysicalRow && typeof hot.toPhysicalRow === 'function')
                  ? hot.toPhysicalRow(r)
                  : r;
                if (physicalRow >= 0 && physicalRow < state.data.length && !physicalRows.includes(physicalRow)) {
                  physicalRows.push(physicalRow);
                }
              }
            });

            console.log('[DropshipTracker] Physical rows to delete:', physicalRows);

            if (physicalRows.length === 0) {
              showToast('No valid rows selected', 'warning');
              return;
            }

            physicalRows.sort((a, b) => b - a);

            physicalRows.forEach(rowIdx => {
              state.data.splice(rowIdx, 1);
              if (state.rawData && Array.isArray(state.rawData) && state.rawData.length > rowIdx) {
                state.rawData.splice(rowIdx, 1);
              }
            });

            console.log('[DropshipTracker] Data length after:', state.data.length);

            updateDataTable(state.data);
            updateExportButtons();
            $('#rowCount').text(state.data.length);
            saveScrapedData();
            showToast(`Deleted ${physicalRows.length} row(s)`, 'info');
          }
        },
        'separator': '---------',
        'copy': { name: 'Copy' },
        'cut': { name: 'Cut' }
      }
    },
    manualColumnResize: true,
    columnSorting: true,
    filters: true,
    dropdownMenu: true,
    afterChange: function(changes, source) {
      if (source === 'edit') {
        updateExportButtons();
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
          previewScrapedRow(physicalRow);
        } else if (action === 'delete') {
          if (physicalRow >= 0 && physicalRow < state.data.length) {
            state.data.splice(physicalRow, 1);
            if (state.rawData && Array.isArray(state.rawData) && state.rawData.length > physicalRow) {
              state.rawData.splice(physicalRow, 1);
            }
            updateDataTable(state.data);
            updateExportButtons();
            $('#rowCount').text(state.data.length);
            saveScrapedData();
            showToast('Row deleted', 'info');
          }
        }
      }
    }
  });
}

export function updateDataTable(data) {
  if (!data || data.length === 0) {
    state.dataTable.loadData([]);
    return;
  }

  let headers = [];
  const seen = new Set();
  data.forEach(row => {
    if (row && typeof row === 'object') {
      Object.keys(row).forEach(key => {
        if (!seen.has(key)) {
          seen.add(key);
          headers.push(key);
        }
      });
    }
  });

  if (headers.length === 0) {
    console.warn('[DropshipTracker] No valid headers found in data');
    state.dataTable.loadData([]);
    return;
  }

  headers.push('Actions');

  const arrayData = data.map(row => {
    const rowData = headers.slice(0, -1).map(h => {
      const val = row[h];
      return val !== undefined && val !== null ? String(val) : '';
    });
    rowData.push('');
    return rowData;
  });

  const colWidths = headers.map((h) => {
    if (h === 'Actions') return 70;
    const headerLen = (h || '').length * 8;
    return Math.max(80, Math.min(200, headerLen + 20));
  });

  const columns = headers.map((h) => {
    if (h === 'Actions') {
      return {
        readOnly: true,
        renderer: function(instance, td, row, col, prop, value, cellProperties) {
          td.innerHTML = '<div class="row-actions">' +
            '<button class="btn btn-xs btn-default" data-action="preview" title="Preview">👁️</button>' +
            '<button class="btn btn-xs btn-danger" data-action="delete" title="Delete">🗑️</button>' +
            '</div>';
          return td;
        }
      };
    }
    return { readOnly: false };
  });

  state.dataTable.updateSettings({
    colHeaders: headers,
    data: arrayData,
    colWidths: colWidths,
    columns: columns
  });

  state.dataTable.render();

  console.log(`[DropshipTracker] Data table updated: ${data.length} rows, ${headers.length} columns`);
  console.log('[DropshipTracker] Headers:', headers.slice(0, 10), '... (total:', headers.length, ')');
}

export function updateExpandToggle() {
  const $toggle = $('#expandColumnsToggle');
  if (state.allFieldNames.length > MAX_VISIBLE_COLUMNS) {
    $toggle.show();
    $toggle.text(state.showAllColumns
      ? `Show Less (${MAX_VISIBLE_COLUMNS} columns)`
      : `Show All (${state.allFieldNames.length} columns)`
    );
  } else {
    $toggle.hide();
  }
}

export function toggleExpandColumns() {
  state.showAllColumns = !state.showAllColumns;
  // Import dynamically to avoid circular dependency at init time
  // processScrapedData is in scraper.js
  import('./scraper.js').then(({ processScrapedData }) => {
    processScrapedData(state.rawData);
  });
}
