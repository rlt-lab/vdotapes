/**
 * Video Grid Virtualizer - Preserves original grid design while handling large collections
 * Optimized for 4000+ videos without memory issues
 */

class VideoGridVirtualizer {
  constructor(options = {}) {
    this.itemHeight = options.itemHeight || 300;
    this.buffer = options.buffer || 3; // Number of rows to render outside viewport
    this.container = null;
    this.scrollContainer = null;
    this.videos = [];
    this.itemsPerRow = options.itemsPerRow || 4;

    // Virtualization state
    this.startIndex = 0;
    this.endIndex = 0;
    this.totalRows = 0;
    this.visibleRows = 0;

    // Callbacks
    this.onVideoClick = options.onVideoClick || (() => {});
    this.onFavoriteToggle = options.onFavoriteToggle || (() => {});
    this.isFavorite = options.isFavorite || (() => false);
    this.formatFileSize = options.formatFileSize || ((size) => size + 'B');

    // Performance tracking
    this.lastScrollTime = 0;
    this.scrollThrottle = 16; // ~60fps

    this.init();
  }

  init() {
    this.setupScrollHandler();
  }

  setContainer(container) {
    this.container = container;

    // Find the scroll container (look up the DOM tree for scrollable element)
    let scrollParent = container.parentElement;
    while (scrollParent && scrollParent !== document.body) {
      const style = window.getComputedStyle(scrollParent);
      if (
        style.overflow === 'auto' ||
        style.overflow === 'scroll' ||
        style.overflowY === 'auto' ||
        style.overflowY === 'scroll'
      ) {
        break;
      }
      scrollParent = scrollParent.parentElement;
    }
    this.scrollContainer = scrollParent || window;

    console.log(
      'Virtualizer container set, scroll container:',
      this.scrollContainer === window ? 'window' : this.scrollContainer.tagName
    );
    this.updateLayout();
  }

  setVideos(videos) {
    this.videos = videos;
    this.totalRows = Math.ceil(videos.length / this.itemsPerRow);
    this.updateLayout();
  }

  setItemsPerRow(itemsPerRow) {
    this.itemsPerRow = itemsPerRow;
    this.totalRows = Math.ceil(this.videos.length / this.itemsPerRow);
    this.updateLayout();
  }

  updateLayout() {
    if (!this.container || this.videos.length === 0) return;

    this.calculateVisibleRange();
    this.renderVisibleItems();
  }

  calculateVisibleRange() {
    const scrollTop =
      this.scrollContainer === window ? window.pageYOffset : this.scrollContainer.scrollTop;
    const containerHeight =
      this.scrollContainer === window ? window.innerHeight : this.scrollContainer.clientHeight;

    // Calculate which rows are visible
    const startRow = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.buffer);
    const endRow = Math.ceil((scrollTop + containerHeight) / this.itemHeight) + this.buffer;

    // Convert to item indices
    this.startIndex = Math.max(0, startRow * this.itemsPerRow);
    this.endIndex = Math.min(this.videos.length, endRow * this.itemsPerRow);
    this.visibleRows = Math.ceil((this.endIndex - this.startIndex) / this.itemsPerRow);

