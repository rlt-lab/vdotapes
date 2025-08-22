# Implementation Plan 2: Video Element Cleanup

**Priority:** HIGH
**Estimated Effort:** 1-2 days
**Dependencies:** Plan 1 (Video Virtualization) - recommended but not required

## Objective

Implement proper video element lifecycle management to prevent memory leaks, reduce resource consumption, and improve application stability.

## Current Problem

- Video elements accumulate event listeners without cleanup
- Preview loops continue running for invisible videos
- Video sources remain loaded in memory indefinitely
- No proper disposal when videos are removed from DOM
- Memory usage grows continuously during application use

## Solution Design

### 1. Video Lifecycle Manager
Create a centralized system to manage video element lifecycle from creation to destruction.

```javascript
class VideoLifecycleManager {
  constructor() {
    this.activeVideos = new Map(); // videoId -> VideoState
    this.cleanupQueue = new Set();
    this.maxActiveVideos = 20; // Limit concurrent active videos
  }

  registerVideo(videoElement, videoData) {
    const state = new VideoElementState(videoElement, videoData);
    this.activeVideos.set(videoData.id, state);
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
}
```

### 2. Video Element State Management
Track and manage the state of each video element throughout its lifecycle.

```javascript
class VideoElementState {
  constructor(element, videoData) {
    this.element = element;
    this.videoData = videoData;
    this.isActive = false;
    this.loopHandler = null;
    this.eventListeners = new Map();
    this.loadPromise = null;
    this.lastInteraction = Date.now();
  }

  activate() {
    if (this.isActive) return;
    this.isActive = true;
    this.setupEventListeners();
    this.startVideoIfNeeded();
  }

  deactivate() {
    if (!this.isActive) return;
    this.isActive = false;
    this.pauseVideo();
    // Keep element but reduce resource usage
  }

  cleanup() {
    this.removeAllEventListeners();
    this.stopPreviewLoop();
    this.clearVideoSource();
    this.isActive = false;
  }
}
```

## Implementation Steps

### Phase 1: Core Cleanup System (Day 1)

1. **Create VideoLifecycleManager**
   - Implement video registration/unregistration
   - Add active video limit enforcement
   - Create cleanup scheduling system

2. **Implement VideoElementState**
   - Track video element state and resources
   - Manage event listener lifecycle
   - Handle video loading/unloading

3. **Add event listener management**
   - Centralized event listener tracking
   - Automatic cleanup on element destruction
   - Prevent duplicate listener registration

```javascript
class EventListenerManager {
  constructor(element) {
    this.element = element;
    this.listeners = new Map();
  }

  addEventListener(event, handler, options) {
    const key = `${event}_${handler.name || 'anonymous'}`;
    if (this.listeners.has(key)) {
      this.removeEventListener(event, this.listeners.get(key));
    }
    
    this.element.addEventListener(event, handler, options);
    this.listeners.set(key, { event, handler, options });
  }

  removeAllListeners() {
    this.listeners.forEach(({ event, handler }) => {
      this.element.removeEventListener(event, handler);
    });
    this.listeners.clear();
  }
}
```

### Phase 2: Preview Loop Management (Day 1)

1. **Implement smart preview loops**
   - Only run loops for visible videos
   - Automatic cleanup when video leaves viewport
   - Efficient loop management

```javascript
class PreviewLoopManager {
  constructor() {
    this.activeLoops = new Map();
    this.loopCleanupInterval = 30000; // 30 seconds
  }

  startPreviewLoop(videoElement, videoId) {
    this.stopPreviewLoop(videoId); // Cleanup existing
    
    const duration = videoElement.duration;
    if (!duration || duration <= 20) {
      // Short videos play normally
      videoElement.play().catch(() => {});
      return;
    }

    const midpoint = duration / 2;
    const start = Math.max(0, midpoint - 2.5);
    const end = Math.min(duration, midpoint + 2.5);

    const loopHandler = () => {
      if (videoElement.currentTime >= end) {
        videoElement.currentTime = start;
      }
    };

    videoElement.addEventListener('timeupdate', loopHandler);
    this.activeLoops.set(videoId, {
      element: videoElement,
      handler: loopHandler,
      lastUsed: Date.now()
    });

    // Set initial position and play
    videoElement.currentTime = start;
    videoElement.play().catch(() => {});
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
}
```

### Phase 3: Memory Management (Day 2)

1. **Implement video source management**
   - Efficient loading/unloading of video sources
   - Blob URL cleanup
   - Memory pressure detection

