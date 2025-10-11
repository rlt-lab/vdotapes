# Migration Guide: TypeScript to Rust Video Scanner

## Phase 1: Infrastructure Setup (COMPLETED)

This document tracks the migration of the video scanner from TypeScript to Rust using napi-rs.

### What Was Created

1. **Project Structure**
   - `/src/video-scanner-native/` - Root directory for Rust native module
   - `/src/video-scanner-native/src/` - Rust source files
   - `/src/video-scanner-native/target/` - Cargo build artifacts (gitignored)

2. **Configuration Files**
   - `Cargo.toml` - Rust dependencies and build configuration
   - `package.json` - NPM package configuration with napi-rs settings
   - `build.rs` - Build script for napi-build
   - `.gitignore` - Excludes build artifacts

3. **Rust Source Files**
   - `lib.rs` - NAPI bindings and exported functions
   - `scanner.rs` - Core video scanning logic (placeholder implementation)
   - `types.rs` - Type definitions and helper functions

4. **TypeScript Bindings**
   - `index.js` - Platform-specific native module loader
   - `index.d.ts` - TypeScript type definitions

5. **Documentation**
   - `README.md` - API documentation and usage examples
   - `MIGRATION.md` - This file

### Build Configuration

#### Supported Platforms
- macOS Intel: `x86_64-apple-darwin`
- macOS Apple Silicon: `aarch64-apple-darwin`
- Windows x64: `x86_64-pc-windows-msvc`
- Linux x64: `x86_64-unknown-linux-gnu`

#### Build Commands
```bash
# Development build (debug)
npm run build:native:debug

# Production build (release, optimized)
npm run build:native

# Build all (native + TypeScript)
npm run build:all
```

### API Surface

The Rust module exports the following:

#### Class-based API
```typescript
class VideoScannerNative {
  constructor();
  scanVideos(folderPath: string): ScanResult;
  getProgress(): ScanProgress;
  reset(): void;
  isValidVideoFile(filename: string): boolean;
}
```

#### Functional API
```typescript
function scanVideosSync(folderPath: string): ScanResult;
function isValidVideo(filename: string): boolean;
function getSupportedExtensions(): string[];
```

### Type Mapping: TypeScript → Rust

| TypeScript | Rust | Notes |
|------------|------|-------|
| `VideoId` (branded string) | `String` | ID generation in Rust |
| `FilePath` (branded string) | `String` | No validation yet |
| `Timestamp` (branded number) | `f64` | Milliseconds since epoch |
| `number` (size) | `f64` | JavaScript safe integer range |
| `VideoRecord` | `VideoMetadata` | Slight rename, same structure |
| `ScanResult` | `ScanResult` | Direct mapping |
| `ScanProgress` | `ScanProgress` | Direct mapping |

### Important Notes

1. **Number Types**: JavaScript numbers are f64, so all numeric types use f64 in Rust bindings
   - `u64` → `f64` for file sizes
   - `i64` → `f64` for timestamps
   - `usize` → `u32` for counts (safe within range)

2. **Borrow Checker**: The scanner uses static methods to avoid borrow checker issues with WalkDir iteration

3. **Error Handling**: Current implementation returns Result types in scan results rather than throwing exceptions

4. **Performance**: Release builds use LTO and stripping for optimal binary size

### Next Steps (Phase 2)

1. **Implement Full Scanner Logic**
   - [ ] Add proper error handling with custom error types
   - [ ] Implement progress callbacks/events
   - [ ] Add cancellation support
   - [ ] Optimize directory traversal

2. **Add Video Metadata Extraction**
   - [ ] Integrate ffmpeg/ffprobe for duration, dimensions, codec
   - [ ] Add thumbnail generation
   - [ ] Handle corrupted files gracefully

3. **Integration**
   - [ ] Create adapter layer for existing TypeScript code
   - [ ] Add integration tests
   - [ ] Benchmark against TypeScript implementation
   - [ ] Update IPC handlers to use native module

4. **Platform-Specific Builds**
   - [ ] Set up CI/CD for cross-platform builds
   - [ ] Test on all target platforms
   - [ ] Create universal binary for macOS

### Testing

Run tests with:
```bash
cd src/video-scanner-native
cargo test
```

Current test coverage:
- [x] Video file validation
- [x] Video ID generation
- [x] Scanner initialization
- [x] Scanner reset

### Dependencies

**Rust Crates:**
- `napi` 2.16 - NAPI bindings
- `napi-derive` 2.16 - Procedural macros
- `walkdir` 2.5 - Directory traversal
- `serde` 1.0 - Serialization
- `serde_json` 1.0 - JSON support
- `chrono` 0.4 - Date/time handling

**Build Dependencies:**
- `napi-build` 2.1 - Build script support

### Performance Characteristics

The Rust implementation provides:
- Zero-cost abstractions
- No garbage collection pauses
- Efficient memory usage
- Fast directory traversal with walkdir
- Optimized release builds with LTO

### Troubleshooting

**Module Load Errors:**
- Ensure the `.node` file exists for your platform
- Check that Rust toolchain is installed
- Rebuild with `npm run build:native`

**Type Errors:**
- Run `cargo clippy` for Rust linting
- Check TypeScript definitions in `index.d.ts`

**Build Failures:**
- Verify Rust version: `rustc --version` (tested with 1.89.0)
- Clean build: `cargo clean && npm run build:native`
