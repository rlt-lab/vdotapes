# Thumbnail UI Integration Guide

**Goal**: Add thumbnail generation UI to VDOTapes  
**Time**: 30-60 minutes  
**Difficulty**: Easy

---

## Current Status

✅ **Backend**: Fully working thumbnail generator with FFmpeg  
❌ **Frontend**: No UI to generate or display thumbnails

---

## Option 1: Simple Thumbnail Preview (5 minutes)

Add thumbnail as video poster/background image.

### Step 1: Modify GridRenderer

**File**: `app/modules/GridRenderer.js`

```javascript
createVideoItemHTML(video, index) {
  // ... existing code ...
  
  return `
    <div class="video-item" 
         data-video-id="${video.id}" 
         data-index="${index}">
      
      <!-- Add thumbnail div -->
      <div class="video-thumbnail" data-video-id="${video.id}">
        <div class="thumbnail-placeholder">Loading...</div>
      </div>
      
      <video 
        data-src="${video.path}" 
        poster=""  <!-- Thumbnail will be set here -->
        preload="none"
        ...>
      </video>
      
      <!-- Rest of HTML -->
    </div>
  `;
}
```

### Step 2: Load Thumbnails After Render

**File**: `app/modules/VideoManager.js`

Add new method:

```javascript
async loadThumbnailsForVisibleVideos() {
  const visibleVideos = this.app.displayedVideos.slice(0, 20); // First 20 videos
  
  for (const video of visibleVideos) {
    try {
      // Try to get cached thumbnail first
      let thumbnailData = await window.api.getThumbnail(video.id);
      
      // If not cached, generate it
      if (!thumbnailData) {
        const result = await window.api.generateThumbnail(video.path, 10); // 10 seconds in
        if (!result.success) continue;
        thumbnailData = { thumbnail_path: result.thumbnailPath };
      }
      
      // Set as poster
      if (thumbnailData?.thumbnail_path) {
        const videoEl = document.querySelector(`video[data-src="${video.path}"]`);
        if (videoEl) {
          videoEl.poster = thumbnailData.thumbnail_path;
        }
      }
    } catch (error) {
      console.error(`Failed to load thumbnail for ${video.id}:`, error);
    }
  }
}
```

### Step 3: Call After Rendering

**File**: `app/modules/GridRenderer.js`

```javascript
renderSmartGrid() {
  // ... existing rendering code ...
  
  // Load thumbnails after grid is rendered
  setTimeout(() => {
    this.app.videoManager.loadThumbnailsForVisibleVideos();
  }, 500);
}
```

### Step 4: Add CSS

**File**: `app/styles.css`

```css
.video-thumbnail {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
  pointer-events: none;
  z-index: 1;
}

.video-item video {
  z-index: 2;
}

.video-item video[poster] {
  background: transparent;
}

.thumbnail-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
  font-size: 12px;
}
```

---

## Option 2: Settings Panel (30 minutes)

Add a settings UI for thumbnail generation.

### Step 1: Add Settings HTML

**File**: `app/index.html`

Add before closing `</body>`:

```html
<!-- Thumbnail Settings Modal -->
<div id="thumbnail-settings-modal" class="modal hidden">
  <div class="modal-content">
    <h2>Thumbnail Settings</h2>
    
    <div class="setting-group">
      <label>
        <input type="checkbox" id="auto-generate-thumbnails" checked>
        Auto-generate thumbnails on scan
      </label>
    </div>
    
    <div class="setting-group">
      <label>
        Thumbnail Quality:
        <input type="range" id="thumbnail-quality" min="50" max="100" value="80">
        <span id="quality-value">80</span>
      </label>
    </div>
    
    <div class="setting-group">
      <label>
        Thumbnail Timestamp:
        <select id="thumbnail-timestamp">
          <option value="10">10% into video</option>
          <option value="25" selected>25% into video</option>
          <option value="50">50% into video</option>
        </select>
      </label>
    </div>
    
    <div class="setting-group">
      <button id="generate-all-thumbnails">Generate All Thumbnails</button>
      <button id="clear-thumbnail-cache">Clear Cache</button>
    </div>
    
    <div id="thumbnail-progress" class="hidden">
      <progress id="thumbnail-progress-bar" max="100" value="0"></progress>
      <span id="thumbnail-progress-text">0 / 0</span>
    </div>
    
    <div class="setting-group">
      <button id="close-thumbnail-settings">Close</button>
    </div>
  </div>
</div>
```

