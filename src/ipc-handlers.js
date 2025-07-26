const { ipcMain, shell } = require('electron');
const VideoScanner = require('./video-scanner');
const VideoDatabase = require('./database');
const ThumbnailGenerator = require('./thumbnail-gen');
const path = require('path');
const fs = require('fs').promises;

class IPCHandlers {
  constructor() {
    this.videoScanner = new VideoScanner();
    this.database = new VideoDatabase();
    this.thumbnailGenerator = null; // Will be initialized when needed
    this.isInitialized = false;
  }

  /**
   * Initialize all handlers
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      // Initialize database
      await this.database.initialize();
      
      // Initialize thumbnail generator
      this.thumbnailGenerator = new ThumbnailGenerator();
      
      this.isInitialized = true;
      console.log('IPC handlers initialized successfully');
    } catch (error) {
      console.error('Error initializing IPC handlers:', error);
      throw error;
    }
  }

  /**
   * Register all IPC handlers
   */
  registerHandlers() {
    // Video scanning handlers
    ipcMain.handle('scan-videos', this.handleScanVideos.bind(this));
    ipcMain.handle('get-scan-progress', this.handleGetScanProgress.bind(this));
    
    // Database handlers
    ipcMain.handle('get-videos', this.handleGetVideos.bind(this));
    ipcMain.handle('save-favorite', this.handleSaveFavorite.bind(this));
    ipcMain.handle('get-favorites', this.handleGetFavorites.bind(this));
    ipcMain.handle('save-hidden-file', this.handleSaveHiddenFile.bind(this));
    ipcMain.handle('get-hidden-files', this.handleGetHiddenFiles.bind(this));
    ipcMain.handle('get-folders', this.handleGetFolders.bind(this));
    ipcMain.handle('get-video-by-id', this.handleGetVideoById.bind(this));
    ipcMain.handle('get-db-stats', this.handleGetDbStats.bind(this));
    
    // Rating handlers
    ipcMain.handle('save-rating', this.handleSaveRating.bind(this));
    ipcMain.handle('get-rating', this.handleGetRating.bind(this));
    ipcMain.handle('remove-rating', this.handleRemoveRating.bind(this));
    ipcMain.handle('get-rated-videos', this.handleGetRatedVideos.bind(this));
    
    // Thumbnail handlers
    ipcMain.handle('generate-thumbnail', this.handleGenerateThumbnail.bind(this));
    ipcMain.handle('get-thumbnail', this.handleGetThumbnail.bind(this));
    
    // File operation handlers
    ipcMain.handle('get-video-metadata', this.handleGetVideoMetadata.bind(this));
    ipcMain.handle('validate-video-file', this.handleValidateVideoFile.bind(this));
    ipcMain.handle('show-item-in-folder', this.handleShowItemInFolder.bind(this));
    
    // Settings handlers
    ipcMain.handle('get-settings', this.handleGetSettings.bind(this));
    ipcMain.handle('save-settings', this.handleSaveSettings.bind(this));
    ipcMain.handle('get-last-folder', this.handleGetLastFolder.bind(this));
    ipcMain.handle('save-last-folder', this.handleSaveLastFolder.bind(this));
    ipcMain.handle('get-user-preferences', this.handleGetUserPreferences.bind(this));
    ipcMain.handle('save-user-preferences', this.handleSaveUserPreferences.bind(this));
  }

  /**
   * Handle video scanning
   */
  async handleScanVideos(event, folderPath) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Validate folder path
      if (!folderPath || !await this.isValidDirectory(folderPath)) {
        return { success: false, error: 'Invalid folder path' };
      }

      // Start scanning
      const result = await this.videoScanner.scanVideos(folderPath);
      
      if (result.success && result.videos.length > 0) {
        // Save videos to database
        const saved = this.database.addVideos(result.videos);
        if (!saved) {
          console.warn('Failed to save some videos to database');
        }
      }

