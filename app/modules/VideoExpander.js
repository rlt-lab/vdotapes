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
    if (metaFolder) {
      metaFolder.textContent = video.folder || '(Root)';
      // Make folder name clickable to filter by that subfolder
      metaFolder.classList.add('clickable-folder');
      metaFolder.style.cursor = 'pointer';
      metaFolder.onclick = () => {
        const folderName = video.folder || '';
        // Update folder dropdown
        const folderSelect = document.getElementById('folderSelect');
        if (folderSelect) {
          folderSelect.value = folderName;
        }
        // Close expanded view
        this.closeExpanded();
        // Apply folder filter
        if (this.app.filterManager) {
          this.app.filterManager.filterByFolder(folderName);
        }
      };
    }
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

    // Use cached tags from app state (loaded during folder scan)
    // This avoids IPC overhead - tags are already in memory
    const cachedTags = this.app.videoTags[video.id] || [];

    // Render tags immediately from cache (instant)
    this.renderTagList(cachedTags, video.id);

    // Load suggestions asynchronously (doesn't block UI)
    // Only call IPC for suggestions since those require dynamic computation
    try {
      const suggestions = await window.electronAPI.getTagSuggestions(video.id, video.folder || '');
      this.currentSuggestions = suggestions || [];
      this.renderTagSuggestions(this.currentSuggestions, cachedTags, video.id);
    } catch (error) {
      console.error('Error loading tag suggestions:', error);
      this.currentSuggestions = [];
      this.renderTagSuggestions([], cachedTags, video.id);
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

            // Update local state immediately (no IPC needed)
            const currentTags = this.app.videoTags[video.id] || [];
            if (!currentTags.includes(t)) {
              currentTags.push(t);
            }
            this.app.videoTags[video.id] = currentTags;
            this.app.videoTagSets[video.id] = new Set(currentTags);

            this.renderTagList(currentTags, video.id);
            this.renderTagSuggestions(this.currentSuggestions, currentTags, video.id);

            // Reload all tags for autocomplete (background, non-blocking)
            if (this.app.tagManager) {
              this.app.tagManager.loadAllTags();
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

    // Store videoId as data attribute on the container for event delegation
    tagList.dataset.videoId = videoId;

    // Use data attributes instead of inline onclick to comply with CSP
    tagList.innerHTML = tags
      .map(
        (tag) => `
        <span class="tag-item" data-tag="${this.escapeHtml(tag)}">
          ${this.escapeHtml(tag)}
          <button class="tag-remove" data-tag-name="${this.escapeHtml(tag)}">×</button>
        </span>
      `
      )
      .join('');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  renderTagSuggestions(suggestions, appliedTags, videoId) {
    const container = document.getElementById('tagSuggestions');
    if (!container) return;

    container.innerHTML = '';

    if (!suggestions || suggestions.length === 0) {
      return;
    }

    const appliedSet = new Set(appliedTags || []);

    for (const suggestion of suggestions) {
      const pill = document.createElement('span');
      pill.className = 'tag-suggestion';
      pill.textContent = suggestion.name;
      pill.dataset.tag = suggestion.name;
      pill.dataset.videoId = videoId;

      if (appliedSet.has(suggestion.name)) {
        pill.classList.add('applied');
      } else {
        pill.addEventListener('click', () => {
          this.addTagFromSuggestion(videoId, suggestion.name);
        });
      }

      container.appendChild(pill);
    }
  }

  async addTagFromSuggestion(videoId, tagName) {
    try {
      await window.electronAPI.addTag(videoId, tagName);

      // Update local state immediately (no IPC needed)
      const currentTags = this.app.videoTags[videoId] || [];
      if (!currentTags.includes(tagName)) {
        currentTags.push(tagName);
      }
      this.app.videoTags[videoId] = currentTags;
      this.app.videoTagSets[videoId] = new Set(currentTags);

      this.renderTagList(currentTags, videoId);
      this.renderTagSuggestions(this.currentSuggestions, currentTags, videoId);

      // Reload all tags for autocomplete (background, non-blocking)
      if (this.app.tagManager) {
        this.app.tagManager.loadAllTags();
      }
    } catch (error) {
      console.error('Error adding tag from suggestion:', error);
    }
  }

  async removeTag(videoId, tagName) {
    try {
      await window.electronAPI.removeTag(videoId, tagName);

      // Update local state immediately (no IPC needed)
      const currentTags = (this.app.videoTags[videoId] || []).filter(t => t !== tagName);
      this.app.videoTags[videoId] = currentTags;
      this.app.videoTagSets[videoId] = new Set(currentTags);

      this.renderTagList(currentTags, videoId);
      this.renderTagSuggestions(this.currentSuggestions, currentTags, videoId);

      // Reload all tags for autocomplete (background, non-blocking)
      if (this.app.tagManager) {
        this.app.tagManager.loadAllTags();
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
