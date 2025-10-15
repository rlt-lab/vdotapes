# Testing Per-Folder Persistence

**Quick Test Guide for Per-Folder Metadata Storage**

---

## What Was Implemented

Migrated from global database to per-folder storage:
1. **Last folder** - Auto-loads on launch ✅
2. **Favorites** - Stored in folder's `.vdotapes/metadata.json` file ✅
3. **Hidden videos** - Stored in folder's `.vdotapes/metadata.json` file ✅
4. **Ratings & Tags** - Ready for future use ✅

**Why Per-Folder?**
- Metadata travels with videos when you move folders
- Each folder has its own favorites/hidden list
- Portable and easy to backup
- No global database conflicts

---

## How to Test

### Test 1: Last Folder Persistence

**Step 1**: Start fresh
```bash
npm run dev
```

**Step 2**: Load a folder
1. Click "Select Video Folder"
2. Choose any folder with videos
3. Wait for videos to load
4. Check console for: `[App] Saved last folder: /path/to/folder`

**Step 3**: Close and reopen
1. Quit the app completely
2. Start again: `npm run dev`
3. **Expected**: 
   - Console shows: `[UserDataManager] Auto-loading last folder: /path/to/folder`
   - Videos load automatically
   - Grid displays without clicking "Select Folder"

✅ **Pass**: Videos load automatically on launch  
❌ **Fail**: Need to select folder again

---

### Test 2: Favorites Persistence (Per-Folder)

**Step 1**: Favorite some videos
1. Load videos if not already loaded
2. Click the heart icon on 3-5 videos
3. Verify hearts turn red/filled
4. Check console for:
   - `[FolderMetadata] Added favorite: <video-id>`
   - `[FolderMetadata] Saved metadata to /path/to/folder/.vdotapes/metadata.json`

**Step 2**: Verify file created
1. Open the video folder in Finder/Explorer
2. Look for hidden folder: `.vdotapes/`
3. Inside should be: `metadata.json`
4. Open metadata.json - should contain:
   ```json
   {
     "version": "1.0.0",
     "folderPath": "/path/to/videos",
     "lastUpdated": "2024-...",
     "favorites": ["video-1-id", "video-2-id", ...],
     "hidden": [],
     "ratings": {},
     "tags": {}
   }
   ```

**Step 3**: Close and reopen
1. Quit the app
2. Start again: `npm run dev`
3. Wait for videos to auto-load
4. **Expected**:
   - Console shows: `[FolderMetadata] Loaded metadata from /path/to/folder`
   - Console shows: `[FolderMetadata] X favorites, Y hidden`
   - Heart icons are filled/red for favorited videos

✅ **Pass**: Hearts stay filled + metadata.json exists  
❌ **Fail**: Hearts reset or no file created

---

### Test 3: Hidden Files Persistence

**Step 1**: Hide some videos
1. Right-click on a video
2. Select "Hide" (or use hide toggle if available)
3. Verify video is hidden
4. Check console for: `[App] Applied X hidden files to videos`

**Step 2**: Close and reopen
1. Quit the app
2. Start again: `npm run dev`
3. Wait for videos to auto-load
4. **Expected**:
   - Console shows: `[UserDataManager] Loaded X hidden files`
   - Console shows: `[App] Applied X hidden files to videos`
   - Hidden videos stay hidden

✅ **Pass**: Hidden state persists  
❌ **Fail**: Videos become visible again

---

## Console Output to Look For

### On App Launch (Good)
```
[UserDataManager] Loading settings...
[UserDataManager] Preferences loaded: { gridCols: 4, sort: 'folder', ... }
[UserDataManager] Auto-loading last folder: /Users/you/Videos
[IPC] Folder metadata: 5 favorites, 2 hidden
[FolderMetadata] Loaded metadata from /Users/you/Videos
[FolderMetadata] 5 favorites, 2 hidden
[App] Applied 5 favorites to videos
[App] Applied 2 hidden files to videos
```

