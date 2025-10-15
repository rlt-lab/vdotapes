# Thumbnail Preloader Implementation - Testing Guide

## What Was Implemented

✅ **Thumbnail Pre-Generation System**
- Generates thumbnails 25 rows ahead of scrolling
- Uses first frame (timestamp 0) for instant recognition
- Caches thumbnails for instant display
- Concurrent generation (3 at a time)

✅ **Unload + Thumbnail Strategy**
- Videos unload when far from viewport (src = '')
- Thumbnails remain visible when videos unload
- Smooth CSS transitions between thumbnail ↔ video

✅ **Zone-Based Loading**
- Buffer zone (25 rows): Thumbnails pre-generated
- Near zone (entering viewport): Videos load
- Active zone (in viewport): Videos play
- Far zone (25+ rows away): Videos unload, thumbnails shown

---

## How It Works

### Scroll Flow:

```
1. Scroll down to row 30
   ↓
2. ThumbnailPreloader generates thumbnails for rows 5-55 (25 row buffer)
   ↓
3. Videos in rows 25-35 (near viewport) start loading
   ↓
4. Thumbnail visible while video loads
   ↓
5. Video ready → smooth fade (thumbnail out, video in)
   ↓
6. Scroll past row 55
   ↓
7. Videos before row 30 unload (src = '')
   ↓
8. Cached thumbnails fade in instantly
```

---

## Test It

### Test 1: Pre-Generation

```bash
npm run dev
```

**Steps**:
1. Load a folder with 200+ videos
2. Open browser console
3. Scroll down slowly to row 10
4. Watch console output:
   ```
   [ThumbnailPreloader] Pre-loading thumbnails for rows 0-35 (140 videos)
   [ThumbnailPreloader] Generating 140 new thumbnails
   [ThumbnailPreloader] Generated thumbnail for video.mp4 (245ms)
   ```

**Expected**:
- ✅ Thumbnails generate ahead of your scrolling
- ✅ Videos load with thumbnails already visible
- ✅ Smooth fade from thumbnail to video
- ✅ No "blank" frames

---

### Test 2: Unload Behavior

**Steps**:
1. Scroll to row 30 (120 videos)
2. Open Activity Monitor / Task Manager
3. Note RAM usage
4. Scroll back to row 5
5. Check RAM usage again

**Expected**:
- ✅ RAM stays ~3-4 GB (not 8+ GB)
- ✅ Videos far away have thumbnails (not playing)
- ✅ Scroll back up → thumbnails instantly visible
- ✅ Videos reload smoothly when entering viewport

---

### Test 3: Smooth Transitions

**Steps**:
1. Scroll slowly through videos
2. Watch individual videos as they come into view

**Expected**:
- ✅ Thumbnail visible first
- ✅ Video starts loading (thumbnail still visible)
- ✅ When video ready → smooth 0.5s fade
- ✅ Thumbnail fades out, video fades in
- ✅ No "pop" or flash

---

### Test 4: Memory Efficiency

**Monitor stats in console**:
```javascript
// Check thumbnail preloader stats
app.thumbnailPreloader.logStats();

// Should show:
// {
//   generated: 150,
//   cached: 50,
//   failed: 0,
//   cacheSize: 200,
//   queueSize: 0,
//   avgGenerationTime: '180'  // milliseconds
// }
```

---

## Debug Commands

### Monitor Thumbnail Generation

```javascript
// Real-time monitoring
window.monitorThumbnails = () => {
  setInterval(() => {
    const stats = app.thumbnailPreloader.getStats();
    console.log(
      `Thumbnails - Generated: ${stats.generated}, ` +
      `Cached: ${stats.cacheSize}, ` +
      `Queue: ${stats.queueSize}, ` +
      `Avg time: ${stats.avgGenerationTime}ms`
    );
  }, 3000);
};

window.monitorThumbnails();
```

---

### Check Thumbnail Coverage

```javascript
// See which videos have thumbnails
window.checkThumbnails = () => {
  const total = app.displayedVideos.length;
  const withThumbs = app.displayedVideos.filter(v => 
    app.thumbnailPreloader.hasThumbnail(v.id)
  ).length;
  
  console.log(`Thumbnails: ${withThumbs} / ${total} (${(withThumbs/total*100).toFixed(1)}%)`);
};

window.checkThumbnails();
```

---

### Force Thumbnail Pre-Generation

```javascript
// Manually trigger pre-generation for current viewport
window.pregenThumbnails = async () => {
  const currentRow = Math.floor(window.scrollY / 400);
  await app.thumbnailPreloader.preloadForViewport(
    app.displayedVideos,
    currentRow,
    25,  // buffer rows
    4    // items per row
  );
  console.log('Pre-generation complete!');
};

window.pregenThumbnails();
```

