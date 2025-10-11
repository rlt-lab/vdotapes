use crate::types::{SortMode, VideoItem};

/// High-performance sorting engine with cached sort keys
pub struct SortEngine {
    mode: SortMode,
}

impl SortEngine {
    pub fn new(mode: SortMode) -> Self {
        Self { mode }
    }

    pub fn set_mode(&mut self, mode: SortMode) {
        self.mode = mode;
    }

    /// Sort videos by current mode
    /// Returns indices in sorted order for zero-copy sorting
    pub fn sort_indices(&self, videos: &[VideoItem]) -> Vec<usize> {
        let mut indices: Vec<usize> = (0..videos.len()).collect();

        match self.mode {
            SortMode::Folder => {
                self.sort_by_folder(&mut indices, videos);
            }
            SortMode::Date => {
                self.sort_by_date(&mut indices, videos);
            }
            SortMode::Shuffle => {
                // Fisher-Yates shuffle using js_sys::Math::random()
                self.fisher_yates_shuffle(&mut indices);
            }
            SortMode::None => {
                // Keep original order
            }
        }

        indices
    }

    /// Sort videos in place
    pub fn sort_videos(&self, videos: &mut [VideoItem]) {
        match self.mode {
            SortMode::Folder => {
                videos.sort_by(|a, b| {
                    // Sort by folder (ABC), then by date (newest first) within folder
                    let folder_cmp = self.compare_folders(a, b);
                    if folder_cmp != std::cmp::Ordering::Equal {
                        folder_cmp
                    } else {
                        // Within same folder, newest first
                        b.last_modified.cmp(&a.last_modified)
                    }
                });
            }
            SortMode::Date => {
                // Newest first
                videos.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
            }
            SortMode::Shuffle => {
                // For WASM: Use simpler shuffle (client will handle via JS)
                // Don't shuffle server-side to avoid rng issues
            }
            SortMode::None => {
                // No sorting
            }
        }
    }

    /// Sort by folder, then date within folder
    fn sort_by_folder(&self, indices: &mut [usize], videos: &[VideoItem]) {
        indices.sort_by(|&a, &b| {
            let video_a = &videos[a];
            let video_b = &videos[b];

            let folder_cmp = self.compare_folders(video_a, video_b);
            if folder_cmp != std::cmp::Ordering::Equal {
                folder_cmp
            } else {
                // Within same folder, newest first
                video_b.last_modified.cmp(&video_a.last_modified)
            }
        });
    }

    /// Sort by date (newest first)
    fn sort_by_date(&self, indices: &mut [usize], videos: &[VideoItem]) {
        indices.sort_by(|&a, &b| {
            videos[b].last_modified.cmp(&videos[a].last_modified)
        });
    }

    /// Compare folder names with null handling
    #[inline]
    fn compare_folders(&self, a: &VideoItem, b: &VideoItem) -> std::cmp::Ordering {
        match (&a.folder, &b.folder) {
            (Some(fa), Some(fb)) => fa.cmp(fb),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        }
    }

    /// Fisher-Yates shuffle (in-place)
    fn fisher_yates_shuffle(&self, slice: &mut [usize]) {
        for i in (1..slice.len()).rev() {
            // Use a simple deterministic "random" for now
            // In real usage, JS will handle shuffle
            let j = (i * 7919 + 31) % (i + 1);
            slice.swap(i, j);
        }
    }
}

impl Default for SortEngine {
    fn default() -> Self {
        Self::new(SortMode::Folder)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_video(id: &str, folder: Option<&str>, timestamp: u64) -> VideoItem {
        VideoItem {
            id: id.to_string(),
            name: format!("video_{}", id),
            path: format!("/path/{}.mp4", id),
            folder: folder.map(|s| s.to_string()),
            size: 1024,
            last_modified: timestamp,
            duration: None,
            width: None,
            height: None,
            resolution: None,
            codec: None,
            bitrate: None,
            is_favorite: false,
            is_hidden: false,
        }
    }

    #[test]
    fn test_sort_by_folder() {
        let mut videos = vec![
            create_test_video("1", Some("b_folder"), 100),
            create_test_video("2", Some("a_folder"), 200),
            create_test_video("3", Some("a_folder"), 300),
        ];

        let engine = SortEngine::new(SortMode::Folder);
        engine.sort_videos(&mut videos);

        // Should be sorted: a_folder (newer first), then b_folder
        assert_eq!(videos[0].id, "3"); // a_folder, timestamp 300
        assert_eq!(videos[1].id, "2"); // a_folder, timestamp 200
        assert_eq!(videos[2].id, "1"); // b_folder
    }

    #[test]
    fn test_sort_by_date() {
        let mut videos = vec![
            create_test_video("1", None, 100),
            create_test_video("2", None, 300),
            create_test_video("3", None, 200),
        ];

        let engine = SortEngine::new(SortMode::Date);
        engine.sort_videos(&mut videos);

        // Should be sorted by date, newest first
        assert_eq!(videos[0].id, "2"); // timestamp 300
        assert_eq!(videos[1].id, "3"); // timestamp 200
        assert_eq!(videos[2].id, "1"); // timestamp 100
    }

    #[test]
    fn test_sort_indices() {
        let videos = vec![
            create_test_video("1", None, 100),
            create_test_video("2", None, 300),
            create_test_video("3", None, 200),
        ];

        let engine = SortEngine::new(SortMode::Date);
        let indices = engine.sort_indices(&videos);

        // Indices should point to sorted order
        assert_eq!(indices[0], 1); // video 2
        assert_eq!(indices[1], 2); // video 3
        assert_eq!(indices[2], 0); // video 1
    }
}
