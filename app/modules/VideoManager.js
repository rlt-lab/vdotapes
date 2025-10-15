/**
 * VideoManager - Handles video loading, playback, and lifecycle
 */
class VideoManager {
  constructor(app) {
    this.app = app;
    this.PREVIEW_LOOP_DURATION = 5; // seconds
    this.LOAD_TIMEOUT = 10000; // 10 seconds
    this.MAX_VIDEO_LOAD_RETRIES = 3;
    this.RETRY_BASE_DELAY = 1000; // 1 second
    
    // Recovery mechanism for stuck videos
    this.recoveryCheckInterval = null;
    this.startRecoveryMechanism();
  }

  /**
   * Check if an element is in the viewport
   */
  isInViewport(element) {
    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;

    // Check if element is at least partially visible
    return (
      rect.top < windowHeight &&
      rect.bottom > 0 &&
      rect.left < windowWidth &&
      rect.right > 0
    );
  }

  /**
   * Start periodic check for stuck videos
   */
  startRecoveryMechanism() {
    // Check every 2 seconds for videos that are visible but not loaded (more aggressive)
    this.recoveryCheckInterval = setInterval(() => {
      this.checkAndRecoverStuckVideos();
    }, 2000);
  }

  /**
   * Check for videos that are in viewport but not loaded, and force reload them
   */
  checkAndRecoverStuckVideos() {
    const videoItems = document.querySelectorAll('.video-item');
    let recoveredCount = 0;
    let debugInfo = [];

    videoItems.forEach(item => {
      // Only check videos that are in viewport
      if (!this.isInViewport(item)) return;

      const videoElement = item.querySelector('video');
      const videoId = item.dataset.videoId;
      
      if (!videoElement || !videoId) return;

      // Check video state
      const isLoaded = videoElement.classList.contains('loaded');
      const isLoading = item.classList.contains('loading');
      const isError = item.classList.contains('error');
      const hasSrc = videoElement.src && videoElement.src !== '';
      const hasDataSrc = videoElement.dataset.src && videoElement.dataset.src !== '';

      // Check if video has been stuck in loading state for too long
      const loadingStartTime = parseInt(item.dataset.loadingStartTime || '0');
      const now = Date.now();
      const isStuckInLoading = isLoading && loadingStartTime > 0 && (now - loadingStartTime) > 10000; // 10 seconds (reduced for faster recovery)

      // Video is stuck if:
      // 1. It's in viewport, not loaded, not loading, not error, and has no source
      // 2. OR it's been stuck in loading state for too long
      const isStuckNoSource = !isLoaded && !isLoading && !isError && !hasSrc && hasDataSrc;
      const isStuck = isStuckNoSource || isStuckInLoading;

      if (isStuck) {
        const reason = isStuckInLoading 
          ? `stuck in loading for ${Math.round((now - loadingStartTime) / 1000)}s` 
          : 'no source';
        
        debugInfo.push({
          videoId,
          reason,
          isLoaded,
          isLoading,
          isError,
          hasSrc,
          hasDataSrc
        });

        console.warn(`[VideoManager] Detected stuck video: ${videoId} (${reason})`);
        
        // Clear stuck state
        item.classList.remove('loading');
        item.dataset.loadingStartTime = '';
        
        // Force reload the video
        const src = videoElement.dataset.src;
        if (src) {
          console.log(`[VideoManager] Recovering stuck video: ${videoId}`);
          videoElement.src = ''; // Clear any partial load
          this.loadVideo(videoElement, item, 0);
          recoveredCount++;
        }
      } else if (isLoading && !loadingStartTime) {
        // Track when loading started for future checks
        item.dataset.loadingStartTime = Date.now().toString();
      }
    });

    if (recoveredCount > 0) {
      console.log(`[VideoManager] Recovered ${recoveredCount} stuck videos:`, debugInfo);
    }
  }

  /**
   * Stop recovery mechanism (cleanup)
   */
  stopRecoveryMechanism() {
    if (this.recoveryCheckInterval) {
      clearInterval(this.recoveryCheckInterval);
      this.recoveryCheckInterval = null;
    }
  }

  handleVideoVisible(videoElement, container) {
    if (!videoElement.src && videoElement.dataset.src) {
      this.loadVideo(videoElement, container);
    } else if (videoElement.src && videoElement.paused) {
      this.resumeVideo(videoElement);
    }
  }

