# Implementation Plan 4: Video Metadata Extraction

**Priority:** HIGH
**Estimated Effort:** 2-3 days
**Dependencies:** Plan 3 (Database Indexing) - recommended for performance

## Objective

Implement real video metadata extraction using FFprobe/FFmpeg to provide accurate video information (duration, dimensions, codec, bitrate) and enable advanced features like thumbnail generation and video analysis.

## Current Problem

- Video metadata extraction is stubbed (returns null)
- No duration, dimensions, or codec information available
- Thumbnail generation not implemented
- No video file validation beyond extension checking
- Limited sorting and filtering capabilities due to missing metadata

## Solution Design

### 1. FFprobe Integration

Use FFprobe (part of FFmpeg) to extract comprehensive video metadata.

```javascript
class VideoMetadataExtractor {
  constructor() {
    this.ffprobePath = this.findFFprobe();
    this.cache = new Map(); // Cache metadata to avoid re-extraction
    this.extractionQueue = [];
    this.concurrentExtractions = 3;
    this.isProcessing = false;
  }

  findFFprobe() {
    // Try common FFprobe locations
    const possiblePaths = [
      'ffprobe', // System PATH
      '/usr/bin/ffprobe',
      '/usr/local/bin/ffprobe',
      path.join(process.resourcesPath, 'ffprobe'), // Bundled with app
      path.join(__dirname, '../bin/ffprobe'), // Local bin directory
    ];

    for (const probePath of possiblePaths) {
      try {
        execSync(`"${probePath}" -version`, { stdio: 'ignore' });
        return probePath;
      } catch (error) {
        continue;
      }
    }

    throw new Error(
      'FFprobe not found. Please install FFmpeg or bundle FFprobe with the application.'
    );
  }

  async extractMetadata(videoPath) {
    // Check cache first
    const cacheKey = `${videoPath}:${await this.getFileModTime(videoPath)}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const metadata = await this.extractMetadataWithFFprobe(videoPath);
      this.cache.set(cacheKey, metadata);
      return metadata;
    } catch (error) {
      console.error(`Failed to extract metadata for ${videoPath}:`, error.message);
      return this.createFallbackMetadata(videoPath);
    }
  }
}
```

### 2. Robust Metadata Extraction

Handle various video formats and edge cases gracefully.

```javascript
async extractMetadataWithFFprobe(videoPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-select_streams', 'v:0', // First video stream
      videoPath
    ];

    const ffprobe = spawn(this.ffprobePath, args);
    let stdout = '';
    let stderr = '';

    ffprobe.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFprobe exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const data = JSON.parse(stdout);
        const metadata = this.parseFFprobeOutput(data);
        resolve(metadata);
      } catch (error) {
        reject(new Error(`Failed to parse FFprobe output: ${error.message}`));
      }
    });

    ffprobe.on('error', (error) => {
      reject(new Error(`Failed to spawn FFprobe: ${error.message}`));
    });

    // Timeout protection
    setTimeout(() => {
      ffprobe.kill('SIGKILL');
      reject(new Error('FFprobe timeout'));
    }, 30000); // 30 second timeout
  });
}

parseFFprobeOutput(data) {
  const format = data.format || {};
  const videoStream = data.streams?.find(s => s.codec_type === 'video') || {};

  return {
    duration: parseFloat(format.duration) || null,
    bitrate: parseInt(format.bit_rate) || null,
    size: parseInt(format.size) || null,
    width: parseInt(videoStream.width) || null,
    height: parseInt(videoStream.height) || null,
    codec: videoStream.codec_name || null,
    pixelFormat: videoStream.pix_fmt || null,
    frameRate: this.parseFrameRate(videoStream.r_frame_rate),
    aspectRatio: this.calculateAspectRatio(videoStream.width, videoStream.height),
    rotation: this.parseRotation(videoStream.tags),
    hasAudio: data.streams?.some(s => s.codec_type === 'audio') || false,
    formatName: format.format_name || null,
    title: format.tags?.title || null,
    creationTime: format.tags?.creation_time || null
  };
}

parseFrameRate(frameRateStr) {
  if (!frameRateStr || frameRateStr === '0/0') return null;
  const [num, den] = frameRateStr.split('/').map(Number);
  return den ? (num / den) : null;
}

