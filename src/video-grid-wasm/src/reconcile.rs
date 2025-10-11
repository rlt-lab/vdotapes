use crate::types::{DomOperation, ReconciliationResult, VideoItem, Viewport};
use ahash::{AHashMap, AHashSet};

/// DOM reconciliation engine for incremental updates
pub struct DomReconciler {
    current_visible: Vec<String>,
    current_range: (usize, usize),
}

impl DomReconciler {
    pub fn new() -> Self {
        Self {
            current_visible: Vec::new(),
            current_range: (0, 0),
        }
    }

    /// Calculate minimal DOM operations needed to update the grid
    pub fn reconcile(
        &mut self,
        all_videos: &[VideoItem],
        filtered_indices: &[usize],
        viewport: &Viewport,
    ) -> ReconciliationResult {
        // Calculate new visible range
        let (start_idx, end_idx) = viewport.calculate_visible_range(filtered_indices.len());

        // Get new visible video IDs
        let new_visible: Vec<String> = filtered_indices[start_idx..end_idx]
            .iter()
            .map(|&idx| all_videos[idx].id.clone())
            .collect();

        // Calculate operations
        let operations = self.calculate_operations(&new_visible, start_idx);

        // Update state
        self.current_visible = new_visible;
        self.current_range = (start_idx, end_idx);

        ReconciliationResult {
            operations,
            total_items: filtered_indices.len(),
            visible_start: start_idx,
            visible_end: end_idx,
        }
    }

    /// Calculate minimal set of DOM operations
    fn calculate_operations(
        &self,
        new_visible: &[String],
        new_start_idx: usize,
    ) -> Vec<DomOperation> {
        let old_visible: AHashSet<&String> = self.current_visible.iter().collect();
        let new_visible_set: AHashSet<&String> = new_visible.iter().collect();

        let mut operations = Vec::new();

        // Find videos to remove (in old but not in new)
        for video_id in &self.current_visible {
            if !new_visible_set.contains(video_id) {
                operations.push(DomOperation::Remove {
                    video_id: video_id.clone(),
                });
            }
        }

        // Find videos to add (in new but not in old)
        for (i, video_id) in new_visible.iter().enumerate() {
            if !old_visible.contains(video_id) {
                operations.push(DomOperation::Add {
                    index: new_start_idx + i,
                    video_id: video_id.clone(),
                });
            }
        }

        // Find videos to move (in both but different position)
        let old_positions: AHashMap<&String, usize> =
            self.current_visible.iter().enumerate().map(|(i, id)| (id, i)).collect();

        for (new_pos, video_id) in new_visible.iter().enumerate() {
            if let Some(&old_pos) = old_positions.get(video_id) {
                if old_pos != new_pos {
                    operations.push(DomOperation::Move {
                        video_id: video_id.clone(),
                        from: old_pos,
                        to: new_pos,
                    });
                }
            }
        }

        operations
    }

    /// Get current visible video IDs
    pub fn get_visible_ids(&self) -> &[String] {
        &self.current_visible
    }

    /// Get current visible range
    pub fn get_visible_range(&self) -> (usize, usize) {
        self.current_range
    }

    /// Reset reconciler state
    pub fn reset(&mut self) {
        self.current_visible.clear();
        self.current_range = (0, 0);
    }
}

impl Default for DomReconciler {
    fn default() -> Self {
        Self::new()
    }
}

/// Helper to batch DOM operations for efficiency
pub struct OperationBatcher {
    adds: Vec<DomOperation>,
    removes: Vec<DomOperation>,
    moves: Vec<DomOperation>,
    updates: Vec<DomOperation>,
}

impl OperationBatcher {
    pub fn new() -> Self {
        Self {
            adds: Vec::new(),
            removes: Vec::new(),
            moves: Vec::new(),
            updates: Vec::new(),
        }
    }

    pub fn add_operation(&mut self, op: DomOperation) {
        match op {
            DomOperation::Add { .. } => self.adds.push(op),
            DomOperation::Remove { .. } => self.removes.push(op),
            DomOperation::Move { .. } => self.moves.push(op),
            DomOperation::Update { .. } => self.updates.push(op),
        }
    }

    /// Get operations in optimal execution order
    /// Order: Remove -> Move -> Update -> Add
    pub fn get_ordered_operations(mut self) -> Vec<DomOperation> {
        let mut operations = Vec::new();

        operations.append(&mut self.removes);
        operations.append(&mut self.moves);
        operations.append(&mut self.updates);
        operations.append(&mut self.adds);

        operations
    }
}

impl Default for OperationBatcher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_video(id: &str) -> VideoItem {
        VideoItem {
            id: id.to_string(),
            name: format!("video_{}", id),
            path: format!("/path/{}.mp4", id),
            folder: None,
            size: 1024,
            last_modified: 0,
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
    fn test_reconcile_add_videos() {
        let mut reconciler = DomReconciler::new();

        let videos = vec![
            create_test_video("1"),
            create_test_video("2"),
            create_test_video("3"),
        ];

        let indices = vec![0, 1, 2];

        let viewport = Viewport {
            scroll_top: 0.0,
            viewport_height: 600.0,
            item_height: 300.0,
            items_per_row: 3,
            buffer_rows: 1,
        };

        let result = reconciler.reconcile(&videos, &indices, &viewport);

        // Should add all 3 videos
        assert_eq!(
            result.operations.iter().filter(|op| matches!(op, DomOperation::Add { .. })).count(),
            3
        );
    }

    #[test]
    fn test_reconcile_remove_videos() {
        let mut reconciler = DomReconciler::new();

        let videos = vec![
            create_test_video("1"),
            create_test_video("2"),
            create_test_video("3"),
        ];

        // First reconcile with all videos
        let indices = vec![0, 1, 2];
        let viewport = Viewport {
            scroll_top: 0.0,
            viewport_height: 900.0,
            item_height: 300.0,
            items_per_row: 3,
            buffer_rows: 1,
        };

        reconciler.reconcile(&videos, &indices, &viewport);

        // Now scroll so only first video is visible
        let viewport2 = Viewport {
            scroll_top: 0.0,
            viewport_height: 300.0,
            item_height: 300.0,
            items_per_row: 3,
            buffer_rows: 0,
        };

        let result = reconciler.reconcile(&videos, &indices, &viewport2);

        // Should have remove operations for videos 2 and 3
        let removes = result.operations.iter().filter(|op| matches!(op, DomOperation::Remove { .. })).count();
        assert!(removes > 0);
    }

    #[test]
    fn test_operation_batching() {
        let mut batcher = OperationBatcher::new();

        batcher.add_operation(DomOperation::Add { index: 0, video_id: "1".to_string() });
        batcher.add_operation(DomOperation::Remove { video_id: "2".to_string() });
        batcher.add_operation(DomOperation::Move { video_id: "3".to_string(), from: 0, to: 1 });

        let operations = batcher.get_ordered_operations();

        // Verify order: Remove, Move, Add
        assert!(matches!(operations[0], DomOperation::Remove { .. }));
        assert!(matches!(operations[1], DomOperation::Move { .. }));
        assert!(matches!(operations[2], DomOperation::Add { .. }));
    }
}
