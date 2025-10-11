use std::path::PathBuf;
use tokio::fs;
use crate::types::ThumbnailError;

/// Thumbnail cache manager
pub struct ThumbnailCache {
    cache_dir: PathBuf,
    max_cache_size: u64,    // Bytes
}

impl ThumbnailCache {
    /// Create a new thumbnail cache
    pub fn new(cache_dir: PathBuf, max_cache_size: u64) -> Self {
        Self {
            cache_dir,
            max_cache_size,
        }
    }

    /// Initialize cache directory
    pub async fn initialize(&self) -> Result<(), ThumbnailError> {
        if !self.cache_dir.exists() {
            fs::create_dir_all(&self.cache_dir).await?;
        }
        Ok(())
    }

    /// Generate cache key from video path + timestamp
    pub fn cache_key(video_path: &str, timestamp: f64) -> String {
        let mut hasher = blake3::Hasher::new();
        hasher.update(video_path.as_bytes());
        hasher.update(&timestamp.to_le_bytes());
        hasher.finalize().to_hex().to_string()
    }

    /// Get cache file path for a key
    pub fn get_cache_path(&self, key: &str, format: &str) -> PathBuf {
        // Use first 2 chars as subdirectory for better file distribution
        let subdir = &key[..2.min(key.len())];
        let filename = format!("{}.{}", key, format);
        self.cache_dir.join(subdir).join(filename)
    }

    /// Check if thumbnail exists in cache
    pub async fn get(&self, key: &str, format: &str) -> Option<PathBuf> {
        let path = self.get_cache_path(key, format);

        if path.exists() {
            // Verify not corrupted (basic check - file has content)
            if let Ok(metadata) = fs::metadata(&path).await {
                if metadata.len() > 0 {
                    // Update access time
                    let _ = fs::File::open(&path).await;
                    return Some(path);
                }
            }
        }

        None
    }

    /// Save thumbnail to cache
    pub async fn put(&self, key: &str, format: &str, data: &[u8]) -> Result<PathBuf, ThumbnailError> {
        let path = self.get_cache_path(key, format);

        // Ensure subdirectory exists
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }

        // Write to temporary file first
        let temp_path = path.with_extension(format!("{}.tmp", format));
        fs::write(&temp_path, data).await?;

        // Atomic rename to final location
        fs::rename(&temp_path, &path).await?;

        // Check cache size and evict if needed
        self.enforce_cache_limit().await?;

        Ok(path)
    }

    /// Evict old entries if cache too large
    async fn enforce_cache_limit(&self) -> Result<(), ThumbnailError> {
        let total_size = self.calculate_cache_size().await?;

        if total_size > self.max_cache_size {
            self.evict_lru().await?;
        }

        Ok(())
    }

    /// Calculate total cache size
    async fn calculate_cache_size(&self) -> Result<u64, ThumbnailError> {
        let mut total_size = 0u64;

        let mut entries = fs::read_dir(&self.cache_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();

            if path.is_dir() {
                // Recursively check subdirectories
                let mut subentries = fs::read_dir(&path).await?;
                while let Some(subentry) = subentries.next_entry().await? {
                    if let Ok(metadata) = subentry.metadata().await {
                        if metadata.is_file() {
                            total_size += metadata.len();
                        }
                    }
                }
            } else if let Ok(metadata) = entry.metadata().await {
                total_size += metadata.len();
            }
        }

        Ok(total_size)
    }

    /// Evict least recently used entries
    pub async fn evict_lru(&self) -> Result<(), ThumbnailError> {
        use std::time::SystemTime;

        let mut files: Vec<(PathBuf, SystemTime)> = Vec::new();

        // Collect all files with their access times
        let mut entries = fs::read_dir(&self.cache_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();

            if path.is_dir() {
                let mut subentries = fs::read_dir(&path).await?;
                while let Some(subentry) = subentries.next_entry().await? {
                    if let Ok(metadata) = subentry.metadata().await {
                        if metadata.is_file() {
                            if let Ok(accessed) = metadata.accessed() {
                                files.push((subentry.path(), accessed));
                            }
                        }
                    }
                }
            } else if let Ok(metadata) = entry.metadata().await {
                if let Ok(accessed) = metadata.accessed() {
                    files.push((path, accessed));
                }
            }
        }

        // Sort by access time (oldest first)
        files.sort_by_key(|(_, time)| *time);

        // Delete oldest files until under limit
        let mut total_size = self.calculate_cache_size().await?;
        let target_size = (self.max_cache_size as f64 * 0.8) as u64; // Target 80% of max

        for (path, _) in files {
            if total_size <= target_size {
                break;
            }

            if let Ok(metadata) = fs::metadata(&path).await {
                let file_size = metadata.len();
                if fs::remove_file(&path).await.is_ok() {
                    total_size = total_size.saturating_sub(file_size);
                }
            }
        }

        Ok(())
    }

    /// Clear all cached thumbnails
    pub async fn clear_all(&self) -> Result<(), ThumbnailError> {
        if self.cache_dir.exists() {
            fs::remove_dir_all(&self.cache_dir).await?;
            fs::create_dir_all(&self.cache_dir).await?;
        }
        Ok(())
    }

    /// Get cache statistics
    pub async fn get_stats(&self) -> Result<(i32, i64), ThumbnailError> {
        let mut total_files = 0i32;
        let mut total_size = 0i64;

        let mut entries = fs::read_dir(&self.cache_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();

            if path.is_dir() {
                let mut subentries = fs::read_dir(&path).await?;
                while let Some(subentry) = subentries.next_entry().await? {
                    if let Ok(metadata) = subentry.metadata().await {
                        if metadata.is_file() {
                            total_files += 1;
                            total_size += metadata.len() as i64;
                        }
                    }
                }
            } else if let Ok(metadata) = entry.metadata().await {
                total_files += 1;
                total_size += metadata.len() as i64;
            }
        }

        Ok((total_files, total_size))
    }

    /// Get cache directory path
    pub fn get_cache_dir(&self) -> &std::path::Path {
        &self.cache_dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_key_generation() {
        let key1 = ThumbnailCache::cache_key("/path/to/video.mp4", 10.0);
        let key2 = ThumbnailCache::cache_key("/path/to/video.mp4", 10.0);
        assert_eq!(key1, key2, "Same inputs should produce same key");

        let key3 = ThumbnailCache::cache_key("/path/to/video.mp4", 20.0);
        assert_ne!(key1, key3, "Different timestamp should produce different key");
    }

    #[tokio::test]
    async fn test_cache_initialization() {
        let temp_dir = tempfile::tempdir().unwrap();
        let cache = ThumbnailCache::new(temp_dir.path().to_path_buf(), 1024 * 1024 * 100);

        cache.initialize().await.unwrap();
        assert!(cache.cache_dir.exists());
    }
}