calculateAspectRatio(width, height) {
  if (!width || !height) return null;
  const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

parseRotation(tags) {
  if (!tags) return 0;
  const rotation = tags.rotate || tags['rotate-90'] || '0';
  return parseInt(rotation) || 0;
}
```

### 3. Batch Processing and Queue Management

Process multiple videos efficiently without blocking the UI.

```javascript
class MetadataExtractionQueue {
  constructor(extractor, options = {}) {
    this.extractor = extractor;
    this.concurrency = options.concurrency || 3;
    this.queue = [];
    this.processing = new Set();
    this.callbacks = new Map();
    this.progress = { completed: 0, total: 0, failed: 0 };
  }

  async processVideo(videoPath) {
    return new Promise((resolve, reject) => {
      const id = this.generateId();
      this.queue.push({ id, videoPath, resolve, reject });
      this.callbacks.set(id, { resolve, reject });
      this.progress.total++;
      this.processQueue();
    });
  }

  async processVideos(videoPaths) {
    const promises = videoPaths.map((path) => this.processVideo(path));
    return Promise.allSettled(promises);
  }

  async processQueue() {
    while (this.queue.length > 0 && this.processing.size < this.concurrency) {
      const item = this.queue.shift();
      this.processing.add(item.id);
      this.processItem(item);
    }
  }

  async processItem(item) {
    try {
      const metadata = await this.extractor.extractMetadata(item.videoPath);
      this.progress.completed++;
      this.callbacks.get(item.id).resolve(metadata);
      this.emitProgress();
    } catch (error) {
      this.progress.failed++;
      this.callbacks.get(item.id).reject(error);
      console.error(`Metadata extraction failed for ${item.videoPath}:`, error);
    } finally {
      this.processing.delete(item.id);
      this.callbacks.delete(item.id);
      this.processQueue(); // Process next item
    }
  }

  emitProgress() {
    const progressData = {
      ...this.progress,
      percentage: (this.progress.completed / this.progress.total) * 100,
    };

    // Emit to main process for UI updates
    if (typeof process !== 'undefined' && process.send) {
      process.send({
        type: 'metadata-extraction-progress',
        data: progressData,
      });
    }
  }

  generateId() {
    return `extraction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

### 4. Integration with Video Scanner

Enhance the video scanning process to include metadata extraction.

```javascript
// Update video-scanner.js
class VideoScanner {
  constructor() {
    this.metadataExtractor = new VideoMetadataExtractor();
    this.extractionQueue = new MetadataExtractionQueue(this.metadataExtractor);
  }

  async scanDirectory(folderPath, options = {}) {
    const { extractMetadata = true, onProgress } = options;

    try {
      // First pass: collect all video files
      const videoFiles = await this.collectVideoFiles(folderPath);

      if (extractMetadata && videoFiles.length > 0) {
        // Second pass: extract metadata
        await this.extractMetadataForFiles(videoFiles, onProgress);
      }

      return videoFiles;
    } catch (error) {
      console.error('Video scanning failed:', error);
      throw error;
    }
  }

  async extractMetadataForFiles(videoFiles, onProgress) {
    const paths = videoFiles.map((file) => file.path);

    // Set up progress callback
    if (onProgress) {
      this.extractionQueue.onProgress = onProgress;
    }

    const results = await this.extractionQueue.processVideos(paths);

    // Update video objects with metadata
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        Object.assign(videoFiles[index], result.value);
      } else {
        console.warn(`Metadata extraction failed for ${videoFiles[index].path}:`, result.reason);
        // Use fallback metadata
        Object.assign(videoFiles[index], this.createFallbackMetadata(videoFiles[index].path));
      }
    });
  }

  createFallbackMetadata(videoPath) {
    return {
      duration: null,
      width: null,
      height: null,
      codec: null,
      bitrate: null,
      frameRate: null,
      aspectRatio: null,
      rotation: 0,
      hasAudio: true, // Assume true
      formatName: null,
      title: null,
      creationTime: null,
    };
  }
}
```

## Implementation Steps

### Phase 1: Core Metadata Extraction (Day 1)

1. **Set up FFprobe integration**
   - Detect FFprobe installation
   - Handle FFprobe execution and output parsing
   - Implement error handling and timeouts

2. **Create metadata extraction classes**
   - VideoMetadataExtractor with caching
   - Robust metadata parsing
   - Fallback handling for unsupported formats

3. **Add progress tracking**
   - Progress callbacks for UI updates
   - Cancellation support for long operations

### Phase 2: Queue and Batch Processing (Day 2)

1. **Implement extraction queue**
   - Concurrent processing with limits
   - Priority-based processing
   - Memory management for large batches

2. **Integration with existing scanner**
   - Update video-scanner.js to use metadata extraction
   - Maintain backward compatibility
   - Add configuration options

3. **Database schema updates**
   - Ensure all metadata fields are properly stored
   - Add indexes for new searchable fields
   - Handle migration of existing data

### Phase 3: UI Integration and Optimization (Day 3)

1. **Update UI to display metadata**
   - Show duration, resolution, codec in video grid
   - Add metadata-based filtering options
   - Display extraction progress

2. **Implement smart extraction**
   - Skip extraction for already-processed files
   - Background re-extraction for modified files
   - Configurable extraction preferences

3. **Performance optimization**
   - Cache frequently accessed metadata
   - Optimize extraction order (prioritize visible videos)
   - Add extraction result persistence

## Technical Implementation Details

### FFprobe Output Processing

```javascript
class MetadataParser {
  static parse(ffprobeOutput) {
    const data = JSON.parse(ffprobeOutput);
    const format = data.format || {};
    const videoStream = data.streams?.find((s) => s.codec_type === 'video');
    const audioStream = data.streams?.find((s) => s.codec_type === 'audio');

    return {
      // Basic video properties
      duration: this.parseDuration(format.duration),
      bitrate: this.parseBitrate(format.bit_rate),
      fileSize: parseInt(format.size) || null,

      // Video stream properties
      width: parseInt(videoStream?.width) || null,
      height: parseInt(videoStream?.height) || null,
      codec: videoStream?.codec_name || null,
      pixelFormat: videoStream?.pix_fmt || null,
      frameRate: this.parseFrameRate(videoStream?.r_frame_rate),

      // Calculated properties
      aspectRatio: this.calculateAspectRatio(videoStream?.width, videoStream?.height),
      resolution: this.getResolutionCategory(videoStream?.width, videoStream?.height),

      // Audio properties
      hasAudio: !!audioStream,
      audioCodec: audioStream?.codec_name || null,
      audioChannels: parseInt(audioStream?.channels) || null,

      // Metadata
      title: format.tags?.title || null,
      creationTime: this.parseCreationTime(format.tags?.creation_time),
      formatName: format.format_name || null,

      // Quality indicators
      quality: this.assessQuality(videoStream, format),
      isValid: this.validateVideo(videoStream, format),
    };
  }

