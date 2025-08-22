# Feature Tasks

Prioritized roadmap to implement requested features. Tagging and backup are highest priority.

## Phase 0 — Prep & Discovery
- [x] Review current data model in `src/database.js` (tables, indexes, WAL mode).
- [x] Confirm where folder name and file path are stored; ensure we have `video.id`, `video.path`, `video.folder` (or derive folder from path).
- [x] Decide migration strategy (use existing `settings.schema_version` with sequential migrations + `CREATE TABLE IF NOT EXISTS`).
- [ ] Add `schema_version` table (optional) for controlled migrations.

## Phase 1 — Tagging System (Highest Priority)
Schema
- [x] Add `tags` table: `id INTEGER PK`, `name TEXT UNIQUE COLLATE NOCASE`.
- [x] Add `video_tags` table: `video_id INTEGER`, `tag_id INTEGER`, `PRIMARY KEY(video_id, tag_id)`.
- [x] Indexes: `CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name)`, `CREATE INDEX IF NOT EXISTS idx_vt_video ON video_tags(video_id)`, `idx_vt_tag ON video_tags(tag_id)`.

IPC & Backend
- [x] Add IPC handlers in `src/ipc-handlers.js`:
  - [x] `tags:add(videoId, tagName)` → upsert tag, link in `video_tags`.
  - [x] `tags:remove(videoId, tagName)` → unlink.
  - [x] `tags:list(videoId)` → list tag names for a video.
  - [x] `tags:all()` → list all tags with usage counts.
  - [x] `tags:search(tagQuery)` → returns video ids/metadata matching any tag LIKE `%query%`.
- [x] Update `src/database.js` with discrete helpers (pure functions) used by IPC.

Renderer UI
- [x] Add lightweight Tag UI in fullscreen overlay (see Phase 5) with input + add and removable chips.
- [ ] Add optional tag filter control in the toolbar (multi-select chips or autocomplete).
- [x] Debounce tag entry; Enter adds; Backspace deletes last pending.

Querying & Display
- [ ] Extend listing queries to optionally filter by one or more tags (intersection when multiple selected).
- [ ] Update `app/renderer.js` filtering pipeline to combine existing folder/sort with tag filters.
- [ ] Update `src/query-cache.js` if needed to cache tag lookups.

Docs & QA
- [ ] Document schema and IPC in `docs/03-database-indexing.md` or new `docs/tags.md`.
- [ ] Manual QA: add/remove tags, filter by tags, performance with 1k+ videos.

## Phase 2 — Search (Subfolders + Tags)
Backend
- [ ] Ensure each video row persists folder name (derive from `path` if not present).
- [ ] Add IPC `search:videos(term)` → videos where `folder LIKE %term%` OR `tag LIKE %term%` (join `video_tags`/`tags`). Case-insensitive.
- [ ] Add indexes on folder column if needed: `idx_videos_folder`.

Renderer
- [ ] Add search box in toolbar with debounced input (250ms).
- [ ] Live results list or direct filtering of grid; highlight matched text.
- [ ] Empty-state when no matches; ESC clears search.

QA
- [ ] Verify substring matches (last-name searches) across all subfolders.
- [ ] Verify tag matches combine with current folder/tag filters as expected.

## Phase 3 — Hide Function
Schema
- [x] Use existing `hidden_files` table with `video_id` PK; no column needed.

IPC
- [x] Handlers exist: `save-hidden-file` and `get-hidden-files` for toggling and retrieval.
- [x] Filtering defaults exclude hidden (renderer logic).

Renderer
- [x] Toggle button `Show Hidden` switches to Hidden Only mode.
- [x] Hidden-only view shows only hidden items; normal mode excludes them.
- [x] Hide/unhide action available via context menu and sidebar button.

QA
- [x] Hidden videos excluded unless toggle active; Hidden Only shows only hidden.

## Phase 4 — Backup & Restore (Highest Priority)
Format & Strategy
- [x] Define JSON backup schema with `version`, `exportedAt`, and arrays keyed by video `path`: `{ path, favorite: bool, hidden: bool, rating, tags: [] }`.
- [x] Prefer matching by absolute file path; fallback to filename + size if path missing.

IPC
- [x] Export with dialog → `backup-export-file` handler writes JSON via `dialog.showSaveDialog`.
- [x] Import with dialog → `backup-import-file` handler reads JSON via `dialog.showOpenDialog`.
- [x] Validate input; safe-guard large imports in a transaction.

Renderer
- [x] Add Settings actions: `Export Backup`, `Import Backup` with status updates and summary.

QA
- [ ] Round-trip test: make changes, export, wipe flags/tags locally, import, verify full restore.
- [ ] Corrupt file handling and version mismatch warnings.

## Phase 5 — Fullscreen Options Menu
UI/UX
- [x] Add right-side overlay when a video enters fullscreen.
- [x] Show: Favorite toggle, Hidden toggle, Tag input + chips, Current tags list.
- [x] Metadata: Subfolder name, video length (e.g., `georgia bell, 5s`), filename.
- [x] Actions: `Go To File` → shell reveal (IPC uses `shell.showItemInFolder`).

Implementation
- [x] Add overlay component and styles (`app/index.html`, `app/styles.css`).
- [x] Wire IPC to favorite/hidden/tag endpoints.
- [x] Display metadata from current video; duration uses existing field when available.

QA
- [ ] Keyboard navigation; overlay closable via ESC; responsive layout.

## Phase 6 — Ratings + Sort By Rating
Schema
- [ ] Add column `videos.rating INTEGER DEFAULT 0` (0–5) with `idx_videos_rating`.

IPC
- [ ] `rating:set(videoId, value)` (0–5), `rating:get(videoId)` if needed.

Renderer
- [ ] Star widget (1–5) in fullscreen overlay and optionally in grid hover.
- [ ] Add `Sort by Rating` option to sort dropdown with `Highest → Lowest`.

QA
- [ ] Verify sort stability and tie-breakers (e.g., by date/name when rating equal).

## Phase 7 — Performance & Polish
- [ ] Add DB transactions around bulk tag/backup operations.
- [ ] Ensure indexes cover all new lookups (tags, hidden, folder, rating).
- [ ] Update `docs/` with new features and `README.md` quick tips.
- [ ] Add small telemetry counters in dev (optional) via `performance-monitor.js`.

## Implementation Notes
- Files to touch: `src/database.js`, `src/ipc-handlers.js`, `src/video-scanner.js`, `app/renderer.js`, `app/styles.css`, `app/index.html`.
- Security: keep `contextIsolation: true`, `nodeIntegration: false`; expose only required APIs via `preload.js`.
- Data keys: use absolute `path` as the stable identifier for backup/import and cross-machine portability.

## Milestones & Order of Delivery
1) Tagging (Phase 1)
2) Backup/Restore (Phase 4)
3) Search (Phase 2)
4) Hide (Phase 3)
5) Fullscreen Menu (Phase 5)
6) Ratings + Sort (Phase 6)
7) Performance & Docs (Phase 7)
