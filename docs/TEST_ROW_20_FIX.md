# Testing: Row 20 Loading Bug Fix

## What Was Fixed

**Problem**: Videos stopped loading after scrolling to row 20

**Root Cause**: Buffer needed 100 video slots but limit was only 50

**Fix**: Increased `maxActiveVideos` from 50 to 100

---

## Quick Test

### Test 1: Verify Fix

1. **Start app**:
   ```bash
   npm run dev
   ```

2. **Open browser console** and run:
   ```javascript
   // Monitor video loading
   window.testRow20Fix = () => {
     let checkCount = 0;
     const interval = setInterval(() => {
       const videos = document.querySelectorAll('.video-item');
       const loaded = document.querySelectorAll('video[src]').length;
       const loading = document.querySelectorAll('.video-item.loading').length;
       
       const currentRow = Math.ceil(window.scrollY / 400);
       
       console.log(`Row ${currentRow}: ${loaded} loaded, ${loading} loading, ${videos.length} total`);
       
       checkCount++;
       if (checkCount > 20) clearInterval(interval);
     }, 2000);
     
     console.log('Monitoring video loading every 2 seconds for 40 seconds...');
     console.log('Scroll down to row 20-30 and watch for issues.');
   };
   
   window.testRow20Fix();
   ```

3. **Scroll down slowly** to row 20, then row 30

4. **Expected results**:
   - ✅ All videos in viewport load successfully
   - ✅ No console warnings about "at limit"
   - ✅ Smooth playback throughout
   - ✅ Videos 80-120 load without issues

5. **Bad results** (if still broken):
   - ❌ Console shows: "Cannot load video: at limit"
   - ❌ Videos stuck loading after row 20
   - ❌ Gaps in video grid

---

### Test 2: Stress Test (Scroll to Row 50)

1. **Load a large collection** (1000+ videos)

2. **Scroll fast to row 50** (200 videos)

3. **Expected**:
   - Videos load as you scroll
   - No permanent gaps
   - Smooth performance

4. **Check console** for:
   ```
   [VirtualGrid] Viewport update: loaded: 95/100
   [VirtualGrid] Cleanup: Unloaded X distant videos
   ```

---

### Test 3: Memory Check

1. **Scroll to row 30** (120 videos)

2. **Open Activity Monitor** (macOS) or Task Manager (Windows)

3. **Expected memory usage**:
   - **RAM**: 3-6 GB (increased from 2-4 GB)
   - **VRAM**: 2-4 GB (increased from 1-3 GB)
   - **CPU**: <30% (with GPU acceleration)
   - **GPU**: 50-80%

**If memory is too high** (>8 GB RAM):
- System might be thrashing
- Consider reducing to `maxActiveVideos: 80`

---

## Debug Commands

### Check Current Configuration

```javascript
// In browser console
window.checkConfig = () => {
  const vg = app.virtualGrid;
  if (vg) {
    console.log('Virtual Grid Config:');
    console.log('  maxActiveVideos:', vg.maxActiveVideos);
    console.log('  bufferRows:', vg.bufferRows);
    console.log('  itemsPerRow:', vg.itemsPerRow);
    console.log('  Buffer capacity:', vg.bufferRows * vg.itemsPerRow, 'videos');
    console.log('  Currently loaded:', vg.loadedVideos.size);
    
    const sufficient = vg.maxActiveVideos >= (vg.bufferRows * vg.itemsPerRow);
    console.log('  Sufficient slots:', sufficient ? '✅' : '❌');
  }
};

window.checkConfig();
```

**Expected output**:
```
Virtual Grid Config:
  maxActiveVideos: 100
  bufferRows: 25
  itemsPerRow: 4
  Buffer capacity: 100 videos
  Currently loaded: 95
  Sufficient slots: ✅
```

---

### Monitor Video State