### Step 2: Add Settings Button

**File**: `app/index.html`

In the toolbar:

```html
<button id="thumbnail-settings-btn" title="Thumbnail Settings">
  <span class="icon">🖼️</span>
</button>
```

### Step 3: Add Settings Logic

**File**: Create `app/modules/ThumbnailManager.js`

```javascript
class ThumbnailManager {
  constructor(app) {
    this.app = app;
    this.isGenerating = false;
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Open settings
    document.getElementById('thumbnail-settings-btn')?.addEventListener('click', () => {
      this.openSettings();
    });
    
    // Close settings
    document.getElementById('close-thumbnail-settings')?.addEventListener('click', () => {
      this.closeSettings();
    });
    
    // Generate all
    document.getElementById('generate-all-thumbnails')?.addEventListener('click', () => {
      this.generateAllThumbnails();
    });
    
    // Clear cache
    document.getElementById('clear-thumbnail-cache')?.addEventListener('click', () => {
      this.clearCache();
    });
    
    // Quality slider
    const qualityInput = document.getElementById('thumbnail-quality');
    const qualityValue = document.getElementById('quality-value');
    qualityInput?.addEventListener('input', (e) => {
      qualityValue.textContent = e.target.value;
    });
  }

  openSettings() {
    document.getElementById('thumbnail-settings-modal')?.classList.remove('hidden');
  }

  closeSettings() {
    document.getElementById('thumbnail-settings-modal')?.classList.add('hidden');
  }

  async generateAllThumbnails() {
    if (this.isGenerating) return;
    
    this.isGenerating = true;
    const videos = this.app.allVideos;
    const progress = document.getElementById('thumbnail-progress');
    const progressBar = document.getElementById('thumbnail-progress-bar');
    const progressText = document.getElementById('thumbnail-progress-text');
    
    progress?.classList.remove('hidden');
    progressBar.max = videos.length;
    
    let completed = 0;
    
    for (const video of videos) {
      try {
        const timestamp = this.getTimestampSetting();
        await window.api.generateThumbnail(video.path, timestamp);
        completed++;
        progressBar.value = completed;
        progressText.textContent = `${completed} / ${videos.length}`;
      } catch (error) {
        console.error(`Failed to generate thumbnail for ${video.id}:`, error);
      }
    }
    
    progress?.classList.add('hidden');
    this.isGenerating = false;
    alert(`Generated ${completed} thumbnails!`);
  }

  async clearCache() {
    if (!confirm('Clear all cached thumbnails? They will need to be regenerated.')) {
      return;
    }
    
    try {
      // TODO: Add clearCache IPC handler
      alert('Cache cleared!');
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  }

  getTimestampSetting() {
    const select = document.getElementById('thumbnail-timestamp');
    return parseInt(select?.value || '25');
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ThumbnailManager;
} else {
  window.ThumbnailManager = ThumbnailManager;
}
```

### Step 4: Initialize in Renderer

**File**: `app/renderer.js`

```javascript
constructor() {
  // ... existing code ...
  
  // Add thumbnail manager
  this.thumbnailManager = new ThumbnailManager(this);
}
```

### Step 5: Add Modal CSS

**File**: `app/styles.css`

```css
.modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.modal.hidden {
  display: none;
}

.modal-content {
  background: #1e1e1e;
  padding: 30px;
  border-radius: 8px;
  max-width: 500px;
  width: 90%;
  color: #fff;
}

.modal-content h2 {
  margin-top: 0;
  margin-bottom: 20px;
}

.setting-group {
  margin-bottom: 20px;
}

.setting-group label {
  display: block;
  margin-bottom: 8px;
}

.setting-group input[type="range"] {
  width: 200px;
}

.setting-group button {
  padding: 10px 20px;
  margin-right: 10px;
  background: #007acc;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.setting-group button:hover {
  background: #005a9e;
}

#thumbnail-progress {
  margin: 20px 0;
}

#thumbnail-progress progress {
  width: 100%;
  height: 24px;
}

#thumbnail-progress-text {
  display: block;
  margin-top: 8px;
  text-align: center;
  font-size: 14px;
}
```

