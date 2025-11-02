# Fix 2: Enable TypeScript Incremental Builds

## Problem Statement

**Current Build Time:** 29.2 seconds (full rebuild every time)

**Issue:** TypeScript compiles all files on every build, even if only one file changed. This makes development slow and reduces iteration speed.

## Impact

- **Performance:** 70% faster rebuilds (29s → 6-8s)
- **Priority:** HIGH
- **Effort:** 5 minutes
- **Expected Improvement:** Rebuilds only changed files + dependencies

## Solution Overview

Enable TypeScript's built-in incremental compilation mode, which caches build information and only recompiles changed files.

## Implementation Steps

### Step 1: Update Main Process TypeScript Config

**File:** `src/tsconfig.json`

Add `incremental` and `tsBuildInfoFile` options to `compilerOptions`:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "outDir": "../dist/main/src",
    "rootDir": ".",
    "module": "CommonJS",
    "target": "ES2020",
    "lib": ["ES2020"],
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,

    // Add these lines for incremental builds
    "incremental": true,
    "tsBuildInfoFile": "../.tsbuildinfo/main.tsbuildinfo"
  },
  "include": [
    "**/*.ts"
  ],
  "exclude": [
    "node_modules",
    "video-scanner-native",
    "thumbnail-generator-native",
    "video-grid-wasm"
  ]
}
```

### Step 2: Update Renderer Process TypeScript Config

**File:** `app/tsconfig.json`

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "outDir": ".",
    "rootDir": ".",
    "module": "ES2020",
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": false,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowJs": true,
    "checkJs": false,
    "noEmit": false,

    // Add these lines for incremental builds
    "incremental": true,
    "tsBuildInfoFile": "../.tsbuildinfo/renderer.tsbuildinfo"
  },
  "include": [
    "**/*.ts",
    "**/*.js"
  ],
  "exclude": [
    "node_modules"
  ]
}
```

### Step 3: Update .gitignore

**File:** `.gitignore`

Add the build info directory:

```gitignore
# ... existing ignores ...

# TypeScript incremental build cache
.tsbuildinfo/
*.tsbuildinfo
```

### Step 4: Add Watch Mode Scripts (Optional but Recommended)

**File:** `package.json`

Add watch mode scripts for development:

```json
{
  "scripts": {
    "start": "npm run build:ts && electron .",
    "dev": "npm run build:ts && electron . --dev",

    // Add these for development workflow
    "dev:watch": "concurrently \"npm run watch:main\" \"npm run watch:renderer\" \"npm run dev:electron\"",
    "watch:main": "tsc -p src/tsconfig.json --watch",
    "watch:renderer": "tsc -p app/tsconfig.json --watch",
    "dev:electron": "wait-on dist/main/src/main.js && electron . --dev",

    "build": "npm run build:ts && electron-builder",
    "build:mac": "npm run build:ts && electron-builder --mac",
    "build:win": "npm run build:ts && electron-builder --win",
    "pack": "npm run build:ts && electron-builder --dir",
    "build:ts": "npm run build:main && npm run build:renderer",
    "build:main": "tsc -p src/tsconfig.json && npm run copy:native",
    "build:renderer": "tsc -p app/tsconfig.json",

    // ... rest of scripts
  }
}
```

### Step 5: Install Optional Watch Dependencies (for watch mode)

**Only if you want the watch mode scripts:**

```bash
npm install --save-dev concurrently wait-on
```

### Step 6: Create Build Info Directory

```bash
mkdir -p .tsbuildinfo
```

## Testing Steps

### Test 1: Full Build

```bash
# Clean existing build
rm -rf dist/main/src
rm -rf .tsbuildinfo

# First build (should be same speed as before)
time npm run build:ts
# Should take ~29 seconds
```

### Test 2: Incremental Build

```bash
# Make a small change to a file
echo "// Performance improvement" >> src/main.ts

# Build again (should be much faster)
time npm run build:ts
# Should take 6-8 seconds (70% faster!)
```

### Test 3: No Changes Build

```bash
# Build without any changes
time npm run build:ts
# Should take 2-3 seconds (instant)
```

### Test 4: Watch Mode (Optional)

```bash
# Terminal 1: Start watch mode
npm run dev:watch

# Terminal 2: Make changes to files
# App should auto-rebuild and reload
```

### Test 5: Verify App Still Works

```bash
npm run dev

# Test all features:
# - Scan folder
# - Add favorites
# - Add tags
# - Filter videos
# - Expand video
```

## Verification

After implementing, you should see:

1. **`.tsbuildinfo/` directory created** with two files:
   - `main.tsbuildinfo`
   - `renderer.tsbuildinfo`

2. **Build times:**
   - First build: ~29 seconds (same as before)
   - Incremental builds: 6-8 seconds (70% faster)
   - No-change builds: 2-3 seconds (90% faster)

3. **Console output should show:**
   ```
   [time] Building project references...
   [time] Project 'src/tsconfig.json' is up to date (X files unchanged)
   ```

## Troubleshooting

### Build Info Files Get Corrupted

**Solution:** Delete and rebuild
```bash
rm -rf .tsbuildinfo
npm run build:ts
```

### Incremental Build Misses Changes

**Solution:** This is rare, but if it happens:
```bash
# Force full rebuild
rm -rf dist/main .tsbuildinfo
npm run build:ts
```

### Watch Mode Not Recompiling

**Solution:** Check that wait-on and concurrently are installed:
```bash
npm install --save-dev concurrently wait-on
```

## Rollback Plan

If incremental builds cause issues:

1. Remove from `src/tsconfig.json`:
   ```json
   "incremental": true,
   "tsBuildInfoFile": "../.tsbuildinfo/main.tsbuildinfo"
   ```

2. Remove from `app/tsconfig.json`:
   ```json
   "incremental": true,
   "tsBuildInfoFile": "../.tsbuildinfo/renderer.tsbuildinfo"
   ```

3. Delete build info:
   ```bash
   rm -rf .tsbuildinfo
   ```

## Success Criteria

- ✅ First build completes successfully
- ✅ Incremental builds are 70% faster
- ✅ App runs correctly with incremental builds
- ✅ All features work as expected
- ✅ No TypeScript errors introduced

## Performance Metrics

**Before:**
- Full build: 29.2 seconds
- Incremental build: 29.2 seconds (rebuilds everything)
- Single file change: 29.2 seconds

**After:**
- Full build: 29.2 seconds (first time only)
- Incremental build: 6-8 seconds (70% faster)
- Single file change: 2-4 seconds (85% faster)
- No changes: 2-3 seconds (90% faster)

**Development Impact:**
- 10 rebuilds during development: 292s → 80s (saves 3.5 minutes)
- 100 rebuilds in a day: 2920s → 800s (saves 35 minutes)
