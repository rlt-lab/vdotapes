/**
 * Video Element Lifecycle Management System
 * Manages video element lifecycle to prevent memory leaks and optimize resource usage
 */

class VideoLifecycleManager {
  constructor(options = {}) {
    this.activeVideos = new Map(); // videoId -> VideoElementState
    this.cleanupQueue = new Set();
    this.maxActiveVideos = options.maxActiveVideos || 20;
    this.cleanupInterval = options.cleanupInterval || 30000; // 30 seconds

    // Start periodic cleanup
    this.startPeriodicCleanup();

    // Global cleanup on page unload
    window.addEventListener('beforeunload', () => {
      this.cleanup();
    });

    // Memory pressure monitoring
    this.memoryPressureThreshold = 100 * 1024 * 1024; // 100MB
    this.startMemoryMonitoring();
  }

  registerVideo(videoElement, videoData) {
    // Check if already registered
    if (this.activeVideos.has(videoData.id)) {
      return this.activeVideos.get(videoData.id);
    }

    const state = new VideoElementState(videoElement, videoData);
    this.activeVideos.set(videoData.id, state);

    // Enforce active video limit
    this.enforceActiveLimit();

    return state;
  }

  unregisterVideo(videoId) {
    const state = this.activeVideos.get(videoId);
    if (state) {
      state.cleanup();
      this.activeVideos.delete(videoId);
    }
  }

  activateVideo(videoId) {
    const state = this.activeVideos.get(videoId);
    if (state) {
      state.activate();
    }
  }

  deactivateVideo(videoId) {
    const state = this.activeVideos.get(videoId);
    if (state) {
      state.deactivate();
    }
  }

  enforceActiveLimit() {
    if (this.activeVideos.size <= this.maxActiveVideos) return;

    // Sort by last interaction time and deactivate oldest
    const sortedStates = Array.from(this.activeVideos.values())
      .filter((state) => state.isActive)
      .sort((a, b) => a.lastInteraction - b.lastInteraction);

    const toDeactivate = sortedStates.slice(0, sortedStates.length - this.maxActiveVideos);
    toDeactivate.forEach((state) => state.deactivate());
  }

  startPeriodicCleanup() {
    setInterval(() => {
      this.performPeriodicCleanup();
    }, this.cleanupInterval);
  }

  performPeriodicCleanup() {
    const now = Date.now();
    const inactiveThreshold = 60000; // 1 minute

    for (const [videoId, state] of this.activeVideos) {
      // Clean up videos that have been inactive for too long
      if (!state.isActive && now - state.lastInteraction > inactiveThreshold) {
        this.unregisterVideo(videoId);
      }
    }
  }

  startMemoryMonitoring() {
    if (!performance.memory) return;

    setInterval(() => {
      this.checkMemoryPressure();
    }, 10000); // Check every 10 seconds
  }

  checkMemoryPressure() {
    if (!performance.memory) return;

    if (performance.memory.usedJSHeapSize > this.memoryPressureThreshold) {
      console.log('Memory pressure detected, performing emergency cleanup');
      this.performEmergencyCleanup();
    }
  }

  performEmergencyCleanup() {
    // Aggressively clean up inactive videos
    const inactive = Array.from(this.activeVideos.values())
      .filter((state) => !state.isActive)
      .sort((a, b) => a.lastInteraction - b.lastInteraction);

    // Remove half of inactive videos
    const toRemove = inactive.slice(0, Math.floor(inactive.length / 2));
    toRemove.forEach((state) => this.unregisterVideo(state.videoData.id));
  }

  cleanup() {
    // Cleanup all registered videos
    for (const [videoId, state] of this.activeVideos) {
      state.cleanup();
    }
    this.activeVideos.clear();
  }

  getStats() {
    const active = Array.from(this.activeVideos.values()).filter((s) => s.isActive).length;
    return {
      total: this.activeVideos.size,
      active,
      inactive: this.activeVideos.size - active,
      memoryUsage: performance.memory?.usedJSHeapSize || 'N/A',
    };
  }
}

class VideoElementState {
  constructor(element, videoData) {
    this.element = element;
    this.videoData = videoData;
    this.isActive = false;
    this.lastInteraction = Date.now();

    // Event listener management
    this.eventListeners = new EventListenerManager(element);

    // Preview loop management
    this.previewLoopManager = new PreviewLoopManager();

    // Video source management
    this.sourceManager = new VideoSourceManager();
  }

  activate() {
    if (this.isActive) return;

    this.isActive = true;
    this.lastInteraction = Date.now();

    // Setup intersection observer if needed
    this.setupVideoObserver();
  }

