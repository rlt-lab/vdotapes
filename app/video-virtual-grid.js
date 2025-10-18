/**
 * Virtual Grid - Actually uses WASM reconciliation results
 * 
 * Instead of:
 * 1. Render all 500 videos to DOM
 * 2. Use IntersectionObserver to decide which to load
 * 
 * We do:
 * 1. Ask WASM: "What should be visible?"
 * 2. WASM returns DomOperations (Add video_20, Remove video_5)
 * 3. Apply those operations (minimal DOM updates)
 * 4. Load videos that are now visible
 */

class VirtualVideoGrid {
  constructor(options = {}) {
    this.renderer = options.renderer;
    this.wasmEngine = options.wasmEngine;
    this.container = null;
    this.scrollContainer = options.scrollContainer || window;
    
    // Grid configuration
    this.itemHeight = options.itemHeight || 400; // Approximate video item height
    this.itemsPerRow = options.itemsPerRow || 4;
    this.bufferRows = options.bufferRows || 2; // Rows to render above/below viewport
    
    // Video management
    this.maxActiveVideos = options.maxActiveVideos || 6;
    this.loadedVideos = new Set();
    this.videoElements = new Map(); // videoId -> DOM element
    
    // State
    this.isInitialized = false;
    this.rafId = null;
    this.lastScrollTime = 0;
    this.scrollThrottle = 100; // ms
    
    console.log('[VirtualGrid] Initialized with WASM reconciliation');
  }

  /**
   * Initialize virtual grid
   */
  init(containerElement) {
    this.container = containerElement;
    
    // Set up scroll container height for virtual scrolling
    this.updateContainerHeight();
    
    // Set up scroll handling
    this.setupScrollHandler();
    
    // Initial render
    this.updateViewport();
    
    this.isInitialized = true;
    console.log('[VirtualGrid] Initialized and ready');
  }

  /**
   * Update total container height for scrolling
   */
  updateContainerHeight() {
    if (!this.wasmEngine || !this.container) return;
    
    try {
      const stats = this.wasmEngine.getStats();
      const totalVideos = stats.filteredVideos || 0;
      const totalRows = Math.ceil(totalVideos / this.itemsPerRow);
      const totalHeight = totalRows * this.itemHeight;
      
      // Set container height to enable scrolling
      this.container.style.minHeight = `${totalHeight}px`;
      this.container.style.position = 'relative';
      
      console.log(`[VirtualGrid] Container height: ${totalHeight}px (${totalVideos} videos, ${totalRows} rows)`);
    } catch (error) {
      console.error('[VirtualGrid] Error updating container height:', error);
    }
  }

  /**
   * Set up scroll event handling
   */
  setupScrollHandler() {
    const handleScroll = () => {
      const now = Date.now();
      if (now - this.lastScrollTime < this.scrollThrottle) {
        return;
      }
      
      this.lastScrollTime = now;
      
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
      }
      
      this.rafId = requestAnimationFrame(() => {
        this.updateViewport();
      });
    };

    if (this.scrollContainer === window) {
      window.addEventListener('scroll', handleScroll, { passive: true });
    } else {
      this.scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    }
    