```javascript
class VideoSourceManager {
  constructor() {
    this.loadedSources = new Map();
    this.blobUrls = new Set();
    this.memoryPressureThreshold = 100 * 1024 * 1024; // 100MB
  }

  loadVideoSource(videoElement, videoData) {
    // Check if already loaded
    if (videoElement.src === videoData.url) return;

    // Unload previous source
    this.unloadVideoSource(videoElement);

    // Load new source
    videoElement.src = videoData.url;
    if (videoData.url.startsWith('blob:')) {
      this.blobUrls.add(videoData.url);
    }

    this.loadedSources.set(videoElement, videoData.url);
  }

  unloadVideoSource(videoElement) {
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
        URL.revokeObjectURL(blobUrl);
        this.blobUrls.delete(blobUrl);
      }
    }, 5000);
  }

  checkMemoryPressure() {
    if (performance.memory && 
        performance.memory.usedJSHeapSize > this.memoryPressureThreshold) {
      this.performEmergencyCleanup();
    }
  }

  performEmergencyCleanup() {
    // Cleanup oldest/least used video sources
    const sortedElements = Array.from(this.loadedSources.keys())
      .sort((a, b) => (a._lastInteraction || 0) - (b._lastInteraction || 0));
    
    const toCleanup = sortedElements.slice(0, Math.floor(sortedElements.length / 2));
    toCleanup.forEach(element => this.unloadVideoSource(element));
  }
}
```

2. **Add intersection observer optimization**
   - More efficient visibility detection
   - Cleanup videos that leave viewport
   - Preload videos entering viewport

```javascript
class VideoVisibilityManager {
  constructor(lifecycleManager) {
    this.lifecycleManager = lifecycleManager;
    this.observer = new IntersectionObserver(
      this.handleIntersection.bind(this),
      {
        root: null,
        rootMargin: '100px', // Preload buffer
        threshold: [0, 0.1, 0.5, 1.0] // Multiple thresholds for fine control
      }
    );
  }

  handleIntersection(entries) {
    entries.forEach(entry => {
      const videoId = entry.target.dataset.videoId;
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
            if (!entry.target.offsetParent) { // Element removed from DOM
              this.lifecycleManager.unregisterVideo(videoId);
            }
          }, 10000);
        }
      }
    });
  }

  observeVideo(videoElement) {
    this.observer.observe(videoElement);
  }

  unobserveVideo(videoElement) {
    this.observer.unobserve(videoElement);
  }
}
```

## Files to Modify

1. **app/renderer.js**
   - Replace existing video lifecycle code
   - Integrate VideoLifecycleManager
   - Update video creation/destruction logic

2. **Create new file: app/video-lifecycle.js**
   - VideoLifecycleManager class
   - VideoElementState class
   - PreviewLoopManager class
   - VideoSourceManager class

3. **Update app/index.html**
   - Include new video-lifecycle.js script

## Integration with Existing Code

```javascript
// In renderer.js - Update video creation
createVideoItemHTML(video, index) {
  const videoElement = this.createVideoElement(video);
  
  // Register with lifecycle manager
  const state = this.videoLifecycleManager.registerVideo(videoElement, video);
  
  // Observe for visibility changes
  this.visibilityManager.observeVideo(videoElement);
  
  return videoElement;
}

// Update video removal
removeVideoFromGrid(videoId) {
  const videoElement = document.querySelector(`[data-video-id="${videoId}"]`);
  if (videoElement) {
    this.visibilityManager.unobserveVideo(videoElement);
    this.videoLifecycleManager.unregisterVideo(videoId);
    videoElement.remove();
  }
}
```

## Success Criteria

- **Memory Stability:** No memory growth during extended use
- **Resource Efficiency:** Maximum 20 active video elements at any time
- **Performance:** Smooth scrolling without video-related lag
- **Cleanup Verification:** All event listeners removed on element destruction

## Testing Plan

1. **Memory Leak Testing**
   - Monitor memory usage during extended scrolling
   - Check for event listener accumulation
   - Verify blob URL cleanup

2. **Performance Testing**
   - Test with rapid scrolling through large collections
   - Measure video loading/unloading performance
   - Check intersection observer efficiency

3. **Stability Testing**
   - Extended use sessions (1+ hours)
   - Video source switching scenarios
   - Memory pressure simulation

## Monitoring and Debugging

```javascript
class CleanupMonitor {
  constructor() {
    this.stats = {
      videosCreated: 0,
      videosDestroyed: 0,
      eventListenersActive: 0,
      memoryUsage: 0,
      activeLoops: 0
    };
  }

  logStats() {
    console.log('Video Cleanup Stats:', {
      ...this.stats,
      memoryUsage: performance.memory?.usedJSHeapSize || 'N/A'
    });
  }

  startMonitoring() {
    setInterval(() => this.logStats(), 30000); // Log every 30 seconds
  }
}
```

## Rollback Plan

- Feature flag to enable/disable new cleanup system
- Keep original video handling as fallback
- Gradual rollout with performance monitoring

## Next Steps

After completion, this enables:
- **Plan 3:** Database indexing (stable memory usage allows larger datasets)
- **Plan 4:** Video metadata extraction (efficient resource management)
- More complex video features without memory concerns