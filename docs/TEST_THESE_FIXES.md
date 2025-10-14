# Test These Critical Fixes

## What Was Broken

From your console output, I found **three critical bugs**:

1. ❌ **WASM loader never initialized** (CSP error blocked inline script)
2. ❌ **WebMediaPlayer limit exceeded** (24+ videos loaded, limit is ~75)
3. ❌ **Videos never unloaded on re-render** (accumulated video players)

**Result:** Scrolling back up showed "can't load video" because WebMediaPlayer limit was exceeded.

## What I Fixed

### 1. CSP Error (WASM Couldn't Load)
- Moved inline `<script type="module">` to external file `wasm-init.js`
- WASM module can now load without Content Security Policy violations

### 2. WebMediaPlayer Limit
- **Reduced maxActiveVideos from 20 to 12** (very conservative)
- 12 is safe, provides smooth scrolling, won't hit Chrome's ~75 limit

### 3. Videos Actually Unload Now
- Before: Clearing tracking Sets but never calling `video.src = ''`
- After: Properly unload videos before clearing state
- Critical: Call `video.load()` to release WebMediaPlayer

### 4. More Aggressive Cleanup
- Cleanup at 80% of max (10 out of 12) instead of waiting until exceeded
- Cleanup on every scroll (throttled) + periodic
- Tighter buffer zone (100px instead of 200px)

## How to Test

### Step 1: Start the App

```bash
npm run dev
```

### Step 2: Check Console (CRITICAL!)

**Look for these messages:**

✅ **Good (WASM Loaded):**
```
✅ WASM Grid Engine loaded successfully!
✅ WASM Grid Engine initialized successfully!
✅ WASM video loader initialized successfully (max: 12 videos)!
[Renderer] Using WASM loader for video management
```

✅ **OK (WASM Fallback):**
```
Smart video loader initialized (max: 12 videos)
[Renderer] Using IntersectionObserver-based smart loader
```

❌ **Bad (Still CSP Error):**
```
Refused to execute inline script because it violates CSP...
```
If you see this, the fix didn't apply. Make sure `npm run build:renderer` ran successfully.

### Step 3: Load Videos

- Select a folder with 50+ videos
- Wait for scan to complete

**Check console:**
```
[SmartLoader] Observing 150 video items (state cleared, videos unloaded)
```

### Step 4: Monitor Video Count

Open browser console and run:

```javascript
// Monitor in real-time
setInterval(() => {
  const count = document.querySelectorAll('.video-item video[src]').length;
  console.log('Videos loaded:', count);
}, 2000);
```

**Expected:** Count should stay between 8-12, never exceed 15

**Or use the monitoring script:**
1. Copy contents of `monitor-videos.js`
2. Paste into browser console
3. It will auto-log every 2 seconds

### Step 5: Scroll Down

Scroll slowly through your collection.

**Watch for:**
- ✅ Videos load smoothly as you scroll
- ✅ Video count stays ~10-12
- ✅ Console shows: `[SmartLoader] Cleanup: Unloaded X videos...`
- ❌ NO "WebMediaPlayer" errors

**If you see WebMediaPlayer errors:**
- The fix didn't work
- Check: Is maxActiveVideos actually 12?
  ```javascript
  app.smartLoader.maxActiveVideos  // Should be: 12
  ```

### Step 6: Scroll Back Up (THE CRITICAL TEST!)

**This was the main issue!**

1. Scroll all the way to the bottom
2. Wait 2 seconds
3. Scroll back to the top

**Expected:**
- ✅ Videos reload as you scroll back up
- ✅ All videos show (no blank/error thumbnails)
- ✅ Console shows videos loading
- ❌ NO "can't load video" errors

**If videos still don't load:**

Check console for errors, then try:
```javascript
// Force cleanup
app.smartLoader.forceCleanup()

// Check state
app.smartLoader.getStats()
// Should show: loadedVideos < 12

// Force reload visible
if (app.wasmLoader) {
  app.wasmLoader.forceReloadVisible()
}
```

### Step 7: Change Filters/Sorts

1. Before changing, check video count:
   ```javascript
   document.querySelectorAll('.video-item video[src]').length
   ```

2. Change a filter or sort mode

3. **Watch console for:**
   ```
   [SmartLoader] Unloading X videos before re-render
   [SmartLoader] Observing Y video items (state cleared, videos unloaded)
   ```

4. After change, check video count again - should be fresh ~10-12

**Expected:**
- Old videos properly unloaded
- New videos load correctly
- No accumulation

### Step 8: Rapid Scrolling

