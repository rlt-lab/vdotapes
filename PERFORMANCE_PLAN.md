# VDOTapes Performance Optimization Plan

## Overview
Fix performance issues affecting ~10,000 video collections AND simplify architecture by removing Rust native modules in favor of pure TypeScript/JavaScript.

**Goals:**
1. Fix sort mode delays (500ms-1.5s → <100ms)
2. Fix expanded view delays (200-800ms → <100ms)
3. Fix grid rendering (50k+ DOM nodes → ~100-200)
4. Remove Rust modules, replace with async TS/JS

---

## Phase 1: Quick Wins

### 1.1 Remove Redundant Sort Operations
**Tool:** Edit
**Files:** `app/modules/FilterManager.js`

Changes:
- Remove duplicate `refreshVisibleVideos()` call from `reorderGridInPlace()` (line 79)
- Remove duplicate `updateStatusMessage()` call from `setSortMode()` (line 35)
- Remove duplicate `data-index` updates (updated twice per sort)

### 1.2 Cache Tag Suggestions
**Tool:** Edit
**Files:** `src/tag-suggestion-manager.ts`

Add caching for `getAllTags()` and `getFolderTags()`:
```typescript
private tagCache: { tags: TagInfo[]; timestamp: number } | null = null;
private folderTagCache = new Map<string, { tags: string[]; timestamp: number }>();
private readonly CACHE_TTL = 30000; // 30 seconds

invalidateTagCache() {
  this.tagCache = null;
  this.folderTagCache.clear();
}
```

Call `invalidateTagCache()` from tag add/remove operations.

### 1.3 Debounce Status Updates
**Tool:** Edit
**Files:** `app/modules/UIHelper.js`

Debounce `updateStatusMessage()` to prevent multiple O(n) reductions:
```javascript
updateStatusMessage = debounce(() => { /* existing logic */ }, 50);
```

---

## Phase 2: Grid Virtualization

### 2.1 Analyze Existing VirtualGrid
**Tool:** Task (Explore agent)
**Prompt:** Analyze `.worktrees/performance-fixes/app/modules/VirtualGrid.js` and identify integration requirements.

### 2.2 Integrate VirtualGrid
**Tool:** Edit
**Files:**
- Copy `VirtualGrid.js` from worktree to `app/modules/`
- `app/index.html` - add `<script src="modules/VirtualGrid.js"></script>`
- `app/modules/GridRenderer.js` - delegate to VirtualGrid for >500 videos
- `app/renderer.js` - set `useVirtualGrid = true` by default

**Key behaviors:**
- Render only visible rows + 2-row buffer (~40 elements)
- Absolute positioning instead of CSS Grid
- Recycle video elements from pool
- 2 sentinel IntersectionObservers instead of 10k targets

### 2.3 Update SmartLoader for Element Recycling
**Tool:** Edit
**Files:** `app/modules/video-smart-loader.js`

Modify to track by element reference, handle recycled elements without leaks.

---

## Phase 3: Replace Rust with TypeScript

### 3.1 Create TypeScript Video Scanner
**Tool:** Write
**Files:** `src/video-scanner-ts.ts` (new file)

```typescript
import { readdir, stat } from 'fs/promises';
import { createHash } from 'crypto';
import { join, extname, relative } from 'path';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogg', '.mov', '.avi', '.wmv', '.flv', '.mkv', '.m4v']);

export async function* scanVideosAsync(folderPath: string): AsyncGenerator<VideoMetadata> {
  const entries = await readdir(folderPath, { withFileTypes: true, recursive: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;

    const ext = extname(entry.name).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) continue;

    const fullPath = join(entry.parentPath ?? entry.path, entry.name);
    const stats = await stat(fullPath);

    yield {
      id: generateVideoId(fullPath, stats.size, stats.mtimeMs),
      path: fullPath,
      filename: entry.name,
      folder: relative(folderPath, entry.parentPath ?? entry.path) || '.',
      size: stats.size,
      lastModified: stats.mtimeMs,
    };
  }
}

function generateVideoId(path: string, size: number, mtime: number): VideoId {
  const hash = createHash('sha256')
    .update(`${path}:${size}:${mtime}`)
    .digest('hex')
    .slice(0, 16);
  return hash as VideoId;
}

export async function scanVideos(folderPath: string): Promise<ScanResult> {
  const videos: VideoMetadata[] = [];
  for await (const video of scanVideosAsync(folderPath)) {
    videos.push(video);
  }
  return { videos, errors: [] };
}
```

