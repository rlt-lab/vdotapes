#!/usr/bin/env node

/**
 * Memory Profiling Script for VideoDatabase
 * Analyzes memory usage patterns of the monolithic implementation
 */

const { performance } = require('perf_hooks');

class MemoryProfiler {
  constructor() {
    this.snapshots = [];
    this.gcEnabled = false;
    
    // Enable manual GC if --expose-gc flag is used
    if (global.gc) {
      this.gcEnabled = true;
      console.log('Manual GC enabled for accurate memory measurements');
    } else {
      console.log('Run with --expose-gc flag for more accurate memory measurements');
    }
  }

  takeSnapshot(label) {
    // Force garbage collection if available
    if (this.gcEnabled && global.gc) {
      global.gc();
    }
    
    const memUsage = process.memoryUsage();
    const snapshot = {
      label,
      timestamp: Date.now(),
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers || 0
      }
    };
    
    this.snapshots.push(snapshot);
    
    console.log(`Memory snapshot [${label}]:`);
    console.log(`  RSS: ${this.formatBytes(memUsage.rss)}`);
    console.log(`  Heap Total: ${this.formatBytes(memUsage.heapTotal)}`);
    console.log(`  Heap Used: ${this.formatBytes(memUsage.heapUsed)}`);
    console.log(`  External: ${this.formatBytes(memUsage.external)}`);
    
    return snapshot;
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  calculateDifference(snapshot1, snapshot2) {
    const diff = {};
    for (const key in snapshot2.memory) {
      diff[key] = snapshot2.memory[key] - snapshot1.memory[key];
    }
    return diff;
  }

  async profileDatabaseOperations() {
    console.log('=== VideoDatabase Memory Profile ===\n');
    
    // Baseline measurement
    this.takeSnapshot('baseline');
    
    // Import and instantiate VideoDatabase
    console.log('\nLoading VideoDatabase module...');
    const VideoDatabase = require('./src/database.ts');
    this.takeSnapshot('module_loaded');
    
    console.log('\nInstantiating VideoDatabase...');
    const db = new VideoDatabase();
    this.takeSnapshot('instance_created');
    
    console.log('\nInitializing database...');
    await db.initialize();
    this.takeSnapshot('database_initialized');
    
    // Generate test data
    console.log('\nGenerating test data...');
    const testVideos = this.generateTestVideos(1000);
    this.takeSnapshot('test_data_generated');
    
    console.log('\nInserting test videos...');
    const insertStart = performance.now();
    db.addVideos(testVideos);
    const insertTime = performance.now() - insertStart;
    this.takeSnapshot('videos_inserted');
    
    console.log(`Video insertion took ${insertTime.toFixed(2)}ms`);
    
    // Test cache buildup
    console.log('\nBuilding cache with repeated queries...');
    for (let i = 0; i < 100; i++) {
      db.getVideos({ folder: 'Movies' });
      db.getVideos({ favoritesOnly: true });
      db.getVideos({ sortBy: 'date' });
    }
    this.takeSnapshot('cache_built');
    
    // Test performance monitor buildup
    console.log('\nTesting performance monitor memory usage...');
    for (let i = 0; i < 1000; i++) {
      db.getVideoById(`video_${i % 100}`);
    }
    this.takeSnapshot('performance_data_built');
    
    // Test with large result sets
    console.log('\nTesting large result sets...');
    const largeResults = [];
    for (let i = 0; i < 10; i++) {
      largeResults.push(db.getVideos());
    }
    this.takeSnapshot('large_results_cached');
    
    // Clear references and measure cleanup
    console.log('\nClearing large result references...');
    largeResults.length = 0;
    this.takeSnapshot('results_cleared');
    
    // Close database
    console.log('\nClosing database...');
    db.close();
    this.takeSnapshot('database_closed');
    
    return this.generateReport();
  }

  generateTestVideos(count) {
    const folders = ['Movies', 'TV Shows', 'Documentaries', 'Music Videos', 'Home Videos'];
    const videos = [];
    
    for (let i = 0; i < count; i++) {
      videos.push({
        id: `video_${i}`,
        name: `Test Video ${i} with a longer name for realistic memory usage`,
        path: `/very/long/path/to/video/files/that/represents/realistic/filesystem/paths/video_${i}.mp4`,
        folder: folders[i % folders.length],
        size: Math.floor(Math.random() * 1000000000),
        lastModified: Date.now() - Math.floor(Math.random() * 365 * 24 * 60 * 60 * 1000),
        created: Date.now() - Math.floor(Math.random() * 365 * 24 * 60 * 60 * 1000)
      });
    }
    
    return videos;
  }

