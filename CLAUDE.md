# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VDOTapes is an Electron-based desktop video browser with an Instagram-style grid layout. It allows users to browse video collections with auto-preview, filtering, favorites, and folder-based organization. The app supports MP4, WebM, OGG, MOV, AVI, WMV, FLV, MKV, and M4V formats.

## Development Commands

### Building and Running

```bash
npm install                  # Install dependencies
npm run dev                 # Run in development mode (builds TypeScript, then launches Electron)
npm start                   # Build and run in production mode
```

### TypeScript Compilation

```bash
npm run build:ts            # Build both main and renderer processes
npm run build:main          # Build main process only (includes copying native modules)
npm run build:renderer      # Build renderer process only
```

### Native Modules (Rust)

```bash
npm run build:native        # Build video scanner native module (Rust -> Node.js addon)
npm run build:native:debug  # Build video scanner in debug mode
npm run build:thumbnails    # Build thumbnail generator native module
npm run build:all           # Build all native modules and TypeScript
npm run rebuild:native      # Rebuild better-sqlite3 for current Electron version
```

### Code Quality

```bash
npm run lint                # Run ESLint
npm run lint:fix            # Fix ESLint issues automatically
npm run format              # Format code with Prettier
npm run format:check        # Check code formatting
npm run type-check          # Run TypeScript type checking without emitting files
```

### Distribution

```bash
npm run build               # Build for all platforms
npm run build:mac           # Build for macOS (creates DMG)
npm run build:win           # Build for Windows (creates portable and NSIS installer)
npm run pack                # Package without creating installer (for testing)
```

## Architecture

### Process Model

VDOTapes uses Electron's multi-process architecture:

- **Main Process** (`src/main.ts`): Entry point, window management, IPC setup, hardware acceleration configuration
- **Renderer Process** (`app/renderer.js`): UI logic, video grid, user interactions
- **Preload Script** (`src/preload.ts`): Secure IPC bridge using contextBridge (exposes `window.electronAPI`)

Communication between processes uses Electron's IPC (Inter-Process Communication) system, with all handlers registered in `src/ipc-handlers.ts`.

### Data Layer Architecture

#### Two-Tier Storage System

1. **Per-Folder Metadata (Source of Truth)**: Each video folder gets a `.vdotapes/metadata.json` file storing favorites, ratings, hidden files, and tags for videos in that folder. This metadata travels with the folder and persists across machines.

2. **SQLite Database (Performance Cache)**: A centralized SQLite database (`~/.config/vdotapes/videos.db`) caches video metadata for fast queries. The database is cleared when switching folders.

Write-through pattern: Updates go to folder metadata first, then to database. Reads can use either source, with folder metadata as the authoritative source.

The database is modularized into operation classes:
- `VideoOperations`: Video CRUD operations
- `UserDataOperations`: Favorites, ratings, hidden files, thumbnails
- `TagOperations`: Tag management and search
- `SettingsOperations`: User preferences and app settings
- `BackupOperations`: Export/import functionality

### Native Performance Modules

Three Rust-based native modules provide performance-critical functionality:

1. **video-scanner-native** (`src/video-scanner-native/`): Fast recursive directory scanning for video files. Uses `walkdir` for efficient traversal and NAPI-RS for Node.js bindings.

2. **thumbnail-generator-native** (`src/thumbnail-generator-native/`): FFmpeg-based thumbnail generation with caching. Uses `ffmpeg-next` (v8) for video decoding and async Tokio runtime.

3. **video-grid-wasm** (`src/video-grid-wasm/`): WebAssembly module for client-side video filtering and sorting (not yet integrated).

These modules must be rebuilt after changes using `npm run build:native` or `npm run build:thumbnails`.

### Renderer Architecture (Frontend)

The renderer process uses a modular class-based architecture (`app/modules/`):

- **VdoTapesApp**: Main coordinator class that manages overall state
- **VideoManager**: Video loading, playback state, multi-view queue
- **VideoExpander**: Full-screen video viewing with navigation
- **FilterManager**: Folder filtering, sorting, search
- **TagManager**: Tag UI, tag filtering
- **GridRenderer**: Video grid rendering with Intersection Observer for lazy loading
- **UserDataManager**: Favorites, ratings, settings persistence
- **UIHelper**: UI updates, grid layout calculations
- **EventController**: Event listener setup and delegation
- **VideoSmartLoader**: Smart video loading system that limits active videos to prevent memory issues
- **ThumbnailPreloader**: Preloads thumbnails for visible videos

### Hardware Acceleration

Main process enables platform-specific GPU acceleration for smooth video playback:
- macOS: Metal rendering
- Linux: VA-API hardware decoding
- Windows: D3D11 video decoding

Video decoder threads are set to 8, and hardware overlays are enabled. See `src/main.ts:19-52` for configuration.

