class VdoTapesApp {
  constructor() {
    // Constants
    this.MAIN_PROCESS_READY_DELAY = 500;
    this.SETTINGS_LOAD_DELAY = 1000;
    this.PREVIEW_LOOP_DURATION = 5; // seconds
    this.LOAD_TIMEOUT = 10000; // 10 seconds

    this.allVideos = [];
    this.displayedVideos = [];
    this.folders = [];
    this.currentFolder = '';
    this.currentSort = 'folder'; // 'folder' or 'date'
    this.gridCols = this.getDefaultGridCols();
    this.isLoading = false;
    this.observer = null;
    this.favorites = new Set();
    this.showingFavoritesOnly = false;
    this.hiddenFiles = new Set();
    this.showingHiddenFiles = false;
    this.showingHiddenOnly = false;
    this.multiViewQueue = [];
    this.isMultiViewActive = false;
    this.previousViewState = { folder: '', sort: 'folder' };
    this.currentExpandedIndex = -1; // Track which video is currently expanded


    // Smart loading for all collections (no heavy virtualization)
    this.smartLoader = null;
    this.useSmartLoading = true;

    // Video lifecycle management - disabled for now
    this.videoLifecycleManager = null;
    this.videoVisibilityManager = null;

    this.init();
  }

  getDefaultGridCols() {
    const width = window.innerWidth;
    if (width >= 2560) return 8; // 4K+ displays
    if (width >= 1920) return 6; // 1080p+ displays
    if (width >= 1200) return 4; // Standard desktop
    if (width >= 768) return 3; // Tablet
    return 2; // Mobile
  }

  async init() {
    // Wait for main process to be ready
    await new Promise((resolve) => setTimeout(resolve, this.MAIN_PROCESS_READY_DELAY));

    this.setupEventListeners();
    this.setupIntersectionObserver();
    this.setupSmartLoader();
    this.updateGridSize();
    this.updateFavoritesCount();

    await this.loadSettings();

    // Clean up when page unloads
    window.addEventListener('beforeunload', () => {
      this.saveSettings();
    });
  }

  get currentExpandedVideo() {
    if (this.currentExpandedIndex < 0) return null;
    return this.displayedVideos[this.currentExpandedIndex] || null;
  }

  async loadSettings() {
    try {
      // Wait a bit more for the main process to be fully ready
      await new Promise((resolve) => setTimeout(resolve, this.SETTINGS_LOAD_DELAY));

      // Load user preferences
      const preferences = await window.electronAPI.getUserPreferences();
      if (preferences) {
        this.gridCols = preferences.gridColumns || this.gridCols;
        this.currentSort = preferences.sortPreference?.sortBy || 'folder';
        this.showingFavoritesOnly = preferences.favoritesOnly || false;
        this.showingHiddenOnly = preferences.hiddenOnly || false;
        this.currentFolder = preferences.folderFilter || '';

        // Update UI to reflect loaded settings
        const gridInput = document.getElementById('gridCols');
        if (gridInput) gridInput.value = this.gridCols;
        const gridCount = document.getElementById('gridColsCount');
        if (gridCount) gridCount.textContent = String(this.gridCols);
        const folderSel = document.getElementById('folderSelect');
        if (folderSel) folderSel.value = this.currentFolder;
        this.updateSortButtonStates();

        if (this.showingFavoritesOnly) {
          document.getElementById('favoritesBtn').classList.add('active');
        }

        if (this.showingHiddenOnly) {
          document.getElementById('hiddenBtn').classList.add('active');
        }
      }

      // Load favorites from database
      try {
        const favorites = await window.electronAPI.getFavorites();
        if (favorites && Array.isArray(favorites)) {
          this.favorites = new Set(favorites);
          this.updateFavoritesCount();
        }
      } catch (error) {
        console.error('Error loading favorites:', error);
        this.favorites = new Set();
      }

      // Load hidden files from database
      try {
        const hiddenFiles = await window.electronAPI.getHiddenFiles();
        if (hiddenFiles && Array.isArray(hiddenFiles)) {
          this.hiddenFiles = new Set(hiddenFiles);
          this.updateHiddenCount();
        }
      } catch (error) {
        console.error('Error loading hidden files:', error);
        this.hiddenFiles = new Set();
      }

      // Load last folder and scan if it exists
      try {
        const lastFolder = await window.electronAPI.getLastFolder();
        if (lastFolder) {
          this.showLoading('Loading previous folder...');
          await this.scanVideos(lastFolder);
        }
      } catch (error) {
        console.error('Error loading last folder:', error);
        // Continue without loading last folder if there's an error
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  async saveSettings() {
    try {
      const preferences = {
        gridColumns: this.gridCols,
        sortPreference: {
          sortBy: this.currentSort,
          sortOrder: 'ASC',
        },
        folderFilter: this.currentFolder,
        favoritesOnly: this.showingFavoritesOnly,
        hiddenOnly: this.showingHiddenOnly,
      };

      await window.electronAPI.saveUserPreferences(preferences);
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  setupEventListeners() {
    // Folder selection
    document.getElementById('folderBtn').addEventListener('click', () => {
      this.selectFolder();
    });

    // Filters
    document.getElementById('folderSelect').addEventListener('change', (e) => {
      this.filterByFolder(e.target.value);
    });

    // Sort buttons
    document.getElementById('sortFolderBtn').addEventListener('click', () => {
      this.setSortMode('folder');
    });

    document.getElementById('sortDateBtn').addEventListener('click', () => {
      this.setSortMode('date');
    });

    document.getElementById('shuffleBtn').addEventListener('click', () => {
      this.shuffleVideos();
    });


    // Favorites toggle
    document.getElementById('favoritesBtn').addEventListener('click', () => {
      this.toggleFavoritesView();
    });

    // Multi-view toggle (button may be absent)
    const multiBtn = document.getElementById('multiViewBtn');
    if (multiBtn) {
      multiBtn.addEventListener('click', () => this.toggleMultiView());
    }

    // Hidden files toggle
    document.getElementById('hiddenBtn').addEventListener('click', () => {
      this.toggleHiddenView();
    });

    // Backup dropdown
    const backupBtn = document.getElementById('backupBtn');
    const backupMenu = document.getElementById('backupMenu');
    const backupExport = document.getElementById('backupExport');
    const backupImport = document.getElementById('backupImport');
    if (backupBtn && backupMenu) {
      backupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        backupMenu.classList.toggle('open');
      });
      document.addEventListener('click', () => backupMenu.classList.remove('open'));
    }
    if (backupExport) {
      backupExport.addEventListener('click', async () => {
        try {
          backupMenu?.classList.remove('open');
          const res = await window.electronAPI.exportBackupToFile();
          if (res?.success) {
            this.showStatus(`Exported ${res.count} items → ${res.path}`);
          } else if (res?.error !== 'canceled') {
            this.showStatus('Backup export failed');
            console.error('Export error:', res?.error);
          }
        } catch (e) {
          console.error('Export failed:', e);
        }
      });
    }
    if (backupImport) {
      backupImport.addEventListener('click', async () => {
        try {
          backupMenu?.classList.remove('open');
          const res = await window.electronAPI.importBackupFromFile();
          if (res?.success) {
            this.showStatus(`Imported: ${res.imported}, skipped: ${res.skipped}`);
            await this.refreshFavoritesFromDatabase();
            const hidden = await window.electronAPI.getHiddenFiles();
            if (hidden && Array.isArray(hidden)) {
              this.hiddenFiles = new Set(hidden);
              this.updateHiddenCount();
            }
          } else if (res?.error !== 'canceled') {
            this.showStatus('Backup import failed');
            console.error('Import error:', res?.error);
          }
        } catch (e) {
          console.error('Import failed:', e);
        }
      });
    }

    // Grid size
    // Grid columns button (click to increase, right-click to decrease)
    const gridBtn = document.getElementById('gridColsBtn');
    const gridCount = document.getElementById('gridColsCount');
    if (gridCount) gridCount.textContent = String(this.gridCols);
    if (gridBtn) {
      gridBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.setGridCols(this.gridCols >= 12 ? 1 : this.gridCols + 1);
        if (gridCount) gridCount.textContent = String(this.gridCols);
      });
      gridBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.setGridCols(this.gridCols <= 1 ? 12 : this.gridCols - 1);
        if (gridCount) gridCount.textContent = String(this.gridCols);
      });
    }

