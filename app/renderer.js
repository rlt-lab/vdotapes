/**
 * VdoTapes App - Main Coordinator
 * Delegates responsibilities to specialized modules
 */
class VdoTapesApp {
  constructor() {
    console.log('[App] VdoTapesApp constructor starting...');
    // Constants
    this.MAIN_PROCESS_READY_DELAY = 500;
    this.SETTINGS_LOAD_DELAY = 1000;

    // Core state
    this.allVideos = [];
    this.displayedVideos = [];
    this.folders = [];
    this.currentFolder = '';
    this.currentSort = 'shuffle';  // Default to random order
    this.gridCols = this.getDefaultGridCols();
    this.isLoading = false;
    this.favorites = new Set();
    this.showingFavoritesOnly = false;
    this.hiddenFiles = new Set();
    this.showingHiddenOnly = false;

    console.log('[App] Initial state - showingFavoritesOnly:', this.showingFavoritesOnly, 'showingHiddenOnly:', this.showingHiddenOnly, 'currentFolder:', this.currentFolder);
    this.multiViewQueue = [];
    this.previousViewState = { folder: '', sort: 'shuffle' };
    this.currentExpandedIndex = -1;
    
    // Tags
    this.activeTags = [];  // Array of active tag names for filtering
    this.videoTags = {};   // Map: videoId -> [tag names]
    this.tagFilterMode = 'OR';  // 'AND' or 'OR' - how to combine multiple tags

    // Smart loading (single video loading system)
    this.smartLoader = null

    // Initialize modules
    this.thumbnailPreloader = new ThumbnailPreloader({ app: this, maxConcurrent: 3, useFirstFrame: true });
    this.videoManager = new VideoManager(this);
    this.videoExpander = new VideoExpander(this);
    this.filterManager = new FilterManager(this);
    this.tagManager = new TagManager(this);
    this.tagCloudManager = new TagCloudManager(this);
    this.gridRenderer = new GridRenderer(this);
    this.userDataManager = new UserDataManager(this);
    this.uiHelper = new UIHelper(this);
    this.eventController = new EventController(this);

    this.init();
    
    // Expose recovery mechanism for debugging
    window.debugRecoverVideos = () => {
      this.videoManager.checkAndRecoverStuckVideos();
    };
  }

  getDefaultGridCols() {
    const width = window.innerWidth;
    if (width >= 2560) return 8;
    if (width >= 1920) return 6;
    if (width >= 1200) return 4;
    if (width >= 768) return 3;
    return 2;
  }

  async init() {
    await new Promise((resolve) => setTimeout(resolve, this.MAIN_PROCESS_READY_DELAY));

    this.eventController.setupEventListeners();
    this.setupSmartLoader();
    this.uiHelper.updateGridLayout();
    this.userDataManager.updateFavoritesCount();
    this.tagManager.initialize();
    this.tagCloudManager.initialize();

    // Set initial sort button state
    this.filterManager.updateSortButtonStates();

    await this.userDataManager.loadSettings();

    window.addEventListener('beforeunload', async () => {
      await this.userDataManager.flushPendingSaves();
      await this.userDataManager.saveSettingsImmediate();
    });
  }

  setupSmartLoader() {
    try {
      this.smartLoader = new VideoSmartLoader({
        maxActiveVideos: 100,
        loadBuffer: 3,
      });
      console.log('Smart video loader initialized (max: 100 videos)');
    } catch (error) {
      console.error('Error setting up smart loader:', error);
      this.smartLoader = null;
    }
  }

  get currentExpandedVideo() {
    if (this.currentExpandedIndex < 0) return null;
    return this.displayedVideos[this.currentExpandedIndex] || null;
  }

