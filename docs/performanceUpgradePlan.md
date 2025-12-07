# Performance Upgrade Plan

Implementation plan addressing the performance bottlenecks identified in `performanceReport.md`.

---

## Phase 1: Video Lookup Map (High Impact, Low Effort)

**Goal**: Eliminate O(n²) lookups in `applyFiltersInPlace()` and `refreshVisibleVideos()`.

### 1.1 Add videoMap to VdoTapesApp

**File**: `app/renderer.js`

In constructor after `this.allVideos = []`:
```javascript
this.videoMap = new Map();
```

### 1.2 Create updateVideoMap method

**File**: `app/renderer.js`

Add method to `VdoTapesApp`:
```javascript
updateVideoMap() {
  this.videoMap = new Map(this.allVideos.map(v => [v.id, v]));
}
```

### 1.3 Call updateVideoMap after videos load

**File**: `app/renderer.js:141-151`

After `this.allVideos = dbVideos` or `this.allVideos = result.videos`, call:
```javascript
this.updateVideoMap();
```

### 1.4 Replace .find() calls in FilterManager

**File**: `app/modules/FilterManager.js`

**Line 269** - Replace:
```javascript
const video = this.app.allVideos.find((v) => v.id === videoId);
```
With:
```javascript
const video = this.app.videoMap.get(videoId);
```

**Line 306** - Replace:
```javascript
return this.app.allVideos.find((v) => v.id === videoId);
```
With:
```javascript
return this.app.videoMap.get(videoId);
```

---

## Phase 2: Single-Pass Filtering (Medium Impact, Low Effort)

**Goal**: Reduce array iterations from 4+ passes to 1.

### 2.1 Refactor applyCurrentFilters JS path

**File**: `app/modules/FilterManager.js:188-243`

Replace multiple `.filter()` chains with single pass:

```javascript
// Replace lines 188-218 with:
const filtered = this.app.allVideos.filter(video => {
  // Folder filter
  if (this.app.currentFolder && video.folder !== this.app.currentFolder) {
    return false;
  }

  // Favorites filter
  if (this.app.showingFavoritesOnly && !video.isFavorite) {
    return false;
  }

  // Hidden filter
  if (this.app.showingHiddenOnly) {
    if (!this.app.hiddenFiles.has(video.id)) return false;
  } else {
    if (this.app.hiddenFiles.has(video.id)) return false;
  }

  // Tag filter
  if (this.app.activeTags && this.app.activeTags.length > 0) {
    const videoTags = this.app.videoTags[video.id] || [];
    if (this.app.tagFilterMode === 'AND') {
      if (!this.app.activeTags.every(tag => videoTags.includes(tag))) return false;
    } else {
      if (!this.app.activeTags.some(tag => videoTags.includes(tag))) return false;
    }
  }

  return true;
});
```

Keep existing sort logic (lines 220-243) after this filter.

---

## Phase 3: Tag Set Optimization (Medium Impact, Low Effort)

**Goal**: O(1) tag membership checks instead of O(m).

### 3.1 Precompute tag Sets

**File**: `app/renderer.js`

Add property in constructor:
```javascript
this.videoTagSets = {};  // Map: videoId -> Set of tag names
```

### 3.2 Build Sets when loading tags

**File**: `app/renderer.js:181-192`

After loading `allVideoTags`, build Sets:
```javascript
this.videoTags = allVideoTags;
this.videoTagSets = {};
for (const [videoId, tags] of Object.entries(allVideoTags)) {
  this.videoTagSets[videoId] = new Set(tags);
}
```

### 3.3 Use Sets in filter logic

**File**: `app/modules/FilterManager.js`

In the single-pass filter (Phase 2), replace:
```javascript
const videoTags = this.app.videoTags[video.id] || [];
// ... videoTags.includes(tag) ...
```

With:
```javascript
const videoTagSet = this.app.videoTagSets[video.id];
if (!videoTagSet) return false;  // No tags = no match
if (this.app.tagFilterMode === 'AND') {
  if (!this.app.activeTags.every(tag => videoTagSet.has(tag))) return false;
} else {
  if (!this.app.activeTags.some(tag => videoTagSet.has(tag))) return false;
}
```

Same optimization needed in WASM fallback path (lines 156-169).

---

## Phase 4: In-Place Filter Toggling (High Impact, Medium Effort)

