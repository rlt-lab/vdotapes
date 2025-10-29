/**
 * EventController - Handles all event listeners, keyboard shortcuts, and context menu
 */
class EventController {
  constructor(app) {
    this.app = app;
    this.currentContextVideo = null;
  }

  setupEventListeners() {
    // Folder selection
    document.getElementById('folderBtn').addEventListener('click', () => {
      this.app.selectFolder();
    });

    // Filters
    document.getElementById('folderSelect').addEventListener('change', (e) => {
      this.app.filterManager.filterByFolder(e.target.value);
    });

    // Sort buttons
    document.getElementById('sortFolderBtn').addEventListener('click', () => {
      this.app.filterManager.setSortMode('folder');
    });

    document.getElementById('sortDateBtn').addEventListener('click', () => {
      this.app.filterManager.setSortMode('date');
    });

    document.getElementById('shuffleBtn').addEventListener('click', () => {
      this.app.filterManager.shuffleVideos();
    });

    // Favorites toggle
    document.getElementById('favoritesBtn').addEventListener('click', () => {
      this.app.filterManager.toggleFavoritesView();
    });

    // Multi-view toggle
    const multiBtn = document.getElementById('multiViewBtn');
    if (multiBtn) {
      multiBtn.addEventListener('click', () => this.app.uiHelper.toggleMultiView());
    }

    // Hidden files toggle
    document.getElementById('hiddenBtn').addEventListener('click', () => {
      this.app.filterManager.toggleHiddenView();
    });

    // Tag cloud button
    const tagCloudBtn = document.getElementById('tagCloudBtn');
    if (tagCloudBtn) {
      tagCloudBtn.addEventListener('click', () => {
        this.app.tagCloudManager.openTagCloud();
      });
    }

    // Dropdown menus
    this.setupDropdowns();

    // Grid size controls
    this.setupGridControls();

    // Expanded view controls
    this.setupExpandedViewControls();

    // Multi-view controls
    this.setupMultiViewControls();

    // Keyboard shortcuts
    this.setupKeyboardShortcuts();

    // Responsive handling
    window.addEventListener('resize', () => this.app.handleResize());

    // Scroll handling
    this.setupScrollHandler();

    // Event delegation for favorite buttons
    document.addEventListener('click', (e) => {
      if (e.target.closest('.video-favorite')) {
        const button = e.target.closest('.video-favorite');
        const videoId = button.dataset.videoId;
        if (videoId) {
          this.app.userDataManager.toggleFavorite(videoId, e);
        }
      }
    });

    // Event delegation for tag remove buttons
    document.addEventListener('click', (e) => {
      if (e.target.closest('.tag-remove')) {
        const button = e.target.closest('.tag-remove');
        const tagName = button.dataset.tagName;
        const tagList = button.closest('#tagList');
        const videoId = tagList?.dataset.videoId;

        if (videoId && tagName) {
          this.app.videoExpander.removeTag(videoId, tagName);
        }
      }
    });

    // Context menu
    this.setupContextMenu();
  }

