# CRITICAL: Electron is Caching Old Code

## The Problem

Your source files have the fixes, but Electron is running cached versions:

**Source Code (CORRECT):**
```javascript
maxActiveVideos: 12
console.log('Smart video loader initialized (max: 12 videos)');
```

**Console Output (OLD/CACHED):**
```
Smart video loader initialized  // Missing "(max: 12 videos)"
0/30 active  // Should be 0/12
```

## Solution: Force Full Restart

### Option 1: Kill and Restart (Recommended)

```bash
# 1. Kill all Electron processes
pkill -f electron

# 2. Wait 2 seconds
sleep 2

# 3. Start fresh
npm run dev
```

### Option 2: Quit Properly

1. **Fully quit the app** (Cmd+Q on Mac, not just close window)
2. Wait 2-3 seconds
3. `npm run dev`

### Option 3: Clear Cache (If Still Issues)

```bash
# Clear Electron cache
rm -rf ~/Library/Application\ Support/vdotapes/
rm -rf ~/Library/Caches/vdotapes/

# Then restart
npm run dev
```

## How to Verify It Worked

After restarting, check console output:

### ✅ CORRECT (Fixed Version):
```
Smart video loader initialized (max: 12 videos)
[SmartLoader] Observing 150 video items (state cleared, videos unloaded)
Smart Loading: 0 loaded, 0/12 active
Smart Loading: 10 loaded, 8/12 active
```

### ❌ WRONG (Still Cached):
```
Smart video loader initialized
Smart Loading: 0/30 active
```

If you see "30" anywhere, it's still the old version!

## Additional Check

In the Electron DevTools console, type:

```javascript
// Check the actual limit
app.smartLoader.maxActiveVideos
// MUST return: 12 (not 30!)
```

## Why This Happened

Electron caches JavaScript files for performance. Changes to source files don't automatically reload unless:
1. App is fully quit (Cmd+Q)
2. Process is killed
3. Cache is cleared
4. Or you're using hot-reload (which we're not)

## After Restart

You should see:
- ✅ "max: 12 videos" in console
- ✅ Video count stays ≤12
- ✅ No WebMediaPlayer errors
- ✅ Videos load on scroll back up
