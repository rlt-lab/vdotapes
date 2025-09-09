// Video metadata extraction type definitions for VDOTapes
// Comprehensive types for FFprobe integration and batch processing

import { VideoId, FilePath, Timestamp } from './core';
import { VDOTapesError, OperationResult } from './errors';

// ===== FFprobe Output Types =====

export interface FFprobeFormat {
  readonly filename?: string;
  readonly nb_streams?: number;
  readonly nb_programs?: number;
  readonly format_name?: string;
  readonly format_long_name?: string;
  readonly start_time?: string;
  readonly duration?: string;
  readonly size?: string;
  readonly bit_rate?: string;
  readonly probe_score?: number;
  readonly tags?: Record<string, string>;
}

export interface FFprobeStream {
  readonly index: number;
  readonly codec_name?: string;
  readonly codec_long_name?: string;
  readonly profile?: string;
  readonly codec_type: 'video' | 'audio' | 'subtitle' | 'data' | 'attachment';
  readonly codec_time_base?: string;
  readonly codec_tag_string?: string;
  readonly codec_tag?: string;
  readonly width?: number;
  readonly height?: number;
  readonly coded_width?: number;
  readonly coded_height?: number;
  readonly closed_captions?: number;
  readonly has_b_frames?: number;
  readonly pix_fmt?: string;
  readonly level?: number;
  readonly color_range?: string;
  readonly color_space?: string;
  readonly color_transfer?: string;
  readonly color_primaries?: string;
  readonly r_frame_rate?: string;
  readonly avg_frame_rate?: string;
  readonly time_base?: string;
  readonly start_pts?: number;
  readonly start_time?: string;
  readonly duration_ts?: number;
  readonly duration?: string;
  readonly bit_rate?: string;
  readonly bits_per_raw_sample?: string;
  readonly nb_frames?: string;
  readonly sample_fmt?: string;
  readonly sample_rate?: string;
  readonly channels?: number;
  readonly channel_layout?: string;
  readonly disposition?: Record<string, number>;
  readonly tags?: Record<string, string>;
}

export interface FFprobeOutput {
  readonly streams: readonly FFprobeStream[];
  readonly format: FFprobeFormat;
  readonly chapters?: readonly any[];
}

// ===== Processed Metadata Types =====

export type VideoQuality = 'unknown' | 'low' | 'medium' | 'high' | 'ultra';
export type ResolutionCategory =
  | 'SD'
  | '480p'
  | '720p'
  | '1080p'
  | '1440p'
  | '4K'
  | '8K'
  | 'unknown';
export type AspectRatio = string; // Format: "16:9", "4:3", etc.
export type FrameRate = number; // Frames per second as decimal

export interface VideoMetadata {
  // Core video properties
  readonly duration: number | null; // Seconds as float
  readonly width: number | null; // Pixels
  readonly height: number | null; // Pixels
  readonly codec: string | null; // Primary video codec (e.g., "h264", "hevc")
  readonly bitrate: number | null; // Bits per second
  readonly frameRate: FrameRate | null; // FPS as decimal
  readonly aspectRatio: AspectRatio | null; // Calculated ratio string

  // Extended video properties
  readonly pixelFormat: string | null; // Pixel format (e.g., "yuv420p")
  readonly colorSpace: string | null; // Color space (e.g., "bt709")
  readonly colorRange: string | null; // Color range (e.g., "tv", "pc")
  readonly profile: string | null; // Codec profile (e.g., "High", "Main")
  readonly level: number | null; // Codec level
  readonly rotation: number; // Rotation in degrees (0, 90, 180, 270)
  readonly hasBFrames: boolean; // Whether video has B-frames

  // Audio properties
  readonly hasAudio: boolean;
  readonly audioCodec: string | null; // Primary audio codec
  readonly audioChannels: number | null; // Number of audio channels
  readonly audioSampleRate: number | null; // Hz
  readonly audioBitrate: number | null; // Bits per second
  readonly channelLayout: string | null; // Channel layout (e.g., "stereo")

  // File format properties
  readonly formatName: string | null; // Container format
  readonly formatLongName: string | null; // Human-readable format name
  readonly fileSize: number | null; // Bytes (from format, may differ from filesystem)

  // Calculated/derived properties
  readonly resolution: ResolutionCategory; // Categorized resolution
  readonly quality: VideoQuality; // Assessed quality level
  readonly isValid: boolean; // Whether file contains valid video data
  readonly estimatedBandwidth: number | null; // Estimated network bandwidth needed (bps)

