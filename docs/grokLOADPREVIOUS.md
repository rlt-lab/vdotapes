# Load Previous Folder Feature - Technical Analysis

## Overview

This document provides a deep technical analysis of VDOTapes' "previously loaded folder" mechanism. This feature automatically loads the last scanned folder when the application starts, providing continuity between sessions.

---

## ⚠️ ERRORS TO FIX

### Bug: Favorites-Only Filter Applied on Startup

**Symptom**: When loading the previous folder on startup, only ~1k favorite videos are displayed instead of all ~6.8k videos.

**Expected Behavior**: On startup, ALL videos should be displayed regardless of favorite status.

**Current Behavior**: Only favorite videos are shown, as if the favorites-only filter is active.

#### Diagnosis Steps

To identify the root cause, check the console logs for these debug messages added in recent changes:

```javascript
'[UserDataManager] BEFORE RESET - showingFavoritesOnly: ...'
'[UserDataManager] AFTER RESET - showingFavoritesOnly: ...'
'[UserDataManager] Reset and saved filter states to database'
'[FilterManager] applyCurrentFilters called with state: { ..., showingFavoritesOnly: ... }'
'[FilterManager] Filtered result: { displayedVideos: X, allVideos: Y, ... }'
```

**Key Questions to Answer**:
1. Is `showingFavoritesOnly: false` in the logs?
2. Is `allVideos` count ~6.8k or ~1k?
3. Is `displayedVideos` count ~1k?

**If allVideos = ~6.8k and displayedVideos = ~1k**:
- Bug is in **JavaScript filtering** (FilterManager.applyCurrentFilters)
- `showingFavoritesOnly` is somehow `true` when it should be `false`

**If allVideos = ~1k and displayedVideos = ~1k**:
- Bug is in **database query** (VideoOperations.getVideos)
- Database is filtering at SQL level

#### Possible Root Causes

**1. Query Cache Issue** (Most Likely)
- **Location**: `src/database/operations/VideoOperations.ts:410-415`
- **Problem**: The query cache might be returning stale results from a previous favorites-only query
- **Code**:
  ```typescript
  const cacheKey = 'getVideos';
  const cached = this.cache.get(cacheKey, filters);
  if (cached) {
    return cached as VideoRecord[];  // ← Returns old cached results
  }
  ```
- **Why this could happen**:
  - Cache uses `filters` as part of the cache key
  - But if cache comparison doesn't properly distinguish `{ sortBy: 'none' }` from `{ sortBy: 'none', favoritesOnly: true }`, it might return wrong results
  - Cache might not be cleared when folder changes
- **Fix**:
  - Add `console.log('[VideoOperations] getVideos cache hit/miss:', { filters, cached: !!cached });` before line 413
  - Clear cache when folder changes or on startup
  - Verify cache key includes all filter properties

**2. State Restoration Timing Issue**
- **Location**: `app/modules/UserDataManager.js:148-230`
- **Problem**: Something might be setting `showingFavoritesOnly = true` after the reset but before `applyCurrentFilters()`
- **Timeline**:
  ```
  loadSettings() starts (1000ms delay)
    ↓
  Load preferences (line 154) → preferences.favoritesOnly might be true
    ↓
  Reset state (line 164) → showingFavoritesOnly = false
    ↓
  Save reset (lines 170-179) → AWAITED
    ↓
  setTimeout 500ms → scanVideos
    ↓
  ??? Something sets showingFavoritesOnly = true ???
    ↓
  applyCurrentFilters() runs with showingFavoritesOnly = true
  ```
- **Check for**:
  - Any code reading `preferences.favoritesOnly` and setting app state
  - Any event handlers triggered during initialization
  - Any button click handlers firing during setup
- **Fix**: Add more logging around state changes

**3. Filter Object Mutation**
- **Location**: Between `renderer.js:133` and `VideoOperations.ts:457`
- **Problem**: The filters object `{ sortBy: 'none' }` might be getting modified to include `favoritesOnly: true`
- **Data flow**:
  ```
  renderer.js:133
    getVideos({ sortBy: 'none' })  // ← filters created here
      ↓
  preload.ts:32
    ipcRenderer.invoke('get-videos', filters)
      ↓
  ipc-handlers.ts:335
    this.database.getVideos(filters)  // ← could filters be modified?
      ↓
  VideoOperations.ts:405
    getVideos(filters: VideoFilters = {})
      ↓
  Line 457: if (filters.favoritesOnly) { ... }  // ← should be false
  ```
