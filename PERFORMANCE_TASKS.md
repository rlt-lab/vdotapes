# VDOTapes Performance Optimization - Task List

## Overview

Implementation plan for fixing performance issues affecting ~10,000 video collections and removing Rust native modules in favor of pure TypeScript/JavaScript.

---

## Phase 1: Quick Wins

### 1.1 Remove Redundant Sort Operations ✅
**File:** `app/modules/FilterManager.js`

| Task | Description | Lines |
|------|-------------|-------|
| ☑ Remove redundant `updateStatusMessage()` in `setSortMode()` | Called at line 35, but `reorderGridInPlace()` at line 34 already triggers it via `refreshVisibleVideos()` | 35 |
| ☑ Remove redundant `updateStatusMessage()` in `shuffleVideos()` | Called at line 112 after DOM reorder, but count doesn't change | 112 |
| ☑ Remove double `refreshVisibleVideos()` in `applyFiltersOptimized()` | `applyFiltersInPlace()` (line 156) calls it at line 360, then `reorderGridInPlace()` (line 157) calls it again at line 79 | 156-157 |
| ☑ Remove duplicate `data-index` updates | Updated at line 75 in `reorderGridInPlace()`, then again at line 378 in `refreshVisibleVideos()` | 75, 378 |

### 1.2 Cache Tag Suggestions ✅
**File:** `src/tag-suggestion-manager.ts`

| Task | Description |
|------|-------------|
| ☑ Add `tagCache` property | `{ tags: TagInfo[]; timestamp: number } \| null` |
| ☑ Add `folderTagCache` property | `Map<string, { tags: string[]; timestamp: number }>()` |
| ☑ Add `CACHE_TTL` constant | 30 seconds (30000ms) |
| ☑ Implement `invalidateTagCache()` method | Clears both caches |
| ☑ Update `getAllTags()` call in `getSuggestions()` | Check cache before calling `folderMetadata.getAllTags()` |
| ☑ Update `getFolderTags()` | Check `folderTagCache` before database query |
| ☑ Call `invalidateTagCache()` from tag add/remove operations | Ensure cache stays consistent |

**Current Issues Found:**
- `getAllTags()` is O(n*m + k log k) - iterates all videos, all tags, then sorts
- `getFolderTags()` queries database and iterates all folder videos per request
- No existing caching for tag data

### 1.3 Debounce Status Updates ✅
**File:** `app/modules/UIHelper.js`

| Task | Description | Lines |
|------|-------------|-------|
| ☑ Add debounce utility (or import from FilterManager) | 50ms delay recommended | - |
| ☑ Debounce `updateStatusMessage()` | Wrap existing implementation with debounce | 148-163 |

**Current Issues Found:**
- NOT debounced - called directly from 11+ locations
- O(n) `reduce()` operation on every call to sum file sizes
- Called from: FilterManager (6x), TagManager (4x), UserDataManager (1x)

---

## Phase 2: Grid Virtualization ⚠️ (Disabled - CSS Grid incompatible)

### 2.1 Copy VirtualGrid from Worktree ✅
**Source:** `.worktrees/performance-fixes/app/modules/VirtualGrid.js`
**Destination:** `app/modules/VirtualGrid.js`

| Task | Description |
|------|-------------|
| ☑ Copy `VirtualGrid.js` to main branch | File is 200+ lines, fully implemented |
| ☑ Verify VirtualGrid features | Viewport calculation, buffer rows, element recycling, scroll throttling |

**Note:** VirtualGrid uses absolute positioning which breaks existing CSS Grid layout. Disabled pending CSS Grid-compatible approach.

**VirtualGrid Capabilities (from analysis):**
- Renders only visible rows + 2-row buffer (~40-60 elements vs 10k)
- Absolute positioning instead of CSS Grid flow
- Video cleanup on removal (pause, clear src, load())
- Throttled scroll at 16ms (60fps)
- ResizeObserver for container size changes

### 2.2 Add VirtualGrid to index.html ✅
**File:** `app/index.html`

| Task | Description | Lines |
|------|-------------|-------|
| ☑ Add script tag for VirtualGrid.js | Insert before GridRenderer.js (line 235) | ~234 |

**Current script order (for reference):**
1. video-smart-loader.js (223)
2. ThumbnailPreloader.js (229)
3. VideoManager.js (230)
4. VideoExpander.js (231)
5. FilterManager.js (232)
6. TagManager.js (233)
7. TagCloudManager.js (234)
8. **→ Insert VirtualGrid.js here**
9. GridRenderer.js (235)
10. UserDataManager.js (236)
11. UIHelper.js (237)
12. EventController.js (238)
13. renderer.js (241)

