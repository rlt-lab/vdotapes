# Performance Improvements Plan - Phase 2

The original 6-phase optimization (N+1 fixes, single-pass filtering, tag Sets, in-place filtering, shuffle optimization, debouncing) is complete. This plan covers **additional optimizations** identified through comprehensive codebase analysis.

---

## Summary of Opportunities

| Category | Improvement | Impact | Effort |
|----------|-------------|--------|--------|
| **Native** | Parallel thumbnail batch generation | High | Medium |
| **Native** | Batch IPC endpoint for thumbnails | High | Medium |
| **Memory** | Timer/debounce cleanup on app close | Medium | Low |
| **Memory** | Bound thumbnail cache with LRU | Medium | Low |
| **Events** | Debounce/throttle resize events | Medium | Low |
| **Events** | Debounce tag search input | Low | Low |
| **Events** | Prevent duplicate scroll listeners | Medium | Low |
| **Rendering** | RAF batching for DOM operations | Low | Medium |
| **Native** | Parallel directory scanning (rayon) | Medium | High |

---

## Recommended Improvements

### 1. Parallel Thumbnail Batch Generation (High Impact)

**Current**: `src/thumbnail-generator-native/src/lib.rs:124-151` - Sequential processing with mutex lock per item

**Problem**: `generate_batch()` locks mutex for each video, processing 1 at a time

**Fix**: Use concurrent FFmpeg pool (limit 4 concurrent operations)

```rust
// Replace sequential loop with concurrent processing
pub async fn generate_batch(&self, video_paths: Vec<String>) -> Result<Vec<ThumbnailResult>> {
    use futures::stream::{self, StreamExt};

    let results = stream::iter(video_paths)
        .map(|path| async {
            let generator = self.generator.lock().await;
            generator.generate(&path, None).await
        })
        .buffer_unordered(4)  // 4 concurrent FFmpeg operations
        .collect::<Vec<_>>()
        .await;
    Ok(results)
}
```

**Files**: `src/thumbnail-generator-native/src/lib.rs`

---

### 2. Batch IPC Endpoint for Thumbnails (High Impact)

**Current**: Renderer must make N IPC calls for N thumbnails

**Fix**: Add `generate-thumbnails-batch` IPC handler

**Files**:
- `src/ipc-handlers.ts` - Add batch handler
- `src/preload.ts` - Expose batch method
- `types/ipc.ts` - Add type definition

---

### 3. Timer/Debounce Cleanup on App Close (Medium Impact)

**Problem**:
- `video-smart-loader.js:222` - cleanup interval never cleared
- `FilterManager.js:20` - debounce not cancelled
- `UserDataManager.js:9` - debounce not cancelled
- Window scroll listener added without removal

**Fix**: Add cleanup methods and call on app close

**Files**:
- `app/video-smart-loader.js` - Add `destroy()` method
- `app/modules/FilterManager.js` - Cancel debounce
- `app/modules/UserDataManager.js` - Cancel debounce
- `app/renderer.js` - Call cleanups on `beforeunload`

---

### 4. Bound Thumbnail Cache with LRU (Medium Impact)

**Current**: `app/modules/ThumbnailPreloader.js` - `thumbnailCache` Map grows unbounded

**Fix**: Implement LRU eviction when cache exceeds threshold (e.g., 500 entries)

**Files**: `app/modules/ThumbnailPreloader.js`

---

### 5. Debounce/Throttle Resize Events (Medium Impact)

**Current**: `app/modules/EventController.js:74` - No throttling on resize

**Fix**: Add 100ms throttle to resize handler

**Files**: `app/modules/EventController.js`

---

### 6. Debounce Tag Search Input (Low Impact)

**Current**: `app/modules/TagManager.js:33-34` - Unthrottled input events

**Fix**: Add 150ms debounce to tag search input handler

**Files**: `app/modules/TagManager.js`

---

### 7. Prevent Duplicate Scroll Listeners (Medium Impact)

**Current**: `video-smart-loader.js:229` - scroll listener added in `observeVideoItems()` without removal

**Fix**: Track listener and remove before re-adding

**Files**: `app/video-smart-loader.js`

---

## Implementation Order

**Phase A - Memory Leaks & Cleanup**
1. Add `destroy()` method to SmartLoader with interval cleanup
2. Fix duplicate scroll listener in SmartLoader
3. Add debounce cancellation to FilterManager
4. Add debounce cancellation to UserDataManager
5. Add LRU eviction to ThumbnailPreloader
6. Wire up cleanups on `beforeunload` in renderer.js

**Phase B - Event Optimization**
7. Add resize throttling to EventController
8. Add debounce to tag search in TagManager

**Phase C - Native Performance**
9. Refactor Rust batch generation to use concurrent processing
10. Add batch IPC endpoint for thumbnails
11. Expose batch method in preload/types

---

## Files to Modify

| File | Changes |
|------|---------|
| `app/video-smart-loader.js` | Add `destroy()`, fix scroll listener |
| `app/modules/FilterManager.js` | Cancel debounce on cleanup |
| `app/modules/UserDataManager.js` | Cancel debounce on cleanup |
| `app/modules/ThumbnailPreloader.js` | Add LRU eviction |
| `app/modules/EventController.js` | Throttle resize |
| `app/modules/TagManager.js` | Debounce search input |
| `app/renderer.js` | Call cleanups on beforeunload |
| `src/thumbnail-generator-native/src/lib.rs` | Parallel batch processing |
| `src/ipc-handlers.ts` | Batch thumbnail handler |
| `src/preload.ts` | Expose batch method |
| `types/ipc.ts` | Type definitions |

---

## Not Recommended (Low ROI)

- **RAF batching for DOM ops**: Complex refactor, minimal gain (in-place filtering already efficient)
- **Parallel directory scanning (rayon)**: Significant Rust refactor, walkdir is fast enough
- **Reverse tag index**: Current Set-based O(1) lookups are sufficient
- **Histogram-based blank frame detection**: Works well enough, edge case improvement
