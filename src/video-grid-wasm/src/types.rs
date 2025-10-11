use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Video metadata for grid rendering
#[derive(Debug, Clone, Serialize, Deserialize)]
#[wasm_bindgen]
pub struct VideoItem {
    #[wasm_bindgen(skip)]
    pub id: String,
    #[wasm_bindgen(skip)]
    pub name: String,
    #[wasm_bindgen(skip)]
    pub path: String,
    #[wasm_bindgen(skip)]
    pub folder: Option<String>,
    pub size: u64,
    pub last_modified: u64,
    pub duration: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    #[wasm_bindgen(skip)]
    pub resolution: Option<String>,
    #[wasm_bindgen(skip)]
    pub codec: Option<String>,
    pub bitrate: Option<u32>,
    pub is_favorite: bool,
    pub is_hidden: bool,
}

#[wasm_bindgen]
impl VideoItem {
    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        self.name.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn path(&self) -> String {
        self.path.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn folder(&self) -> Option<String> {
        self.folder.clone()
    }
}

/// Filter criteria for videos
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterCriteria {
    pub folder: Option<String>,
    pub favorites_only: bool,
    pub hidden_only: bool,
    pub show_hidden: bool,
}

impl Default for FilterCriteria {
    fn default() -> Self {
        Self {
            folder: None,
            favorites_only: false,
            hidden_only: false,
            show_hidden: false,
        }
    }
}

/// Sort mode for videos
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SortMode {
    Folder,
    Date,
    Shuffle,
    None,
}

/// Viewport information for virtual scrolling
#[derive(Debug, Clone, Copy)]
pub struct Viewport {
    pub scroll_top: f64,
    pub viewport_height: f64,
    pub item_height: f64,
    pub items_per_row: usize,
    pub buffer_rows: usize,
}

impl Viewport {
    pub fn calculate_visible_range(&self, total_items: usize) -> (usize, usize) {
        let total_rows = (total_items + self.items_per_row - 1) / self.items_per_row;

        // Calculate visible row range
        let start_row = (self.scroll_top / self.item_height).floor() as usize;
        let end_row = ((self.scroll_top + self.viewport_height) / self.item_height).ceil() as usize;

        // Add buffer
        let start_row = start_row.saturating_sub(self.buffer_rows);
        let end_row = (end_row + self.buffer_rows).min(total_rows);

        // Convert to item indices
        let start_index = start_row * self.items_per_row;
        let end_index = (end_row * self.items_per_row).min(total_items);

        (start_index, end_index)
    }
}

/// State of a video element in the DOM
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VideoState {
    NotLoaded,
    Loading,
    Loaded,
    Playing,
    Paused,
    Error,
}

/// Video element tracking for state management
#[derive(Debug, Clone)]
pub struct VideoElementState {
    pub video_id: String,
    pub state: VideoState,
    pub last_interaction: u64,
    pub is_in_viewport: bool,
    pub load_priority: u8,
}

impl VideoElementState {
    pub fn new(video_id: String) -> Self {
        Self {
            video_id,
            state: VideoState::NotLoaded,
            last_interaction: 0,
            is_in_viewport: false,
            load_priority: 0,
        }
    }
}

/// DOM operation for reconciliation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DomOperation {
    Add { index: usize, video_id: String },
    Remove { video_id: String },
    Move { video_id: String, from: usize, to: usize },
    Update { video_id: String, index: usize },
}

/// Result of DOM reconciliation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconciliationResult {
    pub operations: Vec<DomOperation>,
    pub total_items: usize,
    pub visible_start: usize,
    pub visible_end: usize,
}
