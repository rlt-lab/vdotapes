#!/usr/bin/env node

/**
 * Performance Benchmark Suite for VideoDatabase
 * Measures current monolithic implementation performance
 */

const { performance } = require('perf_hooks');
const path = require('path');

// Import VideoDatabase (adjust path as needed)
const VideoDatabase = require('./src/database.ts');

class DatabaseBenchmark {
  constructor() {
    this.db = new VideoDatabase();
    this.testData = this.generateTestData();
    this.results = {};
  }

  async initialize() {
    console.log('Initializing database for benchmarking...');
    await this.db.initialize();
    console.log('Database initialized successfully');
  }

  generateTestData() {
    const testVideos = [];
    const folders = ['Movies', 'TV Shows', 'Documentaries', 'Music Videos', 'Home Videos'];
    
    // Generate 1000 test videos
    for (let i = 0; i < 1000; i++) {
      testVideos.push({
        id: `video_${i}`,
        name: `Test Video ${i}`,
        path: `/test/path/video_${i}.mp4`,
        folder: folders[i % folders.length],
        size: Math.floor(Math.random() * 1000000000), // Up to 1GB
        lastModified: Date.now() - Math.floor(Math.random() * 365 * 24 * 60 * 60 * 1000), // Last year
        created: Date.now() - Math.floor(Math.random() * 365 * 24 * 60 * 60 * 1000)
      });
    }
    
    return testVideos;
  }

  async setupTestData() {
    console.log('Setting up test data (1000 videos)...');
    const start = performance.now();
    
    // Batch insert for realistic performance
    const success = this.db.addVideos(this.testData);
    
    const duration = performance.now() - start;
    console.log(`Test data setup completed in ${duration.toFixed(2)}ms`);
    
    // Add some favorites and ratings for realistic testing
    for (let i = 0; i < 100; i++) {
      this.db.addFavorite(`video_${i}`);
      if (i < 50) {
        this.db.saveRating(`video_${i}`, Math.floor(Math.random() * 5) + 1);
      }
    }
    
    return success;
  }

  async benchmarkOperation(name, operation, iterations = 100) {
    console.log(`\nBenchmarking ${name}...`);
    
    const times = [];
    const warmupRuns = 10;
    
    // Warmup runs
    for (let i = 0; i < warmupRuns; i++) {
      await operation();
    }
    
    // Actual benchmark runs
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const result = await operation();
      const end = performance.now();
      times.push(end - start);
    }
    
    const stats = this.calculateStats(times);
    this.results[name] = stats;
    
    console.log(`  Average: ${stats.avg.toFixed(2)}ms`);
    console.log(`  Median: ${stats.median.toFixed(2)}ms`);
    console.log(`  Min: ${stats.min.toFixed(2)}ms`);
    console.log(`  Max: ${stats.max.toFixed(2)}ms`);
    console.log(`  95th percentile: ${stats.p95.toFixed(2)}ms`);
    
