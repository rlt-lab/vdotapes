// IPC method type definitions - comprehensive type-safe contracts
import {
  VideoRecord,
  VideoFilters,
  ScanResult,
  AppSettings,
  UserPreferences,
  VideoId,
  Rating,
  FilePath,
  BackupData,
} from './core';

// Tag suggestion types
export interface TagSuggestion {
  readonly name: string;
  readonly source: 'folder' | 'recent' | 'global';
}

// IPC result wrapper types
export interface IPCSuccessResult<T> {
  readonly success: true;
  readonly data: T;
}

export interface IPCErrorResult {
  readonly success: false;
  readonly error: string;
}

export type IPCResult<T> = IPCSuccessResult<T> | IPCErrorResult;

// Scan progress event data
export interface ScanProgressData {
  readonly current: number;
  readonly total: number;
  readonly currentFile: string;
  readonly stage: 'scanning' | 'processing' | 'database';
}

// Folder selection result
export interface FolderSelectionResult {
  readonly success: boolean;
  readonly path?: FilePath;
  readonly error?: string;
}

// Backup operation results
export interface BackupExportResult {
  readonly success: boolean;
  readonly path?: FilePath;
  readonly count?: number;
  readonly error?: string;
}

export interface BackupImportResult {
  readonly success: boolean;
  readonly imported?: number;
  readonly skipped?: number;
  readonly error?: string;
}

// Video metadata for file operations
export interface VideoMetadata {
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly bitrate: number;
  readonly codec: string;
  readonly format: string;
}

// Thumbnail operation result types
export interface ThumbnailGenerationResult {
  readonly success: boolean;
  readonly thumbnailPath?: string;
  readonly error?: string;
}

export interface ThumbnailData {
  readonly thumbnail_path: string;
  readonly timestamp: number | null;
}

// Rated video result type
export interface RatedVideoEntry {
  readonly video_id: VideoId;
  readonly rating: Rating;
}

// Type-safe IPC method signatures based on existing preload.js
export interface ElectronAPI {
  // Application info
  readonly getAppVersion: () => Promise<string>;
  readonly getAppName: () => Promise<string>;

  // Folder operations
  readonly selectFolder: () => Promise<FolderSelectionResult>;
  readonly scanVideos: (folderPath: FilePath) => Promise<ScanResult>;
  readonly getScanProgress: () => Promise<ScanProgressData>;

  // Video database operations
  readonly getVideos: (filters?: VideoFilters) => Promise<readonly VideoRecord[]>;
  readonly getVideoMetadata: (filePath: FilePath) => Promise<VideoMetadata>;
  readonly validateVideoFile: (filePath: FilePath) => Promise<boolean>;

  // Favorites operations
  readonly saveFavorite: (videoId: VideoId, isFavorite: boolean) => Promise<boolean>;
  readonly getFavorites: () => Promise<readonly VideoId[]>;

  // Hidden files operations
  readonly saveHiddenFile: (videoId: VideoId, isHidden: boolean) => Promise<boolean>;
  readonly getHiddenFiles: () => Promise<readonly VideoId[]>;

  // Rating operations
  readonly saveRating: (videoId: VideoId, rating: Rating) => Promise<boolean>;
  readonly getRating: (videoId: VideoId) => Promise<Rating | null>;
  readonly removeRating: (videoId: VideoId) => Promise<boolean>;
  readonly getRatedVideos: () => Promise<readonly RatedVideoEntry[]>;

  // Tags operations
  readonly addTag: (videoId: VideoId, tagName: string) => Promise<boolean>;
  readonly removeTag: (videoId: VideoId, tagName: string) => Promise<boolean>;
  readonly listTags: (videoId: VideoId) => Promise<readonly string[]>;
  readonly listAllTags: () => Promise<readonly string[]>;
  readonly searchByTag: (query: string) => Promise<readonly VideoRecord[]>;
  readonly getAllVideoTags: () => Promise<Record<string, string[]>>;
  readonly getTagSuggestions: (videoId: VideoId, subfolder: string, limit?: number) => Promise<readonly TagSuggestion[]>;