- **Check for**:
  - Any code that mutates the filters object
  - Any default filters being merged in
- **Fix**: Add `console.log('[IPC] handleGetVideos filters:', JSON.stringify(filters));` at ipc-handlers.ts:334

**4. Database State Issue**
- **Location**: `src/database/operations/VideoOperations.ts:457-459`
- **Problem**: The database might be using stored preferences to auto-apply favorite filter
- **Code**:
  ```typescript
  if (filters.favoritesOnly) {
    query += ' AND COALESCE(favorite, 0) = 1';
  }
  ```
- **Why this could happen**:
  - Maybe there's code that reads from settings and adds to filters?
  - Maybe filters defaults to including stored preferences?
- **Fix**: Add `console.log('[VideoOperations] SQL query:', query, 'params:', params);` before executing query

**5. Button State Triggering Filter**
- **Location**: `app/modules/FilterManager.js:88-110` (toggleFavoritesView)
- **Problem**: Maybe the favorites button's 'active' class is somehow triggering the filter
- **Why this could happen**:
  - Event handler might fire during initialization
  - CSS class change might trigger some observer
- **Check**: Are there any event listeners on the favorites button that might fire during setup?
- **Fix**: Add `console.log('[FilterManager] toggleFavoritesView called, showingFavoritesOnly:', this.app.showingFavoritesOnly);` at start of method

#### Recommended Debugging Code to Add

**In VideoOperations.ts:410** (before cache check):
```typescript
console.log('[VideoOperations] getVideos called with filters:', JSON.stringify(filters));
const cached = this.cache.get(cacheKey, filters);
console.log('[VideoOperations] Cache result:', cached ? `HIT (${cached.length} videos)` : 'MISS');
```

**In VideoOperations.ts:457** (before favorites filter):
```typescript
console.log('[VideoOperations] Building query, favoritesOnly =', filters.favoritesOnly, ', typeof:', typeof filters.favoritesOnly);
if (filters.favoritesOnly) {
  console.log('[VideoOperations] ADDING FAVORITES FILTER TO SQL QUERY');
  query += ' AND COALESCE(favorite, 0) = 1';
}
```

**In VideoOperations.ts:510** (after query execution):
```typescript
console.log('[VideoOperations] Query returned', result.length, 'videos');
console.log('[VideoOperations] First 3 videos:', result.slice(0, 3).map(v => ({ id: v.id, name: v.name, favorite: v.favorite })));
```

**In ipc-handlers.ts:334**:
```typescript
console.log('[IPC] handleGetVideos - received filters:', JSON.stringify(filters));
return this.database.getVideos(filters);
```

#### Expected Fix

Based on analysis, the most likely fix is:

**Clear query cache on folder change** in `ipc-handlers.ts:handleScanVideos()`:

```typescript
// After line 190 (when detecting new folder)
if (isNewFolder && lastFolder) {
  console.log(`[VideoScanner] Switching from ${lastFolder} to ${folderPath}, clearing old videos...`);
  this.clearVideosFromFolder(lastFolder);

  // ADD THIS: Clear query cache to prevent stale results
  this.database.clearQueryCache();  // ← Need to implement this method
}
```

**OR ensure cache key properly includes all filter properties**:

In `VideoOperations.ts`, change cache key to include filters:
```typescript
// Line 411 - OLD:
const cacheKey = 'getVideos';

// NEW:
const cacheKey = `getVideos:${JSON.stringify(filters)}`;
```

This ensures each unique filter combination gets its own cache entry.

---

## Feature Purpose

**Goal**: Remember the root folder path across application restarts and automatically reload it on startup.

**Important Distinction**:
- **Root Folder** (persists): The main directory selected via "Select Folder" button - THIS is what should persist
- **UI Filter States** (should NOT persist): Subfolder dropdown, favorites-only toggle, hidden-only toggle

## Architecture Components

### 1. Frontend (Renderer Process)

#### VdoTapesApp (app/renderer.js)
Main coordinator class that manages application state.

**Key State Variables**:
```javascript
this.currentFolder = '';           // Current subfolder filter (UI state)
this.showingFavoritesOnly = false; // Favorites filter (UI state)
this.showingHiddenOnly = false;    // Hidden filter (UI state)
```

