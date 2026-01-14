/**
 * Debounce utility - delays function execution until after wait ms have elapsed
 * since the last time it was invoked.
 */
function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * FilterManager - Handles filtering and sorting of videos
 */
class FilterManager {
  constructor(app) {
    this.app = app;
    // Debounced version for rapid filter changes (tag clicks, etc)
    this.debouncedApplyFilters = debounce(() => this.applyFiltersOptimized(), 50);
  }

  filterByFolder(folderName) {
    this.app.currentFolder = folderName;
    this.applyCurrentFilters();
    this.app.userDataManager.updateHiddenCount();
    this.app.updateStatusMessage();
    this.app.saveSettings();
  }

  setSortMode(sortMode) {
    this.app.currentSort = sortMode;
    this.updateSortButtonStates();
    this.reorderGridInPlace();
    this.app.saveSettings();
  }

  updateSortButtonStates() {
    document.getElementById('sortFolderBtn').classList.toggle('active', this.app.currentSort === 'folder');
    document.getElementById('sortDateBtn').classList.toggle('active', this.app.currentSort === 'date');
    document.getElementById('shuffleBtn').classList.toggle('active', this.app.currentSort === 'shuffle');
  }

  reorderGridInPlace() {
    const container = document.querySelector('.video-grid');
    if (!container) {
      this.app.renderGrid();
      return;
    }

    // Sort the data array first (fast, no DOM)
    const mode = this.app.currentSort;
    const sortFn = (a, b) => {
      if (mode === 'folder') {
        const fc = (a.folder || '').toLowerCase().localeCompare((b.folder || '').toLowerCase());
        if (fc !== 0) return fc;
        return b.lastModified - a.lastModified;
      } else if (mode === 'date') {
        return b.lastModified - a.lastModified;
      }
      return 0;
    };

    // Sort displayedVideos array (data-only, O(n log n))
    this.app.displayedVideos.sort(sortFn);

    // Build a map of videoId -> DOM element (O(n) once, not O(n²))
    const itemMap = new Map();
    for (const child of container.children) {
      const videoId = child.dataset?.videoId;
      if (videoId) itemMap.set(videoId, child);
    }

    // Reorder DOM to match sorted data using requestAnimationFrame
    // This prevents blocking the UI thread
    requestAnimationFrame(() => {
      const frag = document.createDocumentFragment();
      let index = 0;

      for (const video of this.app.displayedVideos) {
        const item = itemMap.get(video.id);
        if (item) {
          item.dataset.index = index.toString();
          frag.appendChild(item);
          index++;
        }
      }

      container.appendChild(frag);
      // Status update is debounced in UIHelper, so this is safe
      this.app.updateStatusMessage();
    });
  }

  async shuffleVideos() {
    const btn = document.getElementById('shuffleBtn');
    btn.classList.add('shuffling');

    this.app.currentSort = 'shuffle';
    this.updateSortButtonStates();

    // Shuffle displayedVideos array (Fisher-Yates)
    const videos = this.app.displayedVideos;
    for (let i = videos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [videos[i], videos[j]] = [videos[j], videos[i]];
    }

    // Reorder DOM to match shuffled order (preserves thumbnails)
    const container = document.querySelector('.video-grid');
    if (container && this.app.gridRendered) {
      const frag = document.createDocumentFragment();
      videos.forEach((video, newIndex) => {
        const item = container.querySelector(`[data-video-id="${video.id}"]`);
        if (item) {
          item.dataset.index = newIndex.toString();
          frag.appendChild(item);
        }
      });
      container.appendChild(frag);
    } else {
      this.app.renderGrid();
    }

    setTimeout(() => btn.classList.remove('shuffling'), 500);
  }

  async toggleFavoritesView() {
    if (!this.app.showingFavoritesOnly) {
      this.app.previousViewState = {
        folder: this.app.currentFolder,
        sort: this.app.currentSort,
      };
      this.app.showingFavoritesOnly = true;
    } else {
      this.app.showingFavoritesOnly = false;
      this.app.currentFolder = this.app.previousViewState.folder;
      this.app.currentSort = this.app.previousViewState.sort;

      document.getElementById('folderSelect').value = this.app.currentFolder;
      this.updateSortButtonStates();
    }

    const btn = document.getElementById('favoritesBtn');
    btn.classList.toggle('active', this.app.showingFavoritesOnly);

    this.applyFiltersOptimized();
    this.app.updateStatusMessage();
    this.app.saveSettings();
  }

