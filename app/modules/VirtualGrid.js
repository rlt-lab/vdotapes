/**
 * VirtualGrid - Only renders visible items + buffer for performance
 *
 * Instead of rendering all items to the DOM, we:
 * 1. Calculate which items are visible in the viewport
 * 2. Only create DOM nodes for visible items + a buffer
 * 3. Position items absolutely within a container sized to hold all items
 * 4. Recycle DOM nodes as user scrolls
 */
class VirtualGrid {
  constructor(options = {}) {
    this.container = null;
    this.scrollContainer = null;
    this.data = [];
    this.renderedItems = new Map(); // index -> DOM element
    this.itemHeight = options.itemHeight || 200;
    this.itemGap = options.itemGap || 8;
    this.bufferRows = options.bufferRows || 2;
    this.columns = options.columns || 4;
    this.renderItem = options.renderItem || null;
    this.onItemClick = options.onItemClick || null;

    this.isInitialized = false;
    this.scrollHandler = null;
    this.resizeObserver = null;
    this.lastScrollTop = 0;
    this.renderScheduled = false;
  }

  /**
   * Initialize the virtual grid with a container element
   */
  init(container, scrollContainer = null) {
    this.container = container;
    this.scrollContainer = scrollContainer || container.parentElement || window;

    // Set up container styles
    this.container.style.position = 'relative';
    this.container.style.overflow = 'hidden';

    // Set up scroll listener
    const scrollTarget = this.scrollContainer === window ? window : this.scrollContainer;
    this.scrollHandler = this.throttle(() => this.onScroll(), 16); // ~60fps
    scrollTarget.addEventListener('scroll', this.scrollHandler, { passive: true });

    // Set up resize observer
    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleRender();
    });
    this.resizeObserver.observe(this.container);

    this.isInitialized = true;
    this.render();
  }

  /**
   * Set the data array and re-render
   */
  setData(data) {
    this.data = data || [];
    this.updateContainerHeight();
    this.scheduleRender();
  }

  /**
   * Update number of columns (e.g., on resize)
   */
  setColumns(columns) {
    if (this.columns !== columns) {
      this.columns = columns;
      this.updateContainerHeight();
      this.scheduleRender();
    }
  }

  /**
   * Update item height
   */
  setItemHeight(height) {
    if (this.itemHeight !== height) {
      this.itemHeight = height;
      this.updateContainerHeight();
      this.scheduleRender();
    }
  }

  /**
   * Calculate and set container height to accommodate all items
   */
  updateContainerHeight() {
    if (!this.container || !this.data.length) {
      if (this.container) this.container.style.height = '0px';
      return;
    }

    const rowCount = Math.ceil(this.data.length / this.columns);
    const totalHeight = rowCount * (this.itemHeight + this.itemGap) - this.itemGap;
    this.container.style.height = `${totalHeight}px`;
  }

  /**
   * Get viewport dimensions
   */
  getViewport() {
    if (this.scrollContainer === window) {
      return {
        scrollTop: window.scrollY,
        height: window.innerHeight,
      };
    }
    return {
      scrollTop: this.scrollContainer.scrollTop,
      height: this.scrollContainer.clientHeight,
    };
  }

  /**
   * Calculate which items are visible
   */
  getVisibleRange() {
    const viewport = this.getViewport();
    const rowHeight = this.itemHeight + this.itemGap;

    // Get container offset from scroll container
    let containerOffset = 0;
    if (this.scrollContainer !== window && this.container) {
      containerOffset = this.container.offsetTop;
    }

    const scrollTop = Math.max(0, viewport.scrollTop - containerOffset);

    const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - this.bufferRows);
    const visibleRows = Math.ceil(viewport.height / rowHeight);
    const endRow = Math.min(
      Math.ceil(this.data.length / this.columns),
      startRow + visibleRows + this.bufferRows * 2
    );

    const startIndex = startRow * this.columns;
    const endIndex = Math.min(endRow * this.columns, this.data.length);

    return { startIndex, endIndex, startRow, endRow };
  }

  /**
   * Schedule a render on the next animation frame
   */
  scheduleRender() {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.render();
    });
  }

  /**
   * Main render function - updates visible items
   */
  render() {
    if (!this.isInitialized || !this.container) return;

    const { startIndex, endIndex } = this.getVisibleRange();
    const visibleIndices = new Set();

    // Determine which indices should be visible
    for (let i = startIndex; i < endIndex; i++) {
      visibleIndices.add(i);
    }

    // Remove items that are no longer visible
    for (const [index, element] of this.renderedItems) {
      if (!visibleIndices.has(index)) {
        // Clean up video element before removing
        const video = element.querySelector('video');
        if (video && video.src) {
          video.pause();
          video.src = '';
          video.load();
        }
        element.remove();
        this.renderedItems.delete(index);
      }
    }

    // Add items that should be visible but aren't rendered
    for (let i = startIndex; i < endIndex; i++) {
      if (!this.renderedItems.has(i) && this.data[i]) {
        const element = this.createItem(this.data[i], i);
        this.positionItem(element, i);
        this.container.appendChild(element);
        this.renderedItems.set(i, element);
      }
    }
  }

  /**
   * Create a DOM element for an item
   */
  createItem(data, index) {
    if (this.renderItem) {
      return this.renderItem(data, index);
    }

    // Default rendering - create a placeholder
    const element = document.createElement('div');
    element.className = 'virtual-grid-item';
    element.textContent = `Item ${index}`;
    return element;
  }

  /**
   * Position an item absolutely within the container
   */
  positionItem(element, index) {
    const row = Math.floor(index / this.columns);
    const col = index % this.columns;

    const itemWidth = (this.container.clientWidth - (this.columns - 1) * this.itemGap) / this.columns;
    const x = col * (itemWidth + this.itemGap);
    const y = row * (this.itemHeight + this.itemGap);

    element.style.position = 'absolute';
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    element.style.width = `${itemWidth}px`;
    element.style.height = `${this.itemHeight}px`;
  }

  /**
   * Handle scroll events
   */
  onScroll() {
    const viewport = this.getViewport();

    // Only re-render if scrolled significantly
    if (Math.abs(viewport.scrollTop - this.lastScrollTop) > this.itemHeight / 2) {
      this.lastScrollTop = viewport.scrollTop;
      this.scheduleRender();
    }
  }

  /**
   * Force refresh all rendered items
   */
  refresh() {
    // Clear all rendered items
    for (const [index, element] of this.renderedItems) {
      const video = element.querySelector('video');
      if (video && video.src) {
        video.pause();
        video.src = '';
        video.load();
      }
      element.remove();
    }
    this.renderedItems.clear();

    // Re-render
    this.updateContainerHeight();
    this.render();
  }

  /**
   * Get statistics about the virtual grid
   */
  getStats() {
    return {
      totalItems: this.data.length,
      renderedElements: this.renderedItems.size,
      columns: this.columns,
      rowHeight: this.itemHeight + this.itemGap,
    };
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.scrollHandler) {
      const scrollTarget = this.scrollContainer === window ? window : this.scrollContainer;
      scrollTarget.removeEventListener('scroll', this.scrollHandler);
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    for (const [index, element] of this.renderedItems) {
      const video = element.querySelector('video');
      if (video && video.src) {
        video.pause();
        video.src = '';
      }
      element.remove();
    }
    this.renderedItems.clear();

    this.isInitialized = false;
  }

  /**
   * Throttle helper
   */
  throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VirtualGrid;
} else {
  window.VirtualGrid = VirtualGrid;
}
