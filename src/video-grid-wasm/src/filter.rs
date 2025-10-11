use crate::types::{FilterCriteria, VideoItem};
use ahash::AHashSet;

/// High-performance filtering engine
pub struct FilterEngine {
    favorite_ids: AHashSet<String>,
    hidden_ids: AHashSet<String>,
}

impl FilterEngine {
    pub fn new() -> Self {
        Self {
            favorite_ids: AHashSet::new(),
            hidden_ids: AHashSet::new(),
        }
    }

    pub fn update_favorites(&mut self, ids: Vec<String>) {
        self.favorite_ids.clear();
        self.favorite_ids.extend(ids);
    }

    pub fn update_hidden(&mut self, ids: Vec<String>) {
        self.hidden_ids.clear();
        self.hidden_ids.extend(ids);
    }

    /// Apply filters to video collection
    /// Returns indices of videos that pass the filter
    pub fn apply_filters(
        &self,
        videos: &[VideoItem],
        criteria: &FilterCriteria,
    ) -> Vec<usize> {
        videos
            .iter()
            .enumerate()
            .filter_map(|(idx, video)| {
                if self.matches_criteria(video, criteria) {
                    Some(idx)
                } else {
                    None
                }
            })
            .collect()
    }

    /// Fast filter check for a single video
    #[inline]
    fn matches_criteria(&self, video: &VideoItem, criteria: &FilterCriteria) -> bool {
        // Folder filter
        if let Some(ref folder) = criteria.folder {
            if video.folder.as_ref() != Some(folder) {
                return false;
            }
        }

        // Favorites filter
        if criteria.favorites_only && !self.favorite_ids.contains(&video.id) {
            return false;
        }

        // Hidden filter
        let is_hidden = self.hidden_ids.contains(&video.id);
        if criteria.hidden_only {
            // Show only hidden videos
            if !is_hidden {
                return false;
            }
        } else {
            // Normal mode: hide hidden videos unless show_hidden is true
            if is_hidden && !criteria.show_hidden {
                return false;
            }
        }

        true
    }

    /// Get videos that match the filter criteria
    pub fn filter_videos(
        &self,
        videos: &[VideoItem],
        criteria: &FilterCriteria,
    ) -> Vec<VideoItem> {
        videos
            .iter()
            .filter(|video| self.matches_criteria(video, criteria))
            .cloned()
            .collect()
    }
}

impl Default for FilterEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_video(id: &str, folder: Option<&str>, is_fav: bool, is_hidden: bool) -> VideoItem {
        VideoItem {
            id: id.to_string(),
            name: format!("video_{}", id),
            path: format!("/path/{}.mp4", id),
            folder: folder.map(|s| s.to_string()),
            size: 1024,
            last_modified: 0,
            duration: None,
            width: None,
            height: None,
            resolution: None,
            codec: None,
            bitrate: None,
            is_favorite: is_fav,
            is_hidden: is_hidden,
        }
    }

    #[test]
    fn test_folder_filter() {
        let mut engine = FilterEngine::new();
        let videos = vec![
            create_test_video("1", Some("folder1"), false, false),
            create_test_video("2", Some("folder2"), false, false),
            create_test_video("3", Some("folder1"), false, false),
        ];

        let criteria = FilterCriteria {
            folder: Some("folder1".to_string()),
            ..Default::default()
        };

        let filtered = engine.filter_videos(&videos, &criteria);
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].id, "1");
        assert_eq!(filtered[1].id, "3");
    }

    #[test]
    fn test_favorites_filter() {
        let mut engine = FilterEngine::new();
        engine.update_favorites(vec!["1".to_string(), "3".to_string()]);

        let videos = vec![
            create_test_video("1", None, true, false),
            create_test_video("2", None, false, false),
            create_test_video("3", None, true, false),
        ];

        let criteria = FilterCriteria {
            favorites_only: true,
            ..Default::default()
        };

        let filtered = engine.filter_videos(&videos, &criteria);
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn test_hidden_filter() {
        let mut engine = FilterEngine::new();
        engine.update_hidden(vec!["2".to_string()]);

        let videos = vec![
            create_test_video("1", None, false, false),
            create_test_video("2", None, false, true),
            create_test_video("3", None, false, false),
        ];

        // Normal mode: hide hidden videos
        let criteria = FilterCriteria {
            show_hidden: false,
            ..Default::default()
        };
        let filtered = engine.filter_videos(&videos, &criteria);
        assert_eq!(filtered.len(), 2);

        // Hidden only mode
        let criteria = FilterCriteria {
            hidden_only: true,
            ..Default::default()
        };
        let filtered = engine.filter_videos(&videos, &criteria);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "2");
    }
}