  // Metadata and tags
  readonly title: string | null; // Video title from metadata
  readonly creationTime: Date | null; // Creation timestamp from metadata
  readonly artist: string | null; // Artist/creator from metadata
  readonly comment: string | null; // Comment/description from metadata
  readonly customTags: Record<string, string>; // Other metadata tags

  // Technical analysis
  readonly streamCount: number; // Total number of streams
  readonly videoStreamCount: number; // Number of video streams
  readonly audioStreamCount: number; // Number of audio streams
  readonly subtitleStreamCount: number; // Number of subtitle streams
  readonly attachmentCount: number; // Number of attachment streams

  // Extraction metadata
  readonly extractedAt: Date; // When metadata was extracted
  readonly extractionDuration: number; // How long extraction took (ms)
  readonly ffprobeVersion: string | null; // Version of FFprobe used
}

// Enhanced database-compatible video record with metadata
export interface VideoRecordWithMetadata {
  // Database fields (matching existing schema)
  readonly id: VideoId;
  readonly name: string;
  readonly path: FilePath;
  readonly relative_path: string | null;
  readonly folder: string | null;
  readonly size: number; // File size from filesystem
  readonly last_modified: Timestamp;
  readonly created: Timestamp;
  readonly added_at: string;
  readonly updated_at: string;

  // Metadata fields (stored in database)
  readonly duration: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly codec: string | null;
  readonly bitrate: number | null;

  // Extended metadata (computed or from advanced extraction)
  readonly metadata: VideoMetadata | null;
  readonly metadata_extracted_at: Date | null;
  readonly metadata_extraction_error: string | null;
}

// ===== Extraction Configuration Types =====

export interface MetadataExtractionOptions {
  readonly timeout: number; // Extraction timeout in milliseconds (default: 30000)
  readonly useCache: boolean; // Whether to use metadata cache (default: true)
  readonly cacheMaxAge: number; // Max cache age in milliseconds (default: 300000)
  readonly retryAttempts: number; // Number of retry attempts on failure (default: 3)
  readonly retryDelay: number; // Delay between retries in milliseconds (default: 1000)
  readonly skipBrokenFiles: boolean; // Skip files that fail extraction (default: true)
  readonly extractThumbnail: boolean; // Whether to also extract thumbnail (default: false)
  readonly thumbnailTimestamp: number; // Timestamp for thumbnail extraction in seconds (default: 10)
  readonly validateVideo: boolean; // Perform additional video validation (default: true)
  readonly includeAllStreams: boolean; // Extract info for all streams, not just first video (default: false)
  readonly concurrency: number; // Max concurrent extractions (default: 3)
}

export interface BatchExtractionOptions extends MetadataExtractionOptions {
  readonly prioritizeVisible: boolean; // Process visible/favorited videos first (default: true)
  readonly chunkSize: number; // Number of videos to process in each batch (default: 50)
  readonly pauseBetweenChunks: number; // Delay between chunks in milliseconds (default: 100)
  readonly stopOnError: boolean; // Whether to stop entire batch on first error (default: false)
  readonly maxFailureRate: number; // Max allowed failure rate before stopping (0-1, default: 0.5)
}

// ===== Progress Tracking Types =====

export interface ExtractionProgress {
  readonly taskId: string; // Unique identifier for this extraction task
  readonly currentFile: FilePath | null; // Currently processing file
  readonly currentFileName: string | null; // Just the filename for display
  readonly completed: number; // Number of completed extractions
  readonly total: number; // Total number of files to process
  readonly failed: number; // Number of failed extractions
  readonly skipped: number; // Number of skipped files
  readonly percentage: number; // Completion percentage (0-100)
  readonly startTime: Date; // When extraction started
  readonly elapsedTime: number; // Elapsed time in milliseconds
  readonly estimatedTimeRemaining: number | null; // ETA in milliseconds
  readonly currentStage: ExtractionStage; // Current processing stage
  readonly averageTimePerFile: number; // Average processing time per file (ms)
  readonly throughput: number; // Files per second
  readonly isComplete: boolean; // Whether extraction is complete
  readonly isCancelled: boolean; // Whether extraction was cancelled
  readonly warnings: readonly string[]; // Non-fatal warnings
}

