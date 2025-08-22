#!/usr/bin/env node

/**
 * Standalone test for VDOTapes optimizations
 * Tests functionality without Electron dependency issues
 */

const fs = require('fs');
const path = require('path');

class StandaloneOptimizationTest {
  constructor() {
    this.results = {
      virtualization: {},
      lifecycle: {},
      database: {},
      overall: {}
    };
  }

  async runTests() {
    console.log('🧪 Standalone Optimization Test');
    console.log('================================\n');

    try {
      // Test 1: Virtual Grid Logic
      await this.testVirtualizationLogic();
      
      // Test 2: Lifecycle Manager Logic
      await this.testLifecycleLogic();
      
      // Test 3: Database Module Standalone
      await this.testDatabaseStandalone();
      
      // Test 4: Query Cache Performance
      await this.testQueryCachePerformance();
      
      // Test 5: Performance Monitor
      await this.testPerformanceMonitor();
      
      this.generateReport();
      
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      console.error(error.stack);
    }
  }

  async testVirtualizationLogic() {
    console.log('🖼️  Testing Virtual Grid Logic...');
    
    try {
      // Create a mock DOM environment
      const mockContainer = {
        clientHeight: 800,
        scrollTop: 0,
        children: [],
        appendChild: () => {},
        removeChild: () => {},
        addEventListener: () => {},
        removeEventListener: () => {}
      };

      // Test virtual grid calculations
      const VirtualizedVideoGrid = require('./app/video-virtualization.js');
      const virtualGrid = new VirtualizedVideoGrid(mockContainer, {
        itemHeight: 300,
        itemsPerRow: 4,
        buffer: 2
      });

      // Test visible range calculation
      const visibleRange = virtualGrid.calculateVisibleRange(100); // 100 total items
      
      this.results.virtualization = {
        visibleRangeStart: visibleRange.start,
        visibleRangeEnd: visibleRange.end,
        visibleItems: visibleRange.end - visibleRange.start,
        maxExpectedItems: 20, // Should virtualize to ~20 items max
        passed: (visibleRange.end - visibleRange.start) <= 20
      };

      console.log(`  ✅ Visible range: ${visibleRange.start}-${visibleRange.end} (${visibleRange.end - visibleRange.start} items)`);
      console.log(`  ✅ Virtualization working: ${this.results.virtualization.passed ? 'YES' : 'NO'}`);
      
    } catch (error) {
      console.log(`  ❌ Virtualization test failed: ${error.message}`);
      this.results.virtualization.passed = false;
      this.results.virtualization.error = error.message;
    }
    
    console.log();
  }

  async testLifecycleLogic() {
    console.log('♻️  Testing Video Lifecycle Logic...');
    
    try {
      const VideoLifecycleManager = require('./app/video-lifecycle.js');
      const lifecycleManager = new VideoLifecycleManager({
        maxActiveVideos: 5,
        cleanupInterval: 1000
      });

      // Test adding videos
      for (let i = 0; i < 10; i++) {
        const mockVideo = {
          id: `video-${i}`,
          src: `test://video-${i}.mp4`,
          addEventListener: () => {},
          removeEventListener: () => {},
          pause: () => {},
          remove: () => {}
        };
        
        lifecycleManager.registerVideo(`video-${i}`, mockVideo);
      }

      // Test cleanup
      const beforeCleanup = lifecycleManager.activeVideos.size;
      lifecycleManager.performCleanup();
      const afterCleanup = lifecycleManager.activeVideos.size;

      this.results.lifecycle = {
        videosBeforeCleanup: beforeCleanup,
        videosAfterCleanup: afterCleanup,
        maxAllowed: 5,
        cleanupWorked: afterCleanup <= 5,
        passed: afterCleanup <= 5 && beforeCleanup > afterCleanup
      };

      console.log(`  ✅ Videos before cleanup: ${beforeCleanup}`);
      console.log(`  ✅ Videos after cleanup: ${afterCleanup}`);
      console.log(`  ✅ Lifecycle management working: ${this.results.lifecycle.passed ? 'YES' : 'NO'}`);
      
    } catch (error) {
      console.log(`  ❌ Lifecycle test failed: ${error.message}`);
      this.results.lifecycle.passed = false;
      this.results.lifecycle.error = error.message;
    }
    
    console.log();
  }

