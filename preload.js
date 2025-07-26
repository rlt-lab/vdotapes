const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Folder selection
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  
  // App information
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppName: () => ipcRenderer.invoke('get-app-name'),
  
  // Video scanning
  scanVideos: (folderPath) => ipcRenderer.invoke('scan-videos', folderPath),
  getScanProgress: () => ipcRenderer.invoke('get-scan-progress'),
  
  // Database operations
  getVideos: (filters) => ipcRenderer.invoke('get-videos', filters),
  saveFavorite: (videoId, isFavorite) => ipcRenderer.invoke('save-favorite', videoId, isFavorite),
  getFavorites: () => ipcRenderer.invoke('get-favorites'),
  saveHiddenFile: (videoId, isHidden) => ipcRenderer.invoke('save-hidden-file', videoId, isHidden),
  getHiddenFiles: () => ipcRenderer.invoke('get-hidden-files'),
  
  // Rating operations
  saveRating: (videoId, rating) => ipcRenderer.invoke('save-rating', videoId, rating),
  getRating: (videoId) => ipcRenderer.invoke('get-rating', videoId),
  removeRating: (videoId) => ipcRenderer.invoke('remove-rating', videoId),
  getRatedVideos: () => ipcRenderer.invoke('get-rated-videos'),
  
  // Thumbnail operations
  generateThumbnail: (videoPath, timestamp) => ipcRenderer.invoke('generate-thumbnail', videoPath, timestamp),
  getThumbnail: (videoId) => ipcRenderer.invoke('get-thumbnail', videoId),
  
  // File operations
  getVideoMetadata: (filePath) => ipcRenderer.invoke('get-video-metadata', filePath),
  validateVideoFile: (filePath) => ipcRenderer.invoke('validate-video-file', filePath),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  
  // Enhanced settings
  getLastFolder: () => ipcRenderer.invoke('get-last-folder'),
  saveLastFolder: (folderPath) => ipcRenderer.invoke('save-last-folder', folderPath),
  getUserPreferences: () => ipcRenderer.invoke('get-user-preferences'),
  saveUserPreferences: (preferences) => ipcRenderer.invoke('save-user-preferences', preferences),
  
  // Progress and status
  onScanProgress: (callback) => {
    ipcRenderer.on('scan-progress', (event, data) => callback(data));
  },
  onScanComplete: (callback) => {
    ipcRenderer.on('scan-complete', (event, data) => callback(data));
  },
  onError: (callback) => {
    ipcRenderer.on('error', (event, error) => callback(error));
  },
  
  // Remove listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

// Security: Prevent access to Node.js APIs
window.addEventListener('DOMContentLoaded', () => {
  // Remove Node.js globals from window
  delete window.require;
  delete window.exports;
  delete window.module;
  delete window.global;
  delete window.process;
  
  // Override console methods to prevent potential security issues
  const originalConsole = { ...console };
  console.log = (...args) => {
    // Only allow safe logging
    originalConsole.log('[Renderer]', ...args);
  };
  
  console.warn = (...args) => {
    originalConsole.warn('[Renderer]', ...args);
  };
  
  console.error = (...args) => {
    originalConsole.error('[Renderer]', ...args);
  };
});

// Handle unload to clean up listeners
window.addEventListener('beforeunload', () => {
  // Clean up any remaining listeners
  ipcRenderer.removeAllListeners('scan-progress');
  ipcRenderer.removeAllListeners('scan-complete');
  ipcRenderer.removeAllListeners('error');
});
