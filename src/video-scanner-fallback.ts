import { promises as fs } from 'fs';
import * as path from 'path';

import type { VideoId, FilePath, Timestamp, VideoRecord, ScanResult } from '../types/core';
import { VDOTapesError, ScanError, ValidationError } from '../types/errors';
import { createVideoId, createFilePath, createTimestamp } from '../types/guards';

interface FileMetadata {
  readonly size: number;
  readonly lastModified: Timestamp;
  readonly created: Timestamp;
}

interface VideoMetadata {
  readonly duration: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly codec: string | null;
  readonly bitrate: number | null;
  readonly size: number;
  readonly lastModified: Timestamp;
}

interface ScanProgress {
  readonly isScanning: boolean;
  readonly progress: number;
  readonly processedFiles: number;
  readonly totalFiles: number;
  readonly totalVideos: number;
}

class VideoScanner {
  private readonly VIDEO_EXTENSIONS = new Set([
    '.mp4',
    '.webm',
    '.ogg',
    '.mov',
    '.avi',
    '.wmv',
    '.flv',
    '.mkv',
    '.m4v',
  ]);

  private readonly EXCLUDED_DIRECTORIES = new Set(['.', 'node_modules']);
  private readonly SYSTEM_FILE_PREFIX = '._';

  private isScanning = false;
  private scanProgress = 0;
  private totalFiles = 0;
  private processedFiles = 0;
  private videos: VideoRecord[] = [];

  isValidVideoFile(filename: string): boolean {
    if (filename.startsWith(this.SYSTEM_FILE_PREFIX)) return false;
    const ext = path.extname(filename).toLowerCase();
    return this.VIDEO_EXTENSIONS.has(ext);
  }

  async getFileMetadata(filePath: string): Promise<FileMetadata | null> {
    try {
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        lastModified: createTimestamp(stats.mtime.getTime()),
        created: createTimestamp(stats.birthtime.getTime()),
      };
    } catch (error) {
      console.error('Error getting file metadata:', error);
      return null;
    }
  }

  async getVideoMetadata(filePath: string): Promise<VideoMetadata | null> {
    try {
      const stats = await fs.stat(filePath);
      return {
        duration: null,
        width: null,
        height: null,
        codec: null,
        bitrate: null,
        size: stats.size,
        lastModified: createTimestamp(stats.mtime.getTime()),
      };
    } catch (error) {
      console.error('Error getting video metadata:', error);
      return null;
    }
  }

  async scanDirectory(dirPath: string, relativePath = ''): Promise<VideoRecord[]> {
    const videos: VideoRecord[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const currentRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && !this.EXCLUDED_DIRECTORIES.has(entry.name)) {
            const subVideos = await this.scanDirectory(fullPath, currentRelativePath);
            videos.push(...subVideos);
          }
        } else if (entry.isFile() && this.isValidVideoFile(entry.name)) {
          const metadata = await this.getFileMetadata(fullPath);
          if (metadata) {
            const videoInfo: VideoRecord = {
              id: this.generateVideoId(fullPath, metadata),
              name: entry.name,
              path: createFilePath(fullPath),
              folder: this.getVideoFolder(currentRelativePath) || '',
              size: metadata.size,
              lastModified: metadata.lastModified,
              created: metadata.created,
              addedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              duration: undefined,
            };

            videos.push(videoInfo);
          }
        }

        this.processedFiles++;
        this.updateProgress();
      }
    } catch (error) {
      console.error('Error scanning directory:', dirPath, error);
      throw new ScanError(
        `Failed to scan directory: ${dirPath}`,
        createFilePath(dirPath),
        'scanning'
      );
    }

    return videos;
  }

  generateVideoId(filePath: string, metadata: FileMetadata): VideoId {
    const filename = path.basename(filePath);
    const str = `${filename}_${metadata.size}_${metadata.lastModified}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return createVideoId(Math.abs(hash).toString(36));
  }

  getVideoFolder(relativePath: string): string | null {
    if (!relativePath || !relativePath.includes(path.sep)) return null;

    const parts = relativePath
      .split(path.sep)
      .filter((part) => part && part !== '.' && !part.startsWith(this.SYSTEM_FILE_PREFIX));

    const folderParts = parts.slice(0, -1);

    if (folderParts.length === 0) return null;

    return folderParts[folderParts.length - 1];
  }

  private updateProgress(): void {
    if (this.totalFiles > 0) {
      this.scanProgress = (this.processedFiles / this.totalFiles) * 100;
    }
  }

  async countFiles(dirPath: string): Promise<number> {
    let count = 0;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && !this.EXCLUDED_DIRECTORIES.has(entry.name)) {
            count += await this.countFiles(fullPath);
          }
        } else if (entry.isFile()) {
          count++;
        }
      }
    } catch (error) {
      console.error('Error counting files:', error);
      throw new ScanError(
        `Failed to count files in directory: ${dirPath}`,
        createFilePath(dirPath),
        'scanning'
      );
    }

    return count;
  }

  async scanVideos(folderPath: string): Promise<ScanResult> {
    if (this.isScanning) {
      throw new ValidationError(
        'Scan already in progress',
        'isScanning',
        this.isScanning,
        'must_be_false'
      );
    }

    if (!folderPath || typeof folderPath !== 'string') {
      throw new ValidationError(
        'Invalid folder path provided',
        'folderPath',
        folderPath,
        'must_be_non_empty_string'
      );
    }

    this.isScanning = true;
    this.scanProgress = 0;
    this.processedFiles = 0;
    this.videos = [];

    try {
      this.totalFiles = await this.countFiles(folderPath);
      this.videos = await this.scanDirectory(folderPath);

      return {
        success: true,
        videos: this.videos,
        folders: this.extractFolders(),
        stats: {
          totalFiles: this.totalFiles,
          validVideos: this.videos.length,
          duplicates: 0,
          errors: 0,
        },
      };
    } catch (error) {
      console.error('Error scanning videos:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        videos: [],
        folders: [],
      };
    } finally {
      this.isScanning = false;
      this.scanProgress = 100;
    }
  }

  extractFolders(): readonly string[] {
    const folderSet = new Set<string>();

    this.videos.forEach((video) => {
      if (video.folder) {
        folderSet.add(video.folder);
      }
    });

    return Array.from(folderSet).sort();
  }

  getProgress(): ScanProgress {
    return {
      isScanning: this.isScanning,
      progress: this.scanProgress,
      processedFiles: this.processedFiles,
      totalFiles: this.totalFiles,
      totalVideos: this.videos.length,
    };
  }

  getVideos(): readonly VideoRecord[] {
    return this.videos;
  }

  reset(): void {
    this.isScanning = false;
    this.scanProgress = 0;
    this.processedFiles = 0;
    this.totalFiles = 0;
    this.videos = [];
  }
}

export = VideoScanner;
