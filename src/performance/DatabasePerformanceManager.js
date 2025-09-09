/**
 * Shared Performance Infrastructure for Modular VideoDatabase
 * Coordinates caching, monitoring, and optimization across multiple database modules
 */

const QueryPerformanceMonitor = require('../performance-monitor');
const { QueryCache, CacheWarmer } = require('../query-cache');

/**
 * Centralized performance management for distributed database modules
 * Maintains performance optimizations while enabling modular architecture
 */
class DatabasePerformanceManager {
  constructor(database, options = {}) {
    this.database = database;
    this.options = {
      cacheSize: 50,
      cacheTTL: 300000, // 5 minutes
      slowQueryThreshold: 100, // ms
      warmupDelay: 2000, // ms
      warmupInterval: 600000, // 10 minutes
      ...options
    };

    // Core performance components
    this.queryCache = new QueryCache(this.options.cacheSize, this.options.cacheTTL);
    this.performanceMonitor = new QueryPerformanceMonitor();
    this.performanceMonitor.slowQueryThreshold = this.options.slowQueryThreshold;
    
    // Cache warming and invalidation
    this.cacheWarmer = null;
    this.invalidationMap = new Map();
    this.statementPool = new Map();
    
    // Performance metrics
    this.metrics = {
      crossModuleCallCount: 0,
      cacheInvalidationCount: 0,
      statementReuseCount: 0,
      warmupCycles: 0
    };

    this.initializeInvalidationMap();
  }

  /**
   * Initialize cache invalidation patterns for different operation types
   */
  initializeInvalidationMap() {
    this.invalidationMap.set('video_crud', [
      'getVideos', 'getAllVideos', 'getVideosWithMetadata', 'getFolders', 'getStats'
    ]);
    
    this.invalidationMap.set('favorites', [
      'getVideos', 'getAllVideos', 'getVideosWithMetadata', 'getFavoriteIds', 'getStats'
    ]);
    
    this.invalidationMap.set('ratings', [
      'getVideos', 'getAllVideos', 'getVideosWithMetadata', 'getRatedVideos', 'getStats'
    ]);
    
    this.invalidationMap.set('tags', [
      'getVideos', 'getAllVideos', 'getVideosWithMetadata', 'getAllTags', 'searchByTag'
    ]);
    
    this.invalidationMap.set('settings', [
      // Settings typically don't affect cached queries
    ]);
    
    this.invalidationMap.set('hidden_files', [
      'getVideos', 'getAllVideos', 'getVideosWithMetadata', 'getHiddenFiles'
    ]);
  }

  /**
   * Initialize cache warmer after database is ready
   */
  initializeCacheWarmer() {
    if (!this.database) {
      console.warn('Cannot initialize cache warmer: database reference missing');
      return;
    }

    try {
      this.cacheWarmer = new DatabaseCacheWarmer(this.database, this);
      
      // Schedule initial warming with delay
      setTimeout(() => {
        this.cacheWarmer?.warmCommonQueries();
        this.metrics.warmupCycles++;
      }, this.options.warmupDelay);
      
      // Schedule periodic warming
      this.cacheWarmer?.schedulePeriodicWarming(this.options.warmupInterval);
      
      console.log('DatabasePerformanceManager: Cache warmer initialized');
    } catch (error) {
      console.error('Error initializing cache warmer:', error);
    }
  }

  /**
   * Wrap a database query with performance monitoring and caching
   * @param {string} queryName - Unique identifier for the query
   * @param {Function} queryFunction - The actual query function
   * @param {Object} cacheOptions - Caching configuration
   * @returns {Function} Wrapped query function
   */
  wrapQuery(queryName, queryFunction, cacheOptions = {}) {
    const { 
      useCache = true, 
      cacheKeyGenerator = null,
      invalidatePatterns = []
    } = cacheOptions;

    return (...args) => {
      // Generate cache key
      let cacheKey = null;
      if (useCache) {
        cacheKey = cacheKeyGenerator ? 
          cacheKeyGenerator(queryName, args) : 
          this.generateDefaultCacheKey(queryName, args);
        
        // Check cache first
        const cached = this.queryCache.get(cacheKey, args);
        if (cached) {
          return cached;
        }
      }

      // Wrap with performance monitoring
      const monitoredQuery = this.performanceMonitor.wrapQuery(queryName, queryFunction);
      
      try {
        const result = monitoredQuery.apply(this, args);
        
        // Cache the result if caching is enabled
        if (useCache && cacheKey) {
          this.queryCache.set(cacheKey, args, result);
        }
        
        return result;
      } catch (error) {
        // Log error but don't cache failed results
        console.error(`Query ${queryName} failed:`, error);
        throw error;
      }
    };
  }