    // Expanded view
    document.getElementById('closeBtn').addEventListener('click', () => {
      this.closeExpanded();
    });

    // Click to play/pause expanded video
    document.getElementById('expandedVideo').addEventListener('click', (e) => {
      // Prevent click from bubbling to overlay
      e.stopPropagation();
      const video = e.currentTarget;
      if (video.paused) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });

    // Multi-view close
    document.getElementById('multiViewCloseBtn').addEventListener('click', () => {
      this.closeMultiView();
    });

    document.getElementById('expandedOverlay').addEventListener('click', (e) => {
      // Close if clicking the overlay itself (black space) but not the video
      if (e.target === e.currentTarget) {
        this.closeExpanded();
      }
    });

    document.getElementById('multiViewOverlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeMultiView();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeExpanded();
        this.closeMultiView();
      } else if (e.key === ' ') {
        // Spacebar to close expanded view
        const overlay = document.getElementById('expandedOverlay');
        if (overlay.classList.contains('active')) {
          e.preventDefault();
          this.closeExpanded();
        }
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        // Only handle arrow keys when expanded view is active
        const overlay = document.getElementById('expandedOverlay');
        if (overlay.classList.contains('active')) {
          e.preventDefault();
          if (e.key === 'ArrowRight') {
            this.navigateExpanded('next');
          } else if (e.key === 'ArrowLeft') {
            this.navigateExpanded('prev');
          }
        }
      }
    });

    // Responsive handling
    window.addEventListener('resize', () => this.handleResize());

    // Event delegation for favorite buttons
    document.addEventListener('click', (e) => {
      if (e.target.closest('.video-favorite')) {
        const button = e.target.closest('.video-favorite');
        const videoId = button.dataset.videoId;
        if (videoId) {
          this.toggleFavorite(videoId, e);
        }
      }
    });

    // Context menu handling
    this.setupContextMenu();
  }

  setupIntersectionObserver() {
    // Legacy observer - now handled by smart loader
    this.observer = null;
  }

  setupSmartLoader() {
    try {
      this.smartLoader = new VideoSmartLoader({
        maxActiveVideos: 30,
        loadBuffer: 20,
      });
      console.log('Smart video loader initialized');
    } catch (error) {
      console.error('Error setting up smart loader:', error);
      this.smartLoader = null;
    }
  }

  setupVideoLifecycleManager() {
    try {
      this.videoLifecycleManager = new VideoLifecycleManager({
        maxActiveVideos: 20,
        cleanupInterval: 30000,
      });

      this.videoVisibilityManager = new VideoVisibilityManager(this.videoLifecycleManager);

      console.log('Video lifecycle manager initialized');
    } catch (error) {
      console.error('Error setting up video lifecycle manager:', error);
      this.videoLifecycleManager = null;
      this.videoVisibilityManager = null;
    }
  }

  async selectFolder() {
    try {
      const result = await window.electronAPI.selectFolder();

      if (result.success) {
        this.showLoading('Scanning folder...');
        await this.scanVideos(result.path);
      } else {
        console.log('No folder selected');
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
      this.showStatus('Error selecting folder');
    }
  }

  async scanVideos(folderPath) {
    try {
      this.showProgress(0, 'Initializing scan...');

      // Listen for progress updates
      const progressHandler = (progress) => {
        this.showMetadataProgress(progress);
      };

      // Set up progress listener if available
      if (window.electronAPI.onScanProgress) {
        window.electronAPI.onScanProgress(progressHandler);
      }

      const result = await window.electronAPI.scanVideos(folderPath);

      if (result.success) {
        this.allVideos = result.videos;
        this.folders = result.folders;
        this.populateFolderDropdown();
        this.applyCurrentFilters();
        this.hideProgress();
        this.showFilterControls();
        this.updateStatusMessage();

        // Show metadata extraction summary if available
        if (result.metadataStats) {
          const stats = result.metadataStats;
          const message = `Scan complete: ${stats.totalVideos} videos, ${stats.withValidMetadata} with metadata`;
          this.showStatus(message);
          console.log('Metadata extraction stats:', stats);
        }

        // Load videos from database with favorite status
        try {
          const dbVideos = await window.electronAPI.getVideos({ sortBy: 'none' });
          if (dbVideos && dbVideos.length > 0) {
            this.allVideos = dbVideos;
          }

          // Sync local favorites with database
          const favorites = await window.electronAPI.getFavorites();
          if (favorites && Array.isArray(favorites)) {
            this.favorites = new Set(favorites);
            this.updateFavoritesCount();
          }
        } catch (error) {
          console.error('Error loading videos from database:', error);
          // Continue with scanned videos if database loading fails
        }

        // Save the folder path for next time and other settings
        try {
          await window.electronAPI.saveLastFolder(folderPath);
          this.saveSettings();
        } catch (error) {
          console.error('Error saving settings:', error);
        }
      } else {
        this.showStatus(result.error || 'Error scanning videos');
        this.hideProgress();
      }
    } catch (error) {
      console.error('Error scanning videos:', error);
      this.showStatus('Error scanning videos');
      this.hideProgress();
    } finally {
      // Clean up progress listener
      if (window.electronAPI.removeScanProgressListener) {
        window.electronAPI.removeScanProgressListener();
      }
    }
  }

  populateFolderDropdown() {
    const select = document.getElementById('folderSelect');
    select.innerHTML = '<option value="">All folders</option>';

    this.folders.forEach((folder) => {
      const option = document.createElement('option');
      option.value = folder;
      option.textContent = folder;
      select.appendChild(option);
    });
  }

  filterByFolder(folderName) {
    this.currentFolder = folderName;
    this.applyFiltersInPlace();
    this.updateStatusMessage();
    this.saveSettings();
  }

  setSortMode(sortMode) {
    this.currentSort = sortMode;
    this.updateSortButtonStates();
    // Reorder visible items in place to avoid re-render
    this.reorderGridInPlace();
    this.updateStatusMessage();
    this.saveSettings();
  }

  updateSortButtonStates() {
    document
      .getElementById('sortFolderBtn')
      .classList.toggle('active', this.currentSort === 'folder');
    document.getElementById('sortDateBtn').classList.toggle('active', this.currentSort === 'date');
    document
      .getElementById('shuffleBtn')
      .classList.toggle('active', this.currentSort === 'shuffle');
  }

  reorderGridInPlace() {
    const container = document.querySelector('.video-grid');
    if (!container) {
      this.renderGrid();
      return;
    }
    const items = Array.from(container.children);
    if (items.length === 0) return;
    const mode = this.currentSort;
    items.sort((a, b) => {
      const fa = (a.dataset.folder || '').toLowerCase();
      const fb = (b.dataset.folder || '').toLowerCase();
      const da = parseInt(a.dataset.lastModified || '0', 10);
      const db = parseInt(b.dataset.lastModified || '0', 10);
      if (mode === 'folder') {
        const fc = fa.localeCompare(fb);
        if (fc !== 0) return fc;
        return db - da; // newer first
      } else if (mode === 'date') {
        return db - da; // newer first
      }
      return 0;
    });
    const frag = document.createDocumentFragment();
    items.forEach((el) => frag.appendChild(el));
    container.appendChild(frag);
    this.refreshVisibleVideos();
  }

  async shuffleVideos() {
    const btn = document.getElementById('shuffleBtn');
    btn.classList.add('shuffling');

    // Set shuffle mode
    this.currentSort = 'shuffle';
    this.updateSortButtonStates();

    // Create a copy of the current displayed videos to shuffle
    let videosToShuffle = [...this.displayedVideos];

    // Fisher-Yates shuffle on the displayed videos
    for (let i = videosToShuffle.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [videosToShuffle[i], videosToShuffle[j]] = [videosToShuffle[j], videosToShuffle[i]];
    }

    // Update displayed videos with shuffled order
    this.displayedVideos = videosToShuffle;
    this.renderGrid();
    this.updateStatusMessage();

    setTimeout(() => btn.classList.remove('shuffling'), 500);
  }


  async toggleFavoritesView() {
    if (!this.showingFavoritesOnly) {
      this.previousViewState = {
        folder: this.currentFolder,
        sort: this.currentSort,
      };
      this.showingFavoritesOnly = true;
    } else {
      this.showingFavoritesOnly = false;
      this.currentFolder = this.previousViewState.folder;
      this.currentSort = this.previousViewState.sort;

      document.getElementById('folderSelect').value = this.currentFolder;
      this.updateSortButtonStates();
    }

    const btn = document.getElementById('favoritesBtn');
    btn.classList.toggle('active', this.showingFavoritesOnly);

    this.applyFiltersInPlace();
    this.refreshVisibleVideos();
    this.updateStatusMessage();
    this.saveSettings();
  }

  applyCurrentFilters() {

    let filtered = [...this.allVideos];

    // Apply folder filter (works for both sort modes)
    if (this.currentFolder) {
      filtered = filtered.filter((video) => video.folder === this.currentFolder);
    }

    // Apply favorites filter
    if (this.showingFavoritesOnly) {
      filtered = filtered.filter((video) => video.isFavorite === true);
    }

    // Apply hidden files filter
    if (this.showingHiddenOnly) {
      // Show ONLY hidden videos
      filtered = filtered.filter((video) => this.hiddenFiles.has(video.id));
    } else {
      // Hide videos that are in the hidden files set (normal mode)
      filtered = filtered.filter((video) => !this.hiddenFiles.has(video.id));
    }

    // Apply sorting
    if (this.currentSort === 'folder') {
      // Sort by folder (ABC order), then by date (newest first) within each folder
      filtered.sort((a, b) => {
        const folderA = a.folder || '';
        const folderB = b.folder || '';
        const folderCompare = folderA.localeCompare(folderB);
        if (folderCompare !== 0) return folderCompare;

        // Within same folder, sort by date using timestamps directly
        const dateA = a.lastModified || 0;
        const dateB = b.lastModified || 0;

        // Sort newest first (higher timestamp first)
        return dateB - dateA;
      });
    } else if (this.currentSort === 'date') {
      // Sort by date only (newest first), ignoring folders completely
      filtered.sort((a, b) => {
        const dateA = a.lastModified || 0;
        const dateB = b.lastModified || 0;

        // Sort newest first (higher timestamp first)
        return dateB - dateA;
      });
    } else if (this.currentSort === 'shuffle') {
      // Don't re-shuffle if already shuffled - maintain current order
      // Shuffle happens in shuffleVideos() function
    }

    this.displayedVideos = filtered;
    this.renderGrid();
  }

  renderGrid() {
    if (this.displayedVideos.length === 0) {
      this.showEmptyState();
      return;
    }

    // Always use traditional grid with smart loading
    this.renderSmartGrid();
  }

  renderVirtualizedGrid() {
    // Create or update virtualized container
    document.getElementById('content').innerHTML = `
            <div id="virtualized-grid-container" class="content"></div>
        `;

    const container = document.getElementById('virtualized-grid-container');

    // Initialize virtualizer if needed
    if (!this.virtualizer) {
      this.virtualizer = new VideoGridVirtualizer({
        itemHeight: 300,
        itemsPerRow: this.gridCols,
        buffer: 3,
        onVideoClick: (video, index) => {
          this.expandVideo(index);
        },
        onFavoriteToggle: (videoId, event) => {
          this.toggleFavorite(videoId, event);
        },
        isFavorite: (videoId) => {
          return this.favorites.has(videoId);
        },
        formatFileSize: (size) => {
          return this.formatFileSize(size);
        },
      });
    }

    // Update virtualizer
    this.virtualizer.setContainer(container);
    this.virtualizer.setItemsPerRow(this.gridCols);
    this.virtualizer.setVideos(this.displayedVideos);

    // Force a layout update after setting videos
    setTimeout(() => {
      if (this.virtualizer) {
        this.virtualizer.updateLayout();
      }
    }, 50);

    // Log performance info
    const stats = this.virtualizer.getStats();
    console.log(
      `Virtualization: ${stats.visibleVideos}/${stats.totalVideos} videos rendered (${stats.memoryEfficiency} efficiency)`
    );
  }

  renderSmartGrid() {
    const gridHTML = this.displayedVideos
      .map((video, index) => this.createVideoItemHTML(video, index))
      .join('');

    document.getElementById('content').innerHTML = `
            <div class="video-grid">${gridHTML}</div>
        `;

    this.updateGridLayout();
    this.observeVideoItemsWithSmartLoader();

    // Log performance info
    if (this.smartLoader) {
      const stats = this.smartLoader.getStats();
      console.log(
        `Smart Loading: ${stats.loadedVideos} loaded, ${stats.activeVideos}/${stats.maxActiveVideos} active`
      );
    }
  }

  renderTraditionalGrid() {
    // Legacy method - now uses smart grid
    this.renderSmartGrid();
  }

  createVideoItemHTML(video, index) {
    // Use the isFavorite property from the database result
    const isFavorited = video.isFavorite === true;
    const hasMetadata = video.duration || video.width || video.height;

    return `
            <div class="video-item ${!video.isValid && hasMetadata ? 'invalid-metadata' : ''}" data-index="${index}" data-video-id="${video.id}" data-folder="${video.folder || ''}" data-last-modified="${video.lastModified || 0}" title="${video.name}">
                <video 
                    data-src="${video.path}"
                    data-duration="${video.duration || ''}"
                    muted 
                    loop
                    preload="none"
                    title="${video.name}"
                ></video>
                <button class="video-favorite ${isFavorited ? 'favorited' : ''}" data-video-id="${video.id}">
                    <svg viewBox="0 0 24 24" class="heart-icon">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                </button>
                ${this.createMetadataBadges(video)}
                <div class="video-overlay">
                    <div class="video-name" title="${video.folder || 'Root folder'}">
                        ${video.folder || 'Root folder'}
                    </div>
                    <div class="video-info">
                        ${this.formatVideoInfo(video)}
                    </div>
                </div>
            </div>
        `;
  }

  /**
   * Create metadata badges for video quality indicators
   */
  createMetadataBadges(video) {
    const badges = [];

    // Resolution badge
    if (video.resolution) {
      badges.push(
        `<span class="metadata-badge resolution-badge resolution-${video.resolution.toLowerCase()}">${video.resolution}</span>`
      );
    }

    // Audio badge
    if (video.hasAudio === false) {
      badges.push('<span class="metadata-badge audio-badge no-audio">No Audio</span>');
    }

    // Quality score badge (only show if good quality)
    if (video.qualityScore && video.qualityScore >= 4) {
      badges.push(
        `<span class="metadata-badge quality-badge quality-${video.qualityScore}">HQ</span>`
      );
    }

    // Codec badge for common codecs
    if (video.codec && ['h265', 'hevc', 'av1'].includes(video.codec.toLowerCase())) {
      badges.push(
        `<span class="metadata-badge codec-badge codec-${video.codec.toLowerCase()}">${video.codec.toUpperCase()}</span>`
      );
    }

    return badges.length > 0 ? `<div class="metadata-badges">${badges.join('')}</div>` : '';
  }

  /**
   * Format video information for display
   */
  formatVideoInfo(video) {
    const infoItems = [];

    // File size (always show)
    infoItems.push(`<span class="info-size">${this.formatFileSize(video.size)}</span>`);

    // Duration if available
    if (video.duration) {
      infoItems.push(`<span class="info-duration">${this.formatDuration(video.duration)}</span>`);
    }

    // Dimensions if available
    if (video.width && video.height) {
      infoItems.push(`<span class="info-dimensions">${video.width}×${video.height}</span>`);
    }

    // Bitrate if available (show in Mbps for readability)
    if (video.bitrate || video.estimatedBitrate) {
      const bitrate = video.bitrate || video.estimatedBitrate;
      const mbps = (bitrate / 1000000).toFixed(1);
      infoItems.push(`<span class="info-bitrate">${mbps} Mbps</span>`);
    }

    return infoItems.join('<span class="info-separator"> • </span>');
  }

  /**
   * Format duration in human-readable format
   */
  formatDuration(seconds) {
    if (!seconds || seconds < 0) return '';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  }

  observeVideoItemsWithSmartLoader() {
    const container = document.querySelector('.video-grid');

    if (this.smartLoader && container) {
      this.smartLoader.observeVideoItems(container);
    }

    // Add click listeners for video expansion
    const items = document.querySelectorAll('.video-item');
    items.forEach((item, index) => {
      item.addEventListener('click', (e) => {
        // Don't expand if clicking on favorite button
        if (!e.target.closest('.video-favorite')) {
          this.expandVideo(index);
        }
      });
    });
  }

  observeVideoItems() {
    // Legacy method - now uses smart loader
    this.observeVideoItemsWithSmartLoader();
  }

  handleVideoVisible(videoElement, container) {
    const src = videoElement.dataset.src;
    if (!src) return;

    // If video hasn't been loaded yet, load it
    if (!videoElement.src) {
      this.loadVideo(videoElement, container);
    } else {
      // Video is already loaded, just resume playback
      this.resumeVideo(videoElement);
    }
  }

  async loadVideo(videoElement, container) {
    const src = videoElement.dataset.src;
    if (!src || videoElement.src) return;

    container.classList.add('loading');

    try {
      videoElement.src = src;
      videoElement.preload = 'metadata';

      // Ensure the video element shows the correct title
      const videoIndex = Array.from(container.parentElement.children).indexOf(container);
      const video = this.displayedVideos[videoIndex];
      if (video) {
        videoElement.title = video.name;
        container.title = video.name;
      }

      const handleLoad = () => {
        container.classList.remove('loading');
        videoElement.classList.add('loaded');

        // Set title after video loads to override any browser default
        const videoIndex = Array.from(container.parentElement.children).indexOf(container);
        const video = this.displayedVideos[videoIndex];
        if (video) {
          videoElement.title = video.name;
          container.title = video.name;
        }

        this.startVideoPlayback(videoElement);
      };

      const handleError = (event) => {
        container.classList.remove('loading');
        container.classList.add('error');
        console.warn('Video load error:', src, event);
      };

      videoElement.addEventListener('loadedmetadata', handleLoad, { once: true });
      videoElement.addEventListener('error', handleError, { once: true });

      // Timeout protection
      setTimeout(() => {
        if (container.classList.contains('loading')) {
          console.warn('Video load timeout:', src);
          handleError({ type: 'timeout' });
        }
      }, this.LOAD_TIMEOUT);
    } catch (error) {
      container.classList.remove('loading');
      container.classList.add('error');
      console.error('Error setting video source:', error);
    }
  }

  startVideoPlayback(videoElement) {
    try {
      if (isNaN(videoElement.duration) || videoElement.duration === null) {
        console.warn('Invalid video duration, playing normally:', videoElement.src);
        videoElement.play().catch(() => {});
        return;
      }

      if (videoElement.duration && videoElement.duration > 20) {
        this.setupPreviewLoop(videoElement);
      } else {
        videoElement.play().catch(() => {});
      }
    } catch (error) {
      console.warn('Error starting video playback:', error);
      videoElement.play().catch(() => {});
    }
  }

  resumeVideo(videoElement) {
    if (videoElement.paused) {
      if (videoElement.duration && videoElement.duration > 20 && !videoElement._loopHandler) {
        this.setupPreviewLoop(videoElement);
      } else {
        videoElement.play().catch(() => {});
      }
    }
  }

  setupPreviewLoop(video) {
    try {
      const duration = video.duration;
      if (!duration || isNaN(duration) || duration <= 0) {
        console.warn('Invalid duration for preview loop, playing normally');
        video.play().catch(() => {});
        return;
      }

      const midpoint = duration / 2;
      const halfDuration = this.PREVIEW_LOOP_DURATION / 2;
      const start = Math.max(0, midpoint - halfDuration);
      const end = Math.min(duration, midpoint + halfDuration);

      if (video._loopHandler) {
        video.removeEventListener('timeupdate', video._loopHandler);
      }

      const loopHandler = () => {
        try {
          if (video.currentTime >= end) {
            video.currentTime = start;
          }
        } catch (error) {
          console.warn('Error in preview loop:', error);
        }
      };

      video._loopHandler = loopHandler;
      video.addEventListener('timeupdate', loopHandler);

      const handleSeeked = () => {
        video.play().catch(() => {});
      };

      const handleSeekError = () => {
        console.warn('Seek failed, playing from current position');
        video.play().catch(() => {});
      };

      video.addEventListener('seeked', handleSeeked, { once: true });
      video.addEventListener('error', handleSeekError, { once: true });

      try {
        video.currentTime = start;
      } catch (error) {
        console.warn('Failed to set currentTime, playing normally:', error);
        video.play().catch(() => {});
      }
    } catch (error) {
      console.warn('Error setting up preview loop:', error);
      video.play().catch(() => {});
    }
  }

  pauseVideo(videoElement) {
    if (!videoElement.paused) {
      videoElement.pause();
    }
  }

  expandVideo(index) {
    const video = this.displayedVideos[index];
    if (!video) return;

    this.currentExpandedIndex = index;

    const expandedVideo = document.getElementById('expandedVideo');
    const overlay = document.getElementById('expandedOverlay');

    expandedVideo.src = video.path;
    expandedVideo.currentTime = 0;
    expandedVideo.muted = false;
    overlay.classList.add('active');

    expandedVideo.play().catch(() => {});

    // Populate sidebar
    this.refreshExpandedSidebar(video);
  }

  closeExpanded() {
    const overlay = document.getElementById('expandedOverlay');
    const video = document.getElementById('expandedVideo');

    overlay.classList.remove('active');
    video.pause();
    video.src = '';
    this.currentExpandedIndex = -1;
    // Clear sidebar
    this.renderTagList([]);
    const tf = document.getElementById('tagInput');
    if (tf) tf.value = '';
    const metaFolder = document.getElementById('metaFolder');
    if (metaFolder) metaFolder.textContent = '';
    const metaLength = document.getElementById('metaLength');
    if (metaLength) metaLength.textContent = '';
    const metaFilename = document.getElementById('metaFilename');
    if (metaFilename) metaFilename.textContent = '';

  }

  navigateExpanded(direction) {
    if (this.currentExpandedIndex === -1 || this.displayedVideos.length === 0) return;

    let newIndex;
    if (direction === 'next') {
      newIndex = (this.currentExpandedIndex + 1) % this.displayedVideos.length;
    } else {
      newIndex = this.currentExpandedIndex - 1;
      if (newIndex < 0) newIndex = this.displayedVideos.length - 1;
    }

    this.expandVideo(newIndex);
  }

  async toggleFavorite(videoId, event) {
    // Prevent event bubbling to avoid triggering video expansion
    event.preventDefault();
    event.stopPropagation();

    try {
      // Find the video in allVideos to get its current favorite status
      const video = this.allVideos.find((v) => v.id === videoId);
      if (!video) {
        console.error('Video not found:', videoId);
        return;
      }

      const isCurrentlyFavorited = video.isFavorite === true;

      const success = await window.electronAPI.saveFavorite(videoId, !isCurrentlyFavorited);

      if (success) {
        // Update the video's favorite status immediately
        video.isFavorite = !isCurrentlyFavorited;

        // Update the favorites Set
        if (video.isFavorite) {
          this.favorites.add(videoId);
        } else {
          this.favorites.delete(videoId);
        }

        this.updateFavoritesCount();

        // Lightweight UI updates to avoid grid rebuild
        // Update favorite icon on the item
        const el = document.querySelector(
          `.video-item[data-video-id="${videoId}"] .video-favorite`
        );
        if (el) el.classList.toggle('favorited', video.isFavorite === true);
        // If in favorites-only mode and unfavorited, hide just this item
        if (this.showingFavoritesOnly && !video.isFavorite) {
          const itemEl = document.querySelector(`.video-item[data-video-id="${videoId}"]`);
          if (itemEl) itemEl.classList.add('is-hidden-by-filter');
        }

        // If we're showing favorites only and this video was unfavorited, refresh the view
        if (this.showingFavoritesOnly && !video.isFavorite) {
          this.updateStatusMessage();
        }

        // Refresh sidebar buttons if expanded and showing this video
        if (this.currentExpandedIndex !== -1) {
          const cur = this.currentExpandedVideo;
          if (cur && cur.id === videoId) {
            this.refreshExpandedSidebar(cur);
          }
        }
      } else {
        console.error('Failed to save favorite for video:', videoId);
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
    }
  }

  updateFavoritesCount() {
    const count = this.favorites.size;
    const countElement = document.getElementById('favoritesCount');
    if (countElement) {
      countElement.textContent = count;
    }
  }

  async refreshFavoritesFromDatabase() {
    try {
      const favorites = await window.electronAPI.getFavorites();
      if (favorites && Array.isArray(favorites)) {
        this.favorites = new Set(favorites);
        this.updateFavoritesCount();

        // Update all videos with their favorite status
        this.allVideos = this.allVideos.map((video) => ({
          ...video,
          isFavorite: this.favorites.has(video.id),
        }));

        // Update the displayed videos to reflect the new favorite state
        if (this.displayedVideos.length > 0) {
          this.applyCurrentFilters();
        }
      }
    } catch (error) {
      console.error('Error refreshing favorites:', error);
    }
  }

  updateGridSize() {
    // Only update CSS variable; avoid re-rendering to preserve loaded thumbnails
    this.updateGridLayout();
    this.saveSettings();
  }

  updateGridLayout() {
    document.documentElement.style.setProperty('--grid-cols', this.gridCols);
  }

  handleResize() {
    const newCols = this.getDefaultGridCols();
    if (Math.abs(this.gridCols - newCols) <= 1) {
      this.setGridCols(newCols);
    }
  }

  setGridCols(n) {
    const clamped = Math.max(1, Math.min(12, parseInt(n, 10) || this.gridCols));
    if (clamped === this.gridCols) return;
    this.gridCols = clamped;
    this.updateGridSize();
  }

  // Utility methods
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
  }

  showLoading(message) {
    document.getElementById('content').innerHTML = `
            <div class="loading">
                <div class="loading-spinner"></div>
                <p>${message}</p>
            </div>
        `;
  }

  showEmptyState() {
    let title, message;

    if (this.showingFavoritesOnly) {
      title = 'No favorite videos';
      message = 'Click the heart icon on videos to add them to your favorites.';
    } else if (this.currentFolder) {
      title = `No videos found in "${this.currentFolder}"`;
      message = 'Try selecting a different folder or clear the folder filter.';
    } else {
      title = 'No videos found';
      message = 'Try selecting a different folder or upload videos to the selected folder.';
    }

    document.getElementById('content').innerHTML = `
            <div class="empty-state">
                <h2>${title}</h2>
                <p>${message}</p>
            </div>
        `;
  }

  showFilterControls() {
    document.getElementById('filterControls').classList.add('visible');
  }

  showStatus(message) {
    document.getElementById('status').textContent = message;
  }

  showProgress(percent, message = null) {
    const bar = document.getElementById('progressBar');
    const fill = document.getElementById('progressFill');
    const status = document.getElementById('status');

    bar.style.display = 'block';
    fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;

    if (message) {
      status.textContent = message;
    }
  }

  updateProgress(percent, message = null) {
    const fill = document.getElementById('progressFill');
    const status = document.getElementById('status');

    fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;

    if (message) {
      status.textContent = message;
    }
  }

  showMetadataProgress(progress) {
    if (!progress) return;

    let message = '';
    let percent = 0;

    switch (progress.phase) {
      case 'scanning':
        message = 'Scanning for videos...';
        percent = (progress.processedFiles / progress.totalFiles) * 50; // First 50%
        break;
      case 'extracting':
        message = `Extracting metadata... ${progress.completed}/${progress.total}`;
        percent = 50 + (progress.completed / progress.total) * 50; // Second 50%
        break;
      case 'complete':
        message = 'Scan complete';
        percent = 100;
        break;
      default:
        message = 'Processing videos...';
    }

    // Add metadata stats if available
    if (progress.completed > 0) {
      const successRate = (
        ((progress.completed - progress.failed) / progress.completed) *
        100
      ).toFixed(0);
      message += ` (${successRate}% success)`;
    }

    this.updateProgress(percent, message);
  }

  hideProgress() {
    document.getElementById('progressBar').style.display = 'none';
  }

  updateStatusMessage() {
    const totalDisplayed = this.displayedVideos.length;
    const totalSize = this.displayedVideos.reduce((sum, v) => sum + v.size, 0);

    let statusText = `${totalDisplayed} videos`;

    if (this.showingFavoritesOnly) {
      statusText += ' (favorites only)';
    } else if (this.currentFolder) {
      statusText += ` in "${this.currentFolder}"`;
    }

    statusText += ` (${this.formatFileSize(totalSize)})`;

    this.showStatus(statusText);
  }

  setupContextMenu() {
    let contextMenu = document.getElementById('contextMenu');
    let currentVideo = null;

    // Event delegation for right-click on video items
    document.addEventListener('contextmenu', (e) => {
      const videoItem = e.target.closest('.video-item');
      if (videoItem) {
        e.preventDefault();

        // Get video data
        const videoIndex = Array.from(videoItem.parentElement.children).indexOf(videoItem);
        currentVideo = this.displayedVideos[videoIndex];

        if (currentVideo) {
          // Update favorite text based on current state
          const favoriteText = contextMenu.querySelector('.favorite-text');
          const isFavorited = this.favorites.has(currentVideo.id);
          favoriteText.textContent = isFavorited ? 'Remove from Favorites' : 'Add to Favorites';

          // Update hidden text based on current state
          const hiddenText = contextMenu.querySelector('.hidden-text');
          const isHidden = this.hiddenFiles.has(currentVideo.id);
          hiddenText.textContent = isHidden ? 'Show' : 'Hide';

          // Position and show context menu
          this.showContextMenu(e.clientX, e.clientY);
        }
      }
    });

    // Handle context menu item clicks
    contextMenu.addEventListener('click', async (e) => {
      const action = e.target.closest('.context-menu-item')?.dataset.action;

      if (action && currentVideo) {
        switch (action) {
          case 'open-location':
            await this.openFileLocation(currentVideo.path);
            break;
          case 'toggle-favorite':
            await this.toggleFavorite(currentVideo.id, e);
            break;
          case 'add-to-multi-view':
            this.addToMultiView(currentVideo);
            break;
          case 'toggle-hidden':
            await this.toggleHiddenFile(currentVideo.id, e);
            break;
        }
      }

      this.hideContextMenu();
    });

    // Hide context menu on click outside
    document.addEventListener('click', (e) => {
      if (!contextMenu.contains(e.target)) {
        this.hideContextMenu();
      }
    });

    // Global keydown for context/overlay
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideContextMenu();
      }
      const overlay = document.getElementById('expandedOverlay');
      if (overlay && overlay.classList.contains('active')) {
        const current = this.currentExpandedVideo;
        if (!current) return;
        if (e.key.toLowerCase() === 'f') {
          this.toggleFavorite(current.id, e);
        } else if (e.key.toLowerCase() === 'h') {
          this.toggleHiddenFile(current.id, e);
        } else if (e.key.toLowerCase() === 'o') {
          this.openFileLocation(current.path);
        }
      }
    });
  }

  showContextMenu(x, y) {
    const contextMenu = document.getElementById('contextMenu');
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = 200;
    const menuHeight = 160;

    // Position menu within viewport
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

  async refreshExpandedSidebar(video) {
    // Buttons
    const favBtn = document.getElementById('sidebarFavoriteBtn');
    const hidBtn = document.getElementById('sidebarHiddenBtn');
    const goBtn = document.getElementById('goToFileBtn');
    if (favBtn) {
      const isFav = this.favorites.has(video.id);
      favBtn.classList.toggle('active', isFav);
      // icon-only; no label text
      favBtn.innerHTML = `
                <svg viewBox="0 0 24 24" class="icon">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
            `;
      favBtn.onclick = (e) => this.toggleFavorite(video.id, e);
    }
    if (hidBtn) {
      const isHidden = this.hiddenFiles.has(video.id);
      hidBtn.classList.toggle('active', isHidden);
      hidBtn.innerHTML = `
                <svg viewBox="0 0 24 24" class="icon">
                    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                </svg>
            `;
      hidBtn.onclick = (e) => this.toggleHiddenFile(video.id, e);
    }
    if (goBtn) {
      goBtn.onclick = () => this.openFileLocation(video.path);
    }

    // Meta
    const metaFolder = document.getElementById('metaFolder');
    const metaLength = document.getElementById('metaLength');
    const metaFilename = document.getElementById('metaFilename');
    if (metaFolder) metaFolder.textContent = video.folder || '(none)';
    if (metaLength)
      metaLength.textContent = video.duration ? Math.round(video.duration) + 's' : '—';
    if (metaFilename) metaFilename.textContent = video.name || '';

    // Tags
    try {
      const tags = await window.electronAPI.listTags(video.id);
      this.renderTagList(tags || []);
    } catch (err) {
      console.error('Failed to load tags', err);
      this.renderTagList([]);
    }

    // Bind tag input
    const tagInput = document.getElementById('tagInput');
    if (tagInput) {
      tagInput.onkeydown = async (ev) => {
        if (ev.key === 'Enter') {
          const t = tagInput.value.trim();
          if (t) {
            await window.electronAPI.addTag(video.id, t);
            tagInput.value = '';
            const tags = await window.electronAPI.listTags(video.id);
            this.renderTagList(tags || []);
          }
        } else if (ev.key === 'Backspace' && tagInput.value === '') {
          // Remove last tag when input is empty
          const current = await window.electronAPI.listTags(video.id);
          if (current && current.length > 0) {
            const last = current[current.length - 1];
            await window.electronAPI.removeTag(video.id, last);
            const tags = await window.electronAPI.listTags(video.id);
            this.renderTagList(tags || []);
          }
        }
      };
    }
  }

  renderTagList(tags) {
    const listEl = document.getElementById('tagList');
    listEl.innerHTML = '';
    const video = this.currentExpandedVideo;
    (tags || []).forEach((name) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      const btn = document.createElement('button');
      btn.textContent = '×';
      btn.title = 'Remove tag';
      btn.onclick = async () => {
        if (!video) return;
        await window.electronAPI.removeTag(video.id, name);
        const t2 = await window.electronAPI.listTags(video.id);
        this.renderTagList(t2 || []);
      };
      chip.textContent = name + ' ';
      chip.appendChild(btn);
      listEl.appendChild(chip);
    });
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

  addToMultiView(video) {
    // Remove video if already in queue
    this.multiViewQueue = this.multiViewQueue.filter((v) => v.id !== video.id);

    // Add to end of queue
    this.multiViewQueue.push(video);

    // Keep max 3 items (FIFO)
    if (this.multiViewQueue.length > 3) {
      this.multiViewQueue.shift();
    }

    console.log('Added to multi-view:', video.name);
    console.log(
      'Multi-view queue:',
      this.multiViewQueue.map((v) => v.name)
    );

    // Update the multi-view count
    this.updateMultiViewCount();
  }

  updateMultiViewCount() {
    const countElement = document.getElementById('multiViewCount');
    if (countElement) {
      countElement.textContent = this.multiViewQueue.length;
    }
  }

  toggleMultiView() {
    if (this.multiViewQueue.length === 0) {
      this.showStatus('No videos in multi-view queue');
      return;
    }

    this.showMultiView();
  }

  showMultiView() {
    const overlay = document.getElementById('multiViewOverlay');
    const container = document.getElementById('multiViewContainer');

    // Clear existing content
    container.innerHTML = '';

    // Add class based on number of videos
    container.className = 'multi-view-container';
    if (this.multiViewQueue.length === 1) {
      container.classList.add('single');
    } else if (this.multiViewQueue.length === 2) {
      container.classList.add('dual');
    }

    // Create video elements for each video in the queue
    this.multiViewQueue.forEach((video, index) => {
      const videoElement = document.createElement('video');
      videoElement.className = 'multi-view-video';
      videoElement.src = video.path;
      videoElement.controls = true;
      videoElement.loop = true;
      videoElement.muted = false;

      container.appendChild(videoElement);

      // Auto-play all videos
      videoElement.play().catch(() => {});
    });

    // Show the overlay
    overlay.classList.add('active');
  }

  closeMultiView() {
    const overlay = document.getElementById('multiViewOverlay');
    const container = document.getElementById('multiViewContainer');

    // Pause all videos
    const videos = container.querySelectorAll('video');
    videos.forEach((video) => {
      video.pause();
      video.src = '';
    });

    // Hide overlay
    overlay.classList.remove('active');

    // Clear container
    container.innerHTML = '';
  }

  toggleHiddenView() {
    this.showingHiddenOnly = !this.showingHiddenOnly;

    const hiddenBtn = document.getElementById('hiddenBtn');
    if (this.showingHiddenOnly) {
      hiddenBtn.classList.add('active');
      hiddenBtn.title = 'Show all videos';
    } else {
      hiddenBtn.classList.remove('active');
      hiddenBtn.title = 'Show hidden files only';
    }

    // Lightweight filter update
    this.applyFiltersInPlace();
    this.refreshVisibleVideos();
  }

  refreshVisibleVideos() {
    try {
      const items = document.querySelectorAll('.video-item:not(.is-hidden-by-filter)');
      const viewportH = window.innerHeight;
      items.forEach((item) => {
        const rect = item.getBoundingClientRect();
        const inView = rect.top < viewportH + 200 && rect.bottom > -200;
        if (!inView) return;
        const video = item.querySelector('video');
        if (!video) return;
        if (!video.src) {
          this.loadVideo(video, item);
        } else {
          this.resumeVideo(video);
        }
      });
    } catch (e) {
      console.warn('refreshVisibleVideos error', e);
    }
  }

  applyFiltersInPlace() {
    const container = document.querySelector('.video-grid');
    if (!container) {
      this.renderGrid();
      return;
    }
    const items = Array.from(container.children);
    items.forEach((item) => {
      const id = item.dataset.videoId;
      const isFav = this.favorites.has(id);
      const isHidden = this.hiddenFiles.has(id);
      const folder = item.dataset.folder || '';
      let visible = true;
      if (this.currentFolder) {
        visible = visible && folder === this.currentFolder;
      }
      if (this.showingFavoritesOnly) {
        visible = visible && isFav;
      }
      if (this.showingHiddenOnly) {
        visible = visible && isHidden;
      } else {
        visible = visible && !isHidden;
      }
      item.classList.toggle('is-hidden-by-filter', !visible);
    });
  }

  updateHiddenCount() {
    const countElement = document.getElementById('hiddenCount');
    if (countElement) {
      countElement.textContent = this.hiddenFiles.size;
    }
  }

  async toggleHiddenFile(videoId, event) {
    // Prevent event bubbling
    event.preventDefault();
    event.stopPropagation();

    try {
      // Find the video in allVideos
      const video = this.allVideos.find((v) => v.id === videoId);
      if (!video) {
        console.error('Video not found:', videoId);
        return;
      }

      const isCurrentlyHidden = this.hiddenFiles.has(videoId);

      const success = await window.electronAPI.saveHiddenFile(videoId, !isCurrentlyHidden);

      if (success) {
        // Update the hidden files Set
        if (isCurrentlyHidden) {
          this.hiddenFiles.delete(videoId);
        } else {
          this.hiddenFiles.add(videoId);
        }

        this.updateHiddenCount();

        // Lightweight: update visibility of just this item based on current mode
        const itemEl = document.querySelector(`.video-item[data-video-id="${videoId}"]`);
        if (itemEl) {
          if (this.showingHiddenOnly) {
            itemEl.classList.toggle('is-hidden-by-filter', isCurrentlyHidden); // if we just un-hid, hide it now
          } else {
            // Normal mode hides hidden items
            itemEl.classList.toggle('is-hidden-by-filter', !isCurrentlyHidden);
          }
        }

        const action = isCurrentlyHidden ? 'shown' : 'hidden';
        this.showStatus(`Video "${video.name}" ${action}`);

        // Refresh sidebar buttons if expanded and showing this video
        if (this.currentExpandedIndex !== -1) {
          const cur = this.currentExpandedVideo;
          if (cur && cur.id === videoId) {
            this.refreshExpandedSidebar(cur);
          }
        }
      } else {
        console.error('Failed to toggle hidden status');
      }
    } catch (error) {
      console.error('Error toggling hidden file:', error);
    }
  }
}

// Initialize the app
const app = new VdoTapesApp();
