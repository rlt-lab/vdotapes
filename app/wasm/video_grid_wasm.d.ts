/* tslint:disable */
/* eslint-disable */

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


/**
 * Main video grid engine - high-performance grid management
 */
export class VideoGridEngine {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new video grid engine
   */
  constructor(max_active_videos: number);
  /**
   * Set all videos (replaces existing collection)
   */
  setVideos(videos_js: any): void;
  /**
   * Update favorites list
   */
  updateFavorites(favorites: string[]): void;
  /**
   * Update hidden files list
   */
  updateHidden(hidden: string[]): void;
  /**
   * Apply filters and return filtered video count
   */
  applyFilters(criteria_js: any): number;
  /**
   * Set sort mode and re-sort
   */
  setSortMode(mode: string): void;
  /**
   * Calculate viewport and return reconciliation result
   */
  calculateViewport(scroll_top: number, viewport_height: number, item_height: number, items_per_row: number, buffer_rows: number): any;
  /**
   * Get videos to load based on current viewport
   */
  getVideosToLoad(): string[];
  /**
   * Get videos to unload (LRU)
   */
  getVideosToUnload(max_loaded: number): string[];
  /**
   * Mark video as loaded
   */
  markVideoLoaded(video_id: string): void;
  /**
   * Mark video as error
   */
  markVideoError(video_id: string): void;
  /**
   * Get filtered videos (for rendering)
   */
  getFilteredVideos(): any;
  /**
   * Get visible range (for debugging)
   */
  getVisibleRange(): Uint32Array;
  /**
   * Get statistics
   */
  getStats(): any;
  /**
   * Clean up inactive videos
   */
  cleanup(inactive_threshold_ms: bigint): void;
  /**
   * Reset engine state
   */
  reset(): void;
}
/**
 * Video metadata for grid rendering
 */
export class VideoItem {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  size: bigint;
  last_modified: bigint;
  get duration(): number | undefined;
  set duration(value: number | null | undefined);
  get width(): number | undefined;
  set width(value: number | null | undefined);
  get height(): number | undefined;
  set height(value: number | null | undefined);
  get bitrate(): number | undefined;
  set bitrate(value: number | null | undefined);
  is_favorite: boolean;
  is_hidden: boolean;
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly folder: string | undefined;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_videoitem_free: (a: number, b: number) => void;
  readonly __wbg_get_videoitem_size: (a: number) => bigint;
  readonly __wbg_set_videoitem_size: (a: number, b: bigint) => void;
  readonly __wbg_get_videoitem_last_modified: (a: number) => bigint;
  readonly __wbg_set_videoitem_last_modified: (a: number, b: bigint) => void;
  readonly __wbg_get_videoitem_duration: (a: number, b: number) => void;
  readonly __wbg_set_videoitem_duration: (a: number, b: number, c: number) => void;
  readonly __wbg_get_videoitem_width: (a: number) => number;
  readonly __wbg_set_videoitem_width: (a: number, b: number) => void;
  readonly __wbg_get_videoitem_height: (a: number) => number;
  readonly __wbg_set_videoitem_height: (a: number, b: number) => void;
  readonly __wbg_get_videoitem_bitrate: (a: number) => number;
  readonly __wbg_set_videoitem_bitrate: (a: number, b: number) => void;
  readonly __wbg_get_videoitem_is_favorite: (a: number) => number;
  readonly __wbg_set_videoitem_is_favorite: (a: number, b: number) => void;
  readonly __wbg_get_videoitem_is_hidden: (a: number) => number;
  readonly __wbg_set_videoitem_is_hidden: (a: number, b: number) => void;
  readonly videoitem_id: (a: number, b: number) => void;
  readonly videoitem_name: (a: number, b: number) => void;
  readonly videoitem_path: (a: number, b: number) => void;
  readonly videoitem_folder: (a: number, b: number) => void;
  readonly __wbg_videogridengine_free: (a: number, b: number) => void;
  readonly videogridengine_new: (a: number) => number;
  readonly videogridengine_setVideos: (a: number, b: number, c: number) => void;
  readonly videogridengine_updateFavorites: (a: number, b: number, c: number) => void;
  readonly videogridengine_updateHidden: (a: number, b: number, c: number) => void;
  readonly videogridengine_applyFilters: (a: number, b: number, c: number) => void;
  readonly videogridengine_setSortMode: (a: number, b: number, c: number, d: number) => void;
  readonly videogridengine_calculateViewport: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
  readonly videogridengine_getVideosToLoad: (a: number, b: number) => void;
  readonly videogridengine_getVideosToUnload: (a: number, b: number, c: number) => void;
  readonly videogridengine_markVideoLoaded: (a: number, b: number, c: number) => void;
  readonly videogridengine_markVideoError: (a: number, b: number, c: number) => void;
  readonly videogridengine_getFilteredVideos: (a: number, b: number) => void;
  readonly videogridengine_getVisibleRange: (a: number, b: number) => void;
  readonly videogridengine_getStats: (a: number, b: number) => void;
  readonly videogridengine_cleanup: (a: number, b: bigint) => void;
  readonly videogridengine_reset: (a: number) => void;
  readonly __wbindgen_export_0: (a: number, b: number) => number;
  readonly __wbindgen_export_1: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_export_2: (a: number) => void;
  readonly __wbindgen_export_3: (a: number, b: number, c: number) => void;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
