/**
 * Video Scanner - Pure TypeScript Implementation
 *
 * Replaces the Rust native video scanner with a pure TypeScript implementation.
 * Uses Node.js fs/promises API for async file system operations.
 */

import { createHash } from 'crypto';
import { readdir, stat } from 'fs/promises';
import { basename, dirname, join } from 'path';

import type {
  VideoId,
  Timestamp,
  VideoRecord,
  ScanResult as CoreScanResult,
} from '../types/core';
import { createVideoId, createFilePath, createTimestamp } from '../types/guards';

/**
 * Supported video file extensions (lowercase)
 */
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.ogg',
  '.mov',
  '.avi',
  '.wmv',
  '.flv',
  '.mkv',
  '.m4v',
]);

/**
 * Patterns to skip during scanning
 */
const SKIP_PATTERNS = ['node_modules', '.DS_Store'];

/**
 * Check if a filename represents a valid video file
 *
 * @param filename - Name of the file to validate
 * @returns true if file has a supported video extension
 */
export function isValidVideoFile(filename: string): boolean {
  if (!filename || filename.startsWith('.')) {
    return false;
  }

  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) {
    return false;
  }

  const ext = filename.slice(lastDot).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

/**
 * Generate a deterministic video ID based on file path, size, and modification time
 *
 * Uses SHA-256 hash of "path:size:mtime" and takes first 16 characters.
 *
 * @param path - Absolute path to the video file
 * @param size - File size in bytes
 * @param mtime - Modification time in milliseconds
 * @returns Branded VideoId type
 */
export function generateVideoId(path: string, size: number, mtime: number): VideoId {
  const input = `${path}:${size}:${mtime}`;
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 16);
  return createVideoId(hash);
}

/**
 * Check if a path segment should be skipped
 */
function shouldSkip(name: string): boolean {
  if (name.startsWith('.')) {
    return true;
  }
  return SKIP_PATTERNS.includes(name);
}

/**
 * Internal type for file entries during scanning
 */
interface FileEntry {
  readonly path: string;
  readonly name: string;
  readonly folder: string;
  readonly size: number;
  readonly mtime: number;
  readonly birthtime: number;
}

/**
 * Async generator that yields video file entries from a directory tree
 *
 * @param folderPath - Root directory to scan
 * @yields FileEntry objects for each valid video file found
 */
async function* scanVideosAsync(folderPath: string): AsyncGenerator<FileEntry, void, unknown> {
  let entries;
  try {
    entries = await readdir(folderPath, { withFileTypes: true, recursive: true });
  } catch (error) {
    // Critical error - can't read the root directory
    throw error;
  }

  for (const entry of entries) {
    // Skip hidden and system files/directories
    if (shouldSkip(entry.name)) {
      continue;
    }

    // Only process files
    if (!entry.isFile()) {
      continue;
    }

    // Check if it's a valid video file
    if (!isValidVideoFile(entry.name)) {
      continue;
    }

    // Build full path - entry.parentPath is available in Node.js 20+
    // For older versions, entry.path contains parent path
    const parentPath = (entry as any).parentPath ?? (entry as any).path ?? folderPath;
    const fullPath = join(parentPath, entry.name);

    try {
      const stats = await stat(fullPath);
      yield {
        path: fullPath,
        name: entry.name,
        folder: dirname(fullPath),
        size: stats.size,
        mtime: stats.mtimeMs,
        birthtime: stats.birthtimeMs,
      };
    } catch {
      // Non-blocking error - skip this file and continue
      // Error will be tracked by caller
    }
  }
}

/**
 * Scan a directory for video files
 *
 * @param folderPath - Absolute path to the directory to scan
 * @returns Promise resolving to scan results with videos and statistics
 */
export async function scanVideos(folderPath: string): Promise<CoreScanResult> {
  const videos: VideoRecord[] = [];
  const foldersSet = new Set<string>();
  const seenIds = new Set<string>();
  const errors: string[] = [];

  let totalFiles = 0;
  let validVideos = 0;
  let duplicates = 0;

  const now = new Date().toISOString();

  try {
    for await (const entry of scanVideosAsync(folderPath)) {
      totalFiles++;

      try {
        const id = generateVideoId(entry.path, entry.size, entry.mtime);

        // Check for duplicates
        if (seenIds.has(id)) {
          duplicates++;
          continue;
        }
        seenIds.add(id);

        // Determine created timestamp: use birthtime if available (truthy/non-zero), otherwise mtime
        const createdMs = entry.birthtime && entry.birthtime > 0 ? entry.birthtime : entry.mtime;

        const video: VideoRecord = {
          id,
          name: entry.name,
          path: createFilePath(entry.path),
          folder: entry.folder,
          size: entry.size,
          lastModified: createTimestamp(Math.floor(entry.mtime)),
          created: createTimestamp(Math.floor(createdMs)),
          addedAt: now,
          updatedAt: now,
        };

        videos.push(video);
        foldersSet.add(entry.folder);
        validVideos++;
      } catch (err) {
        // Non-blocking error during video processing
        errors.push(`Error processing ${entry.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      success: true,
      videos,
      folders: Array.from(foldersSet),
      stats: {
        totalFiles,
        validVideos,
        duplicates,
        errors: errors.length,
      },
    };
  } catch (err) {
    // Critical/blocking error - couldn't scan the directory
    return {
      success: false,
      videos,
      folders: Array.from(foldersSet),
      error: err instanceof Error ? err.message : String(err),
      stats: {
        totalFiles,
        validVideos,
        duplicates,
        errors: errors.length + 1,
      },
    };
  }
}

/**
 * VideoScannerTS - Class-based wrapper for the TypeScript video scanner
 *
 * Provides a consistent API similar to the native Rust scanner wrapper.
 *
 * @example
 * ```typescript
 * const scanner = new VideoScannerTS();
 * const result = await scanner.scanVideos('/path/to/videos');
 * console.log(`Found ${result.videos.length} videos`);
 * ```
 */
export class VideoScannerTS {
  private cachedVideos: readonly VideoRecord[] = [];
  private isScanning = false;

  /**
   * Scan a directory for video files
   *
   * @param folderPath - Absolute path to the directory to scan
   * @returns Promise resolving to scan results with videos and statistics
   */
  async scanVideos(folderPath: string): Promise<CoreScanResult> {
    this.isScanning = true;
    try {
      const result = await scanVideos(folderPath);
      this.cachedVideos = result.videos;
      return result;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Get list of all scanned videos
   *
   * @returns Readonly array of video records
   */
  getVideos(): readonly VideoRecord[] {
    return this.cachedVideos;
  }

  /**
   * Reset scanner state
   *
   * Clears all cached videos
   */
  reset(): void {
    this.cachedVideos = [];
    this.isScanning = false;
  }

  /**
   * Check if a filename represents a valid video file
   *
   * @param filename - Name of the file to validate
   * @returns true if file has a supported video extension
   */
  isValidVideoFile(filename: string): boolean {
    return isValidVideoFile(filename);
  }

  /**
   * Generate a unique video ID based on file path and metadata
   *
   * @param path - Absolute path to the video file
   * @param size - File size in bytes
   * @param mtime - Modification time in milliseconds
   * @returns Branded VideoId type
   */
  generateVideoId(path: string, size: number, mtime: number): VideoId {
    return generateVideoId(path, size, mtime);
  }

  /**
   * Check if the scanner is currently scanning
   *
   * @returns true if a scan is in progress
   */
  getIsScanning(): boolean {
    return this.isScanning;
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

// Default export for the class
export default VideoScannerTS;