---

## Performance Metrics

### Expected Generation Speed

- **First frame extraction**: 100-300ms per video
- **Concurrent generation**: 3 videos at once
- **Cache hit**: Instant (<1ms)

### Expected Memory Usage

- **Without thumbnails**: 3-4 GB RAM (videos only)
- **With thumbnails**: 3.5-4.5 GB RAM (+500MB for cached thumbnails)
- **Thumbnail file size**: ~50-200 KB each

### Expected Behavior

| Scenario | Old (Pause) | New (Unload+Thumb) |
|----------|-------------|---------------------|
| 100 videos in buffer | 8 GB RAM ❌ | 3-4 GB RAM ✅ |
| Scroll back up | Videos still loaded | Thumbnails instant ✅ |
| Visual smoothness | Instant but memory hog | Smooth fade ✅ |
| Browser limits | Hit at ~75 videos ❌ | Never hit ✅ |

---

## Troubleshooting

### Issue: Thumbnails Not Generating

**Check console for errors**:
```javascript
app.thumbnailPreloader.logStats();
// Look at 'failed' count
```

**Common causes**:
- FFmpeg not available
- Video files corrupt
- Permission issues

**Fix**: Check that thumbnail generator is working:
```javascript
await window.electronAPI.generateThumbnail('/path/to/video.mp4', 0);
```

---

### Issue: Thumbnails Not Showing

**Check if applied**:
```javascript
const element = document.querySelector('.video-item');
const thumb = element.querySelector('.video-thumbnail');
console.log('Thumbnail classes:', thumb.className);
console.log('Background:', thumb.style.backgroundImage);
```

**Should show**:
```
Thumbnail classes: video-thumbnail loaded
Background: url("file:///path/to/thumbnail.jpg")
```

---

### Issue: Slow Thumbnail Generation

**Check generation time**:
```javascript
const stats = app.thumbnailPreloader.getStats();
console.log('Average generation time:', stats.avgGenerationTime, 'ms');
```

**If >500ms**:
- Videos might be high resolution (4K)
- Hard drive might be slow
- FFmpeg might not be hardware accelerated

**Solutions**:
- Reduce concurrent generation: `maxConcurrent: 2`
- Use lower resolution thumbnails (edit Rust generator)
- Check that SSD is being used (not HDD)

---

### Issue: Memory Still High

**Check actual video count**:
```javascript
const videos = document.querySelectorAll('video[src]');
console.log('Videos with src:', videos.length);

// Should be ~30-50, not 100+
```

**If >50 videos have src**:
- Cleanup isn't running
- Check console for "[VirtualGrid] Cleanup" messages
- Manually trigger: `app.virtualGrid.cleanupDistantVideos()`

---

## Success Criteria

✅ **PASS** if:
- Thumbnails generate 25 rows ahead
- Videos load with thumbnails visible
- Smooth fade transitions (no "pop")
- Memory stays <5 GB with 100 video buffer
- Scroll back shows thumbnails instantly
- No browser video element limit hit

❌ **FAIL** if:
- Blank frames when scrolling
- Videos "pop" in without transition
- Memory >6 GB
- Thumbnails don't persist after unload
- Generation errors in console

---

## Performance Comparison

### Before (No Thumbnails)

```
Scroll to row 30:
- Videos load blank → flash when ready
- Scroll back: videos reload (slow)
- Visual: jarring transitions
```

### After (Thumbnail Preloader)

```
Scroll to row 30:
- Thumbnails already visible (instant)
- Videos fade in smoothly over thumbnails
- Scroll back: cached thumbnails show instantly
- Visual: butter smooth
```

---

## Additional Enhancements (Future)

**Possible improvements**:
1. **Adaptive pre-generation**: Generate more ahead for fast scrolling
2. **Lazy generation**: Generate on-demand for slow scrolling
3. **Progressive quality**: Low-res thumb first, high-res later
4. **Persistent cache**: Save thumbnails to disk between sessions
5. **Batch generation**: Generate all thumbs on folder load

---

## Summary

**What you got**:
- ✅ Thumbnails pre-generated 25 rows ahead
- ✅ First frame thumbnails (instant recognition)
- ✅ Smooth fade transitions
- ✅ Memory efficient (unload strategy, not pause)
- ✅ Cached thumbnails for instant display
- ✅ No browser limits

**Test it now** and watch for smooth thumbnail → video transitions! 🎬
