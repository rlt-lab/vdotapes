/**
 * ThumbnailGenerator - TypeScript wrapper for native Rust thumbnail generator
 *
 * This module provides a seamless integration layer between the high-performance
 * Rust native thumbnail generator (using FFmpeg) and the TypeScript application.
 *
 * Features:
 * - Automatic native module detection with graceful fallback
 * - Type-safe API with proper error handling
 * - Thumbnail caching with LRU eviction
 * - Smart frame selection (skips black frames, intros)
 * - Hardware-accelerated video decoding when available
 *
 * The wrapper automatically detects if the native module is available and falls
 * back to a stub implementation if not (returns null for all operations).
 */

/**
 * Configuration for thumbnail generation
 */
export interface ThumbnailConfig {
  width: number;
  height: number;
  quality: number;  // 1-100 for JPEG
  format: string;   // "jpeg", "png", "webp"
}

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
 * Native thumbnail generator interface (from Rust)
 */
interface NativeThumbnailGenerator {
  initialize(): Promise<void>;
  generateThumbnail(videoPath: string, timestamp?: number): Promise<ThumbnailResult>;
  getThumbnailPath(videoPath: string, timestamp?: number): Promise<string | null>;
  getVideoMetadata(videoPath: string): Promise<VideoMetadata>;
  generateBatch(videoPaths: string[]): Promise<ThumbnailResult[]>;
  clearCache(): Promise<void>;
  getCacheStats(): Promise<CacheStats>;
}

/**
 * Native thumbnail generator constructor
 */
interface NativeThumbnailGeneratorConstructor {
  new (cacheDir?: string): NativeThumbnailGenerator;
}

/**
 * Stub implementation for when native module is unavailable
 */
class ThumbnailGeneratorStub {
  private cacheDir: string;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir || '/tmp/vdotapes-thumbnails';
  }

  async initialize(): Promise<void> {
    console.log('[ThumbnailGenerator] Stub initialized (native module unavailable)');
  }

  async generateThumbnail(_videoPath: string, _timestamp?: number): Promise<ThumbnailResult> {
    console.warn('[ThumbnailGenerator] Native module unavailable, returning stub result');
    return {
      success: false,
      width: 0,
      height: 0,
      format: 'jpeg',
      fileSize: 0,
      timestamp: _timestamp || 0,
      error: 'Native thumbnail generator not available',
    };
  }

  async getThumbnailPath(_videoPath: string, _timestamp?: number): Promise<string | null> {
    return null;
  }

  async getVideoMetadata(_videoPath: string): Promise<VideoMetadata> {
    return {
      duration: 0,
      width: 0,
      height: 0,
      codec: 'unknown',
      bitrate: 0,
      fps: 0,
    };
  }

  async generateBatch(videoPaths: string[]): Promise<ThumbnailResult[]> {
    return videoPaths.map(_path => ({
      success: false,
      width: 0,
      height: 0,
      format: 'jpeg',
      fileSize: 0,
      timestamp: 0,
      error: 'Native thumbnail generator not available',
    }));
  }

  async clearCache(): Promise<void> {
    console.log('[ThumbnailGenerator] Stub clearCache (no-op)');
  }

  async getCacheStats(): Promise<CacheStats> {
    return {
      totalThumbnails: 0,
      totalSizeBytes: 0,
      cacheDir: this.cacheDir,
    };
  }
}

/**
 * Determine which implementation to use
 */
let GeneratorClass: NativeThumbnailGeneratorConstructor | typeof ThumbnailGeneratorStub;
let isNativeGenerator = false;

try {
  // Attempt to load the native Rust module
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nativeModule = require('./thumbnail-generator-native');
  GeneratorClass = nativeModule.ThumbnailGeneratorNative;
  isNativeGenerator = true;
  console.log('[ThumbnailGenerator] Using native Rust implementation with FFmpeg');
} catch (error) {
  // Fall back to stub implementation
  console.warn('[ThumbnailGenerator] Native module unavailable, using stub');
  if (error instanceof Error) {
    console.warn(`[ThumbnailGenerator] Reason: ${error.message}`);
  }
  GeneratorClass = ThumbnailGeneratorStub;
  isNativeGenerator = false;
}

