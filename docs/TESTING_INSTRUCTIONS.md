# Video Loading Fix - Testing Instructions

## What Was Fixed

### Root Causes Identified

1. **IntersectionObserver State Mismatch**
   - The `loadedVideos` Set was cleared on re-render but DOM elements persisted
   - Caused videos to not reload when scrolling back up

2. **No Retry Logic in Smart Loader**
   - Simple `loadVideo()` implementation had no error recovery
   - Transient failures became permanent

3. **Browser IntersectionObserver Quirks**
   - Entries could be missed during rapid scrolling
   - Batching behavior was unpredictable
   - Different behavior across browsers

### Solution Implemented

**WASM-Powered Video Loader** with:
- ✅ Deterministic viewport calculation (Rust-based)
- ✅ LRU video management 
- ✅ Integrates with renderer's retry logic
- ✅ Proper state synchronization
- ✅ Handles scroll-back reliably

## How to Test

### 1. Start the Application

```bash
npm run dev
```

Look for these console messages:
```
✅ WASM Grid Engine loaded successfully!
✅ WASM Grid Engine initialized successfully!
✅ WASM video loader initialized successfully!
[Renderer] Using WASM loader for video management
```

If you see `[Renderer] Using IntersectionObserver-based smart loader`, the WASM loader failed to initialize (see Troubleshooting below).

### 2. Load a Video Collection

- Click "Select Folder"
- Choose a folder with 50+ videos (to test scrolling)
- Wait for scan to complete

### 3. Test: Initial Load

**What to check:**
- First 3-4 rows of videos load immediately
- Videos start playing automatically
- No blank/gray squares
- Console shows: `[WasmLoader] Viewport update: +X -0 (Y/20 loaded)`

**Expected behavior:**
- Initial viewport loads correctly
- Buffer rows (3 rows above/below) pre-load
- Total loaded videos: ~20 (depending on grid columns and viewport size)

### 4. Test: Scroll Down

**What to do:**
- Scroll down slowly through the entire collection
- Observe videos loading as you scroll

**What to check:**
- Videos load smoothly as they approach viewport
- Console shows: `[WasmLoader] Viewport update: +X -Y (Z/20 loaded)`
- Loaded count stays around 20 (±5)
- No blank videos
- No console errors about WebMediaPlayer

**Expected behavior:**
- Videos load ~3 rows before entering viewport
- Old videos unload when >3 rows past viewport
- Smooth playback without stuttering

### 5. Test: Scroll Back Up (CRITICAL)

**What to do:**
- Scroll all the way down
- Scroll back up to the top

**What to check:**
- Videos reload as you scroll back up
- No permanently blank videos
- Videos resume playing automatically
- Console shows videos being loaded: `[WasmLoader] Viewport update: +X -Y`

**Expected behavior:**
- All videos reload correctly when scrolling back into view
- Previously loaded videos resume from their loop point
- No "stuck" states

### 6. Test: Rapid Scrolling

**What to do:**
- Rapidly scroll up and down with mouse wheel
- Use Page Down/Page Up keys rapidly
- Drag scrollbar quickly

**What to check:**
- All videos eventually load (within 1-2 seconds of stopping)
- No rows permanently stuck without loading
- Console shows viewport updates throttled to ~10/second

**Expected behavior:**
- During rapid scroll: minimal loading (performance optimization)
- After scroll stops: all visible videos load within 1-2 seconds

### 7. Test: Grid Column Changes

**What to do:**
- Click the grid icon button repeatedly to change column count
- Try: 4 cols → 6 cols → 4 cols → 8 cols → 2 cols

**What to check:**
- Videos rearrange correctly
- All visible videos load after each change
- Console shows: `[WasmLoader] Observing X video items (cleared state)`

**Expected behavior:**
- Grid updates smoothly
- All visible videos reload
- No blank spaces

### 8. Test: Filter/Sort Changes

**What to do:**
- Filter by a subfolder
- Change back to "All folders"
- Click "Sort by Date"
- Click "Sort by Folder"
- Click "Shuffle"

**What to check:**
- After each change, all visible videos load
- Console shows full grid re-render
- No stuck videos

**Expected behavior:**
- Each filter/sort triggers full re-render
- All visible videos reload correctly
- State is properly reset

### 9. Test: Favorites Toggle

