// Error type hierarchy for VDOTapes
import { VideoId, FilePath } from './core';

// Base error class with common properties
export abstract class VDOTapesError extends Error {
  readonly timestamp: number = Date.now();

  constructor(
    message: string,
    readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;

    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// Database operation errors - simple hierarchy following KISS
export class DatabaseError extends VDOTapesError {
  readonly code: string = 'DATABASE_ERROR';

  constructor(
    message: string,
    readonly query?: string,
    readonly sqliteCode?: string,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

export class DatabaseConnectionError extends VDOTapesError {
  readonly code = 'DATABASE_CONNECTION_ERROR' as const;
}

export class DatabaseMigrationError extends VDOTapesError {
  readonly code = 'DATABASE_MIGRATION_ERROR' as const;

  constructor(
    message: string,
    readonly fromVersion: number,
    readonly toVersion: number,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

export class DatabaseConstraintError extends VDOTapesError {
  readonly code = 'DATABASE_CONSTRAINT_ERROR' as const;

  constructor(
    message: string,
    readonly constraint: string,
    readonly table: string,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

// File system operation errors
export class FileSystemError extends VDOTapesError {
  readonly code: string = 'FILESYSTEM_ERROR';

  constructor(
    message: string,
    readonly path?: FilePath,
    readonly operation?: 'read' | 'write' | 'delete' | 'access',
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

export class VideoFileError extends VDOTapesError {
  readonly code = 'VIDEO_FILE_ERROR' as const;

  constructor(
    message: string,
    readonly videoId?: VideoId,
    readonly path?: FilePath,
    readonly fileError?: 'corrupted' | 'missing' | 'unsupported_format' | 'access_denied',
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

export class ThumbnailGenerationError extends VDOTapesError {
  readonly code = 'THUMBNAIL_GENERATION_ERROR' as const;

  constructor(
    message: string,
    readonly videoPath: FilePath,
    readonly videoTimestamp?: number,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

// IPC communication errors
export class IPCError extends VDOTapesError {
  readonly code: string = 'IPC_ERROR';

  constructor(
    message: string,
    readonly channel?: string,
    readonly method?: string,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

export class IPCTimeoutError extends VDOTapesError {
  readonly code = 'IPC_TIMEOUT_ERROR' as const;

  constructor(
    message: string,
    readonly channel?: string,
    readonly timeoutMs?: number,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

export class IPCValidationError extends VDOTapesError {
  readonly code = 'IPC_VALIDATION_ERROR' as const;

  constructor(
    message: string,
    readonly channel?: string,
    readonly validationField?: string,
    readonly expectedType?: string,
    readonly receivedValue?: unknown,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

// Video scanning and processing errors
export class ScanError extends VDOTapesError {
  readonly code: string = 'SCAN_ERROR';

  constructor(
    message: string,
    readonly folderPath?: FilePath,
    readonly stage?: 'scanning' | 'processing' | 'database',
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

export class DirectoryAccessError extends VDOTapesError {
  readonly code = 'DIRECTORY_ACCESS_ERROR' as const;

  constructor(
    message: string,
    readonly folderPath?: FilePath,
    readonly permission?: 'read' | 'write' | 'execute',
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

// Validation errors
export class ValidationError extends VDOTapesError {
  readonly code: string = 'VALIDATION_ERROR';

  constructor(
    message: string,
    readonly field: string,
    readonly value: unknown,
    readonly constraint: string,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

export class RatingValidationError extends VDOTapesError {
  readonly code = 'RATING_VALIDATION_ERROR' as const;

  constructor(
    message: string,
    readonly rating: unknown,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

export class VideoIdValidationError extends VDOTapesError {
  readonly code = 'VIDEO_ID_VALIDATION_ERROR' as const;

  constructor(
    message: string,
    readonly videoId: unknown,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

// Settings and configuration errors
export class SettingsError extends VDOTapesError {
  readonly code: string = 'SETTINGS_ERROR';

  constructor(
    message: string,
    readonly settingKey?: string,
    readonly settingValue?: unknown,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

export class PreferencesError extends VDOTapesError {
  readonly code = 'PREFERENCES_ERROR' as const;
}

// Backup and export errors
export class BackupError extends VDOTapesError {
  readonly code: string = 'BACKUP_ERROR';

  constructor(
    message: string,
    readonly operation: 'export' | 'import',
    readonly backupPath?: FilePath,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

export class BackupFormatError extends VDOTapesError {
  readonly code = 'BACKUP_FORMAT_ERROR' as const;

  constructor(
    message: string,
    readonly backupPath?: FilePath,
    readonly expectedVersion?: string,
    readonly actualVersion?: string,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

// Type unions for error handling
export type DatabaseErrorType =
  | DatabaseError
  | DatabaseConnectionError
  | DatabaseMigrationError
  | DatabaseConstraintError;

export type FileSystemErrorType = FileSystemError | VideoFileError | ThumbnailGenerationError;

export type IPCErrorType = IPCError | IPCTimeoutError | IPCValidationError;

export type ValidationErrorType = ValidationError | RatingValidationError | VideoIdValidationError;

export type ScanErrorType = ScanError | DirectoryAccessError;

export type AllVDOTapesErrors =
  | DatabaseErrorType
  | FileSystemErrorType
  | IPCErrorType
  | ValidationErrorType
  | ScanErrorType
  | SettingsError
  | PreferencesError
  | BackupError
  | BackupFormatError;

// Error result types for operations
export interface OperationSuccess<T = void> {
  readonly success: true;
  readonly data: T;
}

export interface OperationError {
  readonly success: false;
  readonly error: AllVDOTapesErrors;
}

export type OperationResult<T = void> = OperationSuccess<T> | OperationError;

// Error context helpers
export function createErrorContext(
  operation: string,
  additionalContext?: Record<string, unknown>
): Record<string, unknown> {
  return {
    operation,
    timestamp: new Date().toISOString(),
    ...additionalContext,
  };
}

// Error type guards for better error handling
export function isDatabaseError(error: unknown): error is DatabaseErrorType {
  return error instanceof DatabaseError;
}

export function isFileSystemError(error: unknown): error is FileSystemErrorType {
  return error instanceof FileSystemError;
}

export function isIPCError(error: unknown): error is IPCErrorType {
  return error instanceof IPCError;
}

export function isValidationError(error: unknown): error is ValidationErrorType {
  return error instanceof ValidationError;
}

export function isScanError(error: unknown): error is ScanErrorType {
  return error instanceof ScanError;
}

export function isVDOTapesError(error: unknown): error is AllVDOTapesErrors {
  return error instanceof VDOTapesError;
}
