/**
 * TagCloudManager.js
 * Manages the tag cloud overlay feature
 *
 * Responsibilities:
 * - Render tag cloud overlay with usage-based sizing
 * - Calculate tag sizes based on usage (logarithmic scale)
 * - Handle tag click events for filtering
 * - Manage overlay visibility
 * - Integrate with existing TagManager
 */

class TagCloudManager {
  constructor(app) {
    this.app = app;
    this.overlay = null;
    this.content = null;
    this.closeBtn = null;
  }

  /**
   * Initialize the tag cloud manager
   * Sets up DOM references and event listeners
   */
  initialize() {
    this.overlay = document.getElementById('tagCloudOverlay');
    this.content = document.getElementById('tagCloudContent');
    this.closeBtn = document.getElementById('tagCloudCloseBtn');

    if (!this.overlay || !this.content || !this.closeBtn) {
      console.error('[TagCloudManager] Required DOM elements not found');
      return;
    }

    // Close button click
    this.closeBtn.addEventListener('click', () => this.closeTagCloud());

    // Click outside to close (on backdrop)
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.closeTagCloud();
      }
    });

    console.log('[TagCloudManager] Initialized');
  }

  /**
   * Open the tag cloud overlay
   */
  openTagCloud() {
    if (!this.overlay) return;

    // Render the tag cloud with current data
    this.renderTagCloud();

    // Show the overlay
    this.overlay.classList.add('visible');
    console.log('[TagCloudManager] Tag cloud opened');
  }

  /**
   * Close the tag cloud overlay
   */
  closeTagCloud() {
    if (!this.overlay) return;

    this.overlay.classList.remove('visible');
    console.log('[TagCloudManager] Tag cloud closed');
  }

  /**
   * Render the tag cloud with all tags
   */
  renderTagCloud() {
    if (!this.content) return;

    const tags = this.app.tagManager.allTags;

    // Handle empty state
    if (!tags || tags.length === 0) {
      this.content.innerHTML = '<div class="tag-cloud-empty">No tags yet. Add tags to videos to see them here!</div>';
      return;
    }

    // Calculate min/max usage for sizing
    const usages = tags.map(t => t.usage);
    const minUsage = Math.min(...usages);
    const maxUsage = Math.max(...usages);

    // Sort tags alphabetically for easier scanning
    const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name));

    // Generate tag cloud HTML
    this.content.innerHTML = sortedTags.map(tag => {
      const size = this.calculateTagSize(tag.usage, minUsage, maxUsage);
      const escapedName = this.escapeHtml(tag.name);

      return `
        <span class="tag-cloud-item"
              data-tag="${escapedName}"
              data-usage="${tag.usage}"
              data-size="${size}">
          ${escapedName}
        </span>
      `;
    }).join('');

    // Add click handlers using event delegation
    this.content.removeEventListener('click', this.handleContentClick);
    this.handleContentClick = (e) => {
      if (e.target.classList.contains('tag-cloud-item')) {
        const tagName = e.target.dataset.tag;
        this.handleTagClick(tagName);
      }
    };
    this.content.addEventListener('click', this.handleContentClick);

    console.log(`[TagCloudManager] Rendered ${tags.length} tags`);
  }

  /**
   * Calculate tag size based on usage with logarithmic scale
   * @param {number} usage - Number of times tag is used
   * @param {number} minUsage - Minimum usage across all tags
   * @param {number} maxUsage - Maximum usage across all tags
   * @returns {string} Size category: 'xs', 'sm', 'md', 'lg', or 'xl'
   */
  calculateTagSize(usage, minUsage, maxUsage) {
    // Handle edge case: all tags have same usage
    if (maxUsage === minUsage) return 'md';

    // Logarithmic scale for better visual balance
    const logMin = Math.log(minUsage || 1);
    const logMax = Math.log(maxUsage);
    const logUsage = Math.log(usage);

    // Normalize to 0-1 scale
    const normalized = (logUsage - logMin) / (logMax - logMin);

    // Map to size categories
    if (normalized < 0.2) return 'xs';
    if (normalized < 0.4) return 'sm';
    if (normalized < 0.6) return 'md';
    if (normalized < 0.8) return 'lg';
    return 'xl';
  }

  /**
   * Handle tag click - filter videos by clicked tag
   * @param {string} tagName - Name of the clicked tag
   */
  handleTagClick(tagName) {
    // Add tag to active filters (integrates with existing system)
    this.app.tagManager.addActiveTag(tagName);

    // Close tag cloud after selection
    this.closeTagCloud();

    console.log(`[TagCloudManager] Filtered by tag: ${tagName}`);
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
