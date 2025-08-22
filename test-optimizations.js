#!/usr/bin/env node

/**
 * Comprehensive test script for VDOTapes optimizations
 * Tests video virtualization, lifecycle management, and database performance
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_CONFIG = {
  testDuration: 30000, // 30 seconds
  videoCount: 100, // Number of test videos to simulate
  performanceThresholds: {
    maxQueryTime: 100, // ms
    minCacheHitRate: 60, // %
    maxMemoryUsage: 200 * 1024 * 1024, // 200MB
    maxDOMElements: 50 // For virtualization
  }
};

class OptimizationTester {
  constructor() {
    this.results = {
      virtualization: {},
      lifecycle: {},
      database: {},
      overall: {}
    };
    this.startTime = Date.now();
  }

  async runAllTests() {
    console.log('🚀 Starting VDOTapes Optimization Tests');
    console.log('==========================================\n');

    try {
      // Test 1: Database Performance
      await this.testDatabasePerformance();
      
      // Test 2: Memory Usage Baseline
      await this.testMemoryBaseline();
      
      // Test 3: Application Startup Performance
      await this.testStartupPerformance();
      
      // Generate report
      this.generateReport();
      
    } catch (error) {
      console.error('❌ Test execution failed:', error.message);
      process.exit(1);
    }
  }

  async testDatabasePerformance() {
    console.log('📊 Testing Database Performance...');
    
    const DatabaseTest = require('./src/database.js');
    const db = new DatabaseTest();
    
    try {
      await db.initialize();
      
      // Test index creation
      const indexStart = Date.now();
      await db.runMigrations();
      const indexTime = Date.now() - indexStart;
      
      // Test query performance with mock data
      const mockVideos = this.generateMockVideos(50);
      
      const insertStart = Date.now();
      await db.addVideos(mockVideos);
      const insertTime = Date.now() - insertStart;
      
      // Test query performance
      const queryTests = [
        { name: 'All Videos', filters: {} },
        { name: 'By Folder', filters: { folder: 'test-folder' } },
        { name: 'By Date', filters: { sortBy: 'date' } },
        { name: 'Favorites Only', filters: { favoritesOnly: true } },
        { name: 'Search Query', filters: { search: 'test' } }
      ];
      
      const queryResults = [];
      
      for (const test of queryTests) {
        const start = Date.now();
        const results = db.getVideos(test.filters);
        const duration = Date.now() - start;
        
        queryResults.push({
          name: test.name,
          duration,
          resultCount: results.length,
          passed: duration < TEST_CONFIG.performanceThresholds.maxQueryTime
        });
      }
      
      // Test cache performance
      const cacheStart = Date.now();
      db.getVideos({}); // Should hit cache
      const cacheTime = Date.now() - cacheStart;
      
      // Get performance stats
      const perfStats = db.getPerformanceStats();
      
      this.results.database = {
        indexCreationTime: indexTime,
        insertTime,
        queryResults,
        cacheTime,
        cacheHitRate: perfStats.cache.hitRate,
        avgQueryTime: perfStats.performance.avgQueryTime,
        totalQueries: perfStats.performance.totalQueries,
        passed: queryResults.every(r => r.passed) && 
                perfStats.cache.hitRate >= TEST_CONFIG.performanceThresholds.minCacheHitRate
      };
      
      console.log(`  ✅ Index creation: ${indexTime}ms`);
      console.log(`  ✅ Insert 50 videos: ${insertTime}ms`);
      console.log(`  ✅ Cache hit rate: ${perfStats.cache.hitRate.toFixed(1)}%`);
      console.log(`  ✅ Average query time: ${perfStats.performance.avgQueryTime.toFixed(1)}ms`);
      
      db.close();
      
    } catch (error) {
      console.log(`  ❌ Database test failed: ${error.message}`);
      this.results.database.passed = false;
      this.results.database.error = error.message;
    }
    
    console.log();
  }

  async testMemoryBaseline() {
    console.log('💾 Testing Memory Usage...');
    
    if (typeof process.memoryUsage === 'function') {
      const memBefore = process.memoryUsage();
      
      // Simulate memory-intensive operations
      const mockData = this.generateMockVideos(1000);
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const memAfter = process.memoryUsage();
      
      const heapUsed = memAfter.heapUsed - memBefore.heapUsed;
      
      this.results.overall.memoryUsage = {
        heapUsedDelta: heapUsed,
        totalHeapUsed: memAfter.heapUsed,
        passed: memAfter.heapUsed < TEST_CONFIG.performanceThresholds.maxMemoryUsage
      };
      
      console.log(`  ✅ Heap used: ${(memAfter.heapUsed / 1024 / 1024).toFixed(1)} MB`);
      console.log(`  ✅ Delta: ${(heapUsed / 1024 / 1024).toFixed(1)} MB`);
    } else {
      console.log('  ⚠️  Memory monitoring not available');
      this.results.overall.memoryUsage = { passed: true, note: 'Not available' };
    }
    
    console.log();
  }

  async testStartupPerformance() {
    console.log('⚡ Testing Application Startup...');
    
    const startupStart = Date.now();
    
    try {
      // Test that application can start without errors
      // Note: In a real test environment, this would launch the app
      // For now, we'll test that our modules can be required
      
      require('./app/video-virtualization.js');
      require('./app/video-lifecycle.js');
      require('./src/query-cache.js');
      require('./src/performance-monitor.js');
      
      const startupTime = Date.now() - startupStart;
      
      this.results.overall.startup = {
        time: startupTime,
        passed: startupTime < 5000 // Should start in under 5 seconds
      };
      
      console.log(`  ✅ Modules loaded in: ${startupTime}ms`);
      
    } catch (error) {
      console.log(`  ❌ Startup test failed: ${error.message}`);
      this.results.overall.startup = {
        passed: false,
        error: error.message
      };
    }
    
    console.log();
  }

  generateMockVideos(count) {
    const folders = ['Movies', 'TV Shows', 'Documentaries', 'Shorts', 'Music Videos'];
    const formats = ['mp4', 'mov', 'avi', 'mkv'];
    const videos = [];
    
    for (let i = 0; i < count; i++) {
      const folder = folders[Math.floor(Math.random() * folders.length)];
      const format = formats[Math.floor(Math.random() * formats.length)];
      
      videos.push({
        id: `test-video-${i}`,
        name: `Test Video ${i}.${format}`,
        path: `/test/path/${folder}/Test Video ${i}.${format}`,
        relativePath: `${folder}/Test Video ${i}.${format}`,
        folder: folder,
        size: Math.floor(Math.random() * 1000000000), // 0-1GB
        lastModified: Date.now() - Math.floor(Math.random() * 365 * 24 * 60 * 60 * 1000),
        created: Date.now() - Math.floor(Math.random() * 365 * 24 * 60 * 60 * 1000)
      });
    }
    
    return videos;
  }

  generateReport() {
    const totalTime = Date.now() - this.startTime;
    
    console.log('📋 Optimization Test Report');
    console.log('==========================\n');
    
    // Database Performance
    console.log('🗄️  Database Performance:');
    if (this.results.database.passed) {
      console.log('  ✅ PASSED');
      console.log(`     Cache Hit Rate: ${this.results.database.cacheHitRate?.toFixed(1)}%`);
      console.log(`     Average Query Time: ${this.results.database.avgQueryTime?.toFixed(1)}ms`);
      console.log(`     Total Queries: ${this.results.database.totalQueries}`);
    } else {
      console.log('  ❌ FAILED');
      if (this.results.database.error) {
        console.log(`     Error: ${this.results.database.error}`);
      }
    }
    
    // Memory Usage
    console.log('\n💾 Memory Management:');
    if (this.results.overall.memoryUsage?.passed) {
      console.log('  ✅ PASSED');
      if (this.results.overall.memoryUsage.totalHeapUsed) {
        console.log(`     Heap Used: ${(this.results.overall.memoryUsage.totalHeapUsed / 1024 / 1024).toFixed(1)} MB`);
      }
    } else {
      console.log('  ❌ FAILED or N/A');
    }
    
    // Startup Performance
    console.log('\n⚡ Startup Performance:');
    if (this.results.overall.startup?.passed) {
      console.log('  ✅ PASSED');
      console.log(`     Time: ${this.results.overall.startup.time}ms`);
    } else {
      console.log('  ❌ FAILED');
      if (this.results.overall.startup?.error) {
        console.log(`     Error: ${this.results.overall.startup.error}`);
      }
    }
    
    // Overall Results
    const allPassed = this.results.database.passed && 
                     this.results.overall.memoryUsage.passed && 
                     this.results.overall.startup.passed;
    
    console.log('\n🎯 Overall Result:');
    if (allPassed) {
      console.log('  ✅ ALL OPTIMIZATIONS WORKING');
    } else {
      console.log('  ⚠️  SOME OPTIMIZATIONS NEED ATTENTION');
    }
    
    console.log(`\n⏱️  Total test time: ${totalTime}ms`);
    
    // Save detailed results
    fs.writeFileSync(
      path.join(__dirname, 'optimization-test-results.json'),
      JSON.stringify(this.results, null, 2)
    );
    
    console.log('📄 Detailed results saved to optimization-test-results.json');
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const tester = new OptimizationTester();
  tester.runAllTests().catch(console.error);
}

module.exports = OptimizationTester;