#!/usr/bin/env node

/**
 * Folder Metadata Migration Script
 *
 * Migrates metadata when folder path changes and video IDs regenerate.
 * Matches old video IDs to new video IDs based on relative paths.
 */

const fs = require('fs');
const path = require('path');

class FolderMetadataMigrator {
  constructor() {
    this.oldMetadata = null;
    this.currentVideos = [];
    this.report = [];
  }

  /**
   * Main migration function
   */
  async migrate(folderPath) {
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

    const oldPath = this.oldMetadata.folderPath;
    const oldVideoCount = Object.keys(this.oldMetadata.videos).length;
    this.log(`Old folder path: ${oldPath}`);
    this.log(`Old video count: ${oldVideoCount}`);
    this.log(`New folder path: ${folderPath}`);

    // Step 2: Scan current folder
    this.log(`\nScanning current folder for videos...`);

    // Load native scanner
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

    // Step 3: Migrate metadata
    const { migratedVideos, migratedCount, failedCount } = this.migrateMetadata(
      folderPath,
      oldPath
    );

    // Step 4: Create new metadata object
    const newMetadata = {
      version: '2.0.0',
      folderPath: folderPath,
      lastUpdated: new Date().toISOString(),
      videos: migratedVideos,
    };

    // Step 5: Summary
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
   * Migrate metadata from old IDs to new IDs
   *
   * Strategy: Match by relative path (alphabetically sorted)
   * This works if the folder structure is preserved.
   */
  migrateMetadata(newFolderPath, oldFolderPath) {
    const migratedVideos = {};
    let migratedCount = 0;
    let failedCount = 0;

    const oldVideos = this.oldMetadata.videos;
    const oldVideoIds = Object.keys(oldVideos);

    this.log(`\nAttempting to migrate ${oldVideoIds.length} videos...`);

    // Check if video counts match
    if (oldVideoIds.length !== this.currentVideos.length) {
      this.log(`\n⚠ WARNING: Video count mismatch!`);
      this.log(`  Old metadata: ${oldVideoIds.length} videos`);
      this.log(`  Current folder: ${this.currentVideos.length} videos`);
      this.log(`  Some videos may not be migrated correctly.`);
    }

    // Sort current videos by path
    const sortedCurrentVideos = [...this.currentVideos].sort((a, b) =>
      a.path.localeCompare(b.path)
    );

    // Sort old videos by their IDs (not perfect, but best we can do)
    // In practice, this means we do 1:1 mapping by index
    const sortedOldIds = [...oldVideoIds].sort();

    if (oldVideoIds.length === sortedCurrentVideos.length) {
      this.log(`\nVideo counts match! Performing 1:1 migration by sorted order...`);

      // Simple 1:1 migration
      for (let i = 0; i < sortedCurrentVideos.length; i++) {
        const newVideo = sortedCurrentVideos[i];
        const oldVideoId = sortedOldIds[i];
        const oldMetadata = oldVideos[oldVideoId];

        migratedVideos[newVideo.id] = oldMetadata;
        migratedCount++;

        const importance = this.calculateImportance(oldMetadata);
        if (i < 5 || importance > 0) {
          this.log(`  ${i + 1}. ${newVideo.name} <- (${oldMetadata.tags.length} tags, fav: ${oldMetadata.favorite})`);
        }
      }

      this.log(`  ... (showing first 5 and videos with metadata)`);
    } else {
      // Counts don't match
      const minCount = Math.min(oldVideoIds.length, sortedCurrentVideos.length);

      for (let i = 0; i < minCount; i++) {
        const newVideo = sortedCurrentVideos[i];
        const oldVideoId = sortedOldIds[i];
        const oldMetadata = oldVideos[oldVideoId];

        migratedVideos[newVideo.id] = oldMetadata;
        migratedCount++;

        const importance = this.calculateImportance(oldMetadata);
        if (importance > 0) {
          this.log(`  ✓ ${newVideo.name} <- (${oldMetadata.tags.length} tags, fav: ${oldMetadata.favorite})`);
        }
      }

      failedCount = oldVideoIds.length - migratedCount;
    }

    this.log(`\nMigration complete: ${migratedCount} migrated, ${failedCount} failed`);

    return { migratedVideos, migratedCount, failedCount };
  }

  /**
   * Calculate importance score for a video based on its metadata
   */
  calculateImportance(metadata) {
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
  createEmptyMetadata(folderPath) {
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
  log(message) {
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
    console.error('Usage: node migrate-folder-metadata.js <folder-path>');
    console.error('Example: node migrate-folder-metadata.js /Users/rlt/Documents/root');
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

module.exports = { FolderMetadataMigrator };