      return result;
    } catch (error) {
      console.error('Error in scan-videos handler:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle getting scan progress
   */
  async handleGetScanProgress() {
    try {
      return this.videoScanner.getProgress();
    } catch (error) {
      console.error('Error getting scan progress:', error);
      return { isScanning: false, progress: 0, processedFiles: 0, totalFiles: 0 };
    }
  }

  /**
   * Handle getting videos with filters
   */
  async handleGetVideos(event, filters = {}) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return this.database.getVideos(filters);
    } catch (error) {
      console.error('Error getting videos:', error);
      return [];
    }
  }

  /**
   * Handle saving favorite
   */
  async handleSaveFavorite(event, videoId, isFavorite) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (isFavorite) {
        const result = this.database.addFavorite(videoId);
        return result;
      } else {
        const result = this.database.removeFavorite(videoId);
        return result;
      }
    } catch (error) {
      console.error('Error saving favorite:', error);
      return false;
    }
  }

  /**
   * Handle getting favorites
   */
  async handleGetFavorites() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return this.database.getFavorites();
    } catch (error) {
      console.error('Error getting favorites:', error);
      return [];
    }
  }

  /**
   * Handle saving hidden file
   */
  async handleSaveHiddenFile(event, videoId, isHidden) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (isHidden) {
        const result = this.database.addHiddenFile(videoId);
        return result;
      } else {
        const result = this.database.removeHiddenFile(videoId);
        return result;
      }
    } catch (error) {
      console.error('Error saving hidden file:', error);
      return false;
    }
  }

  /**
   * Handle getting hidden files
   */
  async handleGetHiddenFiles() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return this.database.getHiddenFiles();
    } catch (error) {
      console.error('Error getting hidden files:', error);
      return [];
    }
  }

  /**
   * Handle saving rating
   */
  async handleSaveRating(event, videoId, rating) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return this.database.saveRating(videoId, rating);
    } catch (error) {
      console.error('Error saving rating:', error);
      return false;
    }
  }

  /**
   * Handle getting rating
   */
  async handleGetRating(event, videoId) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return this.database.getRating(videoId);
    } catch (error) {
      console.error('Error getting rating:', error);
      return null;
    }
  }

  /**
   * Handle removing rating
   */
  async handleRemoveRating(event, videoId) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return this.database.removeRating(videoId);
    } catch (error) {
      console.error('Error removing rating:', error);
      return false;
    }
  }

  /**
   * Handle getting rated videos
   */
  async handleGetRatedVideos() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return this.database.getRatedVideos();
    } catch (error) {
      console.error('Error getting rated videos:', error);
      return [];
    }
  }

  /**
   * Handle getting folders
   */
  async handleGetFolders() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return this.database.getFolders();
    } catch (error) {
      console.error('Error getting folders:', error);
      return [];
    }
  }

  /**
   * Handle getting video by ID
   */
  async handleGetVideoById(event, videoId) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return this.database.getVideoById(videoId);
    } catch (error) {
      console.error('Error getting video by ID:', error);
      return null;
    }
  }

  /**
   * Handle getting database stats
   */
  async handleGetDbStats() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return this.database.getStats();
    } catch (error) {
      console.error('Error getting database stats:', error);
      return {
        totalVideos: 0,
        favoriteVideos: 0,
        totalFolders: 0,
        totalSize: 0
      };
    }
  }

  /**
   * Handle generating thumbnail
   */
  async handleGenerateThumbnail(event, videoPath, timestamp = null) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Validate video file
      if (!await this.isValidVideoFile(videoPath)) {
        return { success: false, error: 'Invalid video file' };
      }

      const result = await this.thumbnailGenerator.generateThumbnail(videoPath, timestamp);
      
      if (result.success) {
        // Save thumbnail info to database
        const videoId = this.videoScanner.generateVideoId(videoPath, { size: 0, lastModified: Date.now() });
        this.database.saveThumbnail(videoId, result.thumbnailPath, timestamp);
      }

      return result;
    } catch (error) {
      console.error('Error generating thumbnail:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle getting thumbnail
   */
  async handleGetThumbnail(event, videoId) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return this.database.getThumbnail(videoId);
    } catch (error) {
      console.error('Error getting thumbnail:', error);
      return null;
    }
  }

  /**
   * Handle getting video metadata
   */
  async handleGetVideoMetadata(event, filePath) {
    try {
      if (!await this.isValidVideoFile(filePath)) {
        return null;
      }

      return await this.videoScanner.getVideoMetadata(filePath);
    } catch (error) {
      console.error('Error getting video metadata:', error);
      return null;
    }
  }

  /**
   * Handle validating video file
   */
  async handleValidateVideoFile(event, filePath) {
    try {
      return await this.isValidVideoFile(filePath);
    } catch (error) {
      console.error('Error validating video file:', error);
      return false;
    }
  }

  /**
   * Handle getting settings
   */
  async handleGetSettings(event, key) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (key) {
        return this.database.getSetting(key);
      } else {
        // Return all settings
        return {
          gridColumns: this.database.getSetting('gridColumns', 4),
          sortBy: this.database.getSetting('sortBy', 'folder'),
          sortOrder: this.database.getSetting('sortOrder', 'ASC'),
          showFavoritesOnly: this.database.getSetting('showFavoritesOnly', false),
          selectedFolder: this.database.getSetting('selectedFolder', ''),
          theme: this.database.getSetting('theme', 'dark')
        };
      }
    } catch (error) {
      console.error('Error getting settings:', error);
      return null;
    }
  }

  /**
   * Handle saving settings
   */
  async handleSaveSettings(event, key, value) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (typeof key === 'object') {
        // Save multiple settings
        for (const [k, v] of Object.entries(key)) {
          this.database.saveSetting(k, v);
        }
        return true;
      } else {
        // Save single setting
        return this.database.saveSetting(key, value);
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      return false;
    }
  }

  /**
   * Handle getting last folder
   */
  async handleGetLastFolder() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return this.database.getLastFolder();
    } catch (error) {
      console.error('Error getting last folder:', error);
      return null;
    }
  }

  /**
   * Handle saving last folder
   */
  async handleSaveLastFolder(event, folderPath) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return this.database.saveLastFolder(folderPath);
    } catch (error) {
      console.error('Error saving last folder:', error);
      return false;
    }
  }

  /**
   * Handle getting user preferences
   */
  async handleGetUserPreferences() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return {
        lastFolder: this.database.getLastFolder(),
        gridColumns: this.database.getGridColumns(),
        sortPreference: this.database.getSortPreference(),
        folderFilter: this.database.getFolderFilter(),
        favoritesOnly: this.database.getFavoritesOnly(),
        windowState: this.database.getWindowState()
      };
    } catch (error) {
      console.error('Error getting user preferences:', error);
      return {
        lastFolder: null,
        gridColumns: 4,
        sortPreference: { sortBy: 'folder', sortOrder: 'ASC' },
        folderFilter: '',
        favoritesOnly: false,
        windowState: { width: 1400, height: 900, x: null, y: null }
      };
    }
  }

  /**
   * Handle saving user preferences
   */
  async handleSaveUserPreferences(event, preferences) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const {
        lastFolder,
        gridColumns,
        sortPreference,
        folderFilter,
        favoritesOnly,
        windowState
      } = preferences;

      if (lastFolder !== undefined) {
        this.database.saveLastFolder(lastFolder);
      }
      if (gridColumns !== undefined) {
        this.database.saveGridColumns(gridColumns);
      }
      if (sortPreference !== undefined) {
        this.database.saveSortPreference(sortPreference.sortBy, sortPreference.sortOrder);
      }
      if (folderFilter !== undefined) {
        this.database.saveFolderFilter(folderFilter);
      }
      if (favoritesOnly !== undefined) {
        this.database.saveFavoritesOnly(favoritesOnly);
      }
      if (windowState !== undefined) {
        this.database.saveWindowState(windowState.width, windowState.height, windowState.x, windowState.y);
      }

      return true;
    } catch (error) {
      console.error('Error saving user preferences:', error);
      return false;
    }
  }

  /**
   * Validate if path is a valid directory
   */
  async isValidDirectory(dirPath) {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate if path is a valid video file
   */
  async isValidVideoFile(filePath) {
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) return false;
      
      return this.videoScanner.isValidVideoFile(path.basename(filePath));
    } catch (error) {
      return false;
    }
  }

  /**
   * Handle showing item in folder
   */
  async handleShowItemInFolder(event, filePath) {
    try {
      // Verify the file exists
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        console.error('File not found:', filePath);
        return false;
      }
      
      // Show the item in the file explorer
      shell.showItemInFolder(filePath);
      return true;
    } catch (error) {
      console.error('Error showing item in folder:', error);
      return false;
    }
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.database) {
      this.database.close();
    }
    if (this.thumbnailGenerator) {
      this.thumbnailGenerator.cleanup();
    }
  }
}

module.exports = IPCHandlers;