/**
 * ThumbnailGenerator - Unified API for thumbnail generation
 *
 * Provides a consistent interface regardless of whether the native Rust
 * implementation or stub is being used.
 *
 * @example
 * ```typescript
 * const generator = new ThumbnailGenerator('/path/to/cache');
 * await generator.initialize();
 *
 * const result = await generator.generateThumbnail('/path/to/video.mp4', 10.5);
 * if (result.success) {
 *   console.log('Thumbnail saved to:', result.thumbnailPath);
 * }
 * ```
 */
export class ThumbnailGenerator {
  private generator: NativeThumbnailGenerator | ThumbnailGeneratorStub;

  /**
   * Create a new thumbnail generator
   *
   * @param cacheDir - Directory for thumbnail cache (default: system temp)
   */
  constructor(cacheDir?: string) {
    this.generator = new GeneratorClass(cacheDir);
  }

  /**
   * Initialize the thumbnail generator
   *
   * Must be called before generating thumbnails.
   * Sets up FFmpeg and cache directory.
   */
  async initialize(): Promise<void> {
    await this.generator.initialize();
  }

  /**
   * Generate a thumbnail for a video file
   *
   * @param videoPath - Absolute path to the video file
   * @param timestamp - Optional timestamp in seconds (null for smart selection)
   * @returns Result containing thumbnail path or error
   *
   * If timestamp is not provided, the generator will:
   * 1. Select a frame at 10% into the video (skips intros)
   * 2. Validate the frame isn't black/corrupted
   * 3. Fall back to 25% if needed
   *
   * Generated thumbnails are cached. Subsequent calls with the same
   * video path and timestamp will return the cached version instantly.
   */
  async generateThumbnail(videoPath: string, timestamp?: number): Promise<ThumbnailResult> {
    return this.generator.generateThumbnail(videoPath, timestamp ?? undefined);
  }

  /**
   * Get cached thumbnail path without generating
   *
   * @param videoPath - Absolute path to the video file
   * @param timestamp - Optional timestamp in seconds
   * @returns Path to cached thumbnail or null if not cached
   */
  async getThumbnailPath(videoPath: string, timestamp?: number): Promise<string | null> {
    return this.generator.getThumbnailPath(videoPath, timestamp ?? undefined);
  }

  /**
   * Extract video metadata without generating thumbnail
   *
   * @param videoPath - Absolute path to the video file
   * @returns Video metadata including duration, dimensions, codec, etc.
   */
  async getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
    return this.generator.getVideoMetadata(videoPath);
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
    return this.generator.generateBatch(videoPaths);
  }

  /**
   * Clear all cached thumbnails
   *
   * Deletes all thumbnail files from the cache directory.
   * Use with caution - thumbnails will need to be regenerated.
   */
  async clearCache(): Promise<void> {
    await this.generator.clearCache();
  }

  /**
   * Get cache statistics
   *
   * @returns Statistics about cached thumbnails
   */
  async getCacheStats(): Promise<CacheStats> {
    return this.generator.getCacheStats();
  }

  /**
   * Check if using native implementation
   *
   * @returns true if using Rust/FFmpeg implementation
   */
  isUsingNativeGenerator(): boolean {
    return isNativeGenerator;
  }

  /**
   * Clean up resources
   *
   * Called when shutting down the application.
   * Native module handles cleanup automatically.
   */
  cleanup(): void {
    console.log('[ThumbnailGenerator] Cleanup');
  }
}

/**
 * Check if FFmpeg is available on the system
 * Only works with native implementation.
 *
 * @returns true if FFmpeg is available and can be used
 */
export function isFfmpegAvailable(): boolean {
  if (!isNativeGenerator) {
    return false;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nativeModule = require('./thumbnail-generator-native');
    if (nativeModule.isFfmpegAvailable) {
      return nativeModule.isFfmpegAvailable();
    }
  } catch (error) {
    return false;
  }

  return false;
}

// Export default for CommonJS compatibility
export default ThumbnailGenerator;
