# Hardware Acceleration Check & Optimization

## What is Hardware Acceleration?

Hardware acceleration uses your **GPU** to decode videos instead of your CPU. This is **critical** for playing many videos simultaneously.

**Benefits**:
- ✅ **10-50x faster** video decoding
- ✅ **Much lower CPU usage** (90%+ reduction)
- ✅ **Smoother playback** with many videos
- ✅ **Lower power consumption**

**Without GPU acceleration**:
- ❌ CPU decodes all videos (slow!)
- ❌ High CPU usage (100% on all cores)
- ❌ Dropped frames, stuttering
- ❌ Battery drain on laptops

---

## Quick Check: Is Hardware Acceleration Enabled?

### Method 1: Chrome GPU Page (While App is Running)

1. Start your app:
   ```bash
   npm run dev
   ```

2. Open Chrome/Electron's GPU info page in your app:
   - **Option A**: Add this to your app's dev menu
   - **Option B**: In the browser console, run:
     ```javascript
     window.open('chrome://gpu')
     ```

3. Look for these sections:

#### ✅ **GOOD** - Hardware Acceleration ON:
```
Graphics Feature Status
- Canvas: Hardware accelerated
- Canvas out-of-process rasterization: Enabled
- Video Decode: Hardware accelerated
- Vulkan: Enabled (or Metal on macOS)

Video Acceleration Information
- Decode h264 baseline: Supported
- Decode h264 main: Supported
- Decode h264 high: Supported
- Decode vp8: Supported
- Decode vp9: Supported
```

#### ❌ **BAD** - Hardware Acceleration OFF:
```
Graphics Feature Status
- Video Decode: Software only, hardware acceleration unavailable
- Canvas: Software only

Problems Detected
- GPU process was unable to boot
- Hardware acceleration disabled
```

---

### Method 2: Activity Monitor / Task Manager

1. Load 20-30 videos in your app
2. Open Activity Monitor (macOS) or Task Manager (Windows)
3. Check CPU usage:

**With GPU acceleration** ✅:
- CPU usage: 10-30%
- GPU usage: 40-80%
- Smooth playback

**Without GPU acceleration** ❌:
- CPU usage: 80-100% (all cores maxed)
- GPU usage: <5%
- Stuttering playback

---

### Method 3: Check Electron Flags

Run this in your app's browser console:
```javascript
console.log(process.argv);
```

Look for these flags:

**BAD** (if present, acceleration is disabled):
```
--disable-gpu
--disable-gpu-compositing
--disable-software-rasterizer
```

**GOOD** (if present, acceleration is enabled):
```
--enable-gpu-rasterization
--enable-zero-copy
--enable-features=VaapiVideoDecoder (Linux)
```

---

## Enable Hardware Acceleration

### Current Status Check

Your `src/main.ts` likely has standard Electron settings. Let me check what we need to add/verify.

### Step 1: Verify No Disabling Flags

**Check `src/main.ts`** - Make sure these are NOT present:
```typescript
// ❌ DON'T DO THIS
app.disableHardwareAcceleration();

// ❌ DON'T DO THIS
app.commandLine.appendSwitch('disable-gpu');
```

If you find these, **REMOVE THEM**.

---

### Step 2: Enable GPU Acceleration (Recommended Settings)

Add this to `src/main.ts` **BEFORE** `app.whenReady()`:

```typescript
import { app, BrowserWindow } from 'electron';

// ========================================
// GPU/Hardware Acceleration Configuration
// ========================================

// Enable GPU rasterization for better performance
app.commandLine.appendSwitch('enable-gpu-rasterization');

// Enable zero-copy for video decoding (reduces memory copies)
app.commandLine.appendSwitch('enable-zero-copy');

// On macOS: Use Metal for better performance
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('enable-metal');
}

// On Linux: Enable VA-API for hardware video decoding
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
  app.commandLine.appendSwitch('enable-accelerated-video-decode');
}

// On Windows: Enable D3D11 video decoding
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('enable-features', 'D3D11VideoDecoder');
}

// Increase video decoder threads (for many simultaneous videos)
app.commandLine.appendSwitch('video-threads', '8');

// Enable hardware overlays (better video compositing)
app.commandLine.appendSwitch('enable-hardware-overlays');

// ========================================
```

---

### Step 3: BrowserWindow WebPreferences

Ensure your BrowserWindow has these settings:

```typescript
const mainWindow = new BrowserWindow({
  width: 1600,
  height: 1000,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    preload: path.join(__dirname, 'preload.js'),
    
    // ========================================
    // Hardware Acceleration Settings
    // ========================================
    webgl: true,                    // Enable WebGL (GPU rendering)
    enableWebSQL: false,            // Disable (not needed)
    backgroundThrottling: false,    // Don't throttle when in background
    offscreen: false,               // Use GPU rendering
    
    // Allow unlimited video elements (for grid)
    webSecurity: true,              // Keep security on
    allowRunningInsecureContent: false,
  },
});
```

