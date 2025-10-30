# Previous Folder Feature - Implementation Reference

## How It SHOULD Work

### Expected Behavior

1. **First Run**: User selects a root directory (e.g., `/Users/videos`)
2. **App Remembers**: The root directory path is saved to database as `lastFolder`
3. **On Reopen**: App automatically loads that root directory showing ALL subfolders and videos
4. **Session Filters**: During a session, user can:
   - Use dropdown to filter to a specific subfolder (e.g., "Vacation 2024")
   - Toggle favorites-only view
   - These are temporary UI filters for the current session
5. **On Next Reopen**: App should reset to showing ALL videos from the root directory, NOT the filtered subfolder

### Key Distinction

- **Root Folder** (persists): The main directory selected via "Select Folder" button
- **Subfolder Filter** (should NOT persist): The dropdown selection for filtering within that root folder
- **Other UI Filters** (should NOT persist): Favorites-only, hidden-only toggles

## How It CURRENTLY Works (Before Fix)

### What Works ✓

1. **Root folder persistence** - WORKS CORRECTLY
   - Root directory is saved: `SettingsOperations.ts:142-144` (`saveLastFolder`)
   - Root directory is loaded: `UserDataManager.js:199-208` (auto-loads after 500ms)
   - Database is cleared and rescanned properly: `ipc-handlers.ts:167-223`

### What's Broken ✗

2. **Subfolder filter persistence** - BUG: INCORRECTLY PERSISTS
   - When user selects a subfolder from dropdown, `FilterManager.js:9-14` saves it to database
   - On startup, `UserDataManager.js:161` loads this subfolder filter: `this.app.currentFolder = preferences.folderFilter || ''`
   - When scanning completes, `renderer.js:197` calls `applyCurrentFilters()`
   - This applies the saved subfolder filter, showing only videos from that subfolder instead of ALL folders

3. **Favorites-only filter** - EDGE CASE
   - Correctly reset on startup: `UserDataManager.js:159` sets `showingFavoritesOnly = false`
   - Buttons correctly reset: `UserDataManager.js:172-173` removes 'active' class
   - However, the preference is still SAVED during the session: `UserDataManager.js:220`
   - The appearance of favorites-only filtering on startup is likely caused by the subfolder filter bug

## Root Causes

### Bug #1: Subfolder Filter Persisting Across Sessions

- **Location**: `app/modules/UserDataManager.js:161`
- **Code**: `this.app.currentFolder = preferences.folderFilter || ''`
- **Problem**: This line loads the saved subfolder filter preference on startup
- **Impact**: When the root folder is scanned, the UI only shows videos from the saved subfolder

### Bug #2: Favorites-Only View Sometimes Persisting

- **Location**: `app/modules/UserDataManager.js:159-161`
- **Problem**: App state is reset but database still has old values
  - `this.app.showingFavoritesOnly = false` (app state reset ✓)
  - But database still has `favoritesOnly: true` (database not updated ✗)
- **Impact**: If any code reads from the database instead of app state, it gets wrong values
- **Related**: Same issue for `folderFilter` and `hiddenOnly` settings

## The Solution

The fix requires two parts:
1. Reset the app state filter values
2. Save the reset values back to the database to ensure consistency

### Code Changes Required

**File**: `app/modules/UserDataManager.js`

**Location**: Lines 158-178

**Before (Buggy)**:
```javascript
// Don't restore favorites-only or hidden-only state - always show all videos on startup
this.app.showingFavoritesOnly = false;
this.app.showingHiddenOnly = false;
this.app.currentFolder = preferences.folderFilter || '';  // ❌ BUG: This persists the subfolder filter

const gridInput = document.getElementById('gridCols');
if (gridInput) gridInput.value = this.app.gridCols;
const gridCount = document.getElementById('gridColsCount');
if (gridCount) gridCount.textContent = String(this.app.gridCols);
const folderSel = document.getElementById('folderSelect');
if (folderSel) folderSel.value = this.app.currentFolder;  // ❌ Shows saved subfolder
```

