/**
 * ThumbnailGeneratorTS - Pure TypeScript thumbnail generator using FFmpeg
 *
 * This module provides a TypeScript-native implementation of thumbnail generation
 * using FFmpeg as a subprocess. It serves as a replacement for the Rust native
 * module when that is unavailable.
 *
 * Features:
 * - LRU cache eviction when cache exceeds max size
 * - Smart timestamp selection (10% into video)
 * - Parallel batch processing
 * - Full video metadata extraction via ffprobe
 */

import { spawn } from 'child_process';
import { access, mkdir, readdir, stat, unlink, rm } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { tmpdir } from 'os';

/**
 * Result of thumbnail generation
 */
export interface ThumbnailResult {
  success: boolean;
  thumbnailPath?: string;
  width: number;
  height: number;
  format: string;
  fileSize: number;
  timestamp: number;
  error?: string;
}

/**
 * Video metadata extracted from file
 */
export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  codec: string;
  bitrate: number;
  fps: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  totalThumbnails: number;
  totalSizeBytes: number;
  cacheDir: string;
}

/**
 * Internal cache entry for tracking file access times (LRU eviction)
 */
interface CacheEntry {
  path: string;
  size: number;
  accessTime: number;
  timestamp: number;
}

/**
 * Default thumbnail dimensions
 */
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 180;
const DEFAULT_QUALITY = 85;
const DEFAULT_FORMAT = 'jpeg';

/**
 * Default subprocess timeout (30 seconds)
 */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Spawn a process with timeout protection
 */