  deactivate() {
    if (!this.isActive) return;

    this.isActive = false;
    this.pauseVideo();

    // Reduce resource usage but keep element
    this.previewLoopManager.stopPreviewLoop(this.videoData.id);
  }

  cleanup() {
    this.isActive = false;

    // Remove all event listeners
    this.eventListeners.removeAllListeners();

    // Stop preview loops
    this.previewLoopManager.stopPreviewLoop(this.videoData.id);

    // Clear video source
    this.sourceManager.unloadVideoSource(this.element.querySelector('video'));

    // Clear references
    this.element = null;
    this.videoData = null;
  }

  setupVideoObserver() {
    const video = this.element.querySelector('video');
    if (!video) return;

    // Load video if in viewport
    if (this.isElementInViewport(this.element)) {
      this.loadVideoIfNeeded();
    }
  }

  loadVideoIfNeeded() {
    const video = this.element.querySelector('video');
    if (!video || video.src) return;

    this.sourceManager.loadVideoSource(video, this.videoData);
    this.lastInteraction = Date.now();
  }

  pauseVideo() {
    const video = this.element.querySelector('video');
    if (video && !video.paused) {
      video.pause();
    }
  }

  isElementInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }
}

class EventListenerManager {
  constructor(element) {
    this.element = element;
    this.listeners = new Map();
  }

  addEventListener(event, handler, options) {
    const key = `${event}_${handler.name || 'anonymous'}_${Date.now()}`;

    // Remove existing listener if same event and handler name
    const existingKey = Array.from(this.listeners.keys()).find((k) =>
      k.startsWith(`${event}_${handler.name || 'anonymous'}`)
    );

    if (existingKey) {
      this.removeEventListener(existingKey);
    }

    this.element.addEventListener(event, handler, options);
    this.listeners.set(key, { event, handler, options });

    return key;
  }

  removeEventListener(key) {
    const listener = this.listeners.get(key);
    if (listener) {
      this.element.removeEventListener(listener.event, listener.handler);
      this.listeners.delete(key);
    }
  }

  removeAllListeners() {
    for (const [key, listener] of this.listeners) {
      this.element.removeEventListener(listener.event, listener.handler);
    }
    this.listeners.clear();
  }

  getActiveListeners() {
    return this.listeners.size;
  }
}

class PreviewLoopManager {
  constructor() {
    this.activeLoops = new Map();
    this.loopCleanupInterval = 30000; // 30 seconds

    // Periodic cleanup of unused loops
    setInterval(() => {
      this.cleanupInactiveLoops();
    }, this.loopCleanupInterval);
  }

  startPreviewLoop(videoElement, videoId) {
    this.stopPreviewLoop(videoId); // Cleanup existing

    const duration = videoElement.duration;
    if (!duration || isNaN(duration) || duration <= 0) {
      // Can't create preview loop, play normally
      videoElement.play().catch(() => {});
      return;
    }

    if (duration <= 20) {
      // Short videos play normally
      videoElement.play().catch(() => {});
      return;
    }

    const midpoint = duration / 2;
    const start = Math.max(0, midpoint - 2.5);
    const end = Math.min(duration, midpoint + 2.5);

    const loopHandler = () => {
      try {
        if (videoElement.currentTime >= end) {
          videoElement.currentTime = start;
        }
      } catch (error) {
        console.warn('Error in preview loop:', error);
        this.stopPreviewLoop(videoId);
      }
    };

    // Setup loop
    videoElement.addEventListener('timeupdate', loopHandler);
    this.activeLoops.set(videoId, {
      element: videoElement,
      handler: loopHandler,
      lastUsed: Date.now(),
      start,
      end,
    });

    // Set initial position and play
    const handleSeeked = () => {
      videoElement.play().catch(() => {});
    };

    const handleSeekError = () => {
      console.warn('Seek failed, playing from current position');
      videoElement.play().catch(() => {});
    };

    videoElement.addEventListener('seeked', handleSeeked, { once: true });
    videoElement.addEventListener('error', handleSeekError, { once: true });

    try {
      videoElement.currentTime = start;
    } catch (error) {
      console.warn('Failed to set currentTime:', error);
      videoElement.play().catch(() => {});
    }
  }

  stopPreviewLoop(videoId) {
    const loop = this.activeLoops.get(videoId);
    if (loop) {
      loop.element.removeEventListener('timeupdate', loop.handler);
      this.activeLoops.delete(videoId);
    }
  }