### On Folder Scan (Good)
```
[IPC] Starting video scan for folder: /Users/you/Videos
[FolderMetadata] Loaded metadata from /Users/you/Videos
[FolderMetadata] 5 favorites, 2 hidden
Scan complete: 50 videos
[App] Applied 5 favorites to videos
[App] Applied 2 hidden files to videos
[App] Saved last folder: /Users/you/Videos
```

### On Favorite Toggle (Good)
```
[FolderMetadata] Added favorite: video-id-123
[FolderMetadata] Saved metadata to /path/.vdotapes/metadata.json
```

---

## Debug Commands

### Check What's Being Saved

```javascript
// In browser console after loading videos

// Check favorites
app.favorites
// Should show Set with video IDs

// Check hidden files
app.hiddenFiles  
// Should show Set with video IDs

// Check last folder (via API)
await window.electronAPI.getLastFolder()
// Should return the folder path
```

### Verify Persistence

```javascript
// After restart, check if loaded correctly

// Should match what was saved
app.favorites.size
app.hiddenFiles.size

// Check if videos have the properties
app.allVideos.filter(v => v.isFavorite === true).length
app.allVideos.filter(v => v.isHidden === true).length
```

---

## Troubleshooting

### Last Folder Not Auto-Loading

**Check 1**: Is the path saved?
```javascript
await window.electronAPI.getLastFolder()
// Should return a path, not null or empty
```

**Check 2**: Check console for errors
```
Look for: "Error loading settings" or "Error scanning videos"
```

**Fix**: Make sure you closed the app completely before reopening

---

### Favorites Not Persisting

**Check 1**: Are they being saved?
```javascript
// After favoriting a video, check:
await window.electronAPI.getFavorites()
// Should include the video ID
```

**Check 2**: Are they being applied?
```javascript
// After restart:
app.allVideos.find(v => v.id === 'some-video-id')
// Check if .isFavorite is true
```

**Fix**: Make sure database write succeeded (check console for errors)

---

### Hidden Files Not Persisting

**Check 1**: Are they being saved?
```javascript
await window.electronAPI.getHiddenFiles()
// Should include the video ID
```

**Check 2**: Are they being applied?
```javascript
app.allVideos.find(v => v.id === 'some-video-id')
// Check if .isHidden is true
```

---

## Expected Behavior Summary

| Feature | Before Fix | After Fix |
|---------|-----------|-----------|
| Last Folder | Must select every time | Auto-loads on launch ✅ |
| Favorites | Reset on restart | Persist and display ✅ |
| Hidden Files | Reset on restart | Persist and stay hidden ✅ |

---

## What Changed

**New Files Created**:
1. `src/folder-metadata.ts` ✨
   - FolderMetadataManager class
   - Handles `.vdotapes/metadata.json` per folder
   - Methods for favorites, hidden, ratings, tags
   - Auto-saves on every change

**Files Modified**:
1. `src/ipc-handlers.ts`
   - Import FolderMetadataManager
   - Initialize folder metadata on scan
   - Use folder storage for favorites (instead of database)
   - Use folder storage for hidden files (instead of database)

2. `app/modules/UserDataManager.js`
   - Auto-load last folder on startup
   - Enhanced logging

3. `app/renderer.js`
   - Save last folder after scanning
   - Apply favorites/hidden to video objects
   - Enhanced logging

**Architecture Change**:
- **Before**: SQLite database with global favorites/hidden
- **After**: JSON file per folder with folder-specific metadata

---

## Quick Test Script

Run this after each restart to verify:

```javascript
// Paste in console after app loads

const report = {
  lastFolder: await window.electronAPI.getLastFolder(),
  favoritesCount: app.favorites.size,
  hiddenCount: app.hiddenFiles.size,
  videosWithFavorites: app.allVideos.filter(v => v.isFavorite).length,
  videosWithHidden: app.allVideos.filter(v => v.isHidden).length,
  autoLoaded: app.allVideos.length > 0
};

console.table(report);

// All numbers should match after restart!
```

---

## Success Criteria

✅ App automatically loads last folder on launch  
✅ Favorited videos show red hearts after restart  
✅ Hidden videos stay hidden after restart  
✅ Console shows successful load messages  
✅ No errors in console  

---

**Test it and let me know if persistence is working!** 🎉
