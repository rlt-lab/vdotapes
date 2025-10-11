use ffmpeg_next as ffmpeg;
use crate::types::{ThumbnailError, VideoMetadata};

/// Video decoder for extracting frames
pub struct VideoDecoder {
    input: ffmpeg::format::context::Input,
    decoder: ffmpeg::decoder::Video,
    stream_index: usize,
    time_base: ffmpeg::Rational,
}

impl VideoDecoder {
    /// Open video file and prepare decoder
    pub fn new(path: &str) -> Result<Self, ThumbnailError> {
        // Initialize FFmpeg (safe to call multiple times)
        ffmpeg::init().map_err(|e| ThumbnailError::FFmpegError(e.to_string()))?;

        // Open format context
        let input = ffmpeg::format::input(&path)
            .map_err(|e| ThumbnailError::FFmpegError(format!("Failed to open video: {}", e)))?;

        // Find best video stream
        let video_stream = input
            .streams()
            .best(ffmpeg::media::Type::Video)
            .ok_or(ThumbnailError::NoVideoStream)?;

        let stream_index = video_stream.index();
        let time_base = video_stream.time_base();

        // Setup decoder
        let context_decoder = ffmpeg::codec::context::Context::from_parameters(video_stream.parameters())
            .map_err(|e| ThumbnailError::FFmpegError(e.to_string()))?;

        let decoder = context_decoder
            .decoder()
            .video()
            .map_err(|e| ThumbnailError::FFmpegError(e.to_string()))?;

        Ok(Self {
            input,
            decoder,
            stream_index,
            time_base,
        })
    }

    /// Get video metadata
    pub fn metadata(&self) -> VideoMetadata {
        let stream = self.input.stream(self.stream_index).unwrap();

        let duration = stream.duration() as f64 * f64::from(self.time_base);
        let width = self.decoder.width();
        let height = self.decoder.height();
        let codec = self.decoder.codec().map(|c| c.name().to_string()).unwrap_or_else(|| "unknown".to_string());
        let bitrate = self.decoder.bit_rate() as i64;

        // Calculate FPS
        let rate = stream.avg_frame_rate();
        let fps = if rate.denominator() > 0 {
            rate.numerator() as f64 / rate.denominator() as f64
        } else {
            30.0 // Default fallback
        };

        VideoMetadata {
            duration,
            width,
            height,
            codec,
            bitrate,
            fps,
        }
    }

    /// Seek to timestamp and decode frame
    pub fn decode_frame_at(&mut self, timestamp: f64) -> Result<ffmpeg::frame::Video, ThumbnailError> {
        // Convert timestamp to stream time base
        let seek_target = (timestamp / f64::from(self.time_base)) as i64;

        // Seek to timestamp
        self.input
            .seek(seek_target, ..seek_target)
            .map_err(|e| ThumbnailError::FFmpegError(format!("Seek failed: {}", e)))?;

        // Flush decoder
        self.decoder.flush();

        // Decode frames until we get a good one
        let mut frame_count = 0;
        const MAX_FRAMES: i32 = 30; // Prevent infinite loop

        for (stream, packet) in self.input.packets() {
            if stream.index() == self.stream_index {
                self.decoder
                    .send_packet(&packet)
                    .map_err(|e| ThumbnailError::FFmpegError(e.to_string()))?;

                let mut decoded = ffmpeg::frame::Video::empty();
                while self.decoder.receive_frame(&mut decoded).is_ok() {
                    // Check if frame is not blank/corrupted
                    if !is_blank_frame(&decoded) {
                        return Ok(decoded);
                    }

                    frame_count += 1;
                    if frame_count >= MAX_FRAMES {
                        break;
                    }
                }
            }
        }

        Err(ThumbnailError::NoValidFrame)
    }

    /// Get smart timestamp if none provided
    pub fn get_smart_timestamp(&self) -> f64 {
        let metadata = self.metadata();
        let duration = metadata.duration;

        // Try 10% into video (skip intros)
        let mut timestamp = duration * 0.1;

        // Ensure at least 1 second in, max 30 seconds
        timestamp = timestamp.max(1.0).min(30.0);

        // Don't exceed video duration
        timestamp = timestamp.min(duration - 1.0);

        timestamp
    }
}

/// Check if frame is mostly black/blank
fn is_blank_frame(frame: &ffmpeg::frame::Video) -> bool {
    // Simple check: if frame data exists and has reasonable size
    let data = frame.data(0);
    if data.len() < 100 {
        return true;
    }

    // Count black pixels (basic heuristic)
    let mut black_pixels = 0;
    let sample_size = 1000.min(data.len());

    for i in (0..sample_size).step_by(10) {
        if data[i] < 20 {
            black_pixels += 1;
        }
    }

    let black_ratio = black_pixels as f64 / (sample_size / 10) as f64;
    black_ratio > 0.9
}

/// Convert FFmpeg frame to RGB image
pub fn frame_to_rgb_image(
    frame: &ffmpeg::frame::Video,
) -> Result<image::RgbImage, ThumbnailError> {
    let width = frame.width();
    let height = frame.height();

    // Create scaler to convert to RGB24
    let mut scaler = ffmpeg::software::scaling::Context::get(
        frame.format(),
        width,
        height,
        ffmpeg::format::Pixel::RGB24,
        width,
        height,
        ffmpeg::software::scaling::Flags::BILINEAR,
    )
    .map_err(|e| ThumbnailError::FFmpegError(e.to_string()))?;

    // Convert frame
    let mut rgb_frame = ffmpeg::frame::Video::empty();
    scaler
        .run(frame, &mut rgb_frame)
        .map_err(|e| ThumbnailError::FFmpegError(e.to_string()))?;

    // Extract RGB data
    let data = rgb_frame.data(0);
    let stride = rgb_frame.stride(0);

    // Copy to image buffer
    let mut img_data = Vec::with_capacity((width * height * 3) as usize);

    for y in 0..height {
        let row_start = (y * stride as u32) as usize;
        let row_end = row_start + (width * 3) as usize;
        img_data.extend_from_slice(&data[row_start..row_end]);
    }

    image::RgbImage::from_raw(width, height, img_data)
        .ok_or_else(|| ThumbnailError::ImageError("Failed to create RGB image".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_blank_frame() {
        // This would require creating actual video frames
        // Skip for now - integration tests will cover this
    }
}