    console.log('[VirtualGrid] Scroll handler attached');
  }

  /**
   * Update viewport - This is where the magic happens
   */
  updateViewport() {
    if (!this.isInitialized || !this.wasmEngine || !this.container) {
      return;
    }

    try {
      // Get scroll position
      const scrollTop = this.scrollContainer === window 
        ? window.pageYOffset || document.documentElement.scrollTop
        : this.scrollContainer.scrollTop;
      
      const viewportHeight = this.scrollContainer === window
        ? window.innerHeight
        : this.scrollContainer.clientHeight;

      // Calculate current row for thumbnail pre-loading
      const currentRow = Math.floor(scrollTop / this.itemHeight);

      // Pre-load thumbnails ahead of scrolling
      if (this.renderer?.thumbnailPreloader && this.renderer.displayedVideos) {
        this.renderer.thumbnailPreloader.preloadForViewport(
          this.renderer.displayedVideos,
          currentRow,
          this.bufferRows,
          this.itemsPerRow
        );
      }

      // Ask WASM: "What should be visible?"
      const reconciliationResult = this.wasmEngine.calculateViewport(
        scrollTop,
        viewportHeight,
        this.itemHeight,
        this.itemsPerRow,
        this.bufferRows
      );

      if (!reconciliationResult || !reconciliationResult.operations) {
        console.warn('[VirtualGrid] No reconciliation result from WASM');
        return;
      }

      // Apply the DomOperations from WASM
      this.applyDomOperations(reconciliationResult.operations);
      
      // Unload videos that are too far from viewport
      this.cleanupDistantVideos();
      
      // Log stats
      console.log(
        `[VirtualGrid] Viewport update: ${reconciliationResult.operations.length} operations, ` +
        `visible range: ${reconciliationResult.visible_start}-${reconciliationResult.visible_end}, ` +
        `loaded: ${this.loadedVideos.size}/${this.maxActiveVideos}`
      );
    } catch (error) {
      console.error('[VirtualGrid] Error updating viewport:', error);
    }
  }

  /**
   * Apply DOM operations from WASM reconciliation
   */
  applyDomOperations(operations) {
    operations.forEach(op => {
      try {
        switch (op.type) {
          case 'Add':
            this.addVideoElement(op.video_id, op.index);
            break;
          case 'Remove':
            this.removeVideoElement(op.video_id);
            break;
          case 'Move':
            this.moveVideoElement(op.video_id, op.from, op.to);
            break;
          case 'Update':
            // Update can be used for state changes if needed
            break;
          default:
            console.warn('[VirtualGrid] Unknown operation type:', op.type);
        }
      } catch (error) {
        console.error('[VirtualGrid] Error applying operation:', op, error);
      }
    });
  }

  /**
   * Add a video element to DOM
   */
  addVideoElement(videoId, index) {
    // Don't add if already exists
    if (this.videoElements.has(videoId)) {
      return;
    }

    // Find video data
    const video = this.renderer.displayedVideos.find(v => v.id === videoId);
    if (!video) {
      console.warn('[VirtualGrid] Video not found:', videoId);
      return;
    }

    // Create element
    const element = this.createVideoElement(video, index);
    
    // Store reference
    this.videoElements.set(videoId, element);
    
    // Add to DOM
    this.container.appendChild(element);
    
    // Load video if under limit
    if (this.loadedVideos.size < this.maxActiveVideos) {
      this.loadVideo(videoId, element);
    } else {
      console.warn(
        `[VirtualGrid] Cannot load video ${videoId}: at limit (${this.loadedVideos.size}/${this.maxActiveVideos}). ` +
        `This indicates bufferRows may be too large for maxActiveVideos.`
      );
    }
  }

  /**
   * Remove a video element from DOM
   */
  removeVideoElement(videoId) {
    const element = this.videoElements.get(videoId);
    if (!element) return;

    // Unload video
    this.unloadVideo(videoId, element);
    
    // Remove from DOM
    element.remove();
    
    // Remove reference
    this.videoElements.delete(videoId);
  }

  /**
   * Move a video element (update position)
   */
  moveVideoElement(videoId, from, to) {
    const element = this.videoElements.get(videoId);
    if (!element) return;

    // Update position using CSS transform (more efficient than changing DOM order)
    const row = Math.floor(to / this.itemsPerRow);
    const col = to % this.itemsPerRow;
    
    element.style.transform = `translate(${col * 100}%, ${row * this.itemHeight}px)`;
  }

  /**
   * Create video DOM element
   */
  createVideoElement(video, index) {
    const row = Math.floor(index / this.itemsPerRow);
    const col = index % this.itemsPerRow;
    
    const div = document.createElement('div');
    div.className = 'video-item';
    div.dataset.videoId = video.id;
    div.dataset.index = index;
    div.dataset.folder = video.folder || '';
    div.dataset.lastModified = video.lastModified || 0;
    div.title = video.name;
    
    // Position using absolute positioning for virtual scrolling
    div.style.position = 'absolute';
    div.style.width = `${100 / this.itemsPerRow}%`;
    div.style.height = `${this.itemHeight}px`;
    div.style.transform = `translate(${col * 100}%, ${row * this.itemHeight}px)`;
    
    // Create video element
    const videoEl = document.createElement('video');
    videoEl.dataset.src = video.path;
    videoEl.dataset.duration = video.duration || '';
    videoEl.muted = true;
    videoEl.loop = true;
    videoEl.preload = 'none';
    videoEl.title = video.name;
    
    div.appendChild(videoEl);
    
    // Add favorite button
    const isFavorited = video.isFavorite === true;
    const favoriteBtn = document.createElement('button');
    favoriteBtn.className = `video-favorite ${isFavorited ? 'favorited' : ''}`;
    favoriteBtn.dataset.videoId = video.id;
    favoriteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" class="heart-icon">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
      </svg>
    `;
    div.appendChild(favoriteBtn);
    
    // Add folder label
    const folderLabel = document.createElement('div');
    folderLabel.className = 'video-folder-label';
    folderLabel.textContent = video.folder || 'Root folder';
    div.appendChild(folderLabel);
    
    // Add overlay with info
    const overlay = document.createElement('div');
    overlay.className = 'video-overlay';
    overlay.innerHTML = `
      <div class="video-name" title="${video.folder || 'Root folder'}">
        ${video.folder || 'Root folder'}
      </div>
      <div class="video-info">
        ${this.renderer.formatVideoInfo ? this.renderer.formatVideoInfo(video) : ''}
      </div>
    `;
    div.appendChild(overlay);
    
    // Add click handler
    div.addEventListener('click', (e) => {
      if (!e.target.closest('.video-favorite')) {
        this.renderer.expandVideo(index);
      }
    });
    
    return div;
  }

  /**
   * Load a video
   */
  loadVideo(videoId, element) {
    const videoEl = element.querySelector('video');
    if (!videoEl) return;

    const src = videoEl.dataset.src;
    if (!src || videoEl.src) return; // Already loaded

    // Apply thumbnail if available (show while loading)
    if (this.renderer?.thumbnailPreloader) {
      this.renderer.thumbnailPreloader.applyThumbnail(element, videoId);
    }

    // Mark as loading
    element.classList.add('loading');
    this.loadedVideos.add(videoId);

    // Use renderer's loadVideo if available (has retry logic)
    if (this.renderer && this.renderer.loadVideo) {
      this.renderer.loadVideo(videoEl, element);
      
      // Mark in WASM
      if (this.wasmEngine) {
        this.wasmEngine.markVideoLoaded(videoId);
      }
    } else {
      // Simple load
      videoEl.src = src;
      videoEl.preload = 'metadata';
      
      videoEl.addEventListener('loadedmetadata', () => {
        element.classList.remove('loading');
        videoEl.classList.add('loaded');
        videoEl.play().catch(() => {});
        
        if (this.wasmEngine) {
          this.wasmEngine.markVideoLoaded(videoId);
        }
      }, { once: true });
      
      videoEl.addEventListener('error', () => {
        element.classList.remove('loading');
        element.classList.add('error');
        this.loadedVideos.delete(videoId);
        
        if (this.wasmEngine) {
          this.wasmEngine.markVideoError(videoId);
        }
      }, { once: true });
    }
  }

  /**
   * Unload a video
   */
  unloadVideo(videoId, element) {
    const videoEl = element.querySelector('video');
    if (!videoEl || !videoEl.src) return;

    // Show thumbnail before unloading (smooth transition)
    if (this.renderer?.thumbnailPreloader) {
      this.renderer.thumbnailPreloader.showThumbnail(element, videoId);
    }

    // Stop and clear
    videoEl.pause();
    videoEl.src = '';
    videoEl.load(); // Critical: releases WebMediaPlayer
    
    // Remove loop handler if exists
    if (videoEl._loopHandler) {
      videoEl.removeEventListener('timeupdate', videoEl._loopHandler);
      delete videoEl._loopHandler;
    }
    
    element.classList.remove('loading');
    videoEl.classList.remove('loaded');
    
    this.loadedVideos.delete(videoId);
  }

  /**
   * Cleanup videos that are too far from viewport
   */
  cleanupDistantVideos() {
    if (this.loadedVideos.size <= this.maxActiveVideos) {
      return; // Under limit
    }

    const scrollTop = this.scrollContainer === window 
      ? window.pageYOffset || document.documentElement.scrollTop
      : this.scrollContainer.scrollTop;
    
    const viewportHeight = this.scrollContainer === window
      ? window.innerHeight
      : this.scrollContainer.clientHeight;

    // Calculate visible range with buffer
    const bufferZone = this.itemHeight * this.bufferRows;
    const visibleTop = scrollTop - bufferZone;
    const visibleBottom = scrollTop + viewportHeight + bufferZone;

    // Find videos to unload
    const toUnload = [];
    
    this.videoElements.forEach((element, videoId) => {
      if (!this.loadedVideos.has(videoId)) return;
      
      const rect = element.getBoundingClientRect();
      const elementTop = rect.top + scrollTop;
      const elementBottom = elementTop + rect.height;
      
      // Check if outside visible range
      if (elementBottom < visibleTop || elementTop > visibleBottom) {
        toUnload.push({ videoId, element });
      }
    });

    // Unload oldest videos first (could implement LRU here)
    const unloadCount = this.loadedVideos.size - this.maxActiveVideos + 1;
    toUnload.slice(0, unloadCount).forEach(({ videoId, element }) => {
      this.unloadVideo(videoId, element);
    });

    if (toUnload.length > 0) {
      console.log(`[VirtualGrid] Cleanup: Unloaded ${toUnload.length} distant videos`);
    }
  }

  /**
   * Update configuration (e.g., grid columns changed)
   */
  updateConfig(itemsPerRow) {
    this.itemsPerRow = itemsPerRow;
    this.updateContainerHeight();
    this.updateViewport();
  }

  /**
   * Refresh grid (e.g., after filter/sort change)
   */
  refresh() {
    // Clear all video elements
    this.videoElements.forEach((element, videoId) => {
      this.unloadVideo(videoId, element);
      element.remove();
    });
    this.videoElements.clear();
    this.loadedVideos.clear();
    
    // Update height and re-render
    this.updateContainerHeight();
    this.updateViewport();
    
    console.log('[VirtualGrid] Refreshed');
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      renderedElements: this.videoElements.size,
      loadedVideos: this.loadedVideos.size,
      maxActiveVideos: this.maxActiveVideos,
      itemsPerRow: this.itemsPerRow
    };
  }

  /**
   * Destroy and cleanup
   */
  destroy() {
    // Unload all videos
    this.videoElements.forEach((element, videoId) => {
      this.unloadVideo(videoId, element);
    });
    
    // Clear references
    this.videoElements.clear();
    this.loadedVideos.clear();
    
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    
    console.log('[VirtualGrid] Destroyed');
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VirtualVideoGrid;
} else {
  window.VirtualVideoGrid = VirtualVideoGrid;
}
