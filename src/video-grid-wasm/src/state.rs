use crate::types::VideoElementState;
use ahash::AHashMap;
use std::collections::VecDeque;

// Re-export VideoState for internal use
pub(crate) use crate::types::VideoState;

/// LRU cache for video element states
pub struct VideoStateManager {
    states: AHashMap<String, VideoElementState>,
    lru_queue: VecDeque<String>,
    max_active: usize,
    current_time: u64,
}

impl VideoStateManager {
    pub fn new(max_active: usize) -> Self {
        Self {
            states: AHashMap::new(),
            lru_queue: VecDeque::with_capacity(max_active),
            max_active,
            current_time: 0,
        }
    }

    /// Register a video element
    pub fn register(&mut self, video_id: String) -> &mut VideoElementState {
        if !self.states.contains_key(&video_id) {
            let state = VideoElementState::new(video_id.clone());
            self.states.insert(video_id.clone(), state);
            self.lru_queue.push_back(video_id.clone());

            // Enforce max active limit
            if self.lru_queue.len() > self.max_active {
                if let Some(old_id) = self.lru_queue.pop_front() {
                    if let Some(state) = self.states.get_mut(&old_id) {
                        // Mark as inactive but don't remove
                        state.state = VideoState::Paused;
                        state.is_in_viewport = false;
                    }
                }
            }
        }

        self.states.get_mut(&video_id).unwrap()
    }

    /// Get state for a video
    pub fn get_state(&self, video_id: &str) -> Option<&VideoElementState> {
        self.states.get(video_id)
    }

    /// Get mutable state for a video
    pub fn get_state_mut(&mut self, video_id: &str) -> Option<&mut VideoElementState> {
        self.states.get_mut(video_id)
    }

    /// Update video state
    pub fn update_state(&mut self, video_id: &str, new_state: VideoState) {
        if let Some(state) = self.states.get_mut(video_id) {
            state.state = new_state;
            state.last_interaction = self.current_time;

            // Move to back of LRU queue if it exists
            if let Some(pos) = self.lru_queue.iter().position(|id| id == video_id) {
                self.lru_queue.remove(pos);
                self.lru_queue.push_back(video_id.to_string());
            }
        }
    }

    /// Mark video as in viewport
    pub fn mark_in_viewport(&mut self, video_id: &str, in_viewport: bool) {
        if let Some(state) = self.states.get_mut(video_id) {
            state.is_in_viewport = in_viewport;
            state.last_interaction = self.current_time;

            if in_viewport {
                // Increase priority for videos in viewport
                state.load_priority = 10;

                // Move to back of LRU queue
                if let Some(pos) = self.lru_queue.iter().position(|id| id == video_id) {
                    self.lru_queue.remove(pos);
                    self.lru_queue.push_back(video_id.to_string());
                }
            } else {
                state.load_priority = 0;
            }
        }
    }

    /// Get videos that should be unloaded (LRU policy)
    pub fn get_videos_to_unload(&self, max_loaded: usize) -> Vec<String> {
        let loaded_count = self.states.values()
            .filter(|s| matches!(s.state, VideoState::Loaded | VideoState::Playing))
            .count();

        if loaded_count <= max_loaded {
            return Vec::new();
        }

        let to_unload_count = loaded_count - max_loaded;

        // Get loaded videos sorted by LRU (oldest first)
        let mut loaded_videos: Vec<_> = self.lru_queue
            .iter()
            .filter(|id| {
                self.states.get(*id)
                    .map(|s| matches!(s.state, VideoState::Loaded | VideoState::Playing) && !s.is_in_viewport)
                    .unwrap_or(false)
            })
            .take(to_unload_count)
            .cloned()
            .collect();

        loaded_videos.truncate(to_unload_count);
        loaded_videos
    }

    /// Get videos that should be loaded (in viewport but not loaded)
    pub fn get_videos_to_load(&self, visible_ids: &[String]) -> Vec<String> {
        visible_ids
            .iter()
            .filter(|id| {
                self.states.get(*id)
                    .map(|s| matches!(s.state, VideoState::NotLoaded))
                    .unwrap_or(true)
            })
            .cloned()
            .collect()
    }

    /// Cleanup videos that are far out of viewport
    pub fn cleanup_inactive(&mut self, inactive_threshold: u64) {
        let current_time = self.current_time;

        // Find videos to remove
        let to_remove: Vec<String> = self.states
            .iter()
            .filter(|(_, state)| {
                !state.is_in_viewport &&
                current_time - state.last_interaction > inactive_threshold
            })
            .map(|(id, _)| id.clone())
            .collect();

        // Remove them
        for id in to_remove {
            self.states.remove(&id);
            if let Some(pos) = self.lru_queue.iter().position(|vid| vid == &id) {
                self.lru_queue.remove(pos);
            }
        }
    }

    /// Increment time (for tracking interactions)
    pub fn tick(&mut self) {
        self.current_time += 1;
    }

    /// Get statistics
    pub fn get_stats(&self) -> StateStats {
        let mut stats = StateStats::default();

        for state in self.states.values() {
            stats.total += 1;
            match state.state {
                VideoState::NotLoaded => stats.not_loaded += 1,
                VideoState::Loading => stats.loading += 1,
                VideoState::Loaded => stats.loaded += 1,
                VideoState::Playing => stats.playing += 1,
                VideoState::Paused => stats.paused += 1,
                VideoState::Error => stats.error += 1,
            }

            if state.is_in_viewport {
                stats.in_viewport += 1;
            }
        }

        stats
    }

    /// Clear all states
    pub fn clear(&mut self) {
        self.states.clear();
        self.lru_queue.clear();
        self.current_time = 0;
    }
}

#[derive(Debug, Default)]
pub struct StateStats {
    pub total: usize,
    pub not_loaded: usize,
    pub loading: usize,
    pub loaded: usize,
    pub playing: usize,
    pub paused: usize,
    pub error: usize,
    pub in_viewport: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lru_eviction() {
        let mut manager = VideoStateManager::new(3);

        // Register 4 videos
        manager.register("video1".to_string());
        manager.register("video2".to_string());
        manager.register("video3".to_string());
        manager.register("video4".to_string());

        // LRU queue should have max 3 items (oldest evicted)
        assert_eq!(manager.lru_queue.len(), 4); // We don't remove, just mark inactive
    }

    #[test]
    fn test_viewport_priority() {
        let mut manager = VideoStateManager::new(10);

        manager.register("video1".to_string());
        manager.mark_in_viewport("video1", true);

        let state = manager.get_state("video1").unwrap();
        assert!(state.is_in_viewport);
        assert_eq!(state.load_priority, 10);
    }

    #[test]
    fn test_videos_to_unload() {
        let mut manager = VideoStateManager::new(10);

        // Create 5 loaded videos
        for i in 1..=5 {
            let id = format!("video{}", i);
            manager.register(id.clone());
            manager.update_state(&id, VideoState::Loaded);
        }

        // Mark first 2 as in viewport
        manager.mark_in_viewport("video1", true);
        manager.mark_in_viewport("video2", true);

        // Ask to keep only 3 loaded
        let to_unload = manager.get_videos_to_unload(3);

        // Should unload 2 videos (not in viewport, oldest first)
        assert_eq!(to_unload.len(), 2);
    }
}
