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

      const preferences = await window.electronAPI.getUserPreferences();
      if (preferences) {
        this.app.gridCols = preferences.gridColumns || this.app.gridCols;
        this.app.currentSort = preferences.sortPreference?.sortBy || 'folder';
        this.app.showingFavoritesOnly = preferences.favoritesOnly || false;
        this.app.showingHiddenOnly = preferences.hiddenOnly || false;
        this.app.currentFolder = preferences.folderFilter || '';

        const gridInput = document.getElementById('gridCols');
        if (gridInput) gridInput.value = this.app.gridCols;
        const gridCount = document.getElementById('gridColsCount');
        if (gridCount) gridCount.textContent = String(this.app.gridCols);
        const folderSel = document.getElementById('folderSelect');
        if (folderSel) folderSel.value = this.app.currentFolder;
        this.app.filterManager.updateSortButtonStates();

        if (this.app.showingFavoritesOnly) {
          document.getElementById('favoritesBtn').classList.add('active');
        }

        if (this.app.showingHiddenOnly) {
          document.getElementById('hiddenBtn').classList.add('active');
        }
      }

      const favorites = await window.electronAPI.getFavorites();
      if (favorites && Array.isArray(favorites)) {
        this.app.favorites = new Set(favorites);
        this.updateFavoritesCount();
      }

      const hiddenFiles = await window.electronAPI.getHiddenFiles();
      if (hiddenFiles && Array.isArray(hiddenFiles)) {
        this.app.hiddenFiles = new Set(hiddenFiles);
        this.updateHiddenCount();
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
