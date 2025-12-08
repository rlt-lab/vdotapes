# VDOTapes Windows Compatibility Report

## Executive Summary

The VDOTapes application has **three critical issues** preventing it from running on Windows. The primary cause of your "module not found" error is the **Bash-specific npm script** that fails to copy native modules on Windows. The fixes are straightforward and do not require extensive reworking.

**Estimated effort**: Low to Medium - primarily npm script changes and a few path fixes.

---

## Critical Issues

### 1. CRITICAL: Bash-Specific `copy:native` npm Script

**File**: `package.json:17`

```json
"copy:native": "mkdir -p dist/main/src/video-scanner-native dist/main/src/thumbnail-generator-native && cp src/video-scanner-native/*.node src/video-scanner-native/index.js dist/main/src/video-scanner-native/ 2>/dev/null || true && cp src/thumbnail-generator-native/*.node src/thumbnail-generator-native/index.js dist/main/src/thumbnail-generator-native/ 2>/dev/null || true"
```

**Problems**:
| Command | Issue |
|---------|-------|
| `mkdir -p` | Windows `mkdir` doesn't support `-p` flag |
| `cp` | Windows has no `cp` command (uses `copy` or `xcopy`) |
| `2>/dev/null` | `/dev/null` doesn't exist on Windows |
| `\|\| true` | Won't work as intended when preceding commands fail |

**Impact**: This is the **root cause** of your "module not found" error. The native `.node` files never get copied to `dist/`, so Electron can't load them.

---

### 2. CRITICAL: Hardcoded Unix Temp Path in Stub

**File**: `src/thumbnail-gen.ts:90`

```typescript
this.cacheDir = cacheDir || '/tmp/vdotapes-thumbnails';
```

**Problem**: `/tmp` is a Unix-only path. Windows uses `C:\Users\<user>\AppData\Local\Temp` or similar.

**Impact**: If the native thumbnail module fails to load (which it will due to Issue #1), the stub fallback will attempt to use an invalid path.

---

### 3. HIGH: FFprobe Path Detection Missing Windows Locations

**File**: `src/ffprobe-wrapper.js:40-47`

```javascript
const possiblePaths = [
  'ffprobe', // System PATH
  '/usr/bin/ffprobe',
  '/usr/local/bin/ffprobe',
  '/opt/homebrew/bin/ffprobe', // Apple Silicon Homebrew
  path.join(process.resourcesPath || '', 'ffprobe'),
  path.join(__dirname, '../bin/ffprobe'),
];
```

**Problems**:
- No Windows-specific paths (e.g., `C:\FFmpeg\bin\ffprobe.exe`)
- No `.exe` extension handling for Windows executables
- Only Unix paths are hardcoded

**Impact**: Even with FFmpeg installed, the app may fail to find `ffprobe.exe` on Windows unless it's in the system PATH.

---

## Items Correctly Implemented (No Changes Needed)

| Component | File | Status |
|-----------|------|--------|
| Platform GPU config | `src/main.ts:30-40` | Handles `win32`, `darwin`, `linux` |
| Database path | `src/database/core/DatabaseCore.ts:29` | Uses `APPDATA` fallback |
| Rust path separators | `src/video-scanner-native/src/scanner.rs` | Uses `std::path::MAIN_SEPARATOR` |
| Native build targets | `src/video-scanner-native/package.json` | Includes `x86_64-pc-windows-msvc` |
| Rust temp directory | `src/thumbnail-generator-native/src/lib.rs:34` | Uses `std::env::temp_dir()` |
| File system operations | Rust code | Cross-platform `walkdir` crate |

---

## Recommended Fixes

### Fix 1: Cross-Platform Copy Script (Required)

**Option A**: Use a Node.js script (Recommended)

Create `scripts/copy-native.js`:
```javascript
const fs = require('fs');
const path = require('path');

const copies = [
  {
    src: 'src/video-scanner-native',
    dest: 'dist/main/src/video-scanner-native',
    files: ['*.node', 'index.js']
  },
  {
    src: 'src/thumbnail-generator-native',
    dest: 'dist/main/src/thumbnail-generator-native',
    files: ['*.node', 'index.js']
  }
];

copies.forEach(({ src, dest, files }) => {
  fs.mkdirSync(dest, { recursive: true });

  files.forEach(pattern => {
    const isGlob = pattern.includes('*');
    if (isGlob) {
      const ext = pattern.replace('*', '');
      fs.readdirSync(src)
        .filter(f => f.endsWith(ext))
        .forEach(f => {
          const srcPath = path.join(src, f);
          const destPath = path.join(dest, f);
          if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copied: ${srcPath} -> ${destPath}`);
          }
        });
    } else {
      const srcPath = path.join(src, pattern);
      const destPath = path.join(dest, pattern);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`Copied: ${srcPath} -> ${destPath}`);
      }
    }
  });
});
```

Update `package.json`:
```json
"copy:native": "node scripts/copy-native.js"
```

**Option B**: Use `shx` package (simpler but adds dependency)
```bash
npm install --save-dev shx
```
```json
"copy:native": "shx mkdir -p dist/main/src/video-scanner-native dist/main/src/thumbnail-generator-native && shx cp src/video-scanner-native/*.node src/video-scanner-native/index.js dist/main/src/video-scanner-native/ && shx cp src/thumbnail-generator-native/*.node src/thumbnail-generator-native/index.js dist/main/src/thumbnail-generator-native/"
```

---

### Fix 2: Platform-Aware Temp Directory

**File**: `src/thumbnail-gen.ts:90`

Change:
```typescript
this.cacheDir = cacheDir || '/tmp/vdotapes-thumbnails';
```

To:
```typescript
import * as os from 'os';
import * as path from 'path';

