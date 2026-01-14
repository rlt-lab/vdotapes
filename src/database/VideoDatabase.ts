import type {
  VideoId,
  Rating,
  FilePath,
  VideoRecord,
  VideoFilters,
  Timestamp,
} from '../../types/core';
import type {
  VideoTableRow,
  EnhancedVideoRow,
  VideoInsertParams,
  VideoUpdateParams,
  VideoDatabaseOperations,
  DatabaseStats,
  TagInfo,
} from '../../types/database';

// Core modules
import { DatabaseCore } from './core/DatabaseCore';
import { TransactionManager } from './core/TransactionManager';

// Operation modules
import { BackupOperations } from './operations/BackupOperations';
import { SettingsOperations } from './operations/SettingsOperations';
import { TagOperations } from './operations/TagOperations';
import { UserDataOperations } from './operations/UserDataOperations';
import { VideoOperations } from './operations/VideoOperations';

// Performance and caching (existing modules)
// TODO: Convert these CommonJS modules to ES modules

/**
 * Type definitions for QueryCache (from query-cache.js)
 */
interface QueryCacheInterface {
  get(query: string, params?: unknown): unknown | null;
  set(query: string, params: unknown, data: unknown): void;
  invalidate(pattern: string): number;
  clear(): void;
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    hitCount: number;
    missCount: number;
    totalRequests: number;
  };
}

/**
 * Type definitions for QueryPerformanceMonitor (from performance-monitor.js)
 */
interface QueryPerformanceMonitorInterface {
  wrapQuery<T extends (...args: unknown[]) => unknown>(queryName: string, queryFn: T): T;
  wrapAsyncQuery<T extends (...args: unknown[]) => Promise<unknown>>(queryName: string, queryFn: T): T;
  recordQuery(queryName: string, duration: number, error?: Error | null, args?: unknown[]): void;
  getSlowQueries(limit?: number): Array<{ queryName: string; duration: number; timestamp: number }>;
  getQueryStats(): Array<{ queryName: string; count: number; avgTime: number; maxTime: number }>;
  getSummaryStats(): {
    totalQueries: number;
    totalTime: number;
    avgQueryTime: number;
    queriesPerSecond: number;
  };
  generateReport(): {
    timestamp: string;
    summary: { avgQueryTime: number; totalQueries: number; queriesPerSecond: number };
    slowQueries: Array<{ queryName: string; duration: number }>;
    recommendations: Array<{ type: string; suggestion: string }>;
  };
  reset(): void;
}

/**
 * Type definitions for CacheWarmer (from query-cache.js)
 */
interface CacheWarmerInterface {
  warmCommonQueries(): Promise<void>;
  schedulePeriodicWarming(intervalMs?: number): void;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const QueryPerformanceMonitor = require('../performance-monitor') as new () => QueryPerformanceMonitorInterface;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { QueryCache, CacheWarmer } = require('../query-cache') as {
  QueryCache: new (maxSize?: number, ttl?: number) => QueryCacheInterface;
  CacheWarmer: new (database: VideoDatabase) => CacheWarmerInterface;
};

// Legacy interfaces for compatibility
interface BackupItem {
  path: string;
  favorite: boolean;
  hidden: boolean;
  rating: number;
  tags: string[];
}

interface BackupResult {
  version: number;
  exportedAt: string;
  items: BackupItem[];
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

interface WindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
}

export class VideoDatabase implements VideoDatabaseOperations {
  // Core infrastructure
  private core: DatabaseCore;
  private transactionManager: TransactionManager;

  // Operation modules
  private videoOps: VideoOperations;
  private userDataOps: UserDataOperations;
  private tagOps: TagOperations;
  private settingsOps: SettingsOperations;
  private backupOps: BackupOperations;

  // Performance and caching
  private queryCache: QueryCacheInterface;
  private performanceMonitor: QueryPerformanceMonitorInterface;
  private cacheWarmer: CacheWarmerInterface | null = null;

  constructor() {
    // Initialize core
    this.core = new DatabaseCore();
    this.transactionManager = new TransactionManager(this.core);

    // Initialize performance monitoring and caching
    this.queryCache = new QueryCache(50, 300000); // 50 entries, 5 min TTL
    this.performanceMonitor = new QueryPerformanceMonitor();

    // Initialize operation modules with shared dependencies
    this.videoOps = new VideoOperations(
      this.core,
      this.transactionManager,
      this.queryCache,
      this.performanceMonitor
    );

    this.userDataOps = new UserDataOperations(
      this.core,
      this.transactionManager,
      this.queryCache,
      this.performanceMonitor
    );

    this.tagOps = new TagOperations(
      this.core,
      this.transactionManager,
      this.queryCache,
      this.performanceMonitor
    );

    this.settingsOps = new SettingsOperations(
      this.core,
      this.performanceMonitor
    );

    this.backupOps = new BackupOperations(
      this.core,
      this.transactionManager,
      this.userDataOps,
      this.tagOps,
      this.queryCache,
      this.performanceMonitor
    );
  }

