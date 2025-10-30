/**
 * UserDataManager - Manages favorites, hidden files, and user preferences
 */
class UserDataManager {
  constructor(app) {
    this.app = app;
  }

  async toggleFavorite(videoId, event) {
    event.preventDefault();
    event.stopPropagation();

    try {
      const video = this.app.allVideos.find((v) => v.id === videoId);
      if (!video) {
        console.error('Video not found:', videoId);
        return;
      }

      const isCurrentlyFavorited = video.isFavorite === true;
      const success = await window.electronAPI.saveFavorite(videoId, !isCurrentlyFavorited);

      if (success) {
        video.isFavorite = !isCurrentlyFavorited;

        if (video.isFavorite) {
          this.app.favorites.add(videoId);
        } else {
          this.app.favorites.delete(videoId);
        }

        if (this.app.useWasmEngine && this.app.gridEngine) {
          try {
            this.app.gridEngine.updateFavorites(Array.from(this.app.favorites));
          } catch (error) {
            console.error('Error updating WASM favorites:', error);
          }
        }

        this.updateFavoritesCount();

        const el = document.querySelector(`.video-item[data-video-id="${videoId}"] .video-favorite`);
        if (el) el.classList.toggle('favorited', video.isFavorite === true);

        if (this.app.showingFavoritesOnly && !video.isFavorite) {
          const itemEl = document.querySelector(`.video-item[data-video-id="${videoId}"]`);
          if (itemEl) itemEl.classList.add('is-hidden-by-filter');
          this.app.updateStatusMessage();
        }

        if (this.app.currentExpandedIndex !== -1) {
          const cur = this.app.currentExpandedVideo;
          if (cur && cur.id === videoId) {
            this.app.videoExpander.refreshExpandedSidebar(cur);
          }
        }
      } else {
        console.error('Failed to save favorite for video:', videoId);
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
    }
  }

  async toggleHiddenFile(videoId, event) {
    event.preventDefault();
    event.stopPropagation();

    try {
      const isCurrentlyHidden = this.app.hiddenFiles.has(videoId);
      const newHiddenState = !isCurrentlyHidden;

      const result = await window.electronAPI.setHiddenStatus(videoId, newHiddenState);

      if (result.success) {
        if (newHiddenState) {
          this.app.hiddenFiles.add(videoId);
        } else {
          this.app.hiddenFiles.delete(videoId);
        }

        if (this.app.useWasmEngine && this.app.gridEngine) {
          this.app.gridEngine.updateHidden(Array.from(this.app.hiddenFiles));
        }

        this.updateHiddenCount();

        const itemEl = document.querySelector(`.video-item[data-video-id="${videoId}"]`);
        if (itemEl) {
          if (this.app.showingHiddenOnly) {
            itemEl.classList.toggle('is-hidden-by-filter', isCurrentlyHidden);
          } else {
            itemEl.classList.toggle('is-hidden-by-filter', !isCurrentlyHidden);
          }
        }

        this.app.updateStatusMessage();

        if (this.app.currentExpandedIndex !== -1) {
          const cur = this.app.currentExpandedVideo;
          if (cur && cur.id === videoId) {
            this.app.videoExpander.refreshExpandedSidebar(cur);
          }
        }
      }
    } catch (error) {
      console.error('Error toggling hidden status:', error);
    }
  }

  updateFavoritesCount() {
    const count = this.app.favorites.size;
    const countElement = document.getElementById('favoritesCount');
    if (countElement) {
      countElement.textContent = count;
    }
  }

  updateHiddenCount() {
    const count = this.app.hiddenFiles.size;
    const countElement = document.getElementById('hiddenCount');
    if (countElement) {
      countElement.textContent = count;
    }
  }

  async refreshFavoritesFromDatabase() {
    try {
      const favorites = await window.electronAPI.getFavorites();
      if (favorites && Array.isArray(favorites)) {
        this.app.favorites = new Set(favorites);
        this.updateFavoritesCount();

        this.app.allVideos = this.app.allVideos.map((video) => ({
          ...video,
          isFavorite: this.app.favorites.has(video.id),
        }));

        if (this.app.displayedVideos.length > 0) {
          this.app.applyCurrentFilters();
        }
      }
    } catch (error) {
      console.error('Error refreshing favorites:', error);
    }
  }

  async loadSettings() {
    try {
      await new Promise((resolve) => setTimeout(resolve, this.app.SETTINGS_LOAD_DELAY));

      console.log('[UserDataManager] Loading settings...');

      const preferences = await window.electronAPI.getUserPreferences();
      console.log('[UserDataManager] Loaded preferences from database:', preferences);

      if (preferences) {
        this.app.gridCols = preferences.gridColumns || this.app.gridCols;
        this.app.currentSort = preferences.sortPreference?.sortBy || 'folder';

        // Don't restore favorites-only, hidden-only, or folder filter state - always show all videos on startup
        console.log('[UserDataManager] BEFORE RESET - showingFavoritesOnly:', this.app.showingFavoritesOnly, 'showingHiddenOnly:', this.app.showingHiddenOnly, 'currentFolder:', this.app.currentFolder);

        this.app.showingFavoritesOnly = false;
        this.app.showingHiddenOnly = false;
        this.app.currentFolder = '';  // Reset to show ALL folders

        console.log('[UserDataManager] AFTER RESET - showingFavoritesOnly:', this.app.showingFavoritesOnly, 'showingHiddenOnly:', this.app.showingHiddenOnly, 'currentFolder:', this.app.currentFolder);

        // Immediately save reset filter state to database to ensure consistency
        console.log('[UserDataManager] Saving reset filter state to database...');
        await window.electronAPI.saveUserPreferences({
          gridColumns: this.app.gridCols,
          sortPreference: { sortBy: this.app.currentSort },
          folderFilter: '',  // Reset to show all folders
          favoritesOnly: false,  // Reset to show all videos
          hiddenOnly: false,  // Reset to show non-hidden videos
        });
        console.log('[UserDataManager] Reset and saved filter states to database');

        const gridInput = document.getElementById('gridCols');
        if (gridInput) gridInput.value = this.app.gridCols;
        const gridCount = document.getElementById('gridColsCount');
        if (gridCount) gridCount.textContent = String(this.app.gridCols);
        const folderSel = document.getElementById('folderSelect');
        if (folderSel) folderSel.value = '';  // Set to "All Folders"
        this.app.filterManager.updateSortButtonStates();

        // Ensure buttons reflect the reset state (not active on startup)
        document.getElementById('favoritesBtn').classList.remove('active');
        document.getElementById('hiddenBtn').classList.remove('active');
        
        console.log('[UserDataManager] Preferences loaded:', {
          gridCols: this.app.gridCols,
          sort: this.app.currentSort,
          favoritesOnly: this.app.showingFavoritesOnly,
          hiddenOnly: this.app.showingHiddenOnly,
          folderFilter: this.app.currentFolder
        });
      }

      const favorites = await window.electronAPI.getFavorites();
      if (favorites && Array.isArray(favorites)) {
        this.app.favorites = new Set(favorites);
        this.updateFavoritesCount();
        console.log(`[UserDataManager] Loaded ${favorites.length} favorites`);
      }

      const hiddenFiles = await window.electronAPI.getHiddenFiles();
      if (hiddenFiles && Array.isArray(hiddenFiles)) {
        this.app.hiddenFiles = new Set(hiddenFiles);
        this.updateHiddenCount();
        console.log(`[UserDataManager] Loaded ${hiddenFiles.length} hidden files`);
      }

      // Auto-load last folder if it exists
      const lastFolder = await window.electronAPI.getLastFolder();
      if (lastFolder && lastFolder.trim() !== '') {
        console.log(`[UserDataManager] Auto-loading last folder: ${lastFolder}`);
        // Give UI time to initialize before scanning
        setTimeout(() => {
          this.app.scanVideos(lastFolder);
        }, 500);
      } else {
        console.log('[UserDataManager] No last folder to auto-load');
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  async saveSettings() {
    try {
      await window.electronAPI.saveUserPreferences({
        gridColumns: this.app.gridCols,
        sortPreference: { sortBy: this.app.currentSort },
        folderFilter: this.app.currentFolder,
        favoritesOnly: this.app.showingFavoritesOnly,
        hiddenOnly: this.app.showingHiddenOnly,
      });
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = UserDataManager;
} else {
  window.UserDataManager = UserDataManager;
}
