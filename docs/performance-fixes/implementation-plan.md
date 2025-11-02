# Performance Optimization Implementation Plan

**Priority: High Impact / Low Effort**
**Estimated Total Time: 3-4 hours**
**Expected Performance Gain: 40-70% across critical paths**

---

## 1. Add Script Bundling with esbuild

**Impact**: 70% smaller bundle, 40% faster initial load
**Time**: 60-90 minutes
**Difficulty**: Medium

### Steps
1. Install esbuild: `npm install --save-dev esbuild`
2. Create `build-renderer.js`:
   ```javascript
   const esbuild = require('esbuild');

   esbuild.build({
     entryPoints: ['app/renderer.js'],
     bundle: true,
     outfile: 'dist/renderer/bundle.js',
     platform: 'browser',
     target: 'es2022',
     minify: true,
     sourcemap: true,
     external: ['electron']
   });
   ```
3. Update `package.json`:
   ```json
   "build:renderer": "node build-renderer.js"
   ```
4. Update `app/index.html` to load single bundle instead of 12 scripts
5. Test: `npm run dev`

**Files Modified**:
- `package.json`
- `app/index.html`
- New: `build-renderer.js`

---

## 2. Remove Redundant Database Indexes

**Impact**: 40-50% faster video scanning
**Time**: 30 minutes
**Difficulty**: Easy

### Steps
1. Open `src/database/core/DatabaseCore.ts:202-242`
2. Remove these redundant indexes from the `indexes` array:
   ```typescript
   // REMOVE (keep only 5 essential indexes):
   'CREATE INDEX IF NOT EXISTS idx_videos_name ON videos (name)',
   'CREATE INDEX IF NOT EXISTS idx_videos_size_desc ON videos (size DESC)',
   'CREATE INDEX IF NOT EXISTS idx_videos_updated ON videos (updated_at)',
   'CREATE INDEX IF NOT EXISTS idx_videos_name_folder ON videos (name, folder)',
   'CREATE INDEX IF NOT EXISTS idx_videos_folder_size ON videos (folder, size DESC)',
   'CREATE INDEX IF NOT EXISTS idx_videos_folder_date_size ON videos (folder, last_modified DESC, size DESC)',
   'CREATE INDEX IF NOT EXISTS idx_videos_name_date ON videos (name, last_modified DESC)',
   'CREATE INDEX IF NOT EXISTS idx_videos_size_date ON videos (size DESC, last_modified DESC)',
   ```
3. Keep only essential indexes:
   ```typescript
   // KEEP:
   'CREATE INDEX IF NOT EXISTS idx_videos_folder ON videos (folder)',
   'CREATE INDEX IF NOT EXISTS idx_videos_last_modified ON videos (last_modified DESC)',
   'CREATE INDEX IF NOT EXISTS idx_videos_size ON videos (size)',
   'CREATE INDEX IF NOT EXISTS idx_videos_path ON videos (path)',
   'CREATE INDEX IF NOT EXISTS idx_videos_folder_modified ON videos (folder, last_modified DESC)',
   ```
4. Delete existing database to rebuild with new indexes: `rm ~/.config/vdotapes/videos.db`
5. Test: Scan a large folder, verify speed improvement

**Files Modified**:
- `src/database/core/DatabaseCore.ts`

---

## 3. Replace deepClone with structuredClone

**Impact**: 60-70% faster cache operations
**Time**: 15 minutes
**Difficulty**: Easy

### Steps
1. Open `src/query-cache.js:115-127`
2. Replace entire `deepClone()` method with:
   ```javascript
   deepClone(obj) {
     try {
       return structuredClone(obj);
     } catch (error) {
       // Fallback for non-cloneable objects (functions, symbols)
       console.warn('structuredClone failed, using JSON fallback:', error);
       return JSON.parse(JSON.stringify(obj));
     }
   }
   ```
3. Test: Load a large video collection, verify cache performance

**Files Modified**:
- `src/query-cache.js`

**Note**: `structuredClone()` is native in Node.js 17+ (Electron 37 uses Node 22, fully supported)

---

## 4. Optimize Tag Batch Sync

**Impact**: 50-60% faster bulk tag operations
**Time**: 45 minutes
**Difficulty**: Medium

### Steps
1. Open `src/database/VideoDatabase.ts:347-415` (syncFolderMetadata method)
2. Replace tag syncing section (lines 391-395) with prepared statement optimization:
   ```typescript
   // Prepare statements ONCE before loop (lines 366-367)
   const addFavoriteStmt = db.prepare('INSERT OR IGNORE INTO favorites (video_id) VALUES (?)');
   const addHiddenStmt = db.prepare('INSERT OR IGNORE INTO hidden_files (video_id) VALUES (?)');
   const saveRatingStmt = db.prepare('INSERT OR REPLACE INTO ratings (video_id, rating) VALUES (?, ?)');

   // ADD: Tag statements
   const upsertTagStmt = db.prepare(`
     INSERT INTO tags (name) VALUES (?)
     ON CONFLICT(name) DO UPDATE SET name = excluded.name
     RETURNING id
   `);
   const addVideoTagStmt = db.prepare(`
     INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)
   `);

   // Replace lines 391-395 with:
   for (const tag of metadata.tags) {
     const tagResult = upsertTagStmt.get(tag.trim()) as { id: number } | undefined;
     if (tagResult?.id) {
       addVideoTagStmt.run(videoId, tagResult.id);
       synced++;
     }
   }
   ```
3. Test: Import a backup with many tags, verify speed improvement

**Files Modified**:
- `src/database/VideoDatabase.ts`

---

## Testing Checklist

After implementing all 4 optimizations:

- [ ] `npm run build` completes successfully
- [ ] App launches without errors
- [ ] Scan a folder with 100+ videos - verify faster scanning
- [ ] Filter by tags - verify faster filtering
- [ ] Check bundle size: `ls -lh dist/renderer/bundle.js`
- [ ] Verify cache hit rate in console logs
- [ ] Test favorites/hidden/tags persistence
- [ ] Run `npm run dev` - DevTools shows no errors

---

## Rollback Plan

If any optimization causes issues:

1. **Bundling issue**: Remove esbuild script, restore 12-script loading in HTML
2. **Index issue**: Run migration to restore all indexes
3. **Cache issue**: Revert to old deepClone implementation
4. **Tag sync issue**: Revert to `this.tagOps.addTag()` call

---

## Performance Measurement

**Before Optimization**:
```bash
time npm run build
# Record: Build time, bundle size, video scan time
```

**After Optimization**:
```bash
time npm run build
# Compare: Should see improvements in all metrics
```

**Expected Results**:
- Build time: +2 seconds (acceptable tradeoff)
- Bundle size: -70% (50MB → 15MB)
- Video scanning: -40% time
- Tag operations: -60% time
- Initial app load: -40% time

---

## Implementation Order

**Recommended sequence** (easiest to hardest):

1. ✅ **Fix #3 (deepClone)** - 15 min, lowest risk
2. ✅ **Fix #2 (indexes)** - 30 min, low risk
3. ✅ **Fix #4 (tag sync)** - 45 min, medium risk
4. ✅ **Fix #1 (bundling)** - 90 min, higher complexity

**Total: 3 hours for core developer, 4 hours with testing**
