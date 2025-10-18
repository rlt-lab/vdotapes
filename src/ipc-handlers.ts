import { promises as fs } from 'fs';
import * as path from 'path';

import { ipcMain, shell, dialog, IpcMainInvokeEvent } from 'electron';

import type {
  VideoId,
  VideoRecord,
  VideoFilters,
  Rating,
  ScanResult,
  BackupData,
} from '../types/core';
import type { DatabaseStats, VideoTableRow } from '../types/database';
import { IPCError } from '../types/errors';

import VideoDatabase from './database/VideoDatabase';
import VideoScanner from './video-scanner';
import ThumbnailGenerator from './thumbnail-gen';
import FolderMetadataManager from './folder-metadata';

interface UserPreferences {
  readonly lastFolder?: string | null;
  readonly gridColumns?: number;
  readonly sortPreference?: {
    readonly sortBy: string;
    readonly sortOrder: string;
  };
  readonly folderFilter?: string;
  readonly favoritesOnly?: boolean;
  readonly windowState?: {
    readonly width: number;
    readonly height: number;
    readonly x: number | null;
    readonly y: number | null;
  };
}

interface AppSettings {
  readonly gridColumns: number;
  readonly sortBy: string;
  readonly sortOrder: string;
  readonly showFavoritesOnly: boolean;
  readonly selectedFolder: string;
  readonly theme: string;
}

interface ThumbnailResult {
  readonly success: boolean;
  readonly thumbnailPath?: string;
  readonly error?: string;
}

interface BackupExportResult {
  readonly success: boolean;
  readonly path?: string;
  readonly count?: number;
  readonly error?: string;
}

interface BackupResult {
  readonly version: number;
  readonly exportedAt: string;
  readonly items: Array<{
    path: string;
    favorite: boolean;
    hidden: boolean;
    rating: number;
    tags: string[];
  }>;
}

interface ImportResult {
  readonly imported: number;
  readonly skipped: number;
  readonly errors: number;
}

interface BackupImportResult {
  readonly success: boolean;
  readonly path?: string;
  readonly imported?: number;
  readonly skipped?: number;
  readonly errors?: number;
  readonly error?: string;
}

class IPCHandlers {
  private videoScanner: VideoScanner;
  private database: VideoDatabase;
  private thumbnailGenerator: any | null = null;
  private folderMetadata: FolderMetadataManager;
  private isInitialized = false;

