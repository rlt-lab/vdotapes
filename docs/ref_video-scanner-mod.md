# Video Scanner Rust Migration Plan

## Executive Summary

This document outlines the plan to migrate the TypeScript `video-scanner.ts` module to a native Rust module using `napi-rs`. The Rust implementation will provide significant performance improvements for file system scanning operations while maintaining full API compatibility with the existing TypeScript interface.

## Current Implementation Analysis

### Core Functionality
The current TypeScript implementation provides:
- Recursive directory scanning with exclusion filters
- Video file validation (9 supported formats)
- File metadata extraction (size, timestamps)
- Video ID generation using hash algorithm
- Folder extraction and organization
- Progress tracking during scans
- Error handling with custom error types

### Performance Bottlenecks
1. **Recursive Directory Traversal**: Node.js async I/O overhead for large directory trees
2. **File Stat Operations**: Multiple stat calls per file
3. **String Processing**: Video ID hash generation in JavaScript
4. **Memory Usage**: Accumulating video records in memory during scan

### API Surface
The scanner exposes these methods to Node.js:
- `scanVideos(folderPath: string): Promise<ScanResult>`
- `getProgress(): ScanProgress`
- `getVideos(): VideoRecord[]`
- `reset(): void`
- Helper methods (validation, metadata extraction)

## Migration Strategy

### Phase 1: Setup & Infrastructure

#### 1.1 Initialize Rust Project
```bash
npm install -D @napi-rs/cli
npx napi new
```

**Configuration:**
- Package name: `@vdotapes/video-scanner-native`
- Target platforms: macOS (darwin-x64, darwin-arm64), Windows (win32-x64), Linux (linux-x64)
- Build type: Hybrid (Rust + TypeScript fallback)

#### 1.2 Project Structure
```
src/
├── video-scanner.ts              # Original (to be replaced)
├── video-scanner-native/         # New Rust module
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs               # NAPI bindings
│   │   ├── scanner.rs           # Core scanner logic
│   │   ├── types.rs             # Type definitions
│   │   ├── metadata.rs          # File metadata operations
│   │   └── utils.rs             # Utilities
│   └── build.rs                 # Build configuration
└── video-scanner-wrapper.ts      # TS wrapper for native module
```

#### 1.3 Dependencies
```toml
[dependencies]
napi = "2.16"
napi-derive = "2.16"
walkdir = "2.4"           # Fast directory traversal
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
chrono = "0.4"            # Timestamp handling
rayon = "1.8"             # Parallel processing
```

### Phase 2: Core Implementation

#### 2.1 Type System Mapping

**Rust Types (types.rs):**
```rust
#[napi(object)]
pub struct VideoRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub folder: String,
    pub size: i64,
    pub last_modified: i64,
    pub created: i64,
    pub added_at: String,
    pub updated_at: String,
    pub duration: Option<f64>,
}

#[napi(object)]
pub struct ScanResult {
    pub success: bool,
    pub videos: Vec<VideoRecord>,
    pub folders: Vec<String>,
    pub stats: ScanStats,
    pub error: Option<String>,
}

#[napi(object)]
pub struct ScanProgress {
    pub is_scanning: bool,
    pub progress: f64,
    pub processed_files: i32,
    pub total_files: i32,
    pub total_videos: i32,
}
```

#### 2.2 Core Scanner Implementation (scanner.rs)

**Key Features:**
- Use `walkdir::WalkDir` for efficient recursive traversal
- Parallel processing with `rayon` for metadata extraction
- Atomic progress tracking with `Arc<Mutex<ProgressState>>`
- Zero-copy file path handling where possible

**Algorithm Improvements:**
- Single-pass directory scan (count + scan combined)
- Batch metadata operations
- Efficient hash algorithm (FNV or xxHash)
- Memory-mapped file stats for large directories

#### 2.3 NAPI Bindings (lib.rs)

