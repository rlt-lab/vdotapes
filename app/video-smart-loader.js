/**
 * Smart Video Loader - Lightweight alternative to heavy virtualization
 * Renders all videos but intelligently manages video loading and playback
 */

class VideoSmartLoader {
  constructor(options = {}) {
    this.loadBuffer = options.loadBuffer || 20; // Videos to keep loaded above/below viewport
    this.observer = null;
    this.loadedVideos = new Set();
    this.activeVideos = new Set();
    this.maxActiveVideos = options.maxActiveVideos || 30;

    // Performance tracking
    this.lastCleanup = Date.now();
    this.cleanupInterval = 3000; // 3 seconds - aggressive cleanup

    this.init();
  }

  init() {
    this.setupIntersectionObserver();
    this.startPeriodicCleanup();
  }

  setupIntersectionObserver() {
    // Simple, fast observer - just for loading/unloading
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const video = entry.target.querySelector('video');
          if (!video) {
            console.warn('[SmartLoader] Video element not found in item:', entry.target);
            return;
          }

          const videoId = entry.target.dataset.videoId;
          if (!videoId) {
            console.warn('[SmartLoader] Video ID not found on item');
            return;
          }

          if (entry.isIntersecting) {
            // Load and play video
            this.loadVideo(video, entry.target, videoId);
          } else {
            // Just pause, don't unload immediately
            this.pauseVideo(video, videoId);
          }
        });
      },
      {
        root: null,
        rootMargin: '500px', // Large margin for smooth loading
        threshold: 0.1,
      }
    );
  }

  observeVideoItems(container) {
    // Disconnect old observations to prevent memory leaks and ensure clean state
    if (this.observer) {
      this.observer.disconnect();
      
      // CRITICAL: Actually unload all videos before clearing tracking
      // This prevents WebMediaPlayer limit from being exceeded
      console.log(`[SmartLoader] Unloading ${this.loadedVideos.size} videos before re-render`);
      
      const oldVideoItems = document.querySelectorAll('.video-item');
      oldVideoItems.forEach((item) => {
        const videoId = item.dataset.videoId;
        const video = item.querySelector('video');
        
        if (video && video.src && videoId && this.loadedVideos.has(videoId)) {
          // Unload the video to free WebMediaPlayer
          video.pause();
          video.src = '';
          video.load(); // Critical: releases WebMediaPlayer
          
          if (video._loopHandler) {
            video.removeEventListener('timeupdate', video._loopHandler);
            video._loopHandler = null;
          }
          
          item.classList.remove('loading');
          video.classList.remove('loaded');
        }
      });
      
      // Now clear the tracking Sets
      this.loadedVideos.clear();
      this.activeVideos.clear();
    }
    
    const videoItems = container.querySelectorAll('.video-item');
    videoItems.forEach((item) => {
      this.observer.observe(item);
    });
    
    console.log(`[SmartLoader] Observing ${videoItems.length} video items (state cleared, videos unloaded)`);
  }

  loadVideo(videoElement, container, videoId) {
    const src = videoElement.dataset.src;
    if (!src) return;

    // Check if video is loaded and has the correct source
    const currentSrc = videoElement.src || '';
    const hasCorrectSrc = currentSrc && currentSrc.includes(src);
    
    // If video is already loaded with correct src, just resume
    if (this.loadedVideos.has(videoId) && hasCorrectSrc) {
      this.resumeVideo(videoElement, videoId);
      return;
    }

    // Load or reload video (handles both first load and re-load after cleanup)
    if (!hasCorrectSrc) {
      container.classList.add('loading');
      container.classList.remove('error');

      // Ensure video attributes are set correctly for reload
      videoElement.muted = true;
      videoElement.loop = true;
      videoElement.preload = 'metadata';
      videoElement.src = src;
      videoElement.load(); // Explicitly trigger load

      const handleLoad = () => {
        container.classList.remove('loading');
        videoElement.classList.add('loaded');
        this.loadedVideos.add(videoId);
        this.startVideoPlayback(videoElement, videoId);
      };

      const handleError = () => {
        container.classList.remove('loading');
        container.classList.add('error');
      };

      videoElement.addEventListener('loadedmetadata', handleLoad, { once: true });
      videoElement.addEventListener('error', handleError, { once: true });
    } else {
      this.resumeVideo(videoElement, videoId);
    }
  }

  startVideoPlayback(videoElement, videoId) {
    try {
      this.activeVideos.add(videoId);

      if (videoElement.duration && videoElement.duration > 20) {
        this.setupPreviewLoop(videoElement);
      } else {
        videoElement.play().catch(() => {});
      }
    } catch (error) {
      videoElement.play().catch(() => {});
    }
  }

  setupPreviewLoop(video) {
    const duration = video.duration;
    if (!duration || isNaN(duration) || duration <= 0) {
      video.play().catch(() => {});
      return;
    }

    const midpoint = duration / 2;
    const halfDuration = 2.5; // 5 second preview
    const start = Math.max(0, midpoint - halfDuration);
    const end = Math.min(duration, midpoint + halfDuration);

    if (video._loopHandler) {
      video.removeEventListener('timeupdate', video._loopHandler);
    }

    const loopHandler = () => {
      if (video.currentTime >= end) {
        video.currentTime = start;
      }
    };

    video._loopHandler = loopHandler;
    video.addEventListener('timeupdate', loopHandler);

    video.addEventListener('seeked', () => video.play().catch(() => {}), { once: true });
    video.currentTime = start;
  }

  resumeVideo(videoElement, videoId) {
    if (videoElement.paused && videoElement.src) {
      this.activeVideos.add(videoId);

      if (videoElement.duration && videoElement.duration > 20 && !videoElement._loopHandler) {
        this.setupPreviewLoop(videoElement);
      } else {
        videoElement.play().catch(() => {});
      }
    }
  }

  pauseVideo(videoElement, videoId) {
    if (!videoElement.paused) {
      videoElement.pause();
    }
    this.activeVideos.delete(videoId);
  }

  startPeriodicCleanup() {
    setInterval(() => {
      this.performCleanup();
    }, this.cleanupInterval);
    
    // Also cleanup on every scroll (throttled)
    let scrollTimeout;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        this.performCleanup();
      }, 500);
    }, { passive: true });
  }

  performCleanup() {
    // More aggressive cleanup - start cleaning when we're close to the limit
    const threshold = Math.floor(this.maxActiveVideos * 0.8); // 80% of max
    
    if (this.loadedVideos.size >= threshold) {
      const videoItems = document.querySelectorAll('.video-item');
      const visibleVideos = new Set();

      // Find currently visible videos (must match IntersectionObserver rootMargin)
      videoItems.forEach((item) => {
        const rect = item.getBoundingClientRect();
        const bufferZone = 500; // Match IntersectionObserver rootMargin
        const isVisible = rect.top < window.innerHeight + bufferZone && rect.bottom > -bufferZone;

        if (isVisible) {
          const videoId = item.dataset.videoId;
          if (videoId) {
            visibleVideos.add(videoId);
          }
        }
      });

      let unloadedCount = 0;
      
      // Clean up non-visible videos
      videoItems.forEach((item) => {
        const videoId = item.dataset.videoId;
        if (!videoId) return;
        
        const video = item.querySelector('video');

        if (!visibleVideos.has(videoId) && this.loadedVideos.has(videoId)) {
          // Unload video to free memory
          if (video && video.src) {
            video.pause();
            video.src = '';
            video.load(); // Reset video element - releases WebMediaPlayer

            if (video._loopHandler) {
              video.removeEventListener('timeupdate', video._loopHandler);
              video._loopHandler = null;
            }
            
            unloadedCount++;
          }

          this.loadedVideos.delete(videoId);
          this.activeVideos.delete(videoId);
          item.classList.remove('loading');
          video?.classList.remove('loaded');
        }
      });

      if (unloadedCount > 0) {
        console.log(
          `[SmartLoader] Cleanup: Unloaded ${unloadedCount} videos. ` +
          `Now: ${this.loadedVideos.size} loaded, ${this.activeVideos.size} active (max: ${this.maxActiveVideos})`
        );
      }
    }
  }

  // Public methods
  getStats() {
    return {
      loadedVideos: this.loadedVideos.size,
      activeVideos: this.activeVideos.size,
      maxActiveVideos: this.maxActiveVideos,
    };
  }

  // Force cleanup (can be called manually when approaching WebMediaPlayer limit)
  forceCleanup() {
    console.log('[SmartLoader] Force cleanup triggered');
    this.performCleanup();
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    this.loadedVideos.clear();
    this.activeVideos.clear();
  }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoSmartLoader;
} else {
  window.VideoSmartLoader = VideoSmartLoader;
}
