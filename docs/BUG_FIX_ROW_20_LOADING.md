# Bug Fix: Videos Not Loading After Row 20

## The Problem

**Symptom**: After scrolling to ~row 20 (80 videos with 4 per row), videos stop loading completely and never recover.

**Root Cause**: **Buffer/Limit Mismatch**

```javascript
maxActiveVideos: 50     // Can only load 50 videos max
bufferRows: 25          // Tries to keep 25 rows in buffer
itemsPerRow: 4          // 4 videos per row

Buffer needs: 25 rows × 4 items = 100 videos
Available slots: 50 videos
MISMATCH: Need 100, only have 50! ❌
```

---

## Why It Fails

### Normal Scrolling Flow:

1. **Rows 1-12** (48 videos):
   - All load successfully ✅
   - Under the 50 video limit

2. **Row 13** (52 videos):
   - Hit the 50 video limit ⚠️
   - Videos 51-52 can't load (no slots available)

3. **Row 20** (80 videos):
   - System tries to load 25 rows ahead and behind
   - Needs 100 video slots
   - Only has 50 slots
   - Cleanup should unload old videos and load new ones
   - **But cleanup logic can't keep up!** ❌

### The Failure Mode:

```
1. Scroll to row 20
2. WASM engine says: "Load videos 60-100"
3. Virtual grid checks: loadedVideos.size (50) < maxActiveVideos (50)
4. Returns: FALSE - can't load (at limit)
5. Videos never load
6. Cleanup runs but doesn't free enough slots fast enough
7. System is stuck ❌
```

---

## The Fix

### Option 1: Increase maxActiveVideos (Recommended)

**Match the buffer needs**:
```javascript
bufferRows: 25
itemsPerRow: 4
Required videos: 25 × 4 = 100 videos

maxActiveVideos: 100  // Match buffer needs ✅
```

**Pros**:
- ✅ Smooth scrolling (no reloading)
- ✅ Buffer works as intended
- ✅ No video gaps

**Cons**:
- ⚠️ Higher memory usage (~3-5 GB RAM, 2-3 GB VRAM)
- ⚠️ More GPU load (but with hardware acceleration, should be fine)

---

### Option 2: Reduce bufferRows (Conservative)

**Match the video limit**:
```javascript
maxActiveVideos: 50
itemsPerRow: 4
Available rows: 50 / 4 = 12.5 rows

bufferRows: 12  // Match available slots ✅
```

**Pros**:
- ✅ Lower memory usage
- ✅ Guaranteed to work within limits

**Cons**:
- ⚠️ Less smooth scrolling (videos load closer to viewport)
- ⚠️ May see loading spinners when scrolling fast

---

### Option 3: Balanced Approach

**Compromise between smoothness and memory**:
```javascript
maxActiveVideos: 80   // Moderate limit
bufferRows: 20        // Still good pre-loading
itemsPerRow: 4        // User's setting
Buffer capacity: 20 × 4 = 80 videos ✅
```

**Pros**:
- ✅ Good scrolling performance
- ✅ Reasonable memory usage
- ✅ Within limits

**Cons**:
- 🤷 Middle ground (not maximum smoothness, not minimum memory)

---

## Implementation

### Fix 1: Increase maxActiveVideos to 100

**File**: `app/renderer.js`

```javascript
// Before
initializeVirtualGrid() {
  this.virtualGrid = new window.VirtualVideoGrid({
    renderer: this,
    wasmEngine: this.gridEngine,
    maxActiveVideos: 50,    // ❌ TOO LOW
    itemHeight: 400,
    itemsPerRow: this.gridCols,
    bufferRows: 25,         // Needs 100 slots
  });
}

// After
initializeVirtualGrid() {
  this.virtualGrid = new window.VirtualVideoGrid({
    renderer: this,
    wasmEngine: this.gridEngine,
    maxActiveVideos: 100,   // ✅ MATCHES BUFFER
    itemHeight: 400,
    itemsPerRow: this.gridCols,
    bufferRows: 25,
  });
}
```

**Also update**:
- `initializeWasmLoader()` - same change
- `setupSmartLoader()` - same change

---

### Fix 2: Add Debug Logging

Add to `app/video-virtual-grid.js`:

```javascript
// In createVideoElement() method, after line 215:
if (this.loadedVideos.size < this.maxActiveVideos) {
  this.loadVideo(videoId, element);
} else {
  console.warn(
    `[VirtualGrid] Cannot load video ${videoId}: ` +
    `at limit (${this.loadedVideos.size}/${this.maxActiveVideos}). ` +
    `Consider increasing maxActiveVideos or reducing bufferRows.`
  );
}
```

This will show when we hit the limit!

---

### Fix 3: Improve Cleanup (Aggressive Unloading)

Update `cleanupDistantVideos()` in `app/video-virtual-grid.js`:

