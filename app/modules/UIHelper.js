/**
 * UIHelper - UI state management, progress indicators, formatting utilities, and multi-view
 */
class UIHelper {
  constructor(app) {
    this.app = app;
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
  }

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

  showLoading(message) {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <div class="loading-message">${message || 'Loading...'}</div>
      </div>
    `;
    this.app.isLoading = true;
  }

  showEmptyState() {
    const content = document.getElementById('content');
    const message = this.app.showingFavoritesOnly
      ? 'No favorite videos yet. Click the heart icon on videos to add them.'
      : this.app.showingHiddenOnly
      ? 'No hidden videos.'
      : this.app.currentFolder
      ? `No videos found in "${this.app.currentFolder}"`
      : 'No videos found. Select a folder to scan.';

    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎬</div>
        <div class="empty-message">${message}</div>
      </div>
    `;
  }

  showFilterControls() {
    document.getElementById('filterControls').style.display = 'flex';
  }

  showStatus(message) {
    const statusBar = document.getElementById('statusBar');
    statusBar.textContent = message;
  }

  showProgress(percent, message = null) {
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    progressContainer.style.display = 'flex';
    progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;

    if (message) {
      progressText.textContent = message;
    }
  }

  updateProgress(percent, message = null) {
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    if (progressBar) {
      progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }

    if (message && progressText) {
      progressText.textContent = message;
    }
  }

  showMetadataProgress(progress) {
    if (!progress) {
      this.hideProgress();
      return;
    }

    const { processed, total, currentFile, speed, eta, totalWithMetadata } = progress;

    if (processed === 0) {
      this.showProgress(0, 'Starting metadata extraction...');
      return;
    }

    const percent = total > 0 ? (processed / total) * 100 : 0;

    let statusMessage = `Processing metadata: ${processed}/${total} videos`;
    if (totalWithMetadata > 0) {
      statusMessage += ` (${totalWithMetadata} with metadata)`;
    }

    if (speed) {
      statusMessage += ` • ${speed.toFixed(1)} videos/sec`;
    }

    if (eta) {
      const etaMinutes = Math.ceil(eta / 60);
      statusMessage += ` • ETA: ${etaMinutes} min`;
    }

    if (currentFile && currentFile.length < 50) {
      statusMessage += ` • ${currentFile}`;
    }

    this.showProgress(percent, statusMessage);
  }

  hideProgress() {
    const progressContainer = document.getElementById('progressContainer');
    progressContainer.style.display = 'none';
  }

  updateStatusMessage() {
    const totalVideos = this.app.displayedVideos.length;
    const totalSize = this.app.displayedVideos.reduce((sum, v) => sum + (v.size || 0), 0);

    let statusText = `${totalVideos} video${totalVideos !== 1 ? 's' : ''}`;

    if (this.app.showingFavoritesOnly) {
      statusText += ' (favorites only)';
    } else if (this.app.currentFolder) {
      statusText += ` in "${this.app.currentFolder}"`;
    }

    statusText += ` (${this.formatFileSize(totalSize)})`;

    this.showStatus(statusText);
  }

  updateGridSize() {
    this.updateGridLayout();
    this.app.userDataManager.saveSettings();
  }

  updateGridLayout() {
    document.documentElement.style.setProperty('--grid-cols', this.app.gridCols);
  }

  handleResize() {
    const newCols = this.app.getDefaultGridCols();
    if (Math.abs(this.app.gridCols - newCols) <= 1) {
      this.app.setGridCols(newCols);
    }
  }

  addToMultiView(video) {
    this.app.multiViewQueue = this.app.multiViewQueue.filter((v) => v.id !== video.id);
    this.app.multiViewQueue.push(video);

    if (this.app.multiViewQueue.length > 3) {
      this.app.multiViewQueue.shift();
    }

    console.log('Added to multi-view:', video.name);
    this.updateMultiViewCount();
  }

  updateMultiViewCount() {
    const countElement = document.getElementById('multiViewCount');
    if (countElement) {
      countElement.textContent = this.app.multiViewQueue.length;
    }
  }

  toggleMultiView() {
    if (this.app.multiViewQueue.length === 0) {
      this.showStatus('No videos in multi-view queue');
      return;
    }

    this.showMultiView();
  }

  showMultiView() {
    const overlay = document.getElementById('multiViewOverlay');
    const container = document.getElementById('multiViewContainer');

    container.innerHTML = '';

    container.className = 'multi-view-container';
    if (this.app.multiViewQueue.length === 1) {
      container.classList.add('single');
    } else if (this.app.multiViewQueue.length === 2) {
      container.classList.add('dual');
    }

    this.app.multiViewQueue.forEach((video) => {
      const videoElement = document.createElement('video');
      videoElement.className = 'multi-view-video';
      videoElement.src = video.path;
      videoElement.controls = true;
      videoElement.loop = true;
      videoElement.muted = false;

      container.appendChild(videoElement);
      videoElement.play().catch(() => {});
    });

    overlay.classList.add('active');
  }

  closeMultiView() {
    const overlay = document.getElementById('multiViewOverlay');
    const container = document.getElementById('multiViewContainer');

    const videos = container.querySelectorAll('video');
    videos.forEach((video) => {
      video.pause();
      video.src = '';
    });

    container.innerHTML = '';
    overlay.classList.remove('active');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIHelper;
} else {
  window.UIHelper = UIHelper;
}