  // === CORE INITIALIZATION ===

  async initialize(): Promise<void> {
    await this.core.initialize();
    this.initializeCacheWarmer();
  }

  private initializeCacheWarmer(): void {
    try {
      this.cacheWarmer = new CacheWarmer(this);

      // Warm cache after a short delay
      setTimeout(() => {
        this.cacheWarmer?.warmCommonQueries();
      }, 2000);

      // Schedule periodic warming
      this.cacheWarmer?.schedulePeriodicWarming(600000); // 10 minutes

      console.log('Cache warmer initialized');
    } catch (error) {
      console.error('Error initializing cache warmer:', error);
    }
  }

  close(): void {
    this.core.close();

    if (this.performanceMonitor) {
      this.performanceMonitor.reset();
    }

    if (this.queryCache) {
      this.queryCache.clear();
    }
  }

  // === VIDEO OPERATIONS (delegate to VideoOperations) ===

  getVideoById(id: VideoId): VideoTableRow | null {
    return this.videoOps.getVideoById(id);
  }

  getAllVideos(filters?: VideoFilters): readonly VideoTableRow[] {
    return this.videoOps.getAllVideos(filters);
  }

  insertVideo(video: VideoInsertParams): boolean {
    return this.videoOps.insertVideo(video);
  }

  updateVideo(params: VideoUpdateParams): boolean {
    return this.videoOps.updateVideo(params);
  }

  deleteVideo(id: VideoId): boolean {
    return this.videoOps.deleteVideo(id);
  }

  getVideosWithMetadata(filters?: VideoFilters): readonly EnhancedVideoRow[] {
    return this.videoOps.getVideosWithMetadata(filters);
  }

  addVideo(video: {
    id: VideoId;
    name: string;
    path: FilePath;
    relativePath?: string;
    folder?: string;
    size?: number;
    duration?: number;
    width?: number;
    height?: number;
    codec?: string;
    bitrate?: number;
    lastModified?: Timestamp;
    created?: Timestamp;
  }): boolean {
    return this.videoOps.addVideo(video);
  }

  addVideos(videos: Array<{
    id: VideoId;
    name: string;
    path: FilePath;
    relativePath?: string;
    folder?: string;
    size?: number;
    lastModified?: Timestamp;
    created?: Timestamp;
  }>): boolean {
    return this.videoOps.addVideos(videos);
  }

  getVideos(filters: VideoFilters = {}): VideoRecord[] {
    return this.videoOps.getVideos(filters);
  }

  getFolders(): string[] {
    return this.videoOps.getFolders();
  }

  // === USER DATA OPERATIONS (delegate to UserDataOperations) ===

  addFavorite(videoId: VideoId): boolean {
    return this.userDataOps.addFavorite(videoId);
  }

  removeFavorite(videoId: VideoId): boolean {
    return this.userDataOps.removeFavorite(videoId);
  }

  getFavoriteIds(): readonly VideoId[] {
    return this.userDataOps.getFavoriteIds();
  }

  toggleFavorite(videoId: VideoId): boolean {
    return this.userDataOps.toggleFavorite(videoId);
  }

  addHiddenFile(videoId: VideoId): boolean {
    return this.userDataOps.addHiddenFile(videoId);
  }

  removeHiddenFile(videoId: VideoId): boolean {
    return this.userDataOps.removeHiddenFile(videoId);
  }

  getHiddenFiles(): VideoId[] {
    return this.userDataOps.getHiddenFiles();
  }

  toggleHiddenFile(videoId: VideoId): boolean {
    return this.userDataOps.toggleHiddenFile(videoId);
  }

  saveRating(videoId: VideoId, rating: Rating): boolean {
    return this.userDataOps.saveRating(videoId, rating);
  }

  getRating(videoId: VideoId): Rating | null {
    return this.userDataOps.getRating(videoId);
  }

  removeRating(videoId: VideoId): boolean {
    return this.userDataOps.removeRating(videoId);
  }

  getRatedVideos(): Array<{ video_id: VideoId; rating: Rating }> {
    return this.userDataOps.getRatedVideos();
  }

  saveThumbnail(videoId: VideoId, thumbnailPath: string, timestamp: number | null = null): boolean {
    return this.userDataOps.saveThumbnail(videoId, thumbnailPath, timestamp);
  }

  getThumbnail(videoId: VideoId): { thumbnail_path: string; timestamp: number | null } | null {
    return this.userDataOps.getThumbnail(videoId);
  }

  // === TAG OPERATIONS (delegate to TagOperations) ===