  async loadVideo(videoElement, container, retryCount = 0) {
    const src = videoElement.dataset.src;
    if (!src || videoElement.src) return;

    // Check if we're approaching the WebMediaPlayer limit
    if (this.app.smartLoader) {
      const stats = this.app.smartLoader.getStats();
      if (stats.loadedVideos >= 18) {
        console.warn('[LoadVideo] Approaching WebMediaPlayer limit, forcing cleanup');
        this.app.smartLoader.forceCleanup();
      }
    }

    const currentRetries = parseInt(container.dataset.retryCount || '0', 10);

    container.classList.add('loading');
    container.classList.remove('error');

    try {
      videoElement.src = src;
      videoElement.preload = 'metadata';

      const videoIndex = Array.from(container.parentElement.children).indexOf(container);
      const video = this.app.displayedVideos[videoIndex];
      if (video) {
        videoElement.title = video.name;
        container.title = video.name;
      }

      const handleLoad = () => {
        container.classList.remove('loading');
        container.classList.remove('error');
        videoElement.classList.add('loaded');

        container.dataset.retryCount = '0';

        const retryBtn = container.querySelector('.retry-button');
        if (retryBtn) retryBtn.remove();

        const videoIndex = Array.from(container.parentElement.children).indexOf(container);
        const video = this.app.displayedVideos[videoIndex];
        if (video) {
          videoElement.title = video.name;
          container.title = video.name;
        }

        // Hide thumbnail when video loads successfully (smooth fade)
        if (this.app.thumbnailPreloader) {
          this.app.thumbnailPreloader.hideThumbnail(container);
        }

        this.startVideoPlayback(videoElement);
      };

      const handleError = async (event) => {
        container.classList.remove('loading');

        const nextRetryCount = currentRetries + 1;
        container.dataset.retryCount = String(nextRetryCount);

        console.warn(`Video load error (attempt ${nextRetryCount}/${this.MAX_VIDEO_LOAD_RETRIES}):`, src, event);

        if (nextRetryCount < this.MAX_VIDEO_LOAD_RETRIES) {
          const delay = this.RETRY_BASE_DELAY * Math.pow(2, nextRetryCount - 1);
          console.log(`Retrying video load in ${delay}ms...`);

          videoElement.src = '';

          setTimeout(() => {
            this.loadVideo(videoElement, container, nextRetryCount);
          }, delay);
        } else {
          container.classList.add('error');
          console.error(`Failed to load video after ${this.MAX_VIDEO_LOAD_RETRIES} attempts:`, src);

          // Keep thumbnail visible on error
          const thumbnail = container.querySelector('.video-thumbnail');
          if (thumbnail) {
            thumbnail.classList.remove('hidden');
          }

          this.addRetryButton(container, videoElement);
        }
      };

      videoElement.addEventListener('loadedmetadata', handleLoad, { once: true });
      videoElement.addEventListener('error', handleError, { once: true });

      setTimeout(() => {
        if (container.classList.contains('loading')) {
          console.warn('Video load timeout:', src);
          handleError({ type: 'timeout' });
        }
      }, this.LOAD_TIMEOUT);
    } catch (error) {
      container.classList.remove('loading');
      container.classList.add('error');
      console.error('Error setting video source:', error);

      this.addRetryButton(container, videoElement);
    }
  }

  addRetryButton(container, videoElement) {
    if (container.querySelector('.retry-button')) return;

    const retryButton = document.createElement('button');
    retryButton.className = 'retry-button';
    retryButton.innerHTML = `
      <svg viewBox="0 0 24 24" width="24" height="24">
        <path fill="currentColor" d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
      </svg>
      <span>Retry</span>
    `;
    retryButton.title = 'Click to retry loading this video';

    retryButton.addEventListener('click', (e) => {
      e.stopPropagation();
      container.dataset.retryCount = '0';
      retryButton.remove();
      videoElement.src = '';
      this.loadVideo(videoElement, container, 0);
    });

    container.appendChild(retryButton);
  }

