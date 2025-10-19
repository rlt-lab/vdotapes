# Bug Fix: False "Stuck Video" Detection After Scroll-Back

**Issue:** Videos showing as "stuck in loading for 61s" after scrolling back up, triggering unnecessary recovery attempts.

**Date:** 2024-10-19

---

## Problem

When scrolling back up after videos were unloaded, the recovery mechanism was detecting them as "stuck" even though they were actually loading normally:

```
[VideoManager] Detected stuck video: ek91xj (stuck in loading for 61s)
[VideoManager] Recovering stuck video: ek91xj
```

This happened for 4+ videos simultaneously after every scroll-back.

## Root Cause

**Stale loading timestamps not being cleared on unload**

Flow of the bug:
1. User scrolls down → videos load normally
2. `loadingStartTime` is set when video starts loading
3. Videos scroll out of view → SmartLoader unloads them (clears `src`, removes classes)
4. **BUT:** `loadingStartTime` dataset attribute was NOT cleared
5. User scrolls back up → IntersectionObserver triggers reload
6. Recovery mechanism sees old timestamp (now 60+ seconds old)
7. Thinks video is stuck → triggers false recovery

## Solution

Clear `loadingStartTime` in all video unload paths:

### 1. SmartLoader Cleanup (`app/video-smart-loader.js`)

**Location:** `performCleanup()` method

```javascript
// When unloading videos beyond buffer zone
this.loadedVideos.delete(videoId);
this.activeVideos.delete(videoId);
item.classList.remove('loading');
video?.classList.remove('loaded');

// ADDED: Clear loading timestamp to prevent false "stuck" detection
item.dataset.loadingStartTime = '';
```

### 2. SmartLoader Re-render (`app/video-smart-loader.js`)

**Location:** `observeVideoItems()` method

```javascript
// When clearing all videos before re-render
item.classList.remove('loading');
video.classList.remove('loaded');

// ADDED: Clear loading timestamp to prevent false "stuck" detection
item.dataset.loadingStartTime = '';
```

### 3. VideoManager Unload (`app/modules/VideoManager.js`)

**Location:** `unloadVideoById()` method

```javascript
// When manually unloading a video
item.classList.remove('loading');
videoElement.classList.remove('loaded');

// ADDED: Clear loading timestamp to prevent false "stuck" detection
item.dataset.loadingStartTime = '';
```

## Testing

### Before Fix
```
Scroll down → Scroll back up
Result:
- 4+ "stuck video" detections
- Unnecessary recovery attempts
- Console spam with recovery logs
- Videos reloading even though they're loading fine
```

### After Fix
```
Scroll down → Scroll back up
Result:
- No false "stuck" detections
- Videos load normally via IntersectionObserver
- Recovery mechanism only triggers for actually stuck videos
- Clean console logs
```

## Impact

**Positive:**
- ✅ No more false positives from recovery mechanism
- ✅ Smoother video loading on scroll-back
- ✅ Less CPU usage (no unnecessary recovery attempts)
- ✅ Cleaner console logs

**Risk:**
- 🟢 Very low - only adds timestamp cleanup
- 🟢 Recovery mechanism still works for actually stuck videos
- 🟢 All unload paths now consistent

## Related Components

**Recovery Mechanism** (`VideoManager.js`)
- Checks every 2 seconds for stuck videos
- Detects videos loading for >15 seconds
- Triggers reload if stuck
- **Now working correctly** - no false positives

**SmartLoader Cleanup** (`video-smart-loader.js`)
- Unloads videos beyond 2500px buffer
- Frees WebMediaPlayer instances
- **Now properly clears all state** including timestamps

**Unload Buffer** (recent optimization)
- 500px load buffer, 2500px unload buffer
- Prevents blank thumbnails on scroll-back
- **Complements this fix** - videos stay loaded longer, fewer unload/reload cycles

## Timeline

1. **2024-10-19 20:00** - Implemented two-tier buffer system
2. **2024-10-19 21:30** - User reports stuck video recovery spam
3. **2024-10-19 21:45** - Identified stale timestamp issue
4. **2024-10-19 22:00** - Fixed all unload paths
5. **2024-10-19 22:15** - Build and test

## Prevention

To prevent similar issues in the future:

1. **When adding new unload logic:** Always clear ALL state attributes, not just classes
2. **When adding new state tracking:** Document what needs cleanup
3. **When seeing "stuck" videos:** Check if timestamps are being cleared on unload

## Code Checklist for Unloading Videos

When unloading a video, always do:

```javascript
// 1. Stop playback
video.pause();
video.src = '';
video.load(); // Release WebMediaPlayer

// 2. Remove event listeners
if (video._loopHandler) {
  video.removeEventListener('timeupdate', video._loopHandler);
  video._loopHandler = null;
}

// 3. Clear CSS classes
item.classList.remove('loading');
video.classList.remove('loaded');

// 4. Clear dataset attributes (CRITICAL!)
item.dataset.loadingStartTime = '';  // ← Often forgotten!

// 5. Update tracking sets
this.loadedVideos.delete(videoId);
this.activeVideos.delete(videoId);
```

## Files Changed

- `app/video-smart-loader.js` - Added timestamp clearing (2 locations)
- `app/modules/VideoManager.js` - Added timestamp clearing (1 location)

Total changes: **3 lines added** across 2 files

## Status

✅ **Fixed and Tested**

---

*This fix complements the two-tier buffer optimization and completes the smooth scrolling experience improvements.*
