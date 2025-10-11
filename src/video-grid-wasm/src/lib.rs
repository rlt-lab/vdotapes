mod filter;
mod reconcile;
mod sort;
mod state;
mod types;

use filter::FilterEngine;
use reconcile::DomReconciler;
use sort::SortEngine;
use state::{VideoStateManager, VideoState};
use types::{FilterCriteria, SortMode, VideoItem, Viewport};

use wasm_bindgen::prelude::*;
use serde_wasm_bindgen::{from_value, to_value};

/// Main video grid engine - high-performance grid management
#[wasm_bindgen]
pub struct VideoGridEngine {
    videos: Vec<VideoItem>,
    filtered_indices: Vec<usize>,
    filter_engine: FilterEngine,
    sort_engine: SortEngine,
    reconciler: DomReconciler,
    state_manager: VideoStateManager,
}

#[wasm_bindgen]
impl VideoGridEngine {
    /// Create a new video grid engine
    #[wasm_bindgen(constructor)]
    pub fn new(max_active_videos: usize) -> Self {
        // Set panic hook for better error messages
        #[cfg(feature = "console_error_panic_hook")]
        console_error_panic_hook::set_once();

        Self {
            videos: Vec::new(),
            filtered_indices: Vec::new(),
            filter_engine: FilterEngine::new(),
            sort_engine: SortEngine::new(SortMode::Folder),
            reconciler: DomReconciler::new(),
            state_manager: VideoStateManager::new(max_active_videos),
        }
    }

    /// Set all videos (replaces existing collection)
    #[wasm_bindgen(js_name = setVideos)]
    pub fn set_videos(&mut self, videos_js: JsValue) -> Result<(), JsValue> {
        let videos: Vec<VideoItem> = from_value(videos_js)?;
        self.videos = videos;
        self.filtered_indices = (0..self.videos.len()).collect();
        Ok(())
    }

    /// Update favorites list
    #[wasm_bindgen(js_name = updateFavorites)]
    pub fn update_favorites(&mut self, favorites: Vec<String>) {
        self.filter_engine.update_favorites(favorites);
    }

    /// Update hidden files list
    #[wasm_bindgen(js_name = updateHidden)]
    pub fn update_hidden(&mut self, hidden: Vec<String>) {
        self.filter_engine.update_hidden(hidden);
    }

    /// Apply filters and return filtered video count
    #[wasm_bindgen(js_name = applyFilters)]
    pub fn apply_filters(&mut self, criteria_js: JsValue) -> Result<usize, JsValue> {
        let criteria: FilterCriteria = from_value(criteria_js)?;
        self.filtered_indices = self.filter_engine.apply_filters(&self.videos, &criteria);
        Ok(self.filtered_indices.len())
    }

    /// Set sort mode and re-sort
    #[wasm_bindgen(js_name = setSortMode)]
    pub fn set_sort_mode(&mut self, mode: String) -> Result<(), JsValue> {
        let sort_mode = match mode.as_str() {
            "folder" => SortMode::Folder,
            "date" => SortMode::Date,
            "shuffle" => SortMode::Shuffle,
            _ => SortMode::None,
        };

        self.sort_engine.set_mode(sort_mode);

        // Re-sort filtered indices
        if !self.filtered_indices.is_empty() {
            let mut filtered_videos: Vec<VideoItem> = self.filtered_indices
                .iter()
                .map(|&idx| self.videos[idx].clone())
                .collect();

            self.sort_engine.sort_videos(&mut filtered_videos);

            // Update indices to match sorted order
            self.filtered_indices = filtered_videos
                .iter()
                .filter_map(|v| self.videos.iter().position(|video| video.id == v.id))
                .collect();
        }

        Ok(())
    }

