# Thumbnail Generator Rust Migration Plan

## Executive Summary

This document outlines the plan to migrate the stub `thumbnail-gen.js` module to a native Rust module using `napi-rs` and FFmpeg bindings. The Rust implementation will provide high-performance video thumbnail generation with hardware acceleration support, integrating seamlessly with the existing video scanner infrastructure.

## Current Implementation Analysis

### Core Functionality (Stub)
The current JavaScript implementation at [src/thumbnail-gen.js](../src/thumbnail-gen.js) provides:
- `initialize()`: Prepares the generator (currently no-op)
- `generateThumbnail(videoPath, timestamp)`: Should generate thumbnail at specified timestamp
- `getThumbnailPath(videoId)`: Should return path to cached thumbnail
- `cleanup()`: Resource cleanup

**Status**: All methods are stubs returning `null` - full implementation needed.

### Database Schema (Prepared)
The SQLite database has a `thumbnails` table ready:
- `video_id`: Foreign key to videos table
- `thumbnail_path`: File system path to thumbnail image
- `timestamp`: Point in video where thumbnail was captured
- `created_at`: Generation timestamp

### Integration Points
- **Database**: [src/database.js](../src/database.js) - SQLite operations
- **Video Scanner**: [src/video-scanner-native/](../src/video-scanner-native/) - Rust module reference
- **IPC Handlers**: Will need new IPC methods for thumbnail operations
- **Renderer**: [app/renderer.js](../app/renderer.js) - UI displays thumbnails

## Migration Strategy

### Phase 1: Setup & Infrastructure

#### 1.1 Rust Project Structure
Leverage existing `video-scanner-native` infrastructure:

```
src/
├── thumbnail-gen.js                    # Original stub (to be replaced)
├── thumbnail-generator-native/         # New Rust module
│   ├── Cargo.toml
│   ├── package.json                    # NAPI build config
│   ├── build.rs                        # Build configuration
│   ├── src/
│   │   ├── lib.rs                      # NAPI bindings
│   │   ├── generator.rs                # Core thumbnail generation
│   │   ├── ffmpeg.rs                   # FFmpeg wrapper
│   │   ├── cache.rs                    # Thumbnail cache management
│   │   ├── types.rs                    # Type definitions
│   │   └── utils.rs                    # Utilities
│   └── README.md
└── thumbnail-gen-wrapper.ts            # TypeScript wrapper
```

#### 1.2 Dependencies

**Cargo.toml:**
```toml
[dependencies]
# NAPI bindings
napi = "2.16"
napi-derive = "2.16"

# FFmpeg bindings
ffmpeg-next = "7.0"       # Safe FFmpeg wrapper
ffmpeg-sys-next = "7.0"   # FFmpeg C bindings

# Image processing
image = "0.25"            # Image manipulation & encoding

# Async runtime
tokio = { version = "1.40", features = ["rt-multi-thread", "fs"] }

# Serialization
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# Error handling
thiserror = "2.0"

# Hashing for cache keys
blake3 = "1.5"

# File system utilities
tempfile = "3.12"

[build-dependencies]
napi-build = "2.1"

[dev-dependencies]
criterion = "0.5"         # Benchmarking
```

**package.json:**
```json
{
  "name": "@vdotapes/thumbnail-generator-native",
  "version": "0.1.0",
  "scripts": {
    "build": "napi build --platform --release",
    "build:debug": "napi build --platform",
    "test": "cargo test"
  },
  "napi": {
    "name": "thumbnail-generator-native",
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

#### 1.3 FFmpeg Setup

**System Requirements:**
- FFmpeg libraries must be installed on build and runtime systems
- Required libraries: `libavcodec`, `libavformat`, `libavutil`, `libswscale`

**Platform-specific setup:**

**macOS:**
```bash
brew install ffmpeg pkg-config
```

**Windows:**
- Download FFmpeg shared libraries
- Set `FFMPEG_DIR` environment variable
- Include DLLs in application bundle

**Linux:**
```bash
sudo apt-get install libavcodec-dev libavformat-dev libavutil-dev libswscale-dev pkg-config
```

### Phase 2: Core Implementation

#### 2.1 Type System

**Rust Types (types.rs):**
```rust
use napi_derive::napi;