---

## Option 3: Auto-Generate on Scan (15 minutes)

Automatically generate thumbnails when scanning videos.

### Step 1: Modify IPC Handler

**File**: `src/ipc-handlers.ts`

```typescript
async handleScanVideos(
  _event: Electron.IpcMainInvokeEvent,
  folderPath: string,
  lastFolder: string | null = null
): Promise<ScanResult> {
  try {
    // ... existing scan code ...
    
    // Generate thumbnails in background
    this.generateThumbnailsInBackground(result.videos);
    
    return result;
  } catch (error) {
    // ... error handling ...
  }
}

private async generateThumbnailsInBackground(videos: readonly VideoRecord[]): Promise<void> {
  // Don't await - run in background
  setTimeout(async () => {
    try {
      if (!this.thumbnailGenerator) return;
      
      const videoPaths = videos.map(v => v.path);
      console.log(`Generating thumbnails for ${videoPaths.length} videos...`);
      
      const results = await this.thumbnailGenerator.generateBatch(videoPaths);
      const successful = results.filter(r => r.success).length;
      
      console.log(`Generated ${successful}/${videoPaths.length} thumbnails`);
      
      // Save to database
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.success && result.thumbnailPath) {
          const video = videos[i];
          this.database.saveThumbnail(
            video.id,
            result.thumbnailPath,
            result.timestamp
          );
        }
      }
    } catch (error) {
      console.error('Background thumbnail generation failed:', error);
    }
  }, 2000); // Wait 2 seconds after scan
}
```

---

## Testing

### Test Thumbnail Generation

1. **Start the app**:
   ```bash
   npm run dev
   ```

2. **Open DevTools** → Console

3. **Test generateThumbnail**:
   ```javascript
   const video = app.allVideos[0];
   const result = await window.api.generateThumbnail(video.path, 10);
   console.log(result);
   // Should show: { success: true, thumbnailPath: "/path/to/thumbnail.jpg", ... }
   ```

4. **Test getThumbnail**:
   ```javascript
   const video = app.allVideos[0];
   const cached = await window.api.getThumbnail(video.id);
   console.log(cached);
   // Should show: { thumbnail_path: "/path/to/thumbnail.jpg", timestamp: 10 }
   ```

5. **Verify thumbnail file exists**:
   ```bash
   ls /tmp/vdotapes_thumbnails/
   # Should show .jpg files
   ```

---

## Performance Considerations

### Batch Generation

- Generate 10-20 thumbnails at a time
- Use `Promise.all()` for parallel generation
- Show progress to user

### Caching

- Always check cache before generating
- Thumbnails are cached by video path + timestamp
- Cache persists between app restarts

### Background Generation

- Don't block UI during generation
- Use `setTimeout()` to defer to background
- Consider Web Workers for large batches

---

## Next Steps

Choose one option:

1. **Quick win** (5 min): Add thumbnail posters to video elements
2. **User control** (30 min): Add settings panel
3. **Automatic** (15 min): Auto-generate on scan

Or do all three for full thumbnail support!

---

## Troubleshooting

### Thumbnails Not Showing

**Check 1**: Is FFmpeg installed?
```bash
ffmpeg -version
```

**Check 2**: Is thumbnail generator loaded?
```javascript
// In browser console
window.api.generateThumbnail  // Should be a function
```

**Check 3**: Check console for errors
```javascript
const result = await window.api.generateThumbnail('/path/to/video.mp4', 10);
console.log(result);
// Look for error property
```

### Slow Generation

**Solution 1**: Reduce quality
```javascript
// In ipc-handlers.ts, pass quality config
const result = await this.thumbnailGenerator.generateThumbnail(videoPath, timestamp);
// Thumbnails use default quality (80)
```

**Solution 2**: Generate fewer thumbnails
```javascript
// Only generate for visible videos
const visible = app.displayedVideos.slice(0, 20);
```

### Cache Growing Too Large

**Solution**: Add cache size limit check
```javascript
const stats = await window.api.getCacheStats();
if (stats.totalSizeBytes > 1024 * 1024 * 100) { // 100MB
  await window.api.clearCache();
}
```