**Goal**: Use CSS visibility instead of DOM destruction for filter changes.

### 4.1 Replace renderGrid() calls with applyFiltersInPlace()

**File**: `app/modules/FilterManager.js:255`

Replace:
```javascript
this.app.renderGrid();
```

With:
```javascript
this.applyFiltersInPlace();
this.reorderGridInPlace();
```

### 4.2 Ensure grid exists before in-place operations

The existing `applyFiltersInPlace()` already falls back to `renderGrid()` when container doesn't exist. This is correct behavior.

### 4.3 Add displayedVideos sync

After `applyFiltersInPlace()`, `displayedVideos` array must match visible items. This is handled by `refreshVisibleVideos()` already called at end of `applyFiltersInPlace()`.

### 4.4 Handle initial render

First render after folder scan still needs `renderGrid()`. Only subsequent filter toggles use in-place.

Add tracking flag to VdoTapesApp:
```javascript
this.gridRendered = false;
```

In `renderGrid()`:
```javascript
this.gridRendered = true;
```

In `applyCurrentFilters()`:
```javascript
if (!this.gridRendered) {
  this.app.renderGrid();
} else {
  this.applyFiltersInPlace();
  this.reorderGridInPlace();
}
```

---

## Phase 5: Shuffle Optimization (Low Impact, Low Effort)

**Goal**: Reorder DOM instead of destroying it.

### 5.1 Refactor shuffleVideos()

**File**: `app/modules/FilterManager.js:68-87`

Replace `this.app.renderGrid()` with DOM reordering:

```javascript
async shuffleVideos() {
  const btn = document.getElementById('shuffleBtn');
  btn.classList.add('shuffling');

  this.app.currentSort = 'shuffle';
  this.updateSortButtonStates();

  // Shuffle displayedVideos array
  const videos = this.app.displayedVideos;
  for (let i = videos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [videos[i], videos[j]] = [videos[j], videos[i]];
  }

  // Reorder DOM to match shuffled order
  const container = document.querySelector('.video-grid');
  if (container) {
    const frag = document.createDocumentFragment();
    videos.forEach((video, newIndex) => {
      const item = container.querySelector(`[data-video-id="${video.id}"]`);
      if (item) {
        item.dataset.index = newIndex.toString();
        frag.appendChild(item);
      }
    });
    container.appendChild(frag);
  } else {
    this.app.renderGrid();
  }

  this.app.updateStatusMessage();
  setTimeout(() => btn.classList.remove('shuffling'), 500);
}
```

---

## Phase 6: Debouncing (Optional Enhancement)

**Goal**: Prevent rapid filter changes from causing layout thrashing.

### 6.1 Add debounce utility

**File**: `app/modules/FilterManager.js` (top of file)

```javascript
function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
```

### 6.2 Wrap applyCurrentFilters

In constructor:
```javascript
this.debouncedApplyFilters = debounce(() => this.applyCurrentFilters(), 50);
```

Use `this.debouncedApplyFilters()` for rapid filter sources (tag clicks, etc).

---

## Implementation Order

| Step | Phase | Files Modified | Test After |
|------|-------|----------------|------------|
| 1 | 1.1-1.4 | renderer.js, FilterManager.js | Filter toggles still work |
| 2 | 2.1 | FilterManager.js | Verify filter results match |
| 3 | 3.1-3.3 | renderer.js, FilterManager.js | Tag filtering works |
| 4 | 4.1-4.4 | FilterManager.js, renderer.js | Toggle favorites/hidden fast |
| 5 | 5.1 | FilterManager.js | Shuffle preserves thumbnails |
| 6 | 6.1-6.2 | FilterManager.js | No regressions |

---

## Validation Checklist

After each phase:
- [ ] Filter by folder works
- [ ] Toggle favorites shows only favorited videos
- [ ] Toggle hidden shows only hidden videos
- [ ] Tag filtering (AND/OR) works
- [ ] Sort by folder/date works
- [ ] Shuffle randomizes order
- [ ] Thumbnails remain loaded after filter changes
- [ ] Video playback on hover still works
- [ ] Expanded video view works
- [ ] No console errors

---

## Performance Metrics

Measure before/after:
- Time from filter toggle click to grid update complete
- Memory usage during filter operations
- DOM node count before/after filter toggle (should remain constant in Phase 4+)

Use Chrome DevTools Performance tab to profile `applyCurrentFilters()` execution time.
