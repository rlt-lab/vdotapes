# Tag System Reference

## Recent Changes

### Fix: Tag Removal Feature (2025-10-29)
- **Issue**: Tag removal UI (× button) was non-functional due to CSP violation
- **Root Cause**: Inline `onclick` handlers blocked by Content Security Policy (`script-src 'self'`)
- **Solution**: Refactored to use event delegation pattern with data attributes
- **Changes Made**:
  1. `VideoExpander.renderTagList()`: Replaced inline onclick with data attributes
  2. `VideoExpander.escapeHtml()`: Added HTML escaping helper for security
  3. `EventController.setupEventListeners()`: Added event delegation for `.tag-remove` buttons
- **Files Modified**:
  - `app/modules/VideoExpander.js` (lines 113-142)
  - `app/modules/EventController.js` (lines 82-94)
- **Status**: ✅ Fixed and tested

---

## System Overview

VDOTapes implements a comprehensive video tagging system that allows users to categorize and filter videos using custom tags. The system supports two modes of filtering (AND/OR), autocomplete suggestions, and maintains tags in both per-folder metadata files and a SQLite database cache.

## Architecture

### Three-Layer Architecture

The tagging system operates across three layers:

1. **Frontend Layer** (`app/modules/TagManager.js`)
   - Handles user interactions, autocomplete UI, tag filtering UI
   - Manages active tag filters and filter mode (AND/OR)
   - Communicates with backend via IPC

2. **Backend IPC Layer** (`src/ipc-handlers.ts`)
   - Bridges frontend and data layers
   - Implements write-through caching pattern
   - Handlers: `tags-add`, `tags-remove`, `tags-list`, `tags-all`, `tags-search`

3. **Data Layer** (Dual Storage)
   - **Per-Folder Metadata** (`src/folder-metadata.ts`) - Source of truth
     - Stored in `.vdotapes/metadata.json` per video folder
     - Tags stored as string arrays in per-video objects
   - **SQLite Database** (`src/database/operations/TagOperations.ts`) - Performance cache
     - Normalized schema: `tags` table (id, name), `video_tags` junction table
     - Used for fast searches and aggregations

### Data Flow

#### Adding a Tag

```
User types tag → TagManager → IPC (tags-add) → FolderMetadata.addTag() →
  writes to .vdotapes/metadata.json → Database.addTag() → caches in SQLite
```

#### Removing a Tag

```
User clicks × → VideoExpander.removeTag() → IPC (tags-remove) →
  FolderMetadata.removeTag() → updates .vdotapes/metadata.json →
  Database.removeTag() → updates SQLite
```

#### Loading Tags for Display

```
Video expanded → VideoExpander.refreshExpandedSidebar() → IPC (tags-list) →
  FolderMetadata.getTags(videoId) → returns string[] → renders in sidebar
```

#### Loading All Tags for Autocomplete

```
Folder scanned → TagManager.loadAllTags() → IPC (tags-all) →
  FolderMetadata.getAllTags() → aggregates from all videos →
  returns [{ name, usage }] sorted by usage
```

#### Filtering by Tags

```
User adds active tag → TagManager.addActiveTag() → app.activeTags.push() →
  FilterManager.applyCurrentFilters() → filters app.displayedVideos →
  checks each video's tags against active tags using AND/OR mode
```

## User Interface

### UI Components

1. **Tag Search Input** (`#tagSearchInput`)
   - Location: Header toolbar
   - Compact input with 🏷️ placeholder
   - Triggers autocomplete on input
   - Enter key adds tag to active filters
   - Arrow keys navigate autocomplete

2. **Tag Mode Toggle** (`#tagModeToggle`)
   - Location: Next to tag search input
   - Shows "AND" or "OR"
   - Toggles between matching ALL tags vs ANY tag
   - Updates filter immediately when changed

3. **Tag Autocomplete Dropdown** (`#tagAutocomplete`)
   - Location: Below tag search input
   - Shows top 10 matching tags
   - Displays tag name and usage count
   - Keyboard navigation (up/down arrows, enter)
   - Click to select

4. **Tag Status Bar** (`#tagStatus`)
   - Location: Below main header
   - Only visible when tags are active
   - Shows "Filtering by all/any of: [tags]"
   - Clear button (×) to remove all tag filters

5. **Tag List in Expanded View** (`#tagList`)
   - Location: Right sidebar when video is expanded
   - Shows all tags for current video
   - Each tag has remove button (×)
   - "No tags" message when empty

6. **Tag Input in Expanded View** (`#tagInput`)
   - Location: Below tag list in sidebar
   - Input field: "Add tag and press Enter"
   - Enter key adds tag to current video