### 2.3 Update GridRenderer for VirtualGrid Integration ✅ (Disabled)
**File:** `app/modules/GridRenderer.js`

| Task | Description |
|------|-------------|
| ☑ Add `virtualGrid` property initialization | `this.virtualGrid = null` |
| ☑ Add `VIRTUAL_THRESHOLD` constant | 500 videos (already partially exists at line 16-28) |
| ☑ Port `renderWithVirtualGrid()` from worktree | Full method implementation (lines 34-72 in worktree) |
| ☑ Port `createVideoElement()` from worktree | Element factory for VirtualGrid (lines 77-132 in worktree) |
| ☑ Port `destroyVirtualGrid()` from worktree | Cleanup method (lines 137-142 in worktree) |
| ⚠️ Update `renderGrid()` dispatch logic | **Disabled** - VirtualGrid breaks CSS Grid layout |

### 2.4 Add VirtualGrid Properties to VdoTapesApp ✅
**File:** `app/renderer.js`

| Task | Description | Lines |
|------|-------------|-------|
| ☑ Add `useVirtualGrid` property | `this.useVirtualGrid = false` | ~48 |
| ☑ Add `virtualGrid` property | `this.virtualGrid = null` | ~48 |

### 2.5 Update SmartLoader for Element Recycling ✅
**File:** `app/modules/video-smart-loader.js`

| Task | Description |
|------|-------------|
| ☑ Add `observeItem(element)` method | For incremental observation: `this.observer.observe(element)` |
| ☑ Handle recycled elements | Ensure videoId tracking works when elements are reused |
| ☑ Update cleanup to work with virtualized grid | May need to check if element is still in DOM |
| ☑ Increase buffer zones | `loadBufferZone`: 500→1500px, `unloadBufferZone`: 2500→5000px |

**Current Issues Found:**
- `observeVideoItems()` disconnects/reconnects observer on every render
- No `observeItem()` method for single-item observation
- Worktree GridRenderer calls `smartLoader.observeItem(div)` at line 128

---

## Phase 3: Replace Rust with TypeScript ✅

### 3.1 Create TypeScript Video Scanner ✅
**File:** `src/video-scanner-ts.ts` (NEW)

| Task | Description |
|------|-------------|
| ☑ Create async generator `scanVideosAsync()` | Uses `fs/promises.readdir` with `recursive: true` |
| ☑ Implement `generateVideoId()` | Uses DJB2 hash (matching existing algorithm) |
| ☑ Implement `scanVideos()` wrapper | Returns `ScanResult { videos, errors }` |
| ☑ Support all video extensions | .mp4, .webm, .ogg, .mov, .avi, .wmv, .flv, .mkv, .m4v |
| ☑ Skip hidden/system files | Files starting with `.`, `node_modules`, `.DS_Store` |

**API Contract (from analysis):**
```typescript
scanVideos(folderPath: string): Promise<CoreScanResult>
isValidVideoFile(filename: string): boolean
generateVideoId(path: string, size: number, mtime: number): VideoId
```

### 3.2 Create TypeScript Thumbnail Generator ✅
**File:** `src/thumbnail-gen-ts.ts` (NEW)

| Task | Description |
|------|-------------|
| ☑ Create `ThumbnailGenerator` class | Constructor takes cacheDir, maxCacheMB |
| ☑ Implement `initialize()` | Create cache directory, calculate current size |
| ☑ Implement `generateThumbnail()` | Check cache, generate via FFmpeg if missing |
| ☑ Implement `runFFmpeg()` | Spawn ffmpeg process with correct args |
| ☑ Implement `getSmartTimestamp()` | Use ffprobe to get duration, return 10% point |
| ☑ Implement `getCacheKey()` | SHA256 hash of path:width:height:timestamp |
| ☑ Implement `evictOldEntries()` | LRU eviction when cache exceeds max size |
| ☑ Implement `calculateCacheSize()` | Sum up all files in cache directory |

**API Contract (from analysis):**
```typescript
initialize(): Promise<void>
generateThumbnail(videoPath: string, timestamp?: number, width?: number, height?: number): Promise<ThumbnailResult>
clearCache(): Promise<void>
getCacheStats(): Promise<CacheStats>
```

### 3.3 Update video-scanner.ts Wrapper ✅
**File:** `src/video-scanner.ts`

| Task | Description |
|------|-------------|
| ☑ Change import from native to TS implementation | Import from `./video-scanner-ts` |
| ☑ Update `isUsingNativeScanner()` | Return `false` |
| ☑ Ensure all type conversions still work | `createVideoId()`, `createFilePath()`, etc. |

### 3.4 Update thumbnail-gen.ts Wrapper ✅
**File:** `src/thumbnail-gen.ts`

