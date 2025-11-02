# Fix 1: Eliminate N+1 Tag Query Problem

## Problem Statement

**Location:** `app/renderer.js:179-189`

**Current Code:**
```javascript
// Loading tags for all videos
console.log('[App] Loading tags for all videos...');
this.videoTags = {};
let totalTags = 0;
for (const video of this.allVideos) {
  try {
    const tags = await window.electronAPI.listTags(video.id);
    if (tags && tags.length > 0) {
      this.videoTags[video.id] = tags;
      totalTags += tags.length;
    }
  } catch (error) {
    console.error(`Error loading tags for ${video.id}:`, error);
  }
}
```

**Issue:** For a library with 1000 videos, this makes 1000+ IPC calls and database queries, causing 5-15 second delays on startup.

## Impact

- **Performance:** 5-15 second startup delay for large libraries
- **Priority:** CRITICAL
- **Effort:** 30 minutes
- **Expected Improvement:** 95% reduction in tag loading time

## Solution Overview

Replace individual tag queries with a single batch operation that retrieves all video tags in one database query.

## Implementation Steps

### Step 1: Add Batch Method to TagOperations (Backend)

**File:** `src/database/operations/TagOperations.ts`

Add this method after line 100:

```typescript
/**
 * Get all video tags in a single query (batch operation)
 * Returns a map of videoId -> tag names
 */
getAllVideoTags(): Map<VideoId, string[]> {
  if (!this.core.isInitialized()) {
    return new Map();
  }

  const monitoredQuery = this.monitor.wrapQuery('getAllVideoTags', () => {
    try {
      const db = this.core.getConnection();
      const stmt = db.prepare(`
        SELECT vt.video_id, t.name
        FROM video_tags vt
        INNER JOIN tags t ON vt.tag_id = t.id
        ORDER BY vt.video_id, t.name
      `);

      const rows = stmt.all() as Array<{ video_id: string; name: string }>;
      const result = new Map<VideoId, string[]>();

      for (const row of rows) {
        const videoId = row.video_id as VideoId;
        if (!result.has(videoId)) {
          result.set(videoId, []);
        }
        result.get(videoId)!.push(row.name);
      }

      return result;
    } catch (error) {
      console.error('Error getting all video tags:', error);
      return new Map();
    }
  });

  return monitoredQuery();
}
```

### Step 2: Expose Method in VideoDatabase

**File:** `src/database/VideoDatabase.ts`

Add this method to the VideoDatabase class (around line 200):

```typescript
/**
 * Get all video tags in batch
 */
getAllVideoTags(): Map<VideoId, string[]> {
  return this.tagOps.getAllVideoTags();
}
```

### Step 3: Add IPC Handler

**File:** `src/ipc-handlers.ts`

Add handler registration in `registerHandlers()` method (around line 160):

```typescript
// Tag handlers (existing)
ipcMain.handle('add-tag', this.handleAddTag.bind(this));
ipcMain.handle('remove-tag', this.handleRemoveTag.bind(this));
ipcMain.handle('list-tags', this.handleListTags.bind(this));
ipcMain.handle('get-all-tags', this.handleGetAllTags.bind(this));
ipcMain.handle('search-by-tag', this.handleSearchByTag.bind(this));

// Add this new handler
ipcMain.handle('get-all-video-tags', this.handleGetAllVideoTags.bind(this));
```

Add the handler method (around line 400):

```typescript
async handleGetAllVideoTags(_event: IpcMainInvokeEvent): Promise<Record<string, string[]>> {
  try {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const tagsMap = this.database.getAllVideoTags();

    // Convert Map to plain object for IPC transfer
    const result: Record<string, string[]> = {};
    for (const [videoId, tags] of tagsMap.entries()) {
      result[videoId] = tags;
    }

    return result;
  } catch (error) {
    console.error('Error in get-all-video-tags handler:', error);
    return {};
  }
}
```

### Step 4: Add Preload API

**File:** `src/preload.ts`

Add to the `electronAPI` object (around line 40):

```typescript
getAllVideoTags: () => ipcRenderer.invoke('get-all-video-tags'),
```

### Step 5: Update Type Definitions

**File:** `types/ipc.ts`

Add to the `ElectronAPI` interface:

```typescript
getAllVideoTags(): Promise<Record<string, string[]>>;
```

### Step 6: Replace Renderer Code

**File:** `app/renderer.js:179-189`

Replace the entire for loop with:

```javascript
// Load tags for all videos (BATCH OPERATION - single query)
console.log('[App] Loading tags for all videos...');
try {
  const allVideoTags = await window.electronAPI.getAllVideoTags();
  this.videoTags = allVideoTags;

  const totalVideosWithTags = Object.keys(allVideoTags).length;
  const totalTags = Object.values(allVideoTags).reduce((sum, tags) => sum + tags.length, 0);

  console.log(`[App] Loaded tags for ${totalVideosWithTags} videos (${totalTags} total tags) in single query`);
} catch (error) {
  console.error('Error loading all video tags:', error);
  this.videoTags = {};
}
```

## Testing Steps

1. **Build and test:**
   ```bash
   npm run build:ts
   npm run dev
   ```

2. **Test with small library (10-50 videos):**
   - Open DevTools
   - Scan a folder
   - Check console for: "Loaded tags for X videos (Y total tags) in single query"
   - Verify no errors

3. **Test with large library (500+ videos):**
   - Measure time before and after
   - Should see dramatic improvement (5-15s → <0.5s)

4. **Test edge cases:**
   - Library with no tags
   - Videos with many tags (10+)
   - Mix of tagged and untagged videos

5. **Verify tag functionality still works:**
   - Add tags to videos
   - Remove tags
   - Filter by tags
   - Tag word cloud displays correctly

## Rollback Plan

If issues occur, revert `app/renderer.js:179-189` to original code:

```javascript
for (const video of this.allVideos) {
  try {
    const tags = await window.electronAPI.listTags(video.id);
    if (tags && tags.length > 0) {
      this.videoTags[video.id] = tags;
      totalTags += tags.length;
    }
  } catch (error) {
    console.error(`Error loading tags for ${video.id}:`, error);
  }
}
```

## Success Criteria

- ✅ Tag loading completes in <1 second for 1000+ videos
- ✅ No IPC errors in console
- ✅ All tag features work correctly
- ✅ Performance monitor shows single "getAllVideoTags" query instead of 1000+ "listTags" queries

## Performance Metrics

**Before:**
- 1000 videos: ~10-15 seconds
- 100 videos: ~1-2 seconds
- 1000+ IPC calls

**After:**
- 1000 videos: <0.5 seconds
- 100 videos: <0.1 seconds
- 1 IPC call

**Improvement:** ~95% reduction in tag loading time
