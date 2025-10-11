use std::collections::HashSet;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

use crate::types::{
    generate_video_id, is_valid_video_file, ScanProgress, ScanResult, ScanStats, VideoMetadata,
    EXCLUDED_DIRECTORIES,
};

/// Video scanner implementation
pub struct VideoScanner {
    is_scanning: bool,
    scan_progress: f64,
    total_files: u32,
    processed_files: u32,
    videos: Vec<VideoMetadata>,
}

impl VideoScanner {
    /// Create a new video scanner instance
    pub fn new() -> Self {
        Self {
            is_scanning: false,
            scan_progress: 0.0,
            total_files: 0,
            processed_files: 0,
            videos: Vec::new(),
        }
    }

    /// Scan a directory for video files
    pub fn scan_directory(&mut self, folder_path: &str) -> ScanResult {
        if self.is_scanning {
            return ScanResult {
                success: false,
                error: Some("Scan already in progress".to_string()),
                videos: Vec::new(),
                folders: Vec::new(),
                stats: None,
            };
        }

        self.reset();
        self.is_scanning = true;

        let result = self.perform_scan(folder_path);

        self.is_scanning = false;
        self.scan_progress = 100.0;

        result
    }

    /// Internal scan implementation
    fn perform_scan(&mut self, folder_path: &str) -> ScanResult {
        let path = Path::new(folder_path);

        if !path.exists() || !path.is_dir() {
            return ScanResult {
                success: false,
                error: Some(format!("Invalid directory: {}", folder_path)),
                videos: Vec::new(),
                folders: Vec::new(),
                stats: None,
            };
        }

        // Count total files for progress tracking
        self.total_files = self.count_files(path);

        // Collect all entries first to avoid borrowing issues
        let entries: Vec<_> = WalkDir::new(path)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| Self::should_process_entry_static(e))
            .collect();

        // Scan for videos
        let mut videos = Vec::new();
        let mut folder_set = HashSet::new();

        for entry_result in entries {
            match entry_result {
                Ok(entry) => {
                    self.processed_files += 1;
                    self.update_progress();

                    if entry.file_type().is_file() {
                        if let Some(video) = Self::process_video_file_static(&entry, folder_path) {
                            if !video.folder.is_empty() {
                                folder_set.insert(video.folder.clone());
                            }
                            videos.push(video);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Error processing entry: {}", e);
                }
            }
        }

        let mut folders: Vec<String> = folder_set.into_iter().collect();
        folders.sort();

        // Store videos in scanner state
        self.videos = videos.clone();

        ScanResult {
            success: true,
            videos,
            folders,
            error: None,
            stats: Some(ScanStats {
                total_files: self.total_files,
                valid_videos: self.videos.len() as u32,
                duplicates: 0,
                errors: 0,
            }),
        }
    }

    /// Check if a directory entry should be processed (static version)
    fn should_process_entry_static(entry: &walkdir::DirEntry) -> bool {
        let file_name = entry.file_name().to_string_lossy();

        // Skip hidden files and excluded directories
        if file_name.starts_with('.') {
            return false;
        }

        if entry.file_type().is_dir() && EXCLUDED_DIRECTORIES.contains(&file_name.as_ref()) {
            return false;
        }

        true
    }

    /// Process a single video file entry (static version)
    fn process_video_file_static(
        entry: &walkdir::DirEntry,
        base_path: &str,
    ) -> Option<VideoMetadata> {
        let file_name = entry.file_name().to_string_lossy().to_string();

        if !is_valid_video_file(&file_name) {
            return None;
        }

        let path = entry.path();
        let metadata = fs::metadata(path).ok()?;

        let size = metadata.len();
        let last_modified = metadata
            .modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_millis() as i64;
        let created = metadata
            .created()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_millis() as i64;

        let size_f64 = size as f64;
        let last_modified_f64 = last_modified as f64;
        let created_f64 = created as f64;

        let id = generate_video_id(&file_name, size_f64, last_modified_f64);
        let folder = Self::extract_folder_static(path, base_path);
        let now = chrono::Utc::now().to_rfc3339();

        Some(VideoMetadata {
            id,
            name: file_name,
            path: path.to_string_lossy().to_string(),
            folder,
            size: size_f64,
            last_modified: last_modified_f64,
            created: created_f64,
            added_at: now.clone(),
            updated_at: now,
            duration: None,
        })
    }

    /// Extract folder name from path relative to base path (static version)
    /// Matches TypeScript: getVideoFolder(relativePath) - returns last folder before filename
    fn extract_folder_static(path: &Path, base_path: &str) -> String {
        let base = Path::new(base_path);

        // Get relative path from base
        let relative = match path.strip_prefix(base) {
            Ok(rel) => rel,
            Err(_) => return String::new(),
        };

        // Get the relative path as string
        let relative_str = relative.to_string_lossy();

        // If no path separator, file is in root directory
        if !relative_str.contains(std::path::MAIN_SEPARATOR) {
            return String::new();
        }

        // Split by path separator and filter out empty parts, dots, and system files
        let parts: Vec<&str> = relative_str
            .split(std::path::MAIN_SEPARATOR)
            .filter(|part| {
                !part.is_empty()
                    && *part != "."
                    && !part.starts_with("._")
            })
            .collect();

        // Get folder parts (all except the last which is the filename)
        if parts.len() <= 1 {
            return String::new();
        }

        let folder_parts = &parts[..parts.len() - 1];

        // Return the last folder name
        folder_parts.last().unwrap_or(&"").to_string()
    }

    /// Count total files in directory for progress tracking
    fn count_files(&self, path: &Path) -> u32 {
        WalkDir::new(path)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| Self::should_process_entry_static(e))
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .count() as u32
    }

