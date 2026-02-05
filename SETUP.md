# DropshipTracker Setup Guide

## Step 1: Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the `DropshipTracker` folder
5. Note your **Extension ID** (shown under the extension name, e.g., `abcdefghijklmnopqrstuvwxyz123456`)

## Step 2: Set Up Google Drive OAuth (Required for Drive sync)

### Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **"Select a project"** → **"New Project"**
3. Name it "DropshipTracker" and click **Create**

### Enable Google Drive API

1. In the sidebar, go to **APIs & Services** → **Library**
2. Search for **"Google Drive API"**
3. Click on it and click **"Enable"**

### Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **"Create Credentials"** → **"OAuth client ID"**
3. If prompted, configure the **OAuth consent screen**:
   - Choose **External** (or Internal if using Google Workspace)
   - Fill in app name: "DropshipTracker"
   - Add your email as developer contact
   - Click **Save and Continue** through the steps
4. Back in Credentials, click **"Create Credentials"** → **"OAuth client ID"**
5. Application type: **Chrome Extension**
6. Name: "DropshipTracker"
7. **Item ID**: Paste your Extension ID from Step 1
8. Click **Create**
9. Copy the **Client ID** (looks like `123456789-abcdefg.apps.googleusercontent.com`)

### Update Extension with Client ID

1. Open `DropshipTracker/manifest.json` in a text editor
2. Find this line:
   ```json
   "client_id": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
   ```
3. Replace `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com` with your actual Client ID
4. Save the file

### Reload Extension

1. Go back to `chrome://extensions/`
2. Click the **refresh icon** on the DropshipTracker extension
3. The extension is now ready to use with Google Drive!

## Step 3: Using the Extension

### Basic Usage

1. Navigate to any supplier website (AliExpress, Alibaba, Amazon, etc.)
2. Click the **DropshipTracker icon** in your browser toolbar
3. A popup window will open

### Scraping Products

**For product listings/search results:**
1. Click **"Find Tables"** to detect data tables
2. Use **"Next Table"** if needed to select the right table
3. Review the data preview
4. Map fields to CS-Cart format using the dropdowns
5. Click **"Add to Catalog"** to save, or export directly

**For single product pages:**
1. Click **"Extract Product"** to get detailed product info
2. Review and map fields
3. Add to catalog or export

### Exporting to CS-Cart

1. Go to the **Catalog** tab to see all saved products
2. Select products you want to export (or export all)
3. Click **"Export CS-Cart XML"** or **"Export CSV"**
4. In CS-Cart admin: **Products** → **Import** → Upload the file

### Google Drive Sync

1. Go to **Settings** tab
2. Click **"Connect Google Drive"**
3. Authorize in the popup window
4. Your exports will now sync to a "DropshipTracker" folder in Drive

## Troubleshooting

### Extension won't load
- Make sure Developer mode is enabled
- Check for errors in `chrome://extensions/`

### Google Drive won't connect
- Verify your Client ID is correctly entered in manifest.json
- Make sure your Extension ID matches the one in Google Cloud Console
- Try removing and re-loading the extension

### No data found when scraping
- Wait for the page to fully load before clicking "Find Tables"
- Try "Extract Product" for single product pages
- Some websites use complex structures that may not be detected

### Export not working in CS-Cart
- Check that encoding is UTF-8
- Verify Product code, Language, Name, and Price are all present
- Check CS-Cart import settings match (delimiter: `///`)

## Support

For issues, please check the README.md file or create an issue on GitHub.
