# Git Cleanup Instructions

## Problem

GitHub shows the repository as 75% Makefile because **2,304 Rust build artifacts** from `target/` directories are being tracked in git. These should never be committed.

## Files That Shouldn't Be Tracked

1. **Rust build artifacts:** `src/*/target/` directories (800MB+ of files!)
2. **Database files:** `.vdotapes/videos.db*` (runtime data)
3. **Old documentation:** Multiple docs files that were "deleted" but still in git

## Solution

### Step 1: Update .gitignore

Add these entries to `.gitignore`:

```gitignore
# Rust build artifacts (native modules)
**/target/

# Database files (runtime data)
.vdotapes/
*.db
*.db-shm
*.db-wal

# Documentation cleanup (old files)
docs/ARCHITECTURE_ANALYSIS.md
docs/BUG_FIX_ROW_20_LOADING.md
docs/CLAUDE.md
docs/CRITICAL_FIXES_APPLIED.md
docs/DATABASE_OPTIMIZATION_6K_VIDEOS.md
docs/DROID.md
docs/HARDWARE_ACCELERATION_CHECK.md
docs/INTEGRATION_STATUS.md
docs/NATIVE_INTEGRATION.md
docs/PHASE3_SUMMARY.md
docs/PROJECT_STRUCTURE_ANALYSIS.md
docs/QUICK_DEBUG_REFERENCE.md
docs/REFACTORING_COMPLETE.md
docs/RENDERER_REFACTORING_PLAN.md
docs/RESTART_INSTRUCTIONS.md
docs/RUST_MODULES_INTEGRATION_STATUS.md
docs/RUST_MODULE_STATUS.md
docs/SCROLLING_BUFFER_UPDATE.md
docs/START_HERE.md
docs/TESTING_INSTRUCTIONS.md
docs/TESTING_PERSISTENCE.md
docs/TESTING_RECOVERY.md
docs/TEST_ROW_20_FIX.md
docs/TEST_THESE_FIXES.md
docs/THUMBNAIL_GEN_CLEANUP.md
docs/THUMBNAIL_INTEGRATION_COMPLETE.md
docs/THUMBNAIL_PRELOADER_TEST.md
docs/THUMBNAIL_UI_INTEGRATION.md
docs/THUMBNAIL_VS_PAUSE_ANALYSIS.md
docs/VIDEO_CODEC_OPTIMIZATION.md
docs/VIDEO_LOADING_FIX_SUMMARY.md
docs/VIDEO_RECOVERY_IMPROVEMENTS.md
docs/VIDEO_RECOVERY_MECHANISM.md
docs/VIDEO_RETRY_LOGIC_IMPLEMENTATION.md
docs/VIRTUAL_GRID_IMPLEMENTATION.md
docs/WASM_INTEGRATION_COMPLETE.md
docs/WASM_INTEGRATION_GUIDE.md
docs/WASM_LOADER_IMPLEMENTATION.md
docs/WASM_PHASE1_SUMMARY.md
docs/WASM_PHASE2_COMPLETE.md
docs/agents/
docs/ref_thumbnail-gen-mod.md
docs/ref_video-scanner-mod.md
docs/roadmaps/
docs/test-video-loading.md
docs/thumbnail-generator-implementation.md
```

### Step 2: Remove Files from Git (Without Deleting Locally)

**⚠️ IMPORTANT:** Back up your work first!

```bash
# Create a backup branch
git branch backup-before-cleanup

# Remove build artifacts from git tracking
git rm --cached -r src/thumbnail-generator-native/target/
git rm --cached -r src/video-scanner-native/target/
git rm --cached -r src/video-grid-wasm/target/

# Remove database files from git tracking
git rm --cached -r .vdotapes/

# Remove old docs (already deleted locally per git status)
# These are showing as deleted in working tree but still in git history
# Just commit the deletions that are already staged

# Check what will be removed
git status
```

### Step 3: Commit the Cleanup

```bash
# Commit the .gitignore update
git add .gitignore
git commit -m "Fix: Add Rust build artifacts and database files to .gitignore

- Add **/target/ to ignore Rust build outputs
- Add .vdotapes/ to ignore runtime database files
- Remove 2,304+ build artifacts from git tracking
- This fixes GitHub showing repo as 75% Makefile"

# If old docs show as deleted, commit those deletions
git add docs/
git commit -m "docs: Remove outdated development documentation

Removed 45+ old debug/development docs that are no longer needed.
Keeping only current documentation:
- codereview.md
- refactor.md
- phase1-complete.md
- video-unload-buffer-fix.md
- session.md
- prd.md
- techstack.md"
```

### Step 4: Push and Verify

```bash
# Push changes
git push origin main

# Wait a few minutes, then check GitHub
# Language stats should now show correct breakdown
```

## Expected Results

**Before:**
- 75% Makefile (wrong!)
- 809MB tracked in git
- 2,304 build artifact files

**After:**
- ~60% TypeScript
- ~25% JavaScript  
- ~10% Rust
- ~5% Other (CSS, HTML, JSON)
- Much smaller repo size

## Why This Happened

Rust's Cargo build tool generates:
- `.d` files (Makefile dependency tracking)
- `.rlib` files (compiled libraries)
- `.rmeta` files (metadata)
- Other build artifacts

These are all in `target/` directories and should NEVER be committed. They're like `node_modules/` for Rust.

## Prevention

The `target/` directories should have been in `.gitignore` from the start. Adding `**/target/` prevents this from happening again.

## Additional Cleanup (Optional)

If you want to completely remove these files from git history (not just stop tracking them):

```bash
# This rewrites git history - coordinate with team first!
git filter-repo --path src/thumbnail-generator-native/target --invert-paths
git filter-repo --path src/video-scanner-native/target --invert-paths
git filter-repo --path src/video-grid-wasm/target --invert-paths

# Force push (CAREFUL!)
git push origin main --force
```

**Note:** Only do this if:
1. You're the only developer
2. Or you've coordinated with your team
3. Everyone will need to re-clone the repo after

---

## Quick Fix (If You Just Want It Fixed Now)

```bash
# Update .gitignore
echo "**/target/" >> .gitignore
echo ".vdotapes/" >> .gitignore

# Remove from tracking
git rm --cached -r src/thumbnail-generator-native/target/ 2>/dev/null || true
git rm --cached -r src/video-scanner-native/target/ 2>/dev/null || true  
git rm --cached -r src/video-grid-wasm/target/ 2>/dev/null || true
git rm --cached -r .vdotapes/ 2>/dev/null || true

# Commit
git add .gitignore
git commit -m "Fix: Remove Rust build artifacts from git tracking

This fixes GitHub showing repo as 75% Makefile.
Build artifacts should never be in version control."

# Push
git push origin main
```

---

After these steps, GitHub will recalculate language stats and show the correct breakdown (mostly TypeScript/JavaScript, not Makefile)!
