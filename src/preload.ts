import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

import type { ScanResult } from '../types/core';
import type { ElectronAPI, ScanProgressData } from '../types/ipc';

// Extend Window interface for Node.js globals cleanup
declare global {
  interface Window {
    require?: unknown;
    exports?: unknown;
    module?: unknown;
    global?: unknown;
    process?: unknown;
  }
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
const electronAPI: ElectronAPI = {
  // Folder selection
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // App information
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppName: () => ipcRenderer.invoke('get-app-name'),

  // Video scanning
  scanVideos: (folderPath: string) => ipcRenderer.invoke('scan-videos', folderPath),
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
  generateThumbnail: (videoPath, timestamp) =>
    ipcRenderer.invoke('generate-thumbnail', videoPath, timestamp),
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

  // Tags
  addTag: (videoId, tagName) => ipcRenderer.invoke('tags-add', videoId, tagName),
  removeTag: (videoId, tagName) => ipcRenderer.invoke('tags-remove', videoId, tagName),
  listTags: (videoId) => ipcRenderer.invoke('tags-list', videoId),
  listAllTags: () => ipcRenderer.invoke('tags-all'),
  searchByTag: (query) => ipcRenderer.invoke('tags-search', query),
  getAllVideoTags: () => ipcRenderer.invoke('get-all-video-tags'),

  // Backup
  exportBackup: () => ipcRenderer.invoke('backup-export'),
  importBackup: (backup) => ipcRenderer.invoke('backup-import', backup),
  exportBackupToFile: () => ipcRenderer.invoke('backup-export-file'),
  importBackupFromFile: () => ipcRenderer.invoke('backup-import-file'),

  // Progress and status
  onScanProgress: (callback) => {
    ipcRenderer.on('scan-progress', (_event: IpcRendererEvent, data: ScanProgressData) => callback(data));
  },
  onScanComplete: (callback) => {
    ipcRenderer.on('scan-complete', (_event: IpcRendererEvent, data: ScanResult) => callback(data));
  },
  onError: (callback) => {
    ipcRenderer.on('error', (_event: IpcRendererEvent, error: { message: string; code?: string }) => callback(error));
  },

  // Remove listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Security: Prevent access to Node.js APIs
window.addEventListener('DOMContentLoaded', () => {
  // Remove Node.js globals from window
  delete (window as unknown as Record<string, unknown>).require;
  delete (window as unknown as Record<string, unknown>).exports;
  delete (window as unknown as Record<string, unknown>).module;
  delete (window as unknown as Record<string, unknown>).global;
  delete (window as unknown as Record<string, unknown>).process;

  // Override console methods to prevent potential security issues
  const originalConsole = { ...console };
  console.log = (...args: unknown[]) => {
    // Only allow safe logging
    originalConsole.log('[Renderer]', ...args);
  };

  console.warn = (...args: unknown[]) => {
    originalConsole.warn('[Renderer]', ...args);
  };

  console.error = (...args: unknown[]) => {
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
