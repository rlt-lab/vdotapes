/**
 * Database Query Caching System
 * Provides intelligent caching for frequently accessed database queries
 */

class QueryCache {
  constructor(maxSize = 100, ttl = 300000) { // 5 minutes TTL
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.accessTimes = new Map();
    this.hitCount = 0;
    this.missCount = 0;
  }

  generateKey(query, params) {
    // Create a deterministic key from query and parameters
    const paramStr = Array.isArray(params) ? params.join('|') : String(params || '');
    return `${query}:${paramStr}`;
  }

  get(query, params) {
    const key = this.generateKey(query, params);
    const cached = this.cache.get(key);
    
    if (!cached) {
      this.missCount++;
      return null;
    }
    
    // Check TTL
    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(key);
      this.accessTimes.delete(key);
      this.missCount++;
      return null;
    }
    
    // Update access time for LRU
    this.accessTimes.set(key, Date.now());
    this.hitCount++;
    return this.deepClone(cached.data);
  }

  set(query, params, data) {
    const key = this.generateKey(query, params);
    
    // Implement LRU eviction if cache is full
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
    const keysToDelete = [];
    
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => {
      this.cache.delete(key);
      this.accessTimes.delete(key);
    });
    
    return keysToDelete.length;
  }

  clear() {
    this.cache.clear();
    this.accessTimes.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  getStats() {
    const totalRequests = this.hitCount + this.missCount;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: totalRequests > 0 ? (this.hitCount / totalRequests) * 100 : 0,
      hitCount: this.hitCount,
      missCount: this.missCount,
      totalRequests
    };
  }

  deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (Array.isArray(obj)) return obj.map(item => this.deepClone(item));
    
    const cloned = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this.deepClone(obj[key]);
      }
    }
    return cloned;
  }
}

class CacheWarmer {
  constructor(database) {
    this.database = database;
    this.warmingInProgress = false;
  }

  async warmCommonQueries() {
    if (this.warmingInProgress) return;
    
    this.warmingInProgress = true;
    
    try {
      console.log('Warming database cache...');
      
      // Common filter combinations to pre-load
      const commonFilters = [
        {}, // All videos
        { sortBy: 'date' }, // Recent videos
        { favoritesOnly: true }, // Favorites
        { sortBy: 'name' }, // Alphabetical
        { sortBy: 'size' } // By size
      ];

      // Get top folders and warm them too
      const folders = await this.database.getFolders();
      folders.slice(0, 5).forEach(folder => {
        commonFilters.push({ folder }); // Top folders
        commonFilters.push({ folder, sortBy: 'date' }); // Recent in folder
      });

      // Warm cache with staggered requests to avoid blocking
      for (let i = 0; i < commonFilters.length; i++) {
        setTimeout(async () => {
          try {
            await this.database.getVideos(commonFilters[i]);
          } catch (error) {
            // Ignore errors during cache warming
            console.warn('Cache warming error:', error.message);
          }
        }, i * 100); // 100ms between requests
      }
      
      console.log('Cache warming completed');
    } finally {
      this.warmingInProgress = false;
    }
  }

  schedulePeriodicWarming(intervalMs = 600000) { // 10 minutes
    setInterval(() => {
      this.warmCommonQueries();
    }, intervalMs);
  }
}

module.exports = { QueryCache, CacheWarmer };