### Type System

TypeScript branded types ensure type safety throughout the codebase (`types/`):
- `VideoId`: Branded string for video identifiers
- `FilePath`: Branded string for file paths
- `Timestamp`: Branded number for Unix timestamps
- `Rating`: Branded number (1-5) for video ratings

Type guards (`types/guards.ts`) create and validate these branded types.

## Key Implementation Details

### Video ID Generation

Video IDs are deterministic hashes based on: file path + size + last modified timestamp. This ensures the same video always gets the same ID, even across scans. See `src/video-scanner.ts` for implementation.

### Folder Switching

When switching folders:
1. Database videos from old folder are cleared
2. Folder metadata is initialized (loaded or created)
3. New folder is scanned
4. Folder metadata is synced to database (source of truth -> cache)

See `src/ipc-handlers.ts:167-223` (handleScanVideos).

### Performance Optimizations

- **Query Cache**: LRU cache for database queries (50 entries, 5-minute TTL)
- **Query Performance Monitor**: Tracks slow queries and provides optimization recommendations
- **Cache Warmer**: Pre-warms common queries on startup and periodically
- **Smart Video Loading**: Limits active video elements to prevent browser memory issues
- **Intersection Observer**: Lazy-loads videos as they enter viewport
- **Thumbnail Preloading**: Preloads thumbnails for better UX

### Security Measures

- Context isolation enabled
- Node integration disabled in renderer
- Web security enabled
- External navigation blocked
- Single instance lock
- No eval or remote content

## Project Structure

```
vdotapes/
├── app/                    # Renderer process (frontend)
│   ├── renderer.js        # Main app coordinator
│   ├── modules/           # Modular functionality
│   ├── index.html         # Main UI
│   └── styles.css         # Application styles
├── src/                   # Main process (backend)
│   ├── main.ts            # Electron entry point
│   ├── preload.ts         # IPC bridge
│   ├── ipc-handlers.ts    # IPC handler registration
│   ├── video-scanner.ts   # Video scanning TypeScript wrapper
│   ├── thumbnail-gen.ts   # Thumbnail generation wrapper
│   ├── folder-metadata.ts # Per-folder metadata manager
│   ├── database/          # Database layer
│   │   ├── VideoDatabase.ts           # Main database class
│   │   ├── core/                      # Core infrastructure
│   │   │   ├── DatabaseCore.ts        # Connection, schema, migrations
│   │   │   └── TransactionManager.ts  # Transaction handling
│   │   └── operations/                # Operation modules
│   │       ├── VideoOperations.ts     # Video CRUD
│   │       ├── UserDataOperations.ts  # Favorites, ratings, etc.
│   │       ├── TagOperations.ts       # Tags
│   │       ├── SettingsOperations.ts  # Settings
│   │       └── BackupOperations.ts    # Backup/restore
│   ├── video-scanner-native/  # Rust video scanner
│   ├── thumbnail-generator-native/  # Rust thumbnail generator
│   └── video-grid-wasm/      # WebAssembly grid module (not integrated)
├── types/                 # TypeScript type definitions
├── dist/                  # Build output
│   ├── main/             # Compiled main process
│   └── packages/         # Distribution packages
└── node_modules/         # Dependencies
```

## Common Workflows

### Adding a New IPC Handler

1. Add handler method to `IPCHandlers` class in `src/ipc-handlers.ts`
2. Register handler in `registerHandlers()` method
3. Add corresponding method to `electronAPI` in `src/preload.ts`
4. Update `ElectronAPI` interface in `types/ipc.ts`
5. Call from renderer using `window.electronAPI.yourMethod()`

### Modifying Database Schema

1. Update schema in `src/database/core/DatabaseCore.ts` (ensureSchema method)
2. Add migration if needed in `src/database/migrations/`
3. Update relevant operation classes in `src/database/operations/`
4. Update TypeScript interfaces in `types/database.ts`

### Working with Native Modules

After modifying Rust code:
1. Navigate to native module directory
2. Run `npm run build` (or `npm run build:debug` for debugging)
3. Rebuild TypeScript: `npm run build:main`
4. Test with `npm run dev`

Native modules are automatically copied to `dist/main/src/` during the build process.

## Testing

Currently, there are no automated tests. Manual testing workflow:
1. `npm run dev` to launch in development mode with DevTools
2. Use `--dev` flag to enable DevTools automatically
3. Test with various video folders and file types
4. Check console for errors and performance metrics

## Distribution Notes

- Built packages go to `dist/packages/`
- macOS builds create DMG files
- Windows builds create both portable and NSIS installer versions
- Native modules must be included in the `files` array in `package.json`
- Better-sqlite3 may need rebuilding for the target Electron version: `npm run rebuild:native`
