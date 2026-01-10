# Performance Fixes Implementation Plan

**Date:** 2026-01-10
**Status:** Ready for implementation
**Reference:** [PERFORMANCE-REVIEW.md](/PERFORMANCE-REVIEW.md)

## Overview

Fix UI sluggishness and sort lag through four phases: test foundation, quick wins, virtual scrolling, and backend cleanup.

**Root causes identified:**
- Synchronous DOM operations during sort/filter
- Unused debouncing (function exists but never called)
- Sequential IPC calls
- Repeated unnecessary database queries

---

## Phase 1: Test Foundation

**Goal:** Enable safe refactoring with targeted test coverage.

### 1.1 Setup Vitest

```bash
npm install -D vitest @testing-library/dom jsdom
```

Add to `package.json`:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,js}'],
  },
});
```

### 1.2 Test Files to Create

| File | Tests | Purpose |
|------|-------|---------|
| `tests/unit/FilterManager.test.js` | 4-5 tests | Sort mode changes, filter state transitions, debounce called |
| `tests/unit/UserDataOperations.test.ts` | 3-4 tests | Toggle operations, no repeated schema checks |
| `tests/integration/renderer-ipc.test.js` | 2-3 tests | Parallel IPC, data loads correctly |
| `tests/unit/EventController.test.js` | 2 tests | Resize throttled, event delegation works |

### 1.3 Mock Setup

Create `tests/mocks/electronAPI.js`:
```javascript
export const mockElectronAPI = {
  getVideos: vi.fn().mockResolvedValue([]),
  getFavorites: vi.fn().mockResolvedValue([]),
  getHiddenFiles: vi.fn().mockResolvedValue([]),
  getAllVideoTags: vi.fn().mockResolvedValue({}),
  // ... other methods
};
```

Create `tests/mocks/database.ts`:
```typescript
export const mockDb = {
  prepare: vi.fn().mockReturnValue({
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    run: vi.fn(),
  }),
  exec: vi.fn(),
};
```

**Estimated:** 12-15 tests total

---

## Phase 2: Quick Wins

**Goal:** Immediate UI improvement with minimal risk.

### 2.1 Enable Debounced Filter Calls

**File:** `app/modules/FilterManager.js`

```javascript
// Line 135 in toggleFavoritesView()
// BEFORE:
this.applyFiltersOptimized();

// AFTER:
this.debouncedApplyFilters();
```

```javascript
// Line 145 in toggleHiddenView()
// BEFORE:
this.applyFiltersOptimized();

// AFTER:
this.debouncedApplyFilters();
```

### 2.2 Add Resize Throttle

**File:** `app/modules/EventController.js`

```javascript
// Add import at top (throttle exists in debounce.js)
const { throttle } = require('../utils/debounce');

// Line 74 - BEFORE:
window.addEventListener('resize', () => this.app.handleResize());

// AFTER:
window.addEventListener('resize', throttle(() => this.app.handleResize(), 100));
```

### 2.3 Parallelize IPC Calls

**File:** `app/renderer.js` (lines 140-204)

```javascript
// BEFORE:
const videos = await window.electronAPI.getVideos();
const favorites = await window.electronAPI.getFavorites();
const hidden = await window.electronAPI.getHiddenFiles();
const allVideoTags = await window.electronAPI.getAllVideoTags();

// AFTER:
const [videos, favorites, hidden, allVideoTags] = await Promise.all([
  window.electronAPI.getVideos(),
  window.electronAPI.getFavorites(),
  window.electronAPI.getHiddenFiles(),
  window.electronAPI.getAllVideoTags(),
]);
```

### 2.4 Remove Artificial Delays

**File:** `app/renderer.js` (line 71)
```javascript
// REMOVE or reduce:
await new Promise((resolve) => setTimeout(resolve, 500));
```

**File:** `app/modules/UserDataManager.js` (line 167)
```javascript
// REMOVE or reduce:
await new Promise((resolve) => setTimeout(resolve, 1000));
```

**Note:** Test thoroughly after removal. If race conditions appear, replace with proper ready-state checks.

### 2.5 Add Tag Search Debounce

**File:** `app/modules/TagManager.js` (lines 33-35)

```javascript
// BEFORE:
tagSearchInput.addEventListener('input', (e) => {
  this.handleSearchInput(e.target.value);
});

