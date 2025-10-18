# VDOTapes Refactoring Plan: WASM Migration & Data Consolidation

**Goal:** Migrate to WASM-powered rendering and consolidate data storage while maintaining backward compatibility

**Strategy:** Integrate new systems alongside old ones, validate, then remove old systems

**Estimated Time:** 2-3 weeks

---

## Overview

### Current State
- 🔴 Database stores user data (favorites, hidden, ratings, tags)
- 🔴 Folder metadata ALSO stores user data (duplicated)
- 🔴 VideoSmartLoader for video loading (JS-based)
- 🔴 WASM modules built but disabled
- 🔴 Multiple overlapping systems

### Target State
- ✅ Folder metadata is source of truth
- ✅ Database is fast cache/index
- ✅ WASM engine handles filtering/sorting/viewport
- ✅ VirtualVideoGrid handles rendering
- ✅ Single, clean data flow

---

## Phase 1: Database Consolidation (Week 1)

**Goal:** Merge user data into single table, keep both systems working

### Step 1.1: Create New Database Schema (Day 1)

**File:** `src/database/migrations/v2-schema.ts`

```typescript
/**
 * Migration to v2 schema
 * Merges favorites, hidden, ratings into videos table
 */
export function migrateToV2(db: Database) {
  console.log('[Migration] Starting v2 schema migration...');
  
  // Add new columns to videos table (with defaults for existing rows)
  db.exec(`
    ALTER TABLE videos ADD COLUMN favorite INTEGER DEFAULT 0;
    ALTER TABLE videos ADD COLUMN hidden INTEGER DEFAULT 0;
    ALTER TABLE videos ADD COLUMN rating INTEGER DEFAULT 0;
    ALTER TABLE videos ADD COLUMN notes TEXT DEFAULT '';
    ALTER TABLE videos ADD COLUMN last_viewed INTEGER;
    ALTER TABLE videos ADD COLUMN view_count INTEGER DEFAULT 0;
  `);
  
  // Migrate data from old tables
  db.exec(`
    UPDATE videos
    SET favorite = 1
    WHERE id IN (SELECT video_id FROM favorites);
    
    UPDATE videos
    SET hidden = 1
    WHERE id IN (SELECT video_id FROM hidden_files);
    
    UPDATE videos
    SET rating = (SELECT rating FROM ratings WHERE video_id = videos.id)
    WHERE id IN (SELECT video_id FROM ratings);
  `);
  
  // Create new indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_videos_favorite ON videos(favorite);
    CREATE INDEX IF NOT EXISTS idx_videos_hidden ON videos(hidden);
    CREATE INDEX IF NOT EXISTS idx_videos_rating ON videos(rating);
  `);
  
  // Simplify tags table
  db.exec(`
    DROP TABLE IF EXISTS tags;
    CREATE TABLE video_tags (
      video_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (video_id, tag),
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_video_tags_tag ON video_tags(tag);
    CREATE INDEX idx_video_tags_video ON video_tags(video_id);
  `);
  
  // Store schema version
  db.exec(`
    INSERT OR REPLACE INTO app_state (key, value) VALUES ('schema_version', '2');
  `);
  
  console.log('[Migration] v2 schema migration complete');
}
```

**File:** `src/database/core/DatabaseCore.ts`

Add migration logic to `initialize()`:

```typescript
async initialize(): Promise<void> {
  // ... existing initialization ...
  
  // Check schema version and migrate if needed
  const version = this.db.prepare(
    "SELECT value FROM app_state WHERE key = 'schema_version'"
  ).get()?.value || '1';
  
  if (version === '1') {
    console.log('[Database] Migrating to v2 schema...');
    migrateToV2(this.db);
  }
  
  this.initialized = true;
}
```

**Testing Checkpoint 1.1:**
```bash
npm run build:ts
npm run start

# In DevTools console:
> window.electronAPI.getVideos().then(v => console.log(v[0]))
# Should show new fields: favorite, hidden, rating
```

---

### Step 1.2: Add Dual-Write System (Day 1-2)

**Goal:** Write to BOTH old and new tables during transition

**File:** `src/database/operations/UserDataOperations.ts`

```typescript
/**
 * Dual-write: Update both old tables and new columns
 * Remove old table writes after Phase 1 complete
 */
class UserDataOperations {
  // ... existing code ...
  
  addFavorite(videoId: VideoId): boolean {
    const db = this.core.getConnection();
    
    try {
      this.transactionManager.executeTransaction(() => {
        // NEW: Write to videos table
        db.prepare('UPDATE videos SET favorite = 1 WHERE id = ?').run(videoId);
        
        // OLD: Keep writing to old table (for rollback safety)
        db.prepare(
          'INSERT OR IGNORE INTO favorites (video_id) VALUES (?)'
        ).run(videoId);
      });
      
      this.queryCache.invalidatePattern('favorites');
      return true;
    } catch (error) {
      console.error('Error adding favorite:', error);
      return false;
    }
  }
  
  removeFavorite(videoId: VideoId): boolean {
    const db = this.core.getConnection();
    
    try {
      this.transactionManager.executeTransaction(() => {
        // NEW: Write to videos table
        db.prepare('UPDATE videos SET favorite = 0 WHERE id = ?').run(videoId);
        
        // OLD: Keep writing to old table (for rollback safety)
        db.prepare('DELETE FROM favorites WHERE video_id = ?').run(videoId);
      });
      
      this.queryCache.invalidatePattern('favorites');
      return true;
    } catch (error) {
      console.error('Error removing favorite:', error);
      return false;
    }
  }
  
  // Similar dual-write for: hidden, rating, tags...
}
```

**Testing Checkpoint 1.2:**
```bash
npm run build:ts
npm run start

# Test in app:
# 1. Toggle favorite on a video
# 2. Close app
# 3. Reopen app
# 4. Verify favorite persisted

