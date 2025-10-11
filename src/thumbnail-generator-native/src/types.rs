use napi_derive::napi;
use serde::{Deserialize, Serialize};

/// Configuration for thumbnail generation
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailConfig {
    pub width: u32,
    pub height: u32,
    pub quality: u8,        // JPEG quality 1-100
    pub format: String,      // "jpeg", "png", "webp"
}

impl Default for ThumbnailConfig {
    fn default() -> Self {
        Self {
            width: 1280,
            height: 720,
            quality: 85,
            format: "jpeg".to_string(),
        }
    }
}

/// Result of thumbnail generation
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_path: Option<String>,
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub file_size: i64,
    pub timestamp: f64,     // Seconds in video
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Video metadata extracted from file
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoMetadata {
    pub duration: f64,      // Total duration in seconds
    pub width: u32,
    pub height: u32,
    pub codec: String,
    pub bitrate: i64,
    pub fps: f64,
}

/// Progress information during thumbnail generation
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationProgress {
    pub is_generating: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_file: Option<String>,
    pub progress: f64,      // 0.0 - 1.0
}

/// Cache statistics
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStats {
    pub total_thumbnails: i32,
    pub total_size_bytes: i64,
    pub cache_dir: String,
}

/// Error types for thumbnail generation
#[derive(thiserror::Error, Debug)]
pub enum ThumbnailError {
    #[error("Video file not found: {0}")]
    FileNotFound(String),

    #[error("FFmpeg error: {0}")]
    FFmpegError(String),

    #[error("Invalid timestamp: {0}")]
    InvalidTimestamp(f64),

    #[error("Encoding error: {0}")]
    EncodingError(String),

    #[error("Cache error: {0}")]
    CacheError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("No video stream found")]
    NoVideoStream,

    #[error("No valid frame found")]
    NoValidFrame,

    #[error("Image error: {0}")]
    ImageError(String),
}

impl From<image::ImageError> for ThumbnailError {
    fn from(err: image::ImageError) -> Self {
        ThumbnailError::ImageError(err.to_string())
    }
}

// Convert ThumbnailError to napi::Error for JavaScript
impl From<ThumbnailError> for napi::Error {
    fn from(err: ThumbnailError) -> Self {
        napi::Error::from_reason(err.to_string())
    }
}