  generateReport() {
    console.log('\n\n=== MEMORY PROFILE REPORT ===\n');
    
    const report = {
      timestamp: new Date().toISOString(),
      snapshots: this.snapshots,
      analysis: {}
    };

    // Calculate key differences
    const baseline = this.snapshots.find(s => s.label === 'baseline');
    const moduleLoaded = this.snapshots.find(s => s.label === 'module_loaded');
    const instanceCreated = this.snapshots.find(s => s.label === 'instance_created');
    const dbInitialized = this.snapshots.find(s => s.label === 'database_initialized');
    const videosInserted = this.snapshots.find(s => s.label === 'videos_inserted');
    const cacheBuilt = this.snapshots.find(s => s.label === 'cache_built');
    const performanceBuilt = this.snapshots.find(s => s.label === 'performance_data_built');
    const dbClosed = this.snapshots.find(s => s.label === 'database_closed');

    if (baseline && moduleLoaded) {
      const moduleLoadCost = this.calculateDifference(baseline, moduleLoaded);
      report.analysis.moduleLoadCost = moduleLoadCost;
      console.log('MODULE LOADING COST:');
      console.log(`  Heap Used: ${this.formatBytes(moduleLoadCost.heapUsed)}`);
      console.log(`  RSS: ${this.formatBytes(moduleLoadCost.rss)}`);
    }

    if (moduleLoaded && instanceCreated) {
      const instanceCost = this.calculateDifference(moduleLoaded, instanceCreated);
      report.analysis.instanceCreationCost = instanceCost;
      console.log('\nINSTANCE CREATION COST:');
      console.log(`  Heap Used: ${this.formatBytes(instanceCost.heapUsed)}`);
      console.log(`  RSS: ${this.formatBytes(instanceCost.rss)}`);
    }

    if (instanceCreated && dbInitialized) {
      const initCost = this.calculateDifference(instanceCreated, dbInitialized);
      report.analysis.initializationCost = initCost;
      console.log('\nINITIALIZATION COST:');
      console.log(`  Heap Used: ${this.formatBytes(initCost.heapUsed)}`);
      console.log(`  RSS: ${this.formatBytes(initCost.rss)}`);
    }

    if (dbInitialized && videosInserted) {
      const dataCost = this.calculateDifference(dbInitialized, videosInserted);
      report.analysis.dataInsertionCost = dataCost;
      console.log('\nDATA INSERTION COST (1000 videos):');
      console.log(`  Heap Used: ${this.formatBytes(dataCost.heapUsed)}`);
      console.log(`  RSS: ${this.formatBytes(dataCost.rss)}`);
      console.log(`  Per video: ${this.formatBytes(dataCost.heapUsed / 1000)}`);
    }

    if (videosInserted && cacheBuilt) {
      const cacheCost = this.calculateDifference(videosInserted, cacheBuilt);
      report.analysis.cacheBuildupCost = cacheCost;
      console.log('\nCACHE BUILDUP COST:');
      console.log(`  Heap Used: ${this.formatBytes(cacheCost.heapUsed)}`);
      console.log(`  RSS: ${this.formatBytes(cacheCost.rss)}`);
    }

    if (cacheBuilt && performanceBuilt) {
      const perfCost = this.calculateDifference(cacheBuilt, performanceBuilt);
      report.analysis.performanceMonitoringCost = perfCost;
      console.log('\nPERFORMANCE MONITORING COST:');
      console.log(`  Heap Used: ${this.formatBytes(perfCost.heapUsed)}`);
      console.log(`  RSS: ${this.formatBytes(perfCost.rss)}`);
    }

    // Overall footprint
    if (baseline && dbClosed) {
      const totalCost = this.calculateDifference(baseline, dbClosed);
      report.analysis.totalFootprint = totalCost;
      console.log('\nTOTAL MEMORY FOOTPRINT:');
      console.log(`  Peak Heap Used: ${this.formatBytes(Math.max(...this.snapshots.map(s => s.memory.heapUsed)))}`);
      console.log(`  Peak RSS: ${this.formatBytes(Math.max(...this.snapshots.map(s => s.memory.rss)))}`);
      console.log(`  Final Overhead: ${this.formatBytes(totalCost.heapUsed)}`);
    }

    // Memory efficiency analysis
    console.log('\nMEMORY EFFICIENCY ANALYSIS:');
    this.analyzeMemoryEfficiency(report);

    return report;
  }

  analyzeMemoryEfficiency(report) {
    const recommendations = [];
    
    // Analyze module loading cost
    if (report.analysis.moduleLoadCost && report.analysis.moduleLoadCost.heapUsed > 5 * 1024 * 1024) {
      recommendations.push('Large module loading cost detected (>5MB) - consider splitting into smaller modules');
    }
    
    // Analyze cache efficiency
    if (report.analysis.cacheBuildupCost && report.analysis.cacheBuildupCost.heapUsed > 10 * 1024 * 1024) {
      recommendations.push('High cache memory usage (>10MB) - consider reducing cache size or TTL');
    }
    
    // Analyze data storage efficiency
    if (report.analysis.dataInsertionCost && report.analysis.dataInsertionCost.heapUsed > 50 * 1024 * 1024) {
      recommendations.push('High data storage overhead (>50MB for 1000 videos) - investigate data structure efficiency');
    }
    
    if (recommendations.length === 0) {
      console.log('  Memory usage appears optimal for current functionality');
    } else {
      console.log('  Recommendations:');
      recommendations.forEach(rec => console.log(`    - ${rec}`));
    }
  }
}

// Run profiler if executed directly
if (require.main === module) {
  const profiler = new MemoryProfiler();
  profiler.profileDatabaseOperations()
    .then((report) => {
      // Save detailed report
      const fs = require('fs');
      const path = require('path');
      const reportPath = path.join(__dirname, `memory-profile-${Date.now()}.json`);
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\nDetailed memory profile saved to: ${reportPath}`);
      
      console.log('\nMemory profiling completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Memory profiling failed:', error);
      process.exit(1);
    });
}

module.exports = MemoryProfiler;