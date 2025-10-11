use std::path::PathBuf;
use image::{imageops, ImageFormat};
use crate::cache::ThumbnailCache;
use crate::ffmpeg::{VideoDecoder, frame_to_rgb_image};
use crate::types::{ThumbnailConfig, ThumbnailError, ThumbnailResult};

/// Thumbnail generator implementation
pub struct ThumbnailGenerator {
    config: ThumbnailConfig,
    cache: ThumbnailCache,
}

impl ThumbnailGenerator {
    /// Create a new thumbnail generator
    pub fn new(cache_dir: PathBuf, config: Option<ThumbnailConfig>) -> Self {
        let config = config.unwrap_or_default();

        // Default max cache size: 500MB
        let max_cache_size = 500 * 1024 * 1024;
        let cache = ThumbnailCache::new(cache_dir, max_cache_size);

        Self { config, cache }
    }

    /// Initialize the generator
    pub async fn initialize(&self) -> Result<(), ThumbnailError> {
        self.cache.initialize().await
    }

    /// Generate thumbnail from video
    pub async fn generate(
        &self,
        video_path: &str,
        timestamp: Option<f64>,
    ) -> Result<ThumbnailResult, ThumbnailError> {
        // Check if video file exists
        if !std::path::Path::new(video_path).exists() {
            return Ok(ThumbnailResult {
                success: false,
                thumbnail_path: None,
                width: 0,
                height: 0,
                format: self.config.format.clone(),
                file_size: 0,
                timestamp: 0.0,
                error: Some(format!("Video file not found: {}", video_path)),
            });
        }

        // Generate cache key
        let actual_timestamp = if let Some(ts) = timestamp {
            ts
        } else {
            // Get smart timestamp by opening video briefly
            let decoder = VideoDecoder::new(video_path)
                .map_err(|e| ThumbnailError::FFmpegError(e.to_string()))?;
            decoder.get_smart_timestamp()
        };

        let cache_key = ThumbnailCache::cache_key(video_path, actual_timestamp);

        // Check cache first
        if let Some(cached_path) = self.cache.get(&cache_key, &self.config.format).await {
            let file_size = tokio::fs::metadata(&cached_path)
                .await
                .map(|m| m.len() as i64)
                .unwrap_or(0);

            return Ok(ThumbnailResult {
                success: true,
                thumbnail_path: Some(cached_path.to_string_lossy().to_string()),
                width: self.config.width,
                height: self.config.height,
                format: self.config.format.clone(),
                file_size,
                timestamp: actual_timestamp,
                error: None,
            });
        }

        // Generate new thumbnail
        match self.generate_new_thumbnail(video_path, actual_timestamp, &cache_key).await {
            Ok(result) => Ok(result),
            Err(e) => Ok(ThumbnailResult {
                success: false,
                thumbnail_path: None,
                width: 0,
                height: 0,
                format: self.config.format.clone(),
                file_size: 0,
                timestamp: actual_timestamp,
                error: Some(e.to_string()),
            }),
        }
    }

    /// Generate new thumbnail (not cached)
    async fn generate_new_thumbnail(
        &self,
        video_path: &str,
        timestamp: f64,
        cache_key: &str,
    ) -> Result<ThumbnailResult, ThumbnailError> {
        // Open video and seek to timestamp
        let mut decoder = VideoDecoder::new(video_path)?;
        let frame = decoder.decode_frame_at(timestamp)?;

        // Convert to RGB image
        let rgb_image = frame_to_rgb_image(&frame)?;

        // Resize to target dimensions
        let resized = self.resize_frame(rgb_image);

        // Encode to target format
        let encoded_data = self.encode_image(&resized)?;

        // Save to cache
        let thumbnail_path = self
            .cache
            .put(cache_key, &self.config.format, &encoded_data)
            .await?;

        let file_size = encoded_data.len() as i64;

        Ok(ThumbnailResult {
            success: true,
            thumbnail_path: Some(thumbnail_path.to_string_lossy().to_string()),
            width: self.config.width,
            height: self.config.height,
            format: self.config.format.clone(),
            file_size,
            timestamp,
            error: None,
        })
    }

