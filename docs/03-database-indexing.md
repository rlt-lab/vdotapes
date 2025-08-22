# Implementation Plan 3: Database Indexing and Query Optimization

**Priority:** HIGH
**Estimated Effort:** 1 day
**Dependencies:** None (can be implemented independently)

## Objective

Optimize database performance by adding proper indexes, optimizing queries, and implementing query result caching to improve application responsiveness with large video collections.

## Current Problem

- Missing indexes on frequently queried columns
- Complex JOIN queries without optimization
- No query result caching
- Sequential scanning on folder and date filters
- Database operations slow with 1000+ videos

## Solution Design

### 1. Strategic Index Creation
Add indexes to support common query patterns identified in the application.

```sql
-- Current indexes (from database.js:136-142)
CREATE INDEX IF NOT EXISTS idx_videos_folder ON videos (folder);
CREATE INDEX IF NOT EXISTS idx_videos_name ON videos (name);
CREATE INDEX IF NOT EXISTS idx_videos_last_modified ON videos (last_modified);
CREATE INDEX IF NOT EXISTS idx_videos_size ON videos (size);
CREATE INDEX IF NOT EXISTS idx_ratings_rating ON ratings (rating);

-- Additional needed indexes
CREATE INDEX IF NOT EXISTS idx_videos_path ON videos (path);
CREATE INDEX IF NOT EXISTS idx_videos_created ON videos (created);
CREATE INDEX IF NOT EXISTS idx_videos_folder_modified ON videos (folder, last_modified DESC);
CREATE INDEX IF NOT EXISTS idx_videos_size_desc ON videos (size DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_added ON favorites (added_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_updated ON videos (updated_at);
```

### 2. Query Optimization
Rewrite complex queries to use indexes effectively and reduce JOIN complexity.

```javascript
class OptimizedVideoQueries {
  constructor(db) {
    this.db = db;
    this.preparedQueries = new Map();
    this.initializePreparedStatements();
  }

  initializePreparedStatements() {
    // Optimized video listing with separate queries instead of complex JOINs
    this.preparedQueries.set('videosByFolder', this.db.prepare(`
      SELECT id, name, path, relative_path, folder, size, duration, width, height, 
             codec, bitrate, last_modified, created, added_at, updated_at
      FROM videos 
      WHERE folder = ? OR (folder IS NULL AND ? IS NULL)
      ORDER BY last_modified DESC
      LIMIT ? OFFSET ?
    `));

    // Separate query for favorites to avoid LEFT JOIN
    this.preparedQueries.set('favoriteIds', this.db.prepare(`
      SELECT video_id FROM favorites
    `));

    // Separate query for ratings
    this.preparedQueries.set('videoRatings', this.db.prepare(`
      SELECT video_id, rating FROM ratings WHERE video_id IN (${Array(100).fill('?').join(',')})
    `));

    // Optimized search query
    this.preparedQueries.set('videoSearch', this.db.prepare(`
      SELECT id, name, path, relative_path, folder, size, last_modified
      FROM videos 
      WHERE (name LIKE ? OR folder LIKE ?)
      AND (folder = ? OR ? IS NULL)
      ORDER BY 
        CASE 
          WHEN name LIKE ? THEN 1 
          WHEN folder LIKE ? THEN 2 
          ELSE 3 
        END,
        last_modified DESC
      LIMIT ?
    `));
  }
}
```

### 3. Query Result Caching
Implement intelligent caching for frequently accessed data.

```javascript
class QueryCache {
  constructor(maxSize = 100, ttl = 300000) { // 5 minutes TTL
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.accessTimes = new Map();
  }

  generateKey(query, params) {
    return `${query}:${JSON.stringify(params)}`;
  }

  get(query, params) {
    const key = this.generateKey(query, params);
    const cached = this.cache.get(key);
    
    if (!cached) return null;
    
    // Check TTL
    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(key);
      this.accessTimes.delete(key);
      return null;
    }
    
    // Update access time for LRU
    this.accessTimes.set(key, Date.now());
    return cached.data;
  }

  set(query, params, data) {
    const key = this.generateKey(query, params);
    
    // Implement LRU eviction
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }
    
    this.cache.set(key, {
      data: this.deepClone(data),
      timestamp: Date.now()
    });
    this.accessTimes.set(key, Date.now());
  }

  evictLRU() {
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, time] of this.accessTimes) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.accessTimes.delete(oldestKey);
    }
  }

  invalidate(pattern) {
    // Invalidate cache entries matching pattern
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        this.accessTimes.delete(key);
      }
    }
  }

  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
}
```

## Implementation Steps

### Phase 1: Index Creation and Migration (2-3 hours)

