/**
 * Cross-platform script to copy native modules to dist directory
 * Works on Windows, macOS, and Linux
 */

const fs = require('fs');
const path = require('path');

const copies = [
  {
    src: 'src/video-scanner-native',
    dest: 'dist/main/src/video-scanner-native',
    patterns: ['.node', 'index.js']
  },
  {
    src: 'src/thumbnail-generator-native',
    dest: 'dist/main/src/thumbnail-generator-native',
    patterns: ['.node', 'index.js']
  }
];

let copiedCount = 0;

copies.forEach(({ src, dest, patterns }) => {
  // Create destination directory (recursive, like mkdir -p)
  fs.mkdirSync(dest, { recursive: true });

  // Read source directory
  let files;
  try {
    files = fs.readdirSync(src);
  } catch (err) {
    // Source directory doesn't exist - silently skip (like 2>/dev/null || true)
    return;
  }

  patterns.forEach(pattern => {
    if (pattern.startsWith('.')) {
      // It's an extension pattern (e.g., '.node') - copy all matching files
      files
        .filter(f => f.endsWith(pattern))
        .forEach(f => {
          const srcPath = path.join(src, f);
          const destPath = path.join(dest, f);
          try {
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copied: ${srcPath} -> ${destPath}`);
            copiedCount++;
          } catch (err) {
            // Silently skip if file doesn't exist
          }
        });
    } else {
      // It's a specific filename - copy directly
      const srcPath = path.join(src, pattern);
      const destPath = path.join(dest, pattern);
      try {
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, destPath);
          console.log(`Copied: ${srcPath} -> ${destPath}`);
          copiedCount++;
        }
      } catch (err) {
        // Silently skip if file doesn't exist
      }
    }
  });
});

console.log(`Native module copy complete. ${copiedCount} file(s) copied.`);
