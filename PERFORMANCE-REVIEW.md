# Code Review & Performance Analysis Report

**Date:** 2026-01-10
**Project:** VDOTapes

## Executive Summary

Your performance issues stem from three main areas: **synchronous DOM operations during sort/filter**, **unused debouncing**, and **sequential IPC calls**. The architecture is sound but has accumulated patterns that block the UI thread.

---

## Critical Performance Issues

### 1. Debounced Filter Function Never Called (HIGH IMPACT)

**Location:** `app/modules/FilterManager.js:20`

```javascript
this.debouncedApplyFilters = debounce(() => this.applyFiltersOptimized(), 50);
```

This debounced function is **created but never used**. All filter operations call `applyFiltersOptimized()` directly:
- `toggleFavoritesView()` line 135
- `toggleHiddenView()` line 145

**Fix:** Replace direct calls with `this.debouncedApplyFilters()`.

---

### 2. Synchronous DOM Reordering on Sort (HIGH IMPACT - explains sort lag)

**Location:** `app/modules/FilterManager.js:45-79`

```javascript
reorderGridInPlace() {
  const items = Array.from(container.children);  // Collects ALL DOM nodes
  items.sort((a, b) => { ... });                  // Synchronous sort
  items.forEach((el) => frag.appendChild(el));   // Reattaches ALL items
  container.appendChild(frag);                    // Single DOM reflow
}
```

For 2000+ videos, this blocks the UI for hundreds of milliseconds.

**Fix:** Use `requestAnimationFrame` to batch or consider virtual scrolling.

---

### 3. No Throttle on Resize Handler (MEDIUM IMPACT)

**Location:** `app/modules/EventController.js:74`

```javascript
window.addEventListener('resize', () => this.app.handleResize());
```

Fires on every pixel during resize, causing layout thrashing.

**Fix:** Wrap with `throttle(handler, 100)`.

---

### 4. Hardcoded Artificial Delays (MEDIUM IMPACT)

**Locations:**
- `app/renderer.js:71` - 500ms delay before initialization
- `app/modules/UserDataManager.js:167` - 1000ms delay before loading settings

These are likely workarounds for race conditions but add 1.5s to startup.

---

### 5. Sequential IPC Calls During Folder Load (MEDIUM IMPACT)

**Location:** `app/renderer.js:140-204`

```javascript
const videos = await window.electronAPI.getVideos();      // Wait
const favorites = await window.electronAPI.getFavorites(); // Then wait
const hidden = await window.electronAPI.getHiddenFiles(); // Then wait
const allVideoTags = await window.electronAPI.getAllVideoTags(); // Then wait
```

These are independent and could run in parallel with `Promise.all()`.

---

### 6. Large IPC Data Transfer for Tags (MEDIUM IMPACT)

**Location:** `src/ipc-handlers.ts:626-645`

`getAllVideoTags()` transfers the **entire** tag mapping for all videos in one IPC call. For large libraries with many tags, this serializes/deserializes megabytes of data.

---

### 7. Repeated Schema Checks on Every Operation (LOW-MEDIUM IMPACT)

**Location:** `src/database/operations/UserDataOperations.ts` lines 54-56, 100-102, 217-219, 289-291, 361-363, 406-408

Every favorite/hidden/rating operation queries `sqlite_master`:

```typescript
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name = '_backup_favorites_v1'"
).get();
```

This is checking for backup tables created during v2 migration. Should be cached at startup.

---

### 8. Synchronous File I/O in Main Process (LOW-MEDIUM IMPACT)

**Location:** `src/folder-metadata.ts:77, 226`

```typescript
fs.readFileSync(metadataPath, 'utf-8');  // Blocks main thread
fs.writeFileSync(metadataPath, ...);      // Blocks main thread
```

Use async versions (`fs.promises.readFile`) to avoid blocking IPC handlers.

---

## Code Quality Issues

### 1. V2 Migration Creates Empty Compatibility Tables

**Location:** `src/database/migrations/migrateToV2.ts:154-178`

The migration merges data into `videos` table columns, then recreates **empty** `favorites`, `hidden_files`, and `ratings` tables for "backward compatibility." However, `UserDataOperations.ts` still writes to these tables, creating data duplication.

### 2. No Test Suite

The project has no test coverage (`npm test` fails with "Missing script"). This makes refactoring risky.

### 3. Mixed Module Systems

