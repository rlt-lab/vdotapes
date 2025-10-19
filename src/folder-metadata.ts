/**
 * Folder Metadata Manager
 * Stores favorites, hidden files, ratings per video folder
 * Creates a .vdotapes/metadata.json file in each video folder
 */

import * as fs from 'fs';
import * as path from 'path';
import type { VideoId } from '../types/core';

// v1.0.0 format (legacy)
interface FolderMetadataV1 {
  version: '1.0.0';
  folderPath: string;
  lastUpdated: string;
  favorites: VideoId[];
  hidden: VideoId[];
  ratings: Record<VideoId, number>;
  tags: Record<VideoId, string[]>;
}

// v2.0.0 format (current) - per-video objects
interface VideoMetadata {
  favorite: boolean;
  hidden: boolean;
  rating: number | null;
  tags: string[];
  notes: string;
  lastViewed: string | null;
  viewCount: number;
}

interface FolderMetadataV2 {
  version: '2.0.0';
  folderPath: string;
  lastUpdated: string;
  videos: Record<VideoId, VideoMetadata>;
}

type FolderMetadata = FolderMetadataV2;

export type { VideoMetadata, FolderMetadataV2 };

export class FolderMetadataManager {
  private readonly METADATA_DIR = '.vdotapes';
  private readonly METADATA_FILE = 'metadata.json';
  private readonly VERSION = '2.0.0';

  private currentFolderPath: string | null = null;
  private metadata: FolderMetadata | null = null;

  /**
   * Get the full path to the metadata file for a folder
   */
  private getMetadataPath(folderPath: string): string {
    return path.join(folderPath, this.METADATA_DIR, this.METADATA_FILE);
  }

  /**
   * Get the metadata directory path
   */
  private getMetadataDir(folderPath: string): string {
    return path.join(folderPath, this.METADATA_DIR);
  }

  /**
   * Initialize metadata for a folder (load if exists, create if not)
   */
  async initializeFolder(folderPath: string): Promise<void> {
    this.currentFolderPath = folderPath;
    const metadataPath = this.getMetadataPath(folderPath);

    try {
      // Check if metadata file exists
      if (fs.existsSync(metadataPath)) {
        // Load existing metadata
        const data = fs.readFileSync(metadataPath, 'utf-8');
        const rawMetadata = JSON.parse(data);
        
        // Migrate from v1 to v2 if needed
        if (rawMetadata.version === '1.0.0') {
          console.log(`[FolderMetadata] Migrating from v1.0.0 to v2.0.0`);
          this.metadata = this.migrateV1ToV2(rawMetadata as FolderMetadataV1);
          await this.save(); // Save migrated format
        } else {
          this.metadata = rawMetadata as FolderMetadataV2;
        }
        
        console.log(`[FolderMetadata] Loaded metadata v${this.metadata.version} from ${folderPath}`);
        const videoCount = Object.keys(this.metadata.videos).length;
        const favoriteCount = Object.values(this.metadata.videos).filter(v => v.favorite).length;
        const hiddenCount = Object.values(this.metadata.videos).filter(v => v.hidden).length;
        console.log(`[FolderMetadata] ${videoCount} videos tracked, ${favoriteCount} favorites, ${hiddenCount} hidden`);
      } else {
        // Create new metadata
        this.metadata = {
          version: this.VERSION,
          folderPath,
          lastUpdated: new Date().toISOString(),
          videos: {}
        };

        // Create .vdotapes directory if it doesn't exist
        const metadataDir = this.getMetadataDir(folderPath);
        if (!fs.existsSync(metadataDir)) {
          fs.mkdirSync(metadataDir, { recursive: true });
          console.log(`[FolderMetadata] Created metadata directory: ${metadataDir}`);
        }

        // Save initial metadata
        await this.save();
        console.log(`[FolderMetadata] Created new metadata for ${folderPath}`);
      }
    } catch (error) {
      console.error('[FolderMetadata] Error initializing folder metadata:', error);
      // Create empty metadata on error
      this.metadata = {
        version: this.VERSION,
        folderPath,
        lastUpdated: new Date().toISOString(),
        videos: {}
      };
    }
  }

  /**
   * Migrate v1 metadata to v2 format
   */
  private migrateV1ToV2(v1: FolderMetadataV1): FolderMetadataV2 {
    const videos: Record<VideoId, VideoMetadata> = {};
    
    // Convert favorites array to per-video objects
    for (const videoId of v1.favorites) {
      if (!videos[videoId]) {
        videos[videoId] = this.createDefaultVideoMetadata();
      }
      videos[videoId].favorite = true;
    }
    
    // Convert hidden array
    for (const videoId of v1.hidden) {
      if (!videos[videoId]) {
        videos[videoId] = this.createDefaultVideoMetadata();
      }
      videos[videoId].hidden = true;
    }
    
    // Convert ratings object
    for (const [videoId, rating] of Object.entries(v1.ratings)) {
      const id = videoId as VideoId;
      if (!videos[id]) {
        videos[id] = this.createDefaultVideoMetadata();
      }
      videos[id].rating = rating;
    }
    
    // Convert tags object
    for (const [videoId, tags] of Object.entries(v1.tags)) {
      const id = videoId as VideoId;
      if (!videos[id]) {
        videos[id] = this.createDefaultVideoMetadata();
      }
      videos[id].tags = [...tags];
    }
    
    return {
      version: '2.0.0',
      folderPath: v1.folderPath,
      lastUpdated: new Date().toISOString(),
      videos
    };
  }