// AFTER:
tagSearchInput.addEventListener('input', debounce((e) => {
  this.handleSearchInput(e.target.value);
}, 150));
```

---

## Phase 3: Virtual Scrolling

**Goal:** Eliminate sort lag for any library size.

### 3.1 Complete VirtualGrid Integration

**File:** `app/modules/GridRenderer.js`

The codebase has `virtualGrid` referenced but not fully integrated. Make it the primary render path:

```javascript
class GridRenderer {
  constructor(app) {
    this.app = app;
    this.virtualGrid = null;
    this.itemHeight = 200; // Configurable
    this.bufferRows = 2;
  }

  initVirtualGrid(container) {
    this.virtualGrid = new VirtualGrid({
      container,
      itemHeight: this.itemHeight,
      bufferRows: this.bufferRows,
      renderItem: (video, index) => this.createVideoItem(video, index),
    });
  }

  renderGrid(videos) {
    if (this.virtualGrid) {
      this.virtualGrid.setData(videos);
      this.virtualGrid.render();
    } else {
      this.renderFallback(videos);
    }
  }
}
```

### 3.2 Refactor Sort to Data-Only

**File:** `app/modules/FilterManager.js`

```javascript
// RENAME: reorderGridInPlace → reorderData
reorderData() {
  const mode = this.app.currentSort;

  // Sort the DATA array (instant, no DOM)
  this.app.displayedVideos.sort((a, b) => {
    if (mode === 'folder') {
      const fc = (a.folder || '').localeCompare(b.folder || '');
      if (fc !== 0) return fc;
      return (b.lastModified || 0) - (a.lastModified || 0);
    } else if (mode === 'date') {
      return (b.lastModified || 0) - (a.lastModified || 0);
    }
    return 0;
  });

  // Trigger virtual grid re-render (only visible items update)
  this.app.gridRenderer.renderGrid(this.app.displayedVideos);
}
```

### 3.3 VirtualGrid Class

**File:** `app/modules/VirtualGrid.js` (new file or complete existing)

```javascript
class VirtualGrid {
  constructor({ container, itemHeight, bufferRows, renderItem }) {
    this.container = container;
    this.itemHeight = itemHeight;
    this.bufferRows = bufferRows;
    this.renderItem = renderItem;
    this.data = [];
    this.visibleItems = new Map();

    this.setupScrollListener();
  }

  setData(data) {
    this.data = data;
    this.updateContainerHeight();
  }

  render() {
    const scrollTop = this.container.scrollTop;
    const viewportHeight = this.container.clientHeight;
    const cols = this.app.gridCols;

    const startRow = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.bufferRows);
    const endRow = Math.ceil((scrollTop + viewportHeight) / this.itemHeight) + this.bufferRows;

    const startIndex = startRow * cols;
    const endIndex = Math.min(endRow * cols, this.data.length);

    // Remove items no longer visible
    for (const [index, element] of this.visibleItems) {
      if (index < startIndex || index >= endIndex) {
        element.remove();
        this.visibleItems.delete(index);
      }
    }

    // Add newly visible items
    for (let i = startIndex; i < endIndex; i++) {
      if (!this.visibleItems.has(i) && this.data[i]) {
        const element = this.renderItem(this.data[i], i);
        this.positionItem(element, i);
        this.container.appendChild(element);
        this.visibleItems.set(i, element);
      }
    }
  }

  setupScrollListener() {
    this.container.addEventListener('scroll', throttle(() => this.render(), 16));
  }
}
```

### 3.4 Integrate with SmartLoader

**File:** `app/video-smart-loader.js`

Update to work with virtual scrolling - the IntersectionObserver logic can be reused but should only observe currently-rendered items:

```javascript
// Instead of observing ALL items at startup,
// observe items as they're created by VirtualGrid
observeItem(element) {
  this.observer.observe(element);
}

unobserveItem(element) {
  this.observer.unobserve(element);
}
```

### 3.5 Remove Full DOM Clear

**File:** `app/modules/GridRenderer.js` (line 126)

```javascript
// REMOVE this pattern:
container.innerHTML = '';

// VirtualGrid handles incremental updates instead
```

---

## Phase 4: Backend Cleanup

**Goal:** Reduce unnecessary work in main process.

### 4.1 Cache Backup Table Existence

**File:** `src/database/core/DatabaseCore.ts`

```typescript
class DatabaseCore {
  private hasBackupTables: boolean = false;

  async initialize(): Promise<void> {
    // ... existing init ...

    // Check once at startup
    this.hasBackupTables = this.checkBackupTablesExist();
  }

