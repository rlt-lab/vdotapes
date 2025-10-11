use serde::{Deserialize, Serialize};

/// Represents metadata for a video file
#[napi_derive::napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoMetadata {
    pub id: String,
    pub name: String,
    pub path: String,
    pub folder: String,
    pub size: f64,
    pub last_modified: f64,
    pub created: f64,
    pub added_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}

/// Result of scanning a directory for videos
#[napi_derive::napi(object)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ScanResult {
    pub success: bool,
    pub videos: Vec<VideoMetadata>,
    pub folders: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<ScanStats>,
}

/// Statistics about a scan operation
#[napi_derive::napi(object)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ScanStats {
    pub total_files: u32,
    pub valid_videos: u32,
    pub duplicates: u32,
    pub errors: u32,
}

/// Progress information during scanning
#[napi_derive::napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    pub is_scanning: bool,
    pub progress: f64,
    pub processed_files: u32,
    pub total_files: u32,
    pub total_videos: u32,
}

/// Supported video file extensions
pub const VIDEO_EXTENSIONS: &[&str] = &[
    ".mp4", ".webm", ".ogg", ".mov", ".avi", ".wmv", ".flv", ".mkv", ".m4v",
];

/// System file prefix to exclude
pub const SYSTEM_FILE_PREFIX: &str = "._";

/// Directories to exclude from scanning
pub const EXCLUDED_DIRECTORIES: &[&str] = &[".", "node_modules"];

/// Check if a filename represents a valid video file
pub fn is_valid_video_file(filename: &str) -> bool {
    if filename.starts_with(SYSTEM_FILE_PREFIX) {
        return false;
    }

    let lowercase = filename.to_lowercase();
    VIDEO_EXTENSIONS
        .iter()
        .any(|ext| lowercase.ends_with(ext))
}

/// Generate a unique ID for a video based on path, size, and modification time
/// Matches TypeScript implementation: hash(filename_size_lastModified).toString(36)
pub fn generate_video_id(filename: &str, size: f64, last_modified: f64) -> String {
    let str_to_hash = format!("{}_{}_{}   ", filename, size as u64, last_modified as i64);
    let hash = simple_hash(&str_to_hash);
    base36_encode(hash)
}

/// Simple hash function matching TypeScript implementation
/// TypeScript: hash = ((hash << 5) - hash + char) & hash
fn simple_hash(s: &str) -> u32 {
    let mut hash: i32 = 0;
    for ch in s.chars() {
        let char_code = ch as i32;
        hash = ((hash << 5).wrapping_sub(hash)).wrapping_add(char_code);
        hash &= hash; // Bitwise AND with itself (matches TypeScript's & hash)
    }
    hash.abs() as u32
}

/// Encode a number in base-36 (0-9, a-z) to match JavaScript's toString(36)
fn base36_encode(mut num: u32) -> String {
    if num == 0 {
        return "0".to_string();
    }

    const CHARS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut result = Vec::new();

    while num > 0 {
        result.push(CHARS[(num % 36) as usize]);
        num /= 36;
    }

    result.reverse();
    String::from_utf8(result).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_video_file() {
        // Valid video files
        assert!(is_valid_video_file("video.mp4"));
        assert!(is_valid_video_file("movie.MKV"));
        assert!(is_valid_video_file("clip.webm"));
        assert!(is_valid_video_file("film.MOV"));
        assert!(is_valid_video_file("recording.avi"));
        assert!(is_valid_video_file("test.wmv"));
        assert!(is_valid_video_file("stream.flv"));
        assert!(is_valid_video_file("media.mkv"));
        assert!(is_valid_video_file("video.m4v"));
        assert!(is_valid_video_file("sound.ogg"));

        // Invalid files
        assert!(!is_valid_video_file("._hidden.mp4"));
        assert!(!is_valid_video_file("._system.mov"));
        assert!(!is_valid_video_file("document.pdf"));
        assert!(!is_valid_video_file("image.png"));
        assert!(!is_valid_video_file("text.txt"));
        assert!(!is_valid_video_file("archive.zip"));
    }

    #[test]
    fn test_generate_video_id_consistency() {
        // Same inputs should produce same ID
        let id1 = generate_video_id("test.mp4", 1024.0, 1234567890.0);
        let id2 = generate_video_id("test.mp4", 1024.0, 1234567890.0);
        assert_eq!(id1, id2, "Same inputs should produce same ID");
    }

    #[test]
    fn test_generate_video_id_uniqueness() {
        // Different inputs should produce different IDs
        let id1 = generate_video_id("test.mp4", 1024.0, 1234567890.0);
        let id2 = generate_video_id("test.mp4", 2048.0, 1234567890.0); // Different size
        let id3 = generate_video_id("test.mp4", 1024.0, 9876543210.0); // Different time
        let id4 = generate_video_id("other.mp4", 1024.0, 1234567890.0); // Different name

        assert_ne!(id1, id2, "Different size should produce different ID");
        assert_ne!(id1, id3, "Different timestamp should produce different ID");
        assert_ne!(id1, id4, "Different filename should produce different ID");
    }

    #[test]
    fn test_base36_encoding() {
        // Test base-36 encoding
        assert_eq!(base36_encode(0), "0");
        assert_eq!(base36_encode(35), "z");
        assert_eq!(base36_encode(36), "10");
        assert_eq!(base36_encode(1000), "rs");
    }

    #[test]
    fn test_simple_hash() {
        // Test hash function produces consistent results
        let hash1 = simple_hash("test");
        let hash2 = simple_hash("test");
        assert_eq!(hash1, hash2, "Hash should be consistent");

        // Different strings should (likely) produce different hashes
        let hash3 = simple_hash("different");
        assert_ne!(hash1, hash3, "Different strings should produce different hashes");
    }

    #[test]
    fn test_video_id_format() {
        // Verify ID is in base-36 format (only 0-9 and a-z)
        let id = generate_video_id("test.mp4", 1024.0, 1234567890.0);
        assert!(
            id.chars().all(|c| c.is_ascii_digit() || ('a'..='z').contains(&c)),
            "ID should only contain 0-9 and a-z"
        );
    }
}