  /**
   * Create default video metadata
   */
  private createDefaultVideoMetadata(): VideoMetadata {
    return {
      favorite: false,
      hidden: false,
      rating: null,
      tags: [],
      notes: '',
      lastViewed: null,
      viewCount: 0
    };
  }

  /**
   * Get or create video metadata
   */
  private getOrCreateVideo(videoId: VideoId): VideoMetadata {
    if (!this.metadata) {
      throw new Error('Metadata not initialized');
    }
    
    if (!this.metadata.videos[videoId]) {
      this.metadata.videos[videoId] = this.createDefaultVideoMetadata();
    }
    
    return this.metadata.videos[videoId];
  }

  /**
   * Save metadata to disk
   */
  private async save(): Promise<void> {
    if (!this.currentFolderPath || !this.metadata) {
      console.warn('[FolderMetadata] Cannot save: no folder initialized');
      return;
    }

    try {
      const metadataPath = this.getMetadataPath(this.currentFolderPath);
      const metadataDir = this.getMetadataDir(this.currentFolderPath);

      // Ensure directory exists
      if (!fs.existsSync(metadataDir)) {
        fs.mkdirSync(metadataDir, { recursive: true });
      }

      // Update timestamp
      this.metadata.lastUpdated = new Date().toISOString();

      // Write to file
      fs.writeFileSync(metadataPath, JSON.stringify(this.metadata, null, 2), 'utf-8');
      console.log(`[FolderMetadata] Saved metadata to ${metadataPath}`);
    } catch (error) {
      console.error('[FolderMetadata] Error saving metadata:', error);
      throw error;
    }
  }

  /**
   * Get all favorites for the current folder
   */
  getFavorites(): VideoId[] {
    if (!this.metadata) return [];
    return Object.entries(this.metadata.videos)
      .filter(([_, video]) => video.favorite)
      .map(([videoId, _]) => videoId as VideoId);
  }

  /**
   * Add a video to favorites
   */
  async addFavorite(videoId: VideoId): Promise<boolean> {
    if (!this.metadata) {
      console.warn('[FolderMetadata] Cannot add favorite: no folder initialized');
      return false;
    }

    try {
      const video = this.getOrCreateVideo(videoId);
      if (!video.favorite) {
        video.favorite = true;
        await this.save();
        console.log(`[FolderMetadata] Added favorite: ${videoId}`);
      }
      return true;
    } catch (error) {
      console.error('[FolderMetadata] Error adding favorite:', error);
      return false;
    }
  }

  /**
   * Remove a video from favorites
   */
  async removeFavorite(videoId: VideoId): Promise<boolean> {
    if (!this.metadata) {
      console.warn('[FolderMetadata] Cannot remove favorite: no folder initialized');
      return false;
    }

    try {
      if (this.metadata.videos[videoId]) {
        this.metadata.videos[videoId].favorite = false;
        await this.save();
        console.log(`[FolderMetadata] Removed favorite: ${videoId}`);
      }
      return true;
    } catch (error) {
      console.error('[FolderMetadata] Error removing favorite:', error);
      return false;
    }
  }

  /**
   * Get all hidden videos for the current folder
   */
  getHidden(): VideoId[] {
    if (!this.metadata) return [];
    return Object.entries(this.metadata.videos)
      .filter(([_, video]) => video.hidden)
      .map(([videoId, _]) => videoId as VideoId);
  }

  /**
   * Add a video to hidden list
   */
  async addHidden(videoId: VideoId): Promise<boolean> {
    if (!this.metadata) {
      console.warn('[FolderMetadata] Cannot add hidden: no folder initialized');
      return false;
    }

    try {
      const video = this.getOrCreateVideo(videoId);
      if (!video.hidden) {
        video.hidden = true;
        await this.save();
        console.log(`[FolderMetadata] Added hidden: ${videoId}`);
      }
      return true;
    } catch (error) {
      console.error('[FolderMetadata] Error adding hidden:', error);
      return false;
    }
  }

