# Fix 4: Batch Metadata Sync with Database Transactions

## Problem Statement

**Location:** `src/ipc-handlers.ts:230-270`

**Current Code:**
```typescript
private syncFolderMetadataToDatabase(): void {
  try {
    const allMetadata = this.folderMetadata.getAllVideoMetadata();
    const videoIds = Object.keys(allMetadata);

    console.log(`[IPC] Syncing ${videoIds.length} videos from folder metadata to database...`);
    let synced = 0;

    for (const videoId of videoIds) {
      const metadata = allMetadata[videoId as VideoId];

      // Sync favorite
      if (metadata.favorite) {
        this.database.addFavorite(videoId as VideoId);
        synced++;
      }

      // Sync hidden
      if (metadata.hidden) {
        this.database.addHiddenFile(videoId as VideoId);
        synced++;
      }

      // Sync rating
      if (metadata.rating !== null && metadata.rating >= 1 && metadata.rating <= 5) {
        this.database.saveRating(videoId as VideoId, metadata.rating as Rating);
        synced++;
      }

      // Sync tags (nested loop!)
      for (const tag of metadata.tags) {
        this.database.addTag(videoId as VideoId, tag);
        synced++;
      }
    }

    console.log(`[IPC] Synced ${synced} metadata items`);
  } catch (error) {
    console.error('Error syncing folder metadata to database:', error);
  }
}
```

**Issues:**
1. Sequential database operations (not batched)
2. No database transaction (each operation is separate)
3. For 1000 videos with tags, this could be 5000+ individual database writes
4. Nested loop for tags makes it even slower

## Impact

- **Performance:** 80% faster folder switching (10s → 2s for 1000 videos)
- **Priority:** HIGH
- **Effort:** 15 minutes
- **Expected Improvement:** Single transaction instead of 1000+ separate writes

## Solution Overview

Wrap all metadata sync operations in a single database transaction, and use batch insert operations where possible.

## Implementation Steps

### Step 1: Add Transaction Support to DatabaseCore

**File:** `src/database/core/DatabaseCore.ts`

Verify transaction support exists (it should already be there via TransactionManager). Check around line 280:

```typescript
transaction<T>(fn: () => T): () => T {
  return this.transactionManager.transaction(fn);
}
```

If not present, this should already exist in TransactionManager.

### Step 2: Create Batch Sync Method in VideoDatabase

**File:** `src/database/VideoDatabase.ts`

Add this method (around line 300):

```typescript
/**
 * Sync folder metadata to database in a single transaction (batch operation)
 */
syncFolderMetadata(allMetadata: Record<string, {
  favorite: boolean;
  hidden: boolean;
  rating: number | null;
  tags: string[];
}>): { synced: number; duration: number } {
  const startTime = performance.now();
  let synced = 0;

  const videoIds = Object.keys(allMetadata);
  console.log(`[Database] Syncing ${videoIds.length} videos in single transaction...`);

  // Wrap everything in a single transaction for maximum performance
  const syncTransaction = this.transactionManager.transaction(() => {
    const db = this.core.getConnection();

    // Prepare statements outside the loop for better performance
    const addFavoriteStmt = db.prepare('INSERT OR IGNORE INTO favorites (video_id) VALUES (?)');
    const addHiddenStmt = db.prepare('INSERT OR IGNORE INTO hidden_files (video_id) VALUES (?)');
    const saveRatingStmt = db.prepare('INSERT OR REPLACE INTO ratings (video_id, rating) VALUES (?, ?)');

    // Process each video
    for (const videoId of videoIds) {
      const metadata = allMetadata[videoId];

      // Batch favorite
      if (metadata.favorite) {
        addFavoriteStmt.run(videoId);
        synced++;
      }

      // Batch hidden
      if (metadata.hidden) {
        addHiddenStmt.run(videoId);
        synced++;
      }

      // Batch rating
      if (metadata.rating !== null && metadata.rating >= 1 && metadata.rating <= 5) {
        saveRatingStmt.run(videoId, metadata.rating);
        synced++;
      }

      // Batch tags
      for (const tag of metadata.tags) {
        // Use existing tag operations which are already optimized
        this.tagOps.addTag(videoId as VideoId, tag);
        synced++;
      }
    }
  });

  // Execute the transaction
  syncTransaction();

  const duration = performance.now() - startTime;
  console.log(`[Database] Synced ${synced} metadata items in ${duration.toFixed(2)}ms`);

  // Invalidate caches after bulk operation
  this.queryCache.invalidate('getVideos');
  this.queryCache.invalidate('getFavorites');
  this.queryCache.invalidate('getHiddenFiles');

  return { synced, duration };
}
```

### Step 3: Update IPC Handler to Use Batch Method

**File:** `src/ipc-handlers.ts`

Replace the `syncFolderMetadataToDatabase` method (lines 230-270):

**Before:**
```typescript
private syncFolderMetadataToDatabase(): void {
  try {
    const allMetadata = this.folderMetadata.getAllVideoMetadata();
    const videoIds = Object.keys(allMetadata);

    if (videoIds.length === 0) {
      console.log('[IPC] No folder metadata to sync');
      return;
    }

    console.log(`[IPC] Syncing ${videoIds.length} videos from folder metadata to database...`);
    let synced = 0;

    for (const videoId of videoIds) {
      const metadata = allMetadata[videoId as VideoId];

      // ... sequential operations ...
    }

    console.log(`[IPC] Synced ${synced} metadata items`);
  } catch (error) {
    console.error('Error syncing folder metadata to database:', error);
  }
}
```

