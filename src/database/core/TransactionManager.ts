import Database from 'better-sqlite3';

import type { DatabaseCore } from './DatabaseCore';

export interface TransactionContext {
  readonly db: Database.Database;
  readonly rollback: () => void;
  readonly savepoint: (name: string) => void;
  readonly release: (name: string) => void;
}

export type TransactionCallback<T = any> = (ctx: TransactionContext) => T;

export interface TransactionOptions {
  readonly immediate?: boolean;
  readonly deferred?: boolean;
  readonly exclusive?: boolean;
}

export interface TransactionResult<T = any> {
  readonly success: boolean;
  readonly result?: T;
  readonly error?: Error;
}

export class TransactionManager {
  private core: DatabaseCore;

  constructor(core: DatabaseCore) {
    this.core = core;
  }

  /**
   * Execute a function within a database transaction
   */
  execute<T>(
    callback: TransactionCallback<T>,
    options: TransactionOptions = {}
  ): TransactionResult<T> {
    if (!this.core.isInitialized()) {
      return {
        success: false,
        error: new Error('Database not initialized'),
      };
    }

    const db = this.core.getConnection();

    try {
      // Start transaction based on options
      if (options.immediate) {
        db.exec('BEGIN IMMEDIATE');
      } else if (options.exclusive) {
        db.exec('BEGIN EXCLUSIVE');
      } else {
        db.exec('BEGIN DEFERRED');
      }

      const result = callback({
        db,
        rollback: () => {
          throw new Error('ROLLBACK');
        },
        savepoint: (name: string) => {
          db.exec(`SAVEPOINT ${name}`);
        },
        release: (name: string) => {
          db.exec(`RELEASE SAVEPOINT ${name}`);
        },
      });

      db.exec('COMMIT');
      return {
        success: true,
        result,
      };
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackError) {
        console.error('CRITICAL: Rollback failed:', rollbackError);
        console.error('Original error:', error);
      }

      if (error instanceof Error && error.message === 'ROLLBACK') {
        return {
          success: false,
          error: new Error('Transaction was rolled back'),
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Execute multiple operations in a single transaction
   */
  executeMultiple<T extends readonly any[]>(
    operations: readonly TransactionCallback<T[number]>[],
    options: TransactionOptions = {}
  ): TransactionResult<T> {
    return this.execute((ctx) => {
      const results: any[] = [];
      
      for (const operation of operations) {
        const result = operation(ctx);
        results.push(result);
      }
      
      return results as unknown as T;
    }, options);
  }

  /**
   * Execute with savepoints for nested transaction control
   */
  executeWithSavepoints<T>(
    operations: Record<string, TransactionCallback<any>>,
    options: TransactionOptions = {}
  ): TransactionResult<Record<string, any>> {
    return this.execute((ctx) => {
      const results: Record<string, any> = {};

      for (const [savepointName, operation] of Object.entries(operations)) {
        try {
          ctx.savepoint(savepointName);
          const result = operation(ctx);
          results[savepointName] = result;
        } catch (error) {
          console.warn(`Rolling back to savepoint ${savepointName}:`, error);
          ctx.db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
          throw error;
        }
      }

      return results;
    }, options);
  }

  /**
   * Check if we're currently in a transaction
   */
  isInTransaction(): boolean {
    try {
      const db = this.core.getConnection();
      return db.inTransaction;
    } catch {
      return false;
    }
  }

  /**
   * Execute a simple query within the current transaction context
   */
  query<T = any>(sql: string, params: readonly any[] = []): T[] {
    const db = this.core.getConnection();
    return db.prepare(sql).all(...params) as T[];
  }

  /**
   * Execute a simple statement within the current transaction context
   */
  run(sql: string, params: readonly any[] = []): Database.RunResult {
    const db = this.core.getConnection();
    return db.prepare(sql).run(...params);
  }

  /**
   * Get a single row within the current transaction context
   */
  get<T = any>(sql: string, params: readonly any[] = []): T | undefined {
    const db = this.core.getConnection();
    return db.prepare(sql).get(...params) as T | undefined;
  }

  private getTransactionType(options: TransactionOptions): string {
    if (options.immediate) return 'immediate';
    if (options.deferred) return 'deferred';
    if (options.exclusive) return 'exclusive';
    return 'deferred'; // Default
  }

  /**
   * Utility method for common backup/import transaction pattern
   */
  executeBackupTransaction<T>(
    callback: TransactionCallback<T>
  ): TransactionResult<T> {
    return this.execute(callback, { immediate: true });
  }

  /**
   * Utility method for bulk operations with better error handling
   */
  executeBulkOperation<T>(
    items: readonly any[],
    operation: (item: any, ctx: TransactionContext) => T,
    batchSize: number = 100
  ): TransactionResult<T[]> {
    return this.execute((ctx) => {
      const results: T[] = [];
      
      // Process in batches to avoid memory issues with large datasets
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const savepointName = `batch_${Math.floor(i / batchSize)}`;
        
        try {
          ctx.savepoint(savepointName);
          
          for (const item of batch) {
            const result = operation(item, ctx);
            results.push(result);
          }
          
          ctx.release(savepointName);
        } catch (error) {
          console.error(`Batch ${Math.floor(i / batchSize)} failed, rolling back:`, error);
          ctx.db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
          throw error;
        }
      }
      
      return results;
    }, { immediate: true });
  }
}