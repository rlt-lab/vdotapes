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
    // Map to actual HTML element IDs
    const metaFolder = document.getElementById('metaFolder');
    const metaLength = document.getElementById('metaLength');
    const metaFilename = document.getElementById('metaFilename');
    const favoriteBtn = document.getElementById('sidebarFavoriteBtn');
    const hiddenBtn = document.getElementById('sidebarHiddenBtn');

    // Update metadata fields
    if (metaFolder) metaFolder.textContent = video.folder || '(Root)';
    if (metaLength) metaLength.textContent = video.duration ? this.app.formatDuration(video.duration) : 'Unknown';
    if (metaFilename) metaFilename.textContent = video.name || 'Unknown';

    // Update favorite button
    if (favoriteBtn) {
      const isFavorited = this.app.favorites.has(video.id);
      favoriteBtn.classList.toggle('active', isFavorited);
      favoriteBtn.onclick = (e) => this.app.userDataManager.toggleFavorite(video.id, e);
    }

    // Update hidden button
    if (hiddenBtn) {
      const isHidden = this.app.hiddenFiles.has(video.id);
      hiddenBtn.classList.toggle('active', isHidden);
      hiddenBtn.onclick = (e) => this.app.userDataManager.toggleHiddenFile(video.id, e);
    }

    // Update go to file button
    const goToBtn = document.getElementById('goToFileBtn');
    if (goToBtn) {
      goToBtn.onclick = () => this.app.eventController.openFileLocation(video.path);
    }

    // Load tags
    try {
      const tags = await window.electronAPI.listTags(video.id);
      this.renderTagList(tags || [], video.id);
    } catch (error) {
      console.error('Error loading tags:', error);
      this.renderTagList([], video.id);
    }

    // Setup tag input
    const tagInput = document.getElementById('tagInput');
    if (tagInput) {
      tagInput.onkeydown = async (ev) => {
        if (ev.key === 'Enter') {
          const t = tagInput.value.trim();
          if (t) {
            await window.electronAPI.addTag(video.id, t);
            tagInput.value = '';
            const tags = await window.electronAPI.listTags(video.id);
            this.renderTagList(tags || [], video.id);
            
            // Update app state so filters work immediately
            this.app.videoTags[video.id] = tags || [];
            // Reload all tags for autocomplete
            if (this.app.tagManager) {
              await this.app.tagManager.loadAllTags();
            }
          }
        }
      };
    }
  }

  renderTagList(tags, videoId) {
    const tagList = document.getElementById('tagList');
    if (!tagList) return;

    if (!tags || tags.length === 0) {
      tagList.innerHTML = '<span class="no-tags">No tags</span>';
      return;
    }

    tagList.innerHTML = tags
      .map(
        (tag) => `
        <span class="tag-item" data-tag="${tag}">
          ${tag}
          <button class="tag-remove" onclick="window.app.videoExpander.removeTag('${videoId}', '${tag}')">×</button>
        </span>
      `
      )
      .join('');
  }

  async removeTag(videoId, tagName) {
    try {
      await window.electronAPI.removeTag(videoId, tagName);
      const tags = await window.electronAPI.listTags(videoId);
      this.renderTagList(tags || [], videoId);
      
      // Update app state so filters work immediately
      this.app.videoTags[videoId] = tags || [];
      // Reload all tags for autocomplete
      if (this.app.tagManager) {
        await this.app.tagManager.loadAllTags();
      }
    } catch (error) {
      console.error('Error removing tag:', error);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoExpander;
} else {
  window.VideoExpander = VideoExpander;
}
