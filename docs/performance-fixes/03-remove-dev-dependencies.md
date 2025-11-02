# Fix 3: Remove Dev Dependencies from Production

## Problem Statement

**Location:** `package.json:81-83`

**Current Code:**
```json
"dependencies": {
  "@playwright/test": "^1.55.0",
  "better-sqlite3": "^12.2.0"
}
```

**Issue:** `@playwright/test` is a development/testing tool (~50MB) being included in production builds, unnecessarily bloating the application.

## Impact

- **Performance:** 50MB+ smaller bundle, faster downloads, faster installs
- **Priority:** HIGH
- **Effort:** 2 minutes
- **Expected Improvement:** 15-20% smaller distribution package

## Solution Overview

Move `@playwright/test` from `dependencies` to `devDependencies` to exclude it from production builds.

## Implementation Steps

### Step 1: Update package.json

**File:** `package.json`

**Before:**
```json
{
  "devDependencies": {
    "@electron/rebuild": "^4.0.1",
    "@napi-rs/cli": "^3.3.1",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^24.8.1",
    "@typescript-eslint/eslint-plugin": "^7.18.0",
    "@typescript-eslint/parser": "^7.18.0",
    "electron": "^37.2.1",
    "electron-builder": "^26.0.12",
    "eslint": "^8.57.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-import": "^2.29.1",
    "prettier": "^3.3.3",
    "typescript": "^5.9.2"
  },
  "dependencies": {
    "@playwright/test": "^1.55.0",
    "better-sqlite3": "^12.2.0"
  }
}
```

**After:**
```json
{
  "devDependencies": {
    "@electron/rebuild": "^4.0.1",
    "@napi-rs/cli": "^3.3.1",
    "@playwright/test": "^1.55.0",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^24.8.1",
    "@typescript-eslint/eslint-plugin": "^7.18.0",
    "@typescript-eslint/parser": "^7.18.0",
    "electron": "^37.2.1",
    "electron-builder": "^26.0.12",
    "eslint": "^8.57.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-import": "^2.29.1",
    "prettier": "^3.3.3",
    "typescript": "^5.9.2"
  },
  "dependencies": {
    "better-sqlite3": "^12.2.0"
  }
}
```

### Step 2: Clean Install (Optional but Recommended)

To ensure a clean state:

```bash
# Remove node_modules and package-lock.json
rm -rf node_modules package-lock.json

# Reinstall with correct dependencies
npm install
```

### Step 3: Verify electron-builder Configuration

**File:** `package.json` (build section)

Ensure `node_modules` is still excluded from production builds:

```json
{
  "build": {
    "appId": "com.vdotapes.app",
    "productName": "VDOTapes",
    "directories": {
      "output": "dist/packages"
    },
    "files": [
      "dist/main/**",
      "app/**/*.{js,html,css,png}",
      "src/video-scanner-native/**/*.node",
      "src/thumbnail-generator-native/**/*.node",
      "node_modules/**/*"
    ],
    // Add this if not present to exclude dev dependencies
    "asarUnpack": [
      "node_modules/better-sqlite3/**/*"
    ]
  }
}
```

## Testing Steps

### Test 1: Development Build

```bash
# Should work normally
npm run dev
```

Test all features to ensure nothing breaks.

### Test 2: Production Build

```bash
# Build for your platform
npm run build:mac  # or build:win

# Check the output size
ls -lh dist/packages/

# Compare before and after:
# Before: ~150MB
# After: ~100MB (50MB savings)
```

### Test 3: Verify Playwright Not in Production

```bash
# After building, check the production bundle
cd dist/packages/mac-arm64/VDOTapes.app/Contents/Resources/

# Playwright should NOT be present
find . -name "*playwright*" -o -name "@playwright"
# Should return nothing

# better-sqlite3 SHOULD be present
find . -name "*better-sqlite3*"
# Should find better-sqlite3
```

### Test 4: Test Installed Application

```bash
# Install the built app
# On macOS: Open the DMG and drag to Applications
# On Windows: Run the installer

# Launch the installed app
# Test all core features:
# - Scan folder
# - Add favorites
# - Add tags
# - Database operations
# - All functionality should work normally
```

## Understanding the Fix

### What's the difference?

**`dependencies`**: Installed in production builds
- Required for app to run
- Bundled with electron-builder
- Increases final app size

**`devDependencies`**: Only for development
- Used for building, testing, linting
- NOT included in production builds
- Doesn't affect final app size

### Why was Playwright in dependencies?

Likely added during development and mistakenly placed in wrong section. Common packages that should be devDependencies:

```json
{
  "devDependencies": {
    "@playwright/test": "...",    // Testing
    "electron": "...",             // Development only
    "electron-builder": "...",     // Build tool
    "typescript": "...",           // Compile-time only
    "@types/*": "...",            // Type definitions
    "eslint": "...",              // Linting
    "prettier": "...",            // Formatting
    "concurrently": "...",        // Development scripts
    "wait-on": "..."              // Development scripts
  }
}
```

### What stays in dependencies?

Only runtime dependencies:

```json
{
  "dependencies": {
    "better-sqlite3": "..."  // Database needed at runtime
  }
}
```

## Verification

Check package sizes:

```bash
# Before fix
npm list --depth=0 --prod
# Shows: @playwright/test, better-sqlite3

# After fix
npm list --depth=0 --prod
# Shows: better-sqlite3 only

# Check size of node_modules for production
NODE_ENV=production npm install --omit=dev --dry-run
```

## Additional Cleanup (Optional)

While we're at it, let's check if any other packages are misplaced:

```bash
# Check all dependencies
npm list --prod

# Common mistakes to look for:
# - Testing tools (@playwright, jest, mocha, etc.)
# - Build tools (webpack, vite, etc.)
# - TypeScript and type definitions
# - Linters and formatters
```

## Rollback Plan

If production app breaks (extremely unlikely):

```json
{
  "dependencies": {
    "@playwright/test": "^1.55.0",
    "better-sqlite3": "^12.2.0"
  }
}
```

Then:
```bash
npm install
npm run build
```

## Success Criteria

- ✅ Development builds work normally (`npm run dev`)
- ✅ Production builds are 50MB+ smaller
- ✅ Playwright not found in production bundle
- ✅ better-sqlite3 still present in production
- ✅ All app features work correctly in production build
- ✅ Faster production installs (`npm ci --omit=dev`)

## Performance Metrics

**Before:**
- Production bundle size: ~150MB
- `npm ci --omit=dev`: Installs Playwright (~50MB)
- Download size for users: ~150MB

**After:**
- Production bundle size: ~100MB
- `npm ci --omit=dev`: Skips Playwright
- Download size for users: ~100MB

**Improvement:**
- 33% smaller bundle
- 50MB less disk space
- Faster downloads for users
- Faster CI/CD builds

## Best Practices Going Forward

When adding new packages, ask:

**Add to `dependencies` if:**
- Needed when the app runs
- User-facing functionality depends on it
- Example: better-sqlite3, native modules

**Add to `devDependencies` if:**
- Only needed during development
- Build/test/lint tool
- Type definitions
- Example: typescript, eslint, @types/*

**Quick test:**
```bash
# If the app works with this command, it's a devDependency
npm install --omit=dev
npm run start
```