**Key Methods**:
- `init()` - Lines 67-85: Initializes app, calls `loadSettings()`
- `scanVideos(folderPath)` - Lines 117-230: Scans folder, loads videos, saves last folder

#### UserDataManager (app/modules/UserDataManager.js)
Manages user preferences and settings persistence.

**Key Methods**:
- `loadSettings()` - Lines 148-230: **Entry point for auto-load on startup**
  - Loads preferences from database
  - **CRITICAL**: Resets filter states to defaults (lines 164-179)
  - Auto-loads last folder (lines 216-226)
- `saveSettings()` - Lines 232-244: Saves current state to database

#### FilterManager (app/modules/FilterManager.js)
Handles filtering and sorting operations.

**Key Methods**:
- `filterByFolder(folderName)` - Lines 9-14: Changes subfolder filter, saves settings
- `applyCurrentFilters()` - Lines 122-251: Applies current filter state to video list

### 2. Backend (Main Process)

#### IPCHandlers (src/ipc-handlers.ts)
Manages IPC communication between renderer and main processes.

**Key Handlers**:
- `handleScanVideos()` - Lines 168-224: Scans folder, clears old videos, syncs metadata
  - Checks if switching folders (lines 178-190)
  - Saves new folder as lastFolder (line 211)
- `handleGetUserPreferences()` - Lines 866-891: Returns user preferences including lastFolder
- `handleSaveUserPreferences()` - Lines 893-942: Saves user preferences to database

### 3. Database Layer

#### VideoDatabase (src/database/VideoDatabase.ts)
Main database interface, delegates to operation classes.

**Key Methods**:
- `saveLastFolder(folderPath: string)` - Line 344: Saves root folder path
- `getLastFolder()` - Line 348: Retrieves root folder path

#### SettingsOperations (src/database/operations/SettingsOperations.ts)
Manages all settings in SQLite database.

**Key Methods**:
- `saveLastFolder()` - Lines 142-144: Saves to 'lastFolder' key
- `getLastFolder()` - Lines 149-151: Gets from 'lastFolder' key
- `saveFolderFilter()` - Lines 184-186: Saves subfolder dropdown selection
- `getFolderFilter()` - Lines 191-193: Gets subfolder dropdown selection
- `saveFavoritesOnly()` - Lines 198-200: Saves favorites-only toggle
- `getFavoritesOnly()` - Lines 205-207: Gets favorites-only toggle
- `saveHiddenOnly()` - Lines 212-214: Saves hidden-only toggle
- `getHiddenOnly()` - Lines 219-221: Gets hidden-only toggle

**Generic Storage**:
- `saveSetting<T>()` - Lines 26-48: Generic key-value storage using JSON
- `getSetting<T>()` - Lines 53-79: Generic key-value retrieval

### 4. IPC Bridge

#### Preload (src/preload.ts)
Secure bridge between renderer and main process.

**Key Exposed Methods**:
```typescript
getLastFolder: () => ipcRenderer.invoke('get-last-folder')     // Line 59
saveLastFolder: (path) => ipcRenderer.invoke('save-last-folder', path)  // Line 60
getUserPreferences: () => ipcRenderer.invoke('get-user-preferences')    // Line 61
saveUserPreferences: (prefs) => ipcRenderer.invoke('save-user-preferences', prefs)  // Line 62
```

## Data Flow on Startup

### Sequence Diagram