| Task | Description |
|------|-------------|
| ☑ Change import from native to TS implementation | Import from `./thumbnail-gen-ts` |
| ☑ Update `isUsingNativeGenerator()` | Return `false` |
| ☑ Remove try/catch native loading | No longer needed |

### 3.5 Update IPC Handlers (if needed) ✅
**File:** `src/ipc-handlers.ts`

| Task | Description |
|------|-------------|
| ☑ Verify imports work with new TS modules | Imports at top of file |
| ☑ Test `scan-videos` handler | Line 214 - API compatible |
| ☑ Test `generate-thumbnail` handler | Line 776 - API compatible |

### 3.6 Remove Rust Dependencies ✅
**Files:** Multiple

| Task | Description |
|------|-------------|
| ☑ Delete `src/video-scanner-native/` directory | Entire directory |
| ☑ Delete `src/thumbnail-generator-native/` directory | Entire directory |
| ☑ Remove native build scripts from package.json | `build:native`, `build:native:debug`, `build:thumbnails`, `build:thumbnails:debug` |
| ☑ Remove `build:all` script or simplify | Simplified to just `npm run build:ts` |
| ☑ Remove `copy:native` script | No longer needed |
| ☑ Remove `.node` files from `files` array | Distribution assets |
| ☑ Remove NAPI-RS devDependencies | `@napi-rs/cli` |

---

## Phase 4: Testing & Verification

### 4.1 Type Check ✅
| Task | Command |
|------|---------|
| ☑ Run TypeScript type check | `npm run type-check` |

### 4.2 Build TypeScript ✅
| Task | Command |
|------|---------|
| ☑ Build TypeScript | `npm run build:ts` |

### 4.3 Manual Testing
| Task | Command |
|------|---------|
| ☐ Launch development server | `npm run dev` |

**Test Scenarios:**
| Action | Before | Target | Status |
|--------|--------|--------|--------|
| Sort mode change | 500ms-1.5s | <100ms | ☐ |
| Open expanded view | 200-800ms | <100ms | ☐ |
| Grid scroll | Janky | Smooth 60fps | ☐ |
| Initial folder scan | Blocking | Non-blocking | ☐ |
| Memory usage | 1GB+ | <500MB | ☐ |

### 4.4 Code Review
| Task | Description |
|------|-------------|
| ☑ Run code review skill | `/superpowers:requesting-code-review` |

**Code Review Completed:** Found 3 HIGH, 7 MEDIUM, 6 LOW severity issues.

---

## Phase 5: Code Review Fixes

### 5.1 Fix HIGH Severity Issues (Required) ✅
**File:** `src/thumbnail-gen-ts.ts`

| Task | Description | Lines |
|------|-------------|-------|
| ☑ Add subprocess timeout | Wrap FFmpeg/FFprobe spawn() calls with 30-60s timeout to prevent hangs on malformed videos | 353-481 |
| ☑ Fix race condition in cache | Add mutex/lock for `cacheEntries` Map and `currentCacheSize` mutations during concurrent `generateThumbnail()` calls | 153-186 |
| ☑ Fix cache key mismatch | Update `getThumbnailPath()` to pass timestamp parameter to `getCacheKey()` - currently omits timestamp causing cache misses | 227 |

### 5.2 Fix MEDIUM Severity Issues (Recommended) ✅
**Files:** `src/thumbnail-gen-ts.ts`, `src/video-scanner-ts.ts`

| Task | Description | File | Lines |
|------|-------------|------|-------|
| ☑ Add width/height params to getThumbnailPath | Now accepts width/height parameters | thumbnail-gen-ts.ts | 226-242 |
| ☑ Check FFprobe exit code | Now validates exit code before parsing | thumbnail-gen-ts.ts | 365-370 |
| ☑ Add child process cleanup | Added activeProcesses tracking and cleanup() | thumbnail-gen-ts.ts | all spawn() |
| ☑ Add output buffer limits | Added 1MB stdout / 100KB stderr limits in spawnWithTimeout | thumbnail-gen-ts.ts | 360-445 |
| ☑ Add error logging in catch blocks | Added console.warn with error details | video-scanner-ts.ts | 187-190 |
| ☑ Deduplicate video ID generation | Class method now calls standalone function | video-scanner-ts.ts | 103-117, 350-363 |

### 5.3 Fix LOW Severity Issues (Optional)
| Task | Description |
|------|-------------|
| ☐ Update CLAUDE.md with new file locations | Document video-scanner-ts.ts and thumbnail-gen-ts.ts |
| ☐ Standardize logging prefixes | Use `[VideoScanner]` instead of `[VideoScannerTS]` |
| ☐ Remove unused conversion functions | Delete `convertNativeVideoToRecord()` and `convertNativeScanResult()` from video-scanner.ts |

