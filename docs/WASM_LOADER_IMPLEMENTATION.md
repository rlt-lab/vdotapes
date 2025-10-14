# WASM-Powered Video Loader Implementation

## Overview

Replaced the IntersectionObserver-based video loading with a more reliable WASM-powered approach that uses deterministic viewport calculation from Rust.

## Problems Solved

### 1. Videos Not Loading After Scroll
**Previous Issue:** IntersectionObserver state tracking (`loadedVideos` Set) was not properly synchronized with DOM state. When scrolling back up, videos wouldn't reload.

**Solution:** WASM engine maintains comprehensive state management with:
- Deterministic viewport calculation
- LRU (Least Recently Used) tracking
- Proper state synchronization between WASM and DOM

### 2. Random Rows Not Loading
**Previous Issue:** IntersectionObserver could miss entries during rapid scrolling or when entries were batched unexpectedly by the browser.

**Solution:** Scroll-based viewport calculation in WASM:
- Calculates exact visible range based on scroll position
- No dependency on browser IntersectionObserver quirks
- Throttled scroll handler prevents excessive calculations

### 3. No Retry Logic in Smart Loader
**Previous Issue:** The smart loader's `loadVideo()` had no retry mechanism, failing permanently on transient errors.

**Solution:** WASM loader delegates to renderer's `loadVideo()` which has:
- Exponential backoff retry (3 attempts)
- Manual retry button on failure
- Proper error state tracking

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      VdoTapesApp                            │
│  (renderer.js)                                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐         ┌────────────────────┐   │
│  │  VideoWasmLoader    │────────▶│  VideoGridEngine   │   │
│  │  (JavaScript)       │         │  (Rust/WASM)       │   │
│  └─────────────────────┘         └────────────────────┘   │
│           │                               │                │
│           │ delegates to                  │ manages        │
│           ▼                               ▼                │
│  ┌─────────────────────┐         ┌────────────────────┐   │
│  │  renderer.loadVideo │         │  - State tracking  │   │
│  │  (retry logic)      │         │  - LRU management  │   │
│  └─────────────────────┘         │  - Viewport calc   │   │
│                                   └────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## WASM Engine Capabilities

The `VideoGridEngine` (Rust) provides:

1. **Filtering & Sorting** (already in use)
   - `applyFilters(criteria)`
   - `setSortMode(mode)`

2. **Viewport Management** (now in use)
   - `calculateViewport(scrollTop, viewportHeight, itemHeight, itemsPerRow, bufferRows)`
   - Returns reconciliation result with visible range

3. **Video State Tracking**
   - `markVideoLoaded(videoId)`
   - `markVideoError(videoId)`
   - `getVideosToLoad()` - returns IDs that should be loaded
   - `getVideosToUnload(maxLoaded)` - returns IDs to unload (LRU)

4. **Statistics**
   - `getStats()` - comprehensive metrics for debugging

## Key Implementation Details

### VideoWasmLoader Class

**Initialization:**
```javascript
this.wasmLoader = new VideoWasmLoader({
  renderer: this,           // For retry logic
  wasmEngine: this.gridEngine,  // For viewport calc
  maxActiveVideos: 20,      // WebMediaPlayer limit
  itemHeight: 300,          // Grid item height
  itemsPerRow: 4,           // Current grid columns
  bufferRows: 3             // Pre-load buffer
});
```

**Scroll Handling:**
- Throttled to 100ms to prevent excessive calculations
- Uses `requestAnimationFrame` for smooth updates
- Passive event listener for better performance

**Video Loading:**
1. Check if video already loaded → skip or resume
2. Delegate to `renderer.loadVideo()` for retry logic
3. Attach event listeners to track load success/error
4. Mark state in WASM engine

**Video Unloading:**
1. Pause video
2. Clear `src` and call `load()` to release WebMediaPlayer
3. Remove event listeners
4. Update DOM classes

### Fallback Strategy

The implementation has multiple fallback layers:

1. **WASM Loader** (best) - Deterministic, reliable
2. **Smart Loader** (fallback) - IntersectionObserver-based
3. **No Loader** (last resort) - All videos load at once

```javascript
if (this.useWasmLoader && this.wasmLoader && container) {
  this.wasmLoader.init(container);
} else if (this.smartLoader && container) {
  this.smartLoader.observeVideoItems(container);
}
```

## Benefits Over IntersectionObserver

### Deterministic Behavior
- WASM calculates exact visible range from scroll position
- No browser-specific IntersectionObserver quirks
- Consistent across all browsers