  private checkBackupTablesExist(): boolean {
    const result = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = '_backup_favorites_v1'"
    ).get();
    return !!result;
  }

  hasBackupTablesFlag(): boolean {
    return this.hasBackupTables;
  }
}
```

**File:** `src/database/operations/UserDataOperations.ts`

```typescript
// REMOVE these repeated checks (6 locations):
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name = '_backup_favorites_v1'"
).get();

// REPLACE with:
if (this.core.hasBackupTablesFlag()) {
  // backup operation
}
```

### 4.2 Async File I/O

**File:** `src/folder-metadata.ts`

```typescript
import { promises as fs } from 'fs';

// BEFORE (line 77):
const data = fs.readFileSync(metadataPath, 'utf-8');

// AFTER:
const data = await fs.readFile(metadataPath, 'utf-8');

// BEFORE (line 226):
fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

// AFTER:
await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
```

Update method signatures to be async and update callers in `ipc-handlers.ts`.

### 4.3 Lazy Tag Loading

**File:** `src/ipc-handlers.ts`

```typescript
// NEW: Load tags for single video (called when expanding)
ipcMain.handle('getVideoTags', async (_, videoId: string) => {
  return this.database.getVideoTags(videoId);
});

// MODIFY: getAllVideoTags now returns summary only
ipcMain.handle('getAllVideoTags', async () => {
  // Return just tag names and counts for filtering UI
  return this.database.getAllTags(); // [{name, count}]
});
```

**File:** `app/renderer.js`

```typescript
// Remove full tag mapping load from initial load
// Load tags per-video in VideoExpander when needed
```

### 4.4 Remove V2 Migration Duplication

**File:** `src/database/operations/UserDataOperations.ts`

After confirming v2 migration is stable, remove writes to empty compatibility tables. Only write to `videos` table columns.

```typescript
// REMOVE duplicate writes like:
db.prepare('INSERT OR IGNORE INTO favorites (video_id) VALUES (?)').run(videoId);

// KEEP only:
db.prepare('UPDATE videos SET favorite = 1 WHERE id = ?').run(videoId);
```

---

## Implementation Checklist

### Phase 1: Test Foundation
- [ ] Install Vitest and testing-library/dom
- [ ] Create vitest.config.ts
- [ ] Create mock files for electronAPI and database
- [ ] Write FilterManager tests
- [ ] Write UserDataOperations tests
- [ ] Write renderer IPC tests
- [ ] Write EventController tests
- [ ] Verify all tests pass

### Phase 2: Quick Wins
- [ ] Enable debounced filter calls in FilterManager
- [ ] Add throttle to resize handler
- [ ] Parallelize IPC calls in renderer.js
- [ ] Remove/reduce artificial delays
- [ ] Add debounce to tag search input
- [ ] Run tests, verify no regressions

### Phase 3: Virtual Scrolling
- [ ] Complete VirtualGrid class implementation
- [ ] Integrate VirtualGrid in GridRenderer
- [ ] Refactor reorderGridInPlace to reorderData
- [ ] Update video-smart-loader for virtual scrolling
- [ ] Remove full DOM clear pattern
- [ ] Test with large library (2000+ videos)
- [ ] Run tests, verify no regressions

### Phase 4: Backend Cleanup
- [ ] Cache backup table existence at startup
- [ ] Convert folder-metadata.ts to async I/O
- [ ] Implement lazy tag loading
- [ ] Remove v2 migration table duplication
- [ ] Run tests, verify no regressions

---

## Files Modified

| Phase | Files |
|-------|-------|
| 1 | `package.json`, `vitest.config.ts`, `tests/*` (new) |
| 2 | `FilterManager.js`, `EventController.js`, `renderer.js`, `UserDataManager.js`, `TagManager.js` |
| 3 | `GridRenderer.js`, `FilterManager.js`, `VirtualGrid.js` (new or complete), `video-smart-loader.js` |
| 4 | `DatabaseCore.ts`, `UserDataOperations.ts`, `folder-metadata.ts`, `ipc-handlers.ts` |

---

## Success Criteria

- [ ] Sort button responds in <100ms for 5000 video library
- [ ] Favorites/hidden toggle responds in <50ms
- [ ] Folder load time reduced by 50%+
- [ ] No artificial delays in startup
- [ ] All tests pass
- [ ] No regressions in existing functionality