```javascript
window.monitorVideos = () => {
  setInterval(() => {
    const items = document.querySelectorAll('.video-item');
    const states = {
      loaded: 0,
      loading: 0,
      error: 0,
      idle: 0
    };
    
    items.forEach(item => {
      const video = item.querySelector('video');
      if (!video) return;
      
      if (video.classList.contains('loaded')) states.loaded++;
      else if (item.classList.contains('loading')) states.loading++;
      else if (item.classList.contains('error')) states.error++;
      else states.idle++;
    });
    
    console.table({
      'Total Videos': items.length,
      'Loaded & Playing': states.loaded,
      'Currently Loading': states.loading,
      'Errors': states.error,
      'Idle (Not Started)': states.idle,
      'Scroll Position': `Row ${Math.ceil(window.scrollY / 400)}`
    });
  }, 3000);
};

window.monitorVideos();
```

---

### Force Cleanup Test

```javascript
// Test cleanup mechanism
window.testCleanup = () => {
  console.log('Before cleanup:', app.virtualGrid.loadedVideos.size);
  app.virtualGrid.cleanupDistantVideos();
  console.log('After cleanup:', app.virtualGrid.loadedVideos.size);
};

// Run after scrolling
window.testCleanup();
```

---

## Troubleshooting

### Issue: Still seeing "at limit" warnings

**Cause**: Buffer still too large for slots

**Fix**:
```javascript
// In renderer.js, reduce buffer
bufferRows: 20  // Down from 25
```

Or increase slots more:
```javascript
maxActiveVideos: 120  // Up from 100
```

---

### Issue: Videos load but performance is sluggish

**Cause**: Too many videos for GPU

**Check GPU usage**:
- Should be 50-80%
- If >90%, GPU is maxed out

**Fix**:
```javascript
// Reduce both
maxActiveVideos: 80
bufferRows: 20
```

---

### Issue: High memory usage (>8GB RAM)

**Cause**: Too many videos loaded

**Fix**:
```javascript
// More conservative settings
maxActiveVideos: 60
bufferRows: 15
```

---

## Performance Expectations

### With maxActiveVideos: 100

**Scrolling**:
- ✅ Smooth to row 50+
- ✅ No video gaps
- ✅ Videos always loaded in viewport

**Memory**:
- RAM: 3-6 GB
- VRAM: 2-4 GB

**CPU/GPU** (with hardware acceleration):
- CPU: 15-30%
- GPU: 50-80%

**Good for**:
- Systems with 16GB+ RAM
- Dedicated GPUs
- Large video collections (1000+ videos)

---

### Alternative: maxActiveVideos: 80

If 100 is too much memory:

```javascript
maxActiveVideos: 80
bufferRows: 20
```

**Result**:
- ✅ Still smooth scrolling
- ✅ Lower memory (2-4 GB RAM)
- ⚠️ Slightly less buffer (videos load closer to viewport)

---

## Success Criteria

✅ **PASS** if:
- Videos load smoothly past row 20
- No console warnings about "at limit"
- Smooth scrolling to row 30, 40, 50+
- Memory usage acceptable (<8GB RAM)
- CPU usage <30% with GPU acceleration

❌ **FAIL** if:
- Videos still stuck after row 20
- Console shows "at limit" warnings
- Gaps in video grid
- High CPU usage (>50%)

---

## Verification Checklist

After fix:
- [ ] App starts successfully
- [ ] Load 100+ videos
- [ ] Scroll to row 20 - videos load? ✅
- [ ] Scroll to row 30 - videos load? ✅
- [ ] Scroll to row 50 - videos load? ✅
- [ ] No "at limit" warnings in console
- [ ] Memory usage reasonable (<8GB)
- [ ] CPU usage <30%
- [ ] Smooth playback throughout

**If all checked**: Bug is fixed! ✅

---

## Rollback Plan

If fix causes issues (high memory, crashes):

**Quick rollback**:
```javascript
// In renderer.js
maxActiveVideos: 50  // Back to original
bufferRows: 12       // Reduced to match
```

This keeps smooth scrolling within the 50 video limit.

---

## Summary

**Fix**: `maxActiveVideos: 50 → 100`

**Why**: Buffer needs 100 slots (25 rows × 4 items)

**Cost**: +2-3 GB RAM, +1-2 GB VRAM

**Benefit**: Videos load smoothly past row 20, 30, 50+

**Test now** and report results!