#[napi(object)]
pub struct ThumbnailConfig {
    pub width: u32,
    pub height: u32,
    pub quality: u8,        // JPEG quality 1-100
    pub format: String,      // "jpeg", "png", "webp"
}

#[napi(object)]
pub struct ThumbnailResult {
    pub success: bool,
    pub thumbnail_path: Option<String>,
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub file_size: i64,
    pub timestamp: f64,     // Seconds in video
    pub error: Option<String>,
}

#[napi(object)]
pub struct VideoMetadata {
    pub duration: f64,      // Total duration in seconds
    pub width: u32,
    pub height: u32,
    pub codec: String,
    pub bitrate: i64,
    pub fps: f64,
}

#[napi(object)]
pub struct GenerationProgress {
    pub is_generating: bool,
    pub current_file: Option<String>,
    pub progress: f64,      // 0.0 - 1.0
}
```

#### 2.2 FFmpeg Integration (ffmpeg.rs)

**Core Functionality:**
```rust
use ffmpeg_next as ffmpeg;

pub struct VideoDecoder {
    format_context: ffmpeg::format::context::Input,
    decoder: ffmpeg::decoder::Video,
    stream_index: usize,
}

impl VideoDecoder {
    /// Open video file and prepare decoder
    pub fn new(path: &str) -> Result<Self, ThumbnailError> {
        // Initialize FFmpeg
        // Open format context
        // Find video stream
        // Initialize decoder
    }

    /// Get video metadata
    pub fn metadata(&self) -> VideoMetadata {
        // Extract duration, dimensions, codec info
    }

    /// Seek to timestamp and decode frame
    pub fn decode_frame_at(&mut self, timestamp: f64)
        -> Result<ffmpeg::frame::Video, ThumbnailError> {
        // Seek to timestamp
        // Decode until keyframe found
        // Return RGB frame
    }
}
```

**Frame Extraction Algorithm:**
1. Seek to target timestamp (or smart position if timestamp is None)
2. Decode frames until clean keyframe found
3. Convert frame to RGB24 format using `swscale`
4. Return raw pixel data

**Smart Timestamp Selection:**
If no timestamp provided, use heuristics:
- Try 10% into video (skip intros)
- Fallback to 25% if 10% is black frame
- Validate frame isn't blank/corrupted

#### 2.3 Image Processing (generator.rs)

**Thumbnail Generation Pipeline:**
```rust
pub struct ThumbnailGenerator {
    config: ThumbnailConfig,
    cache_dir: PathBuf,
}

impl ThumbnailGenerator {
    /// Generate thumbnail from video
    pub async fn generate(
        &self,
        video_path: &str,
        timestamp: Option<f64>,
    ) -> Result<ThumbnailResult, ThumbnailError> {
        // 1. Open video and get metadata
        // 2. Determine timestamp
        // 3. Extract frame
        // 4. Resize to target dimensions
        // 5. Encode to target format
        // 6. Save to cache directory
        // 7. Return result
    }

    /// Resize frame maintaining aspect ratio
    fn resize_frame(&self, frame: RgbImage, target_w: u32, target_h: u32)
        -> RgbImage {
        // Use high-quality Lanczos3 filter
        // Maintain aspect ratio (letterbox if needed)
    }

    /// Encode image to target format
    fn encode_image(&self, image: &RgbImage, format: &str, quality: u8)
        -> Result<Vec<u8>, ThumbnailError> {
        // JPEG: libjpeg-turbo via image crate
        // PNG: Optimized PNG encoding
        // WebP: High compression (if needed)
    }
}
```

**Performance Optimizations:**
- Hardware-accelerated decoding (when available)
- SIMD-optimized image resizing
- Memory pooling for frame buffers
- Parallel batch generation

#### 2.4 Cache Management (cache.rs)

**Cache Strategy:**
```rust
pub struct ThumbnailCache {
    cache_dir: PathBuf,
    max_cache_size: u64,    // Bytes
}