    // Ensure we always render at least one full screen worth of videos on initial load
    if (this.endIndex - this.startIndex < this.itemsPerRow * 4) {
      this.endIndex = Math.min(this.videos.length, this.startIndex + this.itemsPerRow * 6);
    }
  }

  renderVisibleItems() {
    const visibleVideos = this.videos.slice(this.startIndex, this.endIndex);
    const offsetTop = Math.floor(this.startIndex / this.itemsPerRow) * this.itemHeight;
    const totalHeight = this.totalRows * this.itemHeight;

    // Create grid structure that preserves original styling
    const gridHTML = `
            <div class="virtual-spacer-top" style="height: ${offsetTop}px;"></div>
            <div class="video-grid virtual-grid" style="--grid-cols: ${this.itemsPerRow};">
                ${visibleVideos
                  .map((video, index) => this.createVideoItemHTML(video, this.startIndex + index))
                  .join('')}
            </div>
            <div class="virtual-spacer-bottom" style="height: ${totalHeight - offsetTop - this.visibleRows * this.itemHeight}px;"></div>
        `;

    this.container.innerHTML = gridHTML;
    this.attachEventListeners();
    this.resetObserver();
  }

  createVideoItemHTML(video, index) {
    const isFavorited = this.isFavorite(video.id);
    return `
            <div class="video-item" data-index="${index}" data-video-id="${video.id}" title="${video.folder || 'Root folder'}">
                <video 
                    data-src="${video.path}"
                    data-duration=""
                    muted 
                    loop
                    preload="none"
                    title="${video.folder || 'Root folder'}"
                ></video>
                <button class="video-favorite ${isFavorited ? 'favorited' : ''}" data-video-id="${video.id}">
                    <svg viewBox="0 0 24 24" class="heart-icon">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                </button>
                <div class="video-overlay">
                    <div class="video-name" title="${video.folder || 'Root folder'}">
                        ${video.folder || 'Root folder'}
                    </div>
                    <div class="video-info">
                        <span>${this.formatFileSize(video.size)}</span>
                    </div>
                </div>
            </div>
        `;
  }

  attachEventListeners() {
    // Video clicks
    const videoItems = this.container.querySelectorAll('.video-item');
    videoItems.forEach((item) => {
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.video-favorite')) {
          const index = parseInt(item.dataset.index);
          this.onVideoClick(this.videos[index], index);
        }
      });
    });

    // Favorite buttons
    const favoriteButtons = this.container.querySelectorAll('.video-favorite');
    favoriteButtons.forEach((button) => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const videoId = button.dataset.videoId;
        this.onFavoriteToggle(videoId, e);
      });
    });
  }

  setupIntersectionObserver() {
    if (!this.observer) {
      this.observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const video = entry.target.querySelector('video');
            if (!video) return;

            if (entry.isIntersecting) {
              // Resume playback if video was previously loaded
              if (video.src && video.paused) {
                this.resumeVideo(video);
              } else if (!video.src) {
                // Load video if not loaded yet
                this.loadVideo(video, entry.target);
              }
            } else {
              // Only pause if video is far out of view to prevent scroll pausing
              if (entry.intersectionRatio === 0 && entry.boundingClientRect.bottom < -100) {
                this.pauseVideo(video);
              }
            }
          });
        },
        {
          root: null,
          rootMargin: '300px', // Even larger margin to prevent pause/resume cycling
          threshold: [0, 0.1], // Simplified thresholds
        }
      );
    }

    // Observe visible video items
    const videoItems = this.container.querySelectorAll('.video-item');
    videoItems.forEach((item) => this.observer.observe(item));
  }

  loadVideo(videoElement, container) {
    const src = videoElement.dataset.src;
    if (!src || videoElement.src) return;

    container.classList.add('loading');

    videoElement.src = src;
    videoElement.preload = 'metadata';

    const handleLoad = () => {
      container.classList.remove('loading');
      videoElement.classList.add('loaded');
      this.startVideoPlayback(videoElement);
    };

    const handleError = () => {
      container.classList.remove('loading');
      container.classList.add('error');
    };

    videoElement.addEventListener('loadedmetadata', handleLoad, { once: true });
    videoElement.addEventListener('error', handleError, { once: true });
  }

  startVideoPlayback(videoElement) {
    try {
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

  resumeVideo(videoElement) {
    if (videoElement.paused && videoElement.src) {
      if (videoElement.duration && videoElement.duration > 20 && !videoElement._loopHandler) {
        this.setupPreviewLoop(videoElement);
      } else {
        videoElement.play().catch(() => {});
      }
    }
  }

  pauseVideo(videoElement) {
    if (!videoElement.paused) {
      videoElement.pause();
    }

    // Don't clean up loop handler - keep it for resume
    // Only clean up when video is completely out of view for a long time
  }

  setupScrollHandler() {
    const handleScroll = () => {
      const now = performance.now();
      if (now - this.lastScrollTime < this.scrollThrottle) return;

      this.lastScrollTime = now;
      this.updateLayout();
    };

    // Use passive listener for better performance
    if (this.scrollContainer === window) {
      window.addEventListener('scroll', handleScroll, { passive: true });
    } else if (this.scrollContainer) {
      this.scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    }

    // Also handle resize
    window.addEventListener(
      'resize',
      () => {
        setTimeout(() => this.updateLayout(), 100);
      },
      { passive: true }
    );

    // Trigger initial layout after a short delay to ensure DOM is ready
    setTimeout(() => {
      this.updateLayout();
    }, 100);
  }

  // Performance monitoring
  getStats() {
    return {
      totalVideos: this.videos.length,
      visibleVideos: this.endIndex - this.startIndex,
      totalRows: this.totalRows,
      visibleRows: this.visibleRows,
      startIndex: this.startIndex,
      endIndex: this.endIndex,
      memoryEfficiency: `${(((this.endIndex - this.startIndex) / this.videos.length) * 100).toFixed(1)}%`,
    };
  }

  // Cleanup
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // Clean up event listeners would be handled by removing container content
    this.videos = [];
    this.container = null;
    this.scrollContainer = null;
  }

  // Reset observer when content changes
  resetObserver() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.setupIntersectionObserver();
  }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoGridVirtualizer;
} else {
  window.VideoGridVirtualizer = VideoGridVirtualizer;
}
