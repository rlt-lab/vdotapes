/**
 * FilterManager - Handles filtering and sorting of videos
 */
class FilterManager {
  constructor(app) {
    this.app = app;
  }

  filterByFolder(folderName) {
    this.app.currentFolder = folderName;
    this.applyCurrentFilters();
    this.app.updateStatusMessage();
    this.app.saveSettings();
  }

  setSortMode(sortMode) {
    this.app.currentSort = sortMode;
    this.updateSortButtonStates();
    this.reorderGridInPlace();
    this.app.updateStatusMessage();
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

    const items = Array.from(container.children);
    if (items.length === 0) return;

    const mode = this.app.currentSort;
    items.sort((a, b) => {
      const fa = (a.dataset.folder || '').toLowerCase();
      const fb = (b.dataset.folder || '').toLowerCase();
      const da = parseInt(a.dataset.lastModified || '0', 10);
      const db = parseInt(b.dataset.lastModified || '0', 10);

      if (mode === 'folder') {
        const fc = fa.localeCompare(fb);
        if (fc !== 0) return fc;
        return db - da;
      } else if (mode === 'date') {
        return db - da;
      }
      return 0;
    });

    const frag = document.createDocumentFragment();
    items.forEach((el, newIndex) => {
      // CRITICAL: Update data-index to match new position after sorting
      el.dataset.index = newIndex.toString();
      frag.appendChild(el);
    });
    container.appendChild(frag);
    this.refreshVisibleVideos();
  }

  async shuffleVideos() {
    const btn = document.getElementById('shuffleBtn');
    btn.classList.add('shuffling');

    this.app.currentSort = 'shuffle';
    this.updateSortButtonStates();

    let videosToShuffle = [...this.app.displayedVideos];

    for (let i = videosToShuffle.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [videosToShuffle[i], videosToShuffle[j]] = [videosToShuffle[j], videosToShuffle[i]];
    }

    this.app.displayedVideos = videosToShuffle;
    this.app.renderGrid();
    this.app.updateStatusMessage();

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

    this.applyCurrentFilters();
    this.app.updateStatusMessage();
    this.app.saveSettings();
  }

  toggleHiddenView() {
    this.app.showingHiddenOnly = !this.app.showingHiddenOnly;
    const btn = document.getElementById('hiddenBtn');
    btn.classList.toggle('active', this.app.showingHiddenOnly);

    this.applyCurrentFilters();
    this.app.updateStatusMessage();
    this.app.saveSettings();
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

        // Apply tag filtering in JS (WASM doesn't support tags yet)
        if (this.app.activeTags && this.app.activeTags.length > 0) {
          filteredVideos = filteredVideos.filter(video => {
            const videoTags = this.app.videoTags[video.id] || [];
            if (this.app.tagFilterMode === 'AND') {
              // AND logic: video must have ALL selected tags
              return this.app.activeTags.every(tag => videoTags.includes(tag));
            } else {
              // OR logic: video must have at least ONE selected tag
              return this.app.activeTags.some(tag => videoTags.includes(tag));
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

    let filtered = [...this.app.allVideos];

    if (this.app.currentFolder) {
      filtered = filtered.filter((video) => video.folder === this.app.currentFolder);
    }

    if (this.app.showingFavoritesOnly) {
      filtered = filtered.filter((video) => video.isFavorite === true);
    }

    if (this.app.showingHiddenOnly) {
      filtered = filtered.filter((video) => this.app.hiddenFiles.has(video.id));
    } else {
      filtered = filtered.filter((video) => !this.app.hiddenFiles.has(video.id));
    }

    // Apply tag filtering
    if (this.app.activeTags && this.app.activeTags.length > 0) {
      filtered = filtered.filter(video => {
        const videoTags = this.app.videoTags[video.id] || [];
        if (this.app.tagFilterMode === 'AND') {
          // AND logic: video must have ALL selected tags
          return this.app.activeTags.every(tag => videoTags.includes(tag));
        } else {
          // OR logic: video must have at least ONE selected tag
          return this.app.activeTags.some(tag => videoTags.includes(tag));
        }
      });
      const mode = this.app.tagFilterMode === 'AND' ? 'all' : 'any';
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

    items.forEach((item) => {
      const videoId = item.dataset.videoId;
      const video = this.app.allVideos.find((v) => v.id === videoId);
      if (!video) {
        item.classList.add('is-hidden-by-filter');
        return;
      }

      let shouldShow = true;

      if (this.app.currentFolder && video.folder !== this.app.currentFolder) {
        shouldShow = false;
      }

      if (this.app.showingFavoritesOnly && !this.app.favorites.has(video.id)) {
        shouldShow = false;
      }

      if (this.app.showingHiddenOnly) {
        shouldShow = this.app.hiddenFiles.has(video.id);
      } else if (this.app.hiddenFiles.has(video.id)) {
        shouldShow = false;
      }

      item.classList.toggle('is-hidden-by-filter', !shouldShow);
    });

    this.refreshVisibleVideos();
  }

  refreshVisibleVideos() {
    const container = document.querySelector('.video-grid');
    if (!container) return;

    // Rebuild displayedVideos array to match current DOM order (important after sorting)
    const items = Array.from(container.querySelectorAll('.video-item:not(.is-hidden-by-filter)'));
    this.app.displayedVideos = items
      .map((item) => {
        const videoId = item.dataset.videoId;
        return this.app.allVideos.find((v) => v.id === videoId);
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
