const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs').promises;
const { QueryCache, CacheWarmer } = require('./query-cache');
const QueryPerformanceMonitor = require('./performance-monitor');

class VideoDatabase {
  constructor() {
    this.db = null;
    this.dbPath = null;
    this.initialized = false;
    
    // Performance and caching
    this.queryCache = new QueryCache(50, 300000); // 50 entries, 5 min TTL
    this.performanceMonitor = new QueryPerformanceMonitor();
    this.cacheWarmer = null;
    
    // Prepared statements cache
    this.preparedQueries = new Map();
  }

  /**
   * Initialize database
   */
  async initialize() {
    try {
      // Create data directory if it doesn't exist
      const dataDir = path.join(process.env.APPDATA || process.env.HOME || '.', '.vdotapes');
      await fs.mkdir(dataDir, { recursive: true });
      
      this.dbPath = path.join(dataDir, 'videos.db');
      
      // Check if database exists and has old schema
      try {
        const tempDb = new Database(this.dbPath);
        const tableInfo = tempDb.pragma('table_info(videos)');
        
        // Check for old schema: path column with UNIQUE constraint
        const pathColumn = tableInfo.find(col => col.name === 'path');
        const hasUniquePath = pathColumn && pathColumn.pk > 0; // Check if path is primary key or has unique constraint
        
        tempDb.close();
        
        if (hasUniquePath) {
          console.log('Detected old database schema, recreating database...');
          // Delete the old database file
          await fs.unlink(this.dbPath);
        }
      } catch (error) {
        // Database doesn't exist or is corrupted, will create new one
        console.log('Creating new database...');
      }
      
      this.db = new Database(this.dbPath);
      
      // Enable WAL mode for better performance
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = 10000');
      this.db.pragma('temp_store = MEMORY');
      
      await this.createTables();
      await this.runMigrations();
      this.initializePreparedStatements();
      this.initializeCacheWarmer();
      this.initialized = true;
      
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Error initializing database:', error);
      throw error;
    }
  }