### User Interactions

#### Filtering Workflow

1. User types in tag search input
2. Autocomplete shows matching tags with usage counts
3. User selects tag (Enter or click)
4. Tag added to active filters (app.activeTags)
5. Tag status bar appears showing active tags
6. Videos are filtered based on AND/OR mode
7. Grid re-renders with filtered results

#### Tagging Workflow

1. User expands video (full-screen view)
2. Sidebar shows existing tags for video
3. User types new tag in input field
4. Press Enter to add tag
5. Tag saved to folder metadata + database
6. Tag list updates immediately
7. Autocomplete suggestions updated with new tag

#### AND vs OR Mode

- **OR Mode** (default): Video matches if it has ANY of the active tags
- **AND Mode**: Video matches only if it has ALL active tags
- Toggle button switches between modes
- Filter re-applies immediately on mode change

## Storage Details

### Per-Folder Metadata (Source of Truth)

Location: `<video_folder>/.vdotapes/metadata.json`

Structure:
```json
{
  "version": "2.0.0",
  "folderPath": "/path/to/videos",
  "lastUpdated": "2025-10-29T...",
  "videos": {
    "video_id_hash_1": {
      "favorite": false,
      "hidden": false,
      "rating": null,
      "tags": ["landscape", "sunset", "beach"],
      "notes": "",
      "lastViewed": null,
      "viewCount": 0
    }
  }
}
```

**Key Properties:**
- Tags stored as string arrays per video
- File travels with video folder (portable)
- Direct file I/O (synchronous writes)
- No normalization (tag names repeated)

### SQLite Database (Cache)

Location: `~/.config/vdotapes/videos.db`

Schema:
```sql
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE video_tags (
  video_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (video_id, tag_id),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
```

**Key Properties:**
- Normalized design (tags table + junction table)
- Case-insensitive tag names
- Cascading deletes
- Fast queries with indexes
- Cleared when switching folders

### Write-Through Caching Pattern

All tag operations follow write-through pattern:

```typescript
async handleTagsAdd(videoId, tagName) {
  // Write to source of truth first
  const success = await this.folderMetadata.addTag(videoId, tagName);

  // Then update cache if successful
  if (success) {
    this.database.addTag(videoId, tagName);
  }

  return success;
}
```

This ensures:
- Folder metadata always authoritative
- Database kept in sync
- Consistency on failures (cache not updated if write fails)

## State Management

### App-Level State

Located in `app/renderer.js` (VdoTapesApp class):

```javascript
this.activeTags = [];           // Array of active tag names for filtering
this.videoTags = {};            // Map: videoId -> [tag names]
this.tagFilterMode = 'OR';      // 'AND' or 'OR' - how to combine multiple tags
```

### State Synchronization

**On Folder Scan:**
```javascript
// Load tags for all videos into memory
this.videoTags = {};
for (const video of this.allVideos) {
  const tags = await window.electronAPI.listTags(video.id);
  if (tags && tags.length > 0) {
    this.videoTags[video.id] = tags;
  }
}
```

**On Tag Add/Remove:**
```javascript
// Update local state immediately for responsive UI
this.app.videoTags[video.id] = tags;
// Reload autocomplete suggestions
await this.app.tagManager.loadAllTags();
```

## Current Implementation Issues & Observations

### Performance

1. **N+1 Query Problem on Folder Load**
   - Currently loads tags one video at a time: `for (const video of this.allVideos)`
   - For 1000 videos = 1000 IPC calls + 1000 file reads
   - Blocks UI during initial load

2. **No Tag Caching in Renderer**
   - `videoTags` map rebuilt from scratch on every folder scan
   - No persistence between app sessions
   - Autocomplete list (`allTags`) loaded separately

3. **Redundant Data Loading**
   - Tags loaded per-video for `videoTags` map
   - Then `loadAllTags()` reads folder metadata again to aggregate
   - Same data read twice from disk

4. **Synchronous File I/O**
   - `FolderMetadata.save()` writes synchronously after every tag operation
   - No batching of writes
   - Potential for file corruption if multiple rapid changes

### Data Consistency

1. **Dual Storage Sync Issues**
   - Database cleared on folder switch, but what if write fails?
   - No transaction spanning both folder metadata and database
   - If metadata save fails, database still updated

