# Fix 5: Debounce Settings Saves

## Problem Statement

**Location:** Multiple files where settings are saved frequently

**Current Behavior:**
- Settings saved on every UI interaction
- Grid column changes → immediate save
- Filter changes → immediate save
- Sort changes → immediate save

**Example from `app/renderer.js:80`:**
```javascript
await this.userDataManager.loadSettings();

window.addEventListener('beforeunload', () => {
  this.userDataManager.saveSettings();  // Only saves on exit, but...
});
```

**Example from filter changes:**
```javascript
// Every filter change triggers save
await window.electronAPI.saveSettings(settingsObject);
```

**Issue:** Multiple rapid changes (like dragging grid size slider) cause excessive IPC calls and file writes, causing UI lag.

## Impact

- **Performance:** Eliminates UI lag during rapid interactions
- **Priority:** MEDIUM
- **Effort:** 30 minutes
- **Expected Improvement:** Smoother UI, fewer IPC calls (10-100x reduction)

## Solution Overview

Implement debouncing for settings saves: wait for user to finish making changes before saving, rather than saving on every keystroke/interaction.

## Implementation Steps

### Step 1: Add Debounce Utility Function

**File:** `app/utils/debounce.js` (create new file)

```javascript
/**
 * Debounce utility - delays function execution until after wait time has passed
 * since the last invocation
 *
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait
 * @param {boolean} immediate - Execute on leading edge instead of trailing
 * @returns {Function} Debounced function
 */
function debounce(func, wait = 300, immediate = false) {
  let timeout;

  return function executedFunction(...args) {
    const context = this;

    const later = function() {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };

    const callNow = immediate && !timeout;

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);

    if (callNow) func.apply(context, args);
  };
}

/**
 * Throttle utility - ensures function is called at most once per wait period
 *
 * @param {Function} func - Function to throttle
 * @param {number} wait - Milliseconds to wait between calls
 * @returns {Function} Throttled function
 */
function throttle(func, wait = 300) {
  let inThrottle;
  let lastFunc;
  let lastRan;

  return function(...args) {
    const context = this;

    if (!inThrottle) {
      func.apply(context, args);
      lastRan = Date.now();
      inThrottle = true;
    } else {
      clearTimeout(lastFunc);
      lastFunc = setTimeout(function() {
        if (Date.now() - lastRan >= wait) {
          func.apply(context, args);
          lastRan = Date.now();
        }
      }, Math.max(wait - (Date.now() - lastRan), 0));
    }
  };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { debounce, throttle };
} else {
  window.debounce = debounce;
  window.throttle = throttle;
}
```

### Step 2: Load Debounce Utility in HTML

**File:** `app/index.html`

Add before other script tags (around line 10-20):

```html
<!-- Utility functions -->
<script src="utils/debounce.js"></script>

<!-- Core modules -->
<script src="modules/VideoManager.js"></script>
<!-- ... other modules ... -->
```

### Step 3: Update UserDataManager with Debounced Save

**File:** `app/modules/UserDataManager.js`

Add debounced save method:

```javascript
class UserDataManager {
  constructor(app) {
    this.app = app;

    // Create debounced save function (wait 1 second after last change)
    this.debouncedSave = debounce(() => {
      this.saveSettingsImmediate();
    }, 1000);  // 1 second delay

    // Track if there are pending saves
    this.hasPendingChanges = false;
  }

  /**
   * Debounced save - waits for user to stop making changes
   * Call this from UI event handlers
   */
  async saveSettings() {
    this.hasPendingChanges = true;
    this.debouncedSave();
  }

  /**
   * Immediate save - bypasses debouncing
   * Use for critical saves (app exit, folder switch)
   */
  async saveSettingsImmediate() {
    try {
      const settings = {
        gridColumns: this.app.gridCols,
        sortBy: this.app.currentSort,
        showFavoritesOnly: this.app.showingFavoritesOnly,
        showHiddenOnly: this.app.showingHiddenOnly,
        selectedFolder: this.app.currentFolder,
        tagFilterMode: this.app.tagFilterMode || 'OR',
        activeTags: this.app.activeTags || [],
      };

      await window.electronAPI.saveSettings(settings);
      this.hasPendingChanges = false;
      console.log('[Settings] Saved:', settings);
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  /**
   * Flush any pending saves immediately
   * Call before critical operations (folder switch, app exit)
   */
  async flushPendingSaves() {
    if (this.hasPendingChanges) {
      console.log('[Settings] Flushing pending saves...');
      // Cancel debounce timer
      this.debouncedSave.cancel?.();
      // Save immediately
      await this.saveSettingsImmediate();
    }
  }

  // ... rest of UserDataManager methods ...
}
```

