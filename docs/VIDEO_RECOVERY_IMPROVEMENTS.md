# Video Recovery Mechanism Improvements

## Problem

Videos were occasionally getting stuck and failing to load even when visible in the viewport. This was causing rows of videos to remain blank.

## Root Cause

The recovery mechanism was too slow:
- Checked every **3 seconds** (not frequent enough)
- Considered videos "stuck" after **15 seconds** in loading state (too patient)

With fast scrolling and large buffers, videos could be stuck for a long time before recovery kicked in.

---

## Solution

Made the recovery mechanism more **aggressive**:

### 1. Faster Check Interval
```javascript
// Before
setInterval(() => checkAndRecoverStuckVideos(), 3000);  // Every 3 seconds

// After
setInterval(() => checkAndRecoverStuckVideos(), 2000);  // Every 2 seconds
```

**Impact**: Videos are checked 50% more frequently (every 2s instead of 3s)

---

### 2. Shorter Stuck Timeout
```javascript
// Before
const isStuckInLoading = (now - loadingStartTime) > 15000;  // 15 seconds

// After  
const isStuckInLoading = (now - loadingStartTime) > 10000;  // 10 seconds
```

**Impact**: Videos are recovered 33% faster (after 10s instead of 15s)

---

## How The Recovery Mechanism Works

### Detection Phase (Every 2 Seconds)

The recovery mechanism scans all video items and detects two types of stuck videos:

#### Type 1: No Source Loaded
```javascript
const isStuckNoSource = 
  !isLoaded &&          // Not marked as loaded
  !isLoading &&         // Not currently loading
  !isError &&           // Not in error state
  !hasSrc &&            // Video element has no src
  hasDataSrc &&         // But has data-src (should load)
  isInViewport(item);   // And is visible in viewport
```

**What this catches**: Videos that should be loading but never started

---

#### Type 2: Stuck In Loading State
```javascript
const isStuckInLoading = 
  isLoading &&                              // Currently marked as loading
  loadingStartTime > 0 &&                   // Has a start time
  (now - loadingStartTime) > 10000 &&       // Been loading for >10 seconds
  isInViewport(item);                       // And is visible in viewport
```

**What this catches**: Videos that started loading but got stuck (network issue, decode error, etc.)

---

### Recovery Phase

When a stuck video is detected:

1. **Clear stuck state**:
   ```javascript
   item.classList.remove('loading');
   item.dataset.loadingStartTime = '';
   videoElement.src = '';  // Clear any partial load
   ```

2. **Force reload**:
   ```javascript
   this.loadVideo(videoElement, item, 0);  // Retry from scratch
   ```

3. **Log for debugging**:
   ```javascript
   console.warn(`[VideoManager] Detected stuck video: ${videoId} (${reason})`);
   console.log(`[VideoManager] Recovered ${recoveredCount} stuck videos`);
   ```

---

## Why This Matters With Large Buffers

With `bufferRows: 25`, we're trying to load **50+ videos simultaneously**. This increases the chance of:
- Network congestion causing timeouts
- Browser resource limits being hit
- Race conditions in loading logic

**More aggressive recovery** ensures stuck videos get fixed quickly before the user notices.

---

## Testing

### Test Scenario 1: Fast Scrolling
1. Load a folder with 100+ videos
2. Scroll down quickly through many rows
3. **Expected**: All videos load within 10 seconds, no blank spots
4. Check console for recovery messages

### Test Scenario 2: Network Slowdown
1. Use browser DevTools to throttle network to "Slow 3G"
2. Scroll through videos
3. **Expected**: Some videos may start loading slowly, but recovery kicks in after 10s
4. Videos should retry and eventually load

### Test Scenario 3: Large Buffer
1. Load videos with `bufferRows: 25` (current setting)
2. Watch console for stuck video detection
3. **Expected**: 
   - `[VideoManager] Detected stuck video: ... (no source)` 
   - `[VideoManager] Recovered X stuck videos`
   - Videos load within 10 seconds of being in viewport

---

## Console Debugging

### Good Output (Normal Operation)
```
✅ Virtual grid initialized successfully!
[VirtualGrid] Viewport update: 10 operations, visible range: 0-25, loaded: 45/50
[VirtualGrid] Viewport update: 5 operations, visible range: 5-30, loaded: 48/50
```

### Recovery Happening (Videos Got Stuck)
```
⚠️ [VideoManager] Detected stuck video: video-123 (no source)
⚠️ [VideoManager] Detected stuck video: video-456 (stuck in loading for 11s)
✅ [VideoManager] Recovered 2 stuck videos
```

### Manual Recovery Test
```javascript
// In browser console, manually trigger recovery
window.app.videoManager.checkAndRecoverStuckVideos();
// Should see recovery messages if any videos are stuck
```

---

## Configuration

### Current Settings (Aggressive)
```javascript
// In VideoManager.js
checkInterval: 2000ms      // Check every 2 seconds
stuckTimeout: 10000ms      // Consider stuck after 10 seconds
```

### If You Need Even More Aggressive Recovery
```javascript
// Reduce check interval to 1 second
this.recoveryCheckInterval = setInterval(() => {
  this.checkAndRecoverStuckVideos();
}, 1000);

// Reduce stuck timeout to 5 seconds  
const isStuckInLoading = (now - loadingStartTime) > 5000;
```

**⚠️ Warning**: Going more aggressive may cause false positives on slow networks.

---

## Related Files

- `app/modules/VideoManager.js` - Recovery mechanism implementation (MODIFIED)
- `app/renderer.js` - Buffer configuration (MODIFIED)
- `app/video-virtual-grid.js` - Video loading logic (unchanged)

---

## Summary

✅ **Check interval**: 3s → 2s (50% faster)  
✅ **Stuck timeout**: 15s → 10s (33% faster recovery)  
✅ **Detection**: Two-phase (no source + stuck loading)  
✅ **Viewport-aware**: Only recovers visible videos  
✅ **Automatic**: Runs every 2 seconds in background  

**Result**: Videos that fail to load are automatically detected and recovered within 10-12 seconds! 🚀

---

## Performance Impact

**Minimal**:
- Recovery check only runs on visible videos (fast DOM query)
- Only triggers reload when videos are actually stuck
- Interval of 2s means ~30 checks per minute (negligible CPU)

**Benefits**:
- No more blank rows of videos
- Automatic recovery without user intervention
- Better UX with large buffers and fast scrolling
