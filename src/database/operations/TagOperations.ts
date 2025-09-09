import type { VideoId } from '../../../types/core';
import type { TagInfo } from '../../../types/database';
import type { DatabaseCore } from '../core/DatabaseCore';
import type { TransactionManager } from '../core/TransactionManager';

export interface TagOperationsCache {
  invalidate(key: string): void;
}

export interface TagOperationsMonitor {
  wrapQuery<T>(name: string, fn: () => T): () => T;
}

export class TagOperations {
  private core: DatabaseCore;
  private transactionManager: TransactionManager;
  private cache: TagOperationsCache;
  private monitor: TagOperationsMonitor;

  constructor(
    core: DatabaseCore,
    transactionManager: TransactionManager,
    cache: TagOperationsCache,
    monitor: TagOperationsMonitor
  ) {
    this.core = core;
    this.transactionManager = transactionManager;
    this.cache = cache;
    this.monitor = monitor;
  }

  /**
   * Add tag to video
   */
  addTag(videoId: VideoId, tagName: string): boolean {
    return this.addTagToVideo(videoId, tagName);
  }

  /**
   * Remove tag from video
   */
  removeTag(videoId: VideoId, tagName: string): boolean {
    return this.removeTagFromVideo(videoId, tagName);
  }

  /**
   * Get all tags for a video
   */
  getVideoTags(videoId: VideoId): readonly string[] {
    return this.listTagsForVideo(videoId);
  }

  /**
   * Get all tags with usage information
   */
  getAllTags(): readonly TagInfo[] {
    const allTags = this.listAllTags();
    return allTags.map((tag) => ({
      name: tag.name,
      count: tag.usage,
      lastUsed: new Date().toISOString(),
    }));
  }

  /**
   * Search videos by tag
   */
  searchByTag(tagName: string): readonly VideoId[] {
    const videos = this.searchVideosByTag(tagName);
    return videos.map((video) => video.id as VideoId);
  }