  /**
   * Create database tables
   */
  async createTables() {
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

    // Settings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create basic indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_videos_folder ON videos (folder);
      CREATE INDEX IF NOT EXISTS idx_videos_name ON videos (name);
      CREATE INDEX IF NOT EXISTS idx_videos_last_modified ON videos (last_modified);
      CREATE INDEX IF NOT EXISTS idx_videos_size ON videos (size);
      CREATE INDEX IF NOT EXISTS idx_ratings_rating ON ratings (rating);
    `);
  }

  /**
   * Database migration system
   */
  async runMigrations() {
    const currentVersion = this.getCurrentSchemaVersion();
    const migrations = [
      this.migration001_addAdvancedIndexes.bind(this),
      this.migration002_optimizeExistingIndexes.bind(this)
    ];

    for (let i = currentVersion; i < migrations.length; i++) {
      console.log(`Running migration ${i + 1}...`);
      await migrations[i]();
      this.setSchemaVersion(i + 1);
    }
  }

  getCurrentSchemaVersion() {
    try {
      const result = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('schema_version');
      return result ? parseInt(result.value) : 0;
    } catch (error) {
      return 0;
    }
  }

  setSchemaVersion(version) {
    try {
      this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run('schema_version', version.toString());
    } catch (error) {
      console.error('Error setting schema version:', error);
    }
  }

  migration001_addAdvancedIndexes() {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_videos_path ON videos (path)',
      'CREATE INDEX IF NOT EXISTS idx_videos_created ON videos (created)',
      'CREATE INDEX IF NOT EXISTS idx_videos_folder_modified ON videos (folder, last_modified DESC)',
      'CREATE INDEX IF NOT EXISTS idx_videos_size_desc ON videos (size DESC)',
      'CREATE INDEX IF NOT EXISTS idx_favorites_added ON favorites (added_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_videos_updated ON videos (updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_videos_name_folder ON videos (name, folder)',
      'CREATE INDEX IF NOT EXISTS idx_videos_folder_size ON videos (folder, size DESC)'
    ];

    indexes.forEach(sql => {
      try {
        this.db.exec(sql);
      } catch (error) {
        console.warn('Error creating index:', error.message);
      }
    });
  }

  migration002_optimizeExistingIndexes() {
    // Add composite indexes for common query patterns
    const compositeIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_videos_folder_date_size ON videos (folder, last_modified DESC, size DESC)',
      'CREATE INDEX IF NOT EXISTS idx_videos_name_date ON videos (name, last_modified DESC)',
      'CREATE INDEX IF NOT EXISTS idx_videos_size_date ON videos (size DESC, last_modified DESC)'
    ];

    compositeIndexes.forEach(sql => {
      try {
        this.db.exec(sql);
      } catch (error) {
        console.warn('Error creating composite index:', error.message);
      }
    });
  }

  /**
   * Initialize prepared statements for better performance
   */
  initializePreparedStatements() {
    try {
      // Frequently used queries
      this.preparedQueries.set('videosByFolder', this.db.prepare(`
        SELECT id, name, path, relative_path, folder, size, duration, width, height, 
               codec, bitrate, last_modified, created, added_at, updated_at
        FROM videos 
        WHERE folder = ? OR (folder IS NULL AND ? IS NULL)
        ORDER BY last_modified DESC
        LIMIT ? OFFSET ?
      `));

      this.preparedQueries.set('favoriteIds', this.db.prepare(`
        SELECT video_id FROM favorites ORDER BY added_at DESC
      `));

      this.preparedQueries.set('videoRatings', this.db.prepare(`
        SELECT video_id, rating FROM ratings WHERE video_id IN (${Array(50).fill('?').join(',')})
      `));

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

      this.preparedQueries.set('videoCount', this.db.prepare(`
        SELECT COUNT(*) as count FROM videos WHERE folder = ? OR (folder IS NULL AND ? IS NULL)
      `));

      this.preparedQueries.set('videoById', this.db.prepare(`
        SELECT * FROM videos WHERE id = ?
      `));

      console.log('Prepared statements initialized');
    } catch (error) {
      console.error('Error initializing prepared statements:', error);
    }
  }

  /**
   * Initialize cache warmer
   */
  initializeCacheWarmer() {
    try {
      this.cacheWarmer = new CacheWarmer(this);
      
      // Warm cache after a short delay
      setTimeout(() => {
        this.cacheWarmer.warmCommonQueries();
      }, 2000);
      
      // Schedule periodic warming
      this.cacheWarmer.schedulePeriodicWarming(600000); // 10 minutes
      
      console.log('Cache warmer initialized');
    } catch (error) {
      console.error('Error initializing cache warmer:', error);
    }
  }



  /**
   * Add or update video in database
   */
  addVideo(video) {
    try {
      if (!this.db || !this.initialized) {
        // Database not initialized
        return false;
      }

      // Check if video with this ID already exists
      const existingStmt = this.db.prepare(`
        SELECT path FROM videos WHERE id = ?
      `);
      const existing = existingStmt.get(video.id);

      if (existing) {
        // Video exists, update path and other info if needed
        const updateStmt = this.db.prepare(`
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
        const insertStmt = this.db.prepare(`
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
      this.queryCache.invalidate('getVideos');
      this.queryCache.invalidate('getFolders');
      
      return true;
    } catch (error) {
      console.error('Error adding video to database:', error);
      return false;
    }
  }

  /**
   * Add multiple videos to database and clean up old entries
   */
  addVideos(videos) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    const transaction = this.db.transaction((videos) => {
      // Get current video IDs
      const currentIds = new Set(videos.map(v => v.id));
      
      // Add or update videos
      for (const video of videos) {
        this.addVideo(video);
      }
      
      // Clean up videos that are no longer in the current folder
      // but keep favorites and ratings for videos that might be in other folders
      const cleanupStmt = this.db.prepare(`
        DELETE FROM videos 
        WHERE id NOT IN (${Array.from(currentIds).map(() => '?').join(',')})
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
    });

