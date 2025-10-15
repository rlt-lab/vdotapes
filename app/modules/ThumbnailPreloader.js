/**
 * ThumbnailPreloader - Pre-generates and caches thumbnails ahead of scrolling
 * 
 * This module aggressively pre-generates thumbnails for videos in the buffer zone,
 * ensuring smooth visual transitions when videos are unloaded/reloaded.
 */
class ThumbnailPreloader {
  constructor(options = {}) {
    this.app = options.app;
    this.thumbnailCache = new Map(); // videoId -> thumbnail path
    this.generationQueue = [];
    this.isGenerating = false;
    this.maxConcurrent = options.maxConcurrent || 3;
    this.useFirstFrame = options.useFirstFrame !== false; // Default to first frame
    
    // Statistics
    this.stats = {
      generated: 0,
      cached: 0,
      failed: 0,
      totalGenerationTime: 0
    };
    
    console.log('[ThumbnailPreloader] Initialized with first-frame strategy');
  }

  /**
   * Pre-load thumbnails for a range of videos
   * @param {Array} videos - Array of video objects
   * @param {number} bufferRows - Number of rows to buffer
   * @param {number} itemsPerRow - Items per row
   */
  async preloadForViewport(videos, currentRow, bufferRows, itemsPerRow) {
    if (!videos || videos.length === 0) return;

    // Calculate video indices in buffer zone
    const startRow = Math.max(0, currentRow - bufferRows);
    const endRow = currentRow + bufferRows;
    const startIndex = startRow * itemsPerRow;
    const endIndex = Math.min(videos.length, endRow * itemsPerRow);

    // Get videos in buffer zone
    const bufferedVideos = videos.slice(startIndex, endIndex);
    
    console.log(
      `[ThumbnailPreloader] Pre-loading thumbnails for rows ${startRow}-${endRow} ` +
      `(${bufferedVideos.length} videos)`
    );

    // Filter to only videos that need thumbnails
    const needThumbnails = bufferedVideos.filter(video => 
      !this.thumbnailCache.has(video.id)
    );

    if (needThumbnails.length === 0) {
      console.log('[ThumbnailPreloader] All thumbnails already cached');
      return;
    }

    console.log(`[ThumbnailPreloader] Generating ${needThumbnails.length} new thumbnails`);

    // Add to queue and start generation
    needThumbnails.forEach(video => {
      if (!this.isInQueue(video.id)) {
        this.generationQueue.push(video);
      }
    });

    // Start processing queue if not already running
    if (!this.isGenerating) {
      this.processQueue();
    }
  }

  /**
   * Check if video is in generation queue
   */
  isInQueue(videoId) {
    return this.generationQueue.some(v => v.id === videoId);
  }

  /**
   * Process the generation queue with concurrency limit
   */
  async processQueue() {
    if (this.isGenerating) return;
    
    this.isGenerating = true;
    const activeGenerations = [];

    while (this.generationQueue.length > 0 || activeGenerations.length > 0) {
      // Start new generations up to concurrency limit
      while (
        this.generationQueue.length > 0 && 
        activeGenerations.length < this.maxConcurrent
      ) {
        const video = this.generationQueue.shift();
        const promise = this.generateThumbnail(video);
        activeGenerations.push(promise);
      }

      // Wait for at least one to complete
      if (activeGenerations.length > 0) {
        await Promise.race(activeGenerations);
        // Remove completed promises
        for (let i = activeGenerations.length - 1; i >= 0; i--) {
          if (await this.isPromiseResolved(activeGenerations[i])) {
            activeGenerations.splice(i, 1);
          }
        }
      }
    }

    this.isGenerating = false;
    console.log(
      `[ThumbnailPreloader] Queue complete. Cache size: ${this.thumbnailCache.size}, ` +
      `Generated: ${this.stats.generated}, Failed: ${this.stats.failed}`
    );
  }

  /**
   * Check if promise is resolved
   */
  async isPromiseResolved(promise) {
    try {
      await Promise.race([promise, Promise.resolve()]);
      return true;
    } catch {
      return true;
    }
  }