2. **No Tag Cleanup**
   - Unused tags persist in database (though `cleanupUnusedTags()` exists, it's not called)
   - No mechanism to remove tags with 0 usage from folder metadata
   - Tag list grows indefinitely

3. **Case Sensitivity Inconsistency**
   - Database uses `COLLATE NOCASE` for tags
   - Folder metadata stores exact case as typed
   - Could result in "Sunset" and "sunset" as separate tags in metadata but merged in DB

### UI/UX

1. **No Visual Feedback on Tag Operations**
   - Adding/removing tags has no loading state
   - No error messages if tag operation fails
   - User doesn't know if action succeeded

2. **Autocomplete Limitations**
   - Limited to 10 results (hardcoded)
   - No fuzzy matching (only substring match)
   - No recent tags or suggested tags

3. **No Tag Management UI**
   - Can't rename tags globally
   - Can't merge duplicate tags
   - Can't see all tags with usage stats
   - Tag operations only available in expanded video view

4. **Filter State Not Persisted**
   - Active tag filters cleared on app restart
   - Tag filter mode (AND/OR) not saved in settings
   - User has to re-select tags every time

### Code Quality

1. **Mixed Responsibilities**
   - `FilterManager` handles tag filtering logic
   - `TagManager` handles tag UI and autocomplete
   - `VideoExpander` handles per-video tag display
   - Unclear separation of concerns

2. **Tight Coupling**
   - `TagManager` directly modifies `app.activeTags`
   - `VideoExpander` directly modifies `app.videoTags`
   - Makes testing difficult

3. **Error Handling**
   - Most tag operations just log errors and return false
   - No user-visible error messages
   - Silent failures

---

## Optimization Opportunities

### 1. Batch Tag Loading

**Problem:** Loading tags one video at a time is extremely slow for large collections.

**Solution:** Add batch IPC endpoint to load all tags in one call.

```typescript
// New IPC handler
async handleTagsGetAll(): Promise<Record<VideoId, string[]>> {
  // Return complete videoId -> tags mapping in single call
  const allMetadata = this.folderMetadata.getAllVideoMetadata();
  const result: Record<VideoId, string[]> = {};

  for (const [videoId, metadata] of Object.entries(allMetadata)) {
    if (metadata.tags.length > 0) {
      result[videoId] = metadata.tags;
    }
  }

  return result;
}
```

**Benefits:**
- Single IPC call instead of N calls
- Single file read instead of N queries
- 10-100x faster for large collections
- Non-blocking UI during load

### 2. Tag Caching & Incremental Updates

**Problem:** Tags reloaded from scratch on every folder scan, even if unchanged.

**Solution:** Add timestamp-based caching and incremental updates.

```typescript
// Cache tags in localStorage with timestamp
const tagCache = {
  folderPath: string,
  timestamp: number,
  videoTags: Record<VideoId, string[]>,
  allTags: Array<{ name: string, usage: number }>
};

// On folder load, check if cache is fresh
if (cachedData.timestamp >= folderMetadata.lastUpdated) {
  // Use cache
  this.videoTags = cachedData.videoTags;
} else {
  // Reload and update cache
}
```

**Benefits:**
- Instant tag availability on subsequent loads
- Reduced disk I/O
- Better perceived performance

### 3. Debounced/Batched Metadata Writes

**Problem:** Every tag operation immediately writes entire metadata file to disk.

**Solution:** Batch writes with debounce or explicit save.

```typescript
class FolderMetadataManager {
  private pendingSave: boolean = false;
  private saveDebounceTimer: NodeJS.Timeout | null = null;

  private scheduleSave(): void {
    this.pendingSave = true;

    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    this.saveDebounceTimer = setTimeout(() => {
      if (this.pendingSave) {
        this.save();
        this.pendingSave = false;
      }
    }, 1000); // Wait 1s after last change
  }

  async addTag(videoId: VideoId, tag: string): Promise<boolean> {
    // Update in-memory
    const video = this.getOrCreateVideo(videoId);
    video.tags.push(tag);

    // Schedule delayed save
    this.scheduleSave();
    return true;
  }
}
```

**Benefits:**
- Reduced disk writes (especially during bulk operations)
- Better performance with rapid tag changes
- Safer with explicit flush on app close

### 4. Database-First Tag Queries

**Problem:** Autocomplete and tag search read from folder metadata, not database.

**Solution:** Use database for read-heavy operations (it's faster and already indexed).

```typescript
async handleTagsAll(): Promise<Array<{ name: string; usage: number }>> {
  // Use database instead of folder metadata
  // Database query is much faster for aggregations
  return this.database.listAllTags();
}
```

**Benefits:**
- Faster autocomplete (SQL aggregation vs. in-memory iteration)
- Database already optimized for queries
- Consistent with other query operations

### 5. Tag Normalization

**Problem:** Case inconsistencies ("Sunset" vs "sunset") create duplicate tags.

**Solution:** Normalize tags on input.

```typescript
function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

async addTag(videoId: VideoId, tag: string): Promise<boolean> {
  const normalized = normalizeTag(tag);

  // Store normalized version
  if (!video.tags.includes(normalized)) {
    video.tags.push(normalized);
  }
}
```

**Benefits:**
- Prevents duplicate tags with different casing
- Consistent autocomplete results
- Cleaner tag list

**Alternative:** Store original case for display, normalize for comparison:
```typescript
interface TagEntry {
  original: string;  // "Sunset"
  normalized: string; // "sunset"
}
```

### 6. Async File Operations

**Problem:** Synchronous file I/O blocks the event loop.

**Solution:** Use async fs operations throughout.

```typescript
private async save(): Promise<void> {
  const data = JSON.stringify(this.metadata, null, 2);
  await fs.promises.writeFile(metadataPath, data, 'utf-8');
}
```

**Benefits:**
- Non-blocking I/O
- Better app responsiveness
- Node.js best practices

### 7. Tag Autocomplete Improvements

**Problem:** Simple substring matching, fixed 10-result limit, no intelligence.

**Solutions:**

a) **Fuzzy Matching:**
```typescript
// Use Levenshtein distance or similar
function fuzzyMatch(search: string, tag: string): number {
  // Return score 0-1
}

const filtered = this.allTags
  .map(tag => ({ ...tag, score: fuzzyMatch(searchText, tag.name) }))
  .filter(t => t.score > 0.5)
  .sort((a, b) => b.score - a.score)
  .slice(0, 10);
```

b) **Recent Tags Priority:**
```typescript
// Track recently used tags
this.recentTags = []; // Last N tags used

// Prioritize in autocomplete
const suggestions = [
  ...recentTags.filter(matches),
  ...allTags.filter(matches)
].slice(0, 10);
```