impl ThumbnailCache {
    /// Generate cache key from video path + timestamp
    pub fn cache_key(video_path: &str, timestamp: f64) -> String {
        // Use BLAKE3 hash for fast, collision-resistant keys
        let mut hasher = blake3::Hasher::new();
        hasher.update(video_path.as_bytes());
        hasher.update(&timestamp.to_le_bytes());
        hasher.finalize().to_hex().to_string()
    }

    /// Check if thumbnail exists in cache
    pub async fn get(&self, key: &str) -> Option<PathBuf> {
        // Check if file exists
        // Verify not corrupted
        // Update access time
    }

    /// Save thumbnail to cache
    pub async fn put(&self, key: &str, data: &[u8])
        -> Result<PathBuf, ThumbnailError> {
        // Save to temporary file
        // Atomic rename to final location
        // Enforce cache size limits
    }

    /// Evict old entries if cache too large
    pub async fn evict_lru(&self) -> Result<(), ThumbnailError> {
        // Scan cache directory
        // Sort by access time
        // Delete oldest until under limit
    }
}
```

**Cache Directory Structure:**
```
~/.vdotapes/thumbnails/
├── ab/
│   ├── abc123...def.jpg
│   └── abc456...ghi.jpg
├── cd/
│   └── cde789...jkl.jpg
└── cache.db              # Optional: SQLite index for fast lookups
```

#### 2.5 NAPI Bindings (lib.rs)

**JavaScript API:**
```rust
#[napi]
pub struct ThumbnailGenerator {
    generator: Arc<Mutex<InnerGenerator>>,
    cache: Arc<ThumbnailCache>,
}

#[napi]
impl ThumbnailGenerator {
    #[napi(constructor)]
    pub fn new(cache_dir: Option<String>) -> napi::Result<Self> {
        // Initialize FFmpeg
        // Setup cache directory
        // Create generator instance
    }

    /// Generate thumbnail for video
    #[napi]
    pub async fn generate_thumbnail(
        &self,
        video_path: String,
        timestamp: Option<f64>,
    ) -> napi::Result<ThumbnailResult> {
        // Check cache first
        // Generate if not cached
        // Return result
    }

    /// Get thumbnail path (from cache)
    #[napi]
    pub async fn get_thumbnail_path(
        &self,
        video_path: String,
        timestamp: Option<f64>,
    ) -> napi::Result<Option<String>> {
        // Check cache only
        // Return path or None
    }

    /// Extract video metadata without generating thumbnail
    #[napi]
    pub async fn get_video_metadata(
        &self,
        video_path: String,
    ) -> napi::Result<VideoMetadata> {
        // Open video
        // Extract metadata
        // Return without decoding frames
    }

    /// Batch generate thumbnails
    #[napi]
    pub async fn generate_batch(
        &self,
        video_paths: Vec<String>,
        #[napi(ts_arg_type = "(progress: GenerationProgress) => void")]
        progress_callback: napi::JsFunction,
    ) -> napi::Result<Vec<ThumbnailResult>> {
        // Parallel generation with progress updates
        // Call JS callback for progress
        // Return all results
    }

    /// Clear thumbnail cache
    #[napi]
    pub async fn clear_cache(&self) -> napi::Result<()> {
        // Delete all cached thumbnails
        // Reset cache state
    }

    /// Get cache statistics
    #[napi]
    pub fn get_cache_stats(&self) -> napi::Result<CacheStats> {
        // Count files
        // Calculate total size
        // Return stats
    }
}

#[napi(object)]
pub struct CacheStats {
    pub total_thumbnails: i32,
    pub total_size_bytes: i64,
    pub cache_dir: String,
}
```

### Phase 3: Integration

#### 3.1 TypeScript Wrapper (thumbnail-gen-wrapper.ts)

```typescript
import { ThumbnailGenerator as NativeGenerator } from './thumbnail-generator-native';
import type {
    ThumbnailResult,
    VideoMetadata,
    ThumbnailConfig,
    GenerationProgress
} from '../types/core';
import path from 'path';
import { app } from 'electron';

