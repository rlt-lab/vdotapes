/**
 * Remove backup tables after successful verification
 * 
 * ONLY run this after verify-migration.js passes!
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const readline = require('readline');

// Get database path
const dbPath = path.join(
  process.env.APPDATA || process.env.HOME || '.', 
  '.vdotapes', 
  'videos.db'
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  console.log('=== Remove Backup Tables ===\n');
  console.log(`Database: ${dbPath}\n`);
  
  try {
    const db = new Database(dbPath);
    
    // Check for backup tables
    const backupTables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name LIKE '_backup_%_v1'
      ORDER BY name
    `).all();
    
    if (backupTables.length === 0) {
      console.log('No backup tables found. Already clean!');
      db.close();
      rl.close();
      return;
    }
    
    console.log(`Found ${backupTables.length} backup tables:\n`);
    backupTables.forEach(t => console.log(`  - ${t.name}`));
    console.log();
    
    // Get counts before removal
    const favorites = db.prepare('SELECT COUNT(*) as count FROM _backup_favorites_v1').get();
    const hidden = db.prepare('SELECT COUNT(*) as count FROM _backup_hidden_files_v1').get();
    const ratings = db.prepare('SELECT COUNT(*) as count FROM _backup_ratings_v1').get();
    
    console.log('Current backup contents:');
    console.log(`  Favorites: ${favorites.count}`);
    console.log(`  Hidden: ${hidden.count}`);
    console.log(`  Ratings: ${ratings.count}`);
    console.log();
    
    console.log('⚠️  WARNING: This action cannot be undone!');
    console.log('Make sure you have run verify-migration.js and it passed.\n');
    
    const answer = await question('Are you sure you want to remove backup tables? (yes/no): ');
    
    if (answer.toLowerCase() !== 'yes') {
      console.log('\nCancelled. Backup tables preserved.');
      db.close();
      rl.close();
      return;
    }
    
    console.log('\nRemoving backup tables...');
    
    db.exec('BEGIN TRANSACTION');
    
    try {
      db.exec('DROP TABLE IF EXISTS _backup_favorites_v1');
      console.log('  ✅ Dropped _backup_favorites_v1');
      
      db.exec('DROP TABLE IF EXISTS _backup_hidden_files_v1');
      console.log('  ✅ Dropped _backup_hidden_files_v1');
      
      db.exec('DROP TABLE IF EXISTS _backup_ratings_v1');
      console.log('  ✅ Dropped _backup_ratings_v1');
      
      db.exec('COMMIT');
      
      console.log('\n✅ Backup tables successfully removed!');
      console.log('\nDatabase is now using v2 schema exclusively.');
      
      // Show final stats
      const finalFavorites = db.prepare('SELECT COUNT(*) as count FROM videos WHERE favorite = 1').get();
      const finalHidden = db.prepare('SELECT COUNT(*) as count FROM videos WHERE hidden = 1').get();
      const finalRatings = db.prepare('SELECT COUNT(*) as count FROM videos WHERE rating > 0').get();
      
      console.log('\nFinal stats:');
      console.log(`  Favorites: ${finalFavorites.count}`);
      console.log(`  Hidden: ${finalHidden.count}`);
      console.log(`  Rated: ${finalRatings.count}`);
      
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    
    db.close();
    rl.close();
    
  } catch (error) {
    console.error('\n❌ Error removing backup tables:', error.message);
    console.error(error.stack);
    rl.close();
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
