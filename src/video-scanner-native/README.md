# Video Scanner Native

High-performance Rust implementation of the video scanner for VDOTapes.

## Overview

This native module provides fast directory scanning and video file detection using Rust and NAPI-RS bindings for Node.js.

## Building

### Development Build

```bash
npm run build:debug
```

### Production Build

```bash
npm run build
```

## Supported Platforms

- macOS (Intel): `x86_64-apple-darwin`
- macOS (Apple Silicon): `aarch64-apple-darwin`
- Windows (x64): `x86_64-pc-windows-msvc`
- Linux (x64): `x86_64-unknown-linux-gnu`

## API

### Class: VideoScannerNative

#### Constructor

```typescript
const scanner = new VideoScannerNative();
```

#### Methods

##### scanVideos(folderPath: string): ScanResult

Scan a directory for video files.

```typescript
const result = scanner.scanVideos('/path/to/videos');
```

##### getProgress(): ScanProgress

Get current scan progress.

```typescript
const progress = scanner.getProgress();
```

##### reset(): void

Reset the scanner state.

```typescript
scanner.reset();
```

##### isValidVideoFile(filename: string): boolean

Check if a filename is a valid video file.

```typescript
const isValid = scanner.isValidVideoFile('video.mp4');
```

### Standalone Functions

##### scanVideosSync(folderPath: string): ScanResult

Functional API for one-off scans.

```typescript
const result = scanVideosSync('/path/to/videos');
```

##### isValidVideo(filename: string): boolean

Check if a filename is a valid video file.

```typescript
const isValid = isValidVideo('video.mp4');
```

##### getSupportedExtensions(): string[]

Get list of supported video extensions.

```typescript
const extensions = getSupportedExtensions();
```

## Types

### ScanResult

```typescript
interface ScanResult {
  success: boolean;
  videos: VideoMetadata[];
  folders: string[];
  error?: string;
  stats?: ScanStats;
}
```

### VideoMetadata

```typescript
interface VideoMetadata {
  id: string;
  name: string;
  path: string;
  folder: string;
  size: number;
  lastModified: number;
  created: number;
  addedAt: string;
  updatedAt: string;
  duration?: number;
}
```

### ScanProgress

```typescript
interface ScanProgress {
  isScanning: boolean;
  progress: number;
  processedFiles: number;
  totalFiles: number;
  totalVideos: number;
}
```

## Performance

The Rust implementation provides significant performance improvements over the TypeScript version:

- Faster directory traversal using `walkdir`
- Zero-cost abstractions
- Optimized file system operations
- Efficient memory usage

## Development

### Running Tests

```bash
cargo test
```

### Linting

```bash
cargo clippy
```

### Formatting

```bash
cargo fmt
```
