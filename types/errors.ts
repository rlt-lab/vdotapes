// Error type hierarchy for VDOTapes
import { FilePath } from './core';

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

// Type unions for error handling
export type DatabaseErrorType = DatabaseError;

export type IPCErrorType = IPCError;

export type ValidationErrorType = ValidationError | RatingValidationError | VideoIdValidationError;

export type ScanErrorType = ScanError;

export type AllVDOTapesErrors =
  | DatabaseErrorType
  | IPCErrorType
  | ValidationErrorType
  | ScanErrorType;

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

// Error type guard
export function isVDOTapesError(error: unknown): error is AllVDOTapesErrors {
  return error instanceof VDOTapesError;
}
