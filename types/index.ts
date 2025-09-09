/**
 * VDOTapes TypeScript Type Definitions
 *
 * Comprehensive type system for VDOTapes Electron video viewer application.
 * Provides type safety for IPC communication, database operations, and domain logic.
 */

// Core domain types - fundamental entities and business logic types
export * from './core';

// Database schema types - SQLite table mappings and query types
export * from './database';

// IPC communication types - type-safe Electron main/renderer communication
export * from './ipc';

// Error type hierarchy - structured error handling
export * from './errors';

// Type guards and assertions - runtime type safety
export * from './guards';

// Video metadata extraction types - FFprobe integration and batch processing
export * from './metadata';

// =============================================================================
// Quick Start Imports - Most Commonly Used Types
// =============================================================================

/**
 * Essential domain types for basic usage
 */
export type {
  VideoRecord,
  VideoId,
  Rating,
  FilePath,
  VideoFilters,
  ScanResult,
  AppSettings,
  UserPreferences,
} from './core';

/**
 * Database operation types
 */
export type {
  VideoTableRow,
  EnhancedVideoRow,
  VideoInsertParams,
  VideoUpdateParams,
  VideoDatabaseOperations,
} from './database';

/**
 * IPC communication types
 */
export type { ElectronAPI, IPCChannelMap, IPCHandler, ScanProgressData } from './ipc';

/**
 * Error handling types
 */
export type {
  VDOTapesError,
  DatabaseError,
  IPCError,
  ValidationError,
  OperationResult,
} from './errors';

/**
 * Type guards and validation functions
 */
export {
  isValidVideoId,
  isValidRating,
  isVideoRecord,
  isVideoFilters,
  assertValidRating,
  assertValidVideoId,
  createVideoId,
  safeParseRating,
} from './guards';

/**
 * Video metadata extraction types
 */
export type {
  VideoMetadata,
  VideoRecordWithMetadata,
  FFprobeOutput,
  FFprobeStream,
  FFprobeFormat,
  MetadataExtractionOptions,
  BatchExtractionOptions,
  ExtractionProgress,
  ExtractionStatistics,
  MetadataExtractor,
  MetadataQueue,
  ExtractionBatchResult,
  VideoQuality,
  ResolutionCategory,
  AspectRatio,
  FrameRate,
  ExtractionStage,
} from './metadata';

/**
 * Metadata extraction error types
 */
export type {
  MetadataExtractionError,
  FFprobeNotFoundError,
  FFprobeTimeoutError,
  MetadataParseError,
  BatchExtractionError,
  MetadataErrorType,
} from './metadata';

/**
 * Metadata utility functions and constants
 */
export {
  isVideoMetadata,
  isMetadataExtractionError,
  validateExtractionOptions,
  DEFAULT_EXTRACTION_OPTIONS,
  DEFAULT_BATCH_OPTIONS,
} from './metadata';