  async selectFolder() {
    try {
      const result = await window.electronAPI.selectFolder();
      if (result && result.path) {
        await this.scanVideos(result.path);
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
      this.uiHelper.showStatus('Error selecting folder');
    }
  }

  async scanVideos(folderPath) {
    try {
      // Flush pending saves before switching folders
      await this.userDataManager.flushPendingSaves();

      this.uiHelper.showProgress(0, 'Initializing scan...');

      const progressHandler = (progress) => {
        this.uiHelper.showMetadataProgress(progress);
      };

      if (window.electronAPI.onScanProgress) {
        window.electronAPI.onScanProgress(progressHandler);
      }

      const result = await window.electronAPI.scanVideos(folderPath);

      if (result.success) {
        try {
          const dbVideos = await window.electronAPI.getVideos({ sortBy: 'none' });
          console.log('[App] getVideos returned', dbVideos.length, 'videos from database');
          console.log('[App] Scan result has', result.videos.length, 'videos');
          if (dbVideos && dbVideos.length > 0) {
            this.allVideos = dbVideos;
            console.log('[App] Using database videos, allVideos.length =', this.allVideos.length);
            const folderSet = new Set();
            dbVideos.forEach(video => {
              if (video.folder) folderSet.add(video.folder);
            });
            this.folders = Array.from(folderSet).sort();
          } else {
            this.allVideos = result.videos;
            this.folders = result.folders;
          }

          this.populateFolderDropdown();

          // Load favorites and apply to video objects
          const favorites = await window.electronAPI.getFavorites();
          if (favorites && Array.isArray(favorites)) {
            this.favorites = new Set(favorites);
            // Mark videos as favorited
            this.allVideos.forEach(video => {
              video.isFavorite = this.favorites.has(video.id);
            });
            this.userDataManager.updateFavoritesCount();
            console.log(`[App] Applied ${favorites.length} favorites to videos`);
          }

          // Load hidden files and apply to video objects
          const hiddenFiles = await window.electronAPI.getHiddenFiles();
          if (hiddenFiles && Array.isArray(hiddenFiles)) {
            this.hiddenFiles = new Set(hiddenFiles);
            // Mark videos as hidden
            this.allVideos.forEach(video => {
              video.isHidden = this.hiddenFiles.has(video.id);
            });
            this.userDataManager.updateHiddenCount();
            console.log(`[App] Applied ${hiddenFiles.length} hidden files to videos`);
          }

          // Load tags for all videos (BATCH OPERATION - single query)
          console.log('[App] Loading tags for all videos...');
          try {
            const allVideoTags = await window.electronAPI.getAllVideoTags();
            this.videoTags = allVideoTags;

            const totalVideosWithTags = Object.keys(allVideoTags).length;
            const totalTags = Object.values(allVideoTags).reduce((sum, tags) => sum + tags.length, 0);

            console.log(`[App] Loaded tags for ${totalVideosWithTags} videos (${totalTags} total tags) in single query`);
          } catch (error) {
            console.error('Error loading all video tags:', error);
            this.videoTags = {};
          }

          // Load all unique tags for autocomplete
          if (this.tagManager) {
            await this.tagManager.loadAllTags();
          }
        } catch (error) {
          console.error('Error loading videos from database:', error);
          this.allVideos = result.videos;
          this.folders = result.folders;
          this.populateFolderDropdown();
        }

        console.log('[App] About to apply filters - showingFavoritesOnly:', this.showingFavoritesOnly, 'showingHiddenOnly:', this.showingHiddenOnly, 'currentFolder:', this.currentFolder, 'activeTags:', this.activeTags);
        this.applyCurrentFilters();
        this.uiHelper.hideProgress();
        this.uiHelper.showFilterControls();
        this.uiHelper.updateStatusMessage();

        if (result.metadataStats) {
          const stats = result.metadataStats;
          const message = `Scan complete: ${stats.totalVideos} videos, ${stats.withValidMetadata} with metadata`;
          this.uiHelper.showStatus(message);
          console.log('Metadata extraction stats:', stats);
        }

        try {
          // Save last folder for auto-load on next launch
          await window.electronAPI.saveLastFolder(folderPath);
          await this.userDataManager.saveSettings();
          console.log('[App] Saved last folder:', folderPath);
        } catch (error) {
          console.error('Error saving settings:', error);
        }
      }
    } catch (error) {
      console.error('Error scanning videos:', error);
      this.uiHelper.hideProgress();
      this.uiHelper.showStatus('Error scanning folder');
    }
  }

  populateFolderDropdown() {
    const select = document.getElementById('folderSelect');
    select.innerHTML = '<option value="">All Folders</option>';

    this.folders.forEach((folder) => {
      const option = document.createElement('option');
      option.value = folder;
      option.textContent = folder;
      select.appendChild(option);
    });

    if (this.currentFolder) {
      select.value = this.currentFolder;
    }
  }

  applyCurrentFilters() {
    this.filterManager.applyCurrentFilters();
  }

  renderGrid() {
    this.gridRenderer.renderGrid();
  }

  setGridCols(n) {
    const clamped = Math.max(1, Math.min(12, parseInt(n, 10) || this.gridCols));
    if (clamped === this.gridCols) return;
    this.gridCols = clamped;
    this.uiHelper.updateGridSize();
  }

  handleResize() {
    this.uiHelper.handleResize();
  }

  // Delegation methods for backward compatibility
  formatFileSize(bytes) {
    return this.uiHelper.formatFileSize(bytes);
  }

  formatDuration(seconds) {
    return this.uiHelper.formatDuration(seconds);
  }

  updateStatusMessage() {
    this.uiHelper.updateStatusMessage();
  }

  updateGridLayout() {
    this.uiHelper.updateGridLayout();
  }

  showStatus(message) {
    this.uiHelper.showStatus(message);
  }

  showEmptyState() {
    this.uiHelper.showEmptyState();
  }

  updateFavoritesCount() {
    this.userDataManager.updateFavoritesCount();
  }

  updateHiddenCount() {
    this.userDataManager.updateHiddenCount();
  }

  saveSettings() {
    return this.userDataManager.saveSettings();
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new VdoTapesApp();
});
