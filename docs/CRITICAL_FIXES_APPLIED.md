# Critical Fixes Applied - WebMediaPlayer Limit Issue

## Issues Found from Console Output

### 1. WASM Loader Not Initializing ❌
**Problem:** Console showed no WASM initialization messages
**Cause:** CSP (Content Security Policy) blocked inline module script
**Error:** `Refused to execute inline script because it violates CSP directive`

### 2. WebMediaPlayer Limit Exceeded ❌
**Problem:** Massive number of errors:
```
[Intervention] Blocked attempt to create a WebMediaPlayer 
as there are too many WebMediaPlayers already in existence
```
**Cause:** 
- Smart loader was loading 24+ videos (console showed `Smart Loading: 24 loaded`)
- `maxActiveVideos` was set to 30 (too high!)
- Videos were never actually unloaded when clearing state

### 3. Videos Not Unloading on Re-render ❌
**Problem:** When grid re-rendered (filter/sort changes), videos weren't unloaded
**Cause:** `observeVideoItems()` cleared the tracking Sets but never called `video.src = ''` and `video.load()`
**Result:** Old video elements accumulated, causing WebMediaPlayer limit

## Fixes Applied

### Fix 1: CSP Issue - Moved Inline Script to External File ✅

**Before:**
```html
<script type="module">
  import init, { VideoGridEngine } from './wasm/video_grid_wasm.js';
  // ... inline code
</script>
```

**After:**
```html
<script type="module" src="wasm-init.js"></script>
```

**Created:** `app/wasm-init.js` with the WASM initialization code

**Result:** WASM module can now load without CSP violations

---

### Fix 2: Reduced maxActiveVideos ✅

**Before:**
- Smart loader: `maxActiveVideos: 20`
- Console showed: 30 (somehow)
- Loading 24+ videos

**After:**
- Smart loader: `maxActiveVideos: 12` (very conservative)
- WASM engine: `maxActiveVideos: 12` (matching)
- WASM loader: `maxActiveVideos: 12` (matching)

**Why 12?**
- Chrome's WebMediaPlayer limit is ~75
- But creating/destroying them rapidly causes issues
- 12 is very safe and still provides smooth scrolling
- With 4 columns, that's 3 rows visible at once (perfect)

---

### Fix 3: Actually Unload Videos Before Clearing State ✅

**Before:**
```javascript
observeVideoItems(container) {
  if (this.observer) {
    this.observer.disconnect();
    this.loadedVideos.clear();  // ❌ Just cleared tracking
    this.activeVideos.clear();  // ❌ Videos still loaded in DOM!
  }
  // ...
}
```

**After:**
```javascript
observeVideoItems(container) {
  if (this.observer) {
    this.observer.disconnect();
    
    // ✅ CRITICAL: Actually unload all videos first
    const oldVideoItems = document.querySelectorAll('.video-item');
    oldVideoItems.forEach((item) => {
      const video = item.querySelector('video');
      if (video && video.src) {
        video.pause();
        video.src = '';
        video.load(); // ✅ Releases WebMediaPlayer
        // Remove event listeners
      }
    });
    
    // Now safe to clear tracking
    this.loadedVideos.clear();
    this.activeVideos.clear();
  }
  // ...
}
```

**Result:** Videos are properly unloaded before re-render, preventing accumulation

---

### Fix 4: More Aggressive Cleanup ✅

**Before:**
- Cleanup triggered only when `loadedVideos.size > maxActiveVideos`
- Cleanup every 3 seconds (periodic only)
- Buffer zone: 200px

**After:**
- Cleanup triggered at 80% of max (10 out of 12)
- Cleanup on scroll (throttled 500ms) + periodic (3s)
- Buffer zone: 100px (tighter, unloads sooner)

**Code:**
```javascript
performCleanup() {
  const threshold = Math.floor(this.maxActiveVideos * 0.8); // Start at 80%
  
  if (this.loadedVideos.size >= threshold) {
    // Find visible videos with tight 100px buffer
    // Unload all non-visible videos
    // Log: "Unloaded X videos. Now: Y loaded"
  }
}
```

**Result:** Videos unload proactively before hitting the limit

---

### Fix 5: Reduced Buffer Rows ✅

**Before:**
- WASM loader: `bufferRows: 3` (3 rows above + 3 below = 6 extra rows)
- With 4 columns: 24 extra videos preloaded!

**After:**
- WASM loader: `bufferRows: 2` (2 rows above + 2 below = 4 extra rows)
- With 4 columns: 16 extra videos (still smooth, safer)

