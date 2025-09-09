const FFprobeWrapper = require('./ffprobe-wrapper');

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Core metadata extractor with caching and batch processing
 * Following SOLID principles - separation of concerns
 */
class MetadataExtractor {
  constructor(options = {}) {
    this.ffprobe = new FFprobeWrapper();

    // Configuration with sensible defaults (YAGNI)
    this.config = {
      cacheSize: options.cacheSize || 1000,
      cacheTTL: options.cacheTTL || 300000, // 5 minutes
      concurrency: options.concurrency || 3,
      timeout: options.timeout || 30000,
      retryAttempts: options.retryAttempts || 2,
      ...options,
    };

    // In-memory cache (KISS - simple Map-based cache)
    this.cache = new Map();
    this.cacheStats = {
      hits: 0,
      misses: 0,
      errors: 0,
    };

    // Processing state
    this.isInitialized = false;
    this.activeExtractions = new Map();
    this.extractionQueue = [];
    this.processing = false;

    // Progress tracking
    this.progressCallbacks = new Set();
  }

  /**
   * Initialize the metadata extractor
   */
  async initialize() {
    if (this.isInitialized) return true;

    try {
      const success = await this.ffprobe.initialize();
      if (!success) {
        throw new Error('Failed to initialize FFprobe');
      }

      this.isInitialized = true;
      console.log('Metadata extractor initialized successfully');

      // Start cache cleanup timer
      this.startCacheCleanup();

      return true;
    } catch (error) {
      console.error('Failed to initialize metadata extractor:', error.message);
      return false;
    }
  }

  /**
   * Extract metadata for a single video file
   */
  async extractMetadata(videoPath, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const cacheKey = await this.getCacheKey(videoPath);

    // Check cache first (DRY)
    const cached = this.getCachedMetadata(cacheKey);
    if (cached && !options.skipCache) {
      this.cacheStats.hits++;
      return cached;
    }

    this.cacheStats.misses++;

    try {
      // Check if extraction is already in progress for this file
      if (this.activeExtractions.has(videoPath)) {
        return await this.activeExtractions.get(videoPath);
      }

      // Start extraction
      const extractionPromise = this.performExtraction(videoPath, options);
      this.activeExtractions.set(videoPath, extractionPromise);

      const result = await extractionPromise;

      // Cache successful results
      if (result.success) {
        this.setCachedMetadata(cacheKey, result);
      }

      return result;
    } catch (error) {
      this.cacheStats.errors++;
      return this.createErrorResult(videoPath, error);
    } finally {
      this.activeExtractions.delete(videoPath);
    }
  }

