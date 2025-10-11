/**
 * VideoScanner - TypeScript wrapper for native Rust video scanner
 *
 * This module provides a seamless integration layer between the high-performance
 * Rust native video scanner and the TypeScript application. It handles:
 * - Type conversions between Rust and TypeScript branded types
 * - Graceful fallback to pure TypeScript implementation
 * - API compatibility with the existing codebase
 *
 * The wrapper automatically detects if the native module is available and falls
 * back to the TypeScript implementation if not (e.g., on unsupported platforms
 * or during development without native binaries).
 */

import type {
  VideoId,
  FilePath,
  Timestamp,
  VideoRecord,
  ScanResult as CoreScanResult,
} from '../types/core';
import { createVideoId, createFilePath, createTimestamp } from '../types/guards';

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
 * Fallback scanner interface (TypeScript implementation)
 */
interface FallbackScanner {
  scanVideos(folderPath: string): Promise<CoreScanResult>;
  getProgress(): ScanProgress;
  getVideos(): readonly VideoRecord[];
  reset(): void;
  isValidVideoFile(filename: string): boolean;
  getFileMetadata(filePath: string): Promise<FileMetadata | null>;
  getVideoMetadata(filePath: string): Promise<VideoMetadata | null>;
  generateVideoId(filePath: string, metadata: FileMetadata): VideoId;
}

/**
 * Fallback scanner constructor type
 */
interface FallbackScannerConstructor {
  new (): FallbackScanner;
}

/**
 * Scanner implementation type (either native or fallback)
 */
type ScannerImpl = NativeScanner | FallbackScanner;

/**
 * Determine which scanner implementation to use
 * Tries to load native Rust module first, falls back to TypeScript
 */
let ScannerClass: NativeScannerConstructor | FallbackScannerConstructor;
let isNativeScanner = false;

try {
  // Attempt to load the native Rust module
  const nativeModule = require('./video-scanner-native');
  ScannerClass = nativeModule.VideoScannerNative;
  isNativeScanner = true;
  console.log('[VideoScanner] Using native Rust implementation');
} catch (error) {
  // Fall back to TypeScript implementation
  console.warn('[VideoScanner] Native module unavailable, using TypeScript fallback');
  if (error instanceof Error) {
    console.warn(`[VideoScanner] Reason: ${error.message}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ScannerClass = require('./video-scanner-fallback');
  isNativeScanner = false;
}

/**
 * Type guard to check if scanner is native
 */
function isNativeScannerInstance(scanner: ScannerImpl): scanner is NativeScanner {
  return isNativeScanner;
}

/**
 * Type guard to check if scanner is fallback
 */
function isFallbackScannerInstance(scanner: ScannerImpl): scanner is FallbackScanner {
  return !isNativeScanner;
}

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
 * VideoScanner - Unified API for video scanning
 *
 * Provides a consistent interface regardless of whether the native Rust
 * implementation or TypeScript fallback is being used.
 *
 * @example
 * ```typescript
 * const scanner = new VideoScanner();
 * const result = await scanner.scanVideos('/path/to/videos');
 * console.log(`Found ${result.videos.length} videos`);
 * ```
 */
class VideoScanner {
  private readonly scanner: ScannerImpl;

  constructor() {
    this.scanner = new ScannerClass();
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
    if (isNativeScannerInstance(this.scanner)) {
      // Native scanner is synchronous, wrap in Promise for consistent API
      const nativeResult = this.scanner.scanVideos(folderPath);
      return convertNativeScanResult(nativeResult);
    } else {
      // Fallback scanner is already async
      return this.scanner.scanVideos(folderPath);
    }
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
    if (isNativeScannerInstance(this.scanner)) {
      // Convert native videos to typed records
      const nativeVideos = this.scanner.getVideos();
      return nativeVideos.map(convertNativeVideoToRecord);
    } else {
      // Fallback already returns typed records
      return this.scanner.getVideos();
    }
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
   * Get file metadata (fallback only)
   *
   * Note: This method is only available when using the TypeScript fallback.
   * The native scanner does not expose this method separately as it's integrated
   * into the main scanning process.
   *
   * @param filePath - Absolute path to the file
   * @returns File metadata or null if unavailable
   */
  async getFileMetadata(filePath: string): Promise<FileMetadata | null> {
    if (isFallbackScannerInstance(this.scanner)) {
      return this.scanner.getFileMetadata(filePath);
    }
    // Native scanner doesn't expose this separately
    console.warn('[VideoScanner] getFileMetadata not available in native implementation');
    return null;
  }

  /**
   * Get video metadata (fallback only)
   *
   * Note: This method is only available when using the TypeScript fallback.
   * The native scanner integrates metadata extraction into the main scan.
   *
   * @param filePath - Absolute path to the video file
   * @returns Video metadata or null if unavailable
   */
  async getVideoMetadata(filePath: string): Promise<VideoMetadata | null> {
    if (isFallbackScannerInstance(this.scanner)) {
      return this.scanner.getVideoMetadata(filePath);
    }
    // Native scanner doesn't expose this separately
    console.warn('[VideoScanner] getVideoMetadata not available in native implementation');
    return null;
  }

  /**
   * Generate a unique video ID based on file path and metadata
   *
   * Creates a deterministic hash-based ID from filename, size, and modification time.
   * This ensures the same video file always gets the same ID.
   *
   * Note: This method is only available when using the TypeScript fallback.
   * The native scanner generates IDs internally during the scan.
   *
   * @param filePath - Absolute path to the video file
   * @param metadata - File metadata (size and timestamps)
   * @returns Branded VideoId type
   */
  generateVideoId(filePath: string, metadata: FileMetadata): VideoId {
    if (isFallbackScannerInstance(this.scanner)) {
      return this.scanner.generateVideoId(filePath, metadata);
    }

    // Native scanner doesn't expose this separately, implement it here
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
   * @returns true if using Rust native implementation
   */
  isUsingNativeScanner(): boolean {
    return isNativeScanner;
  }
}

// Export using CommonJS module pattern for compatibility
export = VideoScanner;