c) **Smart Suggestions:**
```typescript
// Suggest tags used on similar videos (same folder, similar filename)
// Or tags commonly used together with already-applied tags
```

**Benefits:**
- Better user experience
- Faster tagging workflow
- Reduced typos and duplicates

### 8. Tag Management UI

**Problem:** No way to manage tags globally, only per-video.

**Solution:** Add tag management panel/modal.

Features:
- List all tags with usage counts
- Rename tags globally (updates all videos)
- Merge duplicate tags
- Delete unused tags
- Search and filter tags
- Bulk operations

```typescript
// New IPC handlers needed
async handleTagRename(oldName: string, newName: string): Promise<boolean>
async handleTagMerge(sourceTag: string, targetTag: string): Promise<boolean>
async handleTagDelete(tagName: string): Promise<boolean>
async handleTagGetStats(): Promise<TagStats>
```

**Benefits:**
- Tag hygiene (remove duplicates, typos)
- Better tag organization
- Bulk tag management
- Tag analytics

### 9. Tag Filtering Optimizations

**Problem:** Tag filtering done in JavaScript after fetching all videos.

**Solution:** Move filtering to database query (when using database path).

```typescript
// Add to VideoOperations
getVideosWithTags(
  filters: VideoFilters & {
    tags: string[],
    tagMode: 'AND' | 'OR'
  }
): VideoRecord[] {
  if (filters.tags.length === 0) {
    return this.getVideos(filters);
  }

  // Build SQL for tag filtering
  if (filters.tagMode === 'AND') {
    // Must have ALL tags
    sql += `
      AND v.id IN (
        SELECT video_id FROM video_tags vt
        JOIN tags t ON t.id = vt.tag_id
        WHERE t.name IN (${placeholders})
        GROUP BY video_id
        HAVING COUNT(DISTINCT t.id) = ?
      )
    `;
  } else {
    // Must have ANY tag
    sql += `
      AND v.id IN (
        SELECT DISTINCT video_id FROM video_tags vt
        JOIN tags t ON t.id = vt.tag_id
        WHERE t.name IN (${placeholders})
      )
    `;
  }

  return db.prepare(sql).all(...params);
}
```

**Benefits:**
- Database does filtering (faster)
- Reduced data transfer
- Leverages database indexes
- Scalable to large collections

### 10. Persist Filter State

**Problem:** Active tag filters and mode not saved between sessions.

**Solution:** Save to user preferences.