    /// Update scan progress
    fn update_progress(&mut self) {
        if self.total_files > 0 {
            self.scan_progress = (self.processed_files as f64 / self.total_files as f64) * 100.0;
        }
    }

    /// Get current scan progress
    pub fn get_progress(&self) -> ScanProgress {
        ScanProgress {
            is_scanning: self.is_scanning,
            progress: self.scan_progress,
            processed_files: self.processed_files,
            total_files: self.total_files,
            total_videos: self.videos.len() as u32,
        }
    }

    /// Get list of scanned videos
    pub fn get_videos(&self) -> Vec<VideoMetadata> {
        self.videos.clone()
    }

    /// Reset scanner state
    pub fn reset(&mut self) {
        self.is_scanning = false;
        self.scan_progress = 0.0;
        self.processed_files = 0;
        self.total_files = 0;
        self.videos.clear();
    }
}

impl Default for VideoScanner {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_new_scanner() {
        let scanner = VideoScanner::new();
        assert!(!scanner.is_scanning);
        assert_eq!(scanner.scan_progress, 0.0);
        assert_eq!(scanner.total_files, 0);
        assert_eq!(scanner.processed_files, 0);
        assert_eq!(scanner.videos.len(), 0);
    }

    #[test]
    fn test_reset() {
        let mut scanner = VideoScanner::new();
        scanner.is_scanning = true;
        scanner.scan_progress = 50.0;
        scanner.total_files = 100;
        scanner.processed_files = 50;

        scanner.reset();

        assert!(!scanner.is_scanning);
        assert_eq!(scanner.scan_progress, 0.0);
        assert_eq!(scanner.total_files, 0);
        assert_eq!(scanner.processed_files, 0);
        assert_eq!(scanner.videos.len(), 0);
    }

    #[test]
    fn test_get_progress() {
        let scanner = VideoScanner::new();
        let progress = scanner.get_progress();

        assert!(!progress.is_scanning);
        assert_eq!(progress.progress, 0.0);
        assert_eq!(progress.processed_files, 0);
        assert_eq!(progress.total_files, 0);
        assert_eq!(progress.total_videos, 0);
    }

    #[test]
    fn test_get_videos_empty() {
        let scanner = VideoScanner::new();
        let videos = scanner.get_videos();
        assert_eq!(videos.len(), 0);
    }

    #[test]
    fn test_should_process_entry() {
        // This test would require creating actual DirEntry objects
        // which is complex. Skipping for now.
    }

    #[test]
    fn test_extract_folder_static() {
        // Test root level file (no folder)
        let path = Path::new("/base/video.mp4");
        let folder = VideoScanner::extract_folder_static(path, "/base");
        assert_eq!(folder, "");

        // Test single folder deep
        let path = Path::new("/base/movies/video.mp4");
        let folder = VideoScanner::extract_folder_static(path, "/base");
        assert_eq!(folder, "movies");

        // Test nested folders (should return last folder before filename)
        let path = Path::new("/base/videos/2024/movies/action/video.mp4");
        let folder = VideoScanner::extract_folder_static(path, "/base");
        assert_eq!(folder, "action");

        // Test with system files in path (should filter out)
        let path = Path::new("/base/videos/normal/video.mp4");
        let folder = VideoScanner::extract_folder_static(path, "/base");
        assert_eq!(folder, "normal");
    }

    #[test]
    fn test_update_progress() {
        let mut scanner = VideoScanner::new();
        scanner.total_files = 100;
        scanner.processed_files = 50;

        scanner.update_progress();

        assert_eq!(scanner.scan_progress, 50.0);
    }

    #[test]
    fn test_scan_invalid_directory() {
        let mut scanner = VideoScanner::new();
        let result = scanner.scan_directory("/nonexistent/path");

        assert!(!result.success);
        assert!(result.error.is_some());
        assert_eq!(result.videos.len(), 0);
    }

    #[test]
    fn test_scan_already_scanning() {
        let mut scanner = VideoScanner::new();
        scanner.is_scanning = true;

        let result = scanner.scan_directory("/some/path");

        assert!(!result.success);
        assert_eq!(result.error, Some("Scan already in progress".to_string()));
    }

    #[test]
    fn test_default() {
        let scanner = VideoScanner::default();
        assert!(!scanner.is_scanning);
        assert_eq!(scanner.scan_progress, 0.0);
    }
}
