// Type guards and assertion functions for runtime type safety
import {
  VideoRecord,
  VideoId,
  Rating,
  SortField,
  SortOrder,
  FilePath,
  TagId,
  VideoFilters,
  AppSettings,
  UserPreferences,
  SupportedVideoFormat,
} from './core';
import { VideoTableRow, EnhancedVideoRow, VideoInsertParams, VideoUpdateParams } from './database';
import { RatingValidationError, VideoIdValidationError, ValidationError } from './errors';

// Brand type creators with validation
export function createVideoId(id: string): VideoId {
  if (!isValidVideoId(id)) {
    throw new VideoIdValidationError(`Invalid video ID: ${id}`, id);
  }
  return id as VideoId;
}

export function createTagId(id: string): TagId {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new ValidationError('Invalid tag ID', 'tagId', id, 'non-empty string');
  }
  return id as TagId;
}

export function createFilePath(path: string): FilePath {
  if (!path || typeof path !== 'string' || path.trim().length === 0) {
    throw new ValidationError('Invalid file path', 'filePath', path, 'non-empty string');
  }
  return path as FilePath;
}

export function createTimestamp(value: number): import('./core').Timestamp {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError('Invalid timestamp', 'timestamp', value, 'positive integer');
  }
  return value as import('./core').Timestamp;
}

