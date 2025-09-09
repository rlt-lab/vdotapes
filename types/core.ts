// Core domain types for VDOTapes
// Brand types for type safety
export type VideoId = string & { readonly __brand: 'VideoId' };
export type TagId = string & { readonly __brand: 'TagId' };
export type Timestamp = number & { readonly __brand: 'Timestamp' };
export type FilePath = string & { readonly __brand: 'FilePath' };

// Simple union types following KISS principle
export type Rating = 1 | 2 | 3 | 4 | 5;
export type SortField = 'folder' | 'date' | 'name' | 'size' | 'shuffle' | 'none' | 'rating';
export type SortOrder = 'ASC' | 'DESC';

export type SupportedVideoFormat =
  | 'MP4'
  | 'WebM'
  | 'OGG'
  | 'MOV'
  | 'AVI'
  | 'WMV'
  | 'FLV'
  | 'MKV'
  | 'M4V';

// Core domain entity - matches existing database schema
export interface VideoRecord {
  readonly id: VideoId;
  readonly name: string;
  readonly path: FilePath;
  readonly folder: string;
  readonly size: number;
  readonly lastModified: Timestamp;
  readonly created: Timestamp;
  readonly addedAt: string;
  readonly updatedAt: string;
  readonly duration?: number;
  // Computed fields from joins
  readonly isFavorite?: boolean;
  readonly isHidden?: boolean;
  readonly rating?: Rating;
  readonly tags?: readonly string[];
}

// Performance-optimized type for grid display
export interface VideoSummary {
  readonly id: VideoId;
  readonly name: string;
  readonly path: FilePath;
  readonly folder: string;
  readonly size: number;
  readonly isFavorite: boolean;
  readonly isHidden: boolean;
}

// Related domain entities
export interface FavoriteRecord {
  readonly videoId: VideoId;
  readonly createdAt: string;
}

export interface HiddenFileRecord {
  readonly videoId: VideoId;
  readonly createdAt: string;
}

export interface TagRecord {
  readonly id: TagId;
  readonly name: string;
  readonly videoId: VideoId;
  readonly createdAt: string;
}

export interface ThumbnailRecord {
  readonly videoId: VideoId;
  readonly thumbnailData: Buffer;
  readonly createdAt: string;
}

// Filter and query types
export interface VideoFilters {
  readonly folder?: string;
  readonly sortBy?: SortField;
  readonly sortOrder?: SortOrder;
  readonly favoritesOnly?: boolean;
  readonly hiddenOnly?: boolean;
  readonly ratingMin?: Rating;
  readonly ratingMax?: Rating;
  readonly tags?: readonly string[];
  readonly search?: string;
  readonly sizeMin?: number;
  readonly sizeMax?: number;
  readonly limit?: number;
  readonly offset?: number;
}

// Operation result types
export interface ScanResult {
  readonly success: boolean;
  readonly videos: readonly VideoRecord[];
  readonly folders: readonly string[];
  readonly error?: string;
  readonly stats?: {
    readonly totalFiles: number;
    readonly validVideos: number;
    readonly duplicates: number;
    readonly errors: number;
  };
}

export interface BackupData {
  readonly version: string;
  readonly exportDate: string;
  readonly favorites: readonly FavoriteRecord[];
  readonly hiddenFiles: readonly HiddenFileRecord[];
  readonly tags: readonly TagRecord[];
  readonly settings: readonly SettingRecord[];
}

// Settings and preferences
export interface SettingRecord {
  readonly key: string;
  readonly value: string;
  readonly updatedAt: string;
}

export interface AppSettings {
  readonly gridColumns?: number;
  readonly sortPreference?: {
    readonly sortBy: SortField;
    readonly sortOrder: SortOrder;
  };
  readonly folderFilter?: string;
  readonly favoritesOnly?: boolean;
  readonly hiddenOnly?: boolean;
  readonly autoScan?: boolean;
  readonly showHiddenFiles?: boolean;
}

export interface UserPreferences extends AppSettings {
  readonly lastFolder?: FilePath;
  readonly windowState?: {
    readonly width: number;
    readonly height: number;
    readonly x?: number;
    readonly y?: number;
    readonly isMaximized?: boolean;
  };
}
