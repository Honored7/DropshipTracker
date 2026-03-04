/**
 * Popup state singleton and constants
 */

export const MAX_VISIBLE_COLUMNS = 40;
export const FIELD_THRESHOLD = 0.10;
export const MAX_COLUMNS_EXPANDED = 100;

export const state = {
  tabId: null,
  tabUrl: null,
  tabDomain: null,
  tabRestricted: false,   // true for chrome://, about:, devtools://, etc.

  // Scraper state
  data: [],
  rawData: [],
  fieldNames: [],
  allFieldNames: [],
  fieldMapping: {},
  customSelectors: {},
  showAllColumns: false,
  tableSelector: null,
  nextSelector: null,
  scraping: false,
  pages: 0,

  // Pagination
  visitedHashes: [],

  // Catalog
  catalog: [],
  selectedProducts: [],

  // Settings
  settings: null,

  // Suppliers
  suppliers: [],

  // Handsontable instances
  dataTable: null,
  catalogTable: null,

  // Preview context
  previewContext: null,

  // Smart column name mapping cache
  smartNames: null
};