  // Thumbnail operations
  readonly generateThumbnail: (videoPath: FilePath, timestamp: number | null) => Promise<ThumbnailGenerationResult>;
  readonly getThumbnail: (videoId: VideoId) => Promise<ThumbnailData | null>;

  // Settings operations
  readonly getSettings: () => Promise<AppSettings>;
  readonly saveSettings: (settings: AppSettings) => Promise<boolean>;
  readonly getLastFolder: () => Promise<FilePath | null>;
  readonly saveLastFolder: (folderPath: FilePath) => Promise<boolean>;
  readonly getUserPreferences: () => Promise<UserPreferences>;
  readonly saveUserPreferences: (preferences: UserPreferences) => Promise<boolean>;

  // Backup operations
  readonly exportBackup: () => Promise<BackupData>;
  readonly importBackup: (backup: BackupData) => Promise<BackupImportResult>;
  readonly exportBackupToFile: () => Promise<BackupExportResult>;
  readonly importBackupFromFile: () => Promise<BackupImportResult>;

  // File system operations
  readonly showItemInFolder: (filePath: FilePath) => Promise<boolean>;

  // Event listeners with proper typing
  readonly onScanProgress: (callback: (data: ScanProgressData) => void) => void;
  readonly onScanComplete: (callback: (data: ScanResult) => void) => void;
  readonly onError: (callback: (error: { message: string; code?: string }) => void) => void;
  readonly removeAllListeners: (channel: string) => void;
}

// IPC channel mapping for type safety
export interface IPCChannelMap {
  // App info channels
  'get-app-version': () => string;
  'get-app-name': () => string;

  // Folder operations
  'select-folder': () => FolderSelectionResult;
  'scan-videos': (folderPath: FilePath) => ScanResult;
  'get-scan-progress': () => ScanProgressData;

  // Video operations
  'get-videos': (filters?: VideoFilters) => readonly VideoRecord[];
  'get-video-metadata': (filePath: FilePath) => VideoMetadata;
  'validate-video-file': (filePath: FilePath) => boolean;

  // Favorites
  'save-favorite': (videoId: VideoId, isFavorite: boolean) => boolean;
  'get-favorites': () => readonly VideoId[];

  // Hidden files
  'save-hidden-file': (videoId: VideoId, isHidden: boolean) => boolean;
  'get-hidden-files': () => readonly VideoId[];

  // Ratings
  'save-rating': (videoId: VideoId, rating: Rating) => boolean;
  'get-rating': (videoId: VideoId) => Rating | null;
  'remove-rating': (videoId: VideoId) => boolean;
  'get-rated-videos': () => readonly RatedVideoEntry[];

  // Tags
  'tags-add': (videoId: VideoId, tagName: string) => boolean;
  'tags-remove': (videoId: VideoId, tagName: string) => boolean;
  'tags-list': (videoId: VideoId) => readonly string[];
  'tags-all': () => readonly string[];
  'tags-search': (query: string) => readonly VideoRecord[];

  // Thumbnails
  'generate-thumbnail': (videoPath: FilePath, timestamp: number | null) => ThumbnailGenerationResult;
  'get-thumbnail': (videoId: VideoId) => ThumbnailData | null;

  // Settings
  'get-settings': () => AppSettings;
  'save-settings': (settings: AppSettings) => boolean;
  'get-last-folder': () => FilePath | null;
  'save-last-folder': (folderPath: FilePath) => boolean;
  'get-user-preferences': () => UserPreferences;
  'save-user-preferences': (preferences: UserPreferences) => boolean;

  // Backups
  'backup-export': () => BackupData;
  'backup-import': (backup: BackupData) => BackupImportResult;
  'backup-export-file': () => BackupExportResult;
  'backup-import-file': () => BackupImportResult;

  // File operations
  'show-item-in-folder': (filePath: FilePath) => boolean;
}

// Type for IPC handler functions
export type IPCHandler<K extends keyof IPCChannelMap> = (
  event: any, // Electron.IpcMainInvokeEvent - avoiding Electron import
  ...args: Parameters<IPCChannelMap[K]>
) => Promise<ReturnType<IPCChannelMap[K]>> | ReturnType<IPCChannelMap[K]>;

// Global type declaration for renderer process
declare global {
  interface Window {
    readonly electronAPI: ElectronAPI;
  }
}
