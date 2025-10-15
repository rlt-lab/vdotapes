/**
 * Folder Metadata Manager
 * Stores favorites, hidden files, ratings per video folder
 * Creates a .vdotapes/metadata.json file in each video folder
 */

import * as fs from 'fs';
import * as path from 'path';
import type { VideoId } from '../types/core';

interface FolderMetadata {
  version: string;
  folderPath: string;
  lastUpdated: string;
  favorites: VideoId[];
  hidden: VideoId[];
  ratings: Record<VideoId, number>;
  tags: Record<VideoId, string[]>;
}

export class FolderMetadataManager {
  private readonly METADATA_DIR = '.vdotapes';
  private readonly METADATA_FILE = 'metadata.json';
  private readonly VERSION = '1.0.0';

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
        this.metadata = JSON.parse(data);
        console.log(`[FolderMetadata] Loaded metadata from ${folderPath}`);
        if (this.metadata) {
          console.log(`[FolderMetadata] ${this.metadata.favorites.length} favorites, ${this.metadata.hidden.length} hidden`);
        }
      } else {
        // Create new metadata
        this.metadata = {
          version: this.VERSION,
          folderPath,
          lastUpdated: new Date().toISOString(),
          favorites: [],
          hidden: [],
          ratings: {},
          tags: {}
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
        favorites: [],
        hidden: [],
        ratings: {},
        tags: {}
      };
    }
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
    return this.metadata?.favorites || [];
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
      if (!this.metadata.favorites.includes(videoId)) {
        this.metadata.favorites.push(videoId);
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
      const index = this.metadata.favorites.indexOf(videoId);
      if (index > -1) {
        this.metadata.favorites.splice(index, 1);
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
    return this.metadata?.hidden || [];
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
      if (!this.metadata.hidden.includes(videoId)) {
        this.metadata.hidden.push(videoId);
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
      const index = this.metadata.hidden.indexOf(videoId);
      if (index > -1) {
        this.metadata.hidden.splice(index, 1);
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
    return this.metadata?.ratings[videoId] ?? null;
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
      this.metadata.ratings[videoId] = rating;
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
      delete this.metadata.ratings[videoId];
      await this.save();
      console.log(`[FolderMetadata] Removed rating for ${videoId}`);
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
    return this.metadata?.tags[videoId] || [];
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
      if (!this.metadata.tags[videoId]) {
        this.metadata.tags[videoId] = [];
      }
      
      if (!this.metadata.tags[videoId].includes(tag)) {
        this.metadata.tags[videoId].push(tag);
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
      if (this.metadata.tags[videoId]) {
        const index = this.metadata.tags[videoId].indexOf(tag);
        if (index > -1) {
          this.metadata.tags[videoId].splice(index, 1);
          
          // Clean up empty tag arrays
          if (this.metadata.tags[videoId].length === 0) {
            delete this.metadata.tags[videoId];
          }
          
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
   * Get statistics about the metadata
   */
  getStats() {
    if (!this.metadata) {
      return null;
    }

    return {
      favoritesCount: this.metadata.favorites.length,
      hiddenCount: this.metadata.hidden.length,
      ratingsCount: Object.keys(this.metadata.ratings).length,
      tagsCount: Object.keys(this.metadata.tags).length,
      lastUpdated: this.metadata.lastUpdated
    };
  }
}

export default FolderMetadataManager;