### Step 4: Add Cancel Method to Debounce

**File:** `app/utils/debounce.js`

Update debounce function to support cancellation:

```javascript
function debounce(func, wait = 300, immediate = false) {
  let timeout;

  const executedFunction = function(...args) {
    const context = this;

    const later = function() {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };

    const callNow = immediate && !timeout;

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);

    if (callNow) func.apply(context, args);
  };

  // Add cancel method
  executedFunction.cancel = function() {
    clearTimeout(timeout);
    timeout = null;
  };

  return executedFunction;
}
```

### Step 5: Update App Exit Handler

**File:** `app/renderer.js:82-84`

```javascript
// Before app exit, flush any pending saves
window.addEventListener('beforeunload', async () => {
  await this.userDataManager.flushPendingSaves();
  await this.userDataManager.saveSettingsImmediate();
});
```

### Step 6: Update Critical Operations to Flush

**File:** `app/renderer.js`

Before folder scanning (line 117):

```javascript
async scanVideos(folderPath) {
  try {
    // Flush pending saves before switching folders
    await this.userDataManager.flushPendingSaves();

    this.uiHelper.showProgress(0, 'Initializing scan...');

    // ... rest of scan code ...
  }
}
```

### Step 7: Update UI Event Handlers

**File:** `app/modules/UIHelper.js` (or wherever grid size changes)

Change from immediate save to debounced:

**Before:**
```javascript
async updateGridSize() {
  // ... update grid ...
  await window.electronAPI.saveSettings(settings);  // Immediate save
}
```

**After:**
```javascript
updateGridSize() {
  // ... update grid ...
  this.app.saveSettings();  // Debounced save
}
```

## Testing Steps

### Test 1: Grid Size Slider

```bash
npm run build:ts
npm run dev
```

1. Open DevTools Console
2. Rapidly drag grid size slider back and forth
3. Check console: Should see only 1 save after you stop dragging
4. Before fix: Would see 10+ saves while dragging

### Test 2: Multiple Rapid Changes

```javascript
// In DevTools console, monitor saves
let saveCount = 0;
const originalSave = window.electronAPI.saveSettings;
window.electronAPI.saveSettings = async function(...args) {
  saveCount++;
  console.log(`Save #${saveCount}`);
  return originalSave.apply(this, args);
};

// Now rapidly change settings:
// - Change grid size 5 times
// - Change sort 3 times
// - Toggle favorites filter

// Wait 2 seconds
setTimeout(() => {
  console.log(`Total saves: ${saveCount}`);  // Should be 1
}, 2000);
```

### Test 3: Verify Saves on Exit

1. Make changes (grid size, filters, sort)
2. Close app immediately (don't wait for debounce)
3. Reopen app
4. Settings should be saved correctly

### Test 4: Verify Saves on Folder Switch

1. Make changes to settings
2. Immediately select new folder (don't wait)
3. Settings should save before folder switch
4. Return to original folder
5. Settings should be preserved

### Test 5: Performance Test

**Before fix:**
```javascript
// Drag grid slider 10 times rapidly
// Expected: 10 IPC calls, UI lag
```

**After fix:**
```javascript
// Drag grid slider 10 times rapidly
// Expected: 1 IPC call after 1 second, smooth UI
```

## Understanding Debouncing

### Visual Example

```
User actions:    X X X X X       X X       X
                 | | | | |       | |       |
Debounced:       - - - - ✓       - ✓       ✓
                         ^         ^       ^
                      (1s wait) (1s wait) (1s)