# In DevTools console:
> const db = await window.electronAPI.getVideos()
> db.filter(v => v.favorite).length
# Should match favorites count
```

---

### Step 1.3: Update Read Operations (Day 2)

**Goal:** Read from new columns instead of JOIN queries

**File:** `src/database/operations/VideoOperations.ts`

```typescript
getVideos(filters: VideoFilters = {}): VideoRecord[] {
  const db = this.core.getConnection();
  
  // Build WHERE clause
  const conditions: string[] = [];
  const params: any[] = [];
  
  if (filters.folder) {
    conditions.push('folder = ?');
    params.push(filters.folder);
  }
  
  if (filters.favoritesOnly) {
    conditions.push('favorite = 1');
  }
  
  if (filters.hideHidden !== false) {
    conditions.push('hidden = 0');
  }
  
  if (filters.minRating) {
    conditions.push('rating >= ?');
    params.push(filters.minRating);
  }
  
  if (filters.tags && filters.tags.length > 0) {
    // Tags still need JOIN
    conditions.push(`id IN (
      SELECT video_id FROM video_tags 
      WHERE tag IN (${filters.tags.map(() => '?').join(',')})
      GROUP BY video_id
      HAVING COUNT(*) = ?
    )`);
    params.push(...filters.tags, filters.tags.length);
  }
  
  const whereClause = conditions.length > 0 
    ? `WHERE ${conditions.join(' AND ')}` 
    : '';
  
  // Single table query (much faster!)
  const query = `
    SELECT 
      id, name, path, folder, size, duration, width, height,
      codec, bitrate, last_modified, created,
      favorite, hidden, rating, notes, last_viewed, view_count
    FROM videos
    ${whereClause}
    ORDER BY ${this.getSortColumn(filters.sortBy)} ${filters.sortOrder || 'ASC'}
  `;
  
  const rows = db.prepare(query).all(...params);
  
  // Load tags for each video (if needed)
  if (filters.includeTags) {
    const tagStmt = db.prepare(
      'SELECT tag FROM video_tags WHERE video_id = ?'
    );
    
    rows.forEach((row: any) => {
      row.tags = tagStmt.all(row.id).map((t: any) => t.tag);
    });
  }
  
  return rows.map(this.rowToVideoRecord);
}

private rowToVideoRecord(row: any): VideoRecord {
  return {
    id: createVideoId(row.id),
    name: row.name,
    path: createFilePath(row.path),
    folder: row.folder,
    size: row.size,
    duration: row.duration,
    width: row.width,
    height: row.height,
    codec: row.codec,
    bitrate: row.bitrate,
    lastModified: createTimestamp(row.last_modified),
    created: createTimestamp(row.created),
    addedAt: row.added_at,
    updatedAt: row.updated_at,
    
    // NEW: User data in same row
    isFavorite: row.favorite === 1,
    isHidden: row.hidden === 1,
    rating: row.rating,
    notes: row.notes,
    tags: row.tags || [],
  };
}
```

**Testing Checkpoint 1.3:**
```bash
npm run build:ts
npm run start

# Test in app:
# 1. Load folder with videos
# 2. Filter by favorites
# 3. Filter by tags
# 4. Sort by rating
# 5. All should work correctly

# Performance test in DevTools:
> console.time('getVideos')
> await window.electronAPI.getVideos()
> console.timeEnd('getVideos')
# Should be faster than before (no JOINs)
```

---

### Step 1.4: Verify Data Consistency (Day 2-3)

**File:** `scripts/verify-migration.js`

```javascript
/**
 * Verify old and new tables have same data
 */
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), '.vdotapes', 'vdotapes.db');
const db = new Database(dbPath);

console.log('Verifying database migration...\n');

// Check favorites
const oldFavorites = db.prepare('SELECT COUNT(*) as count FROM favorites').get();
const newFavorites = db.prepare('SELECT COUNT(*) as count FROM videos WHERE favorite = 1').get();

console.log(`Favorites: old=${oldFavorites.count}, new=${newFavorites.count}`);
if (oldFavorites.count !== newFavorites.count) {
  console.error('❌ MISMATCH: Favorites count different!');
  process.exit(1);
}

// Check hidden
const oldHidden = db.prepare('SELECT COUNT(*) as count FROM hidden_files').get();
const newHidden = db.prepare('SELECT COUNT(*) as count FROM videos WHERE hidden = 1').get();

console.log(`Hidden: old=${oldHidden.count}, new=${newHidden.count}`);
if (oldHidden.count !== newHidden.count) {
  console.error('❌ MISMATCH: Hidden count different!');
  process.exit(1);
}

// Check ratings
const oldRatings = db.prepare('SELECT COUNT(*) as count FROM ratings').get();
const newRatings = db.prepare('SELECT COUNT(*) as count FROM videos WHERE rating > 0').get();

console.log(`Ratings: old=${oldRatings.count}, new=${newRatings.count}`);
if (oldRatings.count !== newRatings.count) {
  console.error('❌ MISMATCH: Ratings count different!');
  process.exit(1);
}

console.log('\n✅ All data migrated correctly!');
db.close();
```

**Run verification:**
```bash
node scripts/verify-migration.js
```

---

### Step 1.5: Remove Old Tables (Day 3)

**Only after verification passes!**

**File:** `src/database/core/DatabaseCore.ts`

```typescript
// Add to migration or run manually
function removeOldTables(db: Database) {
  console.log('[Cleanup] Removing old tables...');
  
  // Backup first (optional but recommended)
  db.exec(`
    CREATE TABLE _backup_favorites AS SELECT * FROM favorites;
    CREATE TABLE _backup_hidden_files AS SELECT * FROM hidden_files;
    CREATE TABLE _backup_ratings AS SELECT * FROM ratings;
  `);
  
  // Drop old tables
  db.exec(`
    DROP TABLE IF EXISTS favorites;
    DROP TABLE IF EXISTS hidden_files;
    DROP TABLE IF EXISTS ratings;
  `);
  
  // Update version
  db.exec(`
    INSERT OR REPLACE INTO app_state (key, value) 
    VALUES ('schema_version', '2.1');
  `);
  
  console.log('[Cleanup] Old tables removed');
}
```

**File:** `src/database/operations/UserDataOperations.ts`

Remove dual-write code:

```typescript
addFavorite(videoId: VideoId): boolean {
  const db = this.core.getConnection();
  
  try {
    db.prepare('UPDATE videos SET favorite = 1 WHERE id = ?').run(videoId);
    // REMOVED: Old table write
    
    this.queryCache.invalidatePattern('favorites');
    return true;
  } catch (error) {
    console.error('Error adding favorite:', error);
    return false;
  }
}
```

**Testing Checkpoint 1.5:**
```bash
npm run build:ts
npm run start