  /**
   * Perform the actual metadata extraction
   */
  async performExtraction(videoPath, options) {
    const startTime = Date.now();

    try {
      // Get file stats for additional metadata
      const fileStats = await this.getFileStats(videoPath);

      // Extract metadata using FFprobe
      const extractionResult = await this.ffprobe.extractMetadata(videoPath, {
        timeout: options.timeout || this.config.timeout,
      });

      if (!extractionResult.success) {
        throw new Error(extractionResult.error || 'Metadata extraction failed');
      }

      const duration = Date.now() - startTime;

      // Combine FFprobe metadata with file stats
      const enhancedMetadata = this.enhanceMetadata(
        extractionResult.metadata,
        fileStats,
        videoPath
      );

      return {
        success: true,
        metadata: enhancedMetadata,
        extractionTime: duration,
        filePath: videoPath,
        extractedAt: Date.now(),
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      return {
        success: false,
        error: error.message,
        extractionTime: duration,
        filePath: videoPath,
        extractedAt: Date.now(),
        metadata: await this.createFallbackMetadata(videoPath),
      };
    }
  }

  /**
   * Get file system stats
   */
  async getFileStats(videoPath) {
    try {
      const stats = await fs.stat(videoPath);
      return {
        size: stats.size,
        lastModified: stats.mtime.getTime(),
        created: stats.birthtime.getTime(),
      };
    } catch (error) {
      return {
        size: null,
        lastModified: null,
        created: null,
      };
    }
  }

  /**
   * Enhance metadata with additional computed fields
   */
  enhanceMetadata(ffprobeData, fileStats, videoPath) {
    return {
      // Core video properties
      ...ffprobeData,

      // File system properties
      fileSize: fileStats.size || ffprobeData.fileSize,
      lastModified: fileStats.lastModified,
      created: fileStats.created,

      // Additional computed properties
      fileName: path.basename(videoPath),
      extension: path.extname(videoPath).toLowerCase(),

      // Quality indicators
      qualityScore: this.calculateQualityScore(ffprobeData),
      estimatedBitrate: this.estimateBitrate(ffprobeData, fileStats.size),

      // Validation
      hasValidDimensions: !!(ffprobeData.width && ffprobeData.height),
      hasValidDuration: !!(ffprobeData.duration && ffprobeData.duration > 0),

      // Extraction metadata
      extractionVersion: '1.0.0',
    };
  }

  /**
   * Calculate a simple quality score
   */
  calculateQualityScore(metadata) {
    if (!metadata.width || !metadata.height || !metadata.bitrate) {
      return 0;
    }

    const pixels = metadata.width * metadata.height;
    const bitratePerPixel = metadata.bitrate / pixels;

    // Simple scoring based on bitrate per pixel
    if (bitratePerPixel > 0.15) return 5; // Excellent
    if (bitratePerPixel > 0.1) return 4; // Good
    if (bitratePerPixel > 0.05) return 3; // Average
    if (bitratePerPixel > 0.02) return 2; // Poor
    return 1; // Very poor
  }

  /**
   * Estimate bitrate if not available
   */
  estimateBitrate(metadata, fileSize) {
    if (metadata.bitrate || !metadata.duration || !fileSize) {
      return metadata.bitrate;
    }

    // Estimate: fileSize * 8 / duration (convert bytes to bits per second)
    return Math.round((fileSize * 8) / metadata.duration);
  }

  /**
   * Create fallback metadata for failed extractions
   */
  async createFallbackMetadata(videoPath) {
    const fileStats = await this.getFileStats(videoPath);

    return {
      duration: null,
      fileSize: fileStats.size,
      bitrate: null,
      width: null,
      height: null,
      codec: null,
      pixelFormat: null,
      frameRate: null,
      aspectRatio: null,
      resolution: null,
      hasAudio: true, // Assume true
      audioCodec: null,
      audioChannels: null,
      formatName: null,
      title: path.basename(videoPath, path.extname(videoPath)),
      creationTime: fileStats.created,
      lastModified: fileStats.lastModified,
      created: fileStats.created,
      fileName: path.basename(videoPath),
      extension: path.extname(videoPath).toLowerCase(),
      qualityScore: 0,
      estimatedBitrate: null,
      hasValidDimensions: false,
      hasValidDuration: false,
      isValid: false,
      extractionVersion: '1.0.0',
    };
  }

  /**
   * Create error result
   */
  createErrorResult(videoPath, error) {
    return {
      success: false,
      error: error.message,
      filePath: videoPath,
      extractedAt: Date.now(),
      metadata: null,
    };
  }

  /**
   * Generate cache key based on file path and modification time
   */
  async getCacheKey(videoPath) {
    try {
      const stats = await fs.stat(videoPath);
      const keyString = `${videoPath}_${stats.mtime.getTime()}_${stats.size}`;
      return crypto.createHash('md5').update(keyString).digest('hex');
    } catch (error) {
      // Fallback to path-only key
      return crypto.createHash('md5').update(videoPath).digest('hex');
    }
  }

  /**
   * Get cached metadata
   */
  getCachedMetadata(cacheKey) {
    const cached = this.cache.get(cacheKey);

    if (!cached) return null;

    // Check TTL
    if (Date.now() - cached.timestamp > this.config.cacheTTL) {
      this.cache.delete(cacheKey);
      return null;
    }

    return cached.data;
  }

  /**
   * Set cached metadata
   */
  setCachedMetadata(cacheKey, data) {
    // Implement LRU by removing oldest entries when cache is full
    if (this.cache.size >= this.config.cacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Start cache cleanup timer
   */
  startCacheCleanup() {
    setInterval(() => {
      const now = Date.now();
      const toDelete = [];

      for (const [key, value] of this.cache) {
        if (now - value.timestamp > this.config.cacheTTL) {
          toDelete.push(key);
        }
      }

      toDelete.forEach((key) => this.cache.delete(key));

      if (toDelete.length > 0) {
        console.log(`Cache cleanup: removed ${toDelete.length} expired entries`);
      }
    }, this.config.cacheTTL);
  }

  /**
   * Batch extract metadata for multiple files
   */
  async extractMetadataBatch(videoPaths, options = {}) {
    const batchStartTime = Date.now();
    const results = [];
    const concurrency = options.concurrency || this.config.concurrency;

    // Initialize progress tracking
    const progress = {
      total: videoPaths.length,
      completed: 0,
      failed: 0,
      startTime: batchStartTime,
      currentFile: null,
    };

    // Process files in batches with limited concurrency
    for (let i = 0; i < videoPaths.length; i += concurrency) {
      const batch = videoPaths.slice(i, i + concurrency);

      const batchPromises = batch.map(async (videoPath) => {
        progress.currentFile = path.basename(videoPath);
        this.notifyProgress(progress);

        const result = await this.extractMetadata(videoPath, options);

        if (result.success) {
          progress.completed++;
        } else {
          progress.failed++;
        }

        this.notifyProgress(progress);
        return result;
      });

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map((r) => r.value || r.reason));
    }

    const totalTime = Date.now() - batchStartTime;

    return {
      results,
      summary: {
        total: videoPaths.length,
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        totalTime,
        avgTimePerFile: totalTime / videoPaths.length,
        cacheStats: this.getCacheStats(),
      },
    };
  }

  /**
   * Add progress callback
   */
  onProgress(callback) {
    this.progressCallbacks.add(callback);
  }

  /**
   * Remove progress callback
   */
  offProgress(callback) {
    this.progressCallbacks.delete(callback);
  }

  /**
   * Notify progress callbacks
   */
  notifyProgress(progress) {
    this.progressCallbacks.forEach((callback) => {
      try {
        callback(progress);
      } catch (error) {
        console.error('Progress callback error:', error);
      }
    });
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    return {
      ...this.cacheStats,
      hitRate: total > 0 ? (this.cacheStats.hits / total) * 100 : 0,
      cacheSize: this.cache.size,
      maxCacheSize: this.config.cacheSize,
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('Metadata cache cleared');
  }

  /**
   * Get extractor status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      activeExtractions: this.activeExtractions.size,
      cacheStats: this.getCacheStats(),
      ffprobeStatus: this.ffprobe.getStatus(),
      config: this.config,
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.clearCache();
    this.progressCallbacks.clear();
    this.activeExtractions.clear();
    this.isInitialized = false;
  }
}

module.exports = MetadataExtractor;