Without debounce: 9 saves
With debounce:    3 saves (70% reduction!)
```

### Debounce vs Throttle

**Debounce:** Wait for quiet period
- Use for: Text input, resize, settings saves
- Waits until user stops before executing
- Best for "commit" type operations

**Throttle:** Execute at regular intervals
- Use for: Scroll events, mouse tracking
- Executes at most once per period
- Best for "continuous" type operations

## Configuration Options

### Adjust Debounce Delay

In `UserDataManager.js`:

```javascript
// Fast (500ms) - saves quickly, but still reduces IPC calls
this.debouncedSave = debounce(() => {
  this.saveSettingsImmediate();
}, 500);

// Default (1000ms) - good balance
this.debouncedSave = debounce(() => {
  this.saveSettingsImmediate();
}, 1000);

// Slow (2000ms) - maximum reduction, but longer delay
this.debouncedSave = debounce(() => {
  this.saveSettingsImmediate();
}, 2000);
```

### Different Delays for Different Operations

```javascript
// Quick saves for critical settings
this.debouncedQuickSave = debounce(() => {
  this.saveSettingsImmediate();
}, 300);

// Slower saves for non-critical UI preferences
this.debouncedSlowSave = debounce(() => {
  this.saveUIPreferences();
}, 2000);
```

## Troubleshooting

### Settings not saving

**Problem:** Debounce delay too long, user closes app before save

**Solution:** Ensure `flushPendingSaves()` is called on `beforeunload`

### Changes lost on folder switch

**Problem:** Not flushing before folder switch

**Solution:** Add flush call before `scanVideos()`:
```javascript
await this.userDataManager.flushPendingSaves();
```

### Still seeing multiple saves

**Problem:** Multiple code paths calling save

**Solution:** Search for all `saveSettings` calls:
```bash
grep -r "saveSettings" app/
```

Replace with debounced version.

## Rollback Plan

If debouncing causes issues:

1. Remove debounce utility load from `index.html`
2. Restore original `saveSettings()` method
3. Remove `flushPendingSaves()` calls

## Success Criteria

- ✅ Grid size slider feels smooth (no lag)
- ✅ Only 1 save per interaction sequence (not 10+)
- ✅ Settings still save on app exit
- ✅ Settings still save on folder switch
- ✅ DevTools console shows reduced IPC calls
- ✅ No settings lost

## Performance Metrics

**Before:**
- 10 rapid grid changes: 10 IPC calls
- Typing folder filter: 20+ IPC calls
- UI lag during rapid changes
- Disk writes on every change

**After:**
- 10 rapid grid changes: 1 IPC call (after 1s quiet)
- Typing folder filter: 1 IPC call (after 1s quiet)
- Smooth UI during rapid changes
- Single disk write per interaction sequence

**Improvement:**
- 90% reduction in IPC calls
- 90% reduction in disk writes
- Smoother UI responsiveness
- Better battery life (fewer disk operations)

## Future Enhancements

### Auto-save Indicator

Add visual feedback:

```javascript
saveSettings() {
  this.hasPendingChanges = true;
  this.showSaveIndicator();  // Show "Saving..." indicator
  this.debouncedSave();
}

saveSettingsImmediate() {
  // ... save code ...
  this.hideSaveIndicator();  // Hide indicator
  this.showSavedIndicator();  // Show "Saved!" briefly
}
```

### Save Queue

For multiple types of settings:

```javascript
class SettingsSaveQueue {
  constructor() {
    this.queue = new Set();
    this.debouncedFlush = debounce(() => this.flush(), 1000);
  }

  enqueue(settingType) {
    this.queue.add(settingType);
    this.debouncedFlush();
  }

  flush() {
    // Save only changed settings
    for (const type of this.queue) {
      this.saveType(type);
    }
    this.queue.clear();
  }
}
```

### Throttle for Continuous Events

For scroll or drag events:

```javascript
// app/modules/VideoManager.js
this.throttledCheckVisible = throttle(() => {
  this.checkVisibleVideos();
}, 100);  // Max once per 100ms

window.addEventListener('scroll', () => {
  this.throttledCheckVisible();
});
```