function spawnWithTimeout(
  command: string,
  args: string[],
  options: { timeout?: number; stdio?: 'pipe' | 'ignore' } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: options.stdio === 'ignore' ? 'ignore' : 'pipe' });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timeout = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
      reject(new Error(`Process ${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    if (proc.stdout) {
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        // Limit buffer size to 1MB
        if (stdout.length > 1024 * 1024) {
          stdout = stdout.slice(-1024 * 1024);
        }
      });
    }

    if (proc.stderr) {
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        // Limit buffer size to 100KB
        if (stderr.length > 100 * 1024) {
          stderr = stderr.slice(-100 * 1024);
        }
      });
    }

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (!killed) {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      if (!killed) {
        reject(err);
      }
    });
  });
}

/**
 * ThumbnailGeneratorTS - Pure TypeScript implementation using FFmpeg subprocess
 */
export class ThumbnailGeneratorTS {
  private cacheDir: string;
  private maxCacheSize: number;
  private currentCacheSize: number = 0;
  private cacheEntries: Map<string, CacheEntry> = new Map();
  private initialized: boolean = false;
  private operationQueue: Promise<void> = Promise.resolve();

  /**
   * Create a new thumbnail generator
   *
   * @param cacheDir - Directory for thumbnail cache (default: system temp)
   * @param maxCacheMB - Maximum cache size in megabytes (default: 500)
   */
  constructor(cacheDir?: string, maxCacheMB: number = 500) {
    this.cacheDir = cacheDir || join(tmpdir(), 'vdotapes-thumbnails');
    this.maxCacheSize = maxCacheMB * 1024 * 1024;
  }

  /**
   * Initialize the thumbnail generator
   *
   * Creates cache directory and calculates current cache size.
   * Must be called before generating thumbnails.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Create cache directory
    await mkdir(this.cacheDir, { recursive: true });

    // Calculate current cache size and build entry map
    await this.calculateCacheSize();

    this.initialized = true;
    console.log(`[ThumbnailGeneratorTS] Initialized with cache at ${this.cacheDir}`);
    console.log(`[ThumbnailGeneratorTS] Current cache size: ${(this.currentCacheSize / 1024 / 1024).toFixed(2)} MB`);
  }

  /**
   * Generate a thumbnail for a video file
   *
   * @param videoPath - Absolute path to the video file
   * @param timestamp - Optional timestamp in seconds (null for smart selection)
   * @param width - Thumbnail width (default: 320)
   * @param height - Thumbnail height (default: 180)
   * @returns Result containing thumbnail path or error
   */
  async generateThumbnail(
    videoPath: string,
    timestamp?: number,
    width: number = DEFAULT_WIDTH,
    height: number = DEFAULT_HEIGHT
  ): Promise<ThumbnailResult> {
    // Queue this operation to prevent race conditions on cache state
    return new Promise((resolve) => {
      this.operationQueue = this.operationQueue.then(async () => {
        const result = await this._generateThumbnailInternal(videoPath, timestamp, width, height);
        resolve(result);
      }).catch(() => {
        // Ensure queue continues even if operation fails
      });
    });
  }

  /**
   * Internal thumbnail generation implementation
   */
  private async _generateThumbnailInternal(
    videoPath: string,
    timestamp?: number,
    width: number = DEFAULT_WIDTH,
    height: number = DEFAULT_HEIGHT
  ): Promise<ThumbnailResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Determine actual timestamp to use (compute smart timestamp if not provided)
    const ts = timestamp ?? await this.getSmartTimestamp(videoPath);

    // Include timestamp in cache key so different timestamps can be cached
    const cacheKey = this.getCacheKey(videoPath, width, height, ts);
    const cachePath = join(this.cacheDir, `${cacheKey}.jpg`);

    // Check cache first
    try {
      await access(cachePath);
      const stats = await stat(cachePath);

      // Get stored timestamp from cache entry, or use computed timestamp
      const existingEntry = this.cacheEntries.get(cacheKey);
      const storedTimestamp = existingEntry?.timestamp ?? ts;

      // Update access time for LRU
      this.cacheEntries.set(cacheKey, {
        path: cachePath,
        size: stats.size,
        accessTime: Date.now(),
        timestamp: storedTimestamp,
      });

      return {
        success: true,
        thumbnailPath: cachePath,
        width: width,
        height: height,
        format: DEFAULT_FORMAT,
        fileSize: stats.size,
        timestamp: storedTimestamp,
      };
    } catch {
      // Not in cache, need to generate
    }

    try {
      // Generate thumbnail with FFmpeg
      await this.runFFmpeg(videoPath, cachePath, ts, width, height);

      // Get file stats
      const stats = await stat(cachePath);

      // Update cache tracking
      this.cacheEntries.set(cacheKey, {
        path: cachePath,
        size: stats.size,
        accessTime: Date.now(),
        timestamp: ts,
      });
      this.currentCacheSize += stats.size;

      // Evict old entries if over limit
      if (this.currentCacheSize > this.maxCacheSize) {
        await this.evictOldEntries();
      }

      return {
        success: true,
        thumbnailPath: cachePath,
        width: width,
        height: height,
        format: DEFAULT_FORMAT,
        fileSize: stats.size,
        timestamp: ts,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ThumbnailGeneratorTS] Failed to generate thumbnail: ${errorMessage}`);

      return {
        success: false,
        width: 0,
        height: 0,
        format: DEFAULT_FORMAT,
        fileSize: 0,
        timestamp: ts,
        error: errorMessage,
      };
    }
  }

  /**
   * Get cached thumbnail path without generating
   *
   * @param videoPath - Absolute path to the video file
   * @param timestamp - Optional timestamp in seconds
   * @param width - Thumbnail width (default: 320)
   * @param height - Thumbnail height (default: 180)
   * @returns Path to cached thumbnail or null if not cached
   */
  async getThumbnailPath(
    videoPath: string,
    timestamp?: number,
    width: number = DEFAULT_WIDTH,
    height: number = DEFAULT_HEIGHT
  ): Promise<string | null> {
    const cacheKey = this.getCacheKey(videoPath, width, height, timestamp);
    const cachePath = join(this.cacheDir, `${cacheKey}.jpg`);

    try {
      await access(cachePath);

      // Update access time for LRU
      const entry = this.cacheEntries.get(cacheKey);
      if (entry) {
        entry.accessTime = Date.now();
      }

      return cachePath;
    } catch {
      return null;
    }
  }

  /**
   * Extract video metadata without generating thumbnail
   *
   * @param videoPath - Absolute path to the video file
   * @returns Video metadata including duration, dimensions, codec, etc.
   */
  async getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
    return this.runFFprobe(videoPath);
  }

  /**
   * Generate thumbnails for multiple videos
   *
   * Processes videos in parallel for better performance.
   * Each video is processed independently - failures don't stop the batch.
   *
   * @param videoPaths - Array of absolute paths to video files
   * @returns Array of results (one per video)
   */
  async generateBatch(videoPaths: string[]): Promise<ThumbnailResult[]> {
    // Process in parallel with concurrency limit
    const CONCURRENCY = 4;
    const results: ThumbnailResult[] = [];

    for (let i = 0; i < videoPaths.length; i += CONCURRENCY) {
      const batch = videoPaths.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(path => this.generateThumbnail(path))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Clear all cached thumbnails
   *
   * Deletes all thumbnail files from the cache directory.
   */
  async clearCache(): Promise<void> {
    try {
      // Remove entire cache directory and recreate
      await rm(this.cacheDir, { recursive: true, force: true });
      await mkdir(this.cacheDir, { recursive: true });

      // Reset tracking
      this.cacheEntries.clear();
      this.currentCacheSize = 0;

      console.log('[ThumbnailGeneratorTS] Cache cleared');
    } catch (error) {
      console.error('[ThumbnailGeneratorTS] Failed to clear cache:', error);
    }
  }

  /**
   * Get cache statistics
   *
   * @returns Statistics about cached thumbnails
   */
  async getCacheStats(): Promise<CacheStats> {
    // Recalculate to ensure accuracy
    await this.calculateCacheSize();

    return {
      totalThumbnails: this.cacheEntries.size,
      totalSizeBytes: this.currentCacheSize,
      cacheDir: this.cacheDir,
    };
  }

  /**
   * Check if using native implementation
   *
   * @returns Always false for TypeScript implementation
   */
  isUsingNativeGenerator(): boolean {
    return false;
  }

  /**
   * Clean up resources
   *
   * Called when shutting down the application.
   */
  cleanup(): void {
    console.log('[ThumbnailGeneratorTS] Cleanup');
    // No persistent resources to clean up in TS implementation
  }

  // ============ Private Methods ============

  /**
   * Generate cache key from video path, dimensions, and timestamp
   */
  private getCacheKey(videoPath: string, width: number, height: number, timestamp?: number): string {
    const input = timestamp !== undefined
      ? `${videoPath}:${width}:${height}:${timestamp}`
      : `${videoPath}:${width}:${height}`;
    return createHash('sha256').update(input).digest('hex').slice(0, 32);
  }

  /**
   * Get smart timestamp for thumbnail (10% into video, clamped to 1-30 seconds)
   */
  private async getSmartTimestamp(videoPath: string): Promise<number> {
    try {
      const result = await spawnWithTimeout('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        videoPath,
      ]);

      const duration = parseFloat(result.stdout) || 10;
      // 10% into video, minimum 1 second, maximum 30 seconds
      return Math.min(Math.max(duration * 0.1, 1), 30);
    } catch {
      // Default to 5 seconds if ffprobe fails or times out
      return 5;
    }
  }

  /**
   * Run FFmpeg to generate thumbnail
   */
  private async runFFmpeg(
    inputPath: string,
    outputPath: string,
    timestamp: number,
    width: number,
    height: number
  ): Promise<void> {
    const args = [
      '-ss', String(timestamp),
      '-i', inputPath,
      '-vframes', '1',
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      '-q:v', String(Math.round((100 - DEFAULT_QUALITY) / 10 + 1)), // Convert quality to FFmpeg scale
      '-y', // Overwrite output
      outputPath,
    ];

    const result = await spawnWithTimeout('ffmpeg', args);

    if (result.exitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${result.exitCode}: ${result.stderr.slice(-500)}`);
    }
  }

  /**
   * Run FFprobe to extract video metadata
   */
  private async runFFprobe(videoPath: string): Promise<VideoMetadata> {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,codec_name,bit_rate,r_frame_rate:format=duration,bit_rate',
      '-of', 'json',
      videoPath,
    ];

    const result = await spawnWithTimeout('ffprobe', args);

    if (result.exitCode !== 0) {
      throw new Error(`FFprobe exited with code ${result.exitCode}: ${result.stderr}`);
    }

    try {
      const data = JSON.parse(result.stdout);
      const stream = data.streams?.[0] || {};
      const format = data.format || {};

      // Parse frame rate (e.g., "30000/1001" or "30/1")
      let fps = 0;
      if (stream.r_frame_rate) {
        const [num, den] = stream.r_frame_rate.split('/').map(Number);
        fps = den ? num / den : num;
      }

      return {
        duration: parseFloat(format.duration) || 0,
        width: stream.width || 0,
        height: stream.height || 0,
        codec: stream.codec_name || 'unknown',
        bitrate: parseInt(format.bit_rate || stream.bit_rate || '0', 10),
        fps: Math.round(fps * 100) / 100, // Round to 2 decimals
      };
    } catch (parseError) {
      throw new Error(`Failed to parse FFprobe output: ${parseError}`);
    }
  }

  /**
   * Calculate total cache size and build entry map
   */
  private async calculateCacheSize(): Promise<number> {
    this.currentCacheSize = 0;
    this.cacheEntries.clear();

    try {
      const files = await readdir(this.cacheDir);

      for (const file of files) {
        if (!file.endsWith('.jpg')) continue;

        const filePath = join(this.cacheDir, file);
        try {
          const stats = await stat(filePath);
          const cacheKey = file.replace('.jpg', '');

          this.cacheEntries.set(cacheKey, {
            path: filePath,
            size: stats.size,
            accessTime: stats.mtimeMs, // Use mtime as initial access time
            timestamp: 0, // Unknown timestamp for existing cache files
          });

          this.currentCacheSize += stats.size;
        } catch {
          // Skip files we can't stat
        }
      }
    } catch {
      // Cache directory doesn't exist yet, that's fine
    }

    return this.currentCacheSize;
  }

  /**
   * Evict oldest entries until cache is under limit (LRU eviction)
   */
  private async evictOldEntries(): Promise<void> {
    // Sort entries by access time (oldest first)
    const sortedEntries = Array.from(this.cacheEntries.entries())
      .sort((a, b) => a[1].accessTime - b[1].accessTime);

    // Target 80% of max size to avoid frequent evictions
    const targetSize = this.maxCacheSize * 0.8;

    for (const [key, entry] of sortedEntries) {
      if (this.currentCacheSize <= targetSize) {
        break;
      }

      try {
        await unlink(entry.path);
        this.currentCacheSize -= entry.size;
        this.cacheEntries.delete(key);
        console.log(`[ThumbnailGeneratorTS] Evicted: ${entry.path}`);
      } catch {
        // File already deleted, just remove from tracking
        this.cacheEntries.delete(key);
      }
    }

    console.log(`[ThumbnailGeneratorTS] Cache after eviction: ${(this.currentCacheSize / 1024 / 1024).toFixed(2)} MB`);
  }
}

/**
 * Check if FFmpeg is available on the system
 *
 * @returns Promise resolving to true if FFmpeg is available
 */
export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    const result = await spawnWithTimeout('ffmpeg', ['-version'], { timeout: 5000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Standalone function to generate a single thumbnail (simpler API)
 *
 * @param videoPath - Path to the video file
 * @param outputPath - Path for the output thumbnail
 * @param timestamp - Optional timestamp in seconds
 * @returns ThumbnailResult
 */
export async function generateThumbnailSimple(
  videoPath: string,
  outputPath: string,
  timestamp?: number
): Promise<ThumbnailResult> {
  const ts = timestamp ?? 5;

  const args = [
    '-ss', String(ts),
    '-i', videoPath,
    '-vframes', '1',
    '-vf', `scale=${DEFAULT_WIDTH}:${DEFAULT_HEIGHT}:force_original_aspect_ratio=decrease`,
    '-y',
    outputPath,
  ];

  try {
    const result = await spawnWithTimeout('ffmpeg', args);

    if (result.exitCode === 0) {
      try {
        const stats = await stat(outputPath);
        return {
          success: true,
          thumbnailPath: outputPath,
          width: DEFAULT_WIDTH,
          height: DEFAULT_HEIGHT,
          format: DEFAULT_FORMAT,
          fileSize: stats.size,
          timestamp: ts,
        };
      } catch {
        return {
          success: false,
          width: 0,
          height: 0,
          format: DEFAULT_FORMAT,
          fileSize: 0,
          timestamp: ts,
          error: 'Failed to stat output file',
        };
      }
    } else {
      return {
        success: false,
        width: 0,
        height: 0,
        format: DEFAULT_FORMAT,
        fileSize: 0,
        timestamp: ts,
        error: `FFmpeg exited with code ${result.exitCode}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      width: 0,
      height: 0,
      format: DEFAULT_FORMAT,
      fileSize: 0,
      timestamp: ts,
      error: `FFmpeg failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// Export default for CommonJS compatibility
export default ThumbnailGeneratorTS;