1. Rapidly scroll up and down with mouse wheel
2. Use Page Up/Page Down rapidly
3. Drag scrollbar quickly

**Expected:**
- No crashes
- Video count stays ≤12
- Brief loading spinners are OK
- All videos eventually load after stopping

## Quick Diagnostic Commands

### Check Active Loader
```javascript
app.useWasmLoader  // true = WASM, false = Smart loader fallback
```

### Check Video Count
```javascript
// In DOM
document.querySelectorAll('.video-item video[src]').length

// In loader tracking
app.smartLoader.getStats().loadedVideos
// Or for WASM:
app.wasmLoader.getStats().loadedVideos
```

### Check for Errors
```javascript
// Count error videos
document.querySelectorAll('.video-item.error').length
// Should be: 0 (unless you have corrupt files)
```

### Force Actions
```javascript
// Force cleanup (unload distant videos)
app.smartLoader.forceCleanup()

// Force reload visible (if using WASM)
app.wasmLoader?.forceReloadVisible()
```

## Success Criteria

✅ **All of these must be true:**

1. No CSP errors in console
2. WASM loader initializes (or smart loader as fallback)
3. Console shows `max: 12 videos`
4. Video count never exceeds 15
5. **NO WebMediaPlayer errors**
6. **Videos reload when scrolling back up** ⭐ MOST IMPORTANT
7. Smooth scrolling performance
8. Memory stays stable

## If Still Broken

### Issue: Videos Still Don't Load on Scroll Back

**Check 1: Are videos actually being unloaded?**
```javascript
// Scroll down, then check:
const loadedBefore = document.querySelectorAll('.video-item video[src]').length;

// Scroll up and check again:
const loadedAfter = document.querySelectorAll('.video-item video[src]').length;

console.log('Before:', loadedBefore, 'After:', loadedAfter);
// They should be different if unloading works
```

**Check 2: Is cleanup happening?**
```javascript
// Look for these in console:
[SmartLoader] Cleanup: Unloaded X videos...
```

If not appearing, cleanup isn't running.

**Check 3: Are videos hitting errors?**
```javascript
// Look for error state:
document.querySelectorAll('.video-item.error').length
```

### Issue: Still Getting WebMediaPlayer Errors

**This means too many videos are loading.**

**Check:**
```javascript
app.smartLoader.maxActiveVideos  // Must be: 12
```

**If it's not 12:**
```javascript
// Force it:
app.smartLoader.maxActiveVideos = 12;
app.smartLoader.forceCleanup();
```

**Count all video elements:**
```javascript
// Total video elements in DOM (whether loaded or not)
document.querySelectorAll('.video-item video').length

// Total with src attribute (actually loaded)
document.querySelectorAll('.video-item video[src]').length
```

If the second number is > 15, the cleanup isn't working.

### Issue: CSP Error Still Appears

**This means the build didn't work.**

**Re-run:**
```bash
npm run build:renderer
```

**Check the file exists:**
```bash
ls -la app/wasm-init.js
```

**Check index.html has the change:**
```bash
grep "wasm-init.js" app/index.html
```

Should show:
```html
<script type="module" src="wasm-init.js"></script>
```

## Files Changed

If you need to verify the changes:

1. **app/wasm-init.js** - NEW file (fixes CSP)
2. **app/index.html** - Changed line 216-217 (external script)
3. **app/video-smart-loader.js** - Major changes:
   - Line ~65: Actually unload videos before clearing
   - Line ~202: Scroll-based cleanup
   - Line ~216: More aggressive cleanup (80% threshold)
4. **app/renderer.js** - Changed maxActiveVideos to 12 in 3 places

## Debug Output Examples

### Good Output (Working):
```
✅ WASM Grid Engine loaded successfully!
Smart video loader initialized (max: 12 videos)
[SmartLoader] Observing 150 video items (state cleared, videos unloaded)
[SmartLoader] Cleanup: Unloaded 3 videos. Now: 10 loaded, 8 active (max: 12)
```

### Bad Output (Not Working):
```
[Intervention] Blocked attempt to create a WebMediaPlayer...
Smart Loading: 24 loaded, 12/30 active
```

## Contact

If these fixes don't work, please provide:

1. Full console output (copy/paste)
2. Output of:
   ```javascript
   {
     loader: app.useWasmLoader ? 'WASM' : 'Smart',
     maxActive: app.smartLoader.maxActiveVideos,
     stats: app.smartLoader.getStats(),
     domCount: document.querySelectorAll('.video-item video[src]').length
   }
   ```
3. What specifically still fails (scroll back up? WebMediaPlayer errors?)

Good luck! The fixes should solve all three issues. 🚀
