/**
 * Verify database migration - Check that old and new tables have same data
 * 
 * Run this script after migration to ensure data integrity
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Get database path
const dbPath = path.join(
  process.env.APPDATA || process.env.HOME || '.', 
  '.vdotapes', 
  'videos.db'
);

console.log('=== Database Migration Verification ===\n');
console.log(`Database: ${dbPath}\n`);

try {
  const db = new Database(dbPath);
  
  // Check schema version
  const versionResult = db.prepare(
    "SELECT value FROM settings WHERE key = 'schema_version'"
  ).get();
  
  const schemaVersion = versionResult ? parseInt(versionResult.value, 10) : 0;
  console.log(`Schema version: ${schemaVersion}`);
  
  if (schemaVersion < 2) {
    console.log('\n⚠️  Database not yet migrated to v2');
    console.log('Run the app to trigger automatic migration');
    process.exit(0);
  }
  
  console.log('\n--- Checking Migration ---\n');
  
  // Check if backup tables exist
  const backupTables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name LIKE '_backup_%_v1'
    ORDER BY name
  `).all();
  
  if (backupTables.length === 0) {
    console.log('✅ Backup tables already removed');
    console.log('Cannot verify against backups, but migration is complete\n');
    
    // Show current stats from new columns
    const videos = db.prepare('SELECT COUNT(*) as count FROM videos').get();
    const favorites = db.prepare('SELECT COUNT(*) as count FROM videos WHERE favorite = 1').get();
    const hidden = db.prepare('SELECT COUNT(*) as count FROM videos WHERE hidden = 1').get();
    const rated = db.prepare('SELECT COUNT(*) as count FROM videos WHERE rating > 0').get();
    
    console.log('Current Stats:');
    console.log(`  Videos: ${videos.count}`);
    console.log(`  Favorites: ${favorites.count}`);
    console.log(`  Hidden: ${hidden.count}`);
    console.log(`  Rated: ${rated.count}`);
    
    db.close();
    process.exit(0);
  }
  
  console.log(`Found ${backupTables.length} backup tables:\n`);
  backupTables.forEach(t => console.log(`  - ${t.name}`));
  console.log();
  
  let totalMismatches = 0;
  
  // === VERIFY FAVORITES ===
  console.log('Checking favorites...');
  
  const oldFavorites = db.prepare(
    'SELECT COUNT(*) as count FROM _backup_favorites_v1'
  ).get();
  
  const newFavorites = db.prepare(
    'SELECT COUNT(*) as count FROM videos WHERE favorite = 1'
  ).get();
  
  console.log(`  Old table: ${oldFavorites.count}`);
  console.log(`  New column: ${newFavorites.count}`);
  
  if (oldFavorites.count !== newFavorites.count) {
    console.log('  ❌ MISMATCH: Favorites count different!');
    totalMismatches++;
  } else {
    console.log('  ✅ Counts match');
  }
  
  // Check individual favorite records
  const favMismatches = db.prepare(`
    SELECT video_id FROM _backup_favorites_v1
    WHERE video_id NOT IN (SELECT id FROM videos WHERE favorite = 1)
    UNION
    SELECT id FROM videos WHERE favorite = 1 
      AND id NOT IN (SELECT video_id FROM _backup_favorites_v1)
  `).all();
  
  if (favMismatches.length > 0) {
    console.log(`  ❌ ${favMismatches.length} favorites don't match:`);
    favMismatches.slice(0, 5).forEach(m => console.log(`     ${m.video_id || m.id}`));
    if (favMismatches.length > 5) {
      console.log(`     ... and ${favMismatches.length - 5} more`);
    }
    totalMismatches++;
  } else {
    console.log('  ✅ All favorite records match');
  }
  
  console.log();
  
  // === VERIFY HIDDEN FILES ===
  console.log('Checking hidden files...');
  
  const oldHidden = db.prepare(
    'SELECT COUNT(*) as count FROM _backup_hidden_files_v1'
  ).get();
  
  const newHidden = db.prepare(
    'SELECT COUNT(*) as count FROM videos WHERE hidden = 1'
  ).get();
  
  console.log(`  Old table: ${oldHidden.count}`);
  console.log(`  New column: ${newHidden.count}`);
  
  if (oldHidden.count !== newHidden.count) {
    console.log('  ❌ MISMATCH: Hidden count different!');
    totalMismatches++;
  } else {
    console.log('  ✅ Counts match');
  }
  
  // Check individual hidden records
  const hiddenMismatches = db.prepare(`
    SELECT video_id FROM _backup_hidden_files_v1
    WHERE video_id NOT IN (SELECT id FROM videos WHERE hidden = 1)
    UNION
    SELECT id FROM videos WHERE hidden = 1 
      AND id NOT IN (SELECT video_id FROM _backup_hidden_files_v1)
  `).all();
  
  if (hiddenMismatches.length > 0) {
    console.log(`  ❌ ${hiddenMismatches.length} hidden files don't match:`);
    hiddenMismatches.slice(0, 5).forEach(m => console.log(`     ${m.video_id || m.id}`));
    if (hiddenMismatches.length > 5) {
      console.log(`     ... and ${hiddenMismatches.length - 5} more`);
    }
    totalMismatches++;
  } else {
    console.log('  ✅ All hidden records match');
  }
  
  console.log();
  
  // === VERIFY RATINGS ===
  console.log('Checking ratings...');
  
  const oldRatings = db.prepare(
    'SELECT COUNT(*) as count FROM _backup_ratings_v1'
  ).get();
  
  const newRatings = db.prepare(
    'SELECT COUNT(*) as count FROM videos WHERE rating > 0'
  ).get();
  
  console.log(`  Old table: ${oldRatings.count}`);
  console.log(`  New column: ${newRatings.count}`);
  
  if (oldRatings.count !== newRatings.count) {
    console.log('  ❌ MISMATCH: Ratings count different!');
    totalMismatches++;
  } else {
    console.log('  ✅ Counts match');
  }
  
  // Check individual rating records
  const ratingMismatches = db.prepare(`
    SELECT r.video_id, r.rating as old_rating, v.rating as new_rating
    FROM _backup_ratings_v1 r
    LEFT JOIN videos v ON r.video_id = v.id
    WHERE r.rating != v.rating OR v.rating IS NULL
    UNION
    SELECT v.id as video_id, r.rating as old_rating, v.rating as new_rating
    FROM videos v
    LEFT JOIN _backup_ratings_v1 r ON v.id = r.video_id
    WHERE v.rating > 0 AND (r.rating IS NULL OR r.rating != v.rating)
  `).all();
  
  if (ratingMismatches.length > 0) {
    console.log(`  ❌ ${ratingMismatches.length} ratings don't match:`);
    ratingMismatches.slice(0, 5).forEach(m => 
      console.log(`     ${m.video_id}: old=${m.old_rating}, new=${m.new_rating}`)
    );
    if (ratingMismatches.length > 5) {
      console.log(`     ... and ${ratingMismatches.length - 5} more`);
    }
    totalMismatches++;
  } else {
    console.log('  ✅ All rating values match');
  }
  
  console.log();
  
  // === SUMMARY ===
  console.log('=== Verification Summary ===\n');
  
  if (totalMismatches === 0) {
    console.log('✅ All data migrated correctly!');
    console.log('\nYou can safely remove backup tables by running:');
    console.log('  node scripts/remove-backup-tables.js');
  } else {
    console.log(`❌ Found ${totalMismatches} mismatch(es)`);
    console.log('\n⚠️  DO NOT remove backup tables yet!');
    console.log('Investigate mismatches before proceeding.');
    process.exit(1);
  }
  
  db.close();
} catch (error) {
  console.error('\n❌ Error during verification:', error.message);
  console.error(error.stack);
  process.exit(1);
}