    /// Resize frame maintaining aspect ratio
    fn resize_frame(&self, image: image::RgbImage) -> image::RgbImage {
        let (orig_width, orig_height) = image.dimensions();
        let target_width = self.config.width;
        let target_height = self.config.height;

        // Calculate aspect ratios
        let orig_aspect = orig_width as f32 / orig_height as f32;
        let target_aspect = target_width as f32 / target_height as f32;

        let (new_width, new_height) = if orig_aspect > target_aspect {
            // Original is wider - fit to width
            let new_width = target_width;
            let new_height = (target_width as f32 / orig_aspect) as u32;
            (new_width, new_height)
        } else {
            // Original is taller - fit to height
            let new_height = target_height;
            let new_width = (target_height as f32 * orig_aspect) as u32;
            (new_width, new_height)
        };

        // Resize using high-quality Lanczos3 filter
        imageops::resize(&image, new_width, new_height, imageops::FilterType::Lanczos3)
    }

    /// Encode image to target format
    fn encode_image(&self, image: &image::RgbImage) -> Result<Vec<u8>, ThumbnailError> {
        let mut buffer = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut buffer);

        match self.config.format.to_lowercase().as_str() {
            "jpeg" | "jpg" => {
                let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
                    &mut cursor,
                    self.config.quality,
                );
                let (width, height) = image.dimensions();
                encoder
                    .encode(
                        image.as_raw(),
                        width,
                        height,
                        image::ColorType::Rgb8.into(),
                    )
                    .map_err(|e| ThumbnailError::EncodingError(e.to_string()))?;
            }
            "png" => {
                image::DynamicImage::ImageRgb8(image.clone())
                    .write_to(&mut cursor, ImageFormat::Png)
                    .map_err(|e| ThumbnailError::EncodingError(e.to_string()))?;
            }
            "webp" => {
                // WebP support requires additional feature
                // Fall back to JPEG for now
                let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
                    &mut cursor,
                    self.config.quality,
                );
                let (width, height) = image.dimensions();
                encoder
                    .encode(
                        image.as_raw(),
                        width,
                        height,
                        image::ColorType::Rgb8.into(),
                    )
                    .map_err(|e| ThumbnailError::EncodingError(e.to_string()))?;
            }
            _ => {
                return Err(ThumbnailError::EncodingError(format!(
                    "Unsupported format: {}",
                    self.config.format
                )));
            }
        }

        Ok(buffer)
    }

    /// Get thumbnail path from cache (doesn't generate)
    pub async fn get_thumbnail_path(
        &self,
        video_path: &str,
        timestamp: Option<f64>,
    ) -> Option<String> {
        let actual_timestamp = timestamp.unwrap_or(0.0);
        let cache_key = ThumbnailCache::cache_key(video_path, actual_timestamp);

        self.cache
            .get(&cache_key, &self.config.format)
            .await
            .map(|p| p.to_string_lossy().to_string())
    }

    /// Clear thumbnail cache
    pub async fn clear_cache(&self) -> Result<(), ThumbnailError> {
        self.cache.clear_all().await
    }

    /// Get cache statistics
    pub async fn get_cache_stats(&self) -> Result<(i32, i64, String), ThumbnailError> {
        let (count, size) = self.cache.get_stats().await?;
        let cache_dir = self.cache.get_cache_dir().to_string_lossy().to_string();

        Ok((count, size, cache_dir))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resize_aspect_ratio() {
        // Test with wider image
        let img = image::RgbImage::new(1920, 1080);
        let config = ThumbnailConfig {
            width: 1280,
            height: 720,
            quality: 85,
            format: "jpeg".to_string(),
        };

        let generator = ThumbnailGenerator::new(
            PathBuf::from("/tmp/test"),
            Some(config),
        );

        let resized = generator.resize_frame(img);
        assert_eq!(resized.width(), 1280);
        assert!(resized.height() <= 720);
    }
}
