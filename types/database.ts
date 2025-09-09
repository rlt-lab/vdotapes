// Database schema types for better-sqlite3 integration
import { VideoId, TagId, Timestamp, FilePath, Rating } from './core';

// Database row types - exact SQLite schema mapping with snake_case
export interface VideoTableRow {
  readonly id: VideoId;
  readonly name: string;
  readonly path: FilePath;
  readonly folder: string | null;
  readonly size: number;
  readonly last_modified: Timestamp;
  readonly created: Timestamp;
  readonly added_at: string;
  readonly updated_at: string;
  readonly duration: number | null;
}

export interface FavoritesTableRow {
  readonly video_id: VideoId;
  readonly created_at: string;
}

export interface HiddenFilesTableRow {
  readonly video_id: VideoId;
  readonly created_at: string;
}

export interface SettingsTableRow {
  readonly key: string;
  readonly value: string;
  readonly updated_at: string;
}

export interface ThumbnailsTableRow {
  readonly video_id: VideoId;
  readonly thumbnail_data: Buffer | null;
  readonly created_at: string;
}

export interface RatingsTableRow {
  readonly video_id: VideoId;
  readonly rating: Rating;
  readonly created_at: string;
}

export interface TagsTableRow {
  readonly id: TagId;
  readonly name: string;
  readonly created_at: string;
}

export interface VideoTagsTableRow {
  readonly video_id: VideoId;
  readonly tag_id: TagId;
  readonly created_at: string;
}

// Query result types for JOIN operations
export interface VideoWithFavorites extends VideoTableRow {
  readonly is_favorite: boolean;
  readonly favorite_created_at: string | null;
}

export interface VideoWithHidden extends VideoTableRow {
  readonly is_hidden: boolean;
  readonly hidden_created_at: string | null;
}

export interface VideoWithRating extends VideoTableRow {
  readonly rating: Rating | null;
  readonly rating_created_at: string | null;
}

export interface EnhancedVideoRow extends VideoTableRow {
  readonly is_favorite: boolean;
  readonly is_hidden: boolean;
  readonly rating: Rating | null;
  readonly tag_names: string | null; // Comma-separated tags from GROUP_CONCAT
}

// Query parameter types
export interface VideoInsertParams {
  readonly id: VideoId;
  readonly name: string;
  readonly path: FilePath;
  readonly folder: string | null;
  readonly size: number;
  readonly last_modified: Timestamp;
  readonly created: Timestamp;
  readonly added_at: string;
  readonly updated_at: string;
  readonly duration?: number | null;
}

export interface VideoUpdateParams {
  readonly id: VideoId;
  readonly name?: string;
  readonly folder?: string | null;
  readonly size?: number;
  readonly last_modified?: Timestamp;
  readonly updated_at?: string;
  readonly duration?: number | null;
}

export interface VideoFilterParams {
  readonly folder?: string;
  readonly is_favorite?: boolean;
  readonly is_hidden?: boolean;
  readonly rating_min?: Rating;
  readonly rating_max?: Rating;
  readonly size_min?: number;
  readonly size_max?: number;
  readonly search?: string;
  readonly tags?: readonly string[];
  readonly limit?: number;
  readonly offset?: number;
}

// Utility types for database operations
export type SqliteValue = string | number | boolean | null | Buffer;
export type SqliteParameters = Record<string, SqliteValue> | readonly SqliteValue[];

export interface PreparedStatementResult<T = any> {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
  readonly reader?: boolean;
}

export interface DatabaseTransaction {
  readonly savepoint: (name: string) => void;
  readonly release: (name: string) => void;
  readonly rollback: (name: string) => void;
}

// Database operation interfaces following SOLID principles
export interface VideoDatabaseOperations {
  // Basic CRUD
  readonly getVideoById: (id: VideoId) => VideoTableRow | null;
  readonly getAllVideos: (filters?: VideoFilterParams) => readonly VideoTableRow[];
  readonly insertVideo: (video: VideoInsertParams) => boolean;
  readonly updateVideo: (params: VideoUpdateParams) => boolean;
  readonly deleteVideo: (id: VideoId) => boolean;

  // Enhanced queries with joins
  readonly getVideosWithMetadata: (filters?: VideoFilterParams) => readonly EnhancedVideoRow[];
  readonly getStats: () => DatabaseStats;

  // Favorites operations
  readonly addFavorite: (videoId: VideoId) => boolean;
  readonly removeFavorite: (videoId: VideoId) => boolean;
  readonly getFavoriteIds: () => readonly VideoId[];

  // Hidden files operations
  readonly addHiddenFile: (videoId: VideoId) => boolean;
  readonly removeHiddenFile: (videoId: VideoId) => boolean;
  readonly getHiddenFiles: () => readonly VideoId[];

  // Ratings operations
  readonly removeRating: (videoId: VideoId) => boolean;
  readonly getRating: (videoId: VideoId) => Rating | null;

  // Tags operations
  readonly addTag: (videoId: VideoId, tagName: string) => boolean;
  readonly removeTag: (videoId: VideoId, tagName: string) => boolean;
  readonly getVideoTags: (videoId: VideoId) => readonly string[];
  readonly getAllTags: () => readonly TagInfo[];
  readonly searchByTag: (tagName: string) => readonly VideoId[];
}

export interface DatabaseStats {
  readonly totalVideos: number;
  readonly totalFavorites: number;
  readonly totalHidden: number;
  readonly totalTags: number;
  readonly totalSize: number;
  readonly avgVideoSize: number;
  readonly folderCounts: readonly FolderStats[];
}

export interface FolderStats {
  readonly folder: string;
  readonly count: number;
  readonly totalSize: number;
}

export interface TagInfo {
  readonly name: string;
  readonly count: number;
  readonly lastUsed: string;
}

// Transaction utility types
export type TransactionCallback<T = void> = (transaction: DatabaseTransaction) => T;
export type DatabaseMethod<TParams extends readonly any[] = readonly any[], TReturn = any> = (
  ...params: TParams
) => TReturn;