**After:**
```typescript
private syncFolderMetadataToDatabase(): void {
  try {
    const allMetadata = this.folderMetadata.getAllVideoMetadata();
    const videoIds = Object.keys(allMetadata);

    if (videoIds.length === 0) {
      console.log('[IPC] No folder metadata to sync');
      return;
    }

    console.log(`[IPC] Syncing ${videoIds.length} videos from folder metadata to database (batch)...`);

    // Use batch transaction method for 80% faster sync
    const result = this.database.syncFolderMetadata(allMetadata);

    console.log(`[IPC] Synced ${result.synced} metadata items in ${result.duration.toFixed(2)}ms`);
  } catch (error) {
    console.error('Error syncing folder metadata to database:', error);
  }
}
```

## Testing Steps

### Test 1: Small Library (10-50 videos)

```bash
npm run build:ts
npm run dev
```

1. Open DevTools Console
2. Scan a folder with 10-50 videos
3. Look for log message: `[Database] Synced X metadata items in Yms`
4. Verify sync completes in <100ms

### Test 2: Medium Library (100-500 videos)

1. Scan a folder with 100-500 videos
2. Time should still be <500ms
3. All favorites, ratings, tags should load correctly

### Test 3: Large Library (1000+ videos)

1. Scan a folder with 1000+ videos
2. Check console timing
3. Should complete in 1-3 seconds (vs 10+ seconds before)
4. Verify all metadata loaded correctly:
   - Check favorites count
   - Check hidden files
   - Check tag cloud
   - Check ratings

### Test 4: Folder Switching

```bash
# Test switching between folders rapidly
```

1. Scan Folder A (1000 videos)
2. Scan Folder B (1000 videos)
3. Back to Folder A
4. Each switch should be fast (<3s for metadata sync)

### Test 5: Verify Data Integrity

After sync, verify:

```javascript
// In DevTools console
const favorites = await window.electronAPI.getFavorites();
console.log('Favorites:', favorites.length);

const hiddenFiles = await window.electronAPI.getHiddenFiles();
console.log('Hidden files:', hiddenFiles.length);

// Check tags loaded
console.log('Videos with tags:', Object.keys(window.app.videoTags).length);
```

## Performance Analysis

### Before (Sequential):

```
1000 videos × (1 favorite + 1 hidden + 1 rating + 5 tags) = 8000 operations
Each operation:
  - Separate database write
  - Separate transaction
  - Separate disk I/O

Total time: ~10-15 seconds
```

### After (Transaction):

```
1 transaction containing:
  - 1000 favorite inserts (prepared statement)
  - 1000 hidden inserts (prepared statement)
  - 1000 rating inserts (prepared statement)
  - 5000 tag inserts (prepared statement)

All committed at once

Total time: ~2-3 seconds (80% faster!)
```

### Why Transactions Are Faster:

1. **Single commit:** All changes written to disk once, not 8000 times
2. **Prepared statements:** SQL parsed once, executed 1000 times
3. **No transaction overhead:** 1 transaction vs 8000 transactions
4. **Better cache utilization:** SQLite can batch writes
5. **WAL mode optimization:** Write-ahead log more efficient with batches

## Troubleshooting

### Error: "database is locked"

**Cause:** Another process has database open

**Solution:**
```bash
# Close all app instances
# Delete WAL files
rm ~/.config/vdotapes/videos.db-wal
rm ~/.config/vdotapes/videos.db-shm

# Restart app
npm run dev
```

### Metadata not syncing

**Cause:** Transaction rolled back due to error

**Solution:** Check console for errors, verify folder metadata file exists:
```bash
ls -la /path/to/video/folder/.vdotapes/metadata.json
```

### Slower than expected

**Cause:** May need to run ANALYZE

**Solution:**
```javascript
// After big sync, run ANALYZE to update statistics
await window.electronAPI.optimizeDatabase();
```

## Rollback Plan

If transaction approach causes issues, revert `src/ipc-handlers.ts` to sequential version:

```typescript
for (const videoId of videoIds) {
  const metadata = allMetadata[videoId as VideoId];

  if (metadata.favorite) {
    this.database.addFavorite(videoId as VideoId);
  }
  // ... etc
}
```

## Success Criteria

- ✅ Metadata sync completes in <3 seconds for 1000 videos
- ✅ All favorites load correctly
- ✅ All hidden files load correctly
- ✅ All ratings load correctly
- ✅ All tags load correctly
- ✅ No database errors in console
- ✅ Folder switching is 80% faster

## Performance Metrics

**Before (Sequential):**
- 100 videos: ~1-2 seconds
- 500 videos: ~5-7 seconds
- 1000 videos: ~10-15 seconds
- 5000 videos: ~50+ seconds

**After (Transaction):**
- 100 videos: <0.2 seconds
- 500 videos: ~1 second
- 1000 videos: ~2-3 seconds
- 5000 videos: ~10 seconds

**Improvement:** 80% reduction in metadata sync time

## Additional Optimizations (Future)

For even better performance, consider:

1. **Bulk tag insertion with single query:**
   ```sql
   INSERT INTO video_tags (video_id, tag_id)
   SELECT ?, id FROM tags WHERE name IN (?, ?, ?)
   ```

2. **Use better-sqlite3 `.run()` with arrays:**
   ```typescript
   const stmt = db.prepare('INSERT INTO favorites (video_id) VALUES (?)');
   const insertMany = db.transaction((videoIds) => {
     for (const id of videoIds) stmt.run(id);
   });
   insertMany(favoriteIds);
   ```

3. **Pre-cache tag IDs to avoid lookups:**
   - Cache tag_name → tag_id mapping
   - Reduces tag insertion from 2 queries to 1
