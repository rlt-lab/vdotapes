/**
 * GridRenderer - Handles all grid rendering strategies
 */
class GridRenderer {
  constructor(app) {
    this.app = app;
  }

  renderGrid() {
    if (this.app.displayedVideos.length === 0) {
      this.app.showEmptyState();
      return;
    }

    // NOTE: VirtualGrid disabled - uses absolute positioning which breaks CSS Grid layout
    // TODO: Implement CSS Grid-compatible virtualization that maintains layout
    // const shouldUseVirtual = this.app.displayedVideos.length > 500;

    if (this.app.useWasmEngine && this.app.gridEngine) {
      this.renderWasmGrid();
    } else {
      this.renderSmartGrid();
    }

    this.app.gridRendered = true;
  }

  renderVirtualGrid() {
    console.log('[Renderer] Using VIRTUAL GRID for large collection');

    document.getElementById('content').innerHTML = '<div class="video-grid video-grid-virtual"></div>';
    const container = document.querySelector('.video-grid');

    container.style.position = 'relative';

    // Destroy old VirtualGrid if container changed (DOM was replaced)
    if (this.app.virtualGrid && this.app.virtualGrid.isInitialized) {
      this.app.virtualGrid.destroy();
    }

    // Create new VirtualGrid for this container
    this.app.virtualGrid = new VirtualGrid({
      itemHeight: 200,
      itemGap: 8,
      bufferRows: 2,
      columns: this.app.gridCols,
      renderItem: (video, index) => this.createVideoElement(video, index),
    });

    // Initialize with container, then set data
    this.app.virtualGrid.init(container);
    this.app.virtualGrid.setData(this.app.displayedVideos);

    const stats = this.app.virtualGrid.getStats();
    console.log(
      `[Renderer] Virtual grid active: ${stats.renderedElements}/${stats.totalItems} rendered`
    );
  }

  /**
   * Create a video element for VirtualGrid
   */
  createVideoElement(video, index) {
    const div = document.createElement('div');
    div.innerHTML = this.createVideoItemHTML(video, index);
    const element = div.firstElementChild;

    // Add click listener
    element.addEventListener('click', (e) => {
      if (!e.target.closest('.video-favorite')) {
        this.app.videoExpander.expandVideo(index);
      }
    });

    // Observe with smart loader for lazy loading
    if (this.app.smartLoader) {
      this.app.smartLoader.observeItem(element);
    }

    return element;
  }

  renderWasmGrid() {
    console.log('[Renderer] Using WASM-optimized grid (smart loading)');

    const gridHTML = this.app.displayedVideos
      .map((video, index) => this.createVideoItemHTML(video, index))
      .join('');

    document.getElementById('content').innerHTML = `<div class="video-grid">${gridHTML}</div>`;

    this.app.updateGridLayout();
    this.observeVideoItemsWithSmartLoader();

    // Load thumbnails for visible videos (async, non-blocking)
    setTimeout(() => {
      this.app.videoManager.loadThumbnailsForVisibleVideos();
    }, 500);
  }

  applyDomOperations(operations) {
    if (!operations || operations.length === 0) {
      console.log('[WASM] No DOM operations needed');
      return;
    }

    const container = document.querySelector('.video-grid');
    if (!container) {
      console.warn('[WASM] Grid container not found, performing full render');
      this.renderWasmGrid();
      return;
    }

    console.log(`[WASM] Applying ${operations.length} DOM operations`);
    let insertCount = 0;
    let removeCount = 0;
    let moveCount = 0;

    const fragment = document.createDocumentFragment();
    const insertQueue = [];

    operations.forEach((op) => {
      switch (op.operation) {
        case 'insert':
          insertCount++;
          const video = this.app.displayedVideos[op.index];
          if (video) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = this.createVideoItemHTML(video, op.index);
            const element = tempDiv.firstElementChild;
            insertQueue.push({ element, index: op.index });
          }
          break;

        case 'remove':
          removeCount++;
          const itemToRemove = container.querySelector(`.video-item[data-video-id="${op.id}"]`);
          if (itemToRemove) {
            const video = itemToRemove.querySelector('video');
            if (video && video.src) {
              video.pause();
              video.src = '';
            }
            itemToRemove.remove();
          }
          break;

        case 'move':
          moveCount++;
          const itemToMove = container.querySelector(`.video-item[data-video-id="${op.id}"]`);
          if (itemToMove) {
            fragment.appendChild(itemToMove);
          }
          break;
      }
    });

    insertQueue.sort((a, b) => a.index - b.index);
    insertQueue.forEach(({ element }) => fragment.appendChild(element));

    if (fragment.childNodes.length > 0) {
      container.innerHTML = '';
      container.appendChild(fragment);
    }

    console.log(`[WASM] Applied: ${insertCount} inserts, ${removeCount} removes, ${moveCount} moves`);

