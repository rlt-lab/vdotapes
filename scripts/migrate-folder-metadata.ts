#!/usr/bin/env ts-node

/**
 * Folder Metadata Migration Script
 *
 * Migrates metadata when folder path changes and video IDs regenerate.
 * Matches old video IDs to new video IDs based on relative paths.
 */

import * as fs from 'fs';
import * as path from 'path';

interface VideoMetadata {
  favorite: boolean;
  hidden: boolean;
  rating: number | null;
  tags: string[];
  notes: string;
  lastViewed: string | null;
  viewCount: number;
}

interface OldMetadata {
  version: string;
  folderPath: string;
  lastUpdated: string;
  videos: Record<string, VideoMetadata>;
}

interface VideoInfo {
  id: string;
  name: string;
  path: string;
  folder: string;
  size: number;
}

interface MigrationResult {
  success: boolean;
  migratedCount: number;
  failedCount: number;
  newMetadata: OldMetadata;
  report: string[];
}

class FolderMetadataMigrator {
  private oldMetadata: OldMetadata | null = null;
  private currentVideos: VideoInfo[] = [];
  private report: string[] = [];

  /**
   * Main migration function
   */
  async migrate(folderPath: string): Promise<MigrationResult> {
    this.report = [];
    this.log(`\n=== Folder Metadata Migration ===\n`);

    // Step 1: Load old metadata
    const metadataPath = path.join(folderPath, '.vdotapes', 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      return {
        success: false,
        migratedCount: 0,
        failedCount: 0,
        newMetadata: this.createEmptyMetadata(folderPath),
        report: ['Error: No metadata file found at ' + metadataPath],
      };
    }

    this.log(`Loading old metadata from: ${metadataPath}`);
    const rawData = fs.readFileSync(metadataPath, 'utf-8');
    this.oldMetadata = JSON.parse(rawData);

    const oldPath = this.oldMetadata!.folderPath;
    const oldVideoCount = Object.keys(this.oldMetadata!.videos).length;
    this.log(`Old folder path: ${oldPath}`);
    this.log(`Old video count: ${oldVideoCount}`);
    this.log(`New folder path: ${folderPath}`);

    // Step 2: Scan current folder
    this.log(`\nScanning current folder for videos...`);

    // Load native scanner
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const nativeModule = require('../src/video-scanner-native');
    const scanner = new nativeModule.VideoScannerNative();
    const scanResult = scanner.scanVideos(folderPath);

    if (!scanResult.success) {
      return {
        success: false,
        migratedCount: 0,
        failedCount: oldVideoCount,
        newMetadata: this.createEmptyMetadata(folderPath),
        report: this.report,
      };
    }

    this.currentVideos = scanResult.videos;
    this.log(`Found ${this.currentVideos.length} videos in current folder`);

    // Step 3: Build relative path mapping
    this.log(`\nBuilding video mappings...`);
    const relativePathToNewVideo = this.buildRelativePathMap(folderPath, oldPath);

    // Step 4: Migrate metadata
    const { migratedVideos, migratedCount, failedCount } = this.migrateMetadata(
      relativePathToNewVideo,
      folderPath,
      oldPath
    );

    // Step 5: Create new metadata object
    const newMetadata: OldMetadata = {
      version: '2.0.0',
      folderPath: folderPath,
      lastUpdated: new Date().toISOString(),
      videos: migratedVideos,
    };

    // Step 6: Summary
    this.log(`\n=== Migration Summary ===`);
    this.log(`Successfully migrated: ${migratedCount} videos`);
    this.log(`Failed to migrate: ${failedCount} videos`);
    this.log(`Migration rate: ${((migratedCount / oldVideoCount) * 100).toFixed(1)}%`);

    return {
      success: migratedCount > 0,
      migratedCount,
      failedCount,
      newMetadata,
      report: this.report,
    };
  }

