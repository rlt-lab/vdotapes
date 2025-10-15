# Testing the Video Recovery Mechanism

**Quick Start Guide**

---

## What Was Fixed

Added automatic recovery for videos that fail to load when scrolling. The app now:

1. **Checks every 3 seconds** for stuck videos in viewport
2. **Detects two types of failures**:
   - Videos with no source loaded
   - Videos stuck in "loading" state for >15 seconds
3. **Automatically retries** failed videos
4. **Logs debug info** to console for troubleshooting

---

## How to Test

### 1. Start the App

```bash
npm run dev
```

### 2. Load Videos and Scroll

1. Click "Select Video Folder"
2. Choose a folder with 50+ videos
3. **Scroll down rapidly** through the grid
4. Keep scrolling past ~100-150 videos

### 3. Watch the Console

**What you'll see**:

**If videos get stuck (OLD BEHAVIOR)**:
```
(No console output, videos just don't load)
```

**With recovery (NEW BEHAVIOR)**:
```
⚠ [VideoManager] Detected stuck video: video_123 (no source)
ℹ [VideoManager] Recovering stuck video: video_123
✓ [VideoManager] Recovered 3 stuck videos: [...]
```

**Success indicators**:
- Videos that were empty/stuck suddenly load and start playing
- Console shows recovery messages
- After 3-5 seconds, all visible videos are playing

---

## Manual Recovery Test

**In browser DevTools console**:

```javascript
// Force a recovery check right now
window.debugRecoverVideos()

// Should output:
// "[VideoManager] Recovered X stuck videos: [...]"
// or nothing if all videos are fine
```

---

## Debug Commands

### Check Video States

```javascript
// Count videos by state
{
  total: document.querySelectorAll('.video-item').length,
  loaded: document.querySelectorAll('.video-item video.loaded').length,
  loading: document.querySelectorAll('.video-item.loading').length,
  error: document.querySelectorAll('.video-item.error').length,
  noSource: document.querySelectorAll('.video-item video:not([src])').length,
  inViewport: Array.from(document.querySelectorAll('.video-item')).filter(item => {
    const rect = item.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
  }).length
}
```

### Find Stuck Videos

```javascript
// Find videos in viewport without source
Array.from(document.querySelectorAll('.video-item')).filter(item => {
  const rect = item.getBoundingClientRect();
  const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
  const video = item.querySelector('video');
  const hasSource = video && video.src;
  return isVisible && !hasSource;
}).map(item => item.dataset.videoId)
```

### Monitor Recovery Live

```javascript
// Watch for stuck videos every second
const monitor = setInterval(() => {
  const stuck = Array.from(document.querySelectorAll('.video-item'))
    .filter(item => {
      const rect = item.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
      const video = item.querySelector('video');
      const hasSource = video && video.src;
      const isLoaded = video && video.classList.contains('loaded');
      return isVisible && !hasSource && !isLoaded;
    });
  
  if (stuck.length > 0) {
    console.log(`🔴 Found ${stuck.length} stuck videos in viewport`);
  } else {
    console.log(`✅ All visible videos OK`);
  }
}, 1000);

// Stop monitoring
clearInterval(monitor);
```

---

## Expected Results

### Before Fix ❌
- Scroll down past 50-100 videos
- Random row fails to load
- Videos stay empty/stuck
- No recovery, user must refresh page

### After Fix ✅
- Scroll down past 50-100 videos
- If videos get stuck, recovery detects them within 3 seconds
- Console shows: "Recovered X stuck videos"
- Videos load and start playing automatically
- No user action needed

---

## Troubleshooting

### "Not seeing any recovery messages"

**Good news!** This means videos are loading correctly and recovery isn't needed.

To test recovery is working:
```javascript
// Manually break a video
const item = document.querySelector('.video-item');
const video = item.querySelector('video');
video.src = '';
video.classList.remove('loaded');
item.classList.remove('loading');

// Wait 3-5 seconds, should see:
// "Detected stuck video" in console
```

### "Recovery messages but videos still not loading"

Check if video files are actually playable:
```javascript
// Test video file
const video = document.createElement('video');
video.src = app.allVideos[0].path;
video.onloadedmetadata = () => console.log('✅ Video file OK');
video.onerror = (e) => console.error('❌ Video file failed:', e);
```

### "Too many recovery attempts"

If you see recovery running constantly:
1. Check console for specific error patterns
2. Increase check interval in VideoManager (default: 3s → 5s)
3. Increase loading timeout (default: 15s → 20s)

---

## What to Report

### If It Works ✅
```
✅ Scrolled through 150 videos
✅ Saw 3 stuck videos at video #85-90
✅ Console showed: "Recovered 3 stuck videos"
✅ Videos loaded within 3 seconds
✅ No more stuck videos after that
```

### If It Doesn't Work ❌
```
❌ Scrolled through 150 videos
❌ Saw stuck videos at video #85-90
❌ Console showed: [paste console output]
❌ Videos still stuck after 10 seconds
❌ Running debugRecoverVideos() shows: [paste output]
```

**Include**:
1. Console output (first 50 lines)
2. Output of `window.debugRecoverVideos()`
3. Output of the "Check Video States" command above
4. Number of videos in library
5. At what scroll position videos got stuck

---

## Key Features

✅ **Automatic** - Runs every 3 seconds, no user action needed  
✅ **Smart** - Only checks visible videos for performance  
✅ **Two detection modes** - Catches different failure types  
✅ **Debug logging** - Clear console output  
✅ **Manual trigger** - `window.debugRecoverVideos()` for testing  
✅ **Clean shutdown** - Stops when app closes  

---

## Files Changed

- `app/modules/VideoManager.js` - Added recovery mechanism
- `app/renderer.js` - Exposed debug function
- `docs/VIDEO_RECOVERY_MECHANISM.md` - Full documentation

---

## Next Steps

1. **Test with your video library**
2. **Scroll rapidly to trigger the issue**
3. **Watch console for recovery messages**
4. **Report back** - Did it fix the stuck videos?

**The recovery should catch and fix stuck videos automatically within 3 seconds!** 🎉