  setupDropdowns() {
    // Sort dropdown
    const sortBtn = document.getElementById('sortBtn');
    const sortMenu = document.getElementById('sortMenu');
    const sortDropdown = document.getElementById('sortDropdown');

    if (sortBtn && sortMenu) {
      sortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sortMenu.classList.toggle('show');
        const settingsMenu = document.getElementById('settingsMenu');
        if (settingsMenu) settingsMenu.classList.remove('show');
      });
    }

    // Settings dropdown (formerly backup)
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsMenu = document.getElementById('settingsMenu');
    const settingsDropdown = document.getElementById('settingsDropdown');

    if (settingsBtn && settingsMenu) {
      settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('show');
        if (sortMenu) sortMenu.classList.remove('show');
      });

      // Backup export
      const backupExport = document.getElementById('backupExport');
      if (backupExport) {
        backupExport.addEventListener('click', async () => {
          try {
            settingsMenu.classList.remove('show');
            const res = await window.electronAPI.exportBackupToFile();
            if (res?.success) {
              this.app.uiHelper.showStatus(`Exported ${res.count} items → ${res.path}`);
            } else if (res?.error !== 'canceled') {
              this.app.uiHelper.showStatus('Backup export failed');
              console.error('Export error:', res?.error);
            }
          } catch (e) {
            console.error('Export failed:', e);
          }
        });
      }

      // Backup import
      const backupImport = document.getElementById('backupImport');
      if (backupImport) {
        backupImport.addEventListener('click', async () => {
          try {
            settingsMenu.classList.remove('show');
            const res = await window.electronAPI.importBackupFromFile();
            if (res?.success) {
              this.app.uiHelper.showStatus(`Imported: ${res.imported}, skipped: ${res.skipped}`);
              await this.app.userDataManager.refreshFavoritesFromDatabase();
              const hidden = await window.electronAPI.getHiddenFiles();
              if (hidden && Array.isArray(hidden)) {
                this.app.hiddenFiles = new Set(hidden);
                this.app.userDataManager.updateHiddenCount();
              }
            } else if (res?.error !== 'canceled') {
              this.app.uiHelper.showStatus('Backup import failed');
              console.error('Import error:', res?.error);
            }
          } catch (e) {
            console.error('Import failed:', e);
          }
        });
      }
    }

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (sortDropdown && !sortDropdown.contains(e.target)) {
        if (sortMenu) sortMenu.classList.remove('show');
      }
      if (settingsDropdown && !settingsDropdown.contains(e.target)) {
        if (settingsMenu) settingsMenu.classList.remove('show');
      }
    });
  }

  setupGridControls() {
    const gridBtn = document.getElementById('gridColsBtn');
    const gridCount = document.getElementById('gridColsCount');

    if (gridCount) gridCount.textContent = String(this.app.gridCols);

    if (gridBtn) {
      gridBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.app.setGridCols(this.app.gridCols >= 12 ? 1 : this.app.gridCols + 1);
        if (gridCount) gridCount.textContent = String(this.app.gridCols);
      });

      gridBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.app.setGridCols(this.app.gridCols <= 1 ? 12 : this.app.gridCols - 1);
        if (gridCount) gridCount.textContent = String(this.app.gridCols);
      });
    }
  }

  setupExpandedViewControls() {
    document.getElementById('closeBtn').addEventListener('click', () => {
      this.app.videoExpander.closeExpanded();
    });

    document.getElementById('expandedVideo').addEventListener('click', (e) => {
      e.stopPropagation();
      const video = e.currentTarget;
      if (video.paused) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });

    document.getElementById('expandedOverlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        this.app.videoExpander.closeExpanded();
      }
    });
  }

  setupMultiViewControls() {
    document.getElementById('multiViewCloseBtn').addEventListener('click', () => {
      this.app.uiHelper.closeMultiView();
    });

    document.getElementById('multiViewOverlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        this.app.uiHelper.closeMultiView();
      }
    });
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Check if tag cloud is open and close it first
        const tagCloudOverlay = document.getElementById('tagCloudOverlay');
        if (tagCloudOverlay && tagCloudOverlay.classList.contains('visible')) {
          this.app.tagCloudManager.closeTagCloud();
          return;
        }

        this.app.videoExpander.closeExpanded();
        this.app.uiHelper.closeMultiView();
      } else if (e.key === ' ') {
        const overlay = document.getElementById('expandedOverlay');
        if (overlay.classList.contains('active')) {
          e.preventDefault();
          this.app.videoExpander.closeExpanded();
        }
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const overlay = document.getElementById('expandedOverlay');
        if (overlay.classList.contains('active')) {
          e.preventDefault();
          const direction = e.key === 'ArrowRight' ? 1 : -1;
          this.app.videoExpander.navigateExpanded(direction);
        }
      }

      // Shortcuts in expanded view (require Shift modifier to avoid conflicts with typing)
      const overlay = document.getElementById('expandedOverlay');
      if (overlay && overlay.classList.contains('active')) {
        // Don't trigger shortcuts if user is typing in an input field
        const isTyping = document.activeElement && 
                        (document.activeElement.tagName === 'INPUT' || 
                         document.activeElement.tagName === 'TEXTAREA');
        if (isTyping) return;

        const current = this.app.currentExpandedVideo;
        if (!current) return;

        // Use Shift+key for shortcuts
        if (e.shiftKey && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          this.app.userDataManager.toggleFavorite(current.id, e);
        } else if (e.shiftKey && e.key.toLowerCase() === 'h') {
          e.preventDefault();
          this.app.userDataManager.toggleHiddenFile(current.id, e);
        } else if (e.shiftKey && e.key.toLowerCase() === 'o') {
          e.preventDefault();
          this.openFileLocation(current.path);
        }
      }
    });
  }

  setupScrollHandler() {
    // Placeholder for scroll handling if needed
  }

  setupContextMenu() {
    const contextMenu = document.getElementById('contextMenu');

    // Right-click on video items
    document.addEventListener('contextmenu', (e) => {
      const videoItem = e.target.closest('.video-item');
      if (videoItem) {
        e.preventDefault();

        const videoIndex = Array.from(videoItem.parentElement.children).indexOf(videoItem);
        this.currentContextVideo = this.app.displayedVideos[videoIndex];

        if (this.currentContextVideo) {
          const favoriteText = contextMenu.querySelector('.favorite-text');
          const isFavorited = this.app.favorites.has(this.currentContextVideo.id);
          favoriteText.textContent = isFavorited ? 'Remove from Favorites' : 'Add to Favorites';

          const hiddenText = contextMenu.querySelector('.hidden-text');
          const isHidden = this.app.hiddenFiles.has(this.currentContextVideo.id);
          hiddenText.textContent = isHidden ? 'Show' : 'Hide';

          this.showContextMenu(e.clientX, e.clientY);
        }
      }
    });

    // Handle context menu clicks
    contextMenu.addEventListener('click', async (e) => {
      const action = e.target.closest('.context-menu-item')?.dataset.action;

      if (action && this.currentContextVideo) {
        switch (action) {
          case 'open-location':
            await this.openFileLocation(this.currentContextVideo.path);
            break;
          case 'toggle-favorite':
            await this.app.userDataManager.toggleFavorite(this.currentContextVideo.id, e);
            break;
          case 'add-to-multi-view':
            this.app.uiHelper.addToMultiView(this.currentContextVideo);
            break;
          case 'toggle-hidden':
            await this.app.userDataManager.toggleHiddenFile(this.currentContextVideo.id, e);
            break;
        }
      }

      this.hideContextMenu();
    });

    // Hide on click outside
    document.addEventListener('click', (e) => {
      if (!contextMenu.contains(e.target)) {
        this.hideContextMenu();
      }
    });

    // Hide on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideContextMenu();
      }
    });
  }

  showContextMenu(x, y) {
    const contextMenu = document.getElementById('contextMenu');
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = 200;
    const menuHeight = 160;

    let menuX = x;
    let menuY = y;

    if (x + menuWidth > viewportWidth) {
      menuX = x - menuWidth;
    }

    if (y + menuHeight > viewportHeight) {
      menuY = y - menuHeight;
    }

    contextMenu.style.left = menuX + 'px';
    contextMenu.style.top = menuY + 'px';
    contextMenu.classList.add('show');
  }

  hideContextMenu() {
    const contextMenu = document.getElementById('contextMenu');
    contextMenu.classList.remove('show');
  }

  async openFileLocation(filePath) {
    try {
      const success = await window.electronAPI.showItemInFolder(filePath);
      if (!success) {
        console.error('Failed to open file location');
      }
    } catch (error) {
      console.error('Error opening file location:', error);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EventController;
} else {
  window.EventController = EventController;
}