    try {
      transaction(videos);
      
      // Invalidate cache
      this.queryCache.invalidate('getVideos');
      this.queryCache.invalidate('getFolders');
      
      return true;
    } catch (error) {
      console.error('Error adding videos to database:', error);
      return false;
    }
  }

  /**
   * Get videos with filters
   */
  getVideos(filters = {}) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return [];
    }

    // Check cache first
    const cacheKey = 'getVideos';
    const cached = this.queryCache.get(cacheKey, filters);
    if (cached) {
      return cached;
    }

    // Wrap with performance monitoring
    const monitoredQuery = this.performanceMonitor.wrapQuery('getVideos', () => {
      return this.getVideosQuery(filters);
    });

    try {
      const result = monitoredQuery();
      
      // Cache the result
      this.queryCache.set(cacheKey, filters, result);
      
      return result;
    } catch (error) {
      console.error('Error getting videos:', error);
      return [];
    }
  }

  getVideosQuery(filters = {}) {
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
      
      const params = [];

      // Apply filters
      if (filters.folder) {
        query += ' AND v.folder = ?';
        params.push(filters.folder);
      }

      if (filters.favoritesOnly) {
        query += ' AND f.video_id IS NOT NULL';
      }

      if (filters.minRating) {
        query += ' AND r.rating >= ?';
        params.push(filters.minRating);
      }

      if (filters.search) {
        query += ' AND (v.name LIKE ? OR v.folder LIKE ?)';
        const searchTerm = `%${filters.search}%`;
        params.push(searchTerm, searchTerm);
      }

      // Apply sorting
      const sortField = filters.sortBy || 'folder';
      const sortOrder = filters.sortOrder || 'ASC';
      
      let orderBy = '';
      switch (sortField) {
        case 'none':
          // No sorting - return in natural order
          break;
        case 'name':
          orderBy = 'v.name';
          break;
        case 'date':
          orderBy = 'v.last_modified DESC'; // Always newest first for date sort
          break;
        case 'size':
          orderBy = 'v.size';
          break;
        case 'rating':
          orderBy = 'r.rating DESC, v.name';
          break;
        case 'folder':
        default:
          orderBy = 'v.folder, v.last_modified DESC'; // Folder alphabetical, then newest first within each folder
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

      const stmt = this.db.prepare(query);
      const videos = stmt.all(...params);


      return videos.map(video => ({
        ...video,
        lastModified: video.last_modified, // Map snake_case to camelCase
        isFavorite: Boolean(video.is_favorite),
        rating: video.rating || null
      }));
    } catch (error) {
      console.error('Error getting videos from database:', error);
      return [];
    }
  }

  /**
   * Get video by ID
   */
  getVideoById(id) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return null;
    }

    try {
      const stmt = this.db.prepare(`
        SELECT v.*, 
               CASE WHEN f.video_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
               r.rating
        FROM videos v
        LEFT JOIN favorites f ON v.id = f.video_id
        LEFT JOIN ratings r ON v.id = r.video_id
        WHERE v.id = ?
      `);
      
      const video = stmt.get(id);
      
      if (video) {
        return {
          ...video,
          lastModified: video.last_modified, // Map snake_case to camelCase
          isFavorite: Boolean(video.is_favorite),
          rating: video.rating || null
        };
      }
      
      return null;
    } catch (error) {
      console.error('Error getting video by ID:', error);
      return null;
    }
  }

  /**
   * Get all folders
   */
  getFolders() {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return [];
    }

    try {
      const stmt = this.db.prepare(`
        SELECT DISTINCT folder 
        FROM videos 
        WHERE folder IS NOT NULL 
        ORDER BY folder
      `);
      
      return stmt.all().map(row => row.folder);
    } catch (error) {
      console.error('Error getting folders:', error);
      return [];
    }
  }

  /**
   * Add video to favorites
   */
  addFavorite(videoId) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    try {
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO favorites (video_id) VALUES (?)
      `);
      
      stmt.run(videoId);
      return true;
    } catch (error) {
      console.error('Error adding favorite:', error);
      return false;
    }
  }

  /**
   * Remove video from favorites
   */
  removeFavorite(videoId) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    try {
      const stmt = this.db.prepare(`
        DELETE FROM favorites WHERE video_id = ?
      `);
      
      stmt.run(videoId);
      return true;
    } catch (error) {
      console.error('Error removing favorite:', error);
      return false;
    }
  }

  /**
   * Toggle favorite status
   */
  toggleFavorite(videoId) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    try {
      const stmt = this.db.prepare(`
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
        this.queryCache.invalidate('getVideos');
        this.queryCache.invalidate('getFavorites');
      }
      
      return result;
    } catch (error) {
      console.error('Error toggling favorite:', error);
      return false;
    }
  }

  /**
   * Get all favorite video IDs
   */
  getFavorites() {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return [];
    }

    try {
      const stmt = this.db.prepare(`
        SELECT video_id FROM favorites ORDER BY added_at DESC
      `);
      
      return stmt.all().map(row => row.video_id);
    } catch (error) {
      console.error('Error getting favorites:', error);
      return [];
    }
  }

  /**
   * Add video to hidden files
   */
  addHiddenFile(videoId) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    try {
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO hidden_files (video_id) VALUES (?)
      `);
      
      stmt.run(videoId);
      return true;
    } catch (error) {
      console.error('Error adding hidden file:', error);
      return false;
    }
  }

  /**
   * Remove video from hidden files
   */
  removeHiddenFile(videoId) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    try {
      const stmt = this.db.prepare(`
        DELETE FROM hidden_files WHERE video_id = ?
      `);
      
      stmt.run(videoId);
      return true;
    } catch (error) {
      console.error('Error removing hidden file:', error);
      return false;
    }
  }

  /**
   * Toggle hidden file status
   */
  toggleHiddenFile(videoId) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    try {
      const stmt = this.db.prepare(`
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
  }

  /**
   * Get all hidden file video IDs
   */
  getHiddenFiles() {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return [];
    }

    try {
      const stmt = this.db.prepare(`
        SELECT video_id FROM hidden_files ORDER BY hidden_at DESC
      `);
      
      return stmt.all().map(row => row.video_id);
    } catch (error) {
      console.error('Error getting hidden files:', error);
      return [];
    }
  }

  /**
   * Save rating for a video
   */
  saveRating(videoId, rating) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    try {
      if (rating < 1 || rating > 5) {
        throw new Error('Rating must be between 1 and 5');
      }

      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO ratings (video_id, rating, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `);
      
      stmt.run(videoId, rating);
      return true;
    } catch (error) {
      console.error('Error saving rating:', error);
      return false;
    }
  }

  /**
   * Get rating for a video
   */
  getRating(videoId) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return null;
    }

    try {
      const stmt = this.db.prepare(`
        SELECT rating FROM ratings WHERE video_id = ?
      `);
      
      const result = stmt.get(videoId);
      return result ? result.rating : null;
    } catch (error) {
      console.error('Error getting rating:', error);
      return null;
    }
  }

  /**
   * Remove rating for a video
   */
  removeRating(videoId) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    try {
      const stmt = this.db.prepare(`
        DELETE FROM ratings WHERE video_id = ?
      `);
      
      stmt.run(videoId);
      return true;
    } catch (error) {
      console.error('Error removing rating:', error);
      return false;
    }
  }

  /**
   * Get all rated videos
   */
  getRatedVideos() {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return [];
    }

    try {
      const stmt = this.db.prepare(`
        SELECT video_id, rating FROM ratings ORDER BY updated_at DESC
      `);
      
      return stmt.all();
    } catch (error) {
      console.error('Error getting rated videos:', error);
      return [];
    }
  }

  /**
   * Save thumbnail information
   */
  saveThumbnail(videoId, thumbnailPath, timestamp = null) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO thumbnails (video_id, thumbnail_path, timestamp)
        VALUES (?, ?, ?)
      `);
      
      stmt.run(videoId, thumbnailPath, timestamp);
      return true;
    } catch (error) {
      console.error('Error saving thumbnail:', error);
      return false;
    }
  }

  /**
   * Get thumbnail information
   */
  getThumbnail(videoId) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return null;
    }

    try {
      const stmt = this.db.prepare(`
        SELECT thumbnail_path, timestamp FROM thumbnails WHERE video_id = ?
      `);
      
      return stmt.get(videoId);
    } catch (error) {
      console.error('Error getting thumbnail:', error);
      return null;
    }
  }

  /**
   * Save setting
   */
  saveSetting(key, value) {
    if (!this.db || !this.initialized) {
      // Don't log error for settings during initialization
      return false;
    }

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `);
      
      stmt.run(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Error saving setting:', error);
      return false;
    }
  }

  /**
   * Get setting
   */
  getSetting(key, defaultValue = null) {
    if (!this.db || !this.initialized) {
      // Don't log error for settings during initialization
      return defaultValue;
    }

    try {
      const stmt = this.db.prepare(`
        SELECT value FROM settings WHERE key = ?
      `);
      
      const result = stmt.get(key);
      
      if (result) {
        return JSON.parse(result.value);
      }
      
      return defaultValue;
    } catch (error) {
      console.error('Error getting setting:', error);
      return defaultValue;
    }
  }

  /**
   * Save last loaded folder
   */
  saveLastFolder(folderPath) {
    if (!this.db || !this.initialized) {
      // Don't log error for settings during initialization
      return false;
    }

    return this.saveSetting('lastFolder', folderPath);
  }

  /**
   * Get last loaded folder
   */
  getLastFolder() {
    if (!this.db || !this.initialized) {
      // Don't log error for settings during initialization
      return null;
    }

    return this.getSetting('lastFolder', null);
  }

  /**
   * Save grid columns setting
   */
  saveGridColumns(columns) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    return this.saveSetting('gridColumns', columns);
  }

  /**
   * Get grid columns setting
   */
  getGridColumns() {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return 4;
    }

    return this.getSetting('gridColumns', 4);
  }

  /**
   * Save sort preference
   */
  saveSortPreference(sortBy, sortOrder = 'ASC') {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    return this.saveSetting('sortPreference', { sortBy, sortOrder });
  }

  /**
   * Get sort preference
   */
  getSortPreference() {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return { sortBy: 'folder', sortOrder: 'ASC' };
    }

    return this.getSetting('sortPreference', { sortBy: 'folder', sortOrder: 'ASC' });
  }

  /**
   * Save folder filter preference
   */
  saveFolderFilter(folder) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    return this.saveSetting('folderFilter', folder);
  }

  /**
   * Get folder filter preference
   */
  getFolderFilter() {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return '';
    }

    return this.getSetting('folderFilter', '');
  }

  /**
   * Save favorites-only preference
   */
  saveFavoritesOnly(favoritesOnly) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    return this.saveSetting('favoritesOnly', favoritesOnly);
  }

  /**
   * Get favorites-only preference
   */
  getFavoritesOnly() {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    return this.getSetting('favoritesOnly', false);
  }

  /**
   * Save window size and position
   */
  saveWindowState(width, height, x, y) {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return false;
    }

    return this.saveSetting('windowState', { width, height, x, y });
  }

  /**
   * Get window size and position
   */
  getWindowState() {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return { width: 1400, height: 900, x: null, y: null };
    }

    return this.getSetting('windowState', { width: 1400, height: 900, x: null, y: null });
  }

  /**
   * Get database statistics
   */
  getStats() {
    if (!this.db || !this.initialized) {
      // Database not initialized
      return {
        totalVideos: 0,
        favoriteVideos: 0,
        totalFolders: 0,
        totalSize: 0
      };
    }

    try {
      const videoCount = this.db.prepare('SELECT COUNT(*) as count FROM videos').get().count;
      const favoriteCount = this.db.prepare('SELECT COUNT(*) as count FROM favorites').get().count;
      const folderCount = this.db.prepare('SELECT COUNT(DISTINCT folder) as count FROM videos WHERE folder IS NOT NULL').get().count;
      const totalSize = this.db.prepare('SELECT SUM(size) as total FROM videos').get().total || 0;

      return {
        totalVideos: videoCount,
        favoriteVideos: favoriteCount,
        totalFolders: folderCount,
        totalSize: totalSize
      };
    } catch (error) {
      console.error('Error getting database stats:', error);
      return {
        totalVideos: 0,
        favoriteVideos: 0,
        totalFolders: 0,
        totalSize: 0
      };
    }
  }

  /**
   * Get performance and cache statistics
   */
  getPerformanceStats() {
    const cacheStats = this.queryCache.getStats();
    const performanceStats = this.performanceMonitor.getSummaryStats();
    const performanceReport = this.performanceMonitor.generateReport();
    
    return {
      cache: cacheStats,
      performance: performanceStats,
      recommendations: performanceReport.recommendations,
      slowQueries: performanceReport.slowQueries.slice(0, 3) // Top 3 slow queries
    };
  }

  /**
   * Log performance report to console
   */
  logPerformanceReport() {
    const stats = this.getPerformanceStats();
    
    console.log('=== Database Performance Report ===');
    console.log('Cache Hit Rate:', `${stats.cache.hitRate.toFixed(1)}%`);
    console.log('Cache Size:', `${stats.cache.size}/${stats.cache.maxSize}`);
    console.log('Average Query Time:', `${stats.performance.avgQueryTime}ms`);
    console.log('Total Queries:', stats.performance.totalQueries);
    console.log('Queries/Second:', stats.performance.queriesPerSecond);
    
    if (stats.slowQueries.length > 0) {
      console.log('Recent Slow Queries:');
      stats.slowQueries.forEach(q => {
        console.log(`  ${q.queryName}: ${q.duration}ms`);
      });
    }
    
    if (stats.recommendations.length > 0) {
      console.log('Performance Recommendations:');
      stats.recommendations.forEach(rec => {
        console.log(`  ${rec.type}: ${rec.suggestion}`);
      });
    }
    
    return stats;
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
    
    // Clean up performance monitoring
    if (this.performanceMonitor) {
      this.performanceMonitor.reset();
    }
    
    // Clear cache
    if (this.queryCache) {
      this.queryCache.clear();
    }
  }
}

module.exports = VideoDatabase;
