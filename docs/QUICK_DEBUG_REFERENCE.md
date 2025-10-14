# Quick Debug Reference - Video Loading

## Browser Console Commands

### Check Which Loader is Active

```javascript
// Check if WASM loader is active
app.useWasmLoader
// true = using WASM loader
// false = using IntersectionObserver fallback

// Check if WASM engine is available
app.useWasmEngine
// true = WASM module loaded successfully
```

### Get Current Statistics

```javascript
// WASM loader stats
app.wasmLoader.getStats()
// Returns: { totalVideos, filteredVideos, loadedVideos, inViewport, maxActiveVideos }

// WASM engine stats
app.gridEngine.getStats()
// Returns: { totalVideos, filteredVideos, visibleVideos, loadedVideos, inViewport }

// Smart loader stats (if using fallback)
app.smartLoader.getStats()
// Returns: { loadedVideos, activeVideos, maxActiveVideos }
```

### Force Actions

```javascript
// Force reload all visible videos
app.wasmLoader.forceReloadVisible()

// Force cleanup (unload distant videos)
app.smartLoader.forceCleanup()

// Update viewport manually
app.wasmLoader.updateViewport()
```

### Switch Loaders

```javascript
// Disable WASM loader, use fallback
app.useWasmLoader = false
// Reload grid to apply

// Re-enable WASM loader
app.useWasmLoader = true
app.initializeWasmLoader()
```

### Check Video State

```javascript
// Get all displayed videos
app.displayedVideos
// Array of video objects

// Find a specific video
app.displayedVideos.find(v => v.name.includes('filename'))

// Check if a video is loaded
const video = document.querySelector('[data-video-id="some-id"] video')
video.src  // If truthy, video is loaded
video.paused  // If false, video is playing
```

### Monitor Loading

```javascript
// Count loaded videos in DOM
document.querySelectorAll('.video-item video[src]').length

// Count loading videos
document.querySelectorAll('.video-item.loading').length

// Count error videos
document.querySelectorAll('.video-item.error').length

// Get all video IDs currently loaded
Array.from(document.querySelectorAll('.video-item video[src]'))
  .map(v => v.closest('.video-item').dataset.videoId)
```

## Console Log Filters

### Filter by Component

**WASM Loader:**
```
Filter: WasmLoader
```

**Smart Loader:**
```
Filter: SmartLoader
```

**Renderer:**
```
Filter: Renderer
```

**All Video Loading:**
```
Filter: load|Loader|WASM
```

## Expected Console Output

### On Startup (Success)

```
✅ WASM Grid Engine loaded successfully!
✅ WASM Grid Engine initialized successfully!
✅ WASM video loader initialized successfully!
[Init] WASM loader will initialize when engine is ready
[Renderer] Using WASM loader for video management
```

### On Startup (Fallback)

```
❌ Failed to load WASM Grid Engine: [error]
[Renderer] Using IntersectionObserver-based smart loader
Smart video loader initialized
```

### During Scrolling (WASM Loader)

```
[WasmLoader] Viewport update: +6 -4 (19/20 loaded)
[WasmLoader] Viewport update: +3 -2 (20/20 loaded)
[WasmLoader] Viewport update: +2 -3 (19/20 loaded)
```

### During Scrolling (Smart Loader)

```
[SmartLoader] Observing 150 video items (cleared state)
[SmartLoader] Cleanup: 18 videos loaded, 15 active (max: 20)
```

### On Errors

```
[WasmLoader] Container not found for video: [id]
[WasmLoader] No data-src for video: [id]
Failed to load video after 3 attempts: [path]
```

## Performance Monitoring

### Check Frame Rate

```javascript
// In Chrome DevTools
// Performance tab → FPS meter
// Should see: 60 FPS during scrolling
```

### Check Memory

```
Chrome Task Manager (Shift+Esc)
→ Look for "Subframe: app/index.html"
→ Video Player Memory: ~500MB-1GB is normal
→ Should not continuously grow
```