  static getResolutionCategory(width, height) {
    if (!width || !height) return null;

    const pixels = width * height;
    if (pixels >= 7680 * 4320) return '8K';
    if (pixels >= 3840 * 2160) return '4K';
    if (pixels >= 1920 * 1080) return '1080p';
    if (pixels >= 1280 * 720) return '720p';
    if (pixels >= 854 * 480) return '480p';
    return 'SD';
  }

  static assessQuality(videoStream, format) {
    if (!videoStream || !format) return 'unknown';

    const bitrate = parseInt(format.bit_rate) || 0;
    const width = parseInt(videoStream.width) || 0;
    const height = parseInt(videoStream.height) || 0;

    // Simple quality assessment based on bitrate per pixel
    const pixels = width * height;
    const bitratePerPixel = pixels ? bitrate / pixels : 0;

    if (bitratePerPixel > 0.1) return 'high';
    if (bitratePerPixel > 0.05) return 'medium';
    return 'low';
  }
}
```

### Progress Reporting

```javascript
class ExtractionProgressReporter {
  constructor() {
    this.listeners = new Set();
  }

  addListener(callback) {
    this.listeners.add(callback);
  }

  removeListener(callback) {
    this.listeners.delete(callback);
  }

  reportProgress(data) {
    const progressInfo = {
      completed: data.completed,
      total: data.total,
      failed: data.failed,
      percentage: Math.round((data.completed / data.total) * 100),
      currentFile: data.currentFile || null,
      estimatedTimeRemaining: this.calculateETA(data),
    };

    this.listeners.forEach((callback) => {
      try {
        callback(progressInfo);
      } catch (error) {
        console.error('Progress callback error:', error);
      }
    });
  }

  calculateETA(data) {
    if (data.completed === 0) return null;

    const elapsed = Date.now() - data.startTime;
    const avgTimePerFile = elapsed / data.completed;
    const remaining = data.total - data.completed;

    return Math.round((remaining * avgTimePerFile) / 1000); // seconds
  }
}
```

## Files to Modify

1. **src/video-scanner.js**
   - Integrate metadata extraction
   - Add progress reporting
   - Handle extraction errors gracefully

2. **src/database.js**
   - Update schema if needed
   - Add metadata-based queries
   - Implement metadata caching

3. **app/renderer.js**
   - Display metadata in UI
   - Show extraction progress
   - Add metadata-based filtering

4. **Create new files:**
   - `src/metadata-extractor.js` - Core extraction logic
   - `src/metadata-parser.js` - FFprobe output parsing
   - `src/extraction-queue.js` - Batch processing

## Success Criteria

- **Accuracy:** 95%+ successful metadata extraction
- **Performance:** Process 100 videos in <2 minutes
- **Reliability:** Handle corrupted/unsupported files gracefully
- **User Experience:** Clear progress indication and cancellation

## Testing Plan

1. **Format Compatibility Testing**
   - Test with various video formats (MP4, MOV, AVI, etc.)
   - Test with different codecs (H.264, H.265, VP9, etc.)
   - Test with corrupted or incomplete files

2. **Performance Testing**
   - Benchmark extraction speed with different file sizes
   - Test concurrent extraction limits
   - Memory usage during batch processing

3. **Error Handling Testing**
   - Missing FFprobe installation
   - Corrupted video files
   - Network-mounted files
   - Permission issues

## Deployment Considerations

### FFprobe Distribution

- **Option 1:** Require users to install FFmpeg
- **Option 2:** Bundle FFprobe with application
- **Option 3:** Provide installation guide and auto-detection

### Recommended: Bundle FFprobe

```javascript
// In electron-builder configuration
"extraResources": [
  {
    "from": "resources/ffprobe",
    "to": "ffprobe",
    "filter": ["**/*"]
  }
]
```

## Rollback Plan

- Feature flag to enable/disable metadata extraction
- Graceful degradation when FFprobe not available
- Maintain compatibility with existing database records

## Next Steps

After completion, this enables:

- **Plan 7:** Thumbnail generation (using extracted metadata)
- Advanced video search and filtering
- Quality-based sorting and organization
- Video format conversion recommendations
