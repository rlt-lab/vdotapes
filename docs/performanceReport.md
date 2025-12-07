# Performance Report: Grid View Swapping

## Summary

Investigation into slowness when sorting, toggling Show Favorites/Hidden, and selecting folders revealed several significant performance bottlenecks in the filtering and rendering pipeline.

---

## Critical Issues

### 1. N+1 Lookup Pattern

**Files:** `app/modules/FilterManager.js:269, 306`

`applyFiltersInPlace()` and `refreshVisibleVideos()` use `.find()` to lookup each video by ID:

```javascript
// Line 269
const video = this.app.allVideos.find((v) => v.id === videoId);

// Line 306
return this.app.allVideos.find((v) => v.id === videoId);
```

**Impact:** For 1000 videos, this is O(n²) - up to 1,000,000 comparisons.

**Fix:** Create a lookup Map for O(1) access:
```javascript
this.videoMap = new Map(allVideos.map(v => [v.id, v]));
const video = this.videoMap.get(videoId);
```

---

### 2. Full Grid Rebuild on Every Filter Change

**Files:** `FilterManager.js:255`, `GridRenderer.js:48-52`

`applyCurrentFilters()` calls `renderGrid()` which destroys ALL DOM nodes and rebuilds from scratch:

```javascript
// FilterManager.js:255
this.app.renderGrid();

// GridRenderer.js:48-52
const gridHTML = this.app.displayedVideos
  .map((video, index) => this.createVideoItemHTML(video, index))
  .join('');
document.getElementById('content').innerHTML = `<div class="video-grid">${gridHTML}</div>`;
```

**Impact:**
- Every filter toggle destroys all DOM nodes
- All videos lose state (loaded thumbnails, playback position)
- Event listeners must be re-attached
- Triggers expensive browser reflow/repaint

**Fix:** Use CSS visibility toggling or DOM reconciliation instead of full rebuild.

---

### 3. Multiple Sequential Filter Passes

**File:** `FilterManager.js:188-243`

Creates array copy, then runs 4+ separate `.filter()` passes:

```javascript
let filtered = [...this.app.allVideos];           // Copy entire array
filtered = filtered.filter((v) => v.folder === this.app.currentFolder);  // Filter 1
filtered = filtered.filter((v) => v.isFavorite === true);                // Filter 2
filtered = filtered.filter((v) => !this.app.hiddenFiles.has(v.id));      // Filter 3
filtered = filtered.filter((v) => /* tag logic */);                      // Filter 4
filtered.sort(/* ... */);                                                 // Sort
```

**Impact:** Each `.filter()` creates a new intermediate array. For large libraries, this allocates significant memory and iterates the array multiple times.

**Fix:** Combine all filter conditions into a single pass:
```javascript
let filtered = this.app.allVideos.filter(video => {
  if (this.app.currentFolder && video.folder !== this.app.currentFolder) return false;
  if (this.app.showingFavoritesOnly && !video.isFavorite) return false;
  if (this.app.showingHiddenOnly) return this.app.hiddenFiles.has(video.id);
  if (this.app.hiddenFiles.has(video.id)) return false;
  // tag logic...
  return true;
});
```

---

## Secondary Issues

### 4. Tag Filtering with Array.includes()

**File:** `FilterManager.js:206-214`

```javascript
const videoTags = this.app.videoTags[video.id] || [];
return this.app.activeTags.every(tag => videoTags.includes(tag));
```

**Impact:** Nested loop - for each video, checks if tags array includes each active tag. O(n*m) where n=videos, m=tags.

**Fix:** Convert `videoTags` to Sets for O(1) membership checks:
```javascript
const videoTagSet = new Set(this.app.videoTags[video.id] || []);
return this.app.activeTags.every(tag => videoTagSet.has(tag));
```

---

### 5. Shuffle Triggers Full Re-render

**File:** `FilterManager.js:83`

```javascript
this.app.displayedVideos = videosToShuffle;
this.app.renderGrid();  // Full DOM rebuild
```

**Impact:** Every shuffle destroys and rebuilds entire grid instead of reordering existing elements.

**Fix:** Use `reorderGridInPlace()` pattern with DocumentFragment.

---

## What's Working Well

- `reorderGridInPlace()` (lines 31-66) correctly reuses DOM elements for sorting
- WASM engine path has optimization with `filtersChanged` check (lines 175-180)
- Smart loader uses IntersectionObserver for lazy loading

---

## Root Cause Flow

When toggling favorites/hidden or selecting a folder:

```
toggleFavoritesView() / filterByFolder()
    └── applyCurrentFilters()
            ├── Creates array copy
            ├── Runs 4+ filter passes
            ├── Sorts entire result
            └── renderGrid()  ← DESTROYS ENTIRE DOM
                    └── Rebuilds all HTML from scratch
```

The in-place methods (`reorderGridInPlace`, `applyFiltersInPlace`) exist but aren't being used for filter toggles.

---

## Recommended Fixes (Priority Order)

| Priority | Fix | Impact | Effort |
|----------|-----|--------|--------|
| 1 | Use in-place filtering for filter toggles | High | Medium |
| 2 | Add video lookup Map | High | Low |
| 3 | Single-pass filtering | Medium | Low |
| 4 | Convert videoTags to Sets | Medium | Low |
| 5 | Use reorder pattern for shuffle | Low | Low |

---

## Implementation Notes

### Video Lookup Map

Add to app initialization:
```javascript
// After loading videos
this.videoMap = new Map(this.allVideos.map(v => [v.id, v]));

// Update when videos change
updateVideoMap() {
  this.videoMap = new Map(this.allVideos.map(v => [v.id, v]));
}
```

### In-Place Filter Toggle

Extend `applyFiltersInPlace()` to be the primary filter method, using CSS classes to show/hide items rather than destroying DOM nodes.

### Debouncing

Consider debouncing rapid filter changes (e.g., when user clicks multiple filters quickly).
