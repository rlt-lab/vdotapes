/**
 * Database Performance Monitoring System
 * Tracks query performance and identifies bottlenecks
 */

class QueryPerformanceMonitor {
  constructor() {
    this.queryStats = new Map();
    this.slowQueryThreshold = 100; // ms
    this.slowQueries = [];
    this.maxSlowQueries = 50; // Keep last 50 slow queries

    // Performance metrics
    this.totalQueries = 0;
    this.totalTime = 0;
    this.startTime = Date.now();
  }

  wrapQuery(queryName, queryFn) {
    return (...args) => {
      const start = performance.now();
      let result;
      let error = null;

      try {
        result = queryFn.apply(this, args);
      } catch (err) {
        error = err;
        throw err;
      } finally {
        const duration = performance.now() - start;
        this.recordQuery(queryName, duration, error, args);
      }

      return result;
    };
  }

  wrapAsyncQuery(queryName, queryFn) {
    return async (...args) => {
      const start = performance.now();
      let result;
      let error = null;

      try {
        result = await queryFn.apply(this, args);
      } catch (err) {
        error = err;
        throw err;
      } finally {
        const duration = performance.now() - start;
        this.recordQuery(queryName, duration, error, args);
      }

      return result;
    };
  }

  recordQuery(queryName, duration, error = null, args = []) {
    this.totalQueries++;
    this.totalTime += duration;

    // Update query statistics
    const stats = this.queryStats.get(queryName) || {
      count: 0,
      totalTime: 0,
      avgTime: 0,
      minTime: Infinity,
      maxTime: 0,
      errorCount: 0,
      lastError: null,
      recentTimes: [],
    };

    stats.count++;
    stats.totalTime += duration;
    stats.avgTime = stats.totalTime / stats.count;
    stats.minTime = Math.min(stats.minTime, duration);
    stats.maxTime = Math.max(stats.maxTime, duration);

    if (error) {
      stats.errorCount++;
      stats.lastError = error.message;
    }

    // Keep recent times for trend analysis (last 10)
    stats.recentTimes.push(duration);
    if (stats.recentTimes.length > 10) {
      stats.recentTimes.shift();
    }

    this.queryStats.set(queryName, stats);

    // Track slow queries
    if (duration > this.slowQueryThreshold) {
      this.recordSlowQuery(queryName, duration, args);
      console.warn(`Slow query detected: ${queryName} took ${duration.toFixed(2)}ms`);
    }
  }

  recordSlowQuery(queryName, duration, args) {
    const slowQuery = {
      queryName,
      duration: Math.round(duration * 100) / 100, // Round to 2 decimals
      timestamp: Date.now(),
      args: this.sanitizeArgs(args),
    };

    this.slowQueries.push(slowQuery);

    // Keep only recent slow queries
    if (this.slowQueries.length > this.maxSlowQueries) {
      this.slowQueries.shift();
    }
  }

  sanitizeArgs(args) {
    // Sanitize arguments for logging (avoid circular references)
    try {
      return JSON.parse(JSON.stringify(args));
    } catch (error) {
      return ['[Circular or non-serializable arguments]'];
    }
  }

  getSlowQueries(limit = 10) {
    return this.slowQueries.slice(-limit).sort((a, b) => b.duration - a.duration);
  }

  getQueryStats() {
    const stats = Array.from(this.queryStats.entries())
      .map(([name, data]) => ({
        queryName: name,
        ...data,
        recentAvg:
          data.recentTimes.length > 0
            ? data.recentTimes.reduce((a, b) => a + b, 0) / data.recentTimes.length
            : 0,
      }))
      .sort((a, b) => b.avgTime - a.avgTime);

    return stats;
  }

  getSummaryStats() {
    const avgQueryTime = this.totalQueries > 0 ? this.totalTime / this.totalQueries : 0;
    const uptime = Date.now() - this.startTime;
    const queriesPerSecond = this.totalQueries / (uptime / 1000);

    return {
      totalQueries: this.totalQueries,
      totalTime: Math.round(this.totalTime * 100) / 100,
      avgQueryTime: Math.round(avgQueryTime * 100) / 100,
      queriesPerSecond: Math.round(queriesPerSecond * 100) / 100,
      uptime: uptime,
      slowQueryCount: this.slowQueries.length,
      uniqueQueries: this.queryStats.size,
    };
  }

  generateReport() {
    const summary = this.getSummaryStats();
    const slowQueries = this.getSlowQueries(5);
    const topQueries = this.getQueryStats().slice(0, 5);

    const report = {
      timestamp: new Date().toISOString(),
      summary,
      slowQueries,
      topQueriesByAvgTime: topQueries,
      recommendations: this.generateRecommendations(),
    };

    return report;
  }

  generateRecommendations() {
    const recommendations = [];
    const stats = this.getQueryStats();

    // Check for consistently slow queries
    stats.forEach((stat) => {
      if (stat.avgTime > this.slowQueryThreshold && stat.count > 5) {
        recommendations.push({
          type: 'slow_query',
          message: `Query "${stat.queryName}" averages ${stat.avgTime.toFixed(1)}ms over ${stat.count} executions`,
          suggestion: 'Consider adding indexes or optimizing this query',
        });
      }

      if (stat.errorCount > 0) {
        recommendations.push({
          type: 'query_errors',
          message: `Query "${stat.queryName}" has ${stat.errorCount} errors out of ${stat.count} executions`,
          suggestion: 'Investigate and fix query errors',
        });
      }
    });

    // Check overall performance
    const summary = this.getSummaryStats();
    if (summary.avgQueryTime > 50) {
      recommendations.push({
        type: 'overall_performance',
        message: `Overall average query time is ${summary.avgQueryTime.toFixed(1)}ms`,
        suggestion: 'Database performance may need optimization',
      });
    }

    return recommendations;
  }

  logReport() {
    const report = this.generateReport();
    console.log('=== Database Performance Report ===');
    console.log('Summary:', report.summary);

    if (report.slowQueries.length > 0) {
      console.log('Recent Slow Queries:');
      report.slowQueries.forEach((q) => {
        console.log(`  ${q.queryName}: ${q.duration}ms`);
      });
    }

    if (report.recommendations.length > 0) {
      console.log('Recommendations:');
      report.recommendations.forEach((rec) => {
        console.log(`  ${rec.type}: ${rec.message} - ${rec.suggestion}`);
      });
    }

    return report;
  }

  reset() {
    this.queryStats.clear();
    this.slowQueries = [];
    this.totalQueries = 0;
    this.totalTime = 0;
    this.startTime = Date.now();
  }
}

module.exports = QueryPerformanceMonitor;
