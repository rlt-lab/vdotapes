/**
 * Tag Suggestion Manager
 * Provides tag suggestions based on folder context, recent usage, and global popularity
 */

import type { VideoId } from '../types/core';
import type { FolderMetadataManager } from './folder-metadata';
import type { VideoDatabase } from './database/VideoDatabase';

export interface TagSuggestion {
  name: string;
  source: 'folder' | 'recent' | 'global';
}

export class TagSuggestionManager {
  private recentlyUsedTags: string[] = [];
  private readonly MAX_RECENT = 10;

  constructor(
    private readonly folderMetadata: FolderMetadataManager,
    private readonly database: VideoDatabase
  ) {}

  /**
   * Record a tag as recently used (called when user adds a tag)
   */
  recordTagUsage(tag: string): void {
    // Remove if already exists (will be re-added at front)
    const existingIndex = this.recentlyUsedTags.indexOf(tag);
    if (existingIndex > -1) {
      this.recentlyUsedTags.splice(existingIndex, 1);
    }

    // Add to front
    this.recentlyUsedTags.unshift(tag);

    // Trim to max length
    if (this.recentlyUsedTags.length > this.MAX_RECENT) {
      this.recentlyUsedTags = this.recentlyUsedTags.slice(0, this.MAX_RECENT);
    }
  }

  /**
   * Get recently used tags
   */
  getRecentTags(limit = 3): string[] {
    return this.recentlyUsedTags.slice(0, limit);
  }

  /**
   * Clear session state (called when switching folders)
   */
  clearSession(): void {
    this.recentlyUsedTags = [];
  }

  /**
   * Get tags frequently used in a specific subfolder
   */
  async getFolderTags(subfolder: string, limit = 6): Promise<string[]> {
    // Query videos in this subfolder
    const videos = this.database.getVideos({ folder: subfolder });

    // Count tag occurrences across all videos in the folder
    const tagCounts: Record<string, number> = {};

    for (const video of videos) {
      const tags = this.folderMetadata.getTags(video.id as VideoId);
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    // Sort by count descending and return top N
    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name]) => name);
  }

  /**
   * Get tag suggestions for a video
   * Priority: folder-specific > recently-used > global popularity
   */
  async getSuggestions(
    videoId: VideoId,
    subfolder: string,
    limit = 12
  ): Promise<TagSuggestion[]> {
    const suggestions: TagSuggestion[] = [];
    const seen = new Set<string>();

    // Step 1: Folder-specific tags (highest priority)
    const folderTags = await this.getFolderTags(subfolder, 6);
    for (const tag of folderTags) {
      if (suggestions.length >= limit) break;
      if (!seen.has(tag)) {
        seen.add(tag);
        suggestions.push({ name: tag, source: 'folder' });
      }
    }

    // Step 2: Recently-used tags
    const recentTags = this.getRecentTags(3);
    for (const tag of recentTags) {
      if (suggestions.length >= limit) break;
      if (!seen.has(tag)) {
        seen.add(tag);
        suggestions.push({ name: tag, source: 'recent' });
      }
    }

    // Step 3: Global popular tags (fill remaining slots)
    const globalTags = this.folderMetadata.getAllTags();
    for (const tagInfo of globalTags) {
      if (suggestions.length >= limit) break;
      if (!seen.has(tagInfo.name)) {
        seen.add(tagInfo.name);
        suggestions.push({ name: tagInfo.name, source: 'global' });
      }
    }

    return suggestions;
  }
}

export default TagSuggestionManager;
