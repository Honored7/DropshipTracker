/**
 * Google Drive Service
 * Handles OAuth authentication and file operations for Google Drive
 * Uses Chrome Identity API for secure token management
 */

const GoogleDriveService = (function() {
  "use strict";

  const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3';
  
  let accessToken = null;
  let folderId = null;

  /**
   * Check if user is authenticated
   */
  async function checkAuth() {
    return new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (chrome.runtime.lastError || !token) {
          accessToken = null;
          resolve(false);
        } else {
          accessToken = token;
          resolve(true);
        }
      });
    });
  }

  /**
   * Authorize with Google Drive
   */
  async function authorize() {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          console.error('Auth error:', chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        if (!token) {
          reject(new Error('No token received'));
          return;
        }
        
        accessToken = token;
        console.log('[GoogleDrive] Authorized successfully');
        resolve(true);
      });
    });
  }

  /**
   * Disconnect/revoke access
   */
  function disconnect() {
    if (accessToken) {
      chrome.identity.removeCachedAuthToken({ token: accessToken }, () => {
        accessToken = null;
        folderId = null;
        console.log('[GoogleDrive] Disconnected');
      });
    }
  }

  /**
   * Make authenticated API request
   */
  async function apiRequest(url, options = {}) {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        ...options.headers
      }
    });
    
    if (response.status === 401) {
      // Token expired, try to refresh
      accessToken = null;
      await authorize();
      return apiRequest(url, options);
    }
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }
    
    return response;
  }

  /**
   * Get or create the app folder in Google Drive
   */
  async function getAppFolder(folderName = 'DropshipTracker') {
    if (folderId) return folderId;
    
    // Search for existing folder
    const searchUrl = `${DRIVE_API_BASE}/files?` + new URLSearchParams({
      q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)'
    });
    
    const searchResponse = await apiRequest(searchUrl);
    const searchResult = await searchResponse.json();
    
    if (searchResult.files && searchResult.files.length > 0) {
      folderId = searchResult.files[0].id;
      console.log('[GoogleDrive] Found existing folder:', folderId);
      return folderId;
    }
    
    // Create new folder
    const createResponse = await apiRequest(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    
    const folder = await createResponse.json();
    folderId = folder.id;
    console.log('[GoogleDrive] Created new folder:', folderId);
    return folderId;
  }

  /**
   * Upload file to Google Drive
   * @param {string} content - File content
   * @param {string} filename - Name for the file
   * @param {string} mimeType - MIME type of the file
   * @returns {Object} Uploaded file metadata
   */
  async function uploadFile(content, filename, mimeType = 'text/plain') {
    const parentFolderId = await getAppFolder();
    
    // Check if file exists (to update instead of create duplicate)
    const existingFile = await findFile(filename, parentFolderId);
    
    if (existingFile) {
      // Update existing file
      return updateFile(existingFile.id, content, mimeType);
    }
    
    // Create new file with multipart upload
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    
    const metadata = {
      name: filename,
      mimeType: mimeType,
      parents: [parentFolderId]
    };
    
    const multipartBody = 
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${mimeType}\r\n\r\n` +
      content +
      closeDelimiter;
    
    const response = await apiRequest(
      `${UPLOAD_API_BASE}/files?uploadType=multipart&fields=id,name,webViewLink`, 
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
      }
    );
    
    const result = await response.json();
    console.log('[GoogleDrive] File uploaded:', result);
    return result;
  }

  /**
   * Update existing file content
   */
  async function updateFile(fileId, content, mimeType) {
    const response = await apiRequest(
      `${UPLOAD_API_BASE}/files/${fileId}?uploadType=media&fields=id,name,webViewLink`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': mimeType
        },
        body: content
      }
    );
    
    const result = await response.json();
    console.log('[GoogleDrive] File updated:', result);
    return result;
  }

  /**
   * Find file by name in folder
   */
  async function findFile(filename, parentFolderId) {
    const searchUrl = `${DRIVE_API_BASE}/files?` + new URLSearchParams({
      q: `name='${filename}' and '${parentFolderId}' in parents and trashed=false`,
      fields: 'files(id,name)'
    });
    
    const response = await apiRequest(searchUrl);
    const result = await response.json();
    
    return result.files && result.files.length > 0 ? result.files[0] : null;
  }

  /**
   * List files in app folder
   */
  async function listFiles() {
    const parentFolderId = await getAppFolder();
    
    const listUrl = `${DRIVE_API_BASE}/files?` + new URLSearchParams({
      q: `'${parentFolderId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
      orderBy: 'modifiedTime desc'
    });
    
    const response = await apiRequest(listUrl);
    const result = await response.json();
    
    return result.files || [];
  }

  /**
   * Download file content
   */
  async function downloadFile(fileId) {
    const response = await apiRequest(
      `${DRIVE_API_BASE}/files/${fileId}?alt=media`
    );
    
    return response.text();
  }

  /**
   * Delete file
   */
  async function deleteFile(fileId) {
    await apiRequest(`${DRIVE_API_BASE}/files/${fileId}`, {
      method: 'DELETE'
    });
    
    console.log('[GoogleDrive] File deleted:', fileId);
    return true;
  }

  /**
   * Get file metadata
   */
  async function getFileMetadata(fileId) {
    const response = await apiRequest(
      `${DRIVE_API_BASE}/files/${fileId}?fields=id,name,mimeType,modifiedTime,size,webViewLink`
    );
    
    return response.json();
  }

  /**
   * Create subfolder
   */
  async function createSubfolder(folderName, parentId = null) {
    const parent = parentId || await getAppFolder();
    
    const response = await apiRequest(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parent]
      })
    });
    
    return response.json();
  }

  // Public API
  return {
    checkAuth,
    authorize,
    disconnect,
    uploadFile,
    updateFile,
    findFile,
    listFiles,
    downloadFile,
    deleteFile,
    getFileMetadata,
    getAppFolder,
    createSubfolder
  };
})();

// Export for Node.js if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GoogleDriveService;
}