export class ThumbnailGenerator {
    private nativeGenerator: NativeGenerator;
    private cacheDir: string;

    constructor() {
        // Use app's userData directory for cache
        this.cacheDir = path.join(
            app.getPath('userData'),
            'thumbnails'
        );

        this.nativeGenerator = new NativeGenerator(this.cacheDir);
    }

    async initialize(): Promise<void> {
        // Ensure cache directory exists
        // Native module handles FFmpeg init
        console.log('ThumbnailGenerator initialized (native)');
    }

    async generateThumbnail(
        videoPath: string,
        timestamp?: number
    ): Promise<ThumbnailResult> {
        return this.nativeGenerator.generateThumbnail(
            videoPath,
            timestamp ?? null
        );
    }

    async getThumbnailPath(
        videoPath: string,
        timestamp?: number
    ): Promise<string | null> {
        return this.nativeGenerator.getThumbnailPath(
            videoPath,
            timestamp ?? null
        );
    }

    async getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
        return this.nativeGenerator.getVideoMetadata(videoPath);
    }

    async generateBatch(
        videoPaths: string[],
        onProgress?: (progress: GenerationProgress) => void
    ): Promise<ThumbnailResult[]> {
        return this.nativeGenerator.generateBatch(
            videoPaths,
            onProgress || (() => {})
        );
    }

    async clearCache(): Promise<void> {
        return this.nativeGenerator.clearCache();
    }

    getCacheStats() {
        return this.nativeGenerator.getCacheStats();
    }

    cleanup(): void {
        // Native module handles cleanup in destructor
        console.log('ThumbnailGenerator cleaned up');
    }
}
```

#### 3.2 IPC Handler Integration

**New IPC Methods (ipc-handlers.ts):**
```typescript
import ThumbnailGenerator from './thumbnail-gen-wrapper';

const thumbnailGenerator = new ThumbnailGenerator();
await thumbnailGenerator.initialize();