**What to do:**
- Favorite 5-10 videos
- Click "Show Favorites Only"
- Scroll through favorites
- Click favorites button again to show all

**What to check:**
- Videos load correctly in both views
- Scrolling works in favorites view
- Switching back to full view reloads correctly

### 10. Test: Error Handling

**What to do:**
- Find a video that fails to load (or temporarily rename a video file)
- Observe the error state
- Click the retry button if it appears

**What to check:**
- Retry button appears after failed retries
- Other videos continue loading normally
- Failed video doesn't block adjacent videos
- Console shows: `Failed to load video after 3 attempts`

## Performance Metrics

### Good Performance Indicators

**Console Output:**
```
[WasmLoader] Viewport update: +6 -4 (19/20 loaded)
[WasmLoader] Viewport update: +3 -2 (20/20 loaded)
```

**Memory Usage:**
- Should stay stable during scrolling
- Check Chrome Task Manager: Video Player Memory should be ~500MB-1GB

**CPU Usage:**
- Should be <20% during normal scrolling
- Brief spikes during rapid scrolling are OK

### Warning Signs

❌ Many videos showing loading spinner forever
❌ Console errors: `WebMediaPlayer limit`
❌ Memory continuously growing
❌ Videos not loading when scrolling back up
❌ Blank videos that never load

## Troubleshooting

### WASM Loader Not Initializing

**Symptom:** Console shows `[Renderer] Using IntersectionObserver-based smart loader`

**Causes:**
1. WASM module failed to load
2. Browser doesn't support WASM
3. CORS issues with WASM file

**Check:**
```javascript
// In browser console
window.VideoGridEngine
// Should return: [class VideoGridEngine]

window.VideoWasmLoader  
// Should return: [class VideoWasmLoader]
```

**Fix:**
- Check console for WASM load errors
- Ensure WASM files are in `app/wasm/` directory
- Try hard refresh (Cmd+Shift+R / Ctrl+Shift+F5)

### Videos Still Not Loading

**If using WASM loader but videos still stuck:**

1. **Check viewport calculation:**
```javascript
// In console
app.wasmLoader.getStats()
// Should show: { loadedVideos, inViewport, ... }
```

2. **Force reload visible videos:**
```javascript
app.wasmLoader.forceReloadVisible()
```

3. **Check WASM engine state:**
```javascript
app.gridEngine.getStats()
```

### Fallback to IntersectionObserver

If WASM loader has issues, the app automatically falls back to the improved IntersectionObserver-based loader:

**Features of fallback:**
- Clears state on re-render (fixes scroll-back issue)
- Better null checking
- Improved cleanup logic
- Still works, just not as reliable as WASM loader

## Advanced Testing

### Test With Developer Tools

1. **Network Throttling:**
   - Chrome DevTools → Network → Throttle to "Fast 3G"
   - Scroll and observe loading behavior
   - Videos should still load, just slower

2. **Memory Profiling:**
   - Chrome DevTools → Memory → Take heap snapshot
   - Scroll through entire collection
   - Take another snapshot
   - Compare: memory growth should be minimal

3. **Performance Recording:**
   - Chrome DevTools → Performance → Record
   - Scroll up and down for 10 seconds
   - Stop recording
   - Check for long tasks or dropped frames

### Stress Testing

**Large Collections:**
- Test with 500+ videos
- Test with 1000+ videos
- Check: Memory stays under 2GB
- Check: All videos eventually load

**Rapid Interactions:**
- Rapidly change grid columns while scrolling
- Rapidly change filters while scrolling
- Check: No crashes or hangs

## Expected Results Summary

✅ All videos load eventually (no permanent blanks)
✅ Scrolling back up reloads videos correctly
✅ No more "every 4th row" or "every 10th row" bugs
✅ Error states are recoverable with retry
✅ Smooth 60fps scrolling
✅ Memory usage stays reasonable
✅ Works with all grid column counts
✅ Works with all filter/sort combinations

## Reporting Issues

If you still encounter loading issues, please provide:

1. **Console logs** (filter by "Wasm" or "Loader")
2. **Steps to reproduce**
3. **Browser and OS version**
4. **Video collection size**
5. **Grid column count when issue occurs**
6. **Output of:** `app.wasmLoader.getStats()`

Copy relevant console output:
```javascript
// In browser console
copy(app.wasmLoader.getStats())
```