  /**
   * Add tag to video (implementation)
   */
  addTagToVideo(videoId: VideoId, tagName: string): boolean {
    if (!this.core.isInitialized()) return false;

    const monitoredQuery = this.monitor.wrapQuery('addTagToVideo', () => {
      try {
        const tagId = this.upsertTag(tagName);
        if (!tagId) return false;

        const db = this.core.getConnection();
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)
        `);
        stmt.run(videoId, tagId);

        // Invalidate caches that may depend on tags
        this.cache.invalidate('getVideos');
        return true;
      } catch (error) {
        console.error('Error adding tag to video:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Remove tag from video (implementation)
   */
  removeTagFromVideo(videoId: VideoId, tagName: string): boolean {
    if (!this.core.isInitialized()) return false;

    const monitoredQuery = this.monitor.wrapQuery('removeTagFromVideo', () => {
      try {
        const db = this.core.getConnection();
        const tagResult = db
          .prepare('SELECT id FROM tags WHERE name = ?')
          .get(tagName.trim()) as { id: number } | undefined;
        
        if (!tagResult) return true; // nothing to remove

        const stmt = db.prepare('DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?');
        stmt.run(videoId, tagResult.id);

        this.cache.invalidate('getVideos');
        return true;
      } catch (error) {
        console.error('Error removing tag from video:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Get all tags for a video (implementation)
   */
  listTagsForVideo(videoId: VideoId): string[] {
    if (!this.core.isInitialized()) return [];

    const monitoredQuery = this.monitor.wrapQuery('listTagsForVideo', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          SELECT t.name FROM video_tags vt
          JOIN tags t ON vt.tag_id = t.id
          WHERE vt.video_id = ?
          ORDER BY t.name COLLATE NOCASE
        `);
        const results = stmt.all(videoId) as { name: string }[];
        return results.map((r) => r.name);
      } catch (error) {
        console.error('Error listing tags for video:', error);
        return [];
      }
    });

    return monitoredQuery();
  }

  /**
   * Get all tags with usage counts
   */
  listAllTags(): Array<{ name: string; usage: number }> {
    if (!this.core.isInitialized()) return [];

    const monitoredQuery = this.monitor.wrapQuery('listAllTags', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          SELECT t.name, COUNT(vt.video_id) as usage
          FROM tags t
          LEFT JOIN video_tags vt ON vt.tag_id = t.id
          GROUP BY t.id
          ORDER BY usage DESC, t.name COLLATE NOCASE
        `);
        return stmt.all() as Array<{ name: string; usage: number }>;
      } catch (error) {
        console.error('Error listing all tags:', error);
        return [];
      }
    });

    return monitoredQuery();
  }

  /**
   * Search videos by tag name
   */
  searchVideosByTag(
    query: string,
    limit = 100
  ): Array<{ id: string; name: string; path: string; folder: string; last_modified: number }> {
    if (!this.core.isInitialized()) return [];

    const monitoredQuery = this.monitor.wrapQuery('searchVideosByTag', () => {
      try {
        const q = `%${query}%`;
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          SELECT v.id, v.name, v.path, v.folder, v.last_modified
          FROM videos v
          JOIN video_tags vt ON vt.video_id = v.id
          JOIN tags t ON t.id = vt.tag_id
          WHERE t.name LIKE ?
          ORDER BY v.last_modified DESC
          LIMIT ?
        `);
        return stmt.all(q, limit) as Array<{
          id: string;
          name: string;
          path: string;
          folder: string;
          last_modified: number;
        }>;
      } catch (error) {
        console.error('Error searching videos by tag:', error);
        return [];
      }
    });

    return monitoredQuery();
  }

  /**
   * Get or create tag by name
   */
  private upsertTag(name: string): number | null {
    if (!this.core.isInitialized()) return null;

    try {
      const db = this.core.getConnection();
      const insert = db.prepare(`
        INSERT INTO tags (name) VALUES (?)
        ON CONFLICT(name) DO UPDATE SET name = excluded.name
        RETURNING id
      `);
      const row = insert.get(name.trim()) as { id: number } | undefined;
      return row?.id || null;
    } catch (error) {
      console.error('Error upserting tag:', error);
      return null;
    }
  }

  /**
   * Remove unused tags from the database
   */
  cleanupUnusedTags(): number {
    if (!this.core.isInitialized()) return 0;

    const monitoredQuery = this.monitor.wrapQuery('cleanupUnusedTags', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          DELETE FROM tags 
          WHERE id NOT IN (
            SELECT DISTINCT tag_id FROM video_tags
          )
        `);
        const result = stmt.run();
        return result.changes as number;
      } catch (error) {
        console.error('Error cleaning up unused tags:', error);
        return 0;
      }
    });

    return monitoredQuery();
  }

  /**
   * Get tag usage statistics
   */
  getTagStats(): {
    totalTags: number;
    totalUsages: number;
    avgUsagePerTag: number;
    mostUsedTags: Array<{ name: string; usage: number }>;
  } {
    if (!this.core.isInitialized()) {
      return {
        totalTags: 0,
        totalUsages: 0,
        avgUsagePerTag: 0,
        mostUsedTags: [],
      };
    }

    const monitoredQuery = this.monitor.wrapQuery('getTagStats', () => {
      try {
        const db = this.core.getConnection();

        // Get total counts
        const totalResult = db.prepare(`
          SELECT 
            COUNT(DISTINCT t.id) as totalTags,
            COUNT(vt.video_id) as totalUsages
          FROM tags t
          LEFT JOIN video_tags vt ON vt.tag_id = t.id
        `).get() as { totalTags: number; totalUsages: number };

        // Get most used tags (top 5)
        const mostUsedResult = db.prepare(`
          SELECT t.name, COUNT(vt.video_id) as usage
          FROM tags t
          JOIN video_tags vt ON vt.tag_id = t.id
          GROUP BY t.id
          ORDER BY usage DESC
          LIMIT 5
        `).all() as Array<{ name: string; usage: number }>;

        const avgUsagePerTag = totalResult.totalTags > 0 
          ? totalResult.totalUsages / totalResult.totalTags 
          : 0;

        return {
          totalTags: totalResult.totalTags,
          totalUsages: totalResult.totalUsages,
          avgUsagePerTag,
          mostUsedTags: mostUsedResult,
        };
      } catch (error) {
        console.error('Error getting tag stats:', error);
        return {
          totalTags: 0,
          totalUsages: 0,
          avgUsagePerTag: 0,
          mostUsedTags: [],
        };
      }
    });

    return monitoredQuery();
  }

  /**
   * Batch add tags to multiple videos
   */
  batchAddTags(operations: Array<{ videoId: VideoId; tagNames: string[] }>): {
    processed: number;
    errors: number;
  } {
    if (!this.core.isInitialized()) {
      return { processed: 0, errors: operations.length };
    }

    const result = this.transactionManager.execute((ctx) => {
      let processed = 0;
      let errors = 0;

      for (const { videoId, tagNames } of operations) {
        try {
          for (const tagName of tagNames) {
            if (tagName && String(tagName).trim().length > 0) {
              this.addTagToVideo(videoId, String(tagName).trim());
            }
          }
          processed++;
        } catch (error) {
          console.error(`Error processing tags for video ${videoId}:`, error);
          errors++;
        }
      }

      return { processed, errors };
    });

    return result.success ? result.result! : { processed: 0, errors: operations.length };
  }

  /**
   * Process tags in transaction for backup/import operations
   */
  processTagsInTransaction(
    operations: Array<{ videoId: VideoId; tags: string[] }>,
    transactionContext: any
  ): { processed: number; errors: number } {
    let processed = 0;
    let errors = 0;

    for (const { videoId, tags } of operations) {
      try {
        if (Array.isArray(tags)) {
          for (const tagName of tags) {
            if (tagName && String(tagName).trim().length > 0) {
              this.addTagToVideo(videoId, String(tagName));
            }
          }
        }
        processed++;
      } catch (error) {
        console.error(`Error processing tags for ${videoId}:`, error);
        errors++;
      }
    }

    return { processed, errors };
  }

  /**
   * Rename a tag
   */
  renameTag(oldName: string, newName: string): boolean {
    if (!this.core.isInitialized()) return false;

    const result = this.transactionManager.execute((ctx) => {
      const db = ctx.db;

      // Check if old tag exists
      const oldTag = db.prepare('SELECT id FROM tags WHERE name = ?').get(oldName) as 
        { id: number } | undefined;
      
      if (!oldTag) {
        throw new Error(`Tag "${oldName}" does not exist`);
      }

      // Check if new tag name already exists
      const existingTag = db.prepare('SELECT id FROM tags WHERE name = ?').get(newName) as 
        { id: number } | undefined;
      
      if (existingTag) {
        throw new Error(`Tag "${newName}" already exists`);
      }

      // Update the tag name
      const updateStmt = db.prepare('UPDATE tags SET name = ? WHERE id = ?');
      updateStmt.run(newName, oldTag.id);

      this.cache.invalidate('getVideos');
      return true;
    });

    if (!result.success) {
      console.error('Error renaming tag:', result.error);
      return false;
    }

    return true;
  }

  /**
   * Merge two tags (move all videos from source tag to target tag)
   */
  mergeTags(sourceTagName: string, targetTagName: string): boolean {
    if (!this.core.isInitialized()) return false;

    const result = this.transactionManager.execute((ctx) => {
      const db = ctx.db;

      // Get source and target tag IDs
      const sourceTag = db.prepare('SELECT id FROM tags WHERE name = ?').get(sourceTagName) as 
        { id: number } | undefined;
      const targetTag = db.prepare('SELECT id FROM tags WHERE name = ?').get(targetTagName) as 
        { id: number } | undefined;

      if (!sourceTag) {
        throw new Error(`Source tag "${sourceTagName}" does not exist`);
      }

      // Create target tag if it doesn't exist
      let targetTagId: number;
      if (!targetTag) {
        const createResult = db.prepare('INSERT INTO tags (name) VALUES (?) RETURNING id')
          .get(targetTagName) as { id: number };
        targetTagId = createResult.id;
      } else {
        targetTagId = targetTag.id;
      }

      // Update all video_tags references to use target tag
      const updateStmt = db.prepare(`
        UPDATE OR IGNORE video_tags 
        SET tag_id = ? 
        WHERE tag_id = ?
      `);
      updateStmt.run(targetTagId, sourceTag.id);

      // Remove any duplicate entries
      db.exec(`
        DELETE FROM video_tags 
        WHERE rowid NOT IN (
          SELECT MIN(rowid) 
          FROM video_tags 
          GROUP BY video_id, tag_id
        )
      `);

      // Delete the source tag
      const deleteStmt = db.prepare('DELETE FROM tags WHERE id = ?');
      deleteStmt.run(sourceTag.id);

      this.cache.invalidate('getVideos');
      return true;
    });

    if (!result.success) {
      console.error('Error merging tags:', result.error);
      return false;
    }

    return true;
  }
}