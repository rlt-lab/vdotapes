import type { VideoId, Rating } from '../../../types/core';
import type { DatabaseCore } from '../core/DatabaseCore';
import type { TransactionManager } from '../core/TransactionManager';

export interface UserDataOperationsCache {
  invalidate(key: string): void;
}

export interface UserDataOperationsMonitor {
  wrapQuery<T>(name: string, fn: () => T): () => T;
}

export class UserDataOperations {
  private core: DatabaseCore;
  private transactionManager: TransactionManager;
  private cache: UserDataOperationsCache;
  private monitor: UserDataOperationsMonitor;

  constructor(
    core: DatabaseCore,
    transactionManager: TransactionManager,
    cache: UserDataOperationsCache,
    monitor: UserDataOperationsMonitor
  ) {
    this.core = core;
    this.transactionManager = transactionManager;
    this.cache = cache;
    this.monitor = monitor;
  }

  // === FAVORITES OPERATIONS ===

  /**
   * Add video to favorites
   */
  addFavorite(videoId: VideoId): boolean {
    if (!this.core.isInitialized()) {
      return false;
    }

    const monitoredQuery = this.monitor.wrapQuery('addFavorite', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO favorites (video_id) VALUES (?)
        `);

        stmt.run(videoId);
        return true;
      } catch (error) {
        console.error('Error adding favorite:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Remove video from favorites
   */
  removeFavorite(videoId: VideoId): boolean {
    if (!this.core.isInitialized()) {
      return false;
    }

    const monitoredQuery = this.monitor.wrapQuery('removeFavorite', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          DELETE FROM favorites WHERE video_id = ?
        `);

        stmt.run(videoId);
        return true;
      } catch (error) {
        console.error('Error removing favorite:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Toggle favorite status for a video
   */
  toggleFavorite(videoId: VideoId): boolean {
    if (!this.core.isInitialized()) {
      return false;
    }

    const monitoredQuery = this.monitor.wrapQuery('toggleFavorite', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          SELECT video_id FROM favorites WHERE video_id = ?
        `);

        const existing = stmt.get(videoId);

        let result;
        if (existing) {
          result = this.removeFavorite(videoId);
        } else {
          result = this.addFavorite(videoId);
        }

        // Invalidate cache
        if (result) {
          this.cache.invalidate('getVideos');
          this.cache.invalidate('getFavorites');
        }

        return result;
      } catch (error) {
        console.error('Error toggling favorite:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Get all favorite video IDs
   */
  getFavoriteIds(): readonly VideoId[] {
    if (!this.core.isInitialized()) {
      return [];
    }

    const monitoredQuery = this.monitor.wrapQuery('getFavoriteIds', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          SELECT video_id FROM favorites ORDER BY added_at DESC
        `);

        const results = stmt.all() as { video_id: string }[];
        return results.map((row) => row.video_id as VideoId);
      } catch (error) {
        console.error('Error getting favorites:', error);
        return [];
      }
    });