  constructor() {
    this.videoScanner = new VideoScanner();
    this.database = new VideoDatabase();
    this.folderMetadata = new FolderMetadataManager();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.database.initialize();
      this.thumbnailGenerator = new ThumbnailGenerator();
      this.isInitialized = true;
      console.log('IPC handlers initialized successfully');
    } catch (error) {
      console.error('Error initializing IPC handlers:', error);
      throw new IPCError('Failed to initialize IPC handlers', 'initialization', 'unknown');
    }
  }

  registerHandlers(): void {
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

    // Tagging handlers
    ipcMain.handle('tags-add', this.handleTagsAdd.bind(this));
    ipcMain.handle('tags-remove', this.handleTagsRemove.bind(this));
    ipcMain.handle('tags-list', this.handleTagsList.bind(this));
    ipcMain.handle('tags-all', this.handleTagsAll.bind(this));
    ipcMain.handle('tags-search', this.handleTagsSearch.bind(this));

    // Backup/Restore handlers
    ipcMain.handle('backup-export', this.handleBackupExport.bind(this));
    ipcMain.handle('backup-import', this.handleBackupImport.bind(this));
    ipcMain.handle('backup-export-file', this.handleBackupExportFile.bind(this));
    ipcMain.handle('backup-import-file', this.handleBackupImportFile.bind(this));
  }

  async handleScanVideos(_event: IpcMainInvokeEvent, folderPath: string): Promise<ScanResult> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (!folderPath || !(await this.isValidDirectory(folderPath))) {
        return { success: false, error: 'Invalid folder path', videos: [], folders: [] };
      }

      // Check if we're scanning a different folder than before
      const lastFolder = this.database.getLastFolder();
      const isNewFolder = lastFolder !== folderPath;

      if (isNewFolder && lastFolder) {
        console.log(`[VideoScanner] Switching from ${lastFolder} to ${folderPath}, clearing old videos...`);
        // Clear videos from the old folder before scanning the new one
        this.clearVideosFromFolder(lastFolder);
      } else if (!isNewFolder && lastFolder) {
        // Same folder - clear existing videos to avoid duplicates
        console.log(`[VideoScanner] Re-scanning ${folderPath}, clearing existing videos...`);
        this.clearVideosFromFolder(lastFolder);
      }

      // Initialize folder metadata (load existing or create new)
      await this.folderMetadata.initializeFolder(folderPath);
      const stats = this.folderMetadata.getStats();
      if (stats) {
        console.log(`[IPC] Folder metadata: ${stats.favoritesCount} favorites, ${stats.hiddenCount} hidden`);
      }
      
      const result = await this.videoScanner.scanVideos(folderPath);

      if (result.success && result.videos.length > 0) {
        const saved = this.database.addVideos(result.videos as any[]);
        if (!saved) {
          console.warn('Failed to save some videos to database');
        }

        // Save the new folder as the last scanned folder
        this.database.saveLastFolder(folderPath);
      }

      return result;
    } catch (error) {
      console.error('Error in scan-videos handler:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        videos: [],
        folders: [],
      };
    }
  }

  /**
   * Clear all videos from a specific folder path
   */
  private clearVideosFromFolder(folderPath: string): void {
    try {
      const db = this.database['core'].getConnection();

      // Get all videos from the old folder
      const videosToDelete = db.prepare(`
        SELECT id FROM videos WHERE path LIKE ?
      `).all(`${folderPath}%`) as Array<{ id: string }>;

      if (videosToDelete.length === 0) {
        console.log('[VideoScanner] No videos to clear from old folder');
        return;
      }

      console.log(`[VideoScanner] Clearing ${videosToDelete.length} videos from old folder`);

      // Delete each video (this will cascade to favorites, ratings, tags, etc.)
      const deleteStmt = db.prepare('DELETE FROM videos WHERE id = ?');
      const deleteTransaction = db.transaction((ids: string[]) => {
        for (const id of ids) {
          deleteStmt.run(id);
        }
      });

      deleteTransaction(videosToDelete.map(v => v.id));
      console.log('[VideoScanner] Successfully cleared old videos');
    } catch (error) {
      console.error('Error clearing videos from old folder:', error);
    }
  }

  async handleGetScanProgress(): Promise<{
    isScanning: boolean;
    progress: number;
    processedFiles: number;
    totalFiles: number;
    totalVideos: number;
  }> {
    try {
      return this.videoScanner.getProgress();
    } catch (error) {
      console.error('Error getting scan progress:', error);
      return { isScanning: false, progress: 0, processedFiles: 0, totalFiles: 0, totalVideos: 0 };
    }
  }

  async handleGetVideos(
    _event: IpcMainInvokeEvent,
    filters: VideoFilters = {}
  ): Promise<VideoRecord[]> {
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

  async handleSaveFavorite(
    _event: IpcMainInvokeEvent,
    videoId: VideoId,
    isFavorite: boolean
  ): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Use per-folder metadata instead of database
      if (isFavorite) {
        return await this.folderMetadata.addFavorite(videoId);
      } else {
        return await this.folderMetadata.removeFavorite(videoId);
      }
    } catch (error) {
      console.error('Error saving favorite:', error);
      return false;
    }
  }

  async handleGetFavorites(): Promise<VideoId[]> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Use per-folder metadata instead of database
      return this.folderMetadata.getFavorites();
    } catch (error) {
      console.error('Error getting favorites:', error);
      return [];
    }
  }

  async handleSaveHiddenFile(
    _event: IpcMainInvokeEvent,
    videoId: VideoId,
    isHidden: boolean
  ): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Use per-folder metadata instead of database
      if (isHidden) {
        return await this.folderMetadata.addHidden(videoId);
      } else {
        return await this.folderMetadata.removeHidden(videoId);
      }
    } catch (error) {
      console.error('Error saving hidden file:', error);
      return false;
    }
  }

  async handleGetHiddenFiles(): Promise<VideoId[]> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Use per-folder metadata instead of database
      return this.folderMetadata.getHidden();
    } catch (error) {
      console.error('Error getting hidden files:', error);
      return [];
    }
  }

  async handleSaveRating(
    _event: IpcMainInvokeEvent,
    videoId: VideoId,
    rating: Rating
  ): Promise<boolean> {
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

  async handleGetRating(_event: IpcMainInvokeEvent, videoId: VideoId): Promise<Rating | null> {
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

  async handleRemoveRating(_event: IpcMainInvokeEvent, videoId: VideoId): Promise<boolean> {
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

  async handleGetRatedVideos(): Promise<Array<{ video_id: VideoId; rating: Rating }>> {
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

  async handleGetFolders(): Promise<string[]> {
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

  async handleGetVideoById(
    _event: IpcMainInvokeEvent,
    videoId: VideoId
  ): Promise<VideoTableRow | null> {
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

  async handleGetDbStats(): Promise<DatabaseStats> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const stats = this.database.getStats();
      return {
        totalVideos: stats.totalVideos,
        totalFavorites: stats.totalFavorites,
        totalHidden: 0,
        totalTags: 0,
        totalSize: stats.totalSize,
        avgVideoSize: 0,
        folderCounts: [],
      };
    } catch (error) {
      console.error('Error getting database stats:', error);
      return {
        totalVideos: 0,
        totalFavorites: 0,
        totalHidden: 0,
        totalTags: 0,
        totalSize: 0,
        avgVideoSize: 0,
        folderCounts: [],
      };
    }
  }

  async handleTagsAdd(
    _event: IpcMainInvokeEvent,
    videoId: VideoId,
    tagName: string
  ): Promise<boolean> {
    try {
      if (!this.isInitialized) await this.initialize();
      // Use per-folder metadata instead of database
      return await this.folderMetadata.addTag(videoId, tagName);
    } catch (error) {
      console.error('Error adding tag:', error);
      return false;
    }
  }

  async handleTagsRemove(
    _event: IpcMainInvokeEvent,
    videoId: VideoId,
    tagName: string
  ): Promise<boolean> {
    try {
      if (!this.isInitialized) await this.initialize();
      // Use per-folder metadata instead of database
      return await this.folderMetadata.removeTag(videoId, tagName);
    } catch (error) {
      console.error('Error removing tag:', error);
      return false;
    }
  }

  async handleTagsList(_event: IpcMainInvokeEvent, videoId: VideoId): Promise<string[]> {
    try {
      if (!this.isInitialized) await this.initialize();
      // Use per-folder metadata instead of database
      return this.folderMetadata.getTags(videoId);
    } catch (error) {
      console.error('Error listing tags:', error);
      return [];
    }
  }

  async handleTagsAll(): Promise<Array<{ name: string; usage: number }>> {
    try {
      if (!this.isInitialized) await this.initialize();
      // Use per-folder metadata instead of database
      return this.folderMetadata.getAllTags();
    } catch (error) {
      console.error('Error listing all tags:', error);
      return [];
    }
  }

  async handleTagsSearch(
    _event: IpcMainInvokeEvent,
    query?: string
  ): Promise<
    Array<{
      id: string;
      name: string;
      path: string;
      folder: string;
      last_modified: number;
    }>
  > {
    try {
      if (!this.isInitialized) await this.initialize();
      return this.database.searchVideosByTag(query || '', 200);
    } catch (error) {
      console.error('Error searching tags:', error);
      return [];
    }
  }

  async handleBackupExport(): Promise<BackupResult> {
    try {
      if (!this.isInitialized) await this.initialize();
      return this.database.exportBackup();
    } catch (error) {
      console.error('Error exporting backup:', error);
      return { version: 1, exportedAt: new Date().toISOString(), items: [] };
    }
  }

  async handleBackupImport(
    _event: IpcMainInvokeEvent,
    payload: BackupResult | string
  ): Promise<ImportResult> {
    try {
      if (!this.isInitialized) await this.initialize();
      return this.database.importBackup(payload);
    } catch (error) {
      console.error('Error importing backup:', error);
      return { imported: 0, skipped: 0, errors: 1 };
    }
  }

  async handleBackupExportFile(): Promise<BackupExportResult> {
    try {
      if (!this.isInitialized) await this.initialize();
      const data = this.database.exportBackup();
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Export VDOTapes Backup',
        defaultPath: `vdotapes-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (canceled || !filePath) return { success: false, error: 'canceled' };
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      return { success: true, path: filePath, count: data.items.length };
    } catch (error) {
      console.error('Error exporting backup to file:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async handleBackupImportFile(): Promise<BackupImportResult> {
    try {
      if (!this.isInitialized) await this.initialize();
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Import VDOTapes Backup',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, error: 'canceled' };
      }
      const filePath = filePaths[0];
      const content = await fs.readFile(filePath, 'utf8');
      const result = this.database.importBackup(content);
      return { success: true, path: filePath, ...result };
    } catch (error) {
      console.error('Error importing backup from file:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async handleGenerateThumbnail(
    _event: IpcMainInvokeEvent,
    videoPath: string,
    timestamp: number | null = null
  ): Promise<ThumbnailResult> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (!(await this.isValidVideoFile(videoPath))) {
        return { success: false, error: 'Invalid video file' };
      }

      if (!this.thumbnailGenerator) {
        return { success: false, error: 'Thumbnail generator not initialized' };
      }

      const result = await this.thumbnailGenerator.generateThumbnail(videoPath, timestamp);

      if (result.success && result.thumbnailPath) {
        const videoId = this.videoScanner.generateVideoId(videoPath, {
          size: 0,
          lastModified: Date.now() as any,
          created: Date.now() as any,
        });
        this.database.saveThumbnail(videoId, result.thumbnailPath, timestamp);
      }

      return result;
    } catch (error) {
      console.error('Error generating thumbnail:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async handleGetThumbnail(
    _event: IpcMainInvokeEvent,
    videoId: VideoId
  ): Promise<{
    thumbnail_path: string;
    timestamp: number | null;
  } | null> {
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

  async handleGetVideoMetadata(_event: IpcMainInvokeEvent, filePath: string): Promise<any> {
    try {
      if (!(await this.isValidVideoFile(filePath))) {
        return null;
      }

      return await this.videoScanner.getVideoMetadata(filePath);
    } catch (error) {
      console.error('Error getting video metadata:', error);
      return null;
    }
  }

  async handleValidateVideoFile(_event: IpcMainInvokeEvent, filePath: string): Promise<boolean> {
    try {
      return await this.isValidVideoFile(filePath);
    } catch (error) {
      console.error('Error validating video file:', error);
      return false;
    }
  }

  async handleGetSettings(_event: IpcMainInvokeEvent, key?: string): Promise<any> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (key) {
        return this.database.getSetting(key, null);
      } else {
        return {
          gridColumns: this.database.getSetting('gridColumns', 4),
          sortBy: this.database.getSetting('sortBy', 'folder'),
          sortOrder: this.database.getSetting('sortOrder', 'ASC'),
          showFavoritesOnly: this.database.getSetting('showFavoritesOnly', false),
          selectedFolder: this.database.getSetting('selectedFolder', ''),
          theme: this.database.getSetting('theme', 'dark'),
        };
      }
    } catch (error) {
      console.error('Error getting settings:', error);
      return null;
    }
  }

  async handleSaveSettings(
    _event: IpcMainInvokeEvent,
    key: string | Record<string, any>,
    value?: any
  ): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          this.database.saveSetting(k, v);
        }
        return true;
      } else {
        return this.database.saveSetting(key, value);
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      return false;
    }
  }

  async handleGetLastFolder(): Promise<string | null> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const lastFolder = this.database.getLastFolder();

      // Validate that the last folder still exists
      if (lastFolder) {
        const folderExists = await this.isValidDirectory(lastFolder);
        if (!folderExists) {
          console.log(`[VideoScanner] Last folder ${lastFolder} no longer exists, clearing database...`);
          // Clear videos from the non-existent folder
          this.clearVideosFromFolder(lastFolder);
          // Clear the last folder setting
          this.database.saveLastFolder('');
          return null;
        }
      }

      return lastFolder;
    } catch (error) {
      console.error('Error getting last folder:', error);
      return null;
    }
  }

  async handleSaveLastFolder(_event: IpcMainInvokeEvent, folderPath: string): Promise<boolean> {
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

  async handleGetUserPreferences(): Promise<UserPreferences> {
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
        windowState: this.database.getWindowState(),
      };
    } catch (error) {
      console.error('Error getting user preferences:', error);
      return {
        lastFolder: null,
        gridColumns: 4,
        sortPreference: { sortBy: 'folder', sortOrder: 'ASC' },
        folderFilter: '',
        favoritesOnly: false,
        windowState: { width: 1400, height: 900, x: null, y: null },
      };
    }
  }

  async handleSaveUserPreferences(
    _event: IpcMainInvokeEvent,
    preferences: UserPreferences
  ): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const { lastFolder, gridColumns, sortPreference, folderFilter, favoritesOnly, windowState } =
        preferences;

      if (lastFolder !== undefined) {
        if (lastFolder) this.database.saveLastFolder(lastFolder);
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
        this.database.saveWindowState(
          windowState.width,
          windowState.height,
          windowState.x || 0,
          windowState.y || 0
        );
      }

      return true;
    } catch (error) {
      console.error('Error saving user preferences:', error);
      return false;
    }
  }

  async isValidDirectory(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  }

  async isValidVideoFile(filePath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) return false;

      return this.videoScanner.isValidVideoFile(path.basename(filePath));
    } catch (error) {
      return false;
    }
  }

  async handleShowItemInFolder(_event: IpcMainInvokeEvent, filePath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        console.error('File not found:', filePath);
        return false;
      }

      shell.showItemInFolder(filePath);
      return true;
    } catch (error) {
      console.error('Error showing item in folder:', error);
      return false;
    }
  }

  cleanup(): void {
    if (this.database) {
      this.database.close();
    }
    if (this.thumbnailGenerator) {
      this.thumbnailGenerator.cleanup();
    }
  }
}

export = IPCHandlers;
