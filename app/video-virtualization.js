/**
 * Video Virtualization System
 * Only renders videos visible in viewport to reduce memory usage and improve performance
 */

class VirtualizedVideoGrid {
  constructor(container, options = {}) {
    this.container = container;
    this.itemHeight = options.itemHeight || 300;
    this.itemsPerRow = options.itemsPerRow || 4;
    this.buffer = options.buffer || 2; // Rows to render outside viewport
    this.maxPoolSize = options.maxPoolSize || 50;

    this.allVideos = [];
    this.visibleVideos = [];
    this.scrollTop = 0;
    this.viewportHeight = container.clientHeight;
    this.totalHeight = 0;

    // Element pooling for performance
    this.elementPool = new VideoElementPool(this.maxPoolSize);
    this.activeElements = new Map(); // videoId -> element

    // Create virtual container structure
    this.setupVirtualContainer();
    this.setupScrollHandling();
    this.setupResizeObserver();
  }

  setupVirtualContainer() {
    this.container.innerHTML = '';
    this.container.style.position = 'relative';
    this.container.style.overflow = 'auto';

    // Spacer for total height (enables scrolling)
    this.topSpacer = document.createElement('div');
    this.topSpacer.className = 'virtual-spacer-top';
    this.topSpacer.style.height = '0px';

    this.bottomSpacer = document.createElement('div');
    this.bottomSpacer.className = 'virtual-spacer-bottom';
    this.bottomSpacer.style.height = '0px';

    // Visible content container
    this.visibleContainer = document.createElement('div');
    this.visibleContainer.className = 'virtual-visible-container';
    this.visibleContainer.style.display = 'grid';
    this.visibleContainer.style.gridTemplateColumns = `repeat(${this.itemsPerRow}, 1fr)`;
    this.visibleContainer.style.gap = '2px';

    this.container.appendChild(this.topSpacer);
    this.container.appendChild(this.visibleContainer);
    this.container.appendChild(this.bottomSpacer);
  }

  setupScrollHandling() {
    let scrollTimeout;

    this.container.addEventListener('scroll', () => {
      this.scrollTop = this.container.scrollTop;

      // Throttle scroll updates
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        this.updateVisibleRange();
      }, 16); // ~60fps
    });
  }

  setupResizeObserver() {
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => {
        this.updateDimensions();
        this.updateVisibleRange();
      });
      this.resizeObserver.observe(this.container);
    }
  }

  updateDimensions() {
    this.viewportHeight = this.container.clientHeight;
    this.updateGridColumns();
  }

  updateGridColumns() {
    this.visibleContainer.style.gridTemplateColumns = `repeat(${this.itemsPerRow}, 1fr)`;
    this.calculateTotalHeight();
    this.updateVisibleRange();
  }

  setVideos(videos) {
    this.allVideos = videos;
    this.calculateTotalHeight();
    this.updateVisibleRange();
  }

  setItemsPerRow(count) {
    this.itemsPerRow = count;
    this.updateGridColumns();
  }

  calculateTotalHeight() {
    const totalRows = Math.ceil(this.allVideos.length / this.itemsPerRow);
    this.totalHeight = totalRows * this.itemHeight;
  }

  getVisibleRange() {
    if (this.allVideos.length === 0) {
      return { start: 0, end: 0, startRow: 0, endRow: 0 };
    }

    const startRow = Math.floor(this.scrollTop / this.itemHeight);
    const endRow = Math.ceil((this.scrollTop + this.viewportHeight) / this.itemHeight);

    // Add buffer
    const bufferedStartRow = Math.max(0, startRow - this.buffer);
    const bufferedEndRow = Math.min(
      Math.ceil(this.allVideos.length / this.itemsPerRow),
      endRow + this.buffer
    );

    return {
      start: bufferedStartRow * this.itemsPerRow,
      end: Math.min(this.allVideos.length, bufferedEndRow * this.itemsPerRow),
      startRow: bufferedStartRow,
      endRow: bufferedEndRow,
    };
  }

  updateVisibleRange() {
    const range = this.getVisibleRange();
    const newVisibleVideos = this.allVideos.slice(range.start, range.end);

    // Update spacers
    this.topSpacer.style.height = `${range.startRow * this.itemHeight}px`;
    this.bottomSpacer.style.height = `${Math.max(0, this.totalHeight - range.endRow * this.itemHeight)}px`;

    // Update visible videos
    this.renderVisibleVideos(newVisibleVideos, range.start);
  }

  renderVisibleVideos(videos, startIndex) {
    // Get currently visible video IDs
    const currentIds = new Set(this.visibleVideos.map((v) => v.id));
    const newIds = new Set(videos.map((v) => v.id));

    // Remove videos that are no longer visible
    this.visibleVideos.forEach((video) => {
      if (!newIds.has(video.id)) {
        this.recycleVideoElement(video.id);
      }
    });

    // Clear container
    this.visibleContainer.innerHTML = '';

    // Add new visible videos
    videos.forEach((video, index) => {
      const element = this.getVideoElement(video, startIndex + index);
      this.visibleContainer.appendChild(element);
    });

    this.visibleVideos = videos;

    // Notify about visible range change
    this.onVisibleRangeChanged?.(this.visibleVideos, startIndex);
  }

  getVideoElement(video, globalIndex) {
    let element = this.activeElements.get(video.id);

    if (!element) {
      element = this.elementPool.getElement();
      this.setupVideoElement(element, video, globalIndex);
      this.activeElements.set(video.id, element);
    } else {
      // Update existing element
      this.updateVideoElement(element, video, globalIndex);
    }

    return element;
  }

  setupVideoElement(element, video, index) {
    element.className = 'video-item virtual-video-item';
    element.dataset.videoId = video.id;
    element.dataset.index = index;

    const isFavorited = this.isFavorite?.(video.id) || false;

    element.innerHTML = `
      <video 
        data-src="${video.path || video.url}"
        data-duration=""
        muted 
        loop
        preload="none"
      ></video>
      <button class="video-favorite ${isFavorited ? 'favorited' : ''}" 
              onclick="app.toggleFavorite('${video.id}', event)">
        <svg viewBox="0 0 24 24" class="heart-icon">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
        </svg>
      </button>
      <div class="video-overlay">
        <div class="video-name" title="${video.name}">
          ${video.name}
        </div>
        <div class="video-info">
          <span>${this.formatFileSize?.(video.size) || 'Unknown size'}</span>
        </div>
      </div>
    `;

    // Add click handler for expansion
    element.addEventListener('click', () => {
      this.onVideoClick?.(video, index);
    });

    return element;
  }

  updateVideoElement(element, video, index) {
    element.dataset.index = index;

    // Update favorite status
    const favoriteBtn = element.querySelector('.video-favorite');
    const isFavorited = this.isFavorite?.(video.id) || false;
    favoriteBtn.classList.toggle('favorited', isFavorited);

    // Update video source if needed
    const videoEl = element.querySelector('video');
    const videoSrc = video.path || video.url;
    if (videoEl.dataset.src !== videoSrc) {
      videoEl.dataset.src = videoSrc;
      if (videoEl.src !== videoSrc) {
        videoEl.src = '';
        videoEl.removeAttribute('src');
      }
    }
  }

  recycleVideoElement(videoId) {
    const element = this.activeElements.get(videoId);
    if (element) {
      this.elementPool.returnElement(element);
      this.activeElements.delete(videoId);
    }
  }

  scrollToVideo(videoId) {
    const index = this.allVideos.findIndex((v) => v.id === videoId);
    if (index === -1) return;

    const row = Math.floor(index / this.itemsPerRow);
    const scrollTop = row * this.itemHeight;

    this.container.scrollTo({
      top: scrollTop,
      behavior: 'smooth',
    });
  }

  scrollToIndex(index) {
    if (index < 0 || index >= this.allVideos.length) return;

    const row = Math.floor(index / this.itemsPerRow);
    const scrollTop = row * this.itemHeight;

    this.container.scrollTo({
      top: scrollTop,
      behavior: 'smooth',
    });
  }

  getVisibleVideoIds() {
    return this.visibleVideos.map((v) => v.id);
  }

  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    // Return all elements to pool
    this.activeElements.forEach((element) => {
      this.elementPool.returnElement(element);
    });

    this.activeElements.clear();
    this.elementPool.destroy();
  }

  // Callback setters
  setCallbacks(callbacks) {
    this.onVisibleRangeChanged = callbacks.onVisibleRangeChanged;
    this.onVideoClick = callbacks.onVideoClick;
    this.isFavorite = callbacks.isFavorite;
    this.formatFileSize = callbacks.formatFileSize;
  }
}

