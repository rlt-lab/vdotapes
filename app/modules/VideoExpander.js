/**
 * VideoExpander - Handles expanded video view and navigation
 */
class VideoExpander {
  constructor(app) {
    this.app = app;
  }

  expandVideo(index) {
    const video = this.app.displayedVideos[index];
    if (!video) return;

    this.app.currentExpandedIndex = index;

    const expandedVideo = document.getElementById('expandedVideo');
    const overlay = document.getElementById('expandedOverlay');

    expandedVideo.src = video.path;
    expandedVideo.currentTime = 0;
    expandedVideo.muted = false;
    overlay.classList.add('active');

    expandedVideo.play().catch(() => {});

    this.refreshExpandedSidebar(video);
  }

  closeExpanded() {
    const overlay = document.getElementById('expandedOverlay');
    const video = document.getElementById('expandedVideo');

    overlay.classList.remove('active');
    video.pause();
    video.src = '';
    this.app.currentExpandedIndex = -1;

    this.renderTagList([]);
  }

  navigateExpanded(direction) {
    const nextIndex = this.app.currentExpandedIndex + direction;
    if (nextIndex >= 0 && nextIndex < this.app.displayedVideos.length) {
      this.expandVideo(nextIndex);
    }
  }

  async refreshExpandedSidebar(video) {
    const fileName = document.getElementById('expandedFileName');
    const fileSize = document.getElementById('expandedFileSize');
    const filePath = document.getElementById('expandedFilePath');
    const resolution = document.getElementById('expandedResolution');
    const duration = document.getElementById('expandedDuration');
    const bitrate = document.getElementById('expandedBitrate');
    const codec = document.getElementById('expandedCodec');
    const favoriteBtn = document.getElementById('expandedFavoriteBtn');
    const hiddenBtn = document.getElementById('expandedHiddenBtn');

    fileName.textContent = video.name || 'Unknown';
    fileSize.textContent = this.app.formatFileSize(video.size || 0);
    filePath.textContent = video.path || '';

    resolution.textContent = video.resolution || 'Unknown';
    duration.textContent = video.duration ? this.app.formatDuration(video.duration) : 'Unknown';

    if (video.bitrate) {
      const bitrateKbps = Math.round(video.bitrate / 1000);
      bitrate.textContent = `${bitrateKbps} kb/s`;
    } else {
      bitrate.textContent = 'Unknown';
    }
    codec.textContent = video.codec || 'Unknown';

    const isFavorited = this.app.favorites.has(video.id);
    if (isFavorited) {
      favoriteBtn.classList.add('favorited');
      favoriteBtn.querySelector('.heart-icon').innerHTML = `
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
      `;
    } else {
      favoriteBtn.classList.remove('favorited');
      favoriteBtn.querySelector('.heart-icon').innerHTML = `
        <path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/>
      `;
    }

    const isHidden = this.app.hiddenFiles.has(video.id);
    if (isHidden) {
      hiddenBtn.classList.add('hidden-active');
      hiddenBtn.textContent = 'Show';
    } else {
      hiddenBtn.classList.remove('hidden-active');
      hiddenBtn.textContent = 'Hide';
    }

    try {
      const tags = await window.electronAPI.getVideoTags(video.id);
      this.renderTagList(tags || []);
    } catch (error) {
      console.error('Error loading tags:', error);
      this.renderTagList([]);
    }
  }

  renderTagList(tags) {
    const tagList = document.getElementById('expandedTagList');
    if (!tags || tags.length === 0) {
      tagList.innerHTML = '<span class="no-tags">No tags</span>';
      return;
    }

    tagList.innerHTML = tags
      .map(
        (tag) => `
        <span class="tag-item" data-tag-id="${tag.id}">
          ${tag.name}
          <button class="tag-remove" data-tag-id="${tag.id}">×</button>
        </span>
      `
      )
      .join('');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoExpander;
} else {
  window.VideoExpander = VideoExpander;
}