    return stats;
  }

  calculateStats(times) {
    const sorted = [...times].sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    
    return {
      avg: sum / times.length,
      median: sorted[Math.floor(sorted.length / 2)],
      min: Math.min(...times),
      max: Math.max(...times),
      p95: sorted[Math.floor(sorted.length * 0.95)],
      count: times.length,
      total: sum
    };
  }

  async runBenchmarks() {
    console.log('\n=== VideoDatabase Performance Benchmark ===\n');
    
    // Core query operations
    await this.benchmarkOperation('getVideos (no filters)', () => {
      return this.db.getVideos();
    }, 50);

    await this.benchmarkOperation('getVideos (with folder filter)', () => {
      return this.db.getVideos({ folder: 'Movies' });
    }, 100);

    await this.benchmarkOperation('getVideos (favorites only)', () => {
      return this.db.getVideos({ favoritesOnly: true });
    }, 100);

    await this.benchmarkOperation('getVideos (sorted by date)', () => {
      return this.db.getVideos({ sortBy: 'date' });
    }, 100);

    await this.benchmarkOperation('getVideos (with search)', () => {
      return this.db.getVideos({ search: 'Video 1' });
    }, 100);

    // Individual operations
    await this.benchmarkOperation('getVideoById', () => {
      const randomId = `video_${Math.floor(Math.random() * 1000)}`;
      return this.db.getVideoById(randomId);
    }, 200);

    await this.benchmarkOperation('toggleFavorite', () => {
      const randomId = `video_${Math.floor(Math.random() * 1000)}`;
      return this.db.toggleFavorite(randomId);
    }, 200);

    await this.benchmarkOperation('saveRating', () => {
      const randomId = `video_${Math.floor(Math.random() * 1000)}`;
      const rating = Math.floor(Math.random() * 5) + 1;
      return this.db.saveRating(randomId, rating);
    }, 200);

    await this.benchmarkOperation('getFolders', () => {
      return this.db.getFolders();
    }, 100);

    await this.benchmarkOperation('getStats', () => {
      return this.db.getStats();
    }, 50);

    // Tag operations
    await this.benchmarkOperation('addTag', () => {
      const randomId = `video_${Math.floor(Math.random() * 1000)}`;
      const tagName = `tag_${Math.floor(Math.random() * 20)}`;
      return this.db.addTag(randomId, tagName);
    }, 100);

    // Cache performance
    console.log('\n=== Cache Performance Test ===');
    
    // Cold cache
    this.db.queryCache.clear();
    await this.benchmarkOperation('getVideos (cold cache)', () => {
      return this.db.getVideos({ folder: 'Movies' });
    }, 10);

    // Warm cache (same query)
    await this.benchmarkOperation('getVideos (warm cache)', () => {
      return this.db.getVideos({ folder: 'Movies' });
    }, 100);
  }

  generateReport() {
    console.log('\n\n=== PERFORMANCE BENCHMARK REPORT ===\n');
    
    const report = {
      timestamp: new Date().toISOString(),
      totalOperations: Object.keys(this.results).length,
      summary: {},
      operations: this.results,
      cacheStats: this.db.queryCache.getStats(),
      performanceStats: this.db.performanceMonitor ? this.db.performanceMonitor.getSummaryStats() : null
    };

    // Calculate summary statistics
    let totalAvgTime = 0;
    let totalOperations = 0;
    let slowestOperation = { name: '', time: 0 };
    let fastestOperation = { name: '', time: Infinity };

    for (const [name, stats] of Object.entries(this.results)) {
      totalAvgTime += stats.avg * stats.count;
      totalOperations += stats.count;
      
      if (stats.avg > slowestOperation.time) {
        slowestOperation = { name, time: stats.avg };
      }
      if (stats.avg < fastestOperation.time) {
        fastestOperation = { name, time: stats.avg };
      }
    }

    report.summary = {
      overallAvgTime: totalAvgTime / totalOperations,
      totalOperations,
      slowestOperation,
      fastestOperation,
      cacheHitRate: report.cacheStats.hitRate
    };

    console.log('SUMMARY:');
    console.log(`  Total operations tested: ${totalOperations}`);
    console.log(`  Overall average time: ${report.summary.overallAvgTime.toFixed(2)}ms`);
    console.log(`  Slowest operation: ${slowestOperation.name} (${slowestOperation.time.toFixed(2)}ms)`);
    console.log(`  Fastest operation: ${fastestOperation.name} (${fastestOperation.time.toFixed(2)}ms)`);
    console.log(`  Cache hit rate: ${report.cacheStats.hitRate.toFixed(1)}%`);

    // Identify potential issues
    console.log('\nPERFORMANCE ANALYSIS:');
    
    const slowOperations = Object.entries(this.results)
      .filter(([name, stats]) => stats.avg > 50) // Operations over 50ms
      .sort(([,a], [,b]) => b.avg - a.avg);

    if (slowOperations.length > 0) {
      console.log('  Slow operations (>50ms):');
      slowOperations.forEach(([name, stats]) => {
        console.log(`    ${name}: ${stats.avg.toFixed(2)}ms avg (${stats.p95.toFixed(2)}ms p95)`);
      });
    }

    const cacheEffectiveness = this.calculateCacheEffectiveness();
    console.log(`  Cache effectiveness: ${cacheEffectiveness}`);

    return report;
  }

  calculateCacheEffectiveness() {
    const stats = this.db.queryCache.getStats();
    if (stats.totalRequests === 0) return 'No cache usage detected';
    
    if (stats.hitRate > 80) return 'Excellent (>80% hit rate)';
    if (stats.hitRate > 60) return 'Good (60-80% hit rate)';
    if (stats.hitRate > 40) return 'Fair (40-60% hit rate)';
    return 'Poor (<40% hit rate)';
  }

  async cleanup() {
    console.log('\nCleaning up benchmark data...');
    
    // Clean up test data
    try {
      this.db.close();
      console.log('Database connection closed');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  async run() {
    try {
      await this.initialize();
      await this.setupTestData();
      await this.runBenchmarks();
      
      const report = this.generateReport();
      
      // Save report to file
      const fs = require('fs');
      const reportPath = path.join(__dirname, `benchmark-report-${Date.now()}.json`);
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\nDetailed report saved to: ${reportPath}`);
      
      return report;
    } catch (error) {
      console.error('Benchmark failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

// Run benchmark if executed directly
if (require.main === module) {
  const benchmark = new DatabaseBenchmark();
  benchmark.run()
    .then(() => {
      console.log('\nBenchmark completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Benchmark failed:', error);
      process.exit(1);
    });
}

module.exports = DatabaseBenchmark;