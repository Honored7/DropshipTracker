# DropshipTracker - CS-Cart Product Sync

A powerful Chrome extension for dropshipping that scrapes products from any supplier website, manages your product catalog, and exports to CS-Cart XML/CSV format with Google Drive synchronization.

## Features

### 🔍 Universal Web Scraper
- **Auto-detect data tables** on any website using intelligent scoring algorithm
- **Site-specific enhancements** for AliExpress and Alibaba
- **Pagination support** - Crawl multiple pages automatically
- **Single product extraction** for detailed product pages

### 📦 Product Catalog Management
- **Store products locally** with full tracking
- **Price history** - Track supplier price changes over time
- **Stock monitoring** - Get alerts for low stock
- **Supplier management** - Organize products by supplier

### 🔄 CS-Cart Integration
- **XML export** - Full CS-Cart compatible format with:
  - Product codes (using supplier IDs for easy tracking)
  - Categories with hierarchy support (`///` delimiter)
  - Variants/Options with price modifiers
  - Multiple images
  - Full HTML descriptions (CDATA wrapped)
- **CSV export** - Standard CS-Cart import format
- **Field mapping** - Map scraped data to CS-Cart fields

### ☁️ Google Drive Sync
- **Automatic backup** of catalog and exports
- **Organized folders** by date/supplier
- **OAuth 2.0** secure authentication

### 💰 Pricing Tools
- **Margin calculator** - Set default markup (% or fixed)
- **Price rounding** - Round to x.99, x.95, etc.
- **Multi-currency** support

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `DropshipTracker` folder

### Google Drive Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable the Google Drive API
4. Create OAuth 2.0 credentials:
   - Application type: Chrome Extension
   - Add your extension ID (find it in `chrome://extensions/`)
5. Copy the Client ID
6. Edit `manifest.json` and replace `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com` with your Client ID

## Usage

### Basic Scraping

1. Navigate to a supplier website (AliExpress, Alibaba, or any site)
2. Click the DropshipTracker extension icon
3. Click **"Find Tables"** to detect data on the page
4. Use **"Next Table"** to cycle through detected tables
5. Review data in the preview table
6. Map fields to CS-Cart format
7. Click **"Add to Catalog"** or **"Export"**

### Pagination/Crawling

1. After finding a table, click **"Locate"** next to "Next Button"
2. Click on the pagination "Next" button on the webpage
3. Click **"Crawl"** to start automatic pagination
4. Click **"Stop"** when done

### Single Product Extraction

1. Navigate to a product detail page
2. Click **"Extract Product"**
3. Review and map the extracted data
4. Add to catalog or export

### Catalog Management

1. Switch to the **Catalog** tab
2. View all saved products
3. Edit selling prices inline
4. Select products for export
5. Filter by price changes, low stock, etc.

### Exporting to CS-Cart

1. Select products in Catalog (or use scraped data)
2. Click **"Export CS-Cart XML"** or **"Export CSV"**
3. Import the file in CS-Cart Admin → Products → Import

## CS-Cart Import Format

The extension generates XML/CSV compatible with CS-Cart's import format:

### Required Fields
- `Product code` - Uses supplier product ID for tracking
- `Language` - Default: `en`
- `Product name`
- `Price`

### Supported Fields
- `List price` (MSRP)
- `Quantity` (stock)
- `Category` (with `///` hierarchy delimiter)
- `Description` (HTML, CDATA wrapped in XML)
- `Short description`
- `Images` (multiple, `///` separated)
- `Weight`
- `Status` (A=Active, H=Hidden, D=Disabled)
- `Features` (Brand, etc.)

### Example XML Output
```xml
<?xml version="1.0" encoding="UTF-8"?>
<data>
  <products>
    <product>
      <product_code>1005006543210</product_code>
      <language>en</language>
      <product>Wireless Bluetooth Headphones</product>
      <price>49.99</price>
      <list_price>79.99</list_price>
      <status>A</status>
      <quantity>100</quantity>
      <category>Electronics///Audio///Headphones</category>
      <description><![CDATA[<p>High quality wireless headphones...</p>]]></description>
      <images>https://img.../1.jpg///https://img.../2.jpg</images>
    </product>
  </products>
</data>
```

## Settings

### Pricing
- **Default Margin**: Percentage or fixed amount to add
- **Round Prices**: Enable/disable and set rounding target

### CS-Cart
- **Default Language**: Two-letter code (en, de, fr, etc.)
- **Field Delimiter**: Default `///`
- **Default Status**: A (Active), H (Hidden), D (Disabled)
- **Default Category**: Fallback if none detected

### Google Drive
- **Folder Name**: Where to store exports
- **Auto Sync**: Enable periodic backup
- **Sync Interval**: How often to sync (1-24 hours)

## File Structure

```
DropshipTracker/
├── manifest.json        # Extension configuration
├── background.js        # Service worker (alarms, storage)
├── popup.html          # Main UI
├── popup.js            # UI logic
├── popup.css           # Styles
├── onload.js           # Content script (scraping)
├── onload.css          # Content script styles
├── services/
│   ├── cscartMapper.js      # Data transformation
│   ├── xmlBuilder.js        # XML generation
│   └── googleDriveService.js # Drive API
├── js/                 # Libraries (jQuery, Handsontable, etc.)
├── css/                # Bootstrap, Handsontable styles
└── icons/              # Extension icons
```

## Troubleshooting

### "No tables found"
- The page may use dynamic loading. Wait for content to fully load.
- Try "Extract Product" for single product pages.
- Some sites heavily obfuscate their HTML structure.

### Google Drive not connecting
- Verify your Client ID is correct in manifest.json
- Make sure your extension ID is added to OAuth credentials
- Try disconnecting and reconnecting

### Export not importing to CS-Cart
- Check encoding is UTF-8
- Verify required fields (Product code, Language, Name, Price)
- Check category delimiter matches your CS-Cart settings

## License

MIT License - Use freely for personal and commercial projects.

## Support

For issues and feature requests, please open an issue on GitHub.