    this.app.updateGridLayout();
    this.observeVideoItemsWithSmartLoader();
  }

  renderSmartGrid() {
    const gridHTML = this.app.displayedVideos
      .map((video, index) => this.createVideoItemHTML(video, index))
      .join('');

    document.getElementById('content').innerHTML = `<div class="video-grid">${gridHTML}</div>`;

    this.app.updateGridLayout();
    this.observeVideoItemsWithSmartLoader();

    // Load thumbnails for visible videos (async, non-blocking)
    setTimeout(() => {
      this.app.videoManager.loadThumbnailsForVisibleVideos();
    }, 500);

    if (this.app.smartLoader) {
      const stats = this.app.smartLoader.getStats();
      console.log(
        `Smart Loading: ${stats.loadedVideos} loaded, ${stats.activeVideos}/${stats.maxActiveVideos} active`
      );
    }
  }

  createVideoItemHTML(video, index) {
    const isFavorited = video.isFavorite === true;
    const hasMetadata = video.duration || video.width || video.height;
    const folderDisplay = video.folder || 'Root folder';

    return `
      <div class="video-item ${!video.isValid && hasMetadata ? 'invalid-metadata' : ''}" data-index="${index}" data-video-id="${video.id}" data-folder="${video.folder || ''}" data-last-modified="${video.lastModified || 0}">
        <!-- Thumbnail placeholder (shows while loading or on error) -->
        <div class="video-thumbnail" data-video-id="${video.id}">
          <div class="thumbnail-loading">
            <span>Loading...</span>
          </div>
        </div>

        <video
          data-src="${video.path}"
          data-duration="${video.duration || ''}"
          muted
          loop
          preload="none"
        ></video>
        <button class="video-favorite ${isFavorited ? 'favorited' : ''}" data-video-id="${video.id}">
          <svg viewBox="0 0 24 24" class="heart-icon">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
        </button>
        ${this.createMetadataBadges(video)}
        <div class="video-folder-label">${folderDisplay}</div>
        <div class="video-overlay">
          <div class="video-name">${folderDisplay}</div>
          <div class="video-info">
            ${this.formatVideoInfo(video)}
          </div>
        </div>
      </div>
    `;
  }

  createMetadataBadges(video) {
    const badges = [];

    if (video.resolution) {
      badges.push(
        `<span class="metadata-badge resolution-badge resolution-${video.resolution.toLowerCase()}">${video.resolution}</span>`
      );
    }

    if (video.hasAudio === false) {
      badges.push('<span class="metadata-badge audio-badge no-audio">No Audio</span>');
    }

    if (video.qualityScore && video.qualityScore >= 4) {
      badges.push(
        `<span class="metadata-badge quality-badge quality-${video.qualityScore}">HQ</span>`
      );
    }

    if (video.codec && ['h265', 'hevc', 'av1'].includes(video.codec.toLowerCase())) {
      badges.push(
        `<span class="metadata-badge codec-badge codec-${video.codec.toLowerCase()}">${video.codec.toUpperCase()}</span>`
      );
    }

    return badges.length > 0 ? `<div class="metadata-badges">${badges.join('')}</div>` : '';
  }

  formatVideoInfo(video) {
    const infoItems = [];

    infoItems.push(`<span class="info-size">${this.app.formatFileSize(video.size)}</span>`);

    if (video.duration) {
      infoItems.push(`<span class="info-duration">${this.app.formatDuration(video.duration)}</span>`);
    }

    if (video.width && video.height) {
      infoItems.push(`<span class="info-dimensions">${video.width}×${video.height}</span>`);
    }

    if (video.bitrate || video.estimatedBitrate) {
      const bitrate = video.bitrate || video.estimatedBitrate;
      const mbps = (bitrate / 1000000).toFixed(1);
      infoItems.push(`<span class="info-bitrate">${mbps} Mbps</span>`);
    }

    return infoItems.join('<span class="info-separator"> • </span>');
  }

  observeVideoItemsWithSmartLoader() {
    const container = document.querySelector('.video-grid');

    if (this.app.smartLoader && container) {
      console.log('[Renderer] Using IntersectionObserver-based smart loader');
      this.app.smartLoader.observeVideoItems(container);
    }

    const items = document.querySelectorAll('.video-item');
    items.forEach((item) => {
      if (item.dataset.hasListener) return;  // Guard against duplicate listeners
      item.dataset.hasListener = 'true';
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.video-favorite')) {
          // Use data-index attribute, not loop index, to handle re-sorting correctly
          const videoIndex = parseInt(item.dataset.index, 10);
          this.app.videoExpander.expandVideo(videoIndex);
        }
      });
    });
  }

  attachVideoItemListeners() {
    const items = document.querySelectorAll('.video-item');
    items.forEach((item, index) => {
      if (item.dataset.hasListener) return;

      item.dataset.hasListener = 'true';
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.video-favorite')) {
          const videoIndex = parseInt(item.dataset.index, 10);
          this.app.videoExpander.expandVideo(videoIndex);
        }
      });
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GridRenderer;
} else {
  window.GridRenderer = GridRenderer;
}