  /**
   * Wrap an async database query with performance monitoring and caching
   */
  wrapAsyncQuery(queryName, queryFunction, cacheOptions = {}) {
    const { 
      useCache = true, 
      cacheKeyGenerator = null
    } = cacheOptions;

    return async (...args) => {
      // Generate cache key
      let cacheKey = null;
      if (useCache) {
        cacheKey = cacheKeyGenerator ? 
          cacheKeyGenerator(queryName, args) : 
          this.generateDefaultCacheKey(queryName, args);
        
        // Check cache first
        const cached = this.queryCache.get(cacheKey, args);
        if (cached) {
          return cached;
        }
      }

      // Wrap with performance monitoring
      const monitoredQuery = this.performanceMonitor.wrapAsyncQuery(queryName, queryFunction);
      
      try {
        const result = await monitoredQuery.apply(this, args);
        
        // Cache the result if caching is enabled
        if (useCache && cacheKey) {
          this.queryCache.set(cacheKey, args, result);
        }
        
        return result;
      } catch (error) {
        console.error(`Async query ${queryName} failed:`, error);
        throw error;
      }
    };
  }

  /**
   * Generate a default cache key from query name and arguments
   */
  generateDefaultCacheKey(queryName, args) {
    // Simple but effective key generation
    const argsKey = args.length > 0 ? 
      JSON.stringify(args).substring(0, 200) : // Limit key length
      '';
    return `${queryName}:${argsKey}`;
  }

  /**
   * Invalidate cache entries based on operation type
   * @param {string} operationType - Type of operation that occurred
   * @param {Array} additionalPatterns - Additional cache patterns to invalidate
   */
  invalidateByOperation(operationType, additionalPatterns = []) {
    const patterns = this.invalidationMap.get(operationType) || [];
    const allPatterns = [...patterns, ...additionalPatterns];
    
    let totalInvalidated = 0;
    allPatterns.forEach(pattern => {
      const invalidated = this.queryCache.invalidate(pattern);
      totalInvalidated += invalidated;
    });
    
    this.metrics.cacheInvalidationCount += totalInvalidated;
    
    if (totalInvalidated > 0) {
      console.debug(`Invalidated ${totalInvalidated} cache entries for operation: ${operationType}`);
    }
    
    return totalInvalidated;
  }

  /**
   * Get or create a prepared statement (shared across modules)
   * @param {string} statementName - Unique name for the statement
   * @param {string} sql - SQL query string
   * @param {Object} database - Database instance
   * @returns {Object} Prepared statement
   */
  getSharedStatement(statementName, sql, database) {
    if (!this.statementPool.has(statementName)) {
      try {
        const statement = database.prepare(sql);
        this.statementPool.set(statementName, statement);
      } catch (error) {
        console.error(`Error preparing statement ${statementName}:`, error);
        throw error;
      }
    }
    
    this.metrics.statementReuseCount++;
    return this.statementPool.get(statementName);
  }

  /**
   * Record cross-module call for performance tracking
   */
  recordCrossModuleCall(fromModule, toModule, operation) {
    this.metrics.crossModuleCallCount++;
    
    // Could be extended to track specific module interactions
    console.debug(`Cross-module call: ${fromModule} -> ${toModule}.${operation}`);
  }

  /**
   * Get comprehensive performance statistics
   */
  getPerformanceStats() {
    const cacheStats = this.queryCache.getStats();
    const monitorStats = this.performanceMonitor.getSummaryStats();
    const report = this.performanceMonitor.generateReport();

    return {
      cache: cacheStats,
      performance: monitorStats,
      recommendations: report.recommendations,
      slowQueries: report.slowQueries.slice(0, 5),
      metrics: {
        ...this.metrics,
        statementPoolSize: this.statementPool.size,
        cacheEfficiency: cacheStats.hitRate
      }
    };
  }