  startVideoPlayback(videoElement) {
    try {
      if (isNaN(videoElement.duration) || videoElement.duration === null) {
        console.warn('Invalid video duration, playing normally:', videoElement.src);
        videoElement.play().catch(() => {});
        return;
      }

      if (videoElement.duration && videoElement.duration > 20) {
        this.setupPreviewLoop(videoElement);
      } else {
        videoElement.play().catch(() => {});
      }
    } catch (error) {
      console.warn('Error starting video playback:', error);
      videoElement.play().catch(() => {});
    }
  }

  resumeVideo(videoElement) {
    if (videoElement.paused && videoElement.src) {
      if (videoElement.duration && videoElement.duration > 20 && !videoElement._loopHandler) {
        this.setupPreviewLoop(videoElement);
      } else {
        videoElement.play().catch(() => {});
      }
    }
  }

  setupPreviewLoop(video) {
    const duration = video.duration;
    if (!duration || isNaN(duration) || duration <= 0) {
      console.warn('Cannot setup preview loop: invalid duration', duration);
      video.play().catch(() => {});
      return;
    }

    const midpoint = duration / 2;
    const halfDuration = this.PREVIEW_LOOP_DURATION / 2;
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

    const playAfterSeek = () => {
      video.play().catch((err) => {
        console.warn('Could not autoplay video:', err);
      });
    };

    video.addEventListener('seeked', playAfterSeek, { once: true });

    video.currentTime = start;
  }

  pauseVideo(videoElement) {
    if (!videoElement.paused) {
      videoElement.pause();
    }
  }

  loadVideoById(videoId) {
    const item = document.querySelector(`.video-item[data-video-id="${videoId}"]`);
    if (!item) return;

    const video = item.querySelector('video');
    if (!video || video.src) return;

    this.loadVideo(video, item);
  }

  unloadVideoById(videoId) {
    const item = document.querySelector(`.video-item[data-video-id="${videoId}"]`);
    if (!item) return;

    const videoElement = item.querySelector('video');
    if (!videoElement) return;

    if (videoElement.src) {
      videoElement.pause();
      videoElement.src = '';
      videoElement.load();

      if (videoElement._loopHandler) {
        videoElement.removeEventListener('timeupdate', videoElement._loopHandler);
        videoElement._loopHandler = null;
      }

      item.classList.remove('loading');
      videoElement.classList.remove('loaded');

      if (this.app.smartLoader) {
        this.app.smartLoader.loadedVideos.delete(videoId);
        this.app.smartLoader.activeVideos.delete(videoId);
      }
    }
  }

  async loadThumbnailsForVisibleVideos() {
    const videoItems = document.querySelectorAll('.video-item');
    const visibleItems = Array.from(videoItems).slice(0, 50); // First 50 videos

    for (const item of visibleItems) {
      const videoId = item.dataset.videoId;
      const videoElement = item.querySelector('video');
      const thumbnailElement = item.querySelector('.video-thumbnail');
      
      if (!videoElement || !thumbnailElement || !videoId) continue;

      // Skip if video is already loaded
      if (videoElement.classList.contains('loaded')) {
        thumbnailElement.classList.add('hidden');
        continue;
      }

      try {
        // Try to get cached thumbnail first
        let thumbnailData = await window.api.getThumbnail(videoId);
        
        // If not cached, generate it (async, don't block)
        if (!thumbnailData) {
          const videoPath = videoElement.dataset.src;
          if (videoPath) {
            // Generate at 10% into the video for better preview
            const result = await window.api.generateThumbnail(videoPath, null);
            if (result.success && result.thumbnailPath) {
              thumbnailData = { thumbnail_path: result.thumbnailPath };
            }
          }
        }
        
        // Set thumbnail background
        if (thumbnailData?.thumbnail_path) {
          thumbnailElement.style.setProperty('--thumbnail-url', `url("${thumbnailData.thumbnail_path}")`);
          thumbnailElement.classList.add('loaded');
          
          // Hide loading text
          const loadingText = thumbnailElement.querySelector('.thumbnail-loading');
          if (loadingText) {
            loadingText.style.display = 'none';
          }
        }
      } catch (error) {
        console.error(`Failed to load thumbnail for ${videoId}:`, error);
        // Leave loading state visible
      }
    }
  }

  /**
   * Cleanup method - stop recovery mechanism
   */
  cleanup() {
    this.stopRecoveryMechanism();
    console.log('[VideoManager] Cleanup complete');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoManager;
} else {
  window.VideoManager = VideoManager;
}