// In constructor:
this.cacheDir = cacheDir || path.join(os.tmpdir(), 'vdotapes-thumbnails');
```

---

### Fix 3: Add Windows FFprobe Paths

**File**: `src/ffprobe-wrapper.js:40-47`

```javascript
const possiblePaths = [
  'ffprobe', // System PATH (works if .exe is in PATH)
  // Windows paths
  'ffprobe.exe',
  path.join(process.env.ProgramFiles || '', 'FFmpeg', 'bin', 'ffprobe.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'FFmpeg', 'bin', 'ffprobe.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'FFmpeg', 'bin', 'ffprobe.exe'),
  'C:\\FFmpeg\\bin\\ffprobe.exe',
  // macOS/Linux paths
  '/usr/bin/ffprobe',
  '/usr/local/bin/ffprobe',
  '/opt/homebrew/bin/ffprobe',
  // Bundled paths
  path.join(process.resourcesPath || '', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
  path.join(__dirname, '../bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
];
```

---

## Testing Checklist

After applying fixes, test on Windows:

1. [ ] `npm run build:ts` completes without errors
2. [ ] Native `.node` files exist in `dist/main/src/video-scanner-native/`
3. [ ] Native `.node` files exist in `dist/main/src/thumbnail-generator-native/`
4. [ ] `npm start` launches the application
5. [ ] Video scanning works (test with a folder of videos)
6. [ ] Thumbnails generate correctly
7. [ ] FFprobe metadata extraction works

---

## Summary

| Issue | Severity | Effort | Files to Modify |
|-------|----------|--------|-----------------|
| Bash npm script | CRITICAL | Low | `package.json` + new script |
| `/tmp` hardcoded path | CRITICAL | Low | `src/thumbnail-gen.ts` |
| FFprobe Windows paths | HIGH | Low | `src/ffprobe-wrapper.js` |

**Extensive reworking required?** No. The core architecture is cross-platform compatible. Only the build script and a few hardcoded paths need updating. The Rust native modules, database layer, and Electron configuration already handle Windows correctly.

**Estimated implementation time**: These fixes are localized and straightforward. The `copy:native` script fix will immediately resolve the "module not found" error.