class VideoElementPool {
  constructor(maxSize = 50) {
    this.pool = [];
    this.maxSize = maxSize;
    this.created = 0;
  }

  getElement() {
    if (this.pool.length > 0) {
      return this.pool.pop();
    }

    this.created++;
    return this.createElement();
  }

  returnElement(element) {
    if (this.pool.length >= this.maxSize) {
      // Pool is full, discard element
      this.cleanupElement(element);
      return;
    }

    this.resetElement(element);
    this.pool.push(element);
  }

  createElement() {
    const element = document.createElement('div');
    element.className = 'video-item virtual-video-item';
    element.style.height = '300px'; // Match itemHeight
    element.style.position = 'relative';
    element.style.backgroundColor = '#111';
    element.style.overflow = 'hidden';
    element.style.cursor = 'pointer';
    element.style.transition = 'transform 0.2s ease, filter 0.2s ease';

    return element;
  }

  resetElement(element) {
    // Clean up video element
    const video = element.querySelector('video');
    if (video) {
      video.pause();
      video.src = '';
      video.load();

      // Remove event listeners
      const newVideo = video.cloneNode(true);
      video.parentNode.replaceChild(newVideo, video);
    }

    // Remove click handlers
    const newElement = element.cloneNode(true);
    element.parentNode?.replaceChild(newElement, element);

    // Clear any custom properties
    delete element.dataset.videoId;
    delete element.dataset.index;

    return newElement;
  }

  cleanupElement(element) {
    this.resetElement(element);
    // Element will be garbage collected
  }

  destroy() {
    this.pool.forEach((element) => this.cleanupElement(element));
    this.pool = [];
  }

  getStats() {
    return {
      poolSize: this.pool.length,
      maxSize: this.maxSize,
      created: this.created,
      inUse: this.created - this.pool.length,
    };
  }
}

// Export for use in other modules
window.VirtualizedVideoGrid = VirtualizedVideoGrid;
window.VideoElementPool = VideoElementPool;
