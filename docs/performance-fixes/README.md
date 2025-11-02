# Performance Optimization Quick Wins

This directory contains implementation guides for 5 high-impact, low-effort performance optimizations for VDOTapes.

## Overview

These fixes address critical performance issues identified in the comprehensive performance audit. Implementing all 5 will result in:

- **60-80% faster startup** for large libraries (1000+ videos)
- **70% faster builds** (29s → 6-8s for incremental builds)
- **15-20% smaller bundle** size
- **80% faster folder switching**
- **Smoother UI** with fewer IPC calls

## Fixes

### 1. Fix N+1 Tag Query Problem ⭐⭐⭐⭐⭐
**File:** [01-fix-n1-tag-query.md](./01-fix-n1-tag-query.md)

- **Impact:** CRITICAL - 5-15 second startup improvement
- **Effort:** 30 minutes
- **Issue:** Loading tags one video at a time (1000+ IPC calls)
- **Solution:** Batch load all tags in single query

**Quick Summary:**
```javascript
// Before: 1000+ queries
for (const video of videos) {
  const tags = await listTags(video.id);
}

// After: 1 query
const allTags = await getAllVideoTags();
```

### 2. Enable TypeScript Incremental Builds ⭐⭐⭐⭐
**File:** [02-incremental-typescript-builds.md](./02-incremental-typescript-builds.md)

- **Impact:** HIGH - 70% faster rebuilds
- **Effort:** 5 minutes
- **Issue:** Full recompilation on every build
- **Solution:** Enable TypeScript incremental mode

**Quick Summary:**
```json
// Add to tsconfig.json
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": ".tsbuildinfo/main.tsbuildinfo"
  }
}
```

### 3. Remove Dev Dependencies from Production ⭐⭐⭐
**File:** [03-remove-dev-dependencies.md](./03-remove-dev-dependencies.md)

- **Impact:** HIGH - 50MB smaller bundle
- **Effort:** 2 minutes
- **Issue:** @playwright/test (50MB) shipped in production
- **Solution:** Move to devDependencies

**Quick Summary:**
```json
// package.json - Move @playwright/test
"devDependencies": {
  "@playwright/test": "^1.55.0"  // Not in dependencies!
}
```

### 4. Batch Metadata Sync with Transactions ⭐⭐⭐⭐
**File:** [04-batch-metadata-sync.md](./04-batch-metadata-sync.md)

- **Impact:** HIGH - 80% faster folder switching
- **Effort:** 15 minutes
- **Issue:** Sequential database operations (1000+ writes)
- **Solution:** Wrap in single transaction with prepared statements

**Quick Summary:**
```typescript
// Before: Sequential
for (const video of videos) {
  db.addFavorite(video.id);
  db.addRating(video.id, rating);
}

// After: Transaction
db.transaction(() => {
  for (const video of videos) {
    stmt.run(video.id);
  }
})();
```

### 5. Debounce Settings Saves ⭐⭐⭐
**File:** [05-debounce-settings-saves.md](./05-debounce-settings-saves.md)

- **Impact:** MEDIUM - Smoother UI, 90% fewer saves
- **Effort:** 30 minutes
- **Issue:** Saving on every UI interaction (10+ saves per second)
- **Solution:** Debounce saves (wait 1s after last change)

**Quick Summary:**
```javascript
// Before: Immediate save
onChange() { await saveSettings(); }

// After: Debounced save
onChange() { debouncedSave(); }  // Waits 1s
```

## Implementation Order

### Recommended Sequence

1. **Fix 3: Remove Dev Dependencies (2 min)** ✅ Easiest, immediate benefit
2. **Fix 2: Incremental Builds (5 min)** ✅ Improves development workflow
3. **Fix 1: N+1 Tag Query (30 min)** ✅ Biggest user-facing impact
4. **Fix 4: Batch Metadata Sync (15 min)** ✅ Complements Fix 1
5. **Fix 5: Debounce Saves (30 min)** ✅ Polish, smoother UX

**Total time:** ~1.5 hours for all 5 fixes

### Quick Start (20 minutes)

If you only have 20 minutes, do these 3:

1. **Fix 3:** Remove dev dependencies (2 min)
2. **Fix 2:** Incremental builds (5 min)
3. **Fix 5:** Debounce saves (30 min, but implement basic version in 10 min)

This gives you:
- 50MB smaller bundle
- 70% faster builds
- Smoother UI

Then come back later for the critical database optimizations (Fixes 1 & 4).

## Testing Strategy

### After Each Fix

1. **Build:**
   ```bash
   npm run build:ts
   npm run dev
   ```

2. **Test basic functionality:**
   - Scan folder
   - Add favorites
   - Add/remove tags
   - Filter videos
   - Expand video
   - Check console for errors

3. **Performance check:**
   - Open DevTools Performance tab
   - Record during operation
   - Compare before/after times

### After All Fixes

1. **Full regression test:**
   - Test all features
   - Test with small library (10 videos)
   - Test with medium library (500 videos)
   - Test with large library (1000+ videos)

2. **Performance benchmarks:**
   ```javascript
   // In DevTools console
   console.time('Folder scan');
   // Scan folder
   console.timeEnd('Folder scan');
   ```

3. **Production build test:**
   ```bash
   npm run build:mac
   # Install and test built app
   ```

## Expected Results

### Before All Fixes

- Startup (1000 videos): 15-20 seconds
- Build time (incremental): 29 seconds
- Bundle size: ~150MB
- Folder switch: 10-15 seconds
- Settings saves: 10+ per interaction

### After All Fixes

- Startup (1000 videos): 3-5 seconds ⚡ **75% faster**
- Build time (incremental): 6-8 seconds ⚡ **73% faster**
- Bundle size: ~100MB ⚡ **33% smaller**
- Folder switch: 2-3 seconds ⚡ **80% faster**
- Settings saves: 1 per interaction ⚡ **90% reduction**

## Measuring Impact

### Startup Time

```javascript
// Add to app/renderer.js
const appStartTime = performance.now();

// After all initialization
const startupTime = performance.now() - appStartTime;
console.log(`App ready in ${startupTime.toFixed(0)}ms`);
```

### Build Time

```bash
# Before
time npm run build:ts
# 29.2 seconds

# After
time npm run build:ts
# 6-8 seconds (first incremental build)
```

### Bundle Size

```bash
# Before
du -sh dist/packages/mac-arm64/VDOTapes.app
# ~150M

# After
du -sh dist/packages/mac-arm64/VDOTapes.app
# ~100M
```

### Database Performance

```javascript
// Check performance monitor
const report = await window.electronAPI.getPerformanceReport();
console.log('Avg query time:', report.summary.avgQueryTime);
```

## Troubleshooting

### Build Errors After Changes

```bash
# Clean build
rm -rf dist/main .tsbuildinfo node_modules
npm install
npm run build:ts
```

### Database Locked Errors

```bash
# Close all app instances
pkill -f electron

# Remove WAL files
rm ~/.config/vdotapes/videos.db-wal
rm ~/.config/vdotapes/videos.db-shm
```

### Settings Not Saving

```javascript
// Force immediate save
await window.app.userDataManager.saveSettingsImmediate();
```

## Rollback Plan

Each fix document includes a rollback section. General steps:

1. **Revert code changes** using git:
   ```bash
   git checkout -- <file>
   ```

2. **Rebuild:**
   ```bash
   npm run build:ts
   ```

3. **Test:**
   ```bash
   npm run dev
   ```

## Further Optimizations

After completing these 5 fixes, consider:

1. **Reduce database indexes** (2 hours, medium impact)
2. **Add bundler (webpack/esbuild)** (8 hours, high impact)
3. **Virtual scrolling** (12 hours, high impact for 10k+ videos)
4. **Thumbnail sprite sheets** (4 hours, medium impact)
5. **Parallel native module builds** (2 hours, medium impact)

See the full [Performance Audit Report](../performance-audit-report.md) for details.

## Support

If you encounter issues:

1. Check the specific fix document for troubleshooting
2. Review the full performance audit report
3. Check console for errors
4. Use rollback plan if needed

## Contributing

When adding new features:

1. **Always use transactions** for bulk database operations
2. **Always debounce** user input that triggers saves
3. **Always batch** IPC calls when possible
4. **Test with large datasets** (1000+ videos)
5. **Monitor performance** using built-in tools

---

**Total Expected Improvement:**

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Startup (1000 videos) | 15-20s | 3-5s | **75% faster** |
| Build (incremental) | 29s | 6-8s | **73% faster** |
| Bundle size | 150MB | 100MB | **33% smaller** |
| Folder switch | 10-15s | 2-3s | **80% faster** |
| Settings saves | 10+/sec | 1/sec | **90% fewer** |

🚀 **Implementation time: ~1.5 hours for 5x improvement!**
