import type {
  VideoId,
  Rating,
  FilePath,
  VideoRecord,
  VideoFilters,
  Timestamp,
} from '../../../types/core';
import type {
  VideoTableRow,
  EnhancedVideoRow,
  VideoInsertParams,
  VideoUpdateParams,
  SqliteValue,
} from '../../../types/database';
import type { DatabaseCore } from '../core/DatabaseCore';
import type { TransactionManager } from '../core/TransactionManager';

export interface VideoOperationsCache {
  get(key: string, params?: unknown): unknown;
  set(key: string, params: unknown, value: unknown): void;
  invalidate(key: string): void;
}

export interface VideoOperationsMonitor {
  wrapQuery<T>(name: string, fn: () => T): () => T;
}

export class VideoOperations {
  private core: DatabaseCore;
  private transactionManager: TransactionManager;
  private cache: VideoOperationsCache;
  private monitor: VideoOperationsMonitor;

  constructor(
    core: DatabaseCore,
    transactionManager: TransactionManager,
    cache: VideoOperationsCache,
    monitor: VideoOperationsMonitor
  ) {
    this.core = core;
    this.transactionManager = transactionManager;
    this.cache = cache;
    this.monitor = monitor;
  }

  /**
   * Get video by ID
   */
  getVideoById(id: VideoId): VideoTableRow | null {
    if (!this.core.isInitialized()) {
      return null;
    }

    const monitoredQuery = this.monitor.wrapQuery('getVideoById', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`SELECT * FROM videos WHERE id = ?`);
        const video = stmt.get(id) as VideoTableRow | undefined;
        return video || null;
      } catch (error) {
        console.error('Error getting video by ID:', error);
        return null;
      }
    });

    return monitoredQuery();
  }

  /**
   * Get all videos with optional filters
   */
  getAllVideos(filters?: VideoFilters): readonly VideoTableRow[] {
    return this.getVideos(filters || {}).map((video) => ({
      id: video.id as VideoId,
      name: video.name,
      path: video.path as FilePath,
      folder: video.folder || null,
      size: video.size,
      last_modified: video.lastModified as Timestamp,
      created: video.created as Timestamp,
      added_at: video.addedAt,
      updated_at: video.updatedAt,
      duration: video.duration || null,
    }));
  }

  /**
   * Insert new video
   */
  insertVideo(video: VideoInsertParams): boolean {
    return this.addVideo({
      id: video.id,
      name: video.name,
      path: video.path,
      relativePath: undefined,
      folder: video.folder || undefined,
      size: video.size,
      lastModified: video.last_modified,
      created: video.created,
    });
  }

  /**
   * Update existing video
   */
  updateVideo(params: VideoUpdateParams): boolean {
    if (!this.core.isInitialized()) {
      return false;
    }

    const monitoredQuery = this.monitor.wrapQuery('updateVideo', () => {
      try {
        const db = this.core.getConnection();
        const updateStmt = db.prepare(`
          UPDATE videos SET 
            name = COALESCE(?, name),
            folder = COALESCE(?, folder),
            size = COALESCE(?, size),
            last_modified = COALESCE(?, last_modified),
            updated_at = COALESCE(?, updated_at),
            duration = COALESCE(?, duration)
          WHERE id = ?
        `);

        updateStmt.run(
          params.name || null,
          params.folder || null,
          params.size || null,
          params.last_modified || null,
          params.updated_at || null,
          params.duration || null,
          params.id
        );

        this.cache.invalidate('getVideos');
        return true;
      } catch (error) {
        console.error('Error updating video:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Delete video
   */
  deleteVideo(id: VideoId): boolean {
    if (!this.core.isInitialized()) {
      return false;
    }

    const monitoredQuery = this.monitor.wrapQuery('deleteVideo', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare('DELETE FROM videos WHERE id = ?');
        stmt.run(id);

        this.cache.invalidate('getVideos');
        return true;
      } catch (error) {
        console.error('Error deleting video:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Get videos with metadata (favorites, ratings, tags)
   */
  getVideosWithMetadata(filters?: VideoFilters): readonly EnhancedVideoRow[] {
    if (!this.core.isInitialized()) {
      return [];
    }

    const monitoredQuery = this.monitor.wrapQuery('getVideosWithMetadata', () => {
      try {
        const db = this.core.getConnection();
        let query = `
          SELECT v.*, 
                 CASE WHEN f.video_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
                 CASE WHEN h.video_id IS NOT NULL THEN 1 ELSE 0 END as is_hidden,
                 r.rating,
                 GROUP_CONCAT(t.name, ',') as tag_names
          FROM videos v
          LEFT JOIN favorites f ON v.id = f.video_id
          LEFT JOIN hidden_files h ON v.id = h.video_id
          LEFT JOIN ratings r ON v.id = r.video_id
          LEFT JOIN video_tags vt ON v.id = vt.video_id
          LEFT JOIN tags t ON vt.tag_id = t.id
          WHERE 1=1
        `;

        const params: SqliteValue[] = [];

        // Apply filters
        if (filters?.folder) {
          query += ' AND v.folder = ?';
          params.push(filters.folder);
        }

        if (filters?.favoritesOnly) {
          query += ' AND f.video_id IS NOT NULL';
        }

        if (filters?.hiddenOnly) {
          query += ' AND h.video_id IS NOT NULL';
        }

        query += ' GROUP BY v.id';

        // Apply sorting
        const sortField = filters?.sortBy || 'folder';
        let orderBy = '';
        switch (sortField) {
          case 'name':
            orderBy = 'v.name';
            break;
          case 'date':
            orderBy = 'v.last_modified DESC';
            break;
          case 'size':
            orderBy = 'v.size';
            break;
          case 'folder':
          default:
            orderBy = 'v.folder, v.last_modified DESC';
            break;
        }

        if (orderBy) {
          query += ` ORDER BY ${orderBy}`;
        }

        const stmt = db.prepare(query);
        const videos = stmt.all(...params) as EnhancedVideoRow[];

        return videos;
      } catch (error) {
        console.error('Error getting videos with metadata:', error);
        return [];
      }
    });

    return monitoredQuery();
  }

  /**
   * Add or update video in database
   */
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
    if (!this.core.isInitialized()) {
      return false;
    }

    const monitoredQuery = this.monitor.wrapQuery('addVideo', () => {
      try {
        const db = this.core.getConnection();

        // Check if video with this ID already exists
        const existingStmt = db.prepare(`SELECT path FROM videos WHERE id = ?`);
        const existing = existingStmt.get(video.id);

        if (existing) {
          // Video exists, update path and other info if needed
          const updateStmt = db.prepare(`
            UPDATE videos SET 
              path = ?, 
              relative_path = ?, 
              folder = ?, 
              size = ?, 
              last_modified = ?, 
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `);

          updateStmt.run(
            video.path,
            video.relativePath,
            video.folder,
            video.size,
            video.lastModified,
            video.id
          );
        } else {
          // New video, insert it
          const insertStmt = db.prepare(`
            INSERT INTO videos (
              id, name, path, relative_path, folder, size, duration, width, height, 
              codec, bitrate, last_modified, created, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `);

          insertStmt.run(
            video.id,
            video.name,
            video.path,
            video.relativePath,
            video.folder,
            video.size,
            video.duration || null,
            video.width || null,
            video.height || null,
            video.codec || null,
            video.bitrate || null,
            video.lastModified,
            video.created
          );
        }

        // Invalidate cache
        this.cache.invalidate('getVideos');
        this.cache.invalidate('getFolders');

        return true;
      } catch (error) {
        console.error('Error adding video to database:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Add multiple videos to database and clean up old entries
   */
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
    if (!this.core.isInitialized()) {
      return false;
    }

    const result = this.transactionManager.execute((ctx) => {
      // Get current video IDs
      const currentIds = new Set(videos.map((v) => v.id));

      // Add or update videos
      for (const video of videos) {
        this.addVideo(video);
      }

      // Clean up videos that are no longer in the current folder
      // but keep favorites and ratings for videos that might be in other folders
      const cleanupStmt = ctx.db.prepare(`
        DELETE FROM videos 
        WHERE id NOT IN (${Array.from(currentIds)
          .map(() => '?')
          .join(',')})
        AND id NOT IN (
          SELECT DISTINCT video_id FROM favorites 
          UNION 
          SELECT DISTINCT video_id FROM ratings 
          WHERE video_id IS NOT NULL
        )
      `);

      if (currentIds.size > 0) {
        cleanupStmt.run(...Array.from(currentIds));
      }

      return true;
    });

    if (result.success) {
      // Invalidate cache
      this.cache.invalidate('getVideos');
      this.cache.invalidate('getFolders');
      return true;
    } else {
      console.error('Error adding videos to database:', result.error);
      return false;
    }
  }

  /**
   * Get videos with filters (main query method)
   */
  getVideos(filters: VideoFilters = {}): VideoRecord[] {
    if (!this.core.isInitialized()) {
      return [];
    }

    // Check cache first
    const cacheKey = 'getVideos';
    const cached = this.cache.get(cacheKey, filters);
    if (cached) {
      return cached as VideoRecord[];
    }

    // Wrap with performance monitoring
    const monitoredQuery = this.monitor.wrapQuery('getVideos', () => {
      return this.getVideosQuery(filters);
    });

    try {
      const result = monitoredQuery();

      // Cache the result
      this.cache.set(cacheKey, filters, result);

      return result;
    } catch (error) {
      console.error('Error getting videos:', error);
      return [];
    }
  }

  private getVideosQuery(filters: VideoFilters = {}): VideoRecord[] {
    const db = this.core.getConnection();

    try {
      let query = `
        SELECT v.*, 
               CASE WHEN f.video_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
               r.rating
        FROM videos v
        LEFT JOIN favorites f ON v.id = f.video_id
        LEFT JOIN ratings r ON v.id = r.video_id
        WHERE 1=1
      `;

      const params: SqliteValue[] = [];

      // Apply filters
      if (filters.folder) {
        query += ' AND v.folder = ?';
        params.push(filters.folder);
      }

      if (filters.favoritesOnly) {
        query += ' AND f.video_id IS NOT NULL';
      }

      if (filters.ratingMin) {
        query += ' AND r.rating >= ?';
        params.push(filters.ratingMin);
      }

      if (filters.search) {
        query += ' AND (v.name LIKE ? OR v.folder LIKE ?)';
        const searchTerm = `%${filters.search}%`;
        params.push(searchTerm, searchTerm);
      }

      // Apply sorting
      const sortField = filters.sortBy || 'folder';

      let orderBy = '';
      switch (sortField) {
        case 'none':
          // No sorting - return in natural order
          break;
        case 'name':
          orderBy = 'v.name';
          break;
        case 'date':
          orderBy = 'v.last_modified DESC';
          break;
        case 'size':
          orderBy = 'v.size';
          break;
        case 'rating':
          orderBy = 'r.rating DESC, v.name';
          break;
        case 'folder':
        default:
          orderBy = 'v.folder, v.last_modified DESC';
          break;
      }

      if (orderBy) {
        query += ` ORDER BY ${orderBy}`;
      }

      // Apply pagination
      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);

        if (filters.offset) {
          query += ' OFFSET ?';
          params.push(filters.offset);
        }
      }

      const stmt = db.prepare(query);
      const videos = stmt.all(...params) as Array<{
        id: string;
        name: string;
        path: string;
        folder?: string;
        size?: number;
        last_modified?: number;
        created?: number;
        added_at?: string;
        updated_at?: string;
        duration?: number;
        is_favorite?: number;
        rating?: number;
        [key: string]: unknown;
      }>;

      return videos.map((video) => ({
        ...video,
        id: video.id as VideoId,
        path: video.path as FilePath,
        folder: video.folder || '',
        size: video.size || 0,
        lastModified: video.last_modified as Timestamp,
        created: video.created as Timestamp,
        addedAt: video.added_at || '',
        updatedAt: video.updated_at || '',
        duration: video.duration || undefined,
        isFavorite: Boolean(video.is_favorite),
        rating: video.rating as Rating || undefined,
      }));
    } catch (error) {
      console.error('Error getting videos from database:', error);
      return [];
    }
  }

  /**
   * Get all folders
   */
  getFolders(): string[] {
    if (!this.core.isInitialized()) {
      return [];
    }

    const monitoredQuery = this.monitor.wrapQuery('getFolders', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          SELECT DISTINCT folder 
          FROM videos 
          WHERE folder IS NOT NULL 
          ORDER BY folder
        `);

        const results = stmt.all() as { folder: string }[];
        return results.map((row) => row.folder);
      } catch (error) {
        console.error('Error getting folders:', error);
        return [];
      }
    });

    return monitoredQuery();
  }
}