**Exposed API:**
```rust
#[napi]
pub struct VideoScanner {
    // Internal state
}

#[napi]
impl VideoScanner {
    #[napi(constructor)]
    pub fn new() -> Self { }

    #[napi]
    pub async fn scan_videos(&self, folder_path: String)
        -> napi::Result<ScanResult> { }

    #[napi]
    pub fn get_progress(&self) -> ScanProgress { }

    #[napi]
    pub fn get_videos(&self) -> Vec<VideoRecord> { }

    #[napi]
    pub fn reset(&mut self) { }

    #[napi]
    pub fn is_valid_video_file(&self, filename: String) -> bool { }
}
```

### Phase 3: Integration

#### 3.1 TypeScript Wrapper (video-scanner-wrapper.ts)

```typescript
import { VideoScanner as NativeScanner } from './video-scanner-native';
import type { ScanResult, ScanProgress, VideoRecord } from '../types/core';

export class VideoScanner {
    private nativeScanner: NativeScanner;

    constructor() {
        this.nativeScanner = new NativeScanner();
    }

    async scanVideos(folderPath: string): Promise<ScanResult> {
        return this.nativeScanner.scanVideos(folderPath);
    }

    // ... other methods
}
```

#### 3.2 Fallback Strategy

Maintain TypeScript implementation as fallback:
- Detect native module availability at runtime
- Fall back to TypeScript if native module fails to load
- Log warning when using fallback

```typescript
let VideoScanner: any;
try {
    VideoScanner = require('./video-scanner-wrapper').VideoScanner;
} catch (e) {
    console.warn('Native scanner unavailable, using TypeScript fallback');
    VideoScanner = require('./video-scanner-fallback').VideoScanner;
}
export = VideoScanner;
```

### Phase 4: Build & Deployment

#### 4.1 Build Configuration

**package.json updates:**
```json
{
    "scripts": {
        "build:native": "napi build --platform --release",
        "build:native:debug": "napi build --platform",
        "artifacts": "napi artifacts",
        "prepublishOnly": "napi prepublish -t npm"
    },
    "napi": {
        "name": "video-scanner-native",
        "triples": {
            "defaults": true,
            "additional": [
                "x86_64-apple-darwin",
                "aarch64-apple-darwin",
                "x86_64-pc-windows-msvc"
            ]
        }
    }
}
```

#### 4.2 Electron Builder Integration

Update `electron-builder` configuration to include native modules:
```json
{
    "files": [
        "dist/**/*",
        "src/video-scanner-native/**/*.node"
    ],
    "asarUnpack": [
        "src/video-scanner-native/**/*.node"
    ]
}
```

#### 4.3 CI/CD Pipeline

**GitHub Actions workflow:**
- Build native modules for each platform
- Run tests on each platform
- Create artifacts for distribution
- Upload pre-built binaries to GitHub Releases

### Phase 5: Testing & Validation

#### 5.1 Unit Tests (Rust)
```rust
#[cfg(test)]
mod tests {
    #[test]
    fn test_video_file_validation() { }

    #[test]
    fn test_hash_generation() { }

    #[test]
    fn test_folder_extraction() { }
}
```

#### 5.2 Integration Tests (TypeScript)
- Compare Rust vs TypeScript results
- Test error handling
- Verify memory usage
- Benchmark performance

#### 5.3 Performance Benchmarks

Test scenarios:
- Small directory (100 videos)
- Medium directory (1,000 videos)
- Large directory (10,000+ videos)
- Deep nesting (10+ levels)
- Mixed file types

**Expected improvements:**
- 10-50x faster directory traversal
- 3-10x faster metadata extraction
- 50-80% reduction in memory usage

### Phase 6: Migration Path

#### 6.1 Development Workflow
1. Build Rust module: `npm run build:native`
2. Run in development: `npm run dev` (auto-loads native module)
3. Test fallback: `FORCE_FALLBACK=1 npm run dev`

#### 6.2 Gradual Rollout
1. **Alpha**: Enable for developers only
2. **Beta**: Enable with feature flag for testing
3. **Release**: Default to native, fallback available
4. **Stable**: Native only (remove TypeScript implementation)