  toggleHiddenView() {
    this.app.showingHiddenOnly = !this.app.showingHiddenOnly;
    const btn = document.getElementById('hiddenBtn');
    btn.classList.toggle('active', this.app.showingHiddenOnly);

    this.applyFiltersOptimized();
    this.app.updateStatusMessage();
    this.app.saveSettings();
  }

  /**
   * Apply filters using in-place DOM updates when possible, falling back to full render otherwise.
   * This preserves thumbnails and video state during filter toggles.
   */
  applyFiltersOptimized() {
    if (this.app.gridRendered && document.querySelector('.video-grid')) {
      this.applyFiltersInPlace();
      this.reorderGridInPlace();
    } else {
      this.applyCurrentFilters();
    }
  }

  applyCurrentFilters() {
    console.log('[FilterManager] applyCurrentFilters called with state:', {
      currentFolder: this.app.currentFolder,
      showingFavoritesOnly: this.app.showingFavoritesOnly,
      showingHiddenOnly: this.app.showingHiddenOnly,
      totalVideos: this.app.allVideos.length
    });

    if (this.app.useWasmEngine && this.app.gridEngine) {
      try {
        const currentFilterState = JSON.stringify({
          folder: this.app.currentFolder,
          favoritesOnly: this.app.showingFavoritesOnly,
          hiddenOnly: this.app.showingHiddenOnly,
          sort: this.app.currentSort,
          tags: this.app.activeTags
        });
        
        const filtersChanged = this.app.lastFilterState !== currentFilterState;
        this.app.lastFilterState = currentFilterState;

        const filterCount = this.app.gridEngine.applyFilters({
          folder: this.app.currentFolder || null,
          favorites_only: this.app.showingFavoritesOnly,
          hidden_only: this.app.showingHiddenOnly,
          show_hidden: false
        });

        this.app.gridEngine.setSortMode(this.app.currentSort);

        let filteredVideos = this.app.gridEngine.getFilteredVideos();

        // Apply tag filtering in JS (WASM doesn't support tags yet) - using Sets for O(1) lookup
        if (this.app.activeTags && this.app.activeTags.length > 0) {
          filteredVideos = filteredVideos.filter(video => {
            const videoTagSet = this.app.videoTagSets[video.id];
            if (!videoTagSet || videoTagSet.size === 0) return false;
            if (this.app.tagFilterMode === 'AND') {
              return this.app.activeTags.every(tag => videoTagSet.has(tag));
            } else {
              return this.app.activeTags.some(tag => videoTagSet.has(tag));
            }
          });
          const mode = this.app.tagFilterMode === 'AND' ? 'all' : 'any';
          console.log(`[Filter] Tag filter (${this.app.tagFilterMode}) applied: ${filteredVideos.length} videos match ${mode} tags [${this.app.activeTags.join(', ')}]`);
        }

        this.app.displayedVideos = filteredVideos;

        console.log(`WASM filtered to ${filterCount} videos`);
        
        if (filtersChanged) {
          console.log('[Filter] Filters changed, performing full re-render');
          this.app.renderWasmGrid();
        } else {
          console.log('[Filter] No filter change, skipping re-render');
        }
        return;
      } catch (error) {
        console.error('Error using WASM engine, falling back to JS:', error);
        this.app.useWasmEngine = false;
      }
    }

    // Single-pass filtering for performance
    const hasFolderFilter = !!this.app.currentFolder;
    const hasTagFilter = this.app.activeTags && this.app.activeTags.length > 0;
    const tagModeAnd = this.app.tagFilterMode === 'AND';

    const filtered = this.app.allVideos.filter(video => {
      // Folder filter
      if (hasFolderFilter && video.folder !== this.app.currentFolder) {
        return false;
      }

      // Favorites filter
      if (this.app.showingFavoritesOnly && !video.isFavorite) {
        return false;
      }

      // Hidden filter
      if (this.app.showingHiddenOnly) {
        if (!this.app.hiddenFiles.has(video.id)) return false;
      } else {
        if (this.app.hiddenFiles.has(video.id)) return false;
      }

      // Tag filter (using Sets for O(1) lookup)
      if (hasTagFilter) {
        const videoTagSet = this.app.videoTagSets[video.id];
        if (!videoTagSet || videoTagSet.size === 0) return false; // No tags = no match
        if (tagModeAnd) {
          if (!this.app.activeTags.every(tag => videoTagSet.has(tag))) return false;
        } else {
          if (!this.app.activeTags.some(tag => videoTagSet.has(tag))) return false;
        }
      }

      return true;
    });

    if (hasTagFilter) {
      const mode = tagModeAnd ? 'all' : 'any';
      console.log(`[Filter] Tag filter (${this.app.tagFilterMode}) applied: ${filtered.length} videos match ${mode} tags [${this.app.activeTags.join(', ')}]`);
    }

    if (this.app.currentSort === 'folder') {
      filtered.sort((a, b) => {
        const folderA = a.folder || '';
        const folderB = b.folder || '';
        const folderCompare = folderA.localeCompare(folderB);
        if (folderCompare !== 0) return folderCompare;

        const dateA = a.lastModified || 0;
        const dateB = b.lastModified || 0;
        return dateB - dateA;
      });
    } else if (this.app.currentSort === 'date') {
      filtered.sort((a, b) => {
        const dateA = a.lastModified || 0;
        const dateB = b.lastModified || 0;
        return dateB - dateA;
      });
    } else if (this.app.currentSort === 'shuffle') {
      // Fisher-Yates shuffle for proper randomization
      for (let i = filtered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
      }
    }

    this.app.displayedVideos = filtered;
    console.log('[FilterManager] Filtered result:', {
      displayedVideos: filtered.length,
      allVideos: this.app.allVideos.length,
      favoriteCount: this.app.favorites.size,
      showingFavoritesOnly: this.app.showingFavoritesOnly,
      currentFolder: this.app.currentFolder
    });
    console.log('[FilterManager] First 5 displayed videos:', filtered.slice(0, 5).map(v => ({ id: v.id, name: v.name, isFavorite: v.isFavorite })));
    console.log('[FilterManager] First 5 ALL videos:', this.app.allVideos.slice(0, 5).map(v => ({ id: v.id, name: v.name, isFavorite: v.isFavorite })));
    this.app.renderGrid();
  }

