# VDOTapes Rust + TypeScript Refactor Plan

## Architecture Overview
Transform VDOTapes from Electron/Node.js to a **Rust backend + Web frontend** architecture using **Tauri** for desktop integration and **Neon bindings** for Node.js compatibility.

## Technology Stack

### Backend (Rust)
- **Tauri** - Desktop app framework (lighter than Electron)
- **Neon** - Node.js bindings for gradual migration
- **SQLite (rusqlite)** - Database operations
- **Blake3/xxHash** - Fast file hashing
- **Tokio** - Async runtime for background tasks
- **FFmpeg-rs** - Video metadata/thumbnail extraction
- **Rayon** - Parallel processing for batch operations

### Frontend (TypeScript/HTML/CSS)
- **TypeScript** - Type-safe frontend code
- **Vite** - Fast build tooling
- **Web Components** - Modern UI components
- **CSS Grid/Flexbox** - Responsive layouts
- **Web Workers** - Background processing

## Implementation Phases

### Phase 1: Rust Core Foundation (Week 1-2)
1. **Project Setup**
   - Initialize Rust workspace with Cargo
   - Set up Tauri project structure
   - Configure Neon bindings for Node.js compatibility
   - Create core type definitions and error handling

2. **File Operations Module**
   ```
   rust-core/
   ├── src/
   │   ├── file_ops/
   │   │   ├── scanner.rs       # Recursive video scanning
   │   │   ├── filter.rs        # Video format filtering
   │   │   ├── sorter.rs        # Sorting algorithms
   │   │   └── batch_ops.rs     # Move/rename/delete
   ```

3. **Database Module**
   ```
   ├── database/
   │   ├── schema.rs            # SQLite schema
   │   ├── migrations.rs        # Migration system
   │   ├── operations.rs        # CRUD operations
   │   └── indexing.rs          # Fast text search
   ```

### Phase 2: Performance & Memory (Week 2-3)
1. **Memory Management**
   - Video buffer pool with configurable limits
   - Smart cleanup of inactive resources
   - Memory-mapped file operations for large videos

2. **Hardware Acceleration**
   - GPU-accelerated thumbnail generation (via FFmpeg)
   - Parallel processing with Rayon
   - Efficient sorting for 10,000+ videos

3. **Background Processing**
   - Tokio async runtime for non-blocking operations
   - Progress reporting via channels
   - Cancellable operations

### Phase 3: File Validation System (Week 3-4)
1. **Integrity Checking**
   - Blake3 hashing for fast integrity checks
   - Incremental validation scheduling
   - Background validation without UI blocking

2. **Validation Features**
   - Missing file detection
   - Video format validation
   - Corruption detection and quarantine
   - Validation report generation

### Phase 4: Tauri Integration (Week 4-5)
1. **IPC Commands**
   ```rust
   #[tauri::command]
   async fn scan_videos(path: String) -> Result<ScanResult>
   #[tauri::command]
   async fn batch_move(videos: Vec<VideoId>, target: String) -> Result<Progress>
   #[tauri::command]
   async fn validate_files(videos: Vec<VideoId>) -> Result<ValidationReport>
   ```

2. **Event System**
   - Progress events for long operations
   - File system watcher integration
   - Drive connection/disconnection handling

### Phase 5: Frontend Migration (Week 5-6)
1. **TypeScript Conversion**
   - Convert existing JS files to TypeScript
   - Add type definitions for Rust IPC
   - Implement type-safe state management

2. **UI Components**
   ```
   frontend/
   ├── components/
   │   ├── VideoGrid.ts         # Gallery rendering
   │   ├── VideoPlayer.ts       # Playback controls
   │   ├── ProgressBar.ts       # Operation progress
   │   └── TagManager.ts        # Tag UI
   ```

3. **State Management**
   - Client-side state for UI preferences
   - Rust-backed state for data operations
   - Efficient sync between frontend/backend

## Key Implementation Details

### Rust File Operations
```rust
// High-performance video scanner
pub struct VideoScanner {
    extensions: HashSet<String>,
    pool: ThreadPool,
}

impl VideoScanner {
    pub async fn scan(&self, path: &Path) -> Result<Vec<VideoFile>> {
        // Parallel directory traversal
        // Format validation
        // Metadata extraction
    }
}
```

### Database Schema (SQLite)
```sql
-- Optimized for relative paths (portable)
CREATE TABLE videos (
    id TEXT PRIMARY KEY,
    relative_path TEXT NOT NULL,
    folder TEXT,
    size INTEGER,
    hash TEXT,  -- Blake3 hash
    metadata JSON,
    UNIQUE(relative_path)
);

CREATE INDEX idx_folder ON videos(folder);
CREATE INDEX idx_hash ON videos(hash);
```

### Memory Management
```rust
pub struct VideoBufferPool {
    max_memory: usize,
    active_buffers: LruCache<VideoId, VideoBuffer>,
}

impl VideoBufferPool {
    pub fn get_or_load(&mut self, id: VideoId) -> Result<&VideoBuffer> {
        // Smart caching with automatic cleanup
    }
}
```

### Export/Import System
```rust
pub struct BackupManager {
    pub fn export_metadata(&self) -> Result<BackupData> {
        // Export favorites, tags, metadata
        // Machine-transferable format
    }

    pub fn import_metadata(&self, data: BackupData) -> Result<ImportReport> {
        // Validate and merge imported data
    }
}
```

## Migration Strategy

### Gradual Migration Path
1. **Phase 1**: Add Rust core alongside existing Electron
2. **Phase 2**: Use Neon bindings to call Rust from Node.js
3. **Phase 3**: Migrate UI to Tauri webview
4. **Phase 4**: Remove Electron dependencies
5. **Phase 5**: Optimize and polish

### Compatibility Layer
- Maintain existing IPC API surface initially
- Gradual transition to Tauri commands
- Support both architectures during migration

## Performance Targets
- **Scan Speed**: 10,000 videos in <5 seconds
- **Memory Usage**: <200MB for 50,000 videos
- **Thumbnail Generation**: 100 videos/second (GPU)
- **Validation**: Background validation of 1000 videos/minute
- **App Size**: <50MB (vs 200MB+ with Electron)

## Risk Mitigation
1. **Gradual Migration**: Keep existing app working throughout
2. **Feature Parity**: Test each migrated feature thoroughly
3. **Performance Testing**: Benchmark against current implementation
4. **Cross-Platform**: Test on macOS/Windows/Linux continuously

## Success Metrics
- ✅ 10x faster video scanning
- ✅ 75% reduction in memory usage
- ✅ 4x smaller app bundle
- ✅ Native performance feel
- ✅ Background operations without UI freezing
- ✅ Reliable file integrity checking
- ✅ Seamless external drive support

## Timeline: 4-6 Weeks Total
- **Weeks 1-2**: Rust core development
- **Weeks 2-3**: Performance optimization
- **Weeks 3-4**: Validation system
- **Weeks 4-5**: Tauri integration
- **Weeks 5-6**: Frontend migration & testing

This architecture provides massive performance improvements while maintaining a familiar web-based UI and enabling future features like network storage, cloud sync, and advanced video processing.