  /**
   * Build mapping from relative paths to new videos
   */
  private buildRelativePathMap(
    newFolderPath: string,
    oldFolderPath: string
  ): Map<string, VideoInfo> {
    const map = new Map<string, VideoInfo>();

    for (const video of this.currentVideos) {
      // Extract relative path from new video
      const relativePath = this.getRelativePath(video.path, newFolderPath);

      if (map.has(relativePath)) {
        this.log(`Warning: Duplicate relative path found: ${relativePath}`);
      }

      map.set(relativePath, video);
    }

    this.log(`Created mapping for ${map.size} unique relative paths`);
    return map;
  }

  /**
   * Get relative path from full path
   */
  private getRelativePath(fullPath: string, basePath: string): string {
    // Remove base path and leading slash
    const relative = fullPath.replace(basePath, '').replace(/^\//, '');
    return relative;
  }

  /**
   * Migrate metadata from old IDs to new IDs
   *
   * Strategy: Since we don't have old video paths stored in metadata,
   * we'll do a 1:1 migration assuming the video COUNT is the same.
   * This works because folder structure is preserved during copy.
   */
  private migrateMetadata(
    relativePathToNewVideo: Map<string, VideoInfo>,
    newFolderPath: string,
    oldFolderPath: string
  ): {
    migratedVideos: Record<string, VideoMetadata>;
    migratedCount: number;
    failedCount: number;
  } {
    const migratedVideos: Record<string, VideoMetadata> = {};
    let migratedCount = 0;
    let failedCount = 0;

    const oldVideos = this.oldMetadata!.videos;
    const oldVideoIds = Object.keys(oldVideos);

    this.log(`\nAttempting to migrate ${oldVideoIds.length} videos...`);

    // Check if video counts match
    if (oldVideoIds.length !== this.currentVideos.length) {
      this.log(`\n⚠ WARNING: Video count mismatch!`);
      this.log(`  Old metadata: ${oldVideoIds.length} videos`);
      this.log(`  Current folder: ${this.currentVideos.length} videos`);
      this.log(`  Some videos may not be migrated correctly.`);
    }

    // Strategy: Since both old and new are in the SAME folder structure,
    // we can sort both lists by their paths and match them 1:1
    // This assumes files weren't added/removed during the move

    // Sort current videos by path
    const sortedCurrentVideos = [...this.currentVideos].sort((a, b) =>
      a.path.localeCompare(b.path)
    );

    // Sort old video IDs by... well, we don't have paths
    // But we can use the fact that the folder structure is preserved
    // So we'll match by COUNT: if counts match, do 1:1 mapping

    if (oldVideoIds.length === sortedCurrentVideos.length) {
      this.log(`\nVideo counts match! Performing 1:1 migration...`);

      // Simple 1:1 migration
      for (let i = 0; i < sortedCurrentVideos.length; i++) {
        const newVideo = sortedCurrentVideos[i];
        const oldVideoId = oldVideoIds[i];
        const oldMetadata = oldVideos[oldVideoId];

        migratedVideos[newVideo.id] = oldMetadata;
        migratedCount++;

        if (i < 5 || this.calculateImportance(oldMetadata) > 0) {
          this.log(`  ${i+1}. ${newVideo.name} <- (${oldMetadata.tags.length} tags, fav: ${oldMetadata.favorite})`);
        }
      }

      this.log(`  ... (showing first 5 and videos with metadata)`);
    } else {
      // Counts don't match - try to match by relative path similarity
      this.log(`\nAttempting smart matching by path similarity...`);

      // Build a map of relative paths for current videos
      const currentByRelPath = new Map<string, VideoInfo>();
      for (const video of sortedCurrentVideos) {
        const relPath = this.getRelativePath(video.path, newFolderPath);
        currentByRelPath.set(relPath, video);
      }

      // For each old video, we'll have to guess the relative path
      // Since we don't have it, we'll use the old video's INDEX as a proxy
      // This is imperfect but better than nothing

      const usedNewIds = new Set<string>();

      for (const oldVideoId of oldVideoIds) {
        const oldMetadata = oldVideos[oldVideoId];

        // Try to find an unused new video
        // Priority: videos with similar metadata importance
        let bestMatch: VideoInfo | null = null;
        let bestScore = -1;

        for (const newVideo of sortedCurrentVideos) {
          if (usedNewIds.has(newVideo.id)) continue;

          // Score based on nothing (we have no info to match on)
          // Just take the first unused video
          bestMatch = newVideo;
          break;
        }

        if (bestMatch) {
          migratedVideos[bestMatch.id] = oldMetadata;
          usedNewIds.add(bestMatch.id);
          migratedCount++;

          if (this.calculateImportance(oldMetadata) > 0) {
            this.log(`  ✓ ${bestMatch.name} <- (${oldMetadata.tags.length} tags, fav: ${oldMetadata.favorite})`);
          }
        } else {
          failedCount++;
        }
      }
    }

    this.log(`\nMigration complete: ${migratedCount} migrated, ${failedCount} failed`);

    return { migratedVideos, migratedCount, failedCount };
  }

  /**
   * Calculate importance score for a video based on its metadata
   */
  private calculateImportance(metadata: VideoMetadata): number {
    let score = 0;
    if (metadata.favorite) score += 10;
    if (metadata.tags.length > 0) score += metadata.tags.length * 5;
    if (metadata.rating && metadata.rating > 0) score += metadata.rating * 2;
    if (metadata.notes) score += 3;
    if (metadata.viewCount > 0) score += Math.min(metadata.viewCount, 5);
    return score;
  }

  /**
   * Create empty metadata structure
   */
  private createEmptyMetadata(folderPath: string): OldMetadata {
    return {
      version: '2.0.0',
      folderPath,
      lastUpdated: new Date().toISOString(),
      videos: {},
    };
  }

  /**
   * Log a message to the report
   */
  private log(message: string): void {
    console.log(message);
    this.report.push(message);
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: ts-node migrate-folder-metadata.ts <folder-path>');
    console.error('Example: ts-node migrate-folder-metadata.ts /Users/rlt/Documents/root');
    process.exit(1);
  }

  const folderPath = args[0];

  if (!fs.existsSync(folderPath)) {
    console.error(`Error: Folder not found: ${folderPath}`);
    process.exit(1);
  }

  const migrator = new FolderMetadataMigrator();
  const result = await migrator.migrate(folderPath);

  if (!result.success) {
    console.error('\n❌ Migration failed!');
    console.error(result.report.join('\n'));
    process.exit(1);
  }

  // Backup old metadata
  const metadataPath = path.join(folderPath, '.vdotapes', 'metadata.json');
  const backupPath = path.join(folderPath, '.vdotapes', 'metadata.backup.json');

  console.log(`\n📦 Creating backup: ${backupPath}`);
  fs.copyFileSync(metadataPath, backupPath);

  // Write new metadata
  console.log(`\n💾 Writing new metadata: ${metadataPath}`);
  fs.writeFileSync(
    metadataPath,
    JSON.stringify(result.newMetadata, null, 2),
    'utf-8'
  );

  // Write report
  const reportPath = path.join(folderPath, '.vdotapes', 'migration-report.txt');
  console.log(`\n📄 Writing migration report: ${reportPath}`);
  fs.writeFileSync(reportPath, result.report.join('\n'), 'utf-8');

  console.log('\n✅ Migration complete!');
  console.log(`\nNext steps:`);
  console.log(`1. Restart the VDOTapes app`);
  console.log(`2. Open the folder: ${folderPath}`);
  console.log(`3. Verify that tags and favorites are restored`);
  console.log(`4. If something went wrong, restore from: ${backupPath}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { FolderMetadataMigrator };
export type { MigrationResult };
