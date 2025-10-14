# Renderer.js Refactoring Plan

**Current State**: 2,260 lines  
**Target**: Under 500 lines  
**Goal**: Extract ~1,760 lines into focused, reusable modules

## Analysis Summary

The `app/renderer.js` file is a monolithic class handling too many responsibilities:
- Video scanning and data management
- Grid rendering (multiple strategies)
- Video loading and playback
- Filtering and sorting
- Favorites and hidden file management
- Multi-view mode
- Context menus
- UI state management
- Event handling
- Settings persistence

## Refactoring Strategy

### Phase 1: Extract Video Management (Remove ~400 lines)

**Create: `app/modules/VideoManager.js`**
- Handles video loading, playback, and lifecycle
- Includes preview loop logic
- Manages video element state

**Extract these methods** (~250 lines):
- `loadVideo()` (103 lines)
- `startVideoPlayback()`
- `setupPreviewLoop()` (55 lines)
- `resumeVideo()`
- `pauseVideo()`
- `handleVideoVisible()`
- `addRetryButton()`
- `loadVideoById()`
- `unloadVideoById()`

**Create: `app/modules/VideoExpander.js`**
- Handles expanded video view
- Manages navigation between videos

**Extract these methods** (~100 lines):
- `expandVideo()`
- `closeExpanded()`
- `navigateExpanded()`
- `refreshExpandedSidebar()` (74 lines)

**Benefits**:
- Cleaner separation of concerns
- Video loading logic reusable across different views
- Easier to test and maintain
- Reduces renderer.js by ~400 lines

---

### Phase 2: Extract Filter & Sort System (Remove ~300 lines)

**Create: `app/modules/FilterManager.js`**
- Centralized filtering and sorting logic
- Manages favorites/hidden filters

**Extract these methods** (~300 lines):
- `applyCurrentFilters()` (104 lines)
- `applyFiltersInPlace()`
- `reorderGridInPlace()`
- `filterByFolder()`
- `setSortMode()`
- `updateSortButtonStates()`
- `shuffleVideos()`
- `toggleFavoritesView()`
- `toggleHiddenView()`
- `refreshVisibleVideos()`

**Benefits**:
- Single source of truth for filter state
- Can be tested independently
- Easy to add new filter types
- Reduces renderer.js by ~300 lines

---

### Phase 3: Extract Grid Rendering (Remove ~350 lines)

**Create: `app/modules/GridRenderer.js`**
- Handles all grid rendering strategies
- Creates video item HTML
- Manages DOM operations

**Extract these methods** (~350 lines):
- `renderGrid()`
- `renderVirtualGrid()`
- `renderWasmGrid()`
- `renderSmartGrid()`
- `renderVirtualizedGrid()`
- `renderTraditionalGrid()`
- `createVideoItemHTML()` (36 lines)
- `createMetadataBadges()` (35 lines)
- `applyDomOperations()` (67 lines)
- `observeVideoItemsWithSmartLoader()`
- `observeVideoItems()`
- `attachVideoItemListeners()`

**Benefits**:
- Grid rendering strategies in one place
- Easier to add new rendering modes
- Better performance optimization opportunities
- Reduces renderer.js by ~350 lines

---

### Phase 4: Extract User Data Management (Remove ~250 lines)

**Create: `app/modules/UserDataManager.js`**
- Manages favorites and hidden files
- Handles all user preference mutations

**Extract these methods** (~250 lines):
- `toggleFavorite()` (72 lines)
- `toggleHiddenFile()` (68 lines)
- `updateFavoritesCount()`
- `updateHiddenCount()`
- `refreshFavoritesFromDatabase()`
- `loadSettings()` (72 lines)
- `saveSettings()`

**Benefits**:
- User data operations centralized
- Can sync with backend independently
- Easier to add undo/redo
- Reduces renderer.js by ~250 lines

---

### Phase 5: Extract Event System (Remove ~300 lines)

**Create: `app/modules/EventController.js`**
- Centralized event listener setup
- Context menu handling
- Keyboard shortcuts