  cleanupInactiveLoops() {
    const now = Date.now();
    for (const [videoId, loop] of this.activeLoops) {
      if (now - loop.lastUsed > this.loopCleanupInterval) {
        this.stopPreviewLoop(videoId);
      }
    }
  }

  getActiveLoopCount() {
    return this.activeLoops.size;
  }
}

class VideoSourceManager {
  constructor() {
    this.loadedSources = new Map();
    this.blobUrls = new Set();
    this.memoryPressureThreshold = 50 * 1024 * 1024; // 50MB
    this.cleanupTimeout = 5000; // 5 seconds delay for blob cleanup
  }

  loadVideoSource(videoElement, videoData) {
    const videoSrc = videoData.path || videoData.url;

    // Check if already loaded
    if (videoElement.src === videoSrc) return;

    // Unload previous source
    this.unloadVideoSource(videoElement);

    // Load new source
    videoElement.src = videoSrc;

    if (videoSrc && videoSrc.startsWith('blob:')) {
      this.blobUrls.add(videoSrc);
    }

    this.loadedSources.set(videoElement, videoSrc);
  }

  unloadVideoSource(videoElement) {
    if (!videoElement) return;

    const currentSrc = this.loadedSources.get(videoElement);
    if (currentSrc) {
      videoElement.pause();
      videoElement.src = '';
      videoElement.load(); // Force unload

      if (currentSrc.startsWith('blob:')) {
        this.scheduleBlobCleanup(currentSrc);
      }

      this.loadedSources.delete(videoElement);
    }
  }

  scheduleBlobCleanup(blobUrl) {
    // Delay cleanup to allow for potential reuse
    setTimeout(() => {
      if (this.blobUrls.has(blobUrl)) {
        try {
          URL.revokeObjectURL(blobUrl);
          this.blobUrls.delete(blobUrl);
        } catch (error) {
          // Ignore revoke errors
        }
      }
    }, this.cleanupTimeout);
  }

  checkMemoryPressure() {
    if (!performance.memory) return false;
    return performance.memory.usedJSHeapSize > this.memoryPressureThreshold;
  }

  performEmergencyCleanup() {
    // Cleanup oldest/least used video sources
    const sortedElements = Array.from(this.loadedSources.keys()).sort(
      (a, b) => (a._lastInteraction || 0) - (b._lastInteraction || 0)
    );

    const toCleanup = sortedElements.slice(0, Math.floor(sortedElements.length / 2));
    toCleanup.forEach((element) => this.unloadVideoSource(element));
  }

  getStats() {
    return {
      loadedSources: this.loadedSources.size,
      blobUrls: this.blobUrls.size,
      memoryUsage: performance.memory?.usedJSHeapSize || 'N/A',
    };
  }
}

// Enhanced Video Visibility Manager
class VideoVisibilityManager {
  constructor(lifecycleManager) {
    this.lifecycleManager = lifecycleManager;
    this.observer = new IntersectionObserver(this.handleIntersection.bind(this), {
      root: null,
      rootMargin: '100px', // Preload buffer
      threshold: [0, 0.1, 0.5, 1.0], // Multiple thresholds for fine control
    });

    this.observedElements = new Set();
  }

  handleIntersection(entries) {
    entries.forEach((entry) => {
      const videoId = entry.target.dataset.videoId;
      if (!videoId) return;

      const state = this.lifecycleManager.activeVideos.get(videoId);
      if (!state) return;

      if (entry.isIntersecting) {
        if (entry.intersectionRatio >= 0.1) {
          state.activate();
        }
      } else {
        // Video completely out of view
        if (entry.intersectionRatio === 0) {
          state.deactivate();

          // Schedule cleanup if out of view for too long
          setTimeout(() => {
            if (!entry.target.offsetParent) {
              // Element removed from DOM
              this.lifecycleManager.unregisterVideo(videoId);
            }
          }, 10000);
        }
      }
    });
  }

  observeVideo(videoElement) {
    if (this.observedElements.has(videoElement)) return;

    this.observer.observe(videoElement);
    this.observedElements.add(videoElement);
  }

  unobserveVideo(videoElement) {
    this.observer.unobserve(videoElement);
    this.observedElements.delete(videoElement);
  }

  cleanup() {
    this.observer.disconnect();
    this.observedElements.clear();
  }
}

// Export classes for use in other modules
window.VideoLifecycleManager = VideoLifecycleManager;
window.VideoElementState = VideoElementState;
window.EventListenerManager = EventListenerManager;
window.PreviewLoopManager = PreviewLoopManager;
window.VideoSourceManager = VideoSourceManager;
window.VideoVisibilityManager = VideoVisibilityManager;