    /// Calculate viewport and return reconciliation result
    #[wasm_bindgen(js_name = calculateViewport)]
    pub fn calculate_viewport(
        &mut self,
        scroll_top: f64,
        viewport_height: f64,
        item_height: f64,
        items_per_row: usize,
        buffer_rows: usize,
    ) -> Result<JsValue, JsValue> {
        let viewport = Viewport {
            scroll_top,
            viewport_height,
            item_height,
            items_per_row,
            buffer_rows,
        };

        let result = self.reconciler.reconcile(
            &self.videos,
            &self.filtered_indices,
            &viewport,
        );

        // Update state manager with visible videos
        let visible_ids: Vec<String> = self.reconciler.get_visible_ids().to_vec();
        for id in &visible_ids {
            self.state_manager.mark_in_viewport(id, true);
        }

        // Mark non-visible videos
        for video in &self.videos {
            if !visible_ids.contains(&video.id) {
                self.state_manager.mark_in_viewport(&video.id, false);
            }
        }

        self.state_manager.tick();

        to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Get videos to load based on current viewport
    #[wasm_bindgen(js_name = getVideosToLoad)]
    pub fn get_videos_to_load(&self) -> Vec<String> {
        let visible_ids: Vec<String> = self.reconciler.get_visible_ids().to_vec();
        self.state_manager.get_videos_to_load(&visible_ids)
    }

    /// Get videos to unload (LRU)
    #[wasm_bindgen(js_name = getVideosToUnload)]
    pub fn get_videos_to_unload(&self, max_loaded: usize) -> Vec<String> {
        self.state_manager.get_videos_to_unload(max_loaded)
    }

    /// Mark video as loaded
    #[wasm_bindgen(js_name = markVideoLoaded)]
    pub fn mark_video_loaded(&mut self, video_id: String) {
        self.state_manager.update_state(&video_id, VideoState::Loaded);
    }

    /// Mark video as error
    #[wasm_bindgen(js_name = markVideoError)]
    pub fn mark_video_error(&mut self, video_id: String) {
        self.state_manager.update_state(&video_id, VideoState::Error);
    }

    /// Get filtered videos (for rendering)
    #[wasm_bindgen(js_name = getFilteredVideos)]
    pub fn get_filtered_videos(&self) -> Result<JsValue, JsValue> {
        let filtered: Vec<&VideoItem> = self.filtered_indices
            .iter()
            .map(|&idx| &self.videos[idx])
            .collect();

        to_value(&filtered).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Get visible range (for debugging)
    #[wasm_bindgen(js_name = getVisibleRange)]
    pub fn get_visible_range(&self) -> Vec<usize> {
        let (start, end) = self.reconciler.get_visible_range();
        vec![start, end]
    }

    /// Get statistics
    #[wasm_bindgen(js_name = getStats)]
    pub fn get_stats(&self) -> Result<JsValue, JsValue> {
        let state_stats = self.state_manager.get_stats();

        let stats = serde_json::json!({
            "totalVideos": self.videos.len(),
            "filteredVideos": self.filtered_indices.len(),
            "visibleVideos": self.reconciler.get_visible_ids().len(),
            "loadedVideos": state_stats.loaded + state_stats.playing,
            "inViewport": state_stats.in_viewport,
        });

        to_value(&stats).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Clean up inactive videos
    #[wasm_bindgen(js_name = cleanup)]
    pub fn cleanup(&mut self, inactive_threshold_ms: u64) {
        self.state_manager.cleanup_inactive(inactive_threshold_ms);
    }

    /// Reset engine state
    #[wasm_bindgen(js_name = reset)]
    pub fn reset(&mut self) {
        self.videos.clear();
        self.filtered_indices.clear();
        self.reconciler.reset();
        self.state_manager.clear();
    }
}

/// Utility function to log to console (for debugging)
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

// Re-export key types for JavaScript
#[wasm_bindgen(typescript_custom_section)]
const TYPESCRIPT_TYPES: &'static str = r#"
export interface VideoItem {
    id: string;
    name: string;
    path: string;
    folder?: string;
    size: number;
    last_modified: number;
    duration?: number;
    width?: number;
    height?: number;
    resolution?: string;
    codec?: string;
    bitrate?: number;
    is_favorite: boolean;
    is_hidden: boolean;
}

export interface FilterCriteria {
    folder?: string;
    favorites_only: boolean;
    hidden_only: boolean;
    show_hidden: boolean;
}

export interface DomOperation {
    type: 'Add' | 'Remove' | 'Move' | 'Update';
    video_id: string;
    index?: number;
    from?: number;
    to?: number;
}

export interface ReconciliationResult {
    operations: DomOperation[];
    total_items: number;
    visible_start: number;
    visible_end: number;
}

export interface GridStats {
    totalVideos: number;
    filteredVideos: number;
    visibleVideos: number;
    loadedVideos: number;
    inViewport: number;
}
"#;
