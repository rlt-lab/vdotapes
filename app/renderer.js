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
        this.previousViewState = { folder: '', sort: 'folder' };
        this.currentExpandedIndex = -1; // Track which video is currently expanded
        
        this.init();
    }
    
    getDefaultGridCols() {
        const width = window.innerWidth;
        if (width >= 2560) return 8;  // 4K+ displays
        if (width >= 1920) return 6;  // 1080p+ displays  
        if (width >= 1200) return 4;  // Standard desktop
        if (width >= 768) return 3;   // Tablet
        return 2;                     // Mobile
    }
    
    async init() {
        // Wait for main process to be ready
        await new Promise(resolve => setTimeout(resolve, this.MAIN_PROCESS_READY_DELAY));
        
        this.setupEventListeners();
        this.setupIntersectionObserver();
        this.updateGridSize();
        this.updateFavoritesCount();
        
        await this.loadSettings();
        
        // Clean up when page unloads
        window.addEventListener('beforeunload', () => {
            this.saveSettings();
        });
    }
    
    async loadSettings() {
        try {
            // Wait a bit more for the main process to be fully ready
            await new Promise(resolve => setTimeout(resolve, this.SETTINGS_LOAD_DELAY));
            
            // Load user preferences
            const preferences = await window.electronAPI.getUserPreferences();
            if (preferences) {
                this.gridCols = preferences.gridColumns || this.gridCols;
                this.currentSort = preferences.sortPreference?.sortBy || 'folder';
                this.showingFavoritesOnly = preferences.favoritesOnly || false;
                this.currentFolder = preferences.folderFilter || '';
                
                // Update UI to reflect loaded settings
                document.getElementById('gridCols').value = this.gridCols;
                document.getElementById('folderSelect').value = this.currentFolder;
                this.updateSortButtonStates();
                
                if (this.showingFavoritesOnly) {
                    document.getElementById('favoritesBtn').classList.add('active');
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
                    sortOrder: 'ASC'
                },
                folderFilter: this.currentFolder,
                favoritesOnly: this.showingFavoritesOnly
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
        
        // Grid size
        document.getElementById('gridCols').addEventListener('input', () => {
            this.updateGridSize();
        });
        
        // Expanded view
        document.getElementById('closeBtn').addEventListener('click', () => {
            this.closeExpanded();
        });
        
        document.getElementById('expandedOverlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeExpanded();
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeExpanded();
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
    }
    
    setupIntersectionObserver() {
        try {
            this.observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    const video = entry.target.querySelector('video');
                    if (!video) return;
                    
                    if (entry.isIntersecting) {
                        this.handleVideoVisible(video, entry.target);
                    } else {
                        this.pauseVideo(video);
                    }
                });
            }, {
                root: null,
                rootMargin: '100px',
                threshold: 0.1
            });
        } catch (error) {
            console.error('Error setting up IntersectionObserver:', error);
            this.observer = null;
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
            this.showProgress(0);
            
            const result = await window.electronAPI.scanVideos(folderPath);
            
            if (result.success) {
                this.allVideos = result.videos;
                this.folders = result.folders;
                this.populateFolderDropdown();
                this.applyCurrentFilters();
                this.hideProgress();
                this.showFilterControls();
                this.updateStatusMessage();
                
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
        }
    }
    
    populateFolderDropdown() {
        const select = document.getElementById('folderSelect');
        select.innerHTML = '<option value="">All folders</option>';
        
        this.folders.forEach(folder => {
            const option = document.createElement('option');
            option.value = folder;
            option.textContent = folder;
            select.appendChild(option);
        });
    }
    
    filterByFolder(folderName) {
        this.currentFolder = folderName;
        this.applyCurrentFilters();
        this.updateStatusMessage();
        this.saveSettings();
    }
    
    setSortMode(sortMode) {
        this.currentSort = sortMode;
        this.updateSortButtonStates();
        
        // Debug: Log some date info when switching to date sort
        if (sortMode === 'date' && this.allVideos.length > 0) {
            console.log('=== DATE SORT DEBUG ===');
            console.log('Total videos:', this.allVideos.length);
            console.log('First 5 videos with dates:');
            this.allVideos.slice(0, 5).forEach((video, index) => {
                const timestamp = video.lastModified;
                const date = new Date(timestamp);
                console.log(`${index + 1}. ${video.name}`);
                console.log(`   - Raw timestamp: ${timestamp}`);
                console.log(`   - Date object: ${date}`);
                console.log(`   - Is valid: ${!isNaN(date.getTime())}`);
                console.log(`   - Folder: ${video.folder || 'root'}`);
            });
            console.log('========================');
        }
        
        this.applyCurrentFilters();
        this.updateStatusMessage();
        this.saveSettings();
    }
    
    updateSortButtonStates() {
        document.getElementById('sortFolderBtn').classList.toggle('active', this.currentSort === 'folder');
        document.getElementById('sortDateBtn').classList.toggle('active', this.currentSort === 'date');
    }

    async shuffleVideos() {
        const btn = document.getElementById('shuffleBtn');
        btn.classList.add('shuffling');
        
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
                sort: this.currentSort
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
        
        this.applyCurrentFilters();
        this.updateStatusMessage();
        this.saveSettings();
    }
    
    applyCurrentFilters() {
        let filtered = [...this.allVideos];
        
        // Apply folder filter (works for both sort modes)
        if (this.currentFolder) {
            filtered = filtered.filter(video => video.folder === this.currentFolder);
        }
        
        // Apply favorites filter
        if (this.showingFavoritesOnly) {
            filtered = filtered.filter(video => video.isFavorite === true);
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
            console.log('Sorting by date - before sort, first 3 videos:');
            filtered.slice(0, 3).forEach((video, index) => {
                console.log(`${index + 1}. ${video.name} - timestamp: ${video.lastModified} - folder: ${video.folder || 'root'}`);
            });
            
            filtered.sort((a, b) => {
                const dateA = a.lastModified || 0;
                const dateB = b.lastModified || 0;
                
                // Sort newest first (higher timestamp first)
                return dateB - dateA;
            });
            
            console.log('After sort, first 3 videos:');
            filtered.slice(0, 3).forEach((video, index) => {
                console.log(`${index + 1}. ${video.name} - timestamp: ${video.lastModified} - folder: ${video.folder || 'root'}`);
            });
        }
        
        this.displayedVideos = filtered;
        this.renderGrid();
    }
    

    
    renderGrid() {
        if (this.displayedVideos.length === 0) {
            this.showEmptyState();
            return;
        }
        
        // Disconnect observer if it exists
        if (this.observer) {
            try {
                this.observer.disconnect();
            } catch (error) {
                console.error('Error disconnecting observer:', error);
            }
        }
        
        const gridHTML = this.displayedVideos.map((video, index) => 
            this.createVideoItemHTML(video, index)
        ).join('');
        
        document.getElementById('content').innerHTML = `
            <div class="video-grid">${gridHTML}</div>
        `;
        
        this.updateGridLayout();
        this.observeVideoItems();
    }
    
    createVideoItemHTML(video, index) {
        // Use the isFavorite property from the database result
        const isFavorited = video.isFavorite === true;
        return `
            <div class="video-item" data-index="${index}" data-video-id="${video.id}">
                <video 
                    data-src="${video.path}"
                    data-duration=""
                    muted 
                    loop
                    preload="none"
                ></video>
                <button class="video-favorite ${isFavorited ? 'favorited' : ''}" data-video-id="${video.id}">
                    <svg viewBox="0 0 24 24" class="heart-icon">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                </button>
                <div class="video-overlay">
                    <div class="video-name" title="${video.name}">
                        ${video.name}
                    </div>
                    <div class="video-info">
                        <span>${this.formatFileSize(video.size)}</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    observeVideoItems() {
        const items = document.querySelectorAll('.video-item');
        
        // Only observe if observer is available
        if (this.observer) {
            items.forEach(item => this.observer.observe(item));
        }
        
        // Add click listeners for video expansion (but not for favorite buttons)
        items.forEach((item, index) => {
            item.addEventListener('click', (e) => {
                // Don't expand if clicking on favorite button
                if (!e.target.closest('.video-favorite')) {
                    this.expandVideo(index);
                }
            });
        });
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
            
            const handleLoad = () => {
                container.classList.remove('loading');
                videoElement.classList.add('loaded');
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
    }
    
    closeExpanded() {
        const overlay = document.getElementById('expandedOverlay');
        const video = document.getElementById('expandedVideo');
        
        overlay.classList.remove('active');
        video.pause();
        video.src = '';
        this.currentExpandedIndex = -1;
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
            const video = this.allVideos.find(v => v.id === videoId);
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
                
                // Refresh favorites from database to ensure consistency
                await this.refreshFavoritesFromDatabase();
                
                // Update the displayed videos to reflect the change
                this.applyCurrentFilters();
                
                // If we're showing favorites only and this video was unfavorited, refresh the view
                if (this.showingFavoritesOnly && !video.isFavorite) {
                    this.updateStatusMessage();
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
                this.allVideos = this.allVideos.map(video => ({
                    ...video,
                    isFavorite: this.favorites.has(video.id)
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
        this.gridCols = parseInt(document.getElementById('gridCols').value);
        this.updateGridLayout();
        this.saveSettings();
    }
    
    updateGridLayout() {
        document.documentElement.style.setProperty('--grid-cols', this.gridCols);
    }
    
    handleResize() {
        const newCols = this.getDefaultGridCols();
        const currentCols = parseInt(document.getElementById('gridCols').value);
        
        if (Math.abs(currentCols - newCols) <= 1) {
            document.getElementById('gridCols').value = newCols;
            this.updateGridSize();
        }
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
            title = "No favorite videos";
            message = "Click the heart icon on videos to add them to your favorites.";
        } else if (this.currentFolder) {
            title = `No videos found in "${this.currentFolder}"`;
            message = "Try selecting a different folder or clear the folder filter.";
        } else {
            title = "No videos found";
            message = "Try selecting a different folder or upload videos to the selected folder.";
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
    
    showProgress(percent) {
        const bar = document.getElementById('progressBar');
        const fill = document.getElementById('progressFill');
        bar.style.display = 'block';
        fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
    
    updateProgress(percent) {
        const fill = document.getElementById('progressFill');
        fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
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
}

// Initialize the app
const app = new VdoTapesApp();
