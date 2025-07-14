const fs = require('fs').promises;
const path = require('path');
const { createReadStream } = require('fs');

class VideoScanner {
  constructor() {
    this.VIDEO_EXTENSIONS = new Set([
      '.mp4', '.webm', '.ogg', '.mov', '.avi', '.wmv', '.flv', '.mkv', '.m4v'
    ]);
    
    this.isScanning = false;
    this.scanProgress = 0;
    this.totalFiles = 0;
    this.processedFiles = 0;
    this.videos = [];
  }

  /**
   * Check if a file is a valid video file
   */
  isValidVideoFile(filename) {
    if (filename.startsWith('._')) return false;
    const ext = path.extname(filename).toLowerCase();
    return this.VIDEO_EXTENSIONS.has(ext);
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        lastModified: stats.mtime.getTime(),
        created: stats.birthtime.getTime()
      };
    } catch (error) {
      console.error('Error getting file metadata:', error);
      return null;
    }
  }

  /**
   * Extract video metadata using ffprobe or similar
   */
  async getVideoMetadata(filePath) {
    try {
      // For now, return basic metadata
      // In a full implementation, you'd use ffprobe or similar
      const stats = await fs.stat(filePath);
      return {
        duration: null, // Would be extracted with ffprobe
        width: null,    // Would be extracted with ffprobe
        height: null,   // Would be extracted with ffprobe
        codec: null,    // Would be extracted with ffprobe
        bitrate: null,  // Would be extracted with ffprobe
        size: stats.size,
        lastModified: stats.mtime.getTime()
      };
    } catch (error) {
      console.error('Error getting video metadata:', error);
      return null;
    }
  }

  /**
   * Recursively scan directory for video files
   */
  async scanDirectory(dirPath, relativePath = '') {
    const videos = [];
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const currentRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
        
        if (entry.isDirectory()) {
          // Skip hidden directories and system directories
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            const subVideos = await this.scanDirectory(fullPath, currentRelativePath);
            videos.push(...subVideos);
          }
        } else if (entry.isFile() && this.isValidVideoFile(entry.name)) {
          const metadata = await this.getFileMetadata(fullPath);
          if (metadata) {
            const videoInfo = {
              id: this.generateVideoId(fullPath, metadata),
              name: entry.name,
              path: fullPath,
              relativePath: currentRelativePath,
              folder: this.getVideoFolder(currentRelativePath),
              size: metadata.size,
              lastModified: metadata.lastModified,
              created: metadata.created
            };
            
            videos.push(videoInfo);
          }
        }
        
        this.processedFiles++;
        this.updateProgress();
      }
    } catch (error) {
      console.error('Error scanning directory:', dirPath, error);
    }
    
    return videos;
  }

  /**
   * Generate a consistent video ID based on file content, not path
   */
  generateVideoId(filePath, metadata) {
    // Use filename, size, and last modified time for a stable ID
    // This ensures the same video file gets the same ID regardless of folder location
    const filename = path.basename(filePath);
    const str = `${filename}_${metadata.size}_${metadata.lastModified}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Extract folder name from relative path
   */
  getVideoFolder(relativePath) {
    if (!relativePath || !relativePath.includes(path.sep)) return null;
    
    const parts = relativePath.split(path.sep).filter(part => 
      part && part !== '.' && !part.startsWith('._')
    );
    
    // Remove the filename (last part) to get folder parts
    const folderParts = parts.slice(0, -1);
    
    if (folderParts.length === 0) return null;
    
    // Return the most specific folder (deepest level)
    return folderParts[folderParts.length - 1];
  }

  /**
   * Update scan progress
   */
  updateProgress() {
    if (this.totalFiles > 0) {
      this.scanProgress = (this.processedFiles / this.totalFiles) * 100;
    }
  }

  /**
   * Count total files in directory (for progress calculation)
   */
  async countFiles(dirPath) {
    let count = 0;
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            count += await this.countFiles(fullPath);
          }
        } else if (entry.isFile()) {
          count++;
        }
      }
    } catch (error) {
      console.error('Error counting files:', error);
    }
    
    return count;
  }

  /**
   * Main scan method
   */
  async scanVideos(folderPath) {
    if (this.isScanning) {
      throw new Error('Scan already in progress');
    }

    this.isScanning = true;
    this.scanProgress = 0;
    this.processedFiles = 0;
    this.videos = [];

    try {
      // Count total files for progress calculation
      this.totalFiles = await this.countFiles(folderPath);
      
      // Scan for videos
      this.videos = await this.scanDirectory(folderPath);
      
      // Sort videos by folder, then by name
      this.videos.sort((a, b) => {
        const folderA = a.folder || '';
        const folderB = b.folder || '';
        const folderCompare = folderA.localeCompare(folderB);
        
        if (folderCompare !== 0) return folderCompare;
        return a.name.localeCompare(b.name);
      });

      return {
        success: true,
        videos: this.videos,
        totalVideos: this.videos.length,
        folders: this.extractFolders()
      };
    } catch (error) {
      console.error('Error scanning videos:', error);
      return {
        success: false,
        error: error.message,
        videos: [],
        totalVideos: 0,
        folders: []
      };
    } finally {
      this.isScanning = false;
      this.scanProgress = 100;
    }
  }

  /**
   * Extract unique folders from videos
   */
  extractFolders() {
    const folderSet = new Set();
    
    this.videos.forEach(video => {
      if (video.folder) {
        folderSet.add(video.folder);
      }
    });
    
    return Array.from(folderSet).sort();
  }

  /**
   * Get current scan progress
   */
  getProgress() {
    return {
      isScanning: this.isScanning,
      progress: this.scanProgress,
      processedFiles: this.processedFiles,
      totalFiles: this.totalFiles,
      totalVideos: this.videos.length
    };
  }

  /**
   * Get scanned videos
   */
  getVideos() {
    return this.videos;
  }

  /**
   * Reset scanner state
   */
  reset() {
    this.isScanning = false;
    this.scanProgress = 0;
    this.processedFiles = 0;
    this.totalFiles = 0;
    this.videos = [];
  }
}

module.exports = VideoScanner;
