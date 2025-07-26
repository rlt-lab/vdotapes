# Photo Management App Refactor Workflow

## Project Overview
This document provides step-by-step instructions for a junior developer to refactor the existing VdoTapes video viewer application into a comprehensive photo management application. The new app will maintain the same high-quality UX/UI while adapting functionality for image files instead of videos.

## Development Principles
**Adhere strictly to these principles throughout development:**
- **KISS (Keep It Simple, Stupid)** - Avoid over-engineering, prefer simple solutions
- **DRY (Don't Repeat Yourself)** - Eliminate code duplication through proper abstraction
- **YAGNI (You Aren't Gonna Need It)** - Only implement features that are actually needed
- **SOLID Principles** - Write maintainable, extensible code
- **Modularity** - Keep modules small and focused (aim for <200 lines per module)
- **AI-Friendly Code** - Write clear, well-documented code that's easy for AI to understand and modify

## Target Features

### Core Features
- **Grid view** of all images in a root directory and subfolders
- **Duplicate finder** to identify and manage duplicate photos
- **Sorting options** for date created, file size, image dimensions, and filename
- **Right-click context menu** with delete, copy, open location, and EXIF data viewing
- **EXIF data popup** for detailed image metadata display

### Technical Requirements
- Node.js + Electron desktop application
- Similar UX/UI to the existing VdoTapes app
- Cross-platform compatibility (macOS, Windows, Linux)
- High performance with large image collections
- Secure architecture with proper IPC communication

## Phase 1: Project Setup and Configuration

### Step 1.1: Update Package Configuration
**File: `package.json`**
```json
{
  "name": "photosorter",
  "version": "1.0.0",
  "description": "High-performance photo management and sorting application",
  "author": "PhotoSorter Team",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "dev": "electron . --dev",
    "build": "electron-builder",
    "build:mac": "electron-builder --mac",
    "build:win": "electron-builder --win",
    "pack": "electron-builder --dir"
  },
  "build": {
    "appId": "com.yourcompany.photosorter",
    "productName": "PhotoSorter",
    "directories": {
      "output": "dist"
    },
    "mac": {
      "category": "public.app-category.photography",
      "icon": "app/assets/icon.png",
      "target": "dmg"
    },
    "win": {
      "icon": "build/icon.ico",
      "target": [
        {
          "target": "portable",
          "arch": ["x64"]
        },
        {
          "target": "nsis",
          "arch": ["x64"]
        }
      ]
    }
  }
}
```

### Step 1.2: Install Additional Dependencies
```bash
npm install --save exif-reader sharp piexifjs
npm install --save-dev @types/node
```

**Dependencies explanation:**
- `exif-reader` - Extract EXIF data from images
- `sharp` - High-performance image processing (already installed)
- `piexifjs` - JavaScript EXIF library for browser-side processing

## Phase 2: Backend Refactoring

### Step 2.1: Create Image Scanner (`src/image-scanner.js`)
**Replace video-scanner.js functionality**

```javascript
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const crypto = require('crypto');

class ImageScanner {
  constructor() {
    // Supported image formats
    this.IMAGE_EXTENSIONS = new Set([
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', 
      '.webp', '.svg', '.ico', '.heic', '.heif', '.raw', '.cr2', 
      '.nef', '.arw', '.dng'
    ]);
    
    this.EXCLUDED_DIRECTORIES = new Set(['.', 'node_modules', '.git']);
    this.SYSTEM_FILE_PREFIX = '._';
    
    this.isScanning = false;
    this.scanProgress = 0;
    this.totalFiles = 0;
    this.processedFiles = 0;
    this.images = [];
  }

  /**
   * Check if file is a valid image
   */
  isValidImageFile(filename) {
    if (filename.startsWith(this.SYSTEM_FILE_PREFIX)) return false;
    const ext = path.extname(filename).toLowerCase();
    return this.IMAGE_EXTENSIONS.has(ext);
  }

  /**
   * Generate hash for duplicate detection
   */
  async generateImageHash(filePath) {
    try {
      const buffer = await fs.readFile(filePath);
      return crypto.createHash('md5').update(buffer).digest('hex');
    } catch (error) {
      console.error('Error generating hash:', error);
      return null;
    }
  }

  /**
   * Extract image metadata using Sharp
   */
  async getImageMetadata(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const metadata = await sharp(filePath).metadata();
      
      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: stats.size,
        lastModified: stats.mtime.getTime(),
        created: stats.birthtime.getTime(),
        density: metadata.density,
        hasAlpha: metadata.hasAlpha,
        channels: metadata.channels
      };
    } catch (error) {
      console.error('Error getting image metadata:', error);
      return null;
    }
  }

  // ... (continue with similar structure to video-scanner.js)
}

module.exports = ImageScanner;
```

### Step 2.2: Update Database Schema (`src/database.js`)
**Modify existing database to handle images instead of videos**

Key changes:
- Rename `videos` table to `images`
- Add image-specific fields: `width`, `height`, `format`, `hash` (for duplicates)
- Add `duplicates` table for duplicate management
- Add `exif_data` table for EXIF information storage

```javascript
// Add to createTables() method
this.db.exec(`
  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    relative_path TEXT,
    folder TEXT,
    size INTEGER,
    width INTEGER,
    height INTEGER,
    format TEXT,
    hash TEXT,
    last_modified INTEGER,
    created INTEGER,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

this.db.exec(`
  CREATE TABLE IF NOT EXISTS duplicates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_image_id TEXT,
    duplicate_image_id TEXT,
    similarity_score REAL,
    detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (original_image_id) REFERENCES images (id),
    FOREIGN KEY (duplicate_image_id) REFERENCES images (id)
  )
`);

this.db.exec(`
  CREATE TABLE IF NOT EXISTS exif_data (
    image_id TEXT PRIMARY KEY,
    camera_make TEXT,
    camera_model TEXT,
    lens_model TEXT,
    focal_length REAL,
    aperture REAL,
    shutter_speed TEXT,
    iso INTEGER,
    flash TEXT,
    gps_latitude REAL,
    gps_longitude REAL,
    date_taken DATETIME,
    orientation INTEGER,
    raw_exif TEXT,
    FOREIGN KEY (image_id) REFERENCES images (id) ON DELETE CASCADE
  )
`);
```

### Step 2.3: Create EXIF Data Handler (`src/exif-handler.js`)
**New module for EXIF data extraction and management**

```javascript
const ExifReader = require('exif-reader');
const fs = require('fs').promises;

class ExifHandler {
  constructor() {
    this.supportedFormats = new Set(['jpg', 'jpeg', 'tiff', 'tif']);
  }

  /**
   * Extract EXIF data from image file
   */
  async extractExifData(filePath) {
    try {
      const buffer = await fs.readFile(filePath);
      const exifData = ExifReader(buffer);
      
      return this.parseExifData(exifData);
    } catch (error) {
      console.error('Error extracting EXIF data:', error);
      return null;
    }
  }

  /**
   * Parse and normalize EXIF data
   */
  parseExifData(rawExif) {
    if (!rawExif) return null;

    const parsed = {
      cameraMake: rawExif.image?.Make,
      cameraModel: rawExif.image?.Model,
      lensModel: rawExif.exif?.LensModel,
      focalLength: rawExif.exif?.FocalLength,
      aperture: rawExif.exif?.FNumber,
      shutterSpeed: rawExif.exif?.ExposureTime,
      iso: rawExif.exif?.ISO,
      flash: rawExif.exif?.Flash,
      dateTaken: rawExif.exif?.DateTimeOriginal,
      orientation: rawExif.image?.Orientation,
      gpsLatitude: this.parseGPS(rawExif.gps?.GPSLatitude, rawExif.gps?.GPSLatitudeRef),
      gpsLongitude: this.parseGPS(rawExif.gps?.GPSLongitude, rawExif.gps?.GPSLongitudeRef),
      rawExif: JSON.stringify(rawExif)
    };

    return parsed;
  }

  /**
   * Parse GPS coordinates
   */
  parseGPS(coordinate, reference) {
    if (!coordinate || !Array.isArray(coordinate)) return null;
    
    const decimal = coordinate[0] + coordinate[1]/60 + coordinate[2]/3600;
    return (reference === 'S' || reference === 'W') ? -decimal : decimal;
  }
}

module.exports = ExifHandler;
```

### Step 2.4: Create Duplicate Finder (`src/duplicate-finder.js`)
**New module for finding duplicate images**

```javascript
const sharp = require('sharp');
const crypto = require('crypto');

class DuplicateFinder {
  constructor() {
    this.SIMILARITY_THRESHOLD = 0.95; // 95% similarity
  }

  /**
   * Find duplicates in image collection
   */
  async findDuplicates(images) {
    const duplicates = [];
    const hashMap = new Map();
    
    // First pass: exact duplicates by file hash
    for (const image of images) {
      if (hashMap.has(image.hash)) {
        duplicates.push({
          original: hashMap.get(image.hash),
          duplicate: image,
          type: 'exact',
          similarity: 1.0
        });
      } else {
        hashMap.set(image.hash, image);
      }
    }

    // Second pass: visual similarity (optional, more complex)
    // This would require perceptual hashing algorithms
    
    return duplicates;
  }

  /**
   * Generate perceptual hash for visual similarity
   */
  async generatePerceptualHash(imagePath) {
    try {
      // Simplified perceptual hash - resize to 8x8 and get average
      const { data } = await sharp(imagePath)
        .resize(8, 8)
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      const average = data.reduce((sum, pixel) => sum + pixel, 0) / data.length;
      
      let hash = '';
      for (let i = 0; i < data.length; i++) {
        hash += data[i] > average ? '1' : '0';
      }
      
      return hash;
    } catch (error) {
      console.error('Error generating perceptual hash:', error);
      return null;
    }
  }
}

module.exports = DuplicateFinder;
```

## Phase 3: Frontend Refactoring

### Step 3.1: Update HTML Structure (`app/index.html`)
**Modify existing HTML for photo management**

Key changes:
- Update title and branding to "PhotoSorter"
- Add duplicate finder controls
- Add EXIF data modal
- Add context menu structure
- Update filter controls for image-specific sorting

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PhotoSorter - High Performance Photo Management</title>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self';">
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="header">
        <div class="controls">
            <div class="brand-title">PhotoSorter</div>
            <button class="folder-btn" id="folderBtn">📁 Select Photo Folder</button>
            <button class="duplicates-btn" id="duplicatesBtn">🔍 Find Duplicates</button>
            <div class="status" id="status">No folder selected</div>
            
            <div class="filter-controls" id="filterControls">
                <!-- Existing controls plus new ones -->
                <button class="sort-btn" id="sortSizeBtn" title="Sort by file size" data-sort="size">
                    <svg viewBox="0 0 24 24">
                        <path d="M9 3L5 6.99h3V14h2V6.99h3L9 3zm7 14.01V10h-2v7.01h-3L15 21l4-3.99h-3z"/>
                    </svg>
                </button>
                
                <button class="sort-btn" id="sortDimensionsBtn" title="Sort by dimensions" data-sort="dimensions">
                    <svg viewBox="0 0 24 24">
                        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/>
                    </svg>
                </button>
            </div>
        </div>
    </div>

    <!-- Add EXIF Modal -->
    <div class="exif-modal" id="exifModal">
        <div class="exif-content">
            <div class="exif-header">
                <h3>Image Details</h3>
                <button class="close-btn" id="exifCloseBtn">×</button>
            </div>
            <div class="exif-body" id="exifBody">
                <!-- EXIF data will be populated here -->
            </div>
        </div>
    </div>

    <!-- Add Context Menu -->
    <div class="context-menu" id="contextMenu">
        <div class="context-item" id="contextDelete">🗑️ Delete</div>
        <div class="context-item" id="contextCopy">📋 Copy</div>
        <div class="context-item" id="contextLocation">📂 Show in Folder</div>
        <div class="context-item" id="contextExif">ℹ️ View EXIF Data</div>
    </div>

    <!-- Rest of existing structure -->
    <div class="container">
        <div class="progress-bar" id="progressBar">
            <div class="progress-fill" id="progressFill"></div>
        </div>

        <div id="content">
            <div class="empty-state">
                <h2>Welcome to PhotoSorter</h2>
                <p>High-performance photo management with advanced sorting and duplicate detection.<br>
                Select a folder containing your photos to get started.</p>
                <div style="margin-top: 2rem; color: #777; font-size: 0.85rem;">
                    📱 Responsive grid layout with customizable columns<br>
                    🖼️ Formats: JPG, PNG, GIF, BMP, TIFF, WebP, HEIC, RAW<br>
                    🔍 Advanced duplicate detection and management<br>
                    📊 Sort by date, size, dimensions, and filename<br>
                    📋 Right-click context menu with file operations<br>
                    📷 Detailed EXIF data viewing<br>
                    💾 Persistent favorites and settings
                </div>
            </div>
        </div>
    </div>

    <script src="renderer.js"></script>
</body>
</html>
```

### Step 3.2: Update CSS Styles (`app/styles.css`)
**Add styles for new photo-specific features**

Add these new styles to the existing CSS:

```css
/* Duplicate finder button */
.duplicates-btn {
    background: linear-gradient(135deg, #ff6b6b, #ee5a24);
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    margin-left: 10px;
    transition: all 0.2s ease;
}

.duplicates-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(255, 107, 107, 0.3);
}

/* EXIF Modal */
.exif-modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    z-index: 1000;
    backdrop-filter: blur(4px);
}

.exif-modal.active {
    display: flex;
    align-items: center;
    justify-content: center;
}

.exif-content {
    background: #1a1a1a;
    border-radius: 12px;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
}

.exif-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    border-bottom: 1px solid #333;
}

.exif-header h3 {
    margin: 0;
    color: #fff;
}

.exif-body {
    padding: 20px;
}

.exif-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid #333;
}

.exif-label {
    font-weight: 600;
    color: #ccc;
}

.exif-value {
    color: #fff;
    text-align: right;
}

/* Context Menu */
.context-menu {
    position: fixed;
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 4px 0;
    min-width: 160px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    z-index: 1000;
    display: none;
}

.context-menu.active {
    display: block;
}

.context-item {
    padding: 8px 16px;
    color: #fff;
    cursor: pointer;
    font-size: 14px;
    transition: background 0.2s ease;
}

.context-item:hover {
    background: #3a3a3a;
}

/* Image-specific grid items */
.image-item {
    position: relative;
    background: #1a1a1a;
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.2s ease;
    aspect-ratio: 1;
}

.image-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.2s ease;
}

.image-item:hover img {
    transform: scale(1.05);
}

.image-dimensions {
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
}

.duplicate-indicator {
    position: absolute;
    top: 8px;
    left: 8px;
    background: #ff6b6b;
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: bold;
}
```

### Step 3.3: Update Renderer Logic (`app/renderer.js`)
**Refactor existing renderer for photo management**

Key changes needed:
- Replace video-specific logic with image handling
- Add context menu functionality
- Add EXIF data modal
- Add duplicate detection UI
- Update grid rendering for images

```javascript
class PhotoSorterApp {
    constructor() {
        // Update constants for images
        this.SUPPORTED_FORMATS = [
            'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif',
            'webp', 'svg', 'ico', 'heic', 'heif', 'raw', 'cr2',
            'nef', 'arw', 'dng'
        ];
        
        this.allImages = [];
        this.displayedImages = [];
        this.duplicates = [];
        this.contextMenuTarget = null;
        
        // ... rest of initialization
    }

    /**
     * Create image item HTML (replaces createVideoItemHTML)
     */
    createImageItemHTML(image, index) {
        const isFavorited = image.isFavorite === true;
        const dimensions = image.width && image.height ? `${image.width}×${image.height}` : '';
        const isDuplicate = this.duplicates.some(d => 
            d.duplicate.id === image.id || d.original.id === image.id
        );
        
        return `
            <div class="image-item" data-index="${index}" data-image-id="${image.id}">
                <img 
                    src="${image.path}"
                    alt="${image.name}"
                    loading="lazy"
                />
                ${dimensions ? `<div class="image-dimensions">${dimensions}</div>` : ''}
                ${isDuplicate ? '<div class="duplicate-indicator">DUP</div>' : ''}
                <button class="image-favorite ${isFavorited ? 'favorited' : ''}" data-image-id="${image.id}">
                    <svg viewBox="0 0 24 24" class="heart-icon">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                </button>
                <div class="image-overlay">
                    <div class="image-name" title="${image.name}">
                        ${image.name}
                    </div>
                    <div class="image-info">
                        <span>${this.formatFileSize(image.size)}</span>
                        ${dimensions ? `<span>${dimensions}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Setup context menu functionality
     */
    setupContextMenu() {
        document.addEventListener('contextmenu', (e) => {
            const imageItem = e.target.closest('.image-item');
            if (imageItem) {
                e.preventDefault();
                this.showContextMenu(e.clientX, e.clientY, imageItem);
            }
        });

        document.addEventListener('click', () => {
            this.hideContextMenu();
        });

        // Context menu actions
        document.getElementById('contextDelete').addEventListener('click', () => {
            this.deleteImage();
        });

        document.getElementById('contextCopy').addEventListener('click', () => {
            this.copyImage();
        });

        document.getElementById('contextLocation').addEventListener('click', () => {
            this.showInFolder();
        });

        document.getElementById('contextExif').addEventListener('click', () => {
            this.showExifData();
        });
    }

    /**
     * Show context menu
     */
    showContextMenu(x, y, target) {
        this.contextMenuTarget = target;
        const menu = document.getElementById('contextMenu');
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.add('active');
    }

    /**
     * Show EXIF data modal
     */
    async showExifData() {
        if (!this.contextMenuTarget) return;

        const imageId = this.contextMenuTarget.dataset.imageId;
        const image = this.allImages.find(img => img.id === imageId);
        
        if (!image) return;

        try {
            const exifData = await window.electronAPI.getExifData(image.path);
            this.displayExifModal(exifData, image);
        } catch (error) {
            console.error('Error loading EXIF data:', error);
        }
    }

    /**
     * Display EXIF data in modal
     */
    displayExifModal(exifData, image) {
        const modal = document.getElementById('exifModal');
        const body = document.getElementById('exifBody');
        
        let html = `
            <div class="exif-row">
                <span class="exif-label">Filename:</span>
                <span class="exif-value">${image.name}</span>
            </div>
            <div class="exif-row">
                <span class="exif-label">File Size:</span>
                <span class="exif-value">${this.formatFileSize(image.size)}</span>
            </div>
            <div class="exif-row">
                <span class="exif-label">Dimensions:</span>
                <span class="exif-value">${image.width} × ${image.height}</span>
            </div>
        `;

        if (exifData) {
            if (exifData.cameraMake) {
                html += `
                    <div class="exif-row">
                        <span class="exif-label">Camera:</span>
                        <span class="exif-value">${exifData.cameraMake} ${exifData.cameraModel || ''}</span>
                    </div>
                `;
            }
            
            if (exifData.focalLength) {
                html += `
                    <div class="exif-row">
                        <span class="exif-label">Focal Length:</span>
                        <span class="exif-value">${exifData.focalLength}mm</span>
                    </div>
                `;
            }
            
            if (exifData.aperture) {
                html += `
                    <div class="exif-row">
                        <span class="exif-label">Aperture:</span>
                        <span class="exif-value">f/${exifData.aperture}</span>
                    </div>
                `;
            }
            
            if (exifData.shutterSpeed) {
                html += `
                    <div class="exif-row">
                        <span class="exif-label">Shutter Speed:</span>
                        <span class="exif-value">${exifData.shutterSpeed}</span>
                    </div>
                `;
            }
            
            if (exifData.iso) {
                html += `
                    <div class="exif-row">
                        <span class="exif-label">ISO:</span>
                        <span class="exif-value">${exifData.iso}</span>
                    </div>
                `;
            }
            
            if (exifData.dateTaken) {
                html += `
                    <div class="exif-row">
                        <span class="exif-label">Date Taken:</span>
                        <span class="exif-value">${new Date(exifData.dateTaken).toLocaleString()}</span>
                    </div>
                `;
            }
            
            if (exifData.gpsLatitude && exifData.gpsLongitude) {
                html += `
                    <div class="exif-row">
                        <span class="exif-label">GPS:</span>
                        <span class="exif-value">${exifData.gpsLatitude.toFixed(6)}, ${exifData.gpsLongitude.toFixed(6)}</span>
                    </div>
                `;
            }
        }

        body.innerHTML = html;
        modal.classList.add('active');
    }

    // ... rest of the methods adapted for images
}

// Initialize the app
const app = new PhotoSorterApp();
```

## Phase 4: IPC Handler Updates

### Step 4.1: Update IPC Handlers (`src/ipc-handlers.js`)
**Modify existing handlers for image operations**

Key changes:
- Replace video scanner with image scanner
- Add EXIF data handlers
- Add duplicate detection handlers
- Add file operation handlers (delete, copy, show in folder)

```javascript
// Add new handlers to registerHandlers() method
ipcMain.handle('get-exif-data', this.handleGetExifData.bind(this));
ipcMain.handle('find-duplicates', this.handleFindDuplicates.bind(this));
ipcMain.handle('delete-image', this.handleDeleteImage.bind(this));
ipcMain.handle('copy-image', this.handleCopyImage.bind(this));
ipcMain.handle('show-in-folder', this.handleShowInFolder.bind(this));

/**
 * Handle EXIF data extraction
 */
async handleGetExifData(event, imagePath) {
  try {
    if (!this.exifHandler) {
      const ExifHandler = require('./exif-handler');
      this.exifHandler = new ExifHandler();
    }
    
    return await this.exifHandler.extractExifData(imagePath);
  } catch (error) {
    console.error('Error getting EXIF data:', error);
    return null;
  }
}

/**
 * Handle duplicate detection
 */
async handleFindDuplicates(event, images) {
  try {
    if (!this.duplicateFinder) {
      const DuplicateFinder = require('./duplicate-finder');
      this.duplicateFinder = new DuplicateFinder();
    }
    
    return await this.duplicateFinder.findDuplicates(images);
  } catch (error) {
    console.error('Error finding duplicates:', error);
    return [];
  }
}
```

## Phase 5: Testing and Validation

### Step 5.1: Unit Testing
Create test files for each module:
- `tests/image-scanner.test.js`
- `tests/exif-handler.test.js`
- `tests/duplicate-finder.test.js`
- `tests/database.test.js`

### Step 5.2: Integration Testing
Test the complete workflow:
1. Folder selection and scanning
2. Image display and sorting
3. Duplicate detection
4. EXIF data viewing
5. Context menu operations
6. Favorites management

### Step 5.3: Performance Testing
Test with large image collections:
- 1,000+ images
- Various image formats and sizes
- Memory usage monitoring
- Scan time optimization

## Phase 6: Build and Distribution

### Step 6.1: Update Build Configuration
Ensure all new dependencies are included in the build and test on target platforms.

### Step 6.2: Create Installation Packages
Build and test installers for:
- macOS (.dmg)
- Windows (.exe and installer)
- Linux (AppImage)

## Implementation Timeline

### Week 1: Backend Foundation
- Set up image scanner
- Update database schema
- Create EXIF handler
- Basic duplicate detection

### Week 2: Frontend Updates
- Update HTML/CSS for photo UI
- Implement context menu
- Add EXIF modal
- Update renderer logic

### Week 3: Advanced Features
- Complete duplicate finder
- File operations (delete, copy)
- Advanced sorting options
- Performance optimizations

### Week 4: Testing and Polish
- Unit and integration testing
- UI/UX refinements
- Performance optimization
- Bug fixes

### Week 5: Build and Deploy
- Build configuration
- Cross-platform testing
- Documentation updates
- Release preparation

## Success Criteria

1. **Functionality**: All specified features working correctly
2. **Performance**: Smooth operation with 5,000+ images
3. **Usability**: Intuitive interface matching original app quality
4. **Reliability**: Stable operation across platforms
5. **Code Quality**: Clean, modular, well-documented code following SOLID principles

## Notes for Junior Developers

1. **Start Small**: Implement one feature at a time and test thoroughly
2. **Follow Patterns**: Use the existing codebase as a template for new features
3. **Keep Modules Small**: Aim for <200 lines per module for AI-friendly code
4. **Test Early**: Test each component as you build it
5. **Document Changes**: Update comments and documentation as you go
6. **Ask Questions**: Don't hesitate to seek clarification on requirements

This refactor maintains the high-quality architecture of the original video app while adapting it for comprehensive photo management. The modular approach ensures maintainability and makes it easy for AI tools to understand and modify the code in the future.