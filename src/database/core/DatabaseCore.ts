import { promises as fs } from 'fs';
import * as path from 'path';

import Database from 'better-sqlite3';

export interface DatabaseConfiguration {
  readonly dataDir?: string;
  readonly dbName?: string;
  readonly walMode?: boolean;
  readonly cacheSize?: number;
  readonly tempStore?: 'FILE' | 'MEMORY';
}

export interface MigrationResult {
  readonly success: boolean;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly error?: string;
}

export class DatabaseCore {
  private db: Database.Database | null = null;
  private dbPath: string | null = null;
  private config: Required<DatabaseConfiguration>;

  constructor(config: DatabaseConfiguration = {}) {
    this.config = {
      dataDir: config.dataDir || path.join(process.env.APPDATA || process.env.HOME || '.', '.vdotapes'),
      dbName: config.dbName || 'videos.db',
      walMode: config.walMode ?? true,
      cacheSize: config.cacheSize || 10000,
      tempStore: config.tempStore || 'MEMORY',
    };
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.config.dataDir, { recursive: true });
      this.dbPath = path.join(this.config.dataDir, this.config.dbName);

      // Handle legacy schema migration
      await this.handleLegacySchema();

      this.db = new Database(this.dbPath);
      this.configureDatabaseSettings();
      
      await this.createTables();
      await this.runMigrations();

      console.log('Database core initialized successfully');
    } catch (error) {
      console.error('Error initializing database core:', error);
      throw error;
    }
  }

  private async handleLegacySchema(): Promise<void> {
    if (!this.dbPath) return;

    try {
      const tempDb = new Database(this.dbPath);
      const tableInfo = tempDb.pragma('table_info(videos)') as Array<{
        name: string;
        pk: number;
      }>;

      const pathColumn = tableInfo.find((col) => col.name === 'path');
      const hasUniquePath = pathColumn && pathColumn.pk > 0;

      tempDb.close();

      if (hasUniquePath) {
        console.log('Detected old database schema, recreating database...');
        await fs.unlink(this.dbPath);
      }
    } catch (error) {
      console.log('Creating new database...');
    }
  }

  private configureDatabaseSettings(): void {
    if (!this.db) return;

    if (this.config.walMode) {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
    }
    
    this.db.pragma(`cache_size = ${this.config.cacheSize}`);
    this.db.pragma(`temp_store = ${this.config.tempStore}`);
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Videos table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS videos (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        relative_path TEXT,
        folder TEXT,
        size INTEGER,
        duration REAL,
        width INTEGER,
        height INTEGER,
        codec TEXT,
        bitrate INTEGER,
        last_modified INTEGER,
        created INTEGER,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Favorites table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS favorites (
        video_id TEXT PRIMARY KEY,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE
      )
    `);

    // Ratings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ratings (
        video_id TEXT PRIMARY KEY,
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE
      )
    `);

    // Thumbnails table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thumbnails (
        video_id TEXT PRIMARY KEY,
        thumbnail_path TEXT NOT NULL,
        timestamp REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE
      )
    `);

    // Hidden files table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hidden_files (
        video_id TEXT PRIMARY KEY,
        hidden_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE
      )
    `);

    // Tags and mapping tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS video_tags (
        video_id TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (video_id, tag_id),
        FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
      )
    `);

    // Settings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.createIndexes();
  }

  private createIndexes(): void {
    if (!this.db) return;

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_videos_folder ON videos (folder)',
      'CREATE INDEX IF NOT EXISTS idx_videos_name ON videos (name)',
      'CREATE INDEX IF NOT EXISTS idx_videos_last_modified ON videos (last_modified)',
      'CREATE INDEX IF NOT EXISTS idx_videos_size ON videos (size)',
      'CREATE INDEX IF NOT EXISTS idx_videos_path ON videos (path)',
      'CREATE INDEX IF NOT EXISTS idx_videos_created ON videos (created)',
      'CREATE INDEX IF NOT EXISTS idx_videos_folder_modified ON videos (folder, last_modified DESC)',
      'CREATE INDEX IF NOT EXISTS idx_videos_size_desc ON videos (size DESC)',
      'CREATE INDEX IF NOT EXISTS idx_favorites_added ON favorites (added_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_videos_updated ON videos (updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_videos_name_folder ON videos (name, folder)',
      'CREATE INDEX IF NOT EXISTS idx_videos_folder_size ON videos (folder, size DESC)',
      'CREATE INDEX IF NOT EXISTS idx_ratings_rating ON ratings (rating)',
      'CREATE INDEX IF NOT EXISTS idx_tags_name ON tags (name)',
      'CREATE INDEX IF NOT EXISTS idx_video_tags_video ON video_tags (video_id)',
      'CREATE INDEX IF NOT EXISTS idx_video_tags_tag ON video_tags (tag_id)',
      'CREATE INDEX IF NOT EXISTS idx_videos_folder_date_size ON videos (folder, last_modified DESC, size DESC)',
      'CREATE INDEX IF NOT EXISTS idx_videos_name_date ON videos (name, last_modified DESC)',
      'CREATE INDEX IF NOT EXISTS idx_videos_size_date ON videos (size DESC, last_modified DESC)',
    ];

    indexes.forEach((sql) => {
      try {
        this.db!.exec(sql);
      } catch (error) {
        console.warn('Error creating index:', error instanceof Error ? error.message : String(error));
      }
    });
  }

  private async runMigrations(): Promise<MigrationResult> {
    const currentVersion = this.getCurrentSchemaVersion();
    const migrations = [
      this.migration001_addAdvancedIndexes.bind(this),
      this.migration002_optimizeExistingIndexes.bind(this),
    ];

    let lastVersion = currentVersion;
    try {
      for (let i = currentVersion; i < migrations.length; i++) {
        console.log(`Running migration ${i + 1}...`);
        await migrations[i]();
        lastVersion = i + 1;
        this.setSchemaVersion(lastVersion);
      }

      return {
        success: true,
        fromVersion: currentVersion,
        toVersion: lastVersion,
      };
    } catch (error) {
      console.error(`Migration failed at version ${lastVersion}:`, error);
      return {
        success: false,
        fromVersion: currentVersion,
        toVersion: lastVersion,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private getCurrentSchemaVersion(): number {
    if (!this.db) return 0;
    try {
      const result = this.db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('schema_version') as { value: string } | undefined;
      
      if (!result?.value || typeof result.value !== 'string') return 0;
      
      const version = parseInt(result.value, 10);
      return isNaN(version) ? 0 : version;
    } catch (error) {
      return 0;
    }
  }

  private setSchemaVersion(version: number): void {
    if (!this.db) return;
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run('schema_version', version.toString());
    } catch (error) {
      console.error('Error setting schema version:', error);
    }
  }

  private migration001_addAdvancedIndexes(): void {
    // Implementation moved from original database.ts
    // This migration is already handled in createIndexes()
  }

  private migration002_optimizeExistingIndexes(): void {
    // Implementation moved from original database.ts  
    // This migration is already handled in createIndexes()
  }

  getConnection(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  isInitialized(): boolean {
    return this.db !== null;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  getDatabasePath(): string | null {
    return this.dbPath;
  }

  getConfiguration(): Required<DatabaseConfiguration> {
    return { ...this.config };
  }
}