    return monitoredQuery();
  }

  // === RATINGS OPERATIONS ===

  /**
   * Save rating for a video
   */
  saveRating(videoId: VideoId, rating: Rating): boolean {
    if (!this.core.isInitialized()) {
      return false;
    }

    const monitoredQuery = this.monitor.wrapQuery('saveRating', () => {
      try {
        if (rating < 1 || rating > 5) {
          throw new Error('Rating must be between 1 and 5');
        }

        const db = this.core.getConnection();
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO ratings (video_id, rating, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `);

        stmt.run(videoId, rating);
        return true;
      } catch (error) {
        console.error('Error saving rating:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Get rating for a video
   */
  getRating(videoId: VideoId): Rating | null {
    if (!this.core.isInitialized()) {
      return null;
    }

    const monitoredQuery = this.monitor.wrapQuery('getRating', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          SELECT rating FROM ratings WHERE video_id = ?
        `);

        const result = stmt.get(videoId) as { rating: number } | undefined;
        return result ? (result.rating as Rating) : null;
      } catch (error) {
        console.error('Error getting rating:', error);
        return null;
      }
    });

    return monitoredQuery();
  }

  /**
   * Remove rating for a video
   */
  removeRating(videoId: VideoId): boolean {
    if (!this.core.isInitialized()) {
      return false;
    }

    const monitoredQuery = this.monitor.wrapQuery('removeRating', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          DELETE FROM ratings WHERE video_id = ?
        `);

        stmt.run(videoId);
        return true;
      } catch (error) {
        console.error('Error removing rating:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Get all rated videos
   */
  getRatedVideos(): Array<{ video_id: VideoId; rating: Rating }> {
    if (!this.core.isInitialized()) {
      return [];
    }

    const monitoredQuery = this.monitor.wrapQuery('getRatedVideos', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          SELECT video_id, rating FROM ratings ORDER BY updated_at DESC
        `);

        return stmt.all() as Array<{ video_id: VideoId; rating: Rating }>;
      } catch (error) {
        console.error('Error getting rated videos:', error);
        return [];
      }
    });

    return monitoredQuery();
  }

  // === HIDDEN FILES OPERATIONS ===

  /**
   * Add video to hidden files
   */
  addHiddenFile(videoId: VideoId): boolean {
    if (!this.core.isInitialized()) {
      return false;
    }

    const monitoredQuery = this.monitor.wrapQuery('addHiddenFile', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO hidden_files (video_id) VALUES (?)
        `);

        stmt.run(videoId);
        return true;
      } catch (error) {
        console.error('Error adding hidden file:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Remove video from hidden files
   */
  removeHiddenFile(videoId: VideoId): boolean {
    if (!this.core.isInitialized()) {
      return false;
    }

    const monitoredQuery = this.monitor.wrapQuery('removeHiddenFile', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          DELETE FROM hidden_files WHERE video_id = ?
        `);

        stmt.run(videoId);
        return true;
      } catch (error) {
        console.error('Error removing hidden file:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Toggle hidden file status
   */
  toggleHiddenFile(videoId: VideoId): boolean {
    if (!this.core.isInitialized()) {
      return false;
    }

    const monitoredQuery = this.monitor.wrapQuery('toggleHiddenFile', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          SELECT video_id FROM hidden_files WHERE video_id = ?
        `);

        const existing = stmt.get(videoId);

        if (existing) {
          return this.removeHiddenFile(videoId);
        } else {
          return this.addHiddenFile(videoId);
        }
      } catch (error) {
        console.error('Error toggling hidden file:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Get all hidden file video IDs
   */
  getHiddenFiles(): VideoId[] {
    if (!this.core.isInitialized()) {
      return [];
    }

    const monitoredQuery = this.monitor.wrapQuery('getHiddenFiles', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          SELECT video_id FROM hidden_files ORDER BY hidden_at DESC
        `);

        const results = stmt.all() as { video_id: string }[];
        return results.map((row) => row.video_id as VideoId);
      } catch (error) {
        console.error('Error getting hidden files:', error);
        return [];
      }
    });

    return monitoredQuery();
  }

  // === THUMBNAIL OPERATIONS ===

  /**
   * Save thumbnail information
   */
  saveThumbnail(videoId: VideoId, thumbnailPath: string, timestamp: number | null = null): boolean {
    if (!this.core.isInitialized()) {
      return false;
    }

    const monitoredQuery = this.monitor.wrapQuery('saveThumbnail', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO thumbnails (video_id, thumbnail_path, timestamp)
          VALUES (?, ?, ?)
        `);

        stmt.run(videoId, thumbnailPath, timestamp);
        return true;
      } catch (error) {
        console.error('Error saving thumbnail:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Get thumbnail information
   */
  getThumbnail(videoId: VideoId): { thumbnail_path: string; timestamp: number | null } | null {
    if (!this.core.isInitialized()) {
      return null;
    }

    const monitoredQuery = this.monitor.wrapQuery('getThumbnail', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          SELECT thumbnail_path, timestamp FROM thumbnails WHERE video_id = ?
        `);

        return (
          (stmt.get(videoId) as { thumbnail_path: string; timestamp: number | null } | undefined) ||
          null
        );
      } catch (error) {
        console.error('Error getting thumbnail:', error);
        return null;
      }
    });

    return monitoredQuery();
  }

  // === BULK OPERATIONS FOR BACKUP/IMPORT ===

  /**
   * Process favorites in transaction for backup/import operations
   */
  processFavoritesInTransaction(
    operations: Array<{ videoId: VideoId; isFavorite: boolean }>,
    transactionContext: any
  ): { processed: number; errors: number } {
    let processed = 0;
    let errors = 0;

    const db = transactionContext.db;
    const insFav = db.prepare('INSERT OR IGNORE INTO favorites (video_id) VALUES (?)');
    const delFav = db.prepare('DELETE FROM favorites WHERE video_id = ?');

    for (const { videoId, isFavorite } of operations) {
      try {
        if (isFavorite) {
          insFav.run(videoId);
        } else {
          delFav.run(videoId);
        }
        processed++;
      } catch (error) {
        console.error(`Error processing favorite for ${videoId}:`, error);
        errors++;
      }
    }

    return { processed, errors };
  }

  /**
   * Process ratings in transaction for backup/import operations
   */
  processRatingsInTransaction(
    operations: Array<{ videoId: VideoId; rating: Rating | null }>,
    transactionContext: any
  ): { processed: number; errors: number } {
    let processed = 0;
    let errors = 0;

    const db = transactionContext.db;
    const setRating = db.prepare(
      'INSERT OR REPLACE INTO ratings (video_id, rating, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    );
    const delRating = db.prepare('DELETE FROM ratings WHERE video_id = ?');

    for (const { videoId, rating } of operations) {
      try {
        if (typeof rating === 'number' && rating >= 1 && rating <= 5) {
          setRating.run(videoId, rating);
        } else {
          delRating.run(videoId);
        }
        processed++;
      } catch (error) {
        console.error(`Error processing rating for ${videoId}:`, error);
        errors++;
      }
    }

    return { processed, errors };
  }

  /**
   * Process hidden files in transaction for backup/import operations
   */
  processHiddenFilesInTransaction(
    operations: Array<{ videoId: VideoId; isHidden: boolean }>,
    transactionContext: any
  ): { processed: number; errors: number } {
    let processed = 0;
    let errors = 0;

    const db = transactionContext.db;
    const insHidden = db.prepare('INSERT OR IGNORE INTO hidden_files (video_id) VALUES (?)');
    const delHidden = db.prepare('DELETE FROM hidden_files WHERE video_id = ?');

    for (const { videoId, isHidden } of operations) {
      try {
        if (isHidden) {
          insHidden.run(videoId);
        } else {
          delHidden.run(videoId);
        }
        processed++;
      } catch (error) {
        console.error(`Error processing hidden file for ${videoId}:`, error);
        errors++;
      }
    }

    return { processed, errors };
  }
}