### Better State Management
- Rust-based LRU tracking
- Proper synchronization between state and DOM
- Can track error states and retry counts

### Performance
- Scroll handler throttled to 100ms
- WASM calculations are faster than JavaScript
- Minimal DOM queries

### Reliability
- Videos always reload when scrolling back
- No "lost" entries during rapid scrolling
- Integrates with renderer's retry logic

## Configuration

### Max Active Videos
```javascript
maxActiveVideos: 20
```
Set to 20 (conservative) to avoid Chrome's ~75 WebMediaPlayer limit. Adjust based on:
- Device capabilities
- Video sizes
- Browser being tested

### Buffer Rows
```javascript
bufferRows: 3
```
Number of rows to pre-load above/below viewport. Higher = smoother scrolling but more memory usage.

### Scroll Throttle
```javascript
scrollThrottle: 100  // ms
```
Minimum time between viewport calculations. Lower = more responsive but more CPU usage.

## Testing Checklist

### Initial Load
- [ ] First 4 rows load correctly
- [ ] Videos start playing automatically
- [ ] No console errors

### Scrolling Down
- [ ] New videos load as they approach viewport
- [ ] Old videos unload when far from viewport
- [ ] No WebMediaPlayer errors
- [ ] Check console for load/unload counts

### Scrolling Back Up
- [ ] Videos reload when scrolling back
- [ ] Previously loaded videos resume correctly
- [ ] No "blank" videos

### Grid Changes
- [ ] Change columns from 4 to 6 - videos reload correctly
- [ ] Change columns from 6 to 4 - videos reload correctly

### Filter/Sort Changes
- [ ] Filter by folder - all visible videos load
- [ ] Sort by date - all visible videos load
- [ ] Toggle favorites - all visible videos load

### Error Handling
- [ ] Corrupt video file shows retry button
- [ ] Retry button works
- [ ] Error videos don't block other videos

### Performance
- [ ] Smooth scrolling (60fps)
- [ ] Memory usage stays reasonable
- [ ] CPU usage acceptable during scroll

## Debugging

### Console Logs

**WASM Loader:**
```
[WasmLoader] Initialized with WASM engine support
[WasmLoader] Scroll handler attached
[WasmLoader] Viewport update: +5 -3 (18/20 loaded)
```

**Renderer:**
```
[Renderer] Using WASM loader for video management
✅ WASM Grid Engine initialized successfully!
✅ WASM video loader initialized successfully!
```

### Statistics

Access runtime stats via console:
```javascript
app.wasmLoader.getStats()
// Returns: { totalVideos, filteredVideos, loadedVideos, inViewport, maxActiveVideos }
```

### Force Reload

For debugging, force reload visible videos:
```javascript
app.wasmLoader.forceReloadVisible()
```

## Future Enhancements

1. **Adaptive Buffer Size**
   - Increase buffer during slow scrolling
   - Decrease during rapid scrolling

2. **Smart Preloading**
   - Predict scroll direction
   - Preload in scroll direction more aggressively

3. **Video Quality Adaptation**
   - Load lower quality thumbnails first
   - Upgrade to full quality when in viewport longer

4. **Memory-Aware Unloading**
   - Monitor browser memory usage
   - Adjust `maxActiveVideos` dynamically

5. **Rust Viewport Reconciliation**
   - Use the `DomOperation` results from WASM
   - Minimal DOM updates instead of full re-render

## Known Limitations

1. **Fixed Item Height**
   - Currently assumes all video items are 300px tall
   - Works due to CSS `aspect-ratio: 3/4`
   - Would need adjustment for variable heights

2. **Single Container**
   - Only supports one video grid at a time
   - Multi-view would need separate loader instances

3. **No Virtual Scrolling**
   - Still renders all DOM elements
   - WASM has reconciliation capability but not yet used
   - Consider for 10,000+ video collections

## Migration Notes

### For Developers

If you need to modify video loading behavior:

1. **Video loading logic** → `renderer.js` `loadVideo()` method
2. **Viewport calculation** → Rust source in `src/video-grid-wasm/src/`
3. **Loader coordination** → `video-wasm-loader.js`

### Disabling WASM Loader

To fall back to IntersectionObserver loader:
```javascript
// In renderer.js constructor
this.useWasmLoader = false;
```

Or prevent WASM initialization entirely by removing/commenting out:
```html
<script src="video-wasm-loader.js"></script>
```