  /**
   * Generate thumbnail for a single video
   */
  async generateThumbnail(video) {
    if (!video || !video.path) {
      console.warn('[ThumbnailPreloader] Invalid video object');
      return null;
    }

    // Check cache first
    if (this.thumbnailCache.has(video.id)) {
      return this.thumbnailCache.get(video.id);
    }

    const startTime = performance.now();

    try {
      // Try to get existing thumbnail from database
      let thumbnailData = await window.electronAPI.getThumbnail(video.id);

      // If not cached, generate new one
      if (!thumbnailData || !thumbnailData.thumbnail_path) {
        const timestamp = this.useFirstFrame ? 0 : null; // null = auto-detect best frame
        
        const result = await window.electronAPI.generateThumbnail(
          video.path,
          timestamp
        );

        if (result.success && result.thumbnailPath) {
          thumbnailData = { thumbnail_path: result.thumbnailPath };
          this.stats.generated++;
        } else {
          console.error(`[ThumbnailPreloader] Failed to generate for ${video.id}:`, result.error);
          this.stats.failed++;
          return null;
        }
      } else {
        this.stats.cached++;
      }

      // Cache the result
      if (thumbnailData?.thumbnail_path) {
        this.thumbnailCache.set(video.id, thumbnailData.thumbnail_path);
        
        const duration = performance.now() - startTime;
        this.stats.totalGenerationTime += duration;

        console.log(
          `[ThumbnailPreloader] Generated thumbnail for ${video.name} ` +
          `(${duration.toFixed(0)}ms)`
        );

        return thumbnailData.thumbnail_path;
      }

      return null;
    } catch (error) {
      console.error(`[ThumbnailPreloader] Error generating thumbnail for ${video.id}:`, error);
      this.stats.failed++;
      return null;
    }
  }

  /**
   * Get cached thumbnail for a video
   */
  getThumbnail(videoId) {
    return this.thumbnailCache.get(videoId);
  }

  /**
   * Check if thumbnail is cached
   */
  hasThumbnail(videoId) {
    return this.thumbnailCache.has(videoId);
  }

  /**
   * Apply thumbnail to video item element
   */
  applyThumbnail(element, videoId) {
    if (!element) return false;

    const thumbnailPath = this.getThumbnail(videoId);
    if (!thumbnailPath) return false;

    const thumbnailDiv = element.querySelector('.video-thumbnail');
    if (!thumbnailDiv) return false;

    // Set background image
    thumbnailDiv.style.backgroundImage = `url("${thumbnailPath}")`;
    thumbnailDiv.classList.add('loaded');
    thumbnailDiv.classList.remove('hidden');

    // Hide loading text
    const loadingText = thumbnailDiv.querySelector('.thumbnail-loading');
    if (loadingText) {
      loadingText.style.display = 'none';
    }

    return true;
  }

  /**
   * Show thumbnail for video (when unloading)
   */
  showThumbnail(element, videoId) {
    if (!element) return;

    const thumbnailDiv = element.querySelector('.video-thumbnail');
    if (!thumbnailDiv) return;

    // If we have a cached thumbnail, apply it
    if (this.hasThumbnail(videoId)) {
      this.applyThumbnail(element, videoId);
    }

    // Always show the thumbnail div
    thumbnailDiv.classList.remove('hidden');
  }

  /**
   * Hide thumbnail (when video is playing)
   */
  hideThumbnail(element) {
    if (!element) return;

    const thumbnailDiv = element.querySelector('.video-thumbnail');
    if (!thumbnailDiv) return;

    thumbnailDiv.classList.add('hidden');
  }

  /**
   * Clear cache (for memory management)
   */
  clearCache() {
    const size = this.thumbnailCache.size;
    this.thumbnailCache.clear();
    console.log(`[ThumbnailPreloader] Cleared ${size} cached thumbnails`);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.thumbnailCache.size,
      queueSize: this.generationQueue.length,
      isGenerating: this.isGenerating,
      avgGenerationTime: this.stats.generated > 0 
        ? (this.stats.totalGenerationTime / this.stats.generated).toFixed(0) 
        : 0
    };
  }

  /**
   * Log statistics
   */
  logStats() {
    const stats = this.getStats();
    console.log('[ThumbnailPreloader] Statistics:', stats);
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ThumbnailPreloader;
} else {
  window.ThumbnailPreloader = ThumbnailPreloader;
}