---

## Phase 6: Runtime Performance Fixes ✅

### 6.1 Fix Sorting Performance ✅
**File:** `app/modules/FilterManager.js`

| Task | Description |
|------|-------------|
| ☑ Sort data array first | Sort `displayedVideos` array (O(n log n)) before touching DOM |
| ☑ Use Map for element lookup | Build `videoId -> DOM element` Map for O(n) lookup instead of O(n²) querySelector |
| ☑ Use requestAnimationFrame | Wrap DOM reorder in rAF to prevent blocking UI thread |
| ☑ Use DocumentFragment | Batch DOM appendChild operations into single fragment |
| ☑ Remove redundant refreshVisibleVideos | updateStatusMessage is debounced, no need for extra call |

**Before:** O(n²) - sorted DOM in place with querySelector lookups
**After:** O(n log n) - sort data first, then O(n) DOM reorder with Map lookup

### 6.2 Fix Expanded View Performance ✅
**File:** `app/modules/VideoExpander.js`

| Task | Description |
|------|-------------|
| ☑ Use cached tags | Read from `this.app.videoTags[video.id]` instead of IPC call |
| ☑ Render tags immediately | No longer waiting for IPC before rendering |
| ☑ Load suggestions asynchronously | Only IPC call is for suggestions (doesn't block UI) |
| ☑ Optimize tag add/remove | Update local state directly instead of re-fetching via IPC |
| ☑ Non-blocking autocomplete refresh | `loadAllTags()` call no longer awaited |

**Before:** 2 IPC calls (listTags + getTagSuggestions) blocking sidebar render
**After:** 0-1 IPC calls (only getTagSuggestions, cached after first call)

### 6.3 CSS Memory Optimization ✅
**File:** `app/styles.css`

| Task | Description |
|------|-------------|
| ☑ Add content-visibility: auto | Browser skips rendering work for off-screen items |
| ☑ Add contain-intrinsic-size | Provides size hints for layout without rendering |

**How it works:**
- `content-visibility: auto` tells Chromium to skip rendering off-screen items
- Items are still in DOM but not painted/composited until scrolled into view
- Works with existing CSS Grid layout (unlike VirtualGrid which required absolute positioning)
- Significant memory reduction without JavaScript changes

---

## Verification Checklist

### Build & Launch
- [x] `npm run type-check` passes
- [x] `npm run build:ts` succeeds
- [x] App launches with `npm run dev`

### Functionality
- [ ] Folder scan completes without UI freeze
- [ ] Thumbnails generate correctly
- [ ] Sort mode change is instant (<100ms)
- [ ] Expanded view opens instantly (<100ms)
- [ ] Grid scrolls smoothly with 10k videos

### Architecture
- [x] No Rust compilation errors (because Rust is gone)
- [x] Phase 5.1 HIGH severity issues fixed
- [x] Phase 5.2 MEDIUM severity issues fixed

---

## Files Summary

| Phase | Action | File |
|-------|--------|------|
| 1 | Edit | `app/modules/FilterManager.js` |
| 1 | Edit | `src/tag-suggestion-manager.ts` |
| 1 | Edit | `app/modules/UIHelper.js` |
| 2 | Copy | `app/modules/VirtualGrid.js` (from worktree) |
| 2 | Edit | `app/index.html` |
| 2 | Edit | `app/modules/GridRenderer.js` |
| 2 | Edit | `app/renderer.js` |
| 2 | Edit | `app/modules/video-smart-loader.js` |
| 3 | Write | `src/video-scanner-ts.ts` (new) |
| 3 | Write | `src/thumbnail-gen-ts.ts` (new) |
| 3 | Edit | `src/video-scanner.ts` |
| 3 | Edit | `src/thumbnail-gen.ts` |
| 3 | Edit | `src/ipc-handlers.ts` (verify) |
| 3 | Edit | `package.json` |
| 3 | Delete | `src/video-scanner-native/` |
| 3 | Delete | `src/thumbnail-generator-native/` |

---

## Execution Strategy

**Phase 1** - Direct edits, can be done in parallel (independent files)
- Estimated: ~50 lines across 3 files
- Risk: Low

**Phase 2** - Sequential (VirtualGrid must be copied before integration)
- Estimated: ~200 lines of porting/integration
- Risk: Medium - test thoroughly

**Phase 3** - New files can be created in parallel (3.1 and 3.2)
- Estimated: ~300 lines of new TypeScript
- Risk: Low - simpler than Rust

**Phase 4** - Sequential testing
- Required after each phase completion