`VideoDatabase.ts:32-35` uses `require()` for CommonJS modules while the rest uses ES modules:

```typescript
const QueryPerformanceMonitor = require('../performance-monitor');
const { QueryCache, CacheWarmer } = require('../query-cache');
```

---

## Recommended Fixes by Priority

| Priority | Issue | Fix | Impact |
|----------|-------|-----|--------|
| **P0** | Unused debounce | Use `debouncedApplyFilters()` | Immediate UI improvement |
| **P0** | Synchronous sort | Use `requestAnimationFrame` batching | Fixes sort lag |
| **P1** | No resize throttle | Add `throttle(handler, 100)` | Smoother resizing |
| **P1** | Sequential IPC | Use `Promise.all()` for independent calls | Faster folder load |
| **P1** | Artificial delays | Remove or reduce the 500ms + 1000ms delays | Faster startup |
| **P2** | Schema checks | Cache backup table existence at startup | Faster writes |
| **P2** | Sync file I/O | Use `fs.promises` | Unblock main thread |
| **P3** | Tag data transfer | Paginate or lazy-load tags | Memory reduction |

---

## Quick Wins (Can Fix Immediately)

### 1. Use the debounced filter function

```javascript
// In FilterManager.js toggleFavoritesView() and toggleHiddenView()
this.debouncedApplyFilters();  // Instead of this.applyFiltersOptimized()
```

### 2. Throttle resize

```javascript
// In EventController.js
window.addEventListener('resize', throttle(() => this.app.handleResize(), 100));
```

### 3. Parallel IPC calls

```javascript
const [videos, favorites, hidden, allVideoTags] = await Promise.all([
  window.electronAPI.getVideos(),
  window.electronAPI.getFavorites(),
  window.electronAPI.getHiddenFiles(),
  window.electronAPI.getAllVideoTags()
]);
```

---

## Architecture Observations

The codebase has good patterns in place:
- Query caching with LRU (`query-cache.js`)
- Performance monitoring (`performance-monitor.js`)
- Batch sync operations (`syncFolderMetadata`)
- Sets for O(1) tag lookups

The issues are mostly about **not using** these optimizations consistently (like the unused debounce) and **synchronous operations** in hot paths.

---

## Additional Findings from Exploration

### UI Event Handling

| Issue | Location | Severity |
|-------|----------|----------|
| Sort DOM Reordering | FilterManager.js:45-80 | HIGH |
| Full Grid Clear on Update | GridRenderer.js:126 | HIGH |
| SmartLoader Unload Loop | video-smart-loader.js:78-100 | HIGH |
| Cleanup O(n) x 2 | video-smart-loader.js:237-301 | MEDIUM |
| No Input Debouncing | TagManager.js:33-35 | MEDIUM |

### Database Layer

| Aspect | Status | Location |
|--------|--------|----------|
| Sorting | OK | VideoOperations.ts:495-523 |
| Indexes | Good | DatabaseCore.ts:202-251 (18 indexes) |
| N+1 Queries | Critical | UserDataOperations.ts (schema checks) |
| Query Caching | Good | query-cache.js (50-entry LRU, 5min TTL) |
| Batch Operations | OK | VideoDatabase.ts:343-424 |

### IPC Communication

| Issue | Location | Impact |
|-------|----------|--------|
| Giant tag data transfer | ipc-handlers.ts:626-645 | 1-5s freeze for large libraries |
| Sequential IPC load chain | renderer.js:140-204 | 4 round-trips instead of 1 |
| Repeated tag list reloads | VideoExpander.js:122-134 | Blocks UI after every tag op |
| Synchronous DB ops in handlers | ipc-handlers.ts:321, 365, 409 | Main thread blocked |

---

## Files Analyzed

- `app/modules/FilterManager.js`
- `app/modules/EventController.js`
- `app/modules/GridRenderer.js`
- `app/modules/TagManager.js`
- `app/modules/VideoExpander.js`
- `app/video-smart-loader.js`
- `app/renderer.js`
- `src/database/VideoDatabase.ts`
- `src/database/operations/VideoOperations.ts`
- `src/database/operations/UserDataOperations.ts`
- `src/database/operations/TagOperations.ts`
- `src/database/core/DatabaseCore.ts`
- `src/database/migrations/migrateToV2.ts`
- `src/ipc-handlers.ts`
- `src/folder-metadata.ts`
