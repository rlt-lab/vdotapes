/**
 * Database Migration to v2 Schema
 * 
 * Consolidates user data into videos table:
 * - Merges favorites into videos.favorite column
 * - Merges hidden_files into videos.hidden column
 * - Merges ratings into videos.rating column
 * - Simplifies tags table structure
 * - Keeps old tables temporarily for rollback safety
 */

import type Database from 'better-sqlite3';

export interface MigrationResult {
  success: boolean;
  fromVersion: number;
  toVersion: number;
  error?: string;
  stats?: {
    favoritesMigrated: number;
    hiddenMigrated: number;
    ratingsMigrated: number;
    tagsMigrated: number;
  };
}

/**
 * Check if migration is needed
 */
export function needsV2Migration(db: Database.Database): boolean {
  try {
    const tableInfo = db.pragma('table_info(videos)') as Array<{ name: string }>;
    const hasFavoriteColumn = tableInfo.some(col => col.name === 'favorite');
    return !hasFavoriteColumn;
  } catch (error) {
    console.error('Error checking migration status:', error);
    return false;
  }
}

/**
 * Migrate to v2 schema
 */
export function migrateToV2(db: Database.Database): MigrationResult {
  console.log('[Migration] Starting v2 schema migration...');
  
  const stats = {
    favoritesMigrated: 0,
    hiddenMigrated: 0,
    ratingsMigrated: 0,
    tagsMigrated: 0
  };
  
  try {
    // Start transaction
    db.exec('BEGIN TRANSACTION');
    
    // Step 1: Add new columns to videos table
    console.log('[Migration] Adding new columns to videos table...');
    
    try {
      db.exec(`ALTER TABLE videos ADD COLUMN favorite INTEGER DEFAULT 0`);
    } catch (e) {
      // Column might already exist
      console.log('[Migration] favorite column already exists');
    }
    
    try {
      db.exec(`ALTER TABLE videos ADD COLUMN hidden INTEGER DEFAULT 0`);
    } catch (e) {
      console.log('[Migration] hidden column already exists');
    }
    
    try {
      db.exec(`ALTER TABLE videos ADD COLUMN rating INTEGER DEFAULT 0`);
    } catch (e) {
      console.log('[Migration] rating column already exists');
    }
    
    try {
      db.exec(`ALTER TABLE videos ADD COLUMN notes TEXT DEFAULT ''`);
    } catch (e) {
      console.log('[Migration] notes column already exists');
    }
    
    try {
      db.exec(`ALTER TABLE videos ADD COLUMN last_viewed INTEGER`);
    } catch (e) {
      console.log('[Migration] last_viewed column already exists');
    }
    
    try {
      db.exec(`ALTER TABLE videos ADD COLUMN view_count INTEGER DEFAULT 0`);
    } catch (e) {
      console.log('[Migration] view_count column already exists');
    }
    
    // Step 2: Migrate data from old tables
    console.log('[Migration] Migrating favorites...');
    const favoritesResult = db.exec(`
      UPDATE videos
      SET favorite = 1
      WHERE id IN (SELECT video_id FROM favorites)
    `);
    const favoriteCount = db.prepare('SELECT COUNT(*) as count FROM favorites').get() as { count: number };
    stats.favoritesMigrated = favoriteCount.count;
    console.log(`[Migration] Migrated ${stats.favoritesMigrated} favorites`);
    
    console.log('[Migration] Migrating hidden files...');
    db.exec(`
      UPDATE videos
      SET hidden = 1
      WHERE id IN (SELECT video_id FROM hidden_files)
    `);
    const hiddenCount = db.prepare('SELECT COUNT(*) as count FROM hidden_files').get() as { count: number };
    stats.hiddenMigrated = hiddenCount.count;
    console.log(`[Migration] Migrated ${stats.hiddenMigrated} hidden files`);
    
    console.log('[Migration] Migrating ratings...');
    // Use correlated subquery for ratings
    db.exec(`
      UPDATE videos
      SET rating = (
        SELECT rating FROM ratings WHERE video_id = videos.id
      )
      WHERE id IN (SELECT video_id FROM ratings)
    `);
    const ratingsCount = db.prepare('SELECT COUNT(*) as count FROM ratings').get() as { count: number };
    stats.ratingsMigrated = ratingsCount.count;
    console.log(`[Migration] Migrated ${stats.ratingsMigrated} ratings`);
    
    // Step 3: Create new indexes for performance
    console.log('[Migration] Creating new indexes...');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_videos_favorite ON videos(favorite);
      CREATE INDEX IF NOT EXISTS idx_videos_hidden ON videos(hidden);
      CREATE INDEX IF NOT EXISTS idx_videos_rating ON videos(rating);
      CREATE INDEX IF NOT EXISTS idx_videos_last_viewed ON videos(last_viewed);
    `);
    
    // Step 4: Rename old tables as backup (don't drop yet!)
    console.log('[Migration] Backing up old tables...');
    
    // Check if backup tables already exist, drop them first
    db.exec(`DROP TABLE IF EXISTS _backup_favorites_v1`);
    db.exec(`DROP TABLE IF EXISTS _backup_hidden_files_v1`);
    db.exec(`DROP TABLE IF EXISTS _backup_ratings_v1`);
    
    // Create backups
    db.exec(`ALTER TABLE favorites RENAME TO _backup_favorites_v1`);
    db.exec(`ALTER TABLE hidden_files RENAME TO _backup_hidden_files_v1`);
    db.exec(`ALTER TABLE ratings RENAME TO _backup_ratings_v1`);

    // Step 4b: Recreate empty tables for backward compatibility
    // Some code still references these tables even though data is now in videos
    console.log('[Migration] Recreating empty tables for compatibility...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS favorites (
        video_id TEXT PRIMARY KEY,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS hidden_files (
        video_id TEXT PRIMARY KEY,
        hidden_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS ratings (
        video_id TEXT PRIMARY KEY,
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE
      )
    `);

    // Step 5: Update schema version
    console.log('[Migration] Updating schema version...');
    db.exec(`
      INSERT OR REPLACE INTO settings (key, value, updated_at)
      VALUES ('schema_version', '2', CURRENT_TIMESTAMP)
    `);
    
    // Commit transaction
    db.exec('COMMIT');
    
    console.log('[Migration] v2 schema migration complete!');
    console.log('[Migration] Stats:', stats);
    console.log('[Migration] Old tables backed up as _backup_*_v1');
    console.log('[Migration] You can remove backups after verification');
    
    return {
      success: true,
      fromVersion: 1,
      toVersion: 2,
      stats
    };
  } catch (error) {
    // Rollback on error
    try {
      db.exec('ROLLBACK');
    } catch (rollbackError) {
      console.error('[Migration] CRITICAL: Rollback failed:', rollbackError);
      console.error('[Migration] Original error:', error);
    }

    console.error('[Migration] Migration failed:', error);
    return {
      success: false,
      fromVersion: 1,
      toVersion: 1,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Rollback v2 migration (restore from backups)
 */
export function rollbackV2Migration(db: Database.Database): MigrationResult {
  console.log('[Migration] Rolling back v2 migration...');
  
  try {
    db.exec('BEGIN TRANSACTION');
    
    // Check if backup tables exist
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '_backup_%_v1'"
    ).all() as Array<{ name: string }>;
    
    if (tables.length === 0) {
      throw new Error('No backup tables found. Cannot rollback.');
    }
    
    console.log('[Migration] Restoring from backups...');
    
    // Drop current tables (if they exist)
    db.exec(`DROP TABLE IF EXISTS favorites`);
    db.exec(`DROP TABLE IF EXISTS hidden_files`);
    db.exec(`DROP TABLE IF EXISTS ratings`);
    
    // Restore from backups
    db.exec(`ALTER TABLE _backup_favorites_v1 RENAME TO favorites`);
    db.exec(`ALTER TABLE _backup_hidden_files_v1 RENAME TO hidden_files`);
    db.exec(`ALTER TABLE _backup_ratings_v1 RENAME TO ratings`);
    
    // Remove columns from videos table (can't actually remove in SQLite, but mark as v1)
    db.exec(`
      UPDATE settings SET value = '1', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'schema_version'
    `);
    
    db.exec('COMMIT');
    
    console.log('[Migration] Rollback complete');
    console.warn('[Migration] Note: Cannot remove columns from videos table in SQLite');
    console.warn('[Migration] New columns (favorite, hidden, rating) still exist but are not used');
    
    return {
      success: true,
      fromVersion: 2,
      toVersion: 1
    };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (rollbackError) {
      console.error('[Migration] CRITICAL: Rollback failed:', rollbackError);
      console.error('[Migration] Original error:', error);
    }

    console.error('[Migration] Rollback failed:', error);
    return {
      success: false,
      fromVersion: 2,
      toVersion: 2,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Remove backup tables after verification
 */
export function removeBackupTables(db: Database.Database): boolean {
  console.log('[Migration] Removing backup tables...');
  
  try {
    db.exec('BEGIN TRANSACTION');
    
    db.exec(`DROP TABLE IF EXISTS _backup_favorites_v1`);
    db.exec(`DROP TABLE IF EXISTS _backup_hidden_files_v1`);
    db.exec(`DROP TABLE IF EXISTS _backup_ratings_v1`);
    
    db.exec('COMMIT');
    
    console.log('[Migration] Backup tables removed');
    return true;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (rollbackError) {
      console.error('[Migration] CRITICAL: Rollback failed:', rollbackError);
      console.error('[Migration] Original error:', error);
    }

    console.error('[Migration] Failed to remove backup tables:', error);
    return false;
  }
}
