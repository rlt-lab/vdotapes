/**
 * VideoScanner - TypeScript wrapper for video scanner
 *
 * This module provides a wrapper layer for the TypeScript video scanner.
 * It handles:
 * - Type conversions and TypeScript branded types
 * - API compatibility with the existing codebase
 */

import type {
  VideoId,
  Timestamp,
  VideoRecord,
  ScanResult as CoreScanResult,
} from '../types/core';
import { createVideoId, createFilePath, createTimestamp } from '../types/guards';
import { VideoScannerTS } from './video-scanner-ts';

/**
 * File metadata returned by file system operations
 */
interface FileMetadata {
  readonly size: number;
  readonly lastModified: Timestamp;
  readonly created: Timestamp;
}

/**
 * Extended video metadata including codec information
 */
interface VideoMetadata {
  readonly duration: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly codec: string | null;
  readonly bitrate: number | null;
  readonly size: number;
  readonly lastModified: Timestamp;
}

/**
 * Progress information for ongoing scan operations
 */
interface ScanProgress {
  readonly isScanning: boolean;
  readonly progress: number;
  readonly processedFiles: number;
  readonly totalFiles: number;
  readonly totalVideos: number;
}

/**
 * Native module VideoMetadata type (from Rust)
 * Uses plain JavaScript types without branded types
 */
interface NativeVideoMetadata {
  id: string;
  name: string;
  path: string;
  folder: string;
  size: number;
  lastModified: number;
  created: number;
  addedAt: string;
  updatedAt: string;
  duration?: number;
}

/**
 * Native module ScanResult type (from Rust)
 */
interface NativeScanResult {
  success: boolean;
  videos: NativeVideoMetadata[];
  folders: string[];
  error?: string;
  stats?: {
    totalFiles: number;
    validVideos: number;
    duplicates: number;
    errors: number;
  };
}

/**
 * Native scanner class interface (from Rust)
 */
interface NativeScanner {
  scanVideos(folderPath: string): NativeScanResult;
  getProgress(): ScanProgress;
  getVideos(): NativeVideoMetadata[];
  reset(): void;
  isValidVideoFile(filename: string): boolean;
}

/**
 * Native scanner constructor type
 */
interface NativeScannerConstructor {
  new (): NativeScanner;
}

/**
 * Log implementation in use
 */
console.log('[VideoScanner] Using TypeScript implementation');

/**
 * Convert native Rust VideoMetadata to TypeScript VideoRecord
 * Applies branded types and ensures type safety
 */
function convertNativeVideoToRecord(nativeVideo: NativeVideoMetadata): VideoRecord {
  return {
    id: createVideoId(nativeVideo.id),
    name: nativeVideo.name,
    path: createFilePath(nativeVideo.path),
    folder: nativeVideo.folder,
    size: nativeVideo.size,
    lastModified: createTimestamp(nativeVideo.lastModified),
    created: createTimestamp(nativeVideo.created),
    addedAt: nativeVideo.addedAt,
    updatedAt: nativeVideo.updatedAt,
    duration: nativeVideo.duration,
  };
}

/**
 * Convert native Rust ScanResult to TypeScript ScanResult
 * Applies type conversions and ensures immutability
 */
function convertNativeScanResult(nativeResult: NativeScanResult): CoreScanResult {
  return {
    success: nativeResult.success,
    videos: nativeResult.videos.map(convertNativeVideoToRecord),
    folders: nativeResult.folders,
    error: nativeResult.error,
    stats: nativeResult.stats,
  };
}

/**
 * VideoScanner - TypeScript wrapper for native Rust video scanner
 *
 * Provides a consistent API for the Rust native scanner with TypeScript types.
 *
 * @example
 * ```typescript
 * const scanner = new VideoScanner();
 * const result = await scanner.scanVideos('/path/to/videos');
 * console.log(`Found ${result.videos.length} videos`);
 * ```
 */
class VideoScanner {
  private readonly scanner: VideoScannerTS;

  constructor() {
    this.scanner = new VideoScannerTS();
  }

  /**
   * Scan a directory for video files
   *
   * @param folderPath - Absolute path to the directory to scan
   * @returns Promise resolving to scan results with videos and statistics
   *
   * @throws {ValidationError} If folder path is invalid
   * @throws {ScanError} If scanning fails
   */
  async scanVideos(folderPath: string): Promise<CoreScanResult> {
    // TypeScript scanner is already async and returns CoreScanResult directly
    return this.scanner.scanVideos(folderPath);
  }

  /**
   * Get current scan progress
   *
   * @returns Current scanning state and progress information
   */
  getProgress(): ScanProgress {
    return this.scanner.getProgress();
  }

  /**
   * Get list of all scanned videos
   *
   * @returns Readonly array of video records with branded types
   */
  getVideos(): readonly VideoRecord[] {
    // TypeScript scanner already returns VideoRecord[] with branded types
    return this.scanner.getVideos();
  }

  /**
   * Reset scanner state
   *
   * Clears all cached videos and resets progress counters
   */
  reset(): void {
    this.scanner.reset();
  }

  /**
   * Check if a filename represents a valid video file
   *
   * @param filename - Name of the file to validate
   * @returns true if file has a supported video extension
   */
  isValidVideoFile(filename: string): boolean {
    return this.scanner.isValidVideoFile(filename);
  }

  /**
   * Get file metadata
   *
   * Note: The native scanner integrates this into the main scanning process.
   * This method is provided for API compatibility but returns null.
   *
   * @param _filePath - Absolute path to the file
   * @returns Always returns null (use scanVideos to get metadata)
   */
  async getFileMetadata(_filePath: string): Promise<FileMetadata | null> {
    console.warn('[VideoScanner] getFileMetadata not available - use scanVideos instead');
    return null;
  }

  /**
   * Get video metadata
   *
   * Note: The native scanner integrates this into the main scanning process.
   * This method is provided for API compatibility but returns null.
   *
   * @param _filePath - Absolute path to the video file
   * @returns Always returns null (use scanVideos to get metadata)
   */
  async getVideoMetadata(_filePath: string): Promise<VideoMetadata | null> {
    console.warn('[VideoScanner] getVideoMetadata not available - use scanVideos instead');
    return null;
  }

  /**
   * Generate a unique video ID based on file path and metadata
   *
   * Creates a deterministic hash-based ID from filename, size, and modification time.
   * This ensures the same video file always gets the same ID.
   *
   * Note: The native scanner generates IDs internally. This method is provided
   * for API compatibility.
   *
   * @param filePath - Absolute path to the video file
   * @param metadata - File metadata (size and timestamps)
   * @returns Branded VideoId type
   */
  generateVideoId(filePath: string, metadata: FileMetadata): VideoId {
    const filename = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
    const str = `${filename}_${metadata.size}_${metadata.lastModified}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return createVideoId(Math.abs(hash).toString(36));
  }

  /**
   * Check if the native scanner is being used
   *
   * @returns Always false (using TypeScript implementation)
   */
  isUsingNativeScanner(): boolean {
    return false;
  }
}

// Export using CommonJS module pattern for compatibility
export = VideoScanner;