  /**
   * Generate performance optimization recommendations
   */
  generateOptimizationRecommendations() {
    const stats = this.getPerformanceStats();
    const recommendations = [];

    // Cache efficiency recommendations
    if (stats.cache.hitRate < 40) {
      recommendations.push({
        type: 'cache_tuning',
        priority: 'high',
        suggestion: `Cache hit rate is low (${stats.cache.hitRate.toFixed(1)}%). Consider increasing cache size or adjusting TTL.`
      });
    }

    // Cross-module call optimization
    if (this.metrics.crossModuleCallCount > 1000) {
      recommendations.push({
        type: 'module_optimization',
        priority: 'medium',
        suggestion: `High number of cross-module calls (${this.metrics.crossModuleCallCount}). Consider consolidating related operations.`
      });
    }

    // Statement pool efficiency
    if (this.statementPool.size > 50) {
      recommendations.push({
        type: 'statement_pool',
        priority: 'low',
        suggestion: `Large statement pool (${this.statementPool.size} statements). Monitor for unused statements.`
      });
    }

    return recommendations;
  }

  /**
   * Reset performance metrics and clear caches
   */
  reset() {
    this.queryCache.clear();
    this.performanceMonitor.reset();
    this.statementPool.clear();
    
    this.metrics = {
      crossModuleCallCount: 0,
      cacheInvalidationCount: 0,
      statementReuseCount: 0,
      warmupCycles: 0
    };
    
    console.log('DatabasePerformanceManager: Reset completed');
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.cacheWarmer) {
      this.cacheWarmer.cleanup();
    }
    
    this.queryCache.clear();
    this.statementPool.clear();
    this.performanceMonitor.reset();
  }
}

/**
 * Enhanced cache warmer with module-aware warming strategies
 */
class DatabaseCacheWarmer {
  constructor(database, performanceManager) {
    this.database = database;
    this.performanceManager = performanceManager;
    this.warmingInProgress = false;
    this.warmingInterval = null;
  }

  async warmCommonQueries() {
    if (this.warmingInProgress) return;
    
    this.warmingInProgress = true;
    
    try {
      console.log('DatabasePerformanceManager: Starting cache warming...');
      
      const warmingStrategies = [
        this.warmVideoQueries.bind(this),
        this.warmMetadataQueries.bind(this),
        this.warmStatisticsQueries.bind(this)
      ];
      
      // Execute warming strategies with staggered timing
      for (let i = 0; i < warmingStrategies.length; i++) {
        setTimeout(async () => {
          try {
            await warmingStrategies[i]();
          } catch (error) {
            console.warn(`Cache warming strategy ${i} failed:`, error.message);
          }
        }, i * 200); // 200ms between strategies
      }
      
      console.log('DatabasePerformanceManager: Cache warming completed');
    } finally {
      setTimeout(() => {
        this.warmingInProgress = false;
      }, 1000);
    }
  }

  async warmVideoQueries() {
    if (!this.database.getVideos) return;
    
    const commonFilters = [
      {}, // All videos
      { sortBy: 'date' },
      { sortBy: 'name' },
      { favoritesOnly: true },
      { sortBy: 'size' }
    ];

    // Get top folders for targeted warming
    try {
      const folders = this.database.getFolders ? this.database.getFolders() : [];
      folders.slice(0, 3).forEach(folder => {
        commonFilters.push(
          { folder },
          { folder, sortBy: 'date' }
        );
      });
    } catch (error) {
      console.warn('Could not get folders for cache warming:', error.message);
    }

    for (const filter of commonFilters) {
      try {
        this.database.getVideos(filter);
      } catch (error) {
        // Ignore warming errors
      }
    }
  }

  async warmMetadataQueries() {
    try {
      if (this.database.getStats) {
        this.database.getStats();
      }
      if (this.database.getFolders) {
        this.database.getFolders();
      }
      if (this.database.getAllTags) {
        this.database.getAllTags();
      }
    } catch (error) {
      // Ignore warming errors
    }
  }

  async warmStatisticsQueries() {
    try {
      if (this.database.getFavoriteIds) {
        this.database.getFavoriteIds();
      }
      if (this.database.getRatedVideos) {
        this.database.getRatedVideos();
      }
    } catch (error) {
      // Ignore warming errors
    }
  }

  schedulePeriodicWarming(intervalMs = 600000) {
    if (this.warmingInterval) {
      clearInterval(this.warmingInterval);
    }
    
    this.warmingInterval = setInterval(() => {
      this.warmCommonQueries();
      this.performanceManager.metrics.warmupCycles++;
    }, intervalMs);
  }

  cleanup() {
    if (this.warmingInterval) {
      clearInterval(this.warmingInterval);
      this.warmingInterval = null;
    }
  }
}

module.exports = {
  DatabasePerformanceManager,
  DatabaseCacheWarmer
};