---

### Step 4: Test Hardware Acceleration

1. Restart your app with the new settings:
   ```bash
   npm run dev
   ```

2. In the app console, check GPU status:
   ```javascript
   // Add a debug command
   window.debugGPU = () => {
     console.log('Process args:', process.argv);
     console.log('Chrome version:', process.versions.chrome);
     console.log('Electron version:', process.versions.electron);
     
     // Try to get GPU info
     if (navigator.gpu) {
       console.log('WebGPU available:', navigator.gpu);
     }
     
     // Check canvas acceleration
     const canvas = document.createElement('canvas');
     const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
     if (gl) {
       const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
       if (debugInfo) {
         console.log('GPU Vendor:', gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL));
         console.log('GPU Renderer:', gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
       }
     }
   };
   
   window.debugGPU();
   ```

3. Load 20-30 videos and monitor:
   - CPU usage should be LOW (10-30%)
   - GPU usage should be MEDIUM-HIGH (40-80%)
   - Videos should play smoothly

---

## Platform-Specific Issues

### macOS

**Common Issue**: Metal not enabled

**Fix**:
```typescript
app.commandLine.appendSwitch('enable-metal');
```

**Check Metal is working**:
- Open Activity Monitor
- View → GPU History
- You should see GPU activity when playing videos

---

### Windows

**Common Issue**: DirectX not properly initialized

**Fix**:
```typescript
app.commandLine.appendSwitch('enable-features', 'D3D11VideoDecoder');
app.commandLine.appendSwitch('use-angle', 'default');
```

**Check DirectX is working**:
- Task Manager → Performance tab → GPU
- You should see "Video Decode" activity

---

### Linux

**Common Issue**: VA-API not enabled

**Fix**:
```bash
# Install VA-API drivers
sudo apt install libva2 vainfo

# Check VA-API support
vainfo
```

Then in Electron:
```typescript
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
```

---

## Troubleshooting

### Issue: GPU shows "Software only"

**Possible causes**:
1. GPU drivers outdated
2. Running in VM or remote desktop
3. GPU blacklisted by Chromium

**Fixes**:
1. Update GPU drivers
2. Force enable GPU:
   ```typescript
   app.commandLine.appendSwitch('ignore-gpu-blacklist');
   ```

---

### Issue: Videos still stuttering with GPU enabled

**Possible causes**:
1. Too many videos loaded (50 is a lot!)
2. Video codec not hardware accelerated (H.265/HEVC might not be supported)
3. High resolution videos (4K uses more VRAM)

**Fixes**:
1. Reduce `maxActiveVideos` from 50 to 30-40
2. Check codec compatibility (next section)
3. Reduce `bufferRows` if memory constrained

---

## Advanced: Monitor GPU Performance

### Create Debug Overlay

Add this to your renderer:
```javascript
window.showGPUStats = () => {
  const statsDiv = document.createElement('div');
  statsDiv.id = 'gpu-stats';
  statsDiv.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: rgba(0,0,0,0.8);
    color: white;
    padding: 10px;
    font-family: monospace;
    font-size: 12px;
    z-index: 9999;
  `;
  document.body.appendChild(statsDiv);
  
  setInterval(() => {
    const videos = document.querySelectorAll('video');
    const loadedVideos = Array.from(videos).filter(v => v.src && !v.paused).length;
    
    statsDiv.innerHTML = `
      <div>Active Videos: ${loadedVideos}</div>
      <div>Total Videos: ${videos.length}</div>
      <div>Memory: ${(performance.memory?.usedJSHeapSize / 1024 / 1024).toFixed(0)} MB</div>
    `;
  }, 1000);
};

// Auto-show in dev mode
if (process.env.NODE_ENV === 'development') {
  setTimeout(() => window.showGPUStats(), 2000);
}
```

---

## Expected Performance with Hardware Acceleration

### With 50 Videos Playing Simultaneously

**CPU Usage**:
- macOS: 10-20%
- Windows: 15-25%
- Linux: 20-30%

**GPU Usage**:
- macOS: 50-70%
- Windows: 40-60%
- Linux: 40-60%

**Memory Usage**:
- RAM: 2-4 GB
- VRAM: 1-3 GB (depends on resolution)

**If your numbers are significantly higher**, hardware acceleration might not be working properly.

---

## Summary

### Quick Enable Checklist

1. ✅ Add GPU flags to `src/main.ts`
2. ✅ Set proper `webPreferences` in BrowserWindow
3. ✅ Restart app
4. ✅ Check `chrome://gpu` shows "Hardware accelerated"
5. ✅ Monitor CPU/GPU usage while playing videos
6. ✅ CPU should be LOW, GPU should be MEDIUM-HIGH

### Expected Results

- ✅ CPU usage < 30%
- ✅ Smooth video playback
- ✅ Can play 30-50 videos simultaneously
- ✅ Low latency scrolling

**If you're still having issues after enabling GPU acceleration, the next step is codec optimization!**