**Extract these methods** (~300 lines):
- `setupEventListeners()` (189 lines!)
- `setupContextMenu()` (82 lines)
- `showContextMenu()`
- `hideContextMenu()`

**Benefits**:
- Event handling in dedicated module
- Easier to add/remove shortcuts
- Better event debugging
- Reduces renderer.js by ~300 lines

---

### Phase 6: Extract UI Utilities (Remove ~200 lines)

**Create: `app/modules/UIHelper.js`**
- UI state changes (loading, progress, status)
- Formatting utilities
- Multi-view management

**Extract these methods** (~200 lines):
- `showLoading()`
- `showProgress()`
- `updateProgress()`
- `hideProgress()`
- `showMetadataProgress()` (35 lines)
- `showStatus()`
- `updateStatusMessage()`
- `showEmptyState()`
- `formatFileSize()`
- `formatDuration()`
- `formatVideoInfo()` (29 lines)
- `updateGridSize()`
- `setGridCols()`
- `handleResize()`
- `addToMultiView()`
- `showMultiView()` (34 lines)
- `closeMultiView()`
- `toggleMultiView()`
- `updateMultiViewCount()`

**Benefits**:
- UI utilities reusable
- Consistent UI state management
- Reduces renderer.js by ~200 lines

---

### Phase 7: Consolidate & Clean (Remove ~160 lines)

**Remaining in renderer.js** (~460 lines):
- Constructor and core initialization (~50 lines)
- WASM/Smart loader setup (~80 lines)
- Folder selection and video scanning (~130 lines)
- Folder dropdown management (~20 lines)
- Module coordination and orchestration (~180 lines)

**Additional cleanup**:
- Remove duplicate code
- Consolidate similar methods
- Use composition over inheritance
- Delegate to extracted modules

---

## Implementation Order

### Step 1: Create Module Structure (Day 1)
```
app/modules/
  ├── VideoManager.js       # Video loading & playback
  ├── VideoExpander.js      # Expanded view
  ├── FilterManager.js      # Filtering & sorting
  ├── GridRenderer.js       # Grid rendering
  ├── UserDataManager.js    # Favorites & hidden
  ├── EventController.js    # Event handling
  └── UIHelper.js           # UI utilities
```

### Step 2: Extract VideoManager (Day 1-2)
- Copy methods to new module
- Add proper interfaces
- Update renderer.js to use module
- Test video loading still works

### Step 3: Extract VideoExpander (Day 2)
- Move expansion logic
- Integrate with EventController
- Test expanded view

### Step 4: Extract FilterManager (Day 2-3)
- Move filter logic
- Add filter state management
- Test all filter combinations

### Step 5: Extract GridRenderer (Day 3-4)
- Move rendering methods
- Test all rendering modes
- Verify WASM integration

### Step 6: Extract UserDataManager (Day 4)
- Move favorites/hidden logic
- Test database integration
- Verify settings persistence

### Step 7: Extract EventController (Day 4-5)
- Move event setup
- Test all shortcuts and interactions
- Verify context menu

### Step 8: Extract UIHelper (Day 5)
- Move UI utilities
- Test progress indicators
- Verify multi-view mode

### Step 9: Final Integration & Testing (Day 5-6)
- Verify all features work
- Remove dead code
- Add JSDoc comments
- Performance testing

---

## Module Communication Pattern

```javascript
// Renderer becomes the coordinator
class VdoTapesApp {
  constructor() {
    // Initialize modules
    this.videoManager = new VideoManager(this);
    this.filterManager = new FilterManager(this);
    this.gridRenderer = new GridRenderer(this);
    this.userDataManager = new UserDataManager(this);
    this.eventController = new EventController(this);
    this.uiHelper = new UIHelper(this);
    this.videoExpander = new VideoExpander(this);
  }
  
  // Core coordination only
  async scanVideos(path) {
    // Delegate to modules
  }
  
  applyFilters() {
    const filtered = this.filterManager.applyFilters(this.allVideos);
    this.gridRenderer.render(filtered);
  }
}
```

---

## Expected Results

### Before Refactoring
```
renderer.js: 2,260 lines
Total: 2,260 lines
```