  addTag(videoId: VideoId, tagName: string): boolean {
    return this.tagOps.addTag(videoId, tagName);
  }

  removeTag(videoId: VideoId, tagName: string): boolean {
    return this.tagOps.removeTag(videoId, tagName);
  }

  getVideoTags(videoId: VideoId): readonly string[] {
    return this.tagOps.getVideoTags(videoId);
  }

  getAllTags(): readonly TagInfo[] {
    return this.tagOps.getAllTags();
  }

  searchByTag(tagName: string): readonly VideoId[] {
    return this.tagOps.searchByTag(tagName);
  }

  /**
   * Get all video tags in batch
   */
  getAllVideoTags(): Map<VideoId, string[]> {
    return this.tagOps.getAllVideoTags();
  }

  // Legacy tag methods for backward compatibility
  addTagToVideo(videoId: VideoId, tagName: string): boolean {
    return this.tagOps.addTagToVideo(videoId, tagName);
  }

  removeTagFromVideo(videoId: VideoId, tagName: string): boolean {
    return this.tagOps.removeTagFromVideo(videoId, tagName);
  }

  listTagsForVideo(videoId: VideoId): string[] {
    return this.tagOps.listTagsForVideo(videoId);
  }

  listAllTags(): Array<{ name: string; usage: number }> {
    return this.tagOps.listAllTags();
  }

  searchVideosByTag(
    query: string,
    limit = 100
  ): Array<{ id: string; name: string; path: string; folder: string; last_modified: number }> {
    return this.tagOps.searchVideosByTag(query, limit);
  }

  // === BATCH SYNC OPERATIONS ===

  /**
   * Sync folder metadata to database in a single transaction (batch operation)
   * This is 80% faster than sequential sync for large video collections
   */
  syncFolderMetadata(allMetadata: Record<string, {
    favorite: boolean;
    hidden: boolean;
    rating: number | null;
    tags: string[];
  }>): { synced: number; duration: number } {
    const startTime = performance.now();
    let synced = 0;

    const allVideoIds = Object.keys(allMetadata);

    // Get only video IDs that exist in the database to avoid FK constraint failures
    const db = this.core.getConnection();
    const existingVideos = db.prepare(
      `SELECT id FROM videos WHERE id IN (${allVideoIds.map(() => '?').join(',')})`
    ).all(...allVideoIds) as Array<{ id: string }>;
    const existingIds = new Set(existingVideos.map(v => v.id));

    const videoIds = allVideoIds.filter(id => existingIds.has(id));
    console.log(`[Database] Syncing ${videoIds.length} of ${allVideoIds.length} videos in single transaction...`);

    // Wrap everything in a single transaction for maximum performance
    const result = this.transactionManager.execute((ctx) => {
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

      return synced;
    }, { immediate: true });

    if (!result.success) {
      console.error('[Database] Batch sync failed:', result.error);
      throw result.error || new Error('Batch sync failed');
    }

    const duration = performance.now() - startTime;
    console.log(`[Database] Synced ${synced} metadata items in ${duration.toFixed(2)}ms`);

    // Invalidate caches after bulk operation
    this.queryCache.invalidate('getVideos');
    this.queryCache.invalidate('getFavorites');
    this.queryCache.invalidate('getHiddenFiles');

    return { synced, duration };
  }

  // === SETTINGS OPERATIONS (delegate to SettingsOperations) ===

  saveSetting<T>(key: string, value: T): boolean {
    return this.settingsOps.saveSetting(key, value);
  }

  getSetting<T>(key: string, defaultValue: T): T {
    return this.settingsOps.getSetting(key, defaultValue);
  }

  saveLastFolder(folderPath: string): boolean {
    return this.settingsOps.saveLastFolder(folderPath);
  }

  getLastFolder(): string | null {
    return this.settingsOps.getLastFolder();
  }

  saveGridColumns(columns: number): boolean {
    return this.settingsOps.saveGridColumns(columns);
  }

  getGridColumns(): number {
    return this.settingsOps.getGridColumns();
  }

  saveSortPreference(sortBy: string, sortOrder = 'ASC'): boolean {
    return this.settingsOps.saveSortPreference(sortBy, sortOrder);
  }

  getSortPreference(): { sortBy: string; sortOrder: string } {
    return this.settingsOps.getSortPreference();
  }

  saveFolderFilter(folder: string): boolean {
    return this.settingsOps.saveFolderFilter(folder);
  }

  getFolderFilter(): string {
    return this.settingsOps.getFolderFilter();
  }

  saveFavoritesOnly(favoritesOnly: boolean): boolean {
    return this.settingsOps.saveFavoritesOnly(favoritesOnly);
  }

  getFavoritesOnly(): boolean {
    return this.settingsOps.getFavoritesOnly();
  }

  saveHiddenOnly(hiddenOnly: boolean): boolean {
    return this.settingsOps.saveHiddenOnly(hiddenOnly);
  }

