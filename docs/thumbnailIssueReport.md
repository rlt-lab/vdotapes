# Thumbnail Foreign Key Constraint Issue

## Error

```
SqliteError: FOREIGN KEY constraint failed
  code: 'SQLITE_CONSTRAINT_FOREIGNKEY'
```

**Location:** `UserDataOperations.saveThumbnail()` at line 409

**Call stack:**
```
UserDataOperations.saveThumbnail
  → VideoDatabase.saveThumbnail
    → IPCHandlers.handleGenerateThumbnail
```

## Analysis

1. Thumbnails are generated successfully (FFmpeg produces the image)
2. When `saveThumbnail()` tries to INSERT/UPDATE the thumbnail in the database, it fails
3. The `thumbnails` table has a foreign key reference to the `videos` table
4. The video ID being referenced doesn't exist in the `videos` table

## Root Cause

Race condition / ordering issue: thumbnail generation is happening before video records are inserted into the SQLite cache.

Given the two-tier architecture:
- **Folder metadata** (`.vdotapes/metadata.json`) is the source of truth
- **SQLite** (`~/.config/vdotapes/videos.db`) is a performance cache

This happens when:
- Videos are scanned and thumbnail requests are fired
- Video records haven't been inserted into the DB cache yet
- Or the DB was cleared/reset but thumbnail generation continued with stale video IDs

## Suggested Fix

### Option A: Ensure video exists before saving thumbnail (defensive)

In `UserDataOperations.saveThumbnail()`, check if the video exists first:

```typescript
saveThumbnail(videoId: string, thumbnailData: Buffer): void {
  // Check if video exists in DB
  const videoExists = this.db.prepare(
    'SELECT 1 FROM videos WHERE id = ?'
  ).get(videoId);

  if (!videoExists) {
    console.warn(`[saveThumbnail] Video ${videoId} not in DB, skipping thumbnail save`);
    return;
  }

  // Existing insert/update logic
  this.db.prepare(`
    INSERT OR REPLACE INTO thumbnails (video_id, data, created_at)
    VALUES (?, ?, ?)
  `).run(videoId, thumbnailData, Date.now());
}
```

### Option B: Fix ordering in IPC handler (root cause fix)

In `IPCHandlers.handleGenerateThumbnail()`, ensure video is in DB before generating:

```typescript
async handleGenerateThumbnail(videoId: string, filePath: string): Promise<Buffer | null> {
  // Ensure video record exists in cache before generating thumbnail
  await this.ensureVideoInDatabase(videoId, filePath);

  const thumbnail = await this.thumbnailGenerator.generate(filePath);
  if (thumbnail) {
    this.db.saveThumbnail(videoId, thumbnail);
  }
  return thumbnail;
}
```

### Option C: Remove foreign key constraint (simplest)

If thumbnails don't strictly need referential integrity (they're just a cache), remove the FK:

```sql
-- In schema, change thumbnails table to not enforce FK
CREATE TABLE thumbnails (
  video_id TEXT PRIMARY KEY,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
  -- Remove: FOREIGN KEY (video_id) REFERENCES videos(id)
);
```

## Recommendation

**Option A** is the safest immediate fix - it prevents the error without changing architecture. Option B addresses root cause but requires more investigation into the video insertion flow.

## Additional Notes

The `swscaler` warnings are benign:
```
[swscaler @ 0x...] No accelerated colorspace conversion found from yuv420p to rgb24.
```
This just means FFmpeg is using software scaling instead of hardware acceleration.