### After Refactoring
```
renderer.js: ~460 lines (core coordinator)
modules/VideoManager.js: ~250 lines
modules/VideoExpander.js: ~100 lines
modules/FilterManager.js: ~300 lines
modules/GridRenderer.js: ~350 lines
modules/UserDataManager.js: ~250 lines
modules/EventController.js: ~300 lines
modules/UIHelper.js: ~200 lines
Total: ~2,210 lines (50 lines saved through consolidation)
```

**Main file reduction**: 2,260 → 460 lines (**80% reduction**)

---

## Success Criteria

1. ✅ Renderer.js under 500 lines
2. ✅ All modules under 400 lines each
3. ✅ Clear separation of concerns
4. ✅ All existing features work
5. ✅ No performance regression
6. ✅ Easier to test individual components
7. ✅ Improved code maintainability

---

## Testing Strategy

### Per Module
- Unit tests for each module
- Mock dependencies
- Test edge cases

### Integration
- Full app smoke test
- Video loading/playback
- Filtering and sorting
- Favorites and hidden files
- Multi-view mode
- Keyboard shortcuts
- Context menu

### Performance
- Video loading time
- Grid rendering speed
- Filter application speed
- Memory usage

---

## Rollback Plan

- Create feature branch for refactoring
- Keep original renderer.js in git history
- Test thoroughly before merging
- Can revert if critical issues found

---

## Future Enhancements (Post-Refactoring)

Once modularized:
1. Add TypeScript interfaces for better type safety
2. Implement proper state management (e.g., simple pub/sub)
3. Add unit tests for each module
4. Create plugin system for new filter types
5. Add drag-and-drop video reordering
6. Implement virtual scrolling for huge collections

---

## Notes

- Maintain backward compatibility with existing WASM modules
- Keep smart loader integration intact
- Preserve all keyboard shortcuts
- Don't break context menu functionality
- Maintain performance characteristics

---

## Implementation Status

### ✅ REFACTORING COMPLETE! (7/7 Modules)

✅ **VideoManager.js** (251 lines)
- Video loading with retry logic & exponential backoff
- Playback management
- Preview loop setup
- Load/unload by ID

✅ **VideoExpander.js** (128 lines)
- Expanded video view
- Navigation between videos
- Sidebar refresh logic
- Tag rendering

✅ **FilterManager.js** (256 lines)
- Filter application (WASM and JS fallback)
- Sorting logic (folder, date, shuffle)
- Favorites/hidden view toggles
- In-place filtering

✅ **GridRenderer.js** (270 lines)
- Multiple rendering strategies (Virtual, WASM, Smart)
- HTML generation for video items
- Metadata badges
- Observer setup

✅ **UserDataManager.js** (212 lines)
- Favorites management
- Hidden files management
- Settings load/save
- Count updates

✅ **EventController.js** (346 lines)
- Event listener setup
- Context menu handling
- Keyboard shortcuts
- Backup menu controls

✅ **UIHelper.js** (244 lines)
- UI state management
- Progress indicators
- Multi-view mode
- Formatting utilities

✅ **Renderer.js** (358 lines - **84% reduction!**)
- Module coordinator
- Core state management
- WASM engine setup
- Video scanning orchestration

### Results

**Before**: 2,259 lines in single file
**After**: 358 lines (coordinator) + 1,707 lines (7 modules) = 2,065 lines total
**Line reduction**: 194 lines saved through consolidation
**Main file reduction**: 1,901 lines removed (**84% smaller!**)

### Files Modified

- ✅ `app/renderer.js` - Refactored to 358 lines
- ✅ `app/index.html` - Updated to load modules
- ✅ `app/modules/VideoManager.js` - Created
- ✅ `app/modules/VideoExpander.js` - Created
- ✅ `app/modules/FilterManager.js` - Created
- ✅ `app/modules/GridRenderer.js` - Created
- ✅ `app/modules/UserDataManager.js` - Created
- ✅ `app/modules/EventController.js` - Created
- ✅ `app/modules/UIHelper.js` - Created