  async testDatabaseStandalone() {
    console.log('🗄️  Testing Database Module (Standalone)...');
    
    try {
      // Create temporary database for testing
      const Database = require('better-sqlite3');
      const tmpDbPath = path.join(__dirname, 'test.db');
      
      // Clean up any existing test database
      if (fs.existsSync(tmpDbPath)) {
        fs.unlinkSync(tmpDbPath);
      }

      const db = new Database(tmpDbPath);
      
      // Test database creation and performance
      const startTime = Date.now();
      
      // Create test table with indexes
      db.exec(`
        CREATE TABLE test_videos (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          folder TEXT,
          size INTEGER,
          last_modified INTEGER
        )
      `);
      
      // Create indexes
      db.exec(`
        CREATE INDEX idx_test_folder ON test_videos (folder);
        CREATE INDEX idx_test_name ON test_videos (name);
        CREATE INDEX idx_test_modified ON test_videos (last_modified);
      `);
      
      const indexTime = Date.now() - startTime;
      
      // Test bulk insert performance
      const insertStart = Date.now();
      const insert = db.prepare(`
        INSERT INTO test_videos (id, name, folder, size, last_modified)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      const transaction = db.transaction((videos) => {
        for (const video of videos) {
          insert.run(video.id, video.name, video.folder, video.size, video.lastModified);
        }
      });
      
      const testVideos = this.generateMockVideos(1000);
      transaction(testVideos);
      
      const insertTime = Date.now() - insertStart;
      
      // Test query performance
      const queryStart = Date.now();
      const query = db.prepare('SELECT * FROM test_videos WHERE folder = ?');
      const results = query.all('Movies');
      const queryTime = Date.now() - queryStart;
      
      // Test index usage with EXPLAIN QUERY PLAN
      const explainResult = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM test_videos WHERE folder = ?').all('Movies');
      const usesIndex = explainResult.some(row => row.detail.includes('idx_test_folder'));
      
      db.close();
      fs.unlinkSync(tmpDbPath);
      
      this.results.database = {
        indexCreationTime: indexTime,
        insertTime,
        queryTime,
        resultCount: results.length,
        usesIndex,
        passed: queryTime < 50 && usesIndex // Query should be under 50ms and use index
      };

      console.log(`  ✅ Index creation: ${indexTime}ms`);
      console.log(`  ✅ Insert 1000 videos: ${insertTime}ms`);
      console.log(`  ✅ Query time: ${queryTime}ms`);
      console.log(`  ✅ Uses index: ${usesIndex ? 'YES' : 'NO'}`);
      console.log(`  ✅ Database performance: ${this.results.database.passed ? 'GOOD' : 'NEEDS_IMPROVEMENT'}`);
      
    } catch (error) {
      console.log(`  ❌ Database test failed: ${error.message}`);
      this.results.database.passed = false;
      this.results.database.error = error.message;
    }
    
    console.log();
  }

  async testQueryCachePerformance() {
    console.log('📦 Testing Query Cache Performance...');
    
    try {
      const { QueryCache } = require('./src/query-cache.js');
      const cache = new QueryCache(10, 60000); // 10 items, 1 minute TTL
      
      // Test cache operations
      const testKey = 'test-query';
      const testFilters = { folder: 'Movies' };
      const testData = this.generateMockVideos(50);
      
      // Test cache miss
      const missStart = Date.now();
      const missResult = cache.get(testKey, testFilters);
      const missTime = Date.now() - missStart;
      
      // Set cache
      cache.set(testKey, testFilters, testData);
      
      // Test cache hit
      const hitStart = Date.now();
      const hitResult = cache.get(testKey, testFilters);
      const hitTime = Date.now() - hitStart;
      
      // Test cache statistics
      const stats = cache.getStats();
      
      this.results.cache = {
        missTime,
        hitTime,
        hitResult: hitResult ? hitResult.length : 0,
        expectedResult: testData.length,
        hitRate: stats.hitRate,
        passed: hitTime < missTime && hitResult && hitResult.length === testData.length
      };

      console.log(`  ✅ Cache miss time: ${missTime}ms`);
      console.log(`  ✅ Cache hit time: ${hitTime}ms`);
      console.log(`  ✅ Hit rate: ${stats.hitRate.toFixed(1)}%`);
      console.log(`  ✅ Cache working: ${this.results.cache.passed ? 'YES' : 'NO'}`);
      
    } catch (error) {
      console.log(`  ❌ Cache test failed: ${error.message}`);
      this.results.cache = { passed: false, error: error.message };
    }
    
    console.log();
  }

  async testPerformanceMonitor() {
    console.log('📊 Testing Performance Monitor...');
    
    try {
      const QueryPerformanceMonitor = require('./src/performance-monitor.js');
      const monitor = new QueryPerformanceMonitor();
      
      // Test monitoring a query
      const testQuery = monitor.wrapQuery('test-query', () => {
        // Simulate some work
        const start = Date.now();
        while (Date.now() - start < 10) {} // 10ms of work
        return { result: 'test' };
      });
      
      // Run the query multiple times
      for (let i = 0; i < 5; i++) {
        testQuery();
      }
      
      // Get performance stats
      const stats = monitor.getSummaryStats();
      const report = monitor.generateReport();
      
      this.results.performanceMonitor = {
        totalQueries: stats.totalQueries,
        avgQueryTime: stats.avgQueryTime,
        recommendations: report.recommendations.length,
        passed: stats.totalQueries === 5 && stats.avgQueryTime > 0
      };

      console.log(`  ✅ Total queries monitored: ${stats.totalQueries}`);
      console.log(`  ✅ Average query time: ${stats.avgQueryTime.toFixed(1)}ms`);
      console.log(`  ✅ Recommendations: ${report.recommendations.length}`);
      console.log(`  ✅ Performance monitoring: ${this.results.performanceMonitor.passed ? 'WORKING' : 'FAILED'}`);
      
    } catch (error) {
      console.log(`  ❌ Performance monitor test failed: ${error.message}`);
      this.results.performanceMonitor = { passed: false, error: error.message };
    }
    
    console.log();
  }

  generateMockVideos(count) {
    const folders = ['Movies', 'TV Shows', 'Documentaries'];
    const videos = [];
    
    for (let i = 0; i < count; i++) {
      videos.push({
        id: `test-video-${i}`,
        name: `Test Video ${i}.mp4`,
        folder: folders[i % folders.length],
        size: Math.floor(Math.random() * 1000000000),
        lastModified: Date.now() - Math.floor(Math.random() * 365 * 24 * 60 * 60 * 1000)
      });
    }
    
    return videos;
  }

  generateReport() {
    console.log('📋 Standalone Test Results');
    console.log('===========================\n');
    
    const tests = [
      { name: 'Virtual Grid Logic', result: this.results.virtualization },
      { name: 'Video Lifecycle', result: this.results.lifecycle },
      { name: 'Database Performance', result: this.results.database },
      { name: 'Query Cache', result: this.results.cache },
      { name: 'Performance Monitor', result: this.results.performanceMonitor }
    ];
    
    let passedTests = 0;
    
    tests.forEach(test => {
      const status = test.result.passed ? '✅ PASSED' : '❌ FAILED';
      console.log(`${test.name}: ${status}`);
      if (test.result.error) {
        console.log(`  Error: ${test.result.error}`);
      }
      if (test.result.passed) passedTests++;
    });
    
    console.log(`\n🎯 Overall: ${passedTests}/${tests.length} tests passed`);
    
    if (passedTests === tests.length) {
      console.log('🎉 All optimizations are working correctly!');
    } else {
      console.log('⚠️  Some optimizations need attention');
    }
    
    // Save results
    fs.writeFileSync(
      path.join(__dirname, 'standalone-test-results.json'),
      JSON.stringify(this.results, null, 2)
    );
    
    console.log('\n📄 Results saved to standalone-test-results.json');
  }
}

// Run if executed directly
if (require.main === module) {
  const tester = new StandaloneOptimizationTest();
  tester.runTests().catch(console.error);
}

module.exports = StandaloneOptimizationTest;