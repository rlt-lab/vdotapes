/**
 * WASM-Powered Video Loader - Reliable video loading using Rust-based viewport calculation
 * 
 * Benefits over IntersectionObserver approach:
 * - Deterministic viewport calculation (no browser quirks)
 * - LRU-based video unloading
 * - Better state tracking
 * - Handles scroll-back reliably
 * - Integrates with renderer's retry logic
 */

class VideoWasmLoader {
  constructor(options = {}) {
    this.renderer = options.renderer; // Reference to VdoTapesApp instance
    this.wasmEngine = options.wasmEngine; // VideoGridEngine instance
    this.maxActiveVideos = options.maxActiveVideos || 20;
    this.itemHeight = options.itemHeight || 300;
    this.itemsPerRow = options.itemsPerRow || 4;
    this.bufferRows = options.bufferRows || 3;
    
    // State tracking
    this.isInitialized = false;
    this.scrollHandler = null;
    this.lastScrollTime = 0;
    this.scrollThrottle = 100; // ms
    this.rafId = null;
    
    console.log('[WasmLoader] Initialized with WASM engine support');
  }

  /**
   * Initialize the loader with the current grid
   */
  init(container) {
    if (!this.wasmEngine) {
      console.warn('[WasmLoader] WASM engine not available, cannot initialize');
      return false;
    }

    this.container = container;
    this.isInitialized = true;
    
    // Set up scroll handling
    this.setupScrollHandler();
    
    // Initial viewport calculation
    this.updateViewport();
    
    return true;
  }

  /**
   * Set up scroll event handling with throttling
   */
  setupScrollHandler() {
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
    }

    this.scrollHandler = () => {
      const now = Date.now();
      if (now - this.lastScrollTime < this.scrollThrottle) {
        return;
      }
      
      this.lastScrollTime = now;
      
      // Use requestAnimationFrame for smooth updates
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
      }
      
      this.rafId = requestAnimationFrame(() => {
        this.updateViewport();
      });
    };

    window.addEventListener('scroll', this.scrollHandler, { passive: true });
    console.log('[WasmLoader] Scroll handler attached');
  }

  /**
   * Update viewport and load/unload videos accordingly
   */
  updateViewport() {
    if (!this.isInitialized || !this.wasmEngine || !this.container) {
      return;
    }

    try {
      // Calculate viewport using WASM
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const viewportHeight = window.innerHeight;
      
      const result = this.wasmEngine.calculateViewport(
        scrollTop,
        viewportHeight,
        this.itemHeight,
        this.itemsPerRow,
        this.bufferRows
      );

      // Get videos to load
      const videosToLoad = this.wasmEngine.getVideosToLoad();
      
      // Get videos to unload if we're over the limit
      const videosToUnload = this.wasmEngine.getVideosToUnload(this.maxActiveVideos);

      // Unload videos first to free resources
      videosToUnload.forEach(videoId => {
        this.unloadVideo(videoId);
      });

      // Load new videos
      videosToLoad.forEach(videoId => {
        this.loadVideo(videoId);
      });

      // Log stats
      const stats = this.wasmEngine.getStats();
      if (videosToLoad.length > 0 || videosToUnload.length > 0) {
        console.log(
          `[WasmLoader] Viewport update: +${videosToLoad.length} -${videosToUnload.length} ` +
          `(${stats.loadedVideos}/${this.maxActiveVideos} loaded)`
        );
      }
    } catch (error) {
      console.error('[WasmLoader] Error updating viewport:', error);
    }
  }

  /**
   * Load a video by ID using renderer's robust load method
   */
  loadVideo(videoId) {
    const container = this.container.querySelector(`[data-video-id="${videoId}"]`);
    if (!container) {
      console.warn(`[WasmLoader] Container not found for video: ${videoId}`);
      return;
    }

    const videoElement = container.querySelector('video');
    if (!videoElement) {
      console.warn(`[WasmLoader] Video element not found for: ${videoId}`);
      return;
    }

    const src = videoElement.dataset.src;
    if (!src) {
      console.warn(`[WasmLoader] No data-src for video: ${videoId}`);
      return;
    }

    // Check if already loaded and playing
    if (videoElement.src && !videoElement.paused) {
      return; // Already loaded and playing
    }

    // If loaded but paused, just resume
    if (videoElement.src && videoElement.paused) {
      if (this.renderer && this.renderer.resumeVideo) {
        this.renderer.resumeVideo(videoElement);
      } else {
        videoElement.play().catch(() => {});
      }
      return;
    }

    // Load the video
    // Use renderer's loadVideo for retry logic and proper error handling
    if (this.renderer && this.renderer.loadVideo) {
      // The renderer's loadVideo is async but doesn't return a promise
      // We'll handle marking as loaded via the video's loadedmetadata event
      const handleLoadSuccess = () => {
        this.wasmEngine.markVideoLoaded(videoId);
        videoElement.removeEventListener('loadedmetadata', handleLoadSuccess);
        videoElement.removeEventListener('error', handleLoadError);
      };
      
      const handleLoadError = () => {
        this.wasmEngine.markVideoError(videoId);
        videoElement.removeEventListener('loadedmetadata', handleLoadSuccess);
        videoElement.removeEventListener('error', handleLoadError);
      };
      
      videoElement.addEventListener('loadedmetadata', handleLoadSuccess, { once: true });
      videoElement.addEventListener('error', handleLoadError, { once: true });
      
      this.renderer.loadVideo(videoElement, container);
    } else {
      // Fallback to simple loading
      this.simpleLoadVideo(videoElement, container, videoId);
    }
  }

  /**
   * Simple video loading (fallback when renderer not available)
   */
  simpleLoadVideo(videoElement, container, videoId) {
    const src = videoElement.dataset.src;
    if (!src) return;

    container.classList.add('loading');
    videoElement.src = src;
    videoElement.preload = 'metadata';

    const handleLoad = () => {
      container.classList.remove('loading');
      videoElement.classList.add('loaded');
      this.wasmEngine.markVideoLoaded(videoId);
      
      // Start playback
      if (videoElement.duration > 20 && this.renderer && this.renderer.setupPreviewLoop) {
        this.renderer.setupPreviewLoop(videoElement);
      } else {
        videoElement.play().catch(() => {});
      }
    };

    const handleError = () => {
      container.classList.remove('loading');
      container.classList.add('error');
      this.wasmEngine.markVideoError(videoId);
    };

    videoElement.addEventListener('loadedmetadata', handleLoad, { once: true });
    videoElement.addEventListener('error', handleError, { once: true });
  }

  /**
   * Unload a video to free resources
   */
  unloadVideo(videoId) {
    const container = this.container.querySelector(`[data-video-id="${videoId}"]`);
    if (!container) return;

    const videoElement = container.querySelector('video');
    if (!videoElement || !videoElement.src) return;

    // Pause and clear
    videoElement.pause();
    videoElement.src = '';
    videoElement.load(); // Critical: releases WebMediaPlayer

    // Clean up loop handler if exists
    if (videoElement._loopHandler) {
      videoElement.removeEventListener('timeupdate', videoElement._loopHandler);
      delete videoElement._loopHandler;
    }

    container.classList.remove('loading');
    videoElement.classList.remove('loaded');

    console.log(`[WasmLoader] Unloaded video: ${videoId}`);
  }

  /**
   * Update grid configuration (e.g., column count changed)
   */
  updateGridConfig(itemsPerRow) {
    this.itemsPerRow = itemsPerRow;
    if (this.isInitialized) {
      this.updateViewport();
    }
  }

  /**
   * Force reload all visible videos (useful after re-render)
   */
  forceReloadVisible() {
    if (!this.isInitialized || !this.wasmEngine) return;

    try {
      const videosToLoad = this.wasmEngine.getVideosToLoad();
      console.log(`[WasmLoader] Force reloading ${videosToLoad.length} visible videos`);
      
      videosToLoad.forEach(videoId => {
        this.loadVideo(videoId);
      });
    } catch (error) {
      console.error('[WasmLoader] Error in force reload:', error);
    }
  }

  /**
   * Get current statistics
   */
  getStats() {
    if (!this.wasmEngine) {
      return {
        loadedVideos: 0,
        inViewport: 0,
        maxActiveVideos: this.maxActiveVideos
      };
    }

    const stats = this.wasmEngine.getStats();
    return {
      ...stats,
      maxActiveVideos: this.maxActiveVideos
    };
  }

  /**
   * Cleanup and destroy
   */
  destroy() {
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.isInitialized = false;
    console.log('[WasmLoader] Destroyed');
  }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoWasmLoader;
} else {
  window.VideoWasmLoader = VideoWasmLoader;
}