# Full regression test:
# 1. Toggle favorites - should work
# 2. Hide videos - should work
# 3. Rate videos - should work
# 4. Tag videos - should work
# 5. Close and reopen - should persist
# 6. Performance should be better
```

**Phase 1 Complete!** ✅
- Single source of truth in videos table
- Faster queries (no JOINs)
- Backward compatible with folder metadata
- Ready for WASM integration

---

## Phase 2: Folder Metadata Sync (Week 1-2)

**Goal:** Folder metadata becomes source of truth, database becomes cache

### Step 2.1: Upgrade Folder Metadata Format (Day 4)

**File:** `src/folder-metadata.ts`

```typescript
interface FolderMetadataV2 {
  version: '2.0.0';
  folderPath: string;
  folderName: string;
  createdAt: string;
  lastUpdated: string;
  
  // NEW: Store per video, not separate arrays
  videos: Record<VideoId, {
    path: string;  // Relative to folder
    favorite: boolean;
    hidden: boolean;
    rating: number;
    tags: string[];
    notes: string;
    customThumbnail?: string;
    lastViewed?: string;
    viewCount: number;
  }>;
  
  // NEW: Collections support
  collections?: Array<{
    id: string;
    name: string;
    videoIds: VideoId[];
  }>;
  
  // NEW: Folder-specific settings
  settings?: {
    defaultSort?: string;
    defaultView?: string;
    gridColumns?: number;
  };
}

export class FolderMetadataManager {
  private metadata: FolderMetadataV2 | null = null;
  
  async initializeFolder(folderPath: string): Promise<void> {
    const metadataPath = this.getMetadataPath(folderPath);
    
    if (fs.existsSync(metadataPath)) {
      const data = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      
      // Migrate from v1.0.0 to v2.0.0
      if (data.version === '1.0.0') {
        this.metadata = this.migrateV1toV2(data, folderPath);
        await this.save();
        console.log('[FolderMetadata] Migrated v1 → v2');
      } else {
        this.metadata = data;
      }
    } else {
      // Create new v2 metadata
      this.metadata = {
        version: '2.0.0',
        folderPath,
        folderName: path.basename(folderPath),
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        videos: {},
        collections: [],
        settings: {}
      };
      
      await this.save();
    }
  }
  
  private migrateV1toV2(v1: any, folderPath: string): FolderMetadataV2 {
    const videos: Record<string, any> = {};
    
    // Convert arrays to video objects
    const allVideoIds = new Set([
      ...v1.favorites,
      ...v1.hidden,
      ...Object.keys(v1.ratings || {}),
      ...Object.keys(v1.tags || {})
    ]);
    
    allVideoIds.forEach(id => {
      videos[id] = {
        path: '', // Will be filled by scanner
        favorite: v1.favorites.includes(id),
        hidden: v1.hidden.includes(id),
        rating: v1.ratings[id] || 0,
        tags: v1.tags[id] || [],
        notes: '',
        viewCount: 0
      };
    });
    
    return {
      version: '2.0.0',
      folderPath,
      folderName: path.basename(folderPath),
      createdAt: v1.lastUpdated || new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      videos,
      collections: [],
      settings: {}
    };
  }
  
  // NEW: Get or create video entry
  getVideoData(videoId: VideoId): FolderMetadataV2['videos'][VideoId] {
    if (!this.metadata) throw new Error('No folder initialized');
    
    if (!this.metadata.videos[videoId]) {
      this.metadata.videos[videoId] = {
        path: '',
        favorite: false,
        hidden: false,
        rating: 0,
        tags: [],
        notes: '',
        viewCount: 0
      };
    }
    
    return this.metadata.videos[videoId];
  }
  
  // NEW: Update video data
  async updateVideoData(videoId: VideoId, updates: Partial<FolderMetadataV2['videos'][VideoId]>): Promise<boolean> {
    if (!this.metadata) return false;
    
    const video = this.getVideoData(videoId);
    Object.assign(video, updates);
    
    await this.save();
    return true;
  }
  
  // Simplified API methods
  async addFavorite(videoId: VideoId): Promise<boolean> {
    return this.updateVideoData(videoId, { favorite: true });
  }
  
  async removeFavorite(videoId: VideoId): Promise<boolean> {
    return this.updateVideoData(videoId, { favorite: false });
  }
  
  // ... similar for hidden, rating, tags ...
  
  // NEW: Export all video data for database sync
  getAllVideosData(): Record<VideoId, FolderMetadataV2['videos'][VideoId]> {
    return this.metadata?.videos || {};
  }
}
```

**Testing Checkpoint 2.1:**
```bash
npm run build:ts
npm run start

