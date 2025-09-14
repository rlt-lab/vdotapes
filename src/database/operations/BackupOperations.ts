import type { VideoId } from '../../../types/core';
import type { DatabaseCore } from '../core/DatabaseCore';
import type { TransactionManager } from '../core/TransactionManager';

import type { TagOperations } from './TagOperations';
import type { UserDataOperations } from './UserDataOperations';

export interface BackupOperationsCache {
  invalidate(key: string): void;
}

export interface BackupOperationsMonitor {
  wrapQuery<T>(name: string, fn: () => T): () => T;
}

export interface BackupItem {
  path: string;
  favorite: boolean;
  hidden: boolean;
  rating: number;
  tags: string[];
}

export interface BackupResult {
  version: number;
  exportedAt: string;
  items: BackupItem[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

export class BackupOperations {
  private core: DatabaseCore;
  private transactionManager: TransactionManager;
  private userDataOps: UserDataOperations;
  private tagOps: TagOperations;
  private cache: BackupOperationsCache;
  private monitor: BackupOperationsMonitor;

  constructor(
    core: DatabaseCore,
    transactionManager: TransactionManager,
    userDataOps: UserDataOperations,
    tagOps: TagOperations,
    cache: BackupOperationsCache,
    monitor: BackupOperationsMonitor
  ) {
    this.core = core;
    this.transactionManager = transactionManager;
    this.userDataOps = userDataOps;
    this.tagOps = tagOps;
    this.cache = cache;
    this.monitor = monitor;
  }

  /**
   * Export current favorites, hidden, ratings, and tags keyed by path
   */
  exportBackup(): BackupResult {
    if (!this.core.isInitialized()) {
      return { 
        version: 1, 
        exportedAt: new Date().toISOString(), 
        items: [] 
      };
    }

    const monitoredQuery = this.monitor.wrapQuery('exportBackup', () => {
      try {
        const db = this.core.getConnection();

        // Get all video metadata
        const rows = db
          .prepare(`
            SELECT v.id, v.path,
                   CASE WHEN f.video_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite,
                   CASE WHEN h.video_id IS NOT NULL THEN 1 ELSE 0 END AS is_hidden,
                   r.rating
            FROM videos v
            LEFT JOIN favorites f ON f.video_id = v.id
            LEFT JOIN hidden_files h ON h.video_id = v.id
            LEFT JOIN ratings r ON r.video_id = v.id
          `)
          .all() as Array<{
          id: string;
          path: string;
          is_favorite: number;
          is_hidden: number;
          rating: number | null;
        }>;

        // Get all tags for each video
        const tagRows = db
          .prepare(`
            SELECT vt.video_id, t.name AS tag
            FROM video_tags vt
            JOIN tags t ON t.id = vt.tag_id
          `)
          .all() as Array<{ video_id: string; tag: string }>;

        // Group tags by video ID
        const tagsByVideo = new Map<string, string[]>();
        for (const tagRow of tagRows) {
          if (!tagsByVideo.has(tagRow.video_id)) {
            tagsByVideo.set(tagRow.video_id, []);
          }
          tagsByVideo.get(tagRow.video_id)!.push(tagRow.tag);
        }

        // Create backup items
        const items: BackupItem[] = rows.map((row) => ({
          path: row.path,
          favorite: Boolean(row.is_favorite),
          hidden: Boolean(row.is_hidden),
          rating: row.rating ?? 0,
          tags: tagsByVideo.get(row.id) || [],
        }));

        return {
          version: 1,
          exportedAt: new Date().toISOString(),
          items,
        };
      } catch (error) {
        console.error('Error exporting backup:', error);
        return {
          version: 1,
          exportedAt: new Date().toISOString(),
          items: [],
        };
      }
    });

    return monitoredQuery();
  }

  /**
   * Import backup JSON (object or string). Merges into DB.
   */
  importBackup(backup: BackupResult | string): ImportResult {
    if (!this.core.isInitialized()) {
      return { imported: 0, skipped: 0, errors: 0 };
    }

    const monitoredQuery = this.monitor.wrapQuery('importBackup', () => {
      try {
        const data = typeof backup === 'string' ? JSON.parse(backup) : backup;
        const items = Array.isArray(data) ? data : data?.items || [];

        const result = this.transactionManager.executeBackupTransaction((ctx) => {
          let imported = 0;
          let skipped = 0;
          let errors = 0;

          const findStmt = ctx.db.prepare('SELECT id FROM videos WHERE path = ?');
          const insFav = ctx.db.prepare('INSERT OR IGNORE INTO favorites (video_id) VALUES (?)');
          const delFav = ctx.db.prepare('DELETE FROM favorites WHERE video_id = ?');
          const insHid = ctx.db.prepare('INSERT OR IGNORE INTO hidden_files (video_id) VALUES (?)');
          const delHid = ctx.db.prepare('DELETE FROM hidden_files WHERE video_id = ?');
          const setRating = ctx.db.prepare(
            'INSERT OR REPLACE INTO ratings (video_id, rating, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
          );
          const delRating = ctx.db.prepare('DELETE FROM ratings WHERE video_id = ?');

          for (const item of items) {
            try {
              if (!item || !item.path) {
                skipped++;
                continue;
              }

              // Find video by path
              const row = findStmt.get(item.path) as { id: string } | undefined;
              if (!row) {
                skipped++;
                continue;
              }

              const videoId = row.id as VideoId;

              // Process favorites
              if (item.favorite) {
                insFav.run(videoId);
              } else {
                delFav.run(videoId);
              }

              // Process hidden files
              if (item.hidden) {
                insHid.run(videoId);
              } else {
                delHid.run(videoId);
              }

              // Process rating
              if (typeof item.rating === 'number' && item.rating >= 1 && item.rating <= 5) {
                setRating.run(videoId, item.rating);
              } else {
                delRating.run(videoId);
              }

              // Process tags
              if (Array.isArray(item.tags)) {
                for (const tagName of item.tags) {
                  if (tagName && String(tagName).trim().length > 0) {
                    this.tagOps.addTagToVideo(videoId, String(tagName));
                  }
                }
              }

              imported++;
            } catch (itemError) {
              console.error('Error importing item:', itemError);
              errors++;
            }
          }

          return { imported, skipped, errors };
        });

        if (result.success) {
          // Invalidate caches after successful import
          this.cache.invalidate('getVideos');
          return result.result!;
        } else {
          console.error('Transaction failed during backup import:', result.error);
          return { imported: 0, skipped: 0, errors: 1 };
        }
      } catch (error) {
        console.error('Error importing backup:', error);
        return { imported: 0, skipped: 0, errors: 1 };
      }
    });

    return monitoredQuery();
  }

  /**
   * Create a filtered backup (only favorites, only rated, etc.)
   */
  exportFilteredBackup(options: {
    favoritesOnly?: boolean;
    ratedOnly?: boolean;
    taggedOnly?: boolean;
    minRating?: number;
  }): BackupResult {
    if (!this.core.isInitialized()) {
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        items: [],
      };
    }

    const monitoredQuery = this.monitor.wrapQuery('exportFilteredBackup', () => {
      try {
        const db = this.core.getConnection();

        let query = `
          SELECT v.id, v.path,
                 CASE WHEN f.video_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite,
                 CASE WHEN h.video_id IS NOT NULL THEN 1 ELSE 0 END AS is_hidden,
                 r.rating
          FROM videos v
          LEFT JOIN favorites f ON f.video_id = v.id
          LEFT JOIN hidden_files h ON h.video_id = v.id
          LEFT JOIN ratings r ON r.video_id = v.id
        `;

        const conditions: string[] = [];
        const params: any[] = [];

        if (options.favoritesOnly) {
          conditions.push('f.video_id IS NOT NULL');
        }

        if (options.ratedOnly) {
          conditions.push('r.rating IS NOT NULL');
        }

        if (options.minRating) {
          conditions.push('r.rating >= ?');
          params.push(options.minRating);
        }

        if (options.taggedOnly) {
          conditions.push(`
            v.id IN (
              SELECT DISTINCT video_id FROM video_tags
            )
          `);
        }

        if (conditions.length > 0) {
          query += ' WHERE ' + conditions.join(' AND ');
        }

        const rows = db.prepare(query).all(...params) as Array<{
          id: string;
          path: string;
          is_favorite: number;
          is_hidden: number;
          rating: number | null;
        }>;

        // Get tags for filtered videos
        const videoIds = rows.map(row => row.id);
        const tagsByVideo = new Map<string, string[]>();

        if (videoIds.length > 0) {
          const tagQuery = `
            SELECT vt.video_id, t.name AS tag
            FROM video_tags vt
            JOIN tags t ON t.id = vt.tag_id
            WHERE vt.video_id IN (${videoIds.map(() => '?').join(',')})
          `;
          
          const tagRows = db.prepare(tagQuery).all(...videoIds) as Array<{
            video_id: string;
            tag: string;
          }>;

          for (const tagRow of tagRows) {
            if (!tagsByVideo.has(tagRow.video_id)) {
              tagsByVideo.set(tagRow.video_id, []);
            }
            tagsByVideo.get(tagRow.video_id)!.push(tagRow.tag);
          }
        }

        const items: BackupItem[] = rows.map((row) => ({
          path: row.path,
          favorite: Boolean(row.is_favorite),
          hidden: Boolean(row.is_hidden),
          rating: row.rating ?? 0,
          tags: tagsByVideo.get(row.id) || [],
        }));

        return {
          version: 1,
          exportedAt: new Date().toISOString(),
          items,
        };
      } catch (error) {
        console.error('Error exporting filtered backup:', error);
        return {
          version: 1,
          exportedAt: new Date().toISOString(),
          items: [],
        };
      }
    });

    return monitoredQuery();
  }

  /**
   * Validate backup data before importing
   */
  validateBackup(backup: BackupResult | string): {
    valid: boolean;
    version: number;
    itemCount: number;
    errors: string[];
  } {
    const errors: string[] = [];

    try {
      const data = typeof backup === 'string' ? JSON.parse(backup) : backup;
      
      // Check required fields
      if (!data.version || typeof data.version !== 'number') {
        errors.push('Missing or invalid version number');
      }

      if (!data.exportedAt || typeof data.exportedAt !== 'string') {
        errors.push('Missing or invalid exportedAt timestamp');
      }

      if (!Array.isArray(data.items)) {
        errors.push('Missing or invalid items array');
        return {
          valid: false,
          version: data.version || 0,
          itemCount: 0,
          errors,
        };
      }

      // Validate items
      let validItems = 0;
      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];
        
        if (!item.path || typeof item.path !== 'string') {
          errors.push(`Item ${i}: Missing or invalid path`);
          continue;
        }

        if (typeof item.favorite !== 'boolean') {
          errors.push(`Item ${i}: Invalid favorite field (must be boolean)`);
        }

        if (typeof item.hidden !== 'boolean') {
          errors.push(`Item ${i}: Invalid hidden field (must be boolean)`);
        }

        if (item.rating !== null && 
            (typeof item.rating !== 'number' || item.rating < 0 || item.rating > 5)) {
          errors.push(`Item ${i}: Invalid rating (must be 0-5 or null)`);
        }

        if (!Array.isArray(item.tags)) {
          errors.push(`Item ${i}: Invalid tags field (must be array)`);
        }

        validItems++;
      }

      return {
        valid: errors.length === 0,
        version: data.version,
        itemCount: validItems,
        errors,
      };
    } catch (parseError) {
      errors.push(`JSON parsing error: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      return {
        valid: false,
        version: 0,
        itemCount: 0,
        errors,
      };
    }
  }

  /**
   * Get backup statistics without creating the full backup
   */
  getBackupStats(): {
    totalVideos: number;
    totalFavorites: number;
    totalHidden: number;
    totalRated: number;
    totalTagged: number;
    estimatedSize: number;
  } {
    if (!this.core.isInitialized()) {
      return {
        totalVideos: 0,
        totalFavorites: 0,
        totalHidden: 0,
        totalRated: 0,
        totalTagged: 0,
        estimatedSize: 0,
      };
    }

    const monitoredQuery = this.monitor.wrapQuery('getBackupStats', () => {
      try {
        const db = this.core.getConnection();

        const stats = db.prepare(`
          SELECT 
            COUNT(v.id) as totalVideos,
            COUNT(f.video_id) as totalFavorites,
            COUNT(h.video_id) as totalHidden,
            COUNT(r.video_id) as totalRated,
            COUNT(DISTINCT vt.video_id) as totalTagged
          FROM videos v
          LEFT JOIN favorites f ON f.video_id = v.id
          LEFT JOIN hidden_files h ON h.video_id = v.id
          LEFT JOIN ratings r ON r.video_id = v.id
          LEFT JOIN video_tags vt ON vt.video_id = v.id
        `).get() as {
          totalVideos: number;
          totalFavorites: number;
          totalHidden: number;
          totalRated: number;
          totalTagged: number;
        };

        // Estimate JSON size (rough calculation)
        const avgPathLength = 100;
        const avgTagsPerVideo = 2;
        const avgTagLength = 10;
        const estimatedSizePerItem = avgPathLength + avgTagsPerVideo * avgTagLength + 50; // JSON overhead
        const estimatedSize = stats.totalVideos * estimatedSizePerItem;

        return {
          ...stats,
          estimatedSize,
        };
      } catch (error) {
        console.error('Error getting backup stats:', error);
        return {
          totalVideos: 0,
          totalFavorites: 0,
          totalHidden: 0,
          totalRated: 0,
          totalTagged: 0,
          estimatedSize: 0,
        };
      }
    });

    return monitoredQuery();
  }
}