### 3.2 Create TypeScript Thumbnail Generator
**Tool:** Write
**Files:** `src/thumbnail-gen-ts.ts` (new file)

```typescript
import { spawn } from 'child_process';
import { access, mkdir, readdir, stat, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { createHash } from 'crypto';

export class ThumbnailGenerator {
  private cacheDir: string;
  private maxCacheSize: number;
  private currentCacheSize = 0;

  constructor(cacheDir: string, maxCacheMB = 500) {
    this.cacheDir = cacheDir;
    this.maxCacheSize = maxCacheMB * 1024 * 1024;
  }

  async initialize(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    this.currentCacheSize = await this.calculateCacheSize();
  }

  async generateThumbnail(
    videoPath: string,
    timestamp?: number,
    width = 320,
    height = 180
  ): Promise<ThumbnailResult> {
    const cacheKey = this.getCacheKey(videoPath, width, height);
    const cachePath = join(this.cacheDir, `${cacheKey}.jpg`);

    // Check cache
    try {
      await access(cachePath);
      return { path: cachePath, fromCache: true };
    } catch {
      // Not in cache, generate
    }

    const ts = timestamp ?? await this.getSmartTimestamp(videoPath);
    await this.runFFmpeg(videoPath, cachePath, ts, width, height);

    const stats = await stat(cachePath);
    this.currentCacheSize += stats.size;

    if (this.currentCacheSize > this.maxCacheSize) {
      await this.evictOldEntries();
    }

    return { path: cachePath, fromCache: false };
  }

  private runFFmpeg(input: string, output: string, timestamp: number, w: number, h: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-ss', String(timestamp),
        '-i', input,
        '-vframes', '1',
        '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
        '-y',
        output
      ];

      const proc = spawn('ffmpeg', args, { stdio: 'ignore' });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}`)));
      proc.on('error', reject);
    });
  }

  private async getSmartTimestamp(videoPath: string): Promise<number> {
    return new Promise((resolve) => {
      const proc = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        videoPath
      ]);

      let output = '';
      proc.stdout.on('data', (d) => output += d);
      proc.on('close', () => {
        const duration = parseFloat(output) || 10;
        resolve(Math.min(Math.max(duration * 0.1, 1), 30));
      });
    });
  }

  private getCacheKey(path: string, w: number, h: number): string {
    return createHash('blake2b512').update(`${path}:${w}:${h}`).digest('hex').slice(0, 32);
  }

  private async calculateCacheSize(): Promise<number> {
    let size = 0;
    try {
      const files = await readdir(this.cacheDir);
      for (const file of files) {
        const s = await stat(join(this.cacheDir, file));
        size += s.size;
      }
    } catch { /* empty cache */ }
    return size;
  }

  private async evictOldEntries(): Promise<void> {
    const target = this.maxCacheSize * 0.8;
    const files = await readdir(this.cacheDir);
    const entries = await Promise.all(
      files.map(async (f) => {
        const p = join(this.cacheDir, f);
        const s = await stat(p);
        return { path: p, size: s.size, mtime: s.mtimeMs };
      })
    );

    entries.sort((a, b) => a.mtime - b.mtime);

    for (const entry of entries) {
      if (this.currentCacheSize <= target) break;
      await unlink(entry.path);
      this.currentCacheSize -= entry.size;
    }
  }
}
```

### 3.3 Update Wrapper to Use TS Implementations
**Tool:** Edit
**Files:**
- `src/video-scanner.ts` - import from `video-scanner-ts.ts` instead of native
- `src/thumbnail-gen.ts` - import from `thumbnail-gen-ts.ts` instead of native

### 3.4 Update IPC Handlers
**Tool:** Edit
**Files:** `src/ipc-handlers.ts`

Update imports to use new TS implementations. No API changes needed.

### 3.5 Remove Rust Dependencies
**Tool:** Edit + Bash
**Files:**
- `package.json` - remove native build scripts, napi dependencies
- Delete `src/video-scanner-native/` directory
- Delete `src/thumbnail-generator-native/` directory

**Commands:**
```bash
rm -rf src/video-scanner-native src/thumbnail-generator-native
```

### 3.6 Update Build Configuration
**Tool:** Edit
**Files:** `package.json`

Remove:
- `"build:native"` script
- `"build:thumbnails"` script
- Any `napi` or `cargo` related scripts

---

## Phase 4: Testing & Verification

### 4.1 Type Check
**Tool:** Bash
**Command:** `npm run type-check`

### 4.2 Build TypeScript
**Tool:** Bash
**Command:** `npm run build:ts`

### 4.3 Manual Testing
**Tool:** Bash
**Command:** `npm run dev`

**Test scenarios with 10k videos:**
| Action | Before | Target |
|--------|--------|--------|
| Sort mode change | 500ms-1.5s | <100ms |
| Open expanded view | 200-800ms | <100ms |
| Grid scroll | Janky | Smooth 60fps |
| Initial folder scan | Blocking | Non-blocking with progress |
| Memory usage | 1GB+ | <500MB |

### 4.4 Code Review
**Tool:** Skill (`/superpowers:requesting-code-review`)

---

## Execution Strategy

### Phase 1 (Quick Wins)
- **Method:** Direct Edit tool
- **Parallelism:** 1.1, 1.2, 1.3 can run in parallel (independent files)
- **Estimated changes:** ~50 lines across 3 files

### Phase 2 (Grid Virtualization)
- **Method:** Task (Explore agent) for 2.1, then Edit tool
- **Parallelism:** Sequential (2.1 informs 2.2-2.3)
- **Risk:** Medium - test thoroughly

### Phase 3 (Replace Rust)
- **Method:** Write tool for new files, Edit for updates, Bash for cleanup
- **Parallelism:** 3.1 and 3.2 can run in parallel
- **Risk:** Low - TS/JS is simpler than Rust

### Phase 4 (Testing)
- **Method:** Bash for commands, Skill for review
- **Parallelism:** Sequential

---

## Files Summary

| Action | File |
|--------|------|
| **Edit** | `app/modules/FilterManager.js` |
| **Edit** | `src/tag-suggestion-manager.ts` |
| **Edit** | `app/modules/UIHelper.js` |
| **Copy** | `app/modules/VirtualGrid.js` (from worktree) |
| **Edit** | `app/index.html` |
| **Edit** | `app/modules/GridRenderer.js` |
| **Edit** | `app/renderer.js` |
| **Edit** | `app/modules/video-smart-loader.js` |
| **Write** | `src/video-scanner-ts.ts` (new) |
| **Write** | `src/thumbnail-gen-ts.ts` (new) |
| **Edit** | `src/video-scanner.ts` |
| **Edit** | `src/thumbnail-gen.ts` |
| **Edit** | `src/ipc-handlers.ts` |
| **Edit** | `package.json` |
| **Delete** | `src/video-scanner-native/` |
| **Delete** | `src/thumbnail-generator-native/` |

---

## Benefits of This Approach

1. **Simpler build** - No Rust toolchain, no NAPI-RS, no platform binaries
2. **Async by default** - Node.js fs.promises is non-blocking
3. **Easier debugging** - Single language, standard Node.js tools
4. **Faster iteration** - No native compilation step
5. **Better maintainability** - One codebase, one language

---

## Verification Checklist

- [ ] `npm run type-check` passes
- [ ] `npm run build:ts` succeeds
- [ ] App launches with `npm run dev`
- [ ] Folder scan completes without UI freeze
- [ ] Thumbnails generate correctly
- [ ] Sort mode change is instant (<100ms)
- [ ] Expanded view opens instantly (<100ms)
- [ ] Grid scrolls smoothly with 10k videos
- [ ] No Rust compilation errors (because Rust is gone)
