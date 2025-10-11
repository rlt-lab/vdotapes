#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

mod cache;
mod ffmpeg;
mod generator;
mod types;

use generator::ThumbnailGenerator as InnerGenerator;
use types::{CacheStats, ThumbnailResult, VideoMetadata};

/// ThumbnailGeneratorNative - Rust-based thumbnail generator using FFmpeg
#[napi]
pub struct ThumbnailGeneratorNative {
    generator: Arc<Mutex<InnerGenerator>>,
}

#[napi]
impl ThumbnailGeneratorNative {
    /// Create a new ThumbnailGeneratorNative instance
    ///
    /// # Arguments
    /// * `cache_dir` - Optional cache directory path. Defaults to system temp dir
    #[napi(constructor)]
    pub fn new(cache_dir: Option<String>) -> napi::Result<Self> {
        let cache_path = if let Some(dir) = cache_dir {
            PathBuf::from(dir)
        } else {
            std::env::temp_dir().join("vdotapes_thumbnails")
        };

        let generator = InnerGenerator::new(cache_path, None);

        Ok(Self {
            generator: Arc::new(Mutex::new(generator)),
        })
    }

    /// Initialize the thumbnail generator
    #[napi]
    pub async fn initialize(&self) -> napi::Result<()> {
        let generator = self.generator.lock().await;
        generator
            .initialize()
            .await
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        Ok(())
    }

    /// Generate thumbnail for video
    ///
    /// # Arguments
    /// * `video_path` - Path to the video file
    /// * `timestamp` - Optional timestamp in seconds. If None, uses smart selection
    ///
    /// # Returns
    /// ThumbnailResult with path to generated thumbnail
    #[napi]
    pub async fn generate_thumbnail(
        &self,
        video_path: String,
        timestamp: Option<f64>,
    ) -> napi::Result<ThumbnailResult> {
        let generator = self.generator.lock().await;
        let result = generator
            .generate(&video_path, timestamp)
            .await
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        Ok(result)
    }

    /// Get thumbnail path (from cache only, doesn't generate)
    ///
    /// # Arguments
    /// * `video_path` - Path to the video file
    /// * `timestamp` - Optional timestamp in seconds
    ///
    /// # Returns
    /// Path to cached thumbnail or None if not cached
    #[napi]
    pub async fn get_thumbnail_path(
        &self,
        video_path: String,
        timestamp: Option<f64>,
    ) -> napi::Result<Option<String>> {
        let generator = self.generator.lock().await;
        Ok(generator.get_thumbnail_path(&video_path, timestamp).await)
    }

    /// Extract video metadata without generating thumbnail
    ///
    /// # Arguments
    /// * `video_path` - Path to the video file
    ///
    /// # Returns
    /// VideoMetadata containing duration, dimensions, codec info, etc.
    #[napi]
    pub async fn get_video_metadata(&self, video_path: String) -> napi::Result<VideoMetadata> {
        // This runs in a blocking context since FFmpeg operations are sync
        let result = tokio::task::spawn_blocking(move || {
            let decoder = ffmpeg::VideoDecoder::new(&video_path)?;
            Ok::<VideoMetadata, types::ThumbnailError>(decoder.metadata())
        })
        .await
        .map_err(|e| napi::Error::from_reason(e.to_string()))?
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        Ok(result)
    }

    /// Batch generate thumbnails
    ///
    /// # Arguments
    /// * `video_paths` - List of video file paths
    ///
    /// # Returns
    /// Vector of ThumbnailResults
    #[napi]
    pub async fn generate_batch(
        &self,
        video_paths: Vec<String>,
    ) -> napi::Result<Vec<ThumbnailResult>> {
        let mut results = Vec::new();

        for path in video_paths.iter() {
            let generator = self.generator.lock().await;

            let result = generator
                .generate(path, None)
                .await
                .unwrap_or_else(|e| ThumbnailResult {
                    success: false,
                    thumbnail_path: None,
                    width: 0,
                    height: 0,
                    format: "jpeg".to_string(),
                    file_size: 0,
                    timestamp: 0.0,
                    error: Some(e.to_string()),
                });

            results.push(result);
        }

        Ok(results)
    }

    /// Clear thumbnail cache
    #[napi]
    pub async fn clear_cache(&self) -> napi::Result<()> {
        let generator = self.generator.lock().await;
        generator
            .clear_cache()
            .await
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        Ok(())
    }

    /// Get cache statistics
    ///
    /// # Returns
    /// CacheStats with total thumbnails, size, and cache directory
    #[napi]
    pub async fn get_cache_stats(&self) -> napi::Result<CacheStats> {
        let generator = self.generator.lock().await;
        let (count, size, dir) = generator
            .get_cache_stats()
            .await
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        Ok(CacheStats {
            total_thumbnails: count,
            total_size_bytes: size,
            cache_dir: dir,
        })
    }
}

/// Standalone function to generate a single thumbnail (simpler API)
#[napi]
pub async fn generate_thumbnail_simple(
    video_path: String,
    output_path: String,
    timestamp: Option<f64>,
) -> napi::Result<ThumbnailResult> {
    let cache_dir = PathBuf::from(output_path)
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .to_path_buf();

    let generator = InnerGenerator::new(cache_dir, None);
    generator
        .initialize()
        .await
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let result = generator
        .generate(&video_path, timestamp)
        .await
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    Ok(result)
}

/// Check if FFmpeg is available on the system
#[napi]
pub fn is_ffmpeg_available() -> napi::Result<bool> {
    match ffmpeg_next::init() {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}