```javascript
cleanupDistantVideos() {
  if (this.loadedVideos.size <= this.maxActiveVideos) {
    return; // Under limit
  }

  const scrollTop = this.scrollContainer === window 
    ? window.pageYOffset || document.documentElement.scrollTop
    : this.scrollContainer.scrollTop;
  
  const viewportHeight = this.scrollContainer === window
    ? window.innerHeight
    : this.scrollContainer.clientHeight;

  // Calculate visible range with buffer
  const bufferZone = this.itemHeight * this.bufferRows;
  const visibleTop = scrollTop - bufferZone;
  const visibleBottom = scrollTop + viewportHeight + bufferZone;

  // Find videos to unload (sorted by distance from viewport)
  const toUnload = [];
  
  this.videoElements.forEach((element, videoId) => {
    if (!this.loadedVideos.has(videoId)) return;
    
    const rect = element.getBoundingClientRect();
    const elementTop = rect.top + scrollTop;
    const elementBottom = elementTop + rect.height;
    const elementMid = (elementTop + elementBottom) / 2;
    const viewportMid = scrollTop + viewportHeight / 2;
    
    // Calculate distance from viewport center
    const distance = Math.abs(elementMid - viewportMid);
    
    // Check if outside visible range
    if (elementBottom < visibleTop || elementTop > visibleBottom) {
      toUnload.push({ videoId, element, distance });
    }
  });

  // Sort by distance (unload furthest first)
  toUnload.sort((a, b) => b.distance - a.distance);

  // Unload enough videos to get back under limit
  const unloadCount = Math.max(
    this.loadedVideos.size - this.maxActiveVideos + 10,  // Unload 10 extra for buffer
    toUnload.length
  );
  
  toUnload.slice(0, unloadCount).forEach(({ videoId, element }) => {
    this.unloadVideo(videoId, element);
  });

  if (toUnload.length > 0) {
    console.log(
      `[VirtualGrid] Cleanup: Unloaded ${Math.min(unloadCount, toUnload.length)} distant videos ` +
      `(${this.loadedVideos.size}/${this.maxActiveVideos} loaded)`
    );
  }
}
```

---

## Testing Plan

### Test 1: Verify Buffer Math

```javascript
// In browser console
const gridCols = 4;  // Your setting
const bufferRows = 25;
const maxActive = 100;  // New setting

const bufferNeeds = bufferRows * gridCols;
console.log(`Buffer needs: ${bufferNeeds} videos`);
console.log(`Available slots: ${maxActive} videos`);
console.log(`Sufficient: ${maxActive >= bufferNeeds ? '✅' : '❌'}`);

// Should output:
// Buffer needs: 100 videos
// Available slots: 100 videos
// Sufficient: ✅
```

---

### Test 2: Scroll to Row 20+

1. Start app
2. Load videos
3. Add debug monitor:
   ```javascript
   window.monitorVideoLoading = () => {
     setInterval(() => {
       const videos = document.querySelectorAll('video');
       const loaded = Array.from(videos).filter(v => v.src && !v.paused).length;
       const loading = document.querySelectorAll('.video-item.loading').length;
       const errors = document.querySelectorAll('.video-item.error').length;
       
       console.log(`Videos: ${loaded} playing, ${loading} loading, ${errors} errors`);
     }, 2000);
   };
   window.monitorVideoLoading();
   ```

4. Scroll to row 30 (120 videos)
5. **Expected**: All videos in viewport load successfully
6. **Check console**: Should NOT see "at limit" warnings

---

### Test 3: Memory Usage

With `maxActiveVideos: 100`:

1. Load videos
2. Scroll to row 30
3. Check Activity Monitor / Task Manager
4. **Expected**:
   - RAM: 3-6 GB (increased from 2-4 GB)
   - VRAM: 2-4 GB (increased from 1-3 GB)
   - CPU: <30% (with GPU acceleration)
   - GPU: 50-80%

**If memory is too high**: Reduce to `maxActiveVideos: 80` or `bufferRows: 20`

---

## Recommended Configuration

### For High-End Systems (16GB+ RAM, Dedicated GPU)

```javascript
maxActiveVideos: 100
bufferRows: 25
```

**Result**: Ultimate smoothness, no loading gaps

---

### For Mid-Range Systems (8-16GB RAM, Integrated/Mid GPU)

```javascript
maxActiveVideos: 80
bufferRows: 20
```

**Result**: Very smooth, reasonable memory usage

---

### For Lower-End Systems (<8GB RAM, Weak GPU)

```javascript
maxActiveVideos: 60
bufferRows: 15
```

**Result**: Good performance, low memory usage

---

## Why This Works

### Before Fix:

```
Row 20 (80 videos visible)
  ↓
Try to load 25 rows ahead (100 videos)
  ↓
Only 50 slots available ❌
  ↓
Can't load, videos stuck
```

### After Fix:

```
Row 20 (80 videos visible)
  ↓
Try to load 25 rows ahead (100 videos)
  ↓
100 slots available ✅
  ↓
All videos load smoothly
```

---

## Alternative: Dynamic Buffer Adjustment

**Automatically adjust buffer based on available slots**:

```javascript
// In renderer.js
const calculateOptimalBuffer = (maxActive, itemsPerRow) => {
  const optimalRows = Math.floor(maxActive / itemsPerRow * 0.9);
  return Math.max(10, Math.min(optimalRows, 25));
};

const optimalBuffer = calculateOptimalBuffer(50, this.gridCols);
console.log(`Optimal bufferRows for ${50} videos: ${optimalBuffer}`);

this.virtualGrid = new window.VirtualVideoGrid({
  // ...
  maxActiveVideos: 50,
  bufferRows: optimalBuffer,  // Auto-calculated
});
```

This ensures buffer never exceeds available slots!

---

## Summary

**The bug**: `bufferRows: 25` (needs 100 slots) vs `maxActiveVideos: 50` (only 50 slots)

**The fix**: Increase `maxActiveVideos: 100` to match buffer needs

**Trade-off**: Higher memory usage (~2x) for smooth scrolling

**Alternative**: Reduce `bufferRows: 12` to match slots (less smooth but works)

**Recommendation**: Try `maxActiveVideos: 100` first. If memory is an issue, reduce to 80.