#### 6.3 Rollback Plan
- Keep TypeScript implementation for 2-3 releases
- Monitor error rates and performance
- Easy rollback via environment variable
- Document known issues and platform quirks

## Technical Considerations

### Error Handling
- Map Rust errors to TypeScript error types
- Preserve stack traces across FFI boundary
- Handle platform-specific errors (permissions, etc.)

### Memory Management
- Use `napi::Reference` for long-lived objects
- Implement proper cleanup in destructors
- Monitor memory leaks with valgrind/instruments

### Platform Compatibility
- Test on macOS (Intel + ARM), Windows 10/11, Ubuntu
- Handle path separators correctly
- Test with Unicode filenames
- Verify symlink handling

### Security
- Validate all inputs from JavaScript
- Prevent path traversal attacks
- Handle malicious filenames safely
- Sanitize error messages (no path leaking)

## Success Metrics

### Performance Goals
- [ ] 20x+ faster on directories with 5,000+ videos
- [ ] 50%+ reduction in memory usage
- [ ] Sub-second scans for typical collections (500-1000 videos)

### Quality Goals
- [ ] 100% API compatibility with TypeScript version
- [ ] Zero regressions in functionality
- [ ] All existing tests pass
- [ ] Platform support: macOS, Windows, Linux

### Developer Experience
- [ ] Simple build process (`npm run build`)
- [ ] Clear error messages
- [ ] Documented API
- [ ] Migration guide for contributors

## Timeline Estimate

- **Week 1**: Setup infrastructure, project structure, basic NAPI bindings
- **Week 2**: Core scanner implementation, type mapping
- **Week 3**: Integration, wrapper, fallback mechanism
- **Week 4**: Testing, benchmarking, optimization
- **Week 5**: Documentation, CI/CD, deployment prep
- **Week 6**: Beta release, monitoring, bug fixes

**Total: 6 weeks for production-ready implementation**

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Cross-compilation complexity | High | Use GitHub Actions matrix builds |
| Native module loading failures | High | Maintain TypeScript fallback |
| Performance not meeting goals | Medium | Profile early, optimize incrementally |
| Breaking API changes needed | Medium | Version native module separately |
| Platform-specific bugs | Medium | Extensive cross-platform testing |

## Future Enhancements

Once Rust module is stable:
1. **Thumbnail generation**: FFmpeg bindings for video thumbnails
2. **Metadata extraction**: Full video metadata (duration, codec, etc.)
3. **Duplicate detection**: Perceptual hashing for similar videos
4. **Watch mode**: Real-time file system monitoring
5. **Database integration**: Direct SQLite writes from Rust

## Resources & References

- [napi-rs Documentation](https://napi.rs)
- [walkdir Crate](https://docs.rs/walkdir)
- [Electron Native Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [Rust FFI Best Practices](https://anssi-fr.github.io/rust-guide/)

## Appendix: Code Examples

### A. Hash Algorithm Comparison
Current TypeScript uses simple string hash. Rust alternatives:
- **FNV-1a**: Fast, good distribution, simple
- **xxHash**: Extremely fast, excellent distribution
- **SipHash**: Cryptographic, slower but secure

Recommendation: **xxHash** for best performance

### B. Parallel Processing Example
```rust
use rayon::prelude::*;

fn scan_directory(path: &Path) -> Vec<VideoRecord> {
    WalkDir::new(path)
        .into_iter()
        .par_bridge()  // Parallel iterator
        .filter_map(|entry| {
            // Process in parallel
        })
        .collect()
}
```

### C. Error Mapping
```rust
impl From<std::io::Error> for napi::Error {
    fn from(err: std::io::Error) -> Self {
        napi::Error::from_reason(format!("IO Error: {}", err))
    }
}
```

---

**Document Version:** 1.0
**Last Updated:** 2025-10-10
**Author:** Claude Code
**Status:** Planning Phase