  /**
   * Remove a video from hidden list
   */
  async removeHidden(videoId: VideoId): Promise<boolean> {
    if (!this.metadata) {
      console.warn('[FolderMetadata] Cannot remove hidden: no folder initialized');
      return false;
    }

    try {
      if (this.metadata.videos[videoId]) {
        this.metadata.videos[videoId].hidden = false;
        await this.save();
        console.log(`[FolderMetadata] Removed hidden: ${videoId}`);
      }
      return true;
    } catch (error) {
      console.error('[FolderMetadata] Error removing hidden:', error);
      return false;
    }
  }

  /**
   * Get rating for a video
   */
  getRating(videoId: VideoId): number | null {
    return this.metadata?.videos[videoId]?.rating ?? null;
  }

  /**
   * Set rating for a video
   */
  async setRating(videoId: VideoId, rating: number): Promise<boolean> {
    if (!this.metadata) {
      console.warn('[FolderMetadata] Cannot set rating: no folder initialized');
      return false;
    }

    try {
      const video = this.getOrCreateVideo(videoId);
      video.rating = rating;
      await this.save();
      console.log(`[FolderMetadata] Set rating for ${videoId}: ${rating}`);
      return true;
    } catch (error) {
      console.error('[FolderMetadata] Error setting rating:', error);
      return false;
    }
  }

  /**
   * Remove rating for a video
   */
  async removeRating(videoId: VideoId): Promise<boolean> {
    if (!this.metadata) {
      console.warn('[FolderMetadata] Cannot remove rating: no folder initialized');
      return false;
    }

    try {
      if (this.metadata.videos[videoId]) {
        this.metadata.videos[videoId].rating = null;
        await this.save();
        console.log(`[FolderMetadata] Removed rating for ${videoId}`);
      }
      return true;
    } catch (error) {
      console.error('[FolderMetadata] Error removing rating:', error);
      return false;
    }
  }

  /**
   * Get tags for a video
   */
  getTags(videoId: VideoId): string[] {
    return this.metadata?.videos[videoId]?.tags || [];
  }

  /**
   * Add a tag to a video
   */
  async addTag(videoId: VideoId, tag: string): Promise<boolean> {
    if (!this.metadata) {
      console.warn('[FolderMetadata] Cannot add tag: no folder initialized');
      return false;
    }

    try {
      const video = this.getOrCreateVideo(videoId);
      if (!video.tags.includes(tag)) {
        video.tags.push(tag);
        await this.save();
        console.log(`[FolderMetadata] Added tag "${tag}" to ${videoId}`);
      }
      return true;
    } catch (error) {
      console.error('[FolderMetadata] Error adding tag:', error);
      return false;
    }
  }

  /**
   * Remove a tag from a video
   */
  async removeTag(videoId: VideoId, tag: string): Promise<boolean> {
    if (!this.metadata) {
      console.warn('[FolderMetadata] Cannot remove tag: no folder initialized');
      return false;
    }

    try {
      const video = this.metadata.videos[videoId];
      if (video && video.tags) {
        const index = video.tags.indexOf(tag);
        if (index > -1) {
          video.tags.splice(index, 1);
          await this.save();
          console.log(`[FolderMetadata] Removed tag "${tag}" from ${videoId}`);
        }
      }
      return true;
    } catch (error) {
      console.error('[FolderMetadata] Error removing tag:', error);
      return false;
    }
  }

  /**
   * Get all unique tags in the current folder with usage counts
   */
  getAllTags(): Array<{ name: string; usage: number }> {
    if (!this.metadata) {
      console.warn('[FolderMetadata] Cannot get all tags: no folder initialized');
      return [];
    }

    const tagCounts: Record<string, number> = {};

    // Count occurrences of each tag across all videos
    Object.values(this.metadata.videos).forEach((video) => {
      for (const tag of video.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    });

    // Convert to array and sort by usage (descending)
    return Object.entries(tagCounts)
      .map(([name, usage]) => ({ name, usage }))
      .sort((a, b) => b.usage - a.usage);
  }

  /**
   * Get current folder path
   */
  getCurrentFolder(): string | null {
    return this.currentFolderPath;
  }

  /**
   * Check if a folder has metadata
   */
  static hasMetadata(folderPath: string): boolean {
    const metadataPath = path.join(folderPath, '.vdotapes', 'metadata.json');
    return fs.existsSync(metadataPath);
  }

  /**
   * Get all video metadata for syncing to database
   */
  getAllVideoMetadata(): Record<VideoId, VideoMetadata> {
    return this.metadata?.videos || {};
  }

  /**
   * Get statistics about the metadata
   */
  getStats() {
    if (!this.metadata) {
      return null;
    }

    const videos = Object.values(this.metadata.videos);
    return {
      videosCount: videos.length,
      favoritesCount: videos.filter(v => v.favorite).length,
      hiddenCount: videos.filter(v => v.hidden).length,
      ratingsCount: videos.filter(v => v.rating !== null).length,
      tagsCount: videos.reduce((sum, v) => sum + v.tags.length, 0),
      lastUpdated: this.metadata.lastUpdated
    };
  }
}

export default FolderMetadataManager;
