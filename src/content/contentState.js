/**
 * Content script shared mutable state
 */

export const contentState = {
  detectedTables: [],
  currentTableIndex: 0,
  nextButtonSelector: null,
  customSelectors: {},
  selectorPickerActive: false,
  selectorPickerCallback: null,
  selectorPickerField: null
};