```
App Startup
    |
    v
VdoTapesApp.init() (renderer.js:67)
    |
    | - Wait 500ms for main process
    | - Setup event listeners
    | - Initialize UI
    |
    v
UserDataManager.loadSettings() (UserDataManager.js:148)
    |
    | - Wait 1000ms additional delay
    |
    v
window.electronAPI.getUserPreferences() (preload.ts:61)
    |
    v
IPC: 'get-user-preferences'
    |
    v
IPCHandlers.handleGetUserPreferences() (ipc-handlers.ts:866)
    |
    v
VideoDatabase.getLastFolder() (VideoDatabase.ts:348)
    |
    v
SettingsOperations.getLastFolder() (SettingsOperations.ts:149)
    |
    v
SQLite: SELECT value FROM settings WHERE key = 'lastFolder'
    |
    v
Returns: { lastFolder: '/Users/videos', folderFilter: 'subfolder', ... }
    |
    v
UserDataManager.loadSettings() receives preferences
    |
    | CRITICAL: Reset filter states (lines 164-179)
    | - this.app.showingFavoritesOnly = false
    | - this.app.showingHiddenOnly = false
    | - this.app.currentFolder = ''  // Reset subfolder filter
    |
    | CRITICAL: Save reset states back to database
    | - await window.electronAPI.saveUserPreferences({
    |     folderFilter: '',
    |     favoritesOnly: false,
    |     hiddenOnly: false
    |   })
    |
    v
Auto-load last folder (lines 216-226)
    |
    | if (lastFolder exists)
    |   setTimeout(() => app.scanVideos(lastFolder), 500)
    |
    v
VdoTapesApp.scanVideos(lastFolder) (renderer.js:117)
    |
    v
window.electronAPI.scanVideos(folderPath) (preload.ts:28)
    |
    v
IPCHandlers.handleScanVideos() (ipc-handlers.ts:168)
    |
    | - Clear old videos from database
    | - Initialize folder metadata
    | - Scan directory for videos
    | - Save videos to database
    | - Sync folder metadata to database
    | - Save lastFolder to database
    |
    v
Returns scan result to renderer
    |
    v
VdoTapesApp processes results (renderer.js:131-230)
    |
    | - Load videos from database
    | - Load favorites, hidden files, tags
    | - Apply to video objects
    |
    v
applyCurrentFilters() (renderer.js:204)
    |
    v
FilterManager.applyCurrentFilters() (FilterManager.js:122)
    |
    | Filters videos based on:
    | - currentFolder (empty = show all)
    | - showingFavoritesOnly (false)
    | - showingHiddenOnly (false)
    | - activeTags (empty)
    |
    v
Display ALL videos from root folder
```

## Database Schema

### Settings Table

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,  -- JSON-encoded value
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Key Settings Stored

| Key | Type | Persists? | Purpose |
|-----|------|-----------|---------|
| `lastFolder` | string | ✓ YES | Root directory path - auto-loads on startup |
| `folderFilter` | string | ✗ NO | Subfolder dropdown selection - reset on startup |
| `favoritesOnly` | boolean | ✗ NO | Favorites-only toggle - reset on startup |
| `hiddenOnly` | boolean | ✗ NO | Hidden-only toggle - reset on startup |
| `gridColumns` | number | ✓ YES | Grid column count |
| `sortPreference` | object | ✓ YES | Sort mode and order |
| `windowState` | object | ✓ YES | Window size and position |

## The Subfolder Filter Bug (Fixed)

### Problem Description

**Expected Behavior**:
1. User selects root folder `/Users/videos` (has subfolders: Vacation, Family, Work)
2. App shows ALL videos from ALL subfolders
3. User filters to "Vacation" subfolder using dropdown
4. User closes app
5. On reopen: Shows ALL videos from `/Users/videos` (not just Vacation)

**Buggy Behavior (Before Fix)**:
- Step 5 would only show videos from "Vacation" subfolder
- The subfolder filter was incorrectly persisting across sessions

### Root Cause

**Location**: `app/modules/UserDataManager.js:161` (before fix)

**Buggy Code**:
```javascript
// Line 161 (BEFORE)
this.app.currentFolder = preferences.folderFilter || '';  // ❌ BUG
```

This loaded the saved subfolder filter preference on startup, causing only that subfolder's videos to display.

**Additional Issue**: Filter states were reset in app memory but NOT saved back to database, creating state inconsistency.

### The Fix (Implemented)

**Location**: `app/modules/UserDataManager.js:164-179`

**Fixed Code**:
```javascript
// Reset ALL filter states to defaults (lines 164-166)
this.app.showingFavoritesOnly = false;
this.app.showingHiddenOnly = false;
this.app.currentFolder = '';  // ✓ FIXED: Always reset to show all folders

// CRITICAL: Save reset states back to database (lines 170-179)
await window.electronAPI.saveUserPreferences({
  gridColumns: this.app.gridCols,
  sortPreference: { sortBy: this.app.currentSort },
  folderFilter: '',        // Reset to show all folders
  favoritesOnly: false,    // Reset to show all videos
  hiddenOnly: false,       // Reset to show non-hidden videos
});
```

