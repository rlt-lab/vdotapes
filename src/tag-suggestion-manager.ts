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

interface TagInfo {
  name: string;
  usage: number;
}

export class TagSuggestionManager {
  private recentlyUsedTags: string[] = [];
  private readonly MAX_RECENT = 10;
  private readonly CACHE_TTL = 30000; // 30 seconds
  private tagCache: { tags: TagInfo[]; timestamp: number } | null = null;
  private folderTagCache = new Map<string, { tags: string[]; timestamp: number }>();

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
    this.invalidateTagCache();
  }

  /**
   * Invalidate tag caches (called when tags are added/removed)
   */
  invalidateTagCache(): void {
    this.tagCache = null;
    this.folderTagCache.clear();
  }

  /**
   * Get cached global tags
   */
  private getCachedGlobalTags(): TagInfo[] {
    if (this.tagCache && Date.now() - this.tagCache.timestamp < this.CACHE_TTL) {
      return this.tagCache.tags;
    }
    const tags = this.folderMetadata.getAllTags();
    this.tagCache = { tags, timestamp: Date.now() };
    return tags;
  }

  /**
   * Get tags frequently used in a specific subfolder
   */
  async getFolderTags(subfolder: string, limit = 6): Promise<string[]> {
    // Check cache first
    const cached = this.folderTagCache.get(subfolder);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.tags.slice(0, limit);
    }

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

    // Sort by count descending
    const sortedTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    // Cache the result
    this.folderTagCache.set(subfolder, { tags: sortedTags, timestamp: Date.now() });

    return sortedTags.slice(0, limit);
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
    const globalTags = this.getCachedGlobalTags();
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
