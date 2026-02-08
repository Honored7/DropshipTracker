/**
 * Export functions – XML/CSV export, clipboard copy, XLSX download
 */
/* global $, CSCartMapper, CSCartXMLBuilder, CartTemplateRegistry, XLSX */

import { state } from './state.js';
import { showToast, downloadFile, s2ab, parsePrice, calculateSellingPrice, getShortFieldName } from './utils.js';

export function exportCSCart(format) {
  if (state.data.length === 0) {
    showToast('No data to export', 'warning');
    return;
  }

  const templateId = $('#cartTemplateSelect').val() || 'cscart';
  const template = typeof CartTemplateRegistry !== 'undefined' ? CartTemplateRegistry.get(templateId) : null;

  if (format === 'xml') {
    if (template && !CartTemplateRegistry.supportsXML(templateId)) {
      showToast(template.name + ' does not support XML export. Use CSV instead.', 'warning');
      return;
    }
    const products = mapToCSCart(state.data, state.rawData);
    const xml = template && template.toXML
      ? template.toXML(products, state.settings)
      : CSCartXMLBuilder.build(products, state.settings);
    downloadFile(xml, templateId + '-products.xml', 'application/xml');
    showToast(template ? template.name + ' XML exported' : 'XML exported', 'success');
  } else {
    if (template && template.mapProduct && template.toCSV) {
      const mapped = mapToCSCart(state.data, state.rawData);
      const templateProducts = mapped.map(p => template.mapProduct(p, state.settings));
      const csv = template.toCSV(templateProducts, state.settings);
      downloadFile(csv, templateId + '-products.csv', 'text/csv');
      showToast(template.name + ' CSV exported', 'success');
    } else {
      const products = mapToCSCart(state.data, state.rawData);
      const csv = CSCartMapper.toCSV(products);
      downloadFile(csv, 'cscart-products.csv', 'text/csv');
      showToast('CS-Cart CSV exported', 'success');
    }
  }
}

export function exportCatalog(format) {
  const selected = state.selectedProducts.length > 0
    ? state.catalog.filter(p => state.selectedProducts.includes(p.productCode))
    : state.catalog;

  if (selected.length === 0) {
    showToast('No products to export', 'warning');
    return;
  }

  const templateId = $('#cartTemplateSelect').val() || 'cscart';
  const template = typeof CartTemplateRegistry !== 'undefined' ? CartTemplateRegistry.get(templateId) : null;
  const products = selected.map(p => CSCartMapper.fromCatalog(p, state.settings));

  if (format === 'xml') {
    if (template && !CartTemplateRegistry.supportsXML(templateId)) {
      showToast(template.name + ' does not support XML export. Use CSV instead.', 'warning');
      return;
    }
    const xml = template && template.toXML
      ? template.toXML(products, state.settings)
      : CSCartXMLBuilder.build(products, state.settings);
    downloadFile(xml, templateId + '-catalog.xml', 'application/xml');
  } else {
    if (template && template.mapProduct && template.toCSV) {
      const templateProducts = products.map(p => template.mapProduct(p, state.settings));
      const csv = template.toCSV(templateProducts, state.settings);
      downloadFile(csv, templateId + '-catalog.csv', 'text/csv');
    } else {
      const csv = CSCartMapper.toCSV(products);
      downloadFile(csv, 'cscart-catalog.csv', 'text/csv');
    }
  }

  showToast(`Exported ${selected.length} products as ${template ? template.name : 'CS-Cart'} ${format.toUpperCase()}`, 'success');
}

export function mapToCSCart(data, rawData) {
  return data.map((row, index) => {
    const raw = rawData[index] || {};
    const smartNames = state.smartNames || {};

    const getMappedValue = (exportField) => {
      for (const [sourceField, mappedTo] of Object.entries(state.fieldMapping)) {
        if (mappedTo === exportField) {
          const displayName = smartNames[sourceField] || getShortFieldName(sourceField);
          return row[displayName] || raw[sourceField] || '';
        }
      }
      return '';
    };

    const supplierPrice = CSCartMapper.parsePrice(getMappedValue('price') || raw.Price);
    const shippingCostValue = CSCartMapper.parsePrice(getMappedValue('shipping_cost') || raw['Shipping Cost'] || '');

    const variantsRaw = getMappedValue('variants') || raw.Variants || '';
    let variants = [];
    try { variants = typeof variantsRaw === 'string' ? JSON.parse(variantsRaw) : variantsRaw; } catch(e) {}
    const optionsStr = Array.isArray(variants) && variants.length > 0
      ? CSCartXMLBuilder.buildOptions(variants, '', state.settings?.cscartDelimiter || '///')
      : '';

    const productName = getMappedValue('product_name') || raw.Title || 'Untitled';

    return {
      product_code: getMappedValue('product_code') || raw._supplierProductId || `PROD-${Date.now()}-${index}`,
      product_name: productName,
      price: calculateSellingPrice(parseFloat(supplierPrice), parseFloat(shippingCostValue)),
      list_price: CSCartMapper.parsePrice(getMappedValue('list_price') || raw['Original Price'] || ''),
      quantity: parseInt(getMappedValue('quantity')) || 999,
      category: getMappedValue('category') || raw.Category || state.settings?.defaultCategory || 'Products',
      description: getMappedValue('description') || raw.Description || '',
      short_description: getMappedValue('short_description') || raw['Short Description'] || CSCartMapper.extractShortDescription(getMappedValue('description') || raw.Description || ''),
      images: getMappedValue('images') || raw.Images || '',
      weight: parseFloat(getMappedValue('weight')) || 0,
      status: state.settings?.defaultStatus || 'A',
      language: state.settings?.defaultLanguage || 'en',
      brand: getMappedValue('brand') || raw.Brand || '',
      rating: getMappedValue('rating') || raw.Rating || '',
      review_count: getMappedValue('review_count') || raw['Review Count'] || '',
      reviews: raw.reviews || '',
      options: optionsStr,
      meta_keywords: getMappedValue('meta_keywords') || CSCartMapper.extractKeywords(productName),
      meta_description: getMappedValue('meta_description') || CSCartMapper.truncate(productName, 160),
      shipping_freight: shippingCostValue || '',
      supplier_url: getMappedValue('url') || raw.URL || state.tabUrl,
      supplier_price: supplierPrice
    };
  });
}

export function copyToClipboard() {
  const data = state.dataTable.getData();
  const headers = state.dataTable.getColHeader();

  const tsv = [headers.join('\t')]
    .concat(data.map(row => row.join('\t')))
    .join('\n');

  navigator.clipboard.writeText(tsv).then(() => {
    showToast('Copied to clipboard', 'success');
  });
}

export function downloadRawXlsx() {
  const data = state.dataTable.getData();
  const headers = state.dataTable.getColHeader();

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');

  const wbout = XLSX.write(wb, { type: 'binary', bookType: 'xlsx' });
  const blob = new Blob([s2ab(wbout)], { type: 'application/octet-stream' });

  saveAs(blob, 'scraped-data.xlsx');
  showToast('XLSX downloaded', 'success');
}