```typescript
interface UserPreferences {
  // ... existing fields
  activeTags?: string[];
  tagFilterMode?: 'AND' | 'OR';
}

// On app close
await this.userDataManager.saveUserPreferences({
  activeTags: this.app.activeTags,
  tagFilterMode: this.app.tagFilterMode
});

// On app start
const prefs = await this.userDataManager.getUserPreferences();
this.app.activeTags = prefs.activeTags || [];
this.app.tagFilterMode = prefs.tagFilterMode || 'OR';
```

**Benefits:**
- Persistent workflow across sessions
- Better UX (restore user's context)
- Consistent with other persisted settings

### 11. Transaction Safety for Multi-Storage Writes

**Problem:** Tag writes to folder metadata and database can get out of sync if one fails.

**Solution:** Implement proper error handling and rollback.

```typescript
async handleTagsAdd(videoId: VideoId, tagName: string): Promise<boolean> {
  let metadataSuccess = false;
  let dbSuccess = false;

  try {
    // Write to metadata first
    metadataSuccess = await this.folderMetadata.addTag(videoId, tagName);

    if (!metadataSuccess) {
      throw new Error('Failed to write to folder metadata');
    }

    // Then cache in database
    dbSuccess = this.database.addTag(videoId, tagName);

    if (!dbSuccess) {
      // Rollback metadata write
      await this.folderMetadata.removeTag(videoId, tagName);
      throw new Error('Failed to write to database cache');
    }

    return true;
  } catch (error) {
    console.error('Tag add failed:', error);

    // Attempt cleanup if partial write occurred
    if (metadataSuccess && !dbSuccess) {
      await this.folderMetadata.removeTag(videoId, tagName);
    }

    return false;
  }
}
```

**Benefits:**
- Data consistency
- No orphaned data
- Better error recovery

### 12. Tag Validation

**Problem:** No validation on tag input (length, characters, etc.).

**Solution:** Add validation layer.

```typescript
function validateTag(tag: string): { valid: boolean; error?: string } {
  const trimmed = tag.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: 'Tag cannot be empty' };
  }

  if (trimmed.length > 50) {
    return { valid: false, error: 'Tag too long (max 50 characters)' };
  }

  if (!/^[a-zA-Z0-9\-_ ]+$/.test(trimmed)) {
    return { valid: false, error: 'Tag contains invalid characters' };
  }

  return { valid: true };
}
```

**Benefits:**
- Prevent invalid tags
- Better data quality
- User feedback on invalid input

### 13. Tag Performance Monitoring

**Problem:** No visibility into tag operation performance.

**Solution:** Add metrics for tag operations.

```typescript
// Track in performance monitor
this.monitor.track('tag_add_latency', duration);
this.monitor.track('tag_load_batch_size', videoCount);
this.monitor.track('tag_autocomplete_results', resultCount);

// Log slow operations
if (duration > 100) {
  console.warn(`[Performance] Slow tag operation: ${operation} took ${duration}ms`);
}
```

**Benefits:**
- Identify bottlenecks
- Track improvements
- Performance regression detection

---

## Priority Matrix

| Optimization | Impact | Effort | Priority |
|--------------|--------|--------|----------|
| 1. Batch Tag Loading | High | Low | **P0** |
| 6. Async File Operations | High | Low | **P0** |
| 5. Tag Normalization | Medium | Low | **P1** |
| 3. Debounced Writes | Medium | Low | **P1** |
| 10. Persist Filter State | Medium | Low | **P1** |
| 4. Database-First Queries | Medium | Medium | **P2** |
| 2. Tag Caching | Medium | Medium | **P2** |
| 12. Tag Validation | Low | Low | **P2** |
| 9. DB Tag Filtering | High | High | **P3** |
| 8. Tag Management UI | High | High | **P3** |
| 7. Autocomplete Improvements | Medium | Medium | **P3** |
| 11. Transaction Safety | Low | High | **P4** |
| 13. Performance Monitoring | Low | Low | **P4** |

**P0** = Critical performance/correctness issues
**P1** = High impact, quick wins
**P2** = Medium impact improvements
**P3** = Large features requiring design work
**P4** = Nice-to-have enhancements

## Recommended Implementation Order

1. **Phase 1: Performance Quick Wins**
   - Batch tag loading (#1)
   - Async file operations (#6)
   - Tag normalization (#5)

2. **Phase 2: UX Improvements**
   - Debounced writes (#3)
   - Persist filter state (#10)
   - Tag validation (#12)

3. **Phase 3: Architecture Improvements**
   - Database-first queries (#4)
   - Tag caching (#2)

4. **Phase 4: Feature Additions**
   - Tag management UI (#8)
   - Autocomplete improvements (#7)
   - Database tag filtering (#9)