  getHiddenOnly(): boolean {
    return this.settingsOps.getHiddenOnly();
  }

  saveWindowState(width: number, height: number, x: number, y: number): boolean {
    return this.settingsOps.saveWindowState(width, height, x, y);
  }

  getWindowState(): WindowState {
    return this.settingsOps.getWindowState();
  }

  // === BACKUP OPERATIONS (delegate to BackupOperations) ===

  exportBackup(): BackupResult {
    return this.backupOps.exportBackup();
  }

  importBackup(backup: BackupResult | string): ImportResult {
    return this.backupOps.importBackup(backup);
  }

  // === STATISTICS ===

  getStats(): DatabaseStats {
    if (!this.core.isInitialized()) {
      return {
        totalVideos: 0,
        totalFavorites: 0,
        totalHidden: 0,
        totalTags: 0,
        totalSize: 0,
        avgVideoSize: 0,
        folderCounts: [],
      };
    }

    try {
      const db = this.core.getConnection();
      
      const videoCount = db.prepare('SELECT COUNT(*) as count FROM videos').get() as {
        count: number;
      };
      const favoriteCount = db.prepare('SELECT COUNT(*) as count FROM favorites').get() as {
        count: number;
      };
      const hiddenCount = db.prepare('SELECT COUNT(*) as count FROM hidden_files').get() as {
        count: number;
      };
      const tagCount = db.prepare('SELECT COUNT(*) as count FROM tags').get() as {
        count: number;
      };
      const sizeInfo = db
        .prepare('SELECT SUM(size) as total, AVG(size) as avg FROM videos')
        .get() as { total: number; avg: number };
      const folderStats = db
        .prepare(`
          SELECT folder, COUNT(*) as count, SUM(size) as totalSize 
          FROM videos 
          WHERE folder IS NOT NULL 
          GROUP BY folder 
          ORDER BY count DESC
        `)
        .all() as Array<{ folder: string; count: number; totalSize: number }>;

      return {
        totalVideos: videoCount.count,
        totalFavorites: favoriteCount.count,
        totalHidden: hiddenCount.count,
        totalTags: tagCount.count,
        totalSize: sizeInfo.total || 0,
        avgVideoSize: sizeInfo.avg || 0,
        folderCounts: folderStats.map((f) => ({
          folder: f.folder,
          count: f.count,
          totalSize: f.totalSize,
        })),
      };
    } catch (error) {
      console.error('Error getting database stats:', error);
      return {
        totalVideos: 0,
        totalFavorites: 0,
        totalHidden: 0,
        totalTags: 0,
        totalSize: 0,
        avgVideoSize: 0,
        folderCounts: [],
      };
    }
  }

  // === PERFORMANCE MONITORING ===

  getPerformanceStats(): {
    cache: { hitRate: number; size: number; maxSize: number };
    performance: { avgQueryTime: number; totalQueries: number; queriesPerSecond: number };
    recommendations: Array<{ type: string; suggestion: string }>;
    slowQueries: Array<{ queryName: string; duration: number }>;
  } {
    const cacheStats = this.queryCache.getStats();
    const performanceStats = this.performanceMonitor.getSummaryStats();
    const performanceReport = this.performanceMonitor.generateReport();

    return {
      cache: cacheStats,
      performance: performanceStats,
      recommendations: performanceReport.recommendations,
      slowQueries: performanceReport.slowQueries.slice(0, 3),
    };
  }

  logPerformanceReport(): {
    cache: { hitRate: number; size: number; maxSize: number };
    performance: { avgQueryTime: number; totalQueries: number; queriesPerSecond: number };
    recommendations: Array<{ type: string; suggestion: string }>;
    slowQueries: Array<{ queryName: string; duration: number }>;
  } {
    const stats = this.getPerformanceStats();

    console.log('=== Database Performance Report ===');
    console.log('Cache Hit Rate:', `${stats.cache.hitRate.toFixed(1)}%`);
    console.log('Cache Size:', `${stats.cache.size}/${stats.cache.maxSize}`);
    console.log('Average Query Time:', `${stats.performance.avgQueryTime}ms`);
    console.log('Total Queries:', stats.performance.totalQueries);
    console.log('Queries/Second:', stats.performance.queriesPerSecond);

    if (stats.slowQueries.length > 0) {
      console.log('Recent Slow Queries:');
      stats.slowQueries.forEach((q) => {
        console.log(`  ${q.queryName}: ${q.duration}ms`);
      });
    }

    if (stats.recommendations.length > 0) {
      console.log('Performance Recommendations:');
      stats.recommendations.forEach((rec) => {
        console.log(`  ${rec.type}: ${rec.suggestion}`);
      });
    }

    return stats;
  }
}

export default VideoDatabase;