1. **Create database migration system**
```javascript
class DatabaseMigration {
  constructor(db) {
    this.db = db;
    this.currentVersion = this.getCurrentVersion();
  }

  getCurrentVersion() {
    try {
      const result = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('schema_version');
      return result ? parseInt(result.value) : 0;
    } catch (error) {
      return 0;
    }
  }

  async runMigrations() {
    const migrations = [
      this.migration001_addIndexes,
      this.migration002_optimizeSchema,
      this.migration003_addPerformanceIndexes
    ];

    for (let i = this.currentVersion; i < migrations.length; i++) {
      console.log(`Running migration ${i + 1}...`);
      await migrations[i].call(this);
      this.setSchemaVersion(i + 1);
    }
  }

  migration001_addIndexes() {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_videos_path ON videos (path)',
      'CREATE INDEX IF NOT EXISTS idx_videos_created ON videos (created)',
      'CREATE INDEX IF NOT EXISTS idx_videos_folder_modified ON videos (folder, last_modified DESC)',
      'CREATE INDEX IF NOT EXISTS idx_videos_size_desc ON videos (size DESC)',
      'CREATE INDEX IF NOT EXISTS idx_favorites_added ON favorites (added_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_videos_updated ON videos (updated_at)'
    ];

    indexes.forEach(sql => this.db.exec(sql));
  }

  setSchemaVersion(version) {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('schema_version', version.toString());
  }
}
```

2. **Add performance monitoring**
```javascript
class QueryPerformanceMonitor {
  constructor() {
    this.queryStats = new Map();
    this.slowQueryThreshold = 100; // ms
  }

  wrapQuery(queryName, queryFn) {
    return (...args) => {
      const start = performance.now();
      const result = queryFn.apply(this, args);
      const duration = performance.now() - start;
      
      this.recordQuery(queryName, duration);
      
      if (duration > this.slowQueryThreshold) {
        console.warn(`Slow query detected: ${queryName} took ${duration.toFixed(2)}ms`);
      }
      
      return result;
    };
  }

  recordQuery(queryName, duration) {
    const stats = this.queryStats.get(queryName) || { count: 0, totalTime: 0, avgTime: 0 };
    stats.count++;
    stats.totalTime += duration;
    stats.avgTime = stats.totalTime / stats.count;
    this.queryStats.set(queryName, stats);
  }

  getSlowQueries() {
    return Array.from(this.queryStats.entries())
      .filter(([_, stats]) => stats.avgTime > this.slowQueryThreshold)
      .sort((a, b) => b[1].avgTime - a[1].avgTime);
  }
}
```

### Phase 2: Query Optimization (3-4 hours)

1. **Implement optimized video queries**
```javascript
// In database.js - replace getVideos method
async getVideosOptimized(filters = {}) {
  const cacheKey = 'getVideos';
  const cached = this.queryCache.get(cacheKey, filters);
  if (cached) return cached;

  const result = await this.performanceMonitor.wrapQuery('getVideos', () => {
    return this.getVideosQuery(filters);
  })();

  this.queryCache.set(cacheKey, filters, result);
  return result;
}

getVideosQuery(filters) {
  let baseQuery;
  const params = [];

  // Choose optimal query based on filters
  if (filters.favoritesOnly) {
    baseQuery = this.getFavoritesOnlyQuery(filters, params);
  } else if (filters.search) {
    baseQuery = this.getSearchQuery(filters, params);
  } else {
    baseQuery = this.getStandardQuery(filters, params);
  }

  const stmt = this.db.prepare(baseQuery);
  const videos = stmt.all(...params);

  // Add favorites and ratings in separate queries if needed
  return this.enrichVideosWithMetadata(videos, filters);
}

enrichVideosWithMetadata(videos, filters) {
  if (videos.length === 0) return [];

  // Get favorites in batch
  const favoriteIds = new Set(
    this.preparedQueries.get('favoriteIds').all().map(row => row.video_id)
  );

  // Get ratings in batch
  const videoIds = videos.map(v => v.id);
  const ratings = new Map();
  
  // Process in chunks of 100 to avoid SQL parameter limits
  for (let i = 0; i < videoIds.length; i += 100) {
    const chunk = videoIds.slice(i, i + 100);
    const placeholders = chunk.map(() => '?').join(',');
    const ratingQuery = `SELECT video_id, rating FROM ratings WHERE video_id IN (${placeholders})`;
    const stmt = this.db.prepare(ratingQuery);
    const chunkRatings = stmt.all(...chunk);
    chunkRatings.forEach(r => ratings.set(r.video_id, r.rating));
  }

  // Enrich videos with metadata
  return videos.map(video => ({
    ...video,
    lastModified: video.last_modified,
    isFavorite: favoriteIds.has(video.id),
    rating: ratings.get(video.id) || null
  }));
}
```

2. **Implement specialized queries**
```javascript
getFavoritesOnlyQuery(filters, params) {
  let query = `
    SELECT v.* FROM videos v
    INNER JOIN favorites f ON v.id = f.video_id
    WHERE 1=1
  `;

  if (filters.folder) {
    query += ' AND v.folder = ?';
    params.push(filters.folder);
  }

  if (filters.search) {
    query += ' AND (v.name LIKE ? OR v.folder LIKE ?)';
    const searchTerm = `%${filters.search}%`;
    params.push(searchTerm, searchTerm);
  }

  // Add optimal sorting
  query += this.getSortClause(filters.sortBy, filters.sortOrder);
  
  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
    if (filters.offset) {
      query += ' OFFSET ?';
      params.push(filters.offset);
    }
  }

  return query;
}

getSortClause(sortBy, sortOrder = 'ASC') {
  switch (sortBy) {
    case 'date':
      return ' ORDER BY v.last_modified DESC';
    case 'name':
      return ` ORDER BY v.name ${sortOrder}`;
    case 'size':
      return ` ORDER BY v.size ${sortOrder}`;
    case 'folder':
    default:
      return ' ORDER BY v.folder ASC, v.last_modified DESC';
  }
}
```

### Phase 3: Caching Integration (2-3 hours)

1. **Integrate caching with database operations**
```javascript
// Update VideoDatabase class
class VideoDatabase {
  constructor() {
    // ... existing code ...
    this.queryCache = new QueryCache(50, 300000); // 50 entries, 5 min TTL
    this.performanceMonitor = new QueryPerformanceMonitor();
  }

  // Cache invalidation on data changes
  addVideo(video) {
    const result = super.addVideo(video);
    if (result) {
      this.queryCache.invalidate('getVideos');
      this.queryCache.invalidate('getFolders');
    }
    return result;
  }

  toggleFavorite(videoId) {
    const result = super.toggleFavorite(videoId);
    if (result) {
      this.queryCache.invalidate('getVideos');
      this.queryCache.invalidate('favorites');
    }
    return result;
  }

  saveRating(videoId, rating) {
    const result = super.saveRating(videoId, rating);
    if (result) {
      this.queryCache.invalidate('getVideos');
    }
    return result;
  }
}
```

2. **Add cache warming strategies**
```javascript
class CacheWarmer {
  constructor(database) {
    this.database = database;
  }

  async warmCommonQueries() {
    // Pre-load frequently accessed data
    const commonFilters = [
      {}, // All videos
      { sortBy: 'date' }, // Recent videos
      { favoritesOnly: true }, // Favorites
    ];

    const folders = await this.database.getFolders();
    folders.slice(0, 5).forEach(folder => {
      commonFilters.push({ folder }); // Top folders
    });

    // Warm cache in background
    for (const filters of commonFilters) {
      setTimeout(() => {
        this.database.getVideos(filters).catch(() => {
          // Ignore errors during cache warming
        });
      }, Math.random() * 1000);
    }
  }
}
```

## Files to Modify

1. **src/database.js**
   - Add migration system
   - Implement optimized queries
   - Integrate caching and performance monitoring

2. **Create new file: src/query-cache.js**
   - QueryCache class
   - CacheWarmer class

3. **Create new file: src/performance-monitor.js**
   - QueryPerformanceMonitor class
   - Database performance metrics

## Success Criteria

- **Query Performance:** 90% of queries complete under 50ms
- **Large Collections:** Smooth performance with 5000+ videos
- **Cache Hit Rate:** 60%+ cache hit rate for common operations
- **Memory Usage:** Cache uses <10MB memory

## Testing Plan

1. **Performance Benchmarking**
   - Test with 100, 1000, 5000+ video collections
   - Measure query execution times before/after
   - Test common filter/sort combinations

2. **Cache Effectiveness**
   - Monitor cache hit rates
   - Test cache invalidation correctness
   - Verify memory usage stays bounded

3. **Migration Testing**
   - Test database migration on existing databases
   - Verify all indexes are created correctly
   - Check for any breaking changes

## Performance Metrics

```javascript
class DatabaseMetrics {
  logPerformanceReport() {
    const report = {
      queryStats: this.performanceMonitor.queryStats,
      cacheStats: {
        size: this.queryCache.cache.size,
        hitRate: this.queryCache.hitRate || 0
      },
      slowQueries: this.performanceMonitor.getSlowQueries()
    };
    
    console.log('Database Performance Report:', report);
    return report;
  }
}
```

## Rollback Plan

- Feature flag to enable/disable optimized queries
- Keep original query methods as fallback
- Database migration version tracking for safe rollback

## Next Steps

After completion, this enables:
- **Plan 4:** Video metadata extraction (faster database operations)
- **Plan 5:** Cancellable operations (database won't be bottleneck)
- Advanced features like search, filtering, and sorting at scale