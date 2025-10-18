/**
 * TagManager - Handles tag search, filtering, and UI
 */
class TagManager {
  constructor(app) {
    this.app = app;
    this.allTags = []; // Array of { name: string, usage: number }
    this.isAutocompleteVisible = false;
    this.selectedAutocompleteIndex = -1;
  }

  /**
   * Initialize tag manager and set up event listeners
   */
  initialize() {
    const tagSearchInput = document.getElementById('tagSearchInput');
    const tagSearchContainer = document.getElementById('tagSearchContainer');
    const tagModeToggle = document.getElementById('tagModeToggle');

    if (!tagSearchInput || !tagSearchContainer) {
      console.warn('[TagManager] Tag search UI elements not found');
      return;
    }

    // Setup tag mode toggle
    if (tagModeToggle) {
      tagModeToggle.addEventListener('click', () => {
        this.toggleTagMode();
      });
    }

    // Input event for autocomplete
    tagSearchInput.addEventListener('input', (e) => {
      this.handleSearchInput(e.target.value);
    });

    // Enter key to add tag
    tagSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.selectedAutocompleteIndex >= 0) {
          // Select from autocomplete
          const filtered = this.filterTags(tagSearchInput.value);
          if (filtered[this.selectedAutocompleteIndex]) {
            this.addActiveTag(filtered[this.selectedAutocompleteIndex].name);
          }
        } else if (tagSearchInput.value.trim()) {
          // Add typed tag directly
          this.addActiveTag(tagSearchInput.value.trim());
        }
        tagSearchInput.value = '';
        this.hideAutocomplete();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.navigateAutocomplete(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateAutocomplete(-1);
      } else if (e.key === 'Escape') {
        this.hideAutocomplete();
      }
    });

    // Click outside to close autocomplete
    document.addEventListener('click', (e) => {
      if (!tagSearchContainer.contains(e.target)) {
        this.hideAutocomplete();
      }
    });

    console.log('[TagManager] Initialized');
  }

  /**
   * Load all tags from backend
   */
  async loadAllTags() {
    try {
      this.allTags = await window.electronAPI.listAllTags();
      console.log(`[TagManager] Loaded ${this.allTags.length} unique tags`);
    } catch (error) {
      console.error('[TagManager] Error loading tags:', error);
      this.allTags = [];
    }
  }

  /**
   * Filter tags by search text
   */
  filterTags(searchText) {
    if (!searchText || searchText.trim() === '') {
      return this.allTags;
    }

    const search = searchText.toLowerCase();
    return this.allTags.filter(tag => 
      tag.name.toLowerCase().includes(search)
    );
  }

  /**
   * Handle search input change
   */
  handleSearchInput(searchText) {
    if (!searchText || searchText.trim() === '') {
      this.hideAutocomplete();
      return;
    }

    const filtered = this.filterTags(searchText);
    this.renderAutocomplete(filtered);
  }

  /**
   * Render autocomplete dropdown
   */
  renderAutocomplete(tags) {
    let autocomplete = document.getElementById('tagAutocomplete');
    
    if (!autocomplete) {
      // Create autocomplete dropdown
      autocomplete = document.createElement('div');
      autocomplete.id = 'tagAutocomplete';
      autocomplete.className = 'tag-autocomplete';
      document.getElementById('tagSearchContainer').appendChild(autocomplete);
    }

    if (tags.length === 0) {
      this.hideAutocomplete();
      return;
    }

    // Limit to top 10 results
    const limitedTags = tags.slice(0, 10);
    
    // Clear previous content
    autocomplete.innerHTML = '';
    
    // Create items with proper event listeners
    limitedTags.forEach((tag, index) => {
      const item = document.createElement('div');
      item.className = `tag-autocomplete-item ${index === this.selectedAutocompleteIndex ? 'selected' : ''}`;
      item.dataset.tag = tag.name;
      
      const tagName = document.createElement('span');
      tagName.className = 'tag-name';
      tagName.textContent = tag.name;
      
      const tagUsage = document.createElement('span');
      tagUsage.className = 'tag-usage';
      tagUsage.textContent = `(${tag.usage})`;
      
      item.appendChild(tagName);
      item.appendChild(tagUsage);
      
      // Add click listener
      item.addEventListener('click', () => {
        this.addActiveTag(tag.name);
        document.getElementById('tagSearchInput').value = '';
        this.hideAutocomplete();
      });
      
      autocomplete.appendChild(item);
    });

    autocomplete.style.display = 'block';
    this.isAutocompleteVisible = true;
  }

  /**
   * Navigate autocomplete with arrow keys
   */
  navigateAutocomplete(direction) {
    if (!this.isAutocompleteVisible) return;

    const tagSearchInput = document.getElementById('tagSearchInput');
    const filtered = this.filterTags(tagSearchInput.value);
    const maxIndex = Math.min(filtered.length - 1, 9);

    this.selectedAutocompleteIndex += direction;

    if (this.selectedAutocompleteIndex < 0) {
      this.selectedAutocompleteIndex = maxIndex;
    } else if (this.selectedAutocompleteIndex > maxIndex) {
      this.selectedAutocompleteIndex = 0;
    }

    this.renderAutocomplete(filtered);
  }

  /**
   * Hide autocomplete dropdown
   */
  hideAutocomplete() {
    const autocomplete = document.getElementById('tagAutocomplete');
    if (autocomplete) {
      autocomplete.style.display = 'none';
    }
    this.isAutocompleteVisible = false;
    this.selectedAutocompleteIndex = -1;
  }

  /**
   * Add tag to active filters
   */
  addActiveTag(tagName) {
    if (!tagName || tagName.trim() === '') return;

    const normalized = tagName.trim();

    // Check if already active
    if (this.app.activeTags.includes(normalized)) {
      console.log(`[TagManager] Tag "${normalized}" already active`);
      return;
    }

    // Add to active tags
    this.app.activeTags.push(normalized);
    console.log(`[TagManager] Added active tag: ${normalized}`);

    // Update UI
    this.updateTagStatus();

    // Apply filter
    this.app.filterManager.applyCurrentFilters();
    this.app.updateStatusMessage();
  }

  /**
   * Remove tag from active filters
   */
  removeActiveTag(tagName) {
    const index = this.app.activeTags.indexOf(tagName);
    if (index > -1) {
      this.app.activeTags.splice(index, 1);
      console.log(`[TagManager] Removed active tag: ${tagName}`);

      // Update UI
      this.updateTagStatus();

      // Apply filter
      this.app.filterManager.applyCurrentFilters();
      this.app.updateStatusMessage();
    }
  }

  /**
   * Clear all active tags
   */
  clearAllTags() {
    this.app.activeTags = [];
    this.updateTagStatus();
    this.app.filterManager.applyCurrentFilters();
    this.app.updateStatusMessage();
  }

  /**
   * Update tag status text below UI bar
   */
  updateTagStatus() {
    const statusContainer = document.getElementById('tagStatus');
    if (!statusContainer) return;

    if (this.app.activeTags.length === 0) {
      statusContainer.style.display = 'none';
      return;
    }

    const mode = this.app.tagFilterMode === 'AND' ? 'all' : 'any';
    const tagText = this.app.activeTags.map(tag => `<span class="tag-status-item">${tag}</span>`).join(', ');
    statusContainer.innerHTML = `Filtering by <span class="tag-status-mode">${mode}</span> of: ${tagText} <button class="tag-status-clear" id="clearTagsBtn">✕ Clear</button>`;
    statusContainer.style.display = 'block';

    // Add event listener to clear button
    const clearBtn = document.getElementById('clearTagsBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearAllTags();
      });
    }
  }

  /**
   * Get active tags
   */
  getActiveTags() {
    return this.app.activeTags;
  }

  /**
   * Check if any tags are active
   */
  hasActiveTags() {
    return this.app.activeTags.length > 0;
  }

  /**
   * Toggle between AND and OR modes
   */
  toggleTagMode() {
    this.app.tagFilterMode = this.app.tagFilterMode === 'AND' ? 'OR' : 'AND';
    
    // Update button text
    const toggleBtn = document.getElementById('tagModeToggle');
    if (toggleBtn) {
      toggleBtn.textContent = this.app.tagFilterMode;
      toggleBtn.title = this.app.tagFilterMode === 'AND' 
        ? 'Match ALL tags (click for OR)' 
        : 'Match ANY tag (click for AND)';
    }

    console.log(`[TagManager] Tag filter mode: ${this.app.tagFilterMode}`);

    // Update status text to show new mode
    this.updateTagStatus();

    // Re-apply filters if tags are active
    if (this.hasActiveTags()) {
      this.app.filterManager.applyCurrentFilters();
      this.app.updateStatusMessage();
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TagManager;
} else {
  window.TagManager = TagManager;
}