# Load folder with old v1 metadata
# Check .vdotapes/metadata.json
# Should be upgraded to v2 format
```

---

### Step 2.2: Sync Folder Metadata to Database (Day 5)

**File:** `src/ipc-handlers.ts`

```typescript
async handleScanVideos(_event: IpcMainInvokeEvent, folderPath: string): Promise<ScanResult> {
  try {
    // ... existing scan logic ...
    
    // NEW: Initialize folder metadata
    await this.folderMetadata.initializeFolder(folderPath);
    
    const result = await this.videoScanner.scanVideos(folderPath);
    
    if (result.success && result.videos.length > 0) {
      // Get all user data from folder metadata
      const metadataVideos = this.folderMetadata.getAllVideosData();
      
      // Merge video files with metadata and save to database
      const videosWithMetadata = result.videos.map(video => {
        const metadata = metadataVideos[video.id] || {};
        
        return {
          ...video,
          favorite: metadata.favorite || false,
          hidden: metadata.hidden || false,
          rating: metadata.rating || 0,
          tags: metadata.tags || [],
          notes: metadata.notes || '',
          lastViewed: metadata.lastViewed,
          viewCount: metadata.viewCount || 0
        };
      });
      
      // Save to database (with user data)
      this.database.addVideosWithMetadata(videosWithMetadata);
      
      // Save folder path
      this.database.saveLastFolder(folderPath);
      
      console.log(
        `[Sync] Loaded ${result.videos.length} videos with metadata ` +
        `(${Object.keys(metadataVideos).length} entries)`
      );
    }
    
    return result;
  } catch (error) {
    console.error('Error in scan-videos handler:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      videos: [],
      folders: []
    };
  }
}
```

**File:** `src/database/operations/VideoOperations.ts`

```typescript
// NEW: Add videos with metadata in one operation
addVideosWithMetadata(videos: Array<VideoRecord & UserData>): boolean {
  const db = this.core.getConnection();
  
  try {
    this.transactionManager.executeTransaction(() => {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO videos (
          id, name, path, folder, size, duration, width, height,
          codec, bitrate, last_modified, created,
          favorite, hidden, rating, notes, last_viewed, view_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const tagStmt = db.prepare(`
        INSERT OR IGNORE INTO video_tags (video_id, tag) VALUES (?, ?)
      `);
      
      for (const video of videos) {
        stmt.run(
          video.id, video.name, video.path, video.folder,
          video.size, video.duration, video.width, video.height,
          video.codec, video.bitrate, video.lastModified, video.created,
          video.favorite ? 1 : 0,
          video.hidden ? 1 : 0,
          video.rating || 0,
          video.notes || '',
          video.lastViewed,
          video.viewCount || 0
        );
        
        // Add tags
        if (video.tags && video.tags.length > 0) {
          for (const tag of video.tags) {
            tagStmt.run(video.id, tag);
          }
        }
      }
    });
    
    console.log(`[Database] Inserted ${videos.length} videos with metadata`);
    return true;
  } catch (error) {
    console.error('Error adding videos with metadata:', error);
    return false;
  }
}
```

**Testing Checkpoint 2.2:**
```bash
npm run build:ts
npm run start

# Test sync:
# 1. Load folder with existing favorites/tags
# 2. Check that favorites appear in UI
# 3. DevTools: window.electronAPI.getVideos().then(v => v.filter(x => x.isFavorite))
# Should show favorited videos
```

---

### Step 2.3: Write-Through to Folder Metadata (Day 5-6)

**File:** `src/ipc-handlers.ts`

```typescript
async handleSaveFavorite(
  _event: IpcMainInvokeEvent,
  videoId: VideoId,
  isFavorite: boolean
): Promise<boolean> {
  try {
    if (!this.isInitialized) await this.initialize();
    
    // 1. Update folder metadata (source of truth)
    const folderResult = isFavorite
      ? await this.folderMetadata.addFavorite(videoId)
      : await this.folderMetadata.removeFavorite(videoId);
    
    if (!folderResult) {
      console.error('[IPC] Failed to update folder metadata');
      return false;
    }
    
    // 2. Update database cache
    const dbResult = isFavorite
      ? this.database.addFavorite(videoId)
      : this.database.removeFavorite(videoId);
    
    if (!dbResult) {
      console.warn('[IPC] Failed to update database cache (non-fatal)');
    }
    
    console.log(`[IPC] Set favorite ${videoId}: ${isFavorite}`);
    return true;
  } catch (error) {
    console.error('Error saving favorite:', error);
    return false;
  }
}

// Similar for: handleSaveHiddenFile, handleSaveRating, handleTagsAdd, handleTagsRemove
```

**Testing Checkpoint 2.3:**
```bash
npm run build:ts
npm run start

# Test write-through:
# 1. Toggle favorite
# 2. Check .vdotapes/metadata.json - should update immediately
# 3. Close app
# 4. Check database file directly
# 5. Reopen app - both should be in sync
```

---

### Step 2.4: Add Data Verification Tool (Day 6)

**File:** `scripts/verify-sync.js`

```javascript
/**
 * Verify folder metadata and database are in sync
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), '.vdotapes', 'vdotapes.db');
const db = new Database(dbPath);

// Get current folder
const currentFolder = db.prepare(
  "SELECT value FROM app_state WHERE key = 'last_folder'"
).get()?.value;

if (!currentFolder) {
  console.log('No folder loaded');
  process.exit(0);
}

console.log(`Checking sync for: ${currentFolder}\n`);

// Load folder metadata
const metadataPath = path.join(currentFolder, '.vdotapes', 'metadata.json');
if (!fs.existsSync(metadataPath)) {
  console.log('No folder metadata found');
  process.exit(0);
}

const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
const dbVideos = db.prepare('SELECT id, favorite, hidden, rating FROM videos').all();

let mismatches = 0;

for (const dbVideo of dbVideos) {
  const metaVideo = metadata.videos[dbVideo.id];
  
  if (!metaVideo) continue; // Video not in metadata yet (ok)
  
  // Check favorite
  if ((dbVideo.favorite === 1) !== metaVideo.favorite) {
    console.error(`❌ Favorite mismatch: ${dbVideo.id}`);
    console.error(`   DB: ${dbVideo.favorite}, Folder: ${metaVideo.favorite}`);
    mismatches++;
  }
  
  // Check hidden
  if ((dbVideo.hidden === 1) !== metaVideo.hidden) {
    console.error(`❌ Hidden mismatch: ${dbVideo.id}`);
    console.error(`   DB: ${dbVideo.hidden}, Folder: ${metaVideo.hidden}`);
    mismatches++;
  }
  
  // Check rating
  if (dbVideo.rating !== metaVideo.rating) {
    console.error(`❌ Rating mismatch: ${dbVideo.id}`);
    console.error(`   DB: ${dbVideo.rating}, Folder: ${metaVideo.rating}`);
    mismatches++;
  }
}

if (mismatches === 0) {
  console.log('✅ Database and folder metadata in sync!');
} else {
  console.error(`\n❌ Found ${mismatches} mismatches`);
  process.exit(1);
}

db.close();
```

**Run regularly:**
```bash
node scripts/verify-sync.js
```

**Phase 2 Complete!** ✅
- Folder metadata is source of truth
- Database is fast cache
- Write-through keeps both in sync
- Ready for WASM integration

---

## Phase 3: Enable WASM Rendering (Week 2)

**Goal:** Switch from JS-based to WASM-based rendering

### Step 3.1: Update WASM Engine Loading (Day 7)

**File:** `app/renderer.js`

```javascript
setupWasmEngine() {
  window.addEventListener('wasm-ready', () => {
    try {
      if (!window.VideoGridEngine) {
        throw new Error('VideoGridEngine not available');
      }
      
      // Initialize WASM engine
      this.gridEngine = new window.VideoGridEngine(50);
      this.useWasmEngine = true;
      console.log('✅ WASM Grid Engine initialized');
      
      // Initialize Virtual Grid (uses WASM engine)
      if (window.VirtualVideoGrid) {
        this.initializeVirtualGrid();
      } else {
        console.warn('VirtualVideoGrid not available');
      }
    } catch (error) {
      console.error('Failed to initialize WASM engine:', error);
      this.useWasmEngine = false;
    }
  });
  
  window.addEventListener('wasm-failed', (event) => {
    console.error('WASM module failed to load:', event.detail);
    this.useWasmEngine = false;
    this.useVirtualGrid = false;
    console.log('Falling back to JavaScript rendering');
  });
}

initializeVirtualGrid() {
  try {
    this.virtualGrid = new window.VirtualVideoGrid({
      renderer: this,
      wasmEngine: this.gridEngine,
      maxActiveVideos: 30,  // Reduced to safe limit
      itemHeight: 400,
      itemsPerRow: this.gridCols,
      bufferRows: 3  // Reduced to reasonable buffer
    });
    
    this.useVirtualGrid = true;
    console.log('✅ Virtual Grid initialized');
    console.log(`   Max active videos: 30`);
    console.log(`   Buffer rows: 3`);
  } catch (error) {
    console.error('Failed to initialize Virtual Grid:', error);
    this.useVirtualGrid = false;
  }
}
```

**Testing Checkpoint 3.1:**
```bash
npm run build:ts
npm run start

# Check DevTools console:
# Should see:
# ✅ WASM Grid Engine initialized
# ✅ Virtual Grid initialized
```

---

### Step 3.2: Load Videos into WASM Engine (Day 7)

**File:** `app/renderer.js`

```javascript
async scanVideos(folderPath) {
  try {
    // ... existing scan logic ...
    
    if (result.success) {
      // Load from database (includes user data)
      const dbVideos = await window.electronAPI.getVideos({ sortBy: 'none' });
      
      if (dbVideos && dbVideos.length > 0) {
        this.allVideos = dbVideos;
        
        // Load into WASM engine if available
        if (this.useWasmEngine && this.gridEngine) {
          console.log(`[WASM] Loading ${dbVideos.length} videos into engine...`);
          
          const wasmVideos = dbVideos.map(v => ({
            id: v.id,
            name: v.name,
            path: v.path,
            folder: v.folder || '',
            size: v.size || 0,
            last_modified: v.lastModified || 0,
            duration: v.duration || 0,
            width: v.width || 0,
            height: v.height || 0,
            resolution: v.resolution || null,
            codec: v.codec || null,
            bitrate: v.bitrate || 0,
            is_favorite: v.isFavorite === true,
            is_hidden: v.isHidden === true,
            rating: v.rating || 0,
            tags: v.tags || []
          }));
          
          this.gridEngine.setVideos(wasmVideos);
          console.log(`[WASM] Loaded ${wasmVideos.length} videos`);
        }
        
        // Populate folder dropdown
        const folderSet = new Set();
        dbVideos.forEach(video => {
          if (video.folder) folderSet.add(video.folder);
        });
        this.folders = Array.from(folderSet).sort();
        this.populateFolderDropdown();
        
        // Apply filters and render
        this.applyCurrentFilters();
      }
      
      // ... rest of scan logic ...
    }
  } catch (error) {
    console.error('Error scanning videos:', error);
    this.uiHelper.showStatus('Error scanning folder');
  }
}
```

**Testing Checkpoint 3.2:**
```bash
npm run build:ts
npm run start

# Load a folder
# Check console:
# [WASM] Loading N videos into engine...
# [WASM] Loaded N videos
```

---

### Step 3.3: Use WASM for Filtering (Day 8)

**File:** `app/modules/FilterManager.js`

```javascript
applyCurrentFilters() {
  if (this.app.useWasmEngine && this.app.gridEngine) {
    this.applyWasmFilters();
  } else {
    this.applyJsFilters();
  }
}

applyWasmFilters() {
  console.log('[Filter] Using WASM engine');
  
  try {
    // Set filters in WASM
    this.app.gridEngine.setFilter('folder', this.app.currentFolder || null);
    this.app.gridEngine.setFilter('favorites_only', this.app.showingFavoritesOnly);
    this.app.gridEngine.setFilter('hide_hidden', !this.app.showingHiddenOnly);
    
    // Set tags filter
    if (this.app.activeTags && this.app.activeTags.length > 0) {
      this.app.gridEngine.setFilter('tags', this.app.activeTags);
      this.app.gridEngine.setFilter('tag_mode', this.app.tagFilterMode);
    } else {
      this.app.gridEngine.setFilter('tags', null);
    }
    
    // Apply filters in WASM (fast!)
    const filtered = this.app.gridEngine.applyFilters();
    
    console.log(`[Filter] WASM filtered: ${filtered.length} videos`);
    
    // Convert WASM results back to JS objects
    this.app.displayedVideos = filtered.map(wasmVideo => {
      // Find full video object
      return this.app.allVideos.find(v => v.id === wasmVideo.id) || wasmVideo;
    });
    
    // Apply sort
    this.applySortOrder();
    
    // Render
    this.app.renderGrid();
    this.app.updateStatusMessage();
  } catch (error) {
    console.error('[Filter] WASM filtering failed, falling back to JS:', error);
    this.applyJsFilters();
  }
}

// Keep JS fallback
applyJsFilters() {
  console.log('[Filter] Using JavaScript filtering');
  
  let filtered = this.app.allVideos;
  
  // ... existing JS filtering logic ...
  
  this.app.displayedVideos = filtered;
  this.applySortOrder();
  this.app.renderGrid();
  this.app.updateStatusMessage();
}
```

**Testing Checkpoint 3.3:**
```bash
npm run build:ts
npm run start

# Test filtering:
# 1. Filter by folder
# 2. Filter by favorites
# 3. Filter by tags
# 4. Combine multiple filters

# Check console:
# [Filter] Using WASM engine
# [Filter] WASM filtered: N videos

# Performance test:
console.time('filter')
// Change filter
console.timeEnd('filter')
# Should be <10ms even with 1000+ videos
```

---

### Step 3.4: Use Virtual Grid for Rendering (Day 8-9)

**File:** `app/modules/GridRenderer.js`

```javascript
renderGrid() {
  if (this.app.useVirtualGrid && this.app.virtualGrid) {
    this.renderVirtualGrid();
  } else {
    this.renderStandardGrid();
  }
}

renderVirtualGrid() {
  console.log(`[Renderer] Using Virtual Grid (${this.app.displayedVideos.length} videos)`);
  
  const container = document.getElementById('videoGrid');
  
  try {
    // Initialize virtual grid if first time
    if (!this.app.virtualGrid.isInitialized) {
      this.app.virtualGrid.init(container);
    } else {
      // Refresh with new videos
      this.app.virtualGrid.refresh();
    }
    
    // Virtual grid handles rendering automatically based on scroll position
    console.log('[Renderer] Virtual grid active');
  } catch (error) {
    console.error('[Renderer] Virtual grid failed, falling back:', error);
    this.renderStandardGrid();
  }
}

// Keep standard rendering as fallback
renderStandardGrid() {
  console.log(`[Renderer] Using standard grid (${this.app.displayedVideos.length} videos)`);
  
  const container = document.getElementById('videoGrid');
  container.innerHTML = '';
  
  // ... existing rendering logic ...
}
```

**File:** `app/video-virtual-grid.js`

Update buffer sizes:

```javascript
constructor(options = {}) {
  // ... existing code ...
  
  // Updated to safe values
  this.maxActiveVideos = options.maxActiveVideos || 30;  // Safe browser limit
  this.bufferRows = options.bufferRows || 3;  // Reasonable buffer
  
  console.log('[VirtualGrid] Config:', {
    maxActiveVideos: this.maxActiveVideos,
    bufferRows: this.bufferRows,
    itemHeight: this.itemHeight,
    itemsPerRow: this.itemsPerRow
  });
}
```

**Testing Checkpoint 3.4:**
```bash
npm run build:ts
npm run start

# Load folder with 100+ videos
# Should see:
# [Renderer] Using Virtual Grid (N videos)

# Test scrolling:
# 1. Scroll down - videos should load smoothly
# 2. Scroll up - videos should load smoothly
# 3. No lag or stuttering
# 4. Check DevTools console - no errors
# 5. Check Network tab - videos loading/unloading

# Performance:
# Open DevTools Performance profiler
# Scroll through grid
# Should see minimal JavaScript work (WASM doing heavy lifting)
```

---

### Step 3.5: Remove Old Loading System (Day 9)

**Only after Virtual Grid is proven stable!**

**File:** `app/renderer.js`

Remove SmartLoader:

```javascript
constructor() {
  // ... existing code ...
  
  // REMOVED: this.smartLoader = null;
  // REMOVED: this.useSmartLoading = true;
  
  // Keep only WASM systems
  this.gridEngine = null;
  this.virtualGrid = null;
  this.useWasmEngine = true;  // Default to true
  this.useVirtualGrid = true;  // Default to true
  
  // ... rest of initialization ...
}

// REMOVED: setupSmartLoader() method
```

**File:** `app/video-smart-loader.js`

Can be deleted entirely (backup first!):

```bash
git mv app/video-smart-loader.js app/video-smart-loader.js.backup
```

**File:** `app/modules/VideoManager.js`

Remove SmartLoader references:

```javascript
async loadVideo(videoElement, container, retryCount = 0) {
  // ... existing code ...
  
  // REMOVED: Check if approaching WebMediaPlayer limit
  // REMOVED: this.app.smartLoader code
  
  // Virtual grid handles this automatically
  
  // ... rest of method ...
}

unloadVideoById(videoId) {
  // ... existing code ...
  
  // REMOVED: SmartLoader references
  // REMOVED: this.app.smartLoader.loadedVideos.delete(videoId)
  
  // Virtual grid tracks this internally
}
```

**Testing Checkpoint 3.5:**
```bash
npm run build:ts
npm run start

# Full regression test:
# 1. Load folder
# 2. Scroll through videos
# 3. Filter and sort
# 4. Toggle favorites
# 5. Everything should still work

# Check console - no SmartLoader messages
```

**Phase 3 Complete!** ✅
- WASM engine handles filtering/sorting
- Virtual grid handles rendering
- Old JavaScript systems removed
- Performance improved

---

## Phase 4: Cleanup and Optimization (Week 2-3)

### Step 4.1: Remove Unused WASM Modules (Day 10)

**Check what's actually being used:**

```bash
# Check if VideoWasmLoader is used
grep -r "VideoWasmLoader" app/
grep -r "useWasmLoader" app/

# If not used, remove:
rm app/video-wasm-loader.js
```

**File:** `app/renderer.js`

Remove unused WASM loader:

```javascript
constructor() {
  // ... existing code ...
  
  // REMOVED: this.wasmLoader = null;
  // REMOVED: this.useWasmLoader = false;
}

// REMOVED: initializeWasmLoader() method
```

---

### Step 4.2: Remove Query Cache (Day 10)

**Since database queries are now simple and fast:**

**File:** `src/database/VideoDatabase.ts`

```typescript
constructor() {
  // Initialize core
  this.core = new DatabaseCore();
  this.transactionManager = new TransactionManager(this.core);

  // REMOVED: Query cache
  // REMOVED: Performance monitor
  // REMOVED: Cache warmer

  // Initialize operation modules (without cache/monitor)
  this.videoOps = new VideoOperations(
    this.core,
    this.transactionManager
  );

  this.userDataOps = new UserDataOperations(
    this.core,
    this.transactionManager
  );

  // ... etc ...
}

// REMOVED: initializeCacheWarmer()
// REMOVED: getPerformanceStats()
// REMOVED: logPerformanceReport()
```

**Files to delete:**
```bash
git rm src/query-cache.js
git rm src/performance-monitor.js
git rm src/performance/DatabasePerformanceManager.js
```

---

### Step 4.3: Update Dependencies (Day 10-11)

**File:** `package.json`

```json
{
  "dependencies": {
    "@playwright/test": "^1.55.0",
    "better-sqlite3": "^12.2.0"
  },
  "devDependencies": {
    // Add testing
    "jest": "^29.7.0",
    "@types/jest": "^29.5.0",
    
    // Existing
    "@electron/rebuild": "^4.0.1",
    "@napi-rs/cli": "^3.3.1",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^24.3.0",
    "@typescript-eslint/eslint-plugin": "^7.18.0",
    "@typescript-eslint/parser": "^7.18.0",
    "electron": "^37.2.1",
    "electron-builder": "^26.0.12",
    "eslint": "^8.57.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-import": "^2.29.1",
    "prettier": "^3.3.3",
    "typescript": "^5.9.2"
  }
}
```

```bash
npm install
```

---

### Step 4.4: Add Unit Tests (Day 11-12)

**File:** `tests/unit/database.test.ts`

```typescript
import { VideoDatabase } from '../../src/database/VideoDatabase';
import { createVideoId } from '../../types/guards';

describe('VideoDatabase', () => {
  let db: VideoDatabase;
  
  beforeEach(async () => {
    // Use in-memory database for tests
    db = new VideoDatabase(':memory:');
    await db.initialize();
  });
  
  afterEach(() => {
    db.close();
  });
  
  test('should add and retrieve video', () => {
    const videoId = createVideoId('test123');
    
    db.addVideo({
      id: videoId,
      name: 'test.mp4',
      path: '/path/to/test.mp4',
      folder: 'TestFolder',
      size: 1024000
    });
    
    const video = db.getVideoById(videoId);
    expect(video).not.toBeNull();
    expect(video?.name).toBe('test.mp4');
  });
  
  test('should toggle favorite', () => {
    const videoId = createVideoId('test123');
    
    db.addVideo({
      id: videoId,
      name: 'test.mp4',
      path: '/path/to/test.mp4'
    });
    
    db.addFavorite(videoId);
    let video = db.getVideoById(videoId);
    expect(video?.favorite).toBe(1);
    
    db.removeFavorite(videoId);
    video = db.getVideoById(videoId);
    expect(video?.favorite).toBe(0);
  });
  
  test('should filter by favorites', () => {
    db.addVideo({
      id: createVideoId('test1'),
      name: 'test1.mp4',
      path: '/test1.mp4'
    });
    
    db.addVideo({
      id: createVideoId('test2'),
      name: 'test2.mp4',
      path: '/test2.mp4'
    });
    
    db.addFavorite(createVideoId('test1'));
    
    const favorites = db.getVideos({ favoritesOnly: true });
    expect(favorites.length).toBe(1);
    expect(favorites[0].name).toBe('test1.mp4');
  });
  
  // Add more tests...
});
```

**File:** `jest.config.js`

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/unit'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  }
};
```

**Run tests:**
```bash
npm test
```

---

### Step 4.5: Add Integration Tests (Day 13-14)

**File:** `tests/e2e/video-loading.spec.ts`

```typescript
import { test, expect, _electron as electron } from '@playwright/test';

test.describe('Video Loading', () => {
  test('should load and display videos', async () => {
    const app = await electron.launch({ args: ['.'] });
    const window = await app.firstWindow();
    
    // Wait for app to load
    await window.waitForSelector('#selectFolderBtn');
    
    // Load test folder
    await window.evaluate(async () => {
      await window.electronAPI.scanVideos('/path/to/test/videos');
    });
    
    // Wait for videos to load
    await window.waitForSelector('.video-item', { timeout: 10000 });
    
    // Check video count
    const videoCount = await window.locator('.video-item').count();
    expect(videoCount).toBeGreaterThan(0);
    
    await app.close();
  });
  
  test('should filter favorites', async () => {
    const app = await electron.launch({ args: ['.'] });
    const window = await app.firstWindow();
    
    // Load folder
    await window.evaluate(async () => {
      await window.electronAPI.scanVideos('/path/to/test/videos');
    });
    
    await window.waitForSelector('.video-item');
    
    // Toggle favorite on first video
    await window.locator('.video-favorite').first().click();
    
    // Enable favorites filter
    await window.locator('#toggleFavoritesBtn').click();
    
    // Should show only 1 video
    const favoriteCount = await window.locator('.video-item').count();
    expect(favoriteCount).toBe(1);
    
    await app.close();
  });
  
  // Add more tests...
});
```

**Run integration tests:**
```bash
npm run test:e2e
```

---

### Step 4.6: Performance Benchmarks (Day 14)

**File:** `tests/performance/benchmark.js`

```javascript
const Database = require('better-sqlite3');
const { performance } = require('perf_hooks');

// Create test database with N videos
function createTestDatabase(videoCount) {
  const db = new Database(':memory:');
  
  db.exec(`
    CREATE TABLE videos (
      id TEXT PRIMARY KEY,
      name TEXT,
      path TEXT,
      folder TEXT,
      favorite INTEGER DEFAULT 0,
      hidden INTEGER DEFAULT 0,
      rating INTEGER DEFAULT 0
    );
    
    CREATE INDEX idx_videos_favorite ON videos(favorite);
    CREATE INDEX idx_videos_folder ON videos(folder);
  `);
  
  const stmt = db.prepare(`
    INSERT INTO videos (id, name, path, folder, favorite, rating)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  for (let i = 0; i < videoCount; i++) {
    stmt.run(
      `video_${i}`,
      `video_${i}.mp4`,
      `/path/to/video_${i}.mp4`,
      `folder_${i % 10}`,
      i % 5 === 0 ? 1 : 0,  // 20% favorited
      i % 3 === 0 ? 5 : 0   // 33% rated
    );
  }
  
  return db;
}

// Benchmark query performance
function benchmarkQuery(db, name, query, iterations = 1000) {
  const start = performance.now();
  
  for (let i = 0; i < iterations; i++) {
    db.prepare(query).all();
  }
  
  const end = performance.now();
  const avgTime = (end - start) / iterations;
  
  console.log(`${name}: ${avgTime.toFixed(2)}ms avg`);
}

// Run benchmarks
console.log('=== Database Performance Benchmarks ===\n');

for (const count of [100, 1000, 5000, 10000]) {
  console.log(`\nTesting with ${count} videos:`);
  const db = createTestDatabase(count);
  
  benchmarkQuery(
    db,
    '  Get all videos',
    'SELECT * FROM videos'
  );
  
  benchmarkQuery(
    db,
    '  Get favorites',
    'SELECT * FROM videos WHERE favorite = 1'
  );
  
  benchmarkQuery(
    db,
    '  Get by folder',
    'SELECT * FROM videos WHERE folder = "folder_5"'
  );
  
  benchmarkQuery(
    db,
    '  Complex filter',
    'SELECT * FROM videos WHERE favorite = 1 AND folder = "folder_5" AND rating >= 3'
  );
  
  db.close();
}

console.log('\n=== Benchmarks Complete ===');
```

**Run benchmarks:**
```bash
node tests/performance/benchmark.js
```

**Expected results:**
```
Testing with 10000 videos:
  Get all videos: 12.50ms avg
  Get favorites: 0.85ms avg
  Get by folder: 0.92ms avg
  Complex filter: 0.45ms avg
```

---

### Step 4.7: Documentation (Day 15)

**File:** `docs/architecture.md`

```markdown
# VDOTapes Architecture

## Data Flow

```
┌─────────────────────────────────────────┐
│  Video Folder (.vdotapes/metadata.json) │  ← Source of Truth
└─────────────────┬───────────────────────┘
                  │
                  ↓ (Load on scan)
┌─────────────────────────────────────────┐
│  SQLite Database (Cache)                │  ← Fast queries
└─────────────────┬───────────────────────┘
                  │
                  ↓ (Read for rendering)
┌─────────────────────────────────────────┐
│  WASM Grid Engine                       │  ← Filter/Sort
└─────────────────┬───────────────────────┘
                  │
                  ↓ (Calculate viewport)
┌─────────────────────────────────────────┐
│  Virtual Grid Renderer                  │  ← Render visible
└─────────────────────────────────────────┘
```

## User Action Flow

Example: Toggle Favorite

1. User clicks favorite button
2. `handleSaveFavorite()` in IPC handlers
3. Update folder metadata (write to .vdotapes/metadata.json)
4. Update database cache (UPDATE videos SET favorite = 1)
5. Notify WASM engine (engine.updateVideoState())
6. Re-filter if needed (engine.applyFilters())
7. Virtual grid updates viewport
8. UI shows change immediately

## Performance Characteristics

- **Folder scan:** O(n) - must read all files
- **Database queries:** O(log n) - indexed
- **WASM filtering:** O(n) - but 10-100x faster than JS
- **Virtual rendering:** O(viewport) - only render visible

## Key Components

- **Native Scanner:** Rust module for fast file scanning
- **Folder Metadata:** JSON file in each video folder
- **SQLite Cache:** In-memory index for fast queries
- **WASM Engine:** Rust-compiled filtering/sorting
- **Virtual Grid:** Smart viewport management
```

**File:** `docs/developer-guide.md`

```markdown
# Developer Guide

## Building

```bash
# Build TypeScript
npm run build:ts

# Build native modules
npm run build:native
npm run build:thumbnails

# Build everything
npm run build:all
```

## Running

```bash
# Development (with DevTools)
npm run dev

# Production
npm start
```

## Testing

```bash
# Unit tests
npm test

# Integration tests
npm run test:e2e

# Performance benchmarks
node tests/performance/benchmark.js

# Verify data sync
node scripts/verify-sync.js
```

## Debugging

### WASM Issues

Check if WASM loaded:
```javascript
// In DevTools console
window.VideoGridEngine
window.VirtualVideoGrid
```

Enable WASM debugging:
```javascript
localStorage.setItem('debug:wasm', 'true')
```

### Database Issues

Inspect database directly:
```bash
sqlite3 ~/.vdotapes/vdotapes.db
.tables
.schema videos
SELECT * FROM videos LIMIT 5;
```

### Performance Issues

Profile with Chrome DevTools:
1. Open DevTools
2. Performance tab
3. Record while scrolling
4. Look for long JS tasks (should be minimal with WASM)
```

**Phase 4 Complete!** ✅
- Unused code removed
- Tests added
- Documentation written
- Performance benchmarked

---

## Final Verification Checklist

Before declaring refactor complete:

### Functionality Tests
- [ ] Scan folder with 100+ videos
- [ ] Toggle favorites - persists across restart
- [ ] Hide videos - persists across restart
- [ ] Rate videos - persists across restart
- [ ] Add/remove tags - persists across restart
- [ ] Filter by folder
- [ ] Filter by favorites
- [ ] Filter by tags
- [ ] Sort by name/date/size
- [ ] Scroll through large grid (500+ videos)
- [ ] Switch between folders
- [ ] Export/import backup

### Performance Tests
- [ ] Folder scan <30s for 1000 videos
- [ ] Filtering <100ms for 5000 videos
- [ ] Scrolling smooth with 1000+ videos
- [ ] Memory usage <500MB with 1000 videos
- [ ] No memory leaks after 30min use

### Data Integrity Tests
- [ ] Run `node scripts/verify-sync.js` - passes
- [ ] Compare .vdotapes/metadata.json with database
- [ ] Move folder - metadata travels with it
- [ ] Copy folder - copy has same favorites/tags
- [ ] Delete .vdotapes - can recreate from database

### Code Quality Tests
- [ ] `npm run lint` - no errors
- [ ] `npm test` - all pass, >70% coverage
- [ ] `npm run test:e2e` - all pass
- [ ] No console errors in production
- [ ] DevTools Performance shows <16ms frame times

---

## Rollback Procedure

If something goes wrong:

### Phase 1 Rollback (Database)
```bash
# Restore from backup tables
sqlite3 ~/.vdotapes/vdotapes.db
DROP TABLE IF EXISTS favorites;
DROP TABLE IF EXISTS hidden_files;
DROP TABLE IF EXISTS ratings;

ALTER TABLE _backup_favorites RENAME TO favorites;
ALTER TABLE _backup_hidden_files RENAME TO hidden_files;
ALTER TABLE _backup_ratings RENAME TO ratings;

UPDATE app_state SET value = '1' WHERE key = 'schema_version';
```

### Phase 2 Rollback (Folder Metadata)
```bash
# Revert folder metadata to v1
# Manually edit .vdotapes/metadata.json
# Or delete and rescan
```

### Phase 3 Rollback (WASM)
```javascript
// In app/renderer.js
this.useWasmEngine = false;
this.useVirtualGrid = false;
this.useSmartLoading = true;
```

---

## Success Criteria

Refactor is successful when:

1. ✅ Single source of truth (folder metadata)
2. ✅ Database is fast cache only
3. ✅ WASM engine handles heavy lifting
4. ✅ Virtual grid renders efficiently
5. ✅ All tests passing
6. ✅ Performance improved vs. old system
7. ✅ No data loss or corruption
8. ✅ Documentation complete

---

## Estimated Timeline

| Phase | Duration | Effort |
|-------|----------|--------|
| Phase 1: Database Consolidation | 3 days | Medium |
| Phase 2: Folder Metadata Sync | 3 days | Medium |
| Phase 3: Enable WASM | 3 days | High |
| Phase 4: Cleanup & Testing | 5-6 days | Medium |
| **Total** | **14-15 days** | **2-3 weeks** |

## Resources Needed

- 1 developer full-time
- Test machine with 1000+ videos
- Backup of production data
- Rollback plan ready

---

*Refactoring Plan v1.0 - Created 2024*