  applyFiltersInPlace() {
    const container = document.querySelector('.video-grid');
    if (!container) {
      this.app.renderGrid();
      return;
    }

    const items = Array.from(container.querySelectorAll('.video-item'));

    const hasTagFilter = this.app.activeTags && this.app.activeTags.length > 0;
    const tagModeAnd = this.app.tagFilterMode === 'AND';

    items.forEach((item) => {
      const videoId = item.dataset.videoId;
      const video = this.app.videoMap.get(videoId);
      if (!video) {
        item.classList.add('is-hidden-by-filter');
        return;
      }

      let shouldShow = true;

      if (this.app.currentFolder && video.folder !== this.app.currentFolder) {
        shouldShow = false;
      }

      if (shouldShow && this.app.showingFavoritesOnly && !video.isFavorite) {
        shouldShow = false;
      }

      if (shouldShow) {
        if (this.app.showingHiddenOnly) {
          shouldShow = this.app.hiddenFiles.has(video.id);
        } else if (this.app.hiddenFiles.has(video.id)) {
          shouldShow = false;
        }
      }

      // Tag filter (using Sets for O(1) lookup)
      if (shouldShow && hasTagFilter) {
        const videoTagSet = this.app.videoTagSets[video.id];
        if (!videoTagSet || videoTagSet.size === 0) {
          shouldShow = false;
        } else if (tagModeAnd) {
          shouldShow = this.app.activeTags.every(tag => videoTagSet.has(tag));
        } else {
          shouldShow = this.app.activeTags.some(tag => videoTagSet.has(tag));
        }
      }

      item.classList.toggle('is-hidden-by-filter', !shouldShow);
    });
  }

  refreshVisibleVideos() {
    const container = document.querySelector('.video-grid');
    if (!container) return;

    // Rebuild displayedVideos array to match current DOM order (important after sorting)
    const items = Array.from(container.querySelectorAll('.video-item:not(.is-hidden-by-filter)'));
    this.app.displayedVideos = items
      .map((item) => {
        const videoId = item.dataset.videoId;
        return this.app.videoMap.get(videoId);
      })
      .filter((v) => v !== undefined);

    // Update data-index attributes to match displayedVideos array positions
    items.forEach((item, index) => {
      item.dataset.index = index.toString();
    });

    this.app.updateStatusMessage();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FilterManager;
} else {
  window.FilterManager = FilterManager;
}
