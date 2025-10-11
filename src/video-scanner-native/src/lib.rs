#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;

mod scanner;
mod types;

use scanner::VideoScanner;
use types::{ScanProgress, ScanResult};

/// VideoScannerNative - Rust-based video scanner for high performance
#[napi]
pub struct VideoScannerNative {
    scanner: VideoScanner,
}

#[napi]
impl VideoScannerNative {
    /// Create a new VideoScannerNative instance
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            scanner: VideoScanner::new(),
        }
    }

    /// Scan a directory for video files
    ///
    /// # Arguments
    /// * `folder_path` - Path to the directory to scan
    ///
    /// # Returns
    /// ScanResult containing found videos and statistics
    #[napi]
    pub fn scan_videos(&mut self, folder_path: String) -> Result<ScanResult> {
        let result = self.scanner.scan_directory(&folder_path);
        Ok(result)
    }

    /// Get current scan progress
    ///
    /// # Returns
    /// ScanProgress containing current scanning state
    #[napi]
    pub fn get_progress(&self) -> Result<ScanProgress> {
        Ok(self.scanner.get_progress())
    }

    /// Get list of scanned videos
    ///
    /// # Returns
    /// Vector of VideoMetadata for all scanned videos
    #[napi]
    pub fn get_videos(&self) -> Result<Vec<types::VideoMetadata>> {
        Ok(self.scanner.get_videos())
    }

    /// Reset the scanner state
    #[napi]
    pub fn reset(&mut self) -> Result<()> {
        self.scanner.reset();
        Ok(())
    }

    /// Check if a filename is a valid video file
    ///
    /// # Arguments
    /// * `filename` - Name of the file to check
    ///
    /// # Returns
    /// true if the file is a valid video file, false otherwise
    #[napi]
    pub fn is_valid_video_file(&self, filename: String) -> Result<bool> {
        Ok(types::is_valid_video_file(&filename))
    }
}

/// Standalone function to scan videos (functional API)
#[napi]
pub fn scan_videos_sync(folder_path: String) -> Result<ScanResult> {
    let mut scanner = VideoScanner::new();
    Ok(scanner.scan_directory(&folder_path))
}

/// Standalone function to check if a file is a valid video
#[napi]
pub fn is_valid_video(filename: String) -> Result<bool> {
    Ok(types::is_valid_video_file(&filename))
}

/// Get supported video extensions
#[napi]
pub fn get_supported_extensions() -> Result<Vec<String>> {
    Ok(types::VIDEO_EXTENSIONS
        .iter()
        .map(|s| s.to_string())
        .collect())
}