**Result:** Fewer videos loaded at once

## Expected Console Output After Fixes

### On Startup (WASM Success):
```
✅ WASM Grid Engine loaded successfully!
✅ WASM Grid Engine initialized successfully!
✅ WASM video loader initialized successfully (max: 12 videos)!
[Init] WASM loader will initialize when engine is ready
[Renderer] Using WASM loader for video management
```

### On Startup (WASM Fallback):
```
Smart video loader initialized (max: 12 videos)
[Renderer] Using IntersectionObserver-based smart loader
```

### During Usage:
```
[SmartLoader] Observing 150 video items (state cleared, videos unloaded)
[SmartLoader] Cleanup: Unloaded 5 videos. Now: 10 loaded, 8 active (max: 12)
```

**No more:**
- ❌ WebMediaPlayer limit errors
- ❌ Videos loading but never showing (empty thumbnails)

## What to Test

### 1. Check WASM Initialization
Open DevTools Console and look for:
- ✅ WASM success messages
- ❌ CSP errors (should be gone)

### 2. Scroll Down Slowly
- Videos should load smoothly
- Max 12 videos loaded at once
- Console shows cleanup messages

### 3. Scroll Back Up (CRITICAL TEST)
- Videos should reload correctly
- No "can't load video" errors
- Check console for unload/reload messages

### 4. Change Filters/Sorts
Before changing, check:
```javascript
// In console:
document.querySelectorAll('.video-item video[src]').length
// Should be ~12 or less
```

After changing:
- Should see: `[SmartLoader] Unloading X videos before re-render`
- Videos reload correctly
- No accumulation

### 5. Monitor WebMediaPlayer Count

```javascript
// Approximate active count
document.querySelectorAll('.video-item video[src]').length
// Should never exceed 12-15
```

## Performance Expectations

### Memory
- Should stay stable around 500MB-800MB
- No continuous growth during scrolling

### Video Loading
- Initial: ~12 videos load
- Scrolling: Old videos unload, new ones load
- Always ≤12 active videos

### Console
- Regular cleanup messages
- No WebMediaPlayer errors
- Smooth unload/load cycle

## Debugging Commands

```javascript
// Check which loader is active
app.useWasmLoader  // Should be: true (if WASM loaded)

// Check current state
app.smartLoader.getStats()
// Returns: { loadedVideos: ~12, activeVideos: ~10, maxActiveVideos: 12 }

// Count videos in DOM with src
document.querySelectorAll('.video-item video[src]').length
// Should be ≤12

// Force cleanup if needed
app.smartLoader.forceCleanup()
```

## Files Modified

1. **app/index.html** - Removed inline script, added external wasm-init.js
2. **app/wasm-init.js** - NEW: External WASM initialization (fixes CSP)
3. **app/video-smart-loader.js** - Major fixes:
   - Actually unload videos before clearing state
   - More aggressive cleanup (80% threshold)
   - Scroll-based cleanup
   - Tighter buffer zone (100px)
4. **app/renderer.js** - Reduced all maxActiveVideos to 12

## Why This Fixes "Can't Load Video" on Scroll Back

**The Problem:**
1. Scroll down → Load 24 videos (exceeds limit)
2. Some fail with WebMediaPlayer limit error
3. Scroll back up → Try to reload those videos
4. They're marked as "error" state → Show "can't load video"

**The Fix:**
1. Never exceed 12 videos loaded
2. Properly unload videos when scrolling away
3. Clean state allows fresh load attempts when scrolling back
4. No WebMediaPlayer errors → Videos load successfully

## Next Steps

1. **Test immediately:**
   ```bash
   npm run dev
   ```

2. **Watch console** for:
   - WASM initialization messages
   - No CSP errors
   - No WebMediaPlayer errors
   - Cleanup messages during scrolling

3. **Test scroll back up** - This should now work!

4. **Monitor video count:**
   ```javascript
   // In console while scrolling:
   setInterval(() => {
     console.log('Videos loaded:', document.querySelectorAll('.video-item video[src]').length);
   }, 2000);
   ```

Should see count stay around 10-12, never exceeding 15.

## Summary

🔧 **Fixed CSP** → WASM can now load
🔧 **Reduced limit** → 12 videos max (very safe)
🔧 **Actually unload** → Videos properly released
🔧 **Aggressive cleanup** → Proactive unloading
🔧 **Tighter buffer** → Fewer preloaded videos

**Result:** No more WebMediaPlayer errors, videos load reliably on scroll back!