ipcMain.handle('generate-thumbnail', async (event, videoPath, timestamp) => {
    try {
        return await thumbnailGenerator.generateThumbnail(videoPath, timestamp);
    } catch (error) {
        console.error('Thumbnail generation failed:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-thumbnail-path', async (event, videoPath, timestamp) => {
    return await thumbnailGenerator.getThumbnailPath(videoPath, timestamp);
});

ipcMain.handle('get-video-metadata', async (event, videoPath) => {
    return await thumbnailGenerator.getVideoMetadata(videoPath);
});

ipcMain.handle('generate-thumbnails-batch', async (event, videoPaths) => {
    return await thumbnailGenerator.generateBatch(
        videoPaths,
        (progress) => {
            event.sender.send('thumbnail-progress', progress);
        }
    );
});

ipcMain.handle('clear-thumbnail-cache', async () => {
    return await thumbnailGenerator.clearCache();
});
```

#### 3.3 Preload API (preload.js)

```javascript
contextBridge.exposeInMainWorld('vdoTapesAPI', {
    // ... existing APIs

    // Thumbnail APIs
    generateThumbnail: (videoPath, timestamp) =>
        ipcRenderer.invoke('generate-thumbnail', videoPath, timestamp),

    getThumbnailPath: (videoPath, timestamp) =>
        ipcRenderer.invoke('get-thumbnail-path', videoPath, timestamp),

    getVideoMetadata: (videoPath) =>
        ipcRenderer.invoke('get-video-metadata', videoPath),

    generateThumbnailsBatch: (videoPaths) =>
        ipcRenderer.invoke('generate-thumbnails-batch', videoPaths),

    onThumbnailProgress: (callback) =>
        ipcRenderer.on('thumbnail-progress', (_, progress) => callback(progress)),

    clearThumbnailCache: () =>
        ipcRenderer.invoke('clear-thumbnail-cache'),
});
```

#### 3.4 UI Integration (renderer.js)

**Display thumbnails in grid:**
```javascript
async function loadVideoThumbnail(videoPath, gridItem) {
    // Check if thumbnail exists
    const thumbnailPath = await window.vdoTapesAPI.getThumbnailPath(videoPath);

    if (thumbnailPath) {
        gridItem.style.backgroundImage = `url('file://${thumbnailPath}')`;
    } else {
        // Generate in background
        window.vdoTapesAPI.generateThumbnail(videoPath)
            .then(result => {
                if (result.success && result.thumbnail_path) {
                    gridItem.style.backgroundImage =
                        `url('file://${result.thumbnail_path}')`;
                }
            });
    }
}
```

**Batch generation on folder scan:**
```javascript
async function onFolderScanned(videos) {
    // Generate all thumbnails in background
    const videoPaths = videos.map(v => v.path);

    window.vdoTapesAPI.onThumbnailProgress((progress) => {
        updateProgressBar(progress.progress);
    });

    await window.vdoTapesAPI.generateThumbnailsBatch(videoPaths);

    // Refresh grid to show thumbnails
    refreshVideoGrid();
}
```

### Phase 4: Build & Deployment

#### 4.1 Build Configuration

**package.json updates:**
```json
{
    "scripts": {
        "build:thumbnails": "cd src/thumbnail-generator-native && npm run build",
        "build:thumbnails:debug": "cd src/thumbnail-generator-native && npm run build:debug",
        "build:all": "npm run build:native && npm run build:thumbnails && npm run build:ts",
        "copy:native": "mkdir -p dist/main/src && cp src/video-scanner-native/*.node dist/main/src/video-scanner-native/ 2>/dev/null && cp src/thumbnail-generator-native/*.node dist/main/src/thumbnail-generator-native/ 2>/dev/null || true"
    }
}
```

#### 4.2 Electron Builder Configuration

**Update build config:**
```json
{
    "files": [
        "dist/main/**",
        "app/**/*.{js,html,css,png}",
        "src/video-scanner-native/**/*.node",
        "src/thumbnail-generator-native/**/*.node",
        "node_modules/**/*"
    ],
    "asarUnpack": [
        "src/video-scanner-native/**/*.node",
        "src/thumbnail-generator-native/**/*.node"
    ],
    "mac": {
        "extraResources": [
            {
                "from": "/opt/homebrew/opt/ffmpeg/lib",
                "to": "ffmpeg-libs",
                "filter": ["*.dylib"]
            }
        ]
    },
    "win": {
        "extraResources": [
            {
                "from": "ffmpeg/bin",
                "to": "ffmpeg-libs",
                "filter": ["*.dll"]
            }
        ]
    }
}
```

#### 4.3 FFmpeg Distribution

**macOS:**
- Bundle FFmpeg dylibs in app resources
- Set `DYLD_LIBRARY_PATH` at runtime
- Use `install_name_tool` to fix library paths

**Windows:**
- Include FFmpeg DLLs in application directory
- Windows will find DLLs automatically
- Ship both x64 builds

**Linux:**
- Assume system FFmpeg installation
- Document required packages in README
- Consider AppImage with bundled FFmpeg

### Phase 5: Testing & Validation

#### 5.1 Unit Tests (Rust)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_key_generation() {
        let key1 = ThumbnailCache::cache_key("/path/to/video.mp4", 10.0);
        let key2 = ThumbnailCache::cache_key("/path/to/video.mp4", 10.0);
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_video_metadata_extraction() {
        // Use test video file
        let decoder = VideoDecoder::new("tests/fixtures/sample.mp4").unwrap();
        let metadata = decoder.metadata();
        assert!(metadata.duration > 0.0);
    }

    #[tokio::test]
    async fn test_thumbnail_generation() {
        let generator = ThumbnailGenerator::new("/tmp/test-cache").unwrap();
        let result = generator.generate(
            "tests/fixtures/sample.mp4",
            Some(5.0)
        ).await.unwrap();
        assert!(result.success);
        assert!(result.thumbnail_path.is_some());
    }

    #[test]
    fn test_image_resizing() {
        // Test aspect ratio preservation
        // Test letterboxing
        // Test quality settings
    }
}
```

#### 5.2 Integration Tests (TypeScript)

```typescript
describe('ThumbnailGenerator', () => {
    let generator: ThumbnailGenerator;

    beforeEach(async () => {
        generator = new ThumbnailGenerator();
        await generator.initialize();
    });

    afterEach(() => {
        generator.cleanup();
    });

    it('should generate thumbnail for valid video', async () => {
        const result = await generator.generateThumbnail(
            'test/fixtures/sample.mp4',
            5.0
        );
        expect(result.success).toBe(true);
        expect(result.thumbnail_path).toBeTruthy();
    });

    it('should use cached thumbnail on second call', async () => {
        const result1 = await generator.generateThumbnail('test.mp4', 5.0);
        const result2 = await generator.generateThumbnail('test.mp4', 5.0);
        expect(result1.thumbnail_path).toBe(result2.thumbnail_path);
    });

    it('should handle batch generation', async () => {
        const videos = ['test1.mp4', 'test2.mp4', 'test3.mp4'];
        const results = await generator.generateBatch(videos);
        expect(results.length).toBe(3);
    });
});
```

#### 5.3 Performance Benchmarks

**Test Scenarios:**
- Single thumbnail generation (cold)
- Single thumbnail generation (cached)
- Batch generation (10 videos)
- Batch generation (100 videos)
- Different video formats (MP4, MKV, AVI)
- Different resolutions (480p, 720p, 1080p, 4K)
- Hardware acceleration vs software decode

**Expected Performance:**
- Single thumbnail: < 500ms (software), < 200ms (hardware)
- Cached retrieval: < 10ms
- Batch (10 videos): < 2 seconds with parallelism
- Memory usage: < 100MB per concurrent generation

### Phase 6: Migration Path

#### 6.1 Development Workflow

```bash
# Build native module
npm run build:thumbnails

# Run with native thumbnails
npm run dev

# Test without native module (uses stubs)
SKIP_NATIVE_THUMBNAILS=1 npm run dev
```

#### 6.2 Feature Flags

**Gradual rollout strategy:**
```typescript
// In main.js
const USE_NATIVE_THUMBNAILS =
    !process.env.SKIP_NATIVE_THUMBNAILS &&
    isNativeModuleAvailable();

if (USE_NATIVE_THUMBNAILS) {
    const ThumbnailGenerator = require('./thumbnail-gen-wrapper');
} else {
    console.warn('Using stub thumbnail generator');
    const ThumbnailGenerator = require('./thumbnail-gen');
}
```

#### 6.3 Error Handling & Fallback

**Graceful degradation:**
- If native module fails to load: Show videos without thumbnails
- If FFmpeg missing: Display placeholder images
- If generation fails: Log error, continue with other videos
- Network drives: Handle slow I/O gracefully

## Technical Considerations

### Hardware Acceleration

**Platform Support:**
- **macOS**: VideoToolbox (H.264/HEVC)
- **Windows**: DXVA2, D3D11VA (H.264/HEVC/VP9)
- **Linux**: VAAPI, VDPAU (varies by hardware)

**Implementation:**
```rust
// Auto-detect best decoder
fn create_decoder(codec: &str) -> Decoder {
    if let Some(hw_decoder) = try_hardware_decoder(codec) {
        hw_decoder
    } else {
        software_decoder(codec)
    }
}
```

### Memory Management

**FFmpeg Resources:**
- Properly deallocate frames, contexts, packets
- Implement `Drop` trait for all FFmpeg wrappers
- Use RAII pattern for resource safety

**Image Buffers:**
- Reuse buffers for batch operations
- Stream large images to disk
- Limit concurrent generations to control memory

### Error Handling

**Error Categories:**
```rust
#[derive(thiserror::Error, Debug)]
pub enum ThumbnailError {
    #[error("Video file not found: {0}")]
    FileNotFound(String),

    #[error("FFmpeg error: {0}")]
    FFmpegError(String),

    #[error("Invalid timestamp: {0}")]
    InvalidTimestamp(f64),

    #[error("Encoding error: {0}")]
    EncodingError(String),

    #[error("Cache error: {0}")]
    CacheError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}
```

### Security Considerations

**Input Validation:**
- Sanitize video paths (prevent traversal)
- Validate timestamp ranges
- Limit image output sizes
- Verify video file integrity

**Resource Limits:**
- Max thumbnail dimensions (prevent memory bombs)
- Timeout for generation (prevent hangs)
- Cache size limits
- Concurrent generation limits

### Cross-Platform Compatibility

**Path Handling:**
- Use `std::path::PathBuf` for all paths
- Handle Windows UNC paths
- Support Unicode filenames
- Test with special characters

**FFmpeg Versions:**
- Minimum version: FFmpeg 4.4
- Test with FFmpeg 5.x, 6.x
- Handle API differences gracefully

## Success Metrics

### Performance Goals
- [ ] < 500ms per thumbnail (1080p video, software decode)
- [ ] < 200ms per thumbnail (with hardware acceleration)
- [ ] < 10ms cache retrieval
- [ ] 10+ concurrent generations without memory issues

### Quality Goals
- [ ] Thumbnails are clear and representative
- [ ] No corrupted or black frames
- [ ] Proper aspect ratio preservation
- [ ] JPEG quality 85+ (configurable)

### Reliability Goals
- [ ] 99%+ generation success rate
- [ ] Graceful handling of corrupted videos
- [ ] No memory leaks over extended use
- [ ] Works with all supported video formats

### Developer Experience
- [ ] Simple API (3-4 main methods)
- [ ] Clear error messages
- [ ] Documented FFmpeg setup
- [ ] Example code provided

## Timeline Estimate

- **Week 1**: FFmpeg setup, basic decoder implementation
- **Week 2**: Thumbnail generation pipeline, image processing
- **Week 3**: Cache system, NAPI bindings
- **Week 4**: Integration with UI, IPC handlers
- **Week 5**: Testing, optimization, hardware acceleration
- **Week 6**: Cross-platform testing, documentation
- **Week 7**: Bundle FFmpeg, deployment setup
- **Week 8**: Beta release, bug fixes, performance tuning

**Total: 8 weeks for production-ready implementation**

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| FFmpeg complexity | High | Use `ffmpeg-next` safe wrapper, extensive testing |
| Hardware acceleration issues | Medium | Always have software fallback |
| FFmpeg bundling size | Medium | Use dynamic linking, ship only needed codecs |
| Cross-platform FFmpeg differences | High | Test on all platforms, CI/CD matrix builds |
| Memory leaks in FFmpeg usage | High | Extensive leak testing, proper resource cleanup |
| Video file compatibility | Medium | Test with wide variety of formats/codecs |

## Future Enhancements

1. **Animated Thumbnails**: Generate GIFs or short WebP animations
2. **Smart Scene Detection**: Choose most interesting frame automatically
3. **Thumbnail Strips**: Multiple thumbnails for video timeline preview
4. **GPU-Accelerated Encoding**: Use GPU for JPEG encoding
5. **Video Previews**: Generate preview videos (scrubbing thumbnails)
6. **ML-Based Selection**: Use ML to pick best thumbnail frame
7. **Thumbnail Customization**: User-selectable timestamp, overlays
8. **Cloud Backup**: Sync thumbnails across devices

## Resources & References

- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [ffmpeg-next Crate](https://docs.rs/ffmpeg-next/)
- [napi-rs Documentation](https://napi.rs)
- [image Crate](https://docs.rs/image/)
- [Hardware Acceleration Guide](https://trac.ffmpeg.org/wiki/HWAccelIntro)
- [Electron Native Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)

## Appendix: Code Examples

### A. Basic Thumbnail Generation

```rust
pub async fn generate_simple_thumbnail(
    video_path: &str,
    output_path: &str,
) -> Result<(), ThumbnailError> {
    // Initialize FFmpeg
    ffmpeg::init()?;

    // Open video
    let mut input = ffmpeg::format::input(&video_path)?;
    let video_stream = input
        .streams()
        .best(ffmpeg::media::Type::Video)
        .ok_or(ThumbnailError::NoVideoStream)?;

    let stream_index = video_stream.index();

    // Setup decoder
    let context = ffmpeg::codec::context::Context::from_parameters(
        video_stream.parameters()
    )?;
    let mut decoder = context.decoder().video()?;

    // Seek to 10% of video
    let duration = video_stream.duration() as f64;
    let timestamp = (duration * 0.1) as i64;
    input.seek(timestamp, ..timestamp)?;

    // Decode frame
    for (stream, packet) in input.packets() {
        if stream.index() == stream_index {
            decoder.send_packet(&packet)?;

            let mut frame = ffmpeg::frame::Video::empty();
            if decoder.receive_frame(&mut frame).is_ok() {
                // Convert to RGB
                let mut rgb_frame = ffmpeg::frame::Video::empty();
                let mut scaler = ffmpeg::software::scaling::context::Context::get(
                    frame.format(),
                    frame.width(),
                    frame.height(),
                    ffmpeg::format::Pixel::RGB24,
                    1280,
                    720,
                    ffmpeg::software::scaling::Flags::BILINEAR,
                )?;
                scaler.run(&frame, &mut rgb_frame)?;

                // Save as JPEG
                save_as_jpeg(&rgb_frame, output_path)?;
                break;
            }
        }
    }

    Ok(())
}
```

### B. Smart Frame Selection

```rust
/// Detect if frame is mostly black
fn is_black_frame(frame: &ffmpeg::frame::Video) -> bool {
    let data = frame.data(0);
    let total_pixels = (frame.width() * frame.height()) as usize;
    let black_pixels = data.iter()
        .filter(|&&pixel| pixel < 20)
        .count();

    (black_pixels as f64 / total_pixels as f64) > 0.9
}

/// Find best frame in range
fn find_best_frame(
    decoder: &mut Decoder,
    start: f64,
    end: f64,
) -> Result<ffmpeg::frame::Video, ThumbnailError> {
    let mut best_frame = None;
    let mut best_variance = 0.0;

    // Try multiple timestamps
    for timestamp in [start, start + 5.0, start + 10.0] {
        let frame = decode_frame_at(decoder, timestamp)?;

        if is_black_frame(&frame) {
            continue;
        }

        let variance = calculate_variance(&frame);
        if variance > best_variance {
            best_variance = variance;
            best_frame = Some(frame);
        }
    }

    best_frame.ok_or(ThumbnailError::NoValidFrame)
}
```

### C. Batch Processing with Progress

```rust
pub async fn generate_batch_with_progress(
    video_paths: Vec<String>,
    progress_tx: mpsc::Sender<GenerationProgress>,
) -> Vec<ThumbnailResult> {
    let total = video_paths.len();
    let results = Arc::new(Mutex::new(Vec::new()));

    // Process in parallel (4 concurrent)
    let semaphore = Arc::new(Semaphore::new(4));
    let mut tasks = Vec::new();

    for (idx, path) in video_paths.into_iter().enumerate() {
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let progress_tx = progress_tx.clone();
        let results = results.clone();

        tasks.push(tokio::spawn(async move {
            let result = generate_thumbnail(&path, None).await;

            results.lock().unwrap().push(result);

            let progress = (idx + 1) as f64 / total as f64;
            progress_tx.send(GenerationProgress {
                is_generating: true,
                current_file: Some(path),
                progress,
            }).await.ok();

            drop(permit);
        }));
    }

    // Wait for all
    for task in tasks {
        task.await.ok();
    }

    Arc::try_unwrap(results).unwrap().into_inner().unwrap()
}
```

---

**Document Version:** 1.0
**Last Updated:** 2025-10-10
**Author:** Claude Code
**Status:** Planning Phase
