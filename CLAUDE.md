# VDOTapes

Electron desktop video browser with Instagram-style grid. Auto-preview, filtering, favorites, folder-based organization.

## Architecture

**Electron multi-process**: Main (`src/main.ts`) | Renderer (`app/renderer.js`) | Preload (`src/preload.ts`)

**IPC**: All handlers in `src/ipc-handlers.ts`, exposed via `window.electronAPI`

### Data Layer (Two-Tier)

1. **Per-folder metadata** (source of truth): `.vdotapes/metadata.json` in each video folder
2. **SQLite cache** (performance): `~/.config/vdotapes/videos.db` - cleared on folder switch

Write-through: folder metadata first, then DB. Folder metadata is authoritative.

### Native Modules (Rust/NAPI-RS)

- `src/video-scanner-native/` - directory scanning
- `src/thumbnail-generator-native/` - FFmpeg thumbnails

Rebuild after changes: `npm run build:native` or `npm run build:thumbnails`

## Project Structure

```
app/                     # Renderer (frontend)
├── renderer.js          # Main coordinator
├── modules/             # VdoTapesApp, VideoManager, GridRenderer, FilterManager, TagManager, etc.
├── index.html
└── styles.css

src/                     # Main process (backend)
├── main.ts              # Entry, window management, GPU config
├── preload.ts           # IPC bridge (contextBridge)
├── ipc-handlers.ts      # All IPC handlers
├── folder-metadata.ts   # Per-folder metadata manager
├── video-scanner.ts     # Scanner wrapper
├── thumbnail-gen.ts     # Thumbnail wrapper
└── database/
    ├── VideoDatabase.ts
    ├── core/DatabaseCore.ts
    └── operations/      # VideoOps, UserDataOps, TagOps, SettingsOps, BackupOps

types/                   # TypeScript definitions, branded types (VideoId, FilePath, etc.)
```

## Key Details

- **Video IDs**: Deterministic hash of path + size + mtime (`src/video-scanner.ts`)
- **Branded types**: `VideoId`, `FilePath`, `Timestamp`, `Rating` in `types/`; guards in `types/guards.ts`
- **IPC interface**: `types/ipc.ts` defines `ElectronAPI`

## Commands

`npm run dev` - development | `npm run build:ts` - compile | `npm run type-check` - typecheck only

See `package.json` for full command list.