**Why This Works**:
1. App state is reset to defaults in memory
2. **Reset values are immediately written back to database**
3. This ensures app state and database state stay synchronized
4. When `applyCurrentFilters()` runs, `currentFolder` is empty, showing all videos
5. User can still filter during session (filters are saved)
6. On next startup, filters are reset again

### Supporting Changes

**File**: `src/database/operations/SettingsOperations.ts` (lines 212-221)

Added `saveHiddenOnly()` and `getHiddenOnly()` methods to support persisting hidden-only state.

**File**: `src/ipc-handlers.ts` (lines 874, 903, 919-921)

Added `hiddenOnly` to `UserPreferences` interface and handler methods.

**File**: `src/database/VideoDatabase.ts` (lines 381-389)

Added delegation methods for `saveHiddenOnly()` and `getHiddenOnly()`.

**File**: `app/modules/FilterManager.js` (lines 123-128, 242-252)

Added debug logging to track filter state during application.

**File**: `app/renderer.js` (lines 7, 24-25, 134-136, 203)

Added debug logging to track state during initialization and scanning.

**File**: `src/database/operations/VideoOperations.ts` (lines 458, 465)

Fixed NULL handling for favorite and hidden fields using `COALESCE()`:
```sql
-- Before
WHERE favorite = 1
WHERE hidden = 0

-- After
WHERE COALESCE(favorite, 0) = 1  -- Treat NULL as 0
WHERE COALESCE(hidden, 0) = 0    -- Treat NULL as 0
```

## Key Implementation Details

### Auto-Load Timing

```javascript
// UserDataManager.js:148
async loadSettings() {
  // Wait 1000ms for main process to fully initialize
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Load preferences...

  // Auto-load last folder (lines 216-226)
  const lastFolder = await window.electronAPI.getLastFolder();
  if (lastFolder && lastFolder.trim() !== '') {
    // Wait additional 500ms for UI to initialize
    setTimeout(() => {
      this.app.scanVideos(lastFolder);
    }, 500);
  }
}
```

**Total delay**: ~1500ms from app start to folder scanning

### Folder Switching Logic

```typescript
// ipc-handlers.ts:178-190
const lastFolder = this.database.getLastFolder();
const isNewFolder = lastFolder !== folderPath;

if (isNewFolder && lastFolder) {
  // Switching folders - clear old videos
  this.clearVideosFromFolder(lastFolder);
} else if (!isNewFolder && lastFolder) {
  // Re-scanning same folder - clear to avoid duplicates
  this.clearVideosFromFolder(lastFolder);
}

// ... scan new folder ...

// Save as new lastFolder
this.database.saveLastFolder(folderPath);
```

### Filter Application Logic

```javascript
// FilterManager.js:122-251
applyCurrentFilters() {
  let filtered = this.app.allVideos;

  // 1. Folder filter
  if (this.app.currentFolder) {
    filtered = filtered.filter(v => v.folder === this.app.currentFolder);
  }
  // If empty: shows ALL folders ✓

  // 2. Favorites filter
  if (this.app.showingFavoritesOnly) {
    filtered = filtered.filter(v => v.isFavorite === true);
  }

  // 3. Hidden filter
  if (this.app.showingHiddenOnly) {
    filtered = filtered.filter(v => v.isHidden === true);
  } else {
    filtered = filtered.filter(v => !v.isHidden);
  }

  // 4. Tag filter
  if (this.app.activeTags.length > 0) {
    // ... tag filtering logic ...
  }

  this.app.displayedVideos = filtered;
  this.app.renderGrid();
}
```

## IPC Communication Flow

### Saving Last Folder

```
Renderer                           Main Process                    Database
   |                                    |                              |
   |  scanVideos(folderPath)           |                              |
   |---------------------------------->|                              |
   |                                   |                              |
   |                                   | saveLastFolder(folderPath)   |
   |                                   |----------------------------->|
   |                                   |                              |
   |                                   |           INSERT OR REPLACE  |
   |                                   |           INTO settings      |
   |                                   |           (key='lastFolder') |
   |                                   |                              |
   |  return scan result               |                              |
   |<----------------------------------|                              |
   |                                   |                              |
   |  saveLastFolder(folderPath)       |                              |
   |---------------------------------->|                              |
   |                                   |                              |
   |                                   | saveLastFolder(folderPath)   |
   |                                   |----------------------------->|
```