export type ExtractionStage =
  | 'initializing'
  | 'scanning_files'
  | 'extracting_metadata'
  | 'validating_results'
  | 'updating_database'
  | 'cleaning_cache'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface ExtractionStatistics {
  readonly totalFiles: number;
  readonly successfulExtractions: number;
  readonly failedExtractions: number;
  readonly skippedFiles: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly totalExtractionTime: number; // Total time spent on FFprobe calls (ms)
  readonly totalProcessingTime: number; // Total time including queuing, parsing, etc. (ms)
  readonly averageFileSize: number; // Average file size in bytes
  readonly averageExtractionTime: number; // Average extraction time per file (ms)
  readonly errorsByType: Record<string, number>; // Error counts by type
  readonly codecDistribution: Record<string, number>; // Count of files by codec
  readonly resolutionDistribution: Record<ResolutionCategory, number>; // Count by resolution
}

// ===== Error Types for Metadata Extraction =====

export class MetadataExtractionError extends VDOTapesError {
  readonly code = 'METADATA_EXTRACTION_ERROR' as const;

  constructor(
    message: string,
    readonly videoPath: FilePath,
    readonly stage: ExtractionStage,
    readonly ffprobeError?: string,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

export class FFprobeNotFoundError extends VDOTapesError {
  readonly code = 'FFPROBE_NOT_FOUND_ERROR' as const;

  constructor(
    message: string,
    readonly searchedPaths: readonly string[],
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

export class FFprobeTimeoutError extends VDOTapesError {
  readonly code = 'FFPROBE_TIMEOUT_ERROR' as const;

  constructor(
    message: string,
    readonly videoPath: FilePath,
    readonly timeoutMs: number,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

export class MetadataParseError extends VDOTapesError {
  readonly code = 'METADATA_PARSE_ERROR' as const;

  constructor(
    message: string,
    readonly videoPath: FilePath,
    readonly ffprobeOutput: string,
    readonly parseError: Error,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

export class BatchExtractionError extends VDOTapesError {
  readonly code = 'BATCH_EXTRACTION_ERROR' as const;

  constructor(
    message: string,
    readonly taskId: string,
    readonly failedFiles: readonly FilePath[],
    readonly successfulFiles: readonly FilePath[],
    readonly statistics: ExtractionStatistics,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

// Union type for all metadata extraction errors
export type MetadataErrorType =
  | MetadataExtractionError
  | FFprobeNotFoundError
  | FFprobeTimeoutError
  | MetadataParseError
  | BatchExtractionError;

// ===== Service Interface Types =====

export interface MetadataExtractor {
  // Core extraction methods
  readonly extractMetadata: (
    videoPath: FilePath,
    options?: Partial<MetadataExtractionOptions>
  ) => Promise<VideoMetadata>;
  readonly extractMetadataBatch: (
    videoPaths: readonly FilePath[],
    options?: Partial<BatchExtractionOptions>
  ) => Promise<OperationResult<ExtractionBatchResult>>;

  // Cache management
  readonly clearCache: () => void;
  readonly getCacheStats: () => CacheStatistics;
  readonly warmCache: (videoPaths: readonly FilePath[]) => Promise<void>;

  // Configuration and health
  readonly validateFFprobe: () => Promise<boolean>;
  readonly getFFprobeVersion: () => Promise<string | null>;
  readonly configure: (options: Partial<MetadataExtractionOptions>) => void;

  // Progress and cancellation
  readonly cancelExtraction: (taskId: string) => boolean;
  readonly getExtractionProgress: (taskId: string) => ExtractionProgress | null;
  readonly onProgress: (callback: ProgressCallback) => void;
  readonly removeProgressListener: (callback: ProgressCallback) => void;
}

export interface MetadataQueue {
  // Queue management
  readonly addToQueue: (videoPath: FilePath, priority?: number) => Promise<VideoMetadata>;
  readonly addBatchToQueue: (
    videoPaths: readonly FilePath[],
    options?: Partial<BatchExtractionOptions>
  ) => Promise<string>; // Returns task ID

  // Queue control
  readonly pauseQueue: () => void;
  readonly resumeQueue: () => void;
  readonly clearQueue: () => void;
  readonly getQueueStatus: () => QueueStatus;

  // Task management
  readonly getTask: (taskId: string) => ExtractionTask | null;
  readonly cancelTask: (taskId: string) => boolean;
  readonly getActiveTasks: () => readonly ExtractionTask[];
}

export interface ExtractionBatchResult {
  readonly taskId: string;
  readonly successful: readonly { path: FilePath; metadata: VideoMetadata }[];
  readonly failed: readonly { path: FilePath; error: MetadataErrorType }[];
  readonly skipped: readonly { path: FilePath; reason: string }[];
  readonly statistics: ExtractionStatistics;
  readonly progress: ExtractionProgress;
}

export interface ExtractionTask {
  readonly id: string;
  readonly videoPaths: readonly FilePath[];
  readonly options: BatchExtractionOptions;
  readonly status: ExtractionStage;
  readonly progress: ExtractionProgress;
  readonly result: ExtractionBatchResult | null;
  readonly error: MetadataErrorType | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
}

export interface QueueStatus {
  readonly isRunning: boolean;
  readonly isPaused: boolean;
  readonly queueLength: number;
  readonly activeTaskCount: number;
  readonly completedTaskCount: number;
  readonly failedTaskCount: number;
  readonly totalProcessedFiles: number;
  readonly averageProcessingTime: number; // ms per file
}

export interface CacheStatistics {
  readonly size: number; // Number of cached entries
  readonly hitRate: number; // Cache hit rate (0-1)
  readonly totalHits: number;
  readonly totalMisses: number;
  readonly memoryUsage: number; // Approximate memory usage in bytes
  readonly oldestEntry: Date | null; // Timestamp of oldest cached entry
  readonly newestEntry: Date | null; // Timestamp of newest cached entry
}

// ===== Callback and Event Types =====

export type ProgressCallback = (progress: ExtractionProgress) => void;
export type MetadataCallback = (metadata: VideoMetadata, videoPath: FilePath) => void;
export type ErrorCallback = (error: MetadataErrorType, videoPath: FilePath) => void;
export type CompletionCallback = (result: ExtractionBatchResult) => void;

export interface ExtractionEventHandlers {
  readonly onProgress?: ProgressCallback;
  readonly onMetadataExtracted?: MetadataCallback;
  readonly onError?: ErrorCallback;
  readonly onTaskComplete?: CompletionCallback;
  readonly onTaskCancelled?: (taskId: string) => void;
  readonly onQueueEmpty?: () => void;
}

// ===== Utility Types =====

// Helper type for partial metadata updates
export type MetadataUpdate = Partial<
  Pick<
    VideoMetadata,
    | 'duration'
    | 'width'
    | 'height'
    | 'codec'
    | 'bitrate'
    | 'frameRate'
    | 'aspectRatio'
    | 'hasAudio'
    | 'resolution'
    | 'quality'
    | 'extractedAt'
  >
>;

// Type for metadata validation results
export interface MetadataValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly metadata: VideoMetadata | null;
}

// Type guard functions
export function isVideoMetadata(obj: unknown): obj is VideoMetadata {
  return typeof obj === 'object' && obj !== null && 'extractedAt' in obj && 'isValid' in obj;
}

export function isMetadataExtractionError(error: unknown): error is MetadataErrorType {
  return (
    error instanceof MetadataExtractionError ||
    error instanceof FFprobeNotFoundError ||
    error instanceof FFprobeTimeoutError ||
    error instanceof MetadataParseError ||
    error instanceof BatchExtractionError
  );
}

// Configuration validation
export function validateExtractionOptions(options: Partial<MetadataExtractionOptions>): string[] {
  const errors: string[] = [];

  if (options.timeout !== undefined && (options.timeout <= 0 || options.timeout > 300000)) {
    errors.push('timeout must be between 1 and 300000 milliseconds');
  }

  if (options.concurrency !== undefined && (options.concurrency < 1 || options.concurrency > 10)) {
    errors.push('concurrency must be between 1 and 10');
  }

  if (
    options.retryAttempts !== undefined &&
    (options.retryAttempts < 0 || options.retryAttempts > 10)
  ) {
    errors.push('retryAttempts must be between 0 and 10');
  }

  return errors;
}

// Default configuration values
export const DEFAULT_EXTRACTION_OPTIONS: MetadataExtractionOptions = {
  timeout: 30000,
  useCache: true,
  cacheMaxAge: 300000, // 5 minutes
  retryAttempts: 3,
  retryDelay: 1000,
  skipBrokenFiles: true,
  extractThumbnail: false,
  thumbnailTimestamp: 10,
  validateVideo: true,
  includeAllStreams: false,
  concurrency: 3,
} as const;

export const DEFAULT_BATCH_OPTIONS: BatchExtractionOptions = {
  ...DEFAULT_EXTRACTION_OPTIONS,
  prioritizeVisible: true,
  chunkSize: 50,
  pauseBetweenChunks: 100,
  stopOnError: false,
  maxFailureRate: 0.5,
} as const;