// Primitive type guards
export function isValidVideoId(value: unknown): value is VideoId {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidTagId(value: unknown): value is TagId {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidRating(value: unknown): value is Rating {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function isValidSortField(value: unknown): value is SortField {
  const validFields: readonly SortField[] = ['folder', 'date', 'name', 'size', 'shuffle'] as const;
  return typeof value === 'string' && (validFields as readonly string[]).includes(value);
}

export function isValidSortOrder(value: unknown): value is SortOrder {
  return value === 'ASC' || value === 'DESC';
}

export function isValidFilePath(value: unknown): value is FilePath {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isSupportedVideoFormat(value: unknown): value is SupportedVideoFormat {
  const supportedFormats: readonly SupportedVideoFormat[] = [
    'MP4',
    'WebM',
    'OGG',
    'MOV',
    'AVI',
    'WMV',
    'FLV',
    'MKV',
    'M4V',
  ] as const;
  return typeof value === 'string' && (supportedFormats as readonly string[]).includes(value);
}

// Object type guards
export function isVideoRecord(value: unknown): value is VideoRecord {
  if (!value || typeof value !== 'object') return false;

  const obj = value as Record<string, unknown>;

  return (
    isValidVideoId(obj.id) &&
    typeof obj.name === 'string' &&
    isValidFilePath(obj.path) &&
    typeof obj.folder === 'string' &&
    typeof obj.size === 'number' &&
    typeof obj.lastModified === 'number' &&
    typeof obj.created === 'number' &&
    typeof obj.addedAt === 'string' &&
    typeof obj.updatedAt === 'string' &&
    (obj.duration === undefined || typeof obj.duration === 'number') &&
    (obj.isFavorite === undefined || typeof obj.isFavorite === 'boolean') &&
    (obj.isHidden === undefined || typeof obj.isHidden === 'boolean') &&
    (obj.rating === undefined || isValidRating(obj.rating)) &&
    (obj.tags === undefined ||
      (Array.isArray(obj.tags) && obj.tags.every((tag) => typeof tag === 'string')))
  );
}

export function isVideoTableRow(value: unknown): value is VideoTableRow {
  if (!value || typeof value !== 'object') return false;

  const obj = value as any;

  return (
    isValidVideoId(obj.id) &&
    typeof obj.name === 'string' &&
    isValidFilePath(obj.path) &&
    (obj.folder === null || typeof obj.folder === 'string') &&
    typeof obj.size === 'number' &&
    typeof obj.last_modified === 'number' &&
    typeof obj.created === 'number' &&
    typeof obj.added_at === 'string' &&
    typeof obj.updated_at === 'string' &&
    (obj.duration === null || typeof obj.duration === 'number')
  );
}

export function isEnhancedVideoRow(value: unknown): value is EnhancedVideoRow {
  if (!isVideoTableRow(value)) return false;

  const obj = value as any;

  return (
    typeof obj.is_favorite === 'boolean' &&
    typeof obj.is_hidden === 'boolean' &&
    (obj.rating === null || isValidRating(obj.rating)) &&
    (obj.tag_names === null || typeof obj.tag_names === 'string')
  );
}

export function isVideoFilters(value: unknown): value is VideoFilters {
  if (!value || typeof value !== 'object') return false;

  const obj = value as Record<string, unknown>;

  return (
    (obj.folder === undefined || typeof obj.folder === 'string') &&
    (obj.sortBy === undefined || isValidSortField(obj.sortBy)) &&
    (obj.sortOrder === undefined || isValidSortOrder(obj.sortOrder)) &&
    (obj.favoritesOnly === undefined || typeof obj.favoritesOnly === 'boolean') &&
    (obj.hiddenOnly === undefined || typeof obj.hiddenOnly === 'boolean') &&
    (obj.ratingMin === undefined || isValidRating(obj.ratingMin)) &&
    (obj.ratingMax === undefined || isValidRating(obj.ratingMax)) &&
    (obj.tags === undefined ||
      (Array.isArray(obj.tags) && obj.tags.every((tag) => typeof tag === 'string'))) &&
    (obj.search === undefined || typeof obj.search === 'string') &&
    (obj.sizeMin === undefined || typeof obj.sizeMin === 'number') &&
    (obj.sizeMax === undefined || typeof obj.sizeMax === 'number')
  );
}

export function isAppSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== 'object') return false;

  const obj = value as Record<string, unknown>;

  return (
    (obj.gridColumns === undefined ||
      (typeof obj.gridColumns === 'number' && obj.gridColumns >= 1 && obj.gridColumns <= 12)) &&
    (obj.sortPreference === undefined ||
      (typeof obj.sortPreference === 'object' &&
        obj.sortPreference !== null &&
        isValidSortField((obj.sortPreference as any).sortBy) &&
        isValidSortOrder((obj.sortPreference as any).sortOrder))) &&
    (obj.folderFilter === undefined || typeof obj.folderFilter === 'string') &&
    (obj.favoritesOnly === undefined || typeof obj.favoritesOnly === 'boolean') &&
    (obj.hiddenOnly === undefined || typeof obj.hiddenOnly === 'boolean') &&
    (obj.autoScan === undefined || typeof obj.autoScan === 'boolean') &&
    (obj.showHiddenFiles === undefined || typeof obj.showHiddenFiles === 'boolean')
  );
}

export function isUserPreferences(value: unknown): value is UserPreferences {
  if (!isAppSettings(value)) return false;

  const obj = value as Record<string, unknown>;

  return (
    (obj.lastFolder === undefined || isValidFilePath(obj.lastFolder)) &&
    (obj.windowState === undefined ||
      (typeof obj.windowState === 'object' &&
        obj.windowState !== null &&
        typeof (obj.windowState as any).width === 'number' &&
        typeof (obj.windowState as any).height === 'number' &&
        ((obj.windowState as any).x === undefined ||
          typeof (obj.windowState as any).x === 'number') &&
        ((obj.windowState as any).y === undefined ||
          typeof (obj.windowState as any).y === 'number') &&
        ((obj.windowState as any).isMaximized === undefined ||
          typeof (obj.windowState as any).isMaximized === 'boolean')))
  );
}

export function isVideoInsertParams(value: unknown): value is VideoInsertParams {
  if (!value || typeof value !== 'object') return false;

  const obj = value as Record<string, unknown>;

  return (
    isValidVideoId(obj.id) &&
    typeof obj.name === 'string' &&
    isValidFilePath(obj.path) &&
    (obj.folder === null || typeof obj.folder === 'string') &&
    typeof obj.size === 'number' &&
    typeof obj.last_modified === 'number' &&
    typeof obj.created === 'number' &&
    typeof obj.added_at === 'string' &&
    typeof obj.updated_at === 'string' &&
    (obj.duration === undefined || obj.duration === null || typeof obj.duration === 'number')
  );
}

export function isVideoUpdateParams(value: unknown): value is VideoUpdateParams {
  if (!value || typeof value !== 'object') return false;

  const obj = value as Record<string, unknown>;

  return (
    isValidVideoId(obj.id) &&
    (obj.name === undefined || typeof obj.name === 'string') &&
    (obj.folder === undefined || obj.folder === null || typeof obj.folder === 'string') &&
    (obj.size === undefined || typeof obj.size === 'number') &&
    (obj.last_modified === undefined || typeof obj.last_modified === 'number') &&
    (obj.updated_at === undefined || typeof obj.updated_at === 'string') &&
    (obj.duration === undefined || obj.duration === null || typeof obj.duration === 'number')
  );
}

// Assertion functions that throw on invalid input
export function assertValidRating(value: unknown, context?: string): asserts value is Rating {
  if (!isValidRating(value)) {
    throw new RatingValidationError(
      `Invalid rating${context ? ` in ${context}` : ''}: ${value}`,
      value
    );
  }
}

export function assertValidVideoId(value: unknown, context?: string): asserts value is VideoId {
  if (!isValidVideoId(value)) {
    throw new VideoIdValidationError(
      `Invalid video ID${context ? ` in ${context}` : ''}: ${value}`,
      value
    );
  }
}

export function assertVideoRecord(value: unknown, context?: string): asserts value is VideoRecord {
  if (!isVideoRecord(value)) {
    throw new ValidationError(
      `Invalid VideoRecord${context ? ` in ${context}` : ''}`,
      'videoRecord',
      value,
      'complete VideoRecord object'
    );
  }
}

export function assertVideoFilters(
  value: unknown,
  context?: string
): asserts value is VideoFilters {
  if (!isVideoFilters(value)) {
    throw new ValidationError(
      `Invalid VideoFilters${context ? ` in ${context}` : ''}`,
      'videoFilters',
      value,
      'valid VideoFilters object'
    );
  }
}

export function assertAppSettings(value: unknown, context?: string): asserts value is AppSettings {
  if (!isAppSettings(value)) {
    throw new ValidationError(
      `Invalid AppSettings${context ? ` in ${context}` : ''}`,
      'appSettings',
      value,
      'valid AppSettings object'
    );
  }
}

// Utility functions for safe type conversion
export function safeParseRating(value: unknown): Rating | null {
  if (isValidRating(value)) return value;
  if (typeof value === 'string') {
    const num = parseInt(value, 10);
    return isValidRating(num) ? num : null;
  }
  return null;
}

export function safeParseVideoId(value: unknown): VideoId | null {
  return isValidVideoId(value) ? value : null;
}

export function safeParseInt(value: unknown, min?: number, max?: number): number | null {
  let num: number;

  if (typeof value === 'number') {
    num = value;
  } else if (typeof value === 'string') {
    num = parseInt(value, 10);
    if (isNaN(num)) return null;
  } else {
    return null;
  }

  if (min !== undefined && num < min) return null;
  if (max !== undefined && num > max) return null;

  return num;
}

// Array type guards
export function isVideoRecordArray(value: unknown): value is readonly VideoRecord[] {
  return Array.isArray(value) && value.every(isVideoRecord);
}

export function isVideoIdArray(value: unknown): value is readonly VideoId[] {
  return Array.isArray(value) && value.every(isValidVideoId);
}

export function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