### Loading Last Folder

```
Renderer                           Main Process                    Database
   |                                    |                              |
   |  getUserPreferences()             |                              |
   |---------------------------------->|                              |
   |                                   |                              |
   |                                   | getLastFolder()              |
   |                                   |----------------------------->|
   |                                   |                              |
   |                                   |           SELECT value       |
   |                                   |           FROM settings      |
   |                                   |           WHERE key=...      |
   |                                   |                              |
   |                                   | <---return preferences       |
   |                                   |                              |
   |  <---return preferences object    |                              |
   |                                   |                              |
```

## Code Reference Map

### Frontend Entry Points
- **Auto-load trigger**: `app/modules/UserDataManager.js:216-226`
- **Filter reset**: `app/modules/UserDataManager.js:164-179`
- **Scan initiation**: `app/renderer.js:117-230`

### Backend Entry Points
- **IPC scan handler**: `src/ipc-handlers.ts:168-224`
- **IPC preferences getter**: `src/ipc-handlers.ts:866-891`
- **IPC preferences setter**: `src/ipc-handlers.ts:893-942`

### Database Operations
- **Save lastFolder**: `src/database/operations/SettingsOperations.ts:142-144`
- **Get lastFolder**: `src/database/operations/SettingsOperations.ts:149-151`
- **Generic setting storage**: `src/database/operations/SettingsOperations.ts:26-79`

### IPC Bridge
- **Preload API**: `src/preload.ts:59-62`
- **Type definitions**: `types/ipc.ts:111-114`

## Testing Checklist

To verify the feature works correctly:

1. ✓ **First-time selection**: Select a root folder, verify it saves
2. ✓ **Auto-load on restart**: Close and reopen app, verify folder loads automatically
3. ✓ **Show all videos**: Verify ALL videos from ALL subfolders display on startup
4. ✓ **Dropdown reset**: Verify folder dropdown shows "All Folders" on startup
5. ✓ **Session filtering**: Select a subfolder during session, verify it filters
6. ✓ **Filter persistence during session**: Filtered view persists during session
7. ✓ **Filter reset on restart**: Close and reopen, verify shows all folders again
8. ✓ **Favorites button reset**: Verify favorites button is inactive on startup
9. ✓ **Hidden button reset**: Verify hidden button is inactive on startup
10. ✓ **No empty states**: Verify no "no videos" message when videos exist

## Debug Logging

Key console logs to watch:

```javascript
// Startup sequence
'[App] VdoTapesApp constructor starting...'
'[App] Initial state - showingFavoritesOnly: false ...'
'[UserDataManager] Loading settings...'
'[UserDataManager] Loaded preferences from database: {...}'
'[UserDataManager] BEFORE RESET - showingFavoritesOnly: ...'
'[UserDataManager] AFTER RESET - showingFavoritesOnly: ...'
'[UserDataManager] Saving reset filter state to database...'
'[UserDataManager] Reset and saved filter states to database'
'[UserDataManager] Auto-loading last folder: /Users/videos'

// Scan sequence
'[App] getVideos returned 150 videos from database'
'[App] Using database videos, allVideos.length = 150'
'[App] About to apply filters - showingFavoritesOnly: false ...'

// Filter application
'[FilterManager] applyCurrentFilters called with state: {...}'
'[FilterManager] Filtered result: displayedVideos: 150 ...'
```

## Related Files

- `docs/PREVFOLDER_REF.md` - Original bug analysis and fix documentation
- `CLAUDE.md` - Project overview and architecture
- `types/ipc.ts` - IPC type definitions
- `types/core.ts` - Core type definitions

## Summary

The "load previous folder" feature is a multi-layer system that:

1. **Saves** the root folder path when scanning (`lastFolder` setting)
2. **Loads** preferences on startup including `lastFolder`
3. **Resets** UI filter states (subfolder, favorites, hidden) to defaults
4. **Saves** the reset filter states back to database for consistency
5. **Auto-scans** the `lastFolder` after a delay
6. **Displays** ALL videos from the root folder with no filters active

The key insight is that `lastFolder` (root directory) persists across sessions, while UI filter states (`folderFilter`, `favoritesOnly`, `hiddenOnly`) are intentionally reset on each startup to provide a consistent, predictable user experience.