**After (Fixed)**:
```javascript
// Don't restore favorites-only, hidden-only, or folder filter state - always show all videos on startup
this.app.showingFavoritesOnly = false;
this.app.showingHiddenOnly = false;
this.app.currentFolder = '';  // ✓ Reset to show ALL folders

// Immediately save reset filter state to database to ensure consistency
await window.electronAPI.saveUserPreferences({
  gridColumns: this.app.gridCols,
  sortPreference: { sortBy: this.app.currentSort },
  folderFilter: '',  // Reset to show all folders
  favoritesOnly: false,  // Reset to show all videos
  hiddenOnly: false,  // Reset to show non-hidden videos
});
console.log('[UserDataManager] Reset and saved filter states to database');

const gridInput = document.getElementById('gridCols');
if (gridInput) gridInput.value = this.app.gridCols;
const gridCount = document.getElementById('gridColsCount');
if (gridCount) gridCount.textContent = String(this.app.gridCols);
const folderSel = document.getElementById('folderSelect');
if (folderSel) folderSel.value = '';  // ✓ Set to "All Folders"
```

### Why This Works

1. The root folder path (`lastFolder`) is still correctly saved and loaded
2. The root folder is still automatically scanned on startup
3. The subfolder filter (`currentFolder`) is reset to empty string in app state
4. **CRITICAL**: The reset values are immediately saved back to the database
   - This ensures both app state AND database state are synchronized
   - Prevents any code that reads from database from getting stale filter values
5. This makes `applyCurrentFilters()` show ALL videos from ALL subfolders
6. User can still filter during the session (filters are still saved)
7. But on next startup, filters are reset to show everything

## Implementation Plan

### Step 1: Update UserDataManager.js

**File**: `app/modules/UserDataManager.js`

1. Line 158: Update comment to include folder filter
2. Line 161: Change `this.app.currentFolder = preferences.folderFilter || ''` to `this.app.currentFolder = ''`
3. **NEW** Lines 163-171: Add database save call to persist reset filter state
   - Save `folderFilter: ''`
   - Save `favoritesOnly: false`
   - Save `hiddenOnly: false`
4. Line 178: Change `if (folderSel) folderSel.value = this.app.currentFolder` to `if (folderSel) folderSel.value = ''`

### Step 2: Testing Checklist

After implementation, verify:

1. ✓ First-time folder selection saves correctly
2. ✓ Root folder loads on app restart
3. ✓ ALL videos from ALL subfolders show on startup
4. ✓ Folder dropdown shows "All Folders" (empty value) on startup
5. ✓ Can manually select a subfolder during session
6. ✓ Subfolder filter persists during session (temporary)
7. ✓ On next restart, shows ALL folders again (not the filtered subfolder)
8. ✓ Favorites-only button is inactive on startup
9. ✓ Hidden-only button is inactive on startup
10. ✓ No race conditions or timing issues

## Technical Details

### Data Flow on Startup

1. **UserDataManager.loadSettings()** (line 148)
   - Waits for SETTINGS_LOAD_DELAY (1000ms)
   - Loads preferences from database
   - Sets `showingFavoritesOnly = false` (line 159)
   - Sets `showingHiddenOnly = false` (line 160)
   - **SHOULD** set `currentFolder = ''` (line 161) ← FIX HERE
   - Updates UI elements
   - Auto-loads last folder (lines 199-208)

2. **scanVideos()** triggered (renderer.js:114)
   - Scans root folder
   - Loads videos from database
   - Loads favorites and applies to videos
   - Loads hidden files
   - Loads tags
   - Calls `applyCurrentFilters()` (line 197)

3. **applyCurrentFilters()** (FilterManager.js:122)
   - Checks `this.app.currentFolder`
   - If empty: shows ALL folders ✓
   - If set: filters to that subfolder ✗ (bug)

### Why Subfolder Filter Should NOT Persist

The `folderFilter` setting serves two purposes:
1. **During session**: Tracks current UI state for filter application
2. **Across sessions**: Previously used to restore state (incorrect behavior)

The fix changes behavior #2 while preserving #1:
- The setting is still saved during the session
- But it's always reset to empty on startup
- This matches the pattern already used for `favoritesOnly` and `hiddenOnly`

### Database Schema

**Settings Table** (database/core/DatabaseCore.ts):
- `lastFolder`: Root directory path (SHOULD persist) ✓
- `folderFilter`: Subfolder dropdown selection (should NOT persist) ← FIXED
- `favoritesOnly`: Favorites-only toggle (correctly does NOT persist) ✓
- `showHiddenFiles`: Hidden-only toggle (correctly does NOT persist) ✓

## Verification After Fix

After implementing the fix, the behavior should be:

1. **User opens app**: Shows ALL folders from root directory
2. **User filters to "Vacation 2024" subfolder**: Only shows those videos
3. **User closes app**: Filter is saved (for session continuity during development)
4. **User reopens app**: Shows ALL folders again (filter was reset)

This ensures a consistent, predictable startup state while preserving the ability to save preferences that DO make sense to persist (like grid columns, sort order, window size, etc.).