### Check Active WebMediaPlayers

```javascript
// Approximate count via loaded videos
app.wasmLoader.getStats().loadedVideos
// Should be ≤ 20 (or your maxActiveVideos setting)
```

## Common Issues & Quick Fixes

### Issue: Videos Don't Load

**Check:**
```javascript
app.wasmLoader  // Should not be null
app.wasmLoader.isInitialized  // Should be true
```

**Fix:**
```javascript
app.wasmLoader.forceReloadVisible()
```

### Issue: Videos Don't Reload on Scroll Back

**Check:**
```javascript
// Is WASM loader active?
app.useWasmLoader  // Should be true

// Are videos being tracked?
app.gridEngine.getStats().loadedVideos
```

**Fix:**
```javascript
// Force viewport update
app.wasmLoader.updateViewport()
```

### Issue: WebMediaPlayer Errors

**Check:**
```javascript
// Too many videos loaded?
app.wasmLoader.getStats().loadedVideos
// Should be ≤ 20
```

**Fix:**
```javascript
// Reduce max active videos
app.wasmLoader.maxActiveVideos = 15
app.wasmLoader.updateViewport()
```

### Issue: Slow Performance

**Check:**
```javascript
// Scroll throttle setting
app.wasmLoader.scrollThrottle  // 100ms default
```

**Fix:**
```javascript
// Increase throttle (less responsive, better performance)
app.wasmLoader.scrollThrottle = 200
```

### Issue: Videos Load Too Late

**Check:**
```javascript
// Buffer rows setting
app.wasmLoader.bufferRows  // 3 rows default
```

**Fix:**
```javascript
// Increase buffer (more preloading)
app.wasmLoader.bufferRows = 5
app.wasmLoader.updateViewport()
```

## Testing Shortcuts

### Rapid Grid Column Changes

```javascript
// Test grid layout changes
[2,4,6,8,4].forEach((cols, i) => {
  setTimeout(() => app.setGridCols(cols), i * 1000)
})
```

### Scroll to Bottom

```javascript
window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
```

### Scroll to Top

```javascript
window.scrollTo({ top: 0, behavior: 'smooth' })
```

### Simulate Rapid Scrolling

```javascript
let y = 0
const interval = setInterval(() => {
  y += 200
  window.scrollTo(0, y)
  if (y > document.body.scrollHeight) {
    clearInterval(interval)
  }
}, 50)
```

## Debug Logging

### Enable Verbose Logging

Add to `video-wasm-loader.js`:

```javascript
// At top of updateViewport()
console.log('[Debug] Viewport:', {
  scrollTop,
  viewportHeight,
  videosToLoad: videosToLoad.length,
  videosToUnload: videosToUnload.length
})
```

### Track All Load Attempts

Add to `loadVideo()`:

```javascript
console.log('[Debug] Loading video:', videoId, {
  hasSrc: !!videoElement.src,
  isPaused: videoElement.paused,
  dataSrc: videoElement.dataset.src
})
```

## Emergency Fallback

If WASM loader completely fails:

```javascript
// 1. Disable WASM loader
app.useWasmLoader = false

// 2. Ensure smart loader is active
if (!app.smartLoader) {
  app.smartLoader = new VideoSmartLoader({
    maxActiveVideos: 20,
    loadBuffer: 10
  })
}

// 3. Re-render grid
app.renderGrid()
```

## File Locations

- **WASM Loader:** `/app/video-wasm-loader.js`
- **Smart Loader:** `/app/video-smart-loader.js`
- **Renderer:** `/app/renderer.js`
- **WASM Module:** `/app/wasm/video_grid_wasm.js`
- **Rust Source:** `/src/video-grid-wasm/src/lib.rs`

## Useful Links

- [Full Implementation Docs](./WASM_LOADER_IMPLEMENTATION.md)
- [Testing Instructions](./TESTING_INSTRUCTIONS.md)
- [Complete Summary](./VIDEO_LOADING_FIX_SUMMARY.md)
