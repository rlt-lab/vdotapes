# VDOTapes - Technical Stack

## Architecture Overview

VDOTapes is built as an Electron desktop application with a clear separation between main process (backend) and renderer process (frontend). Performance-critical operations are implemented in native modules (Rust/C++) for maximum speed.

```
┌─────────────────────────────────────────────────┐
│              Renderer Process (UI)               │
│  HTML + CSS + JavaScript + WebAssembly           │
│  ├─ Grid Rendering (Virtual Scrolling)          │
│  ├─ Video Preview Management                    │
│  ├─ Tag Management UI                           │
│  └─ WASM Grid Engine (Rust)                     │
└─────────────────────────────────────────────────┘
                       ↕ IPC
┌─────────────────────────────────────────────────┐
│              Main Process (Backend)              │
│  TypeScript/Node.js + Native Modules            │
│  ├─ Video Scanner (Rust Native)                 │
│  ├─ Thumbnail Generator (Rust Native)           │
│  ├─ SQLite Database                             │
│  └─ File System Operations                      │
└─────────────────────────────────────────────────┘
```

## Core Technologies

### Frontend (Renderer Process)

#### **Electron Renderer**
- **Version:** 37.2.1
- **Purpose:** Desktop application runtime environment
- **Usage:** Provides chromium-based rendering engine for the UI

#### **Vanilla JavaScript**
- **Purpose:** UI logic and interactions
- **Key Files:**
  - `app/renderer.js` - Main application controller
  - `app/modules/VideoManager.js` - Video loading/unloading logic
  - `app/modules/FilterManager.js` - Filtering and sorting
  - `app/modules/TagManager.js` - Tag autocomplete and filtering UI
  - `app/modules/EventController.js` - Event handling and dropdowns
  - `app/modules/VideoExpander.js` - Full-screen viewer
  - `app/modules/UIHelper.js` - UI utilities
  - `app/modules/GridRenderer.js` - Grid rendering logic
  - `app/modules/ThumbnailPreloader.js` - Thumbnail preloading
  - `app/modules/UserDataManager.js` - Favorites/hidden state management

#### **CSS3**
- **Purpose:** Styling and animations
- **Features:**
  - CSS Grid for responsive layout
  - Flexbox for component layout
  - CSS animations for smooth transitions
  - Custom scrollbar styling
  - Dropdown menus and modals

#### **HTML5**
- **Purpose:** Semantic markup
- **Features:**
  - `<video>` elements with preload controls
  - Content Security Policy headers
  - Data attributes for state management

#### **WebAssembly (WASM)**
- **Language:** Rust
- **Purpose:** High-performance filtering and sorting for large video collections
- **Module:** `video-grid-wasm`
- **Key Features:**
  - Filter videos by folder, favorites, hidden state
  - Sort by folder name or date
  - Grid layout calculations
  - Handles 5000+ videos efficiently
- **Files:**
  - `src/video-grid-wasm/` - Rust source
  - `app/wasm/video_grid_wasm.js` - WASM bindings
  - `app/wasm-init.js` - WASM initialization

### Backend (Main Process)

#### **Electron Main**
- **Version:** 37.2.1
- **Purpose:** Application lifecycle and system integration
- **Key Features:**
  - Window management
  - File system access
  - Native dialogs
  - IPC bridge to renderer

#### **TypeScript**
- **Version:** 5.9.2
- **Purpose:** Type-safe backend logic
- **Key Files:**
  - `src/main.ts` - Application entry point
  - `src/ipc-handlers.ts` - IPC communication handlers
  - `src/video-scanner.ts` - Video file scanning
  - `src/thumbnail-gen.ts` - Thumbnail generation coordinator
  - `src/folder-metadata.ts` - Per-folder metadata management
  - `src/database/` - Database operations

#### **Node.js**
- **Version:** Built into Electron 37.2.1
- **Purpose:** Backend runtime
- **Key Features:**
  - File system operations
  - Path manipulation
  - Native module loading

### Database

#### **better-sqlite3**
- **Version:** 12.2.0
- **Purpose:** SQLite database for persistent storage
- **Features:**
  - Synchronous API (faster than async for Electron)
  - Prepared statements
  - Transactions
  - Database migrations
- **Storage:**
  - Favorites
  - Hidden videos
  - Settings
  - Backup/restore functionality
- **Location:** `~/Library/Application Support/vdotapes/` (macOS)

#### **Folder Metadata (JSON)**
- **Purpose:** Per-folder portable metadata storage
- **Format:** JSON files (`.vdotapes-metadata.json`)
- **Storage:**
  - Video tags
  - Per-folder settings
- **Benefit:** Tags travel with folders when moved

### Native Modules

#### **Video Scanner (Rust/NAPI)**
- **Language:** Rust
- **Framework:** napi-rs
- **Purpose:** Fast video file scanning
- **Features:**
  - Recursively scan directories
  - Filter by video extensions
  - Extract metadata (size, dates)
  - Multi-threaded for performance
- **Location:** `src/video-scanner-native/`
- **Output:** `.node` binary module

#### **Thumbnail Generator (Rust/NAPI)**
- **Language:** Rust
- **Framework:** napi-rs
- **Purpose:** Fast thumbnail generation from videos
- **Features:**
  - Extract frames at specific timestamps
  - Generate JPEG thumbnails
  - Efficient video decoding
  - Caching support
- **Location:** `src/thumbnail-generator-native/`
- **Output:** `.node` binary module

### Build Tools

#### **electron-builder**
- **Version:** 26.0.12
- **Purpose:** Package application for distribution
- **Outputs:**
  - macOS: DMG installer
  - Windows: NSIS installer and portable EXE
- **Configuration:** `package.json` build section

#### **TypeScript Compiler (tsc)**
- **Version:** 5.9.2
- **Purpose:** Compile TypeScript to JavaScript
- **Targets:**
  - Main process: `src/` → `dist/main/src/`
  - Renderer types: `app/` (type checking only)
- **Configs:**
  - `src/tsconfig.json` - Main process
  - `app/tsconfig.json` - Renderer process

#### **@napi-rs/cli**
- **Version:** 3.3.1
- **Purpose:** Build Rust native modules for Node.js
- **Usage:** Compiles Rust → `.node` binaries
- **Targets:** Multiple platforms (macOS, Windows)

#### **@electron/rebuild**
- **Version:** 4.0.1
- **Purpose:** Rebuild native modules for Electron
- **Usage:** Ensures native modules match Electron's Node version

### Development Tools

#### **ESLint**
- **Version:** 8.57.0
- **Purpose:** JavaScript/TypeScript linting
- **Plugins:**
  - `@typescript-eslint/*` - TypeScript rules
  - `eslint-plugin-import` - Import/export rules
  - `eslint-config-prettier` - Prettier integration

#### **Prettier**
- **Version:** 3.3.3
- **Purpose:** Code formatting
- **Scope:** TypeScript, JavaScript, CSS, HTML, JSON, Markdown

#### **Playwright**
- **Version:** 1.55.0
- **Purpose:** End-to-end testing (available but minimal usage)

## Performance Optimizations

### Virtual Scrolling
- **Implementation:** Custom JavaScript
- **Purpose:** Only render visible video elements
- **Benefit:** Smooth performance with thousands of videos
- **Max Rendered Elements:** ~50-100 (vs all videos)

### Smart Video Loading
- **Purpose:** Limit concurrent video loads
- **Strategy:** 
  - Max 50 active videos at once
  - Pause/unload videos outside viewport
  - Automatic recovery for stuck videos
- **Benefit:** Prevents browser video decoder limits

### Thumbnail Preloading
- **Purpose:** Show thumbnails instantly during scroll
- **Strategy:**
  - Preload thumbnails for videos near viewport
  - Generate thumbnails on-demand
  - Cache thumbnails in database
- **Benefit:** Smooth scrolling without white boxes

### WASM Filtering
- **Purpose:** Handle large video collections (5K+ videos)
- **Strategy:**
  - Rust-powered filtering/sorting
  - Compiled to WebAssembly
  - Runs in renderer process
- **Benefit:** Near-instant filtering even with 10K videos

### Hardware Acceleration
- **Purpose:** Use GPU for video decoding
- **Strategy:**
  - Enable Chromium GPU acceleration
  - Use native video codecs
  - Hardware-accelerated rendering
- **Benefit:** Lower CPU usage, better battery life

## Security

### Content Security Policy
- **Implementation:** CSP headers in HTML
- **Restrictions:**
  - `script-src 'self' 'wasm-unsafe-eval'` - Only local scripts + WASM
  - `style-src 'self' 'unsafe-inline'` - Local styles + inline
  - `media-src 'self' blob:` - Local media files only
  - `connect-src 'self'` - No external connections

### Context Isolation
- **Implementation:** Electron preload script
- **Purpose:** Secure IPC bridge
- **File:** `src/preload.ts`
- **API:** `window.electronAPI.*` exposed APIs only

## File Structure

```
vdotapes/
├── app/                      # Renderer process (frontend)
│   ├── index.html           # Main HTML
│   ├── styles.css           # All styles
│   ├── renderer.js          # Main app controller
│   ├── wasm-init.js         # WASM loader
│   ├── video-smart-loader.js # Smart video loading
│   ├── video-virtual-grid.js # Virtual scrolling
│   ├── modules/             # UI modules
│   │   ├── EventController.js
│   │   ├── FilterManager.js
│   │   ├── GridRenderer.js
│   │   ├── TagManager.js
│   │   ├── ThumbnailPreloader.js
│   │   ├── UIHelper.js
│   │   ├── UserDataManager.js
│   │   ├── VideoExpander.js
│   │   └── VideoManager.js
│   └── wasm/                # WASM binaries
│       └── video_grid_wasm.js
├── src/                     # Main process (backend)
│   ├── main.ts              # Electron main entry
│   ├── preload.ts           # Preload script (IPC bridge)
│   ├── ipc-handlers.ts      # IPC request handlers
│   ├── video-scanner.ts     # Video scanning
│   ├── thumbnail-gen.ts     # Thumbnail generation
│   ├── folder-metadata.ts   # Per-folder metadata
│   ├── database/            # SQLite operations
│   │   ├── VideoDatabase.ts
│   │   └── operations/      # Separated operations
│   ├── video-scanner-native/    # Rust video scanner
│   │   ├── src/lib.rs
│   │   └── Cargo.toml
│   ├── thumbnail-generator-native/ # Rust thumbnail gen
│   │   ├── src/lib.rs
│   │   └── Cargo.toml
│   └── video-grid-wasm/     # Rust WASM engine
│       ├── src/lib.rs
│       └── Cargo.toml
├── dist/                    # Build output
│   ├── main/               # Compiled TypeScript
│   └── packages/           # Packaged applications
├── docs/                    # Documentation
├── tests/                   # Test files
└── types/                   # TypeScript type definitions
```

## Dependencies Summary

### Runtime Dependencies
- `better-sqlite3` - SQLite database

### Development Dependencies
- `electron` - Desktop framework
- `electron-builder` - Application packager
- `typescript` - Type-safe development
- `@napi-rs/cli` - Rust native modules builder
- `@electron/rebuild` - Native module rebuilder
- `eslint` + plugins - Code linting
- `prettier` - Code formatting
- `@playwright/test` - E2E testing

### Native Dependencies (Rust)
- `napi` - Node.js native bindings
- `napi-derive` - NAPI macros
- `wasm-bindgen` - WebAssembly bindings
- `serde` - Serialization (WASM)
- `serde-wasm-bindgen` - WASM serialization

## Platform Support

### Supported Operating Systems
- **macOS:** 10.15+ (Catalina and newer)
- **Windows:** 10+ (64-bit)

### Target Architectures
- x64 (Intel/AMD)
- arm64 (Apple Silicon) - via Rosetta or native

## Development Workflow

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build TypeScript
npm run build:ts

# Build native modules
npm run build:native
npm run build:thumbnails

# Build everything
npm run build:all

# Lint code
npm run lint
npm run lint:fix

# Format code
npm run format

# Package application
npm run build:mac      # macOS DMG
npm run build:win      # Windows installer
npm run build          # Both platforms
```

## Version Control
- **Git** - Version control system
- **GitHub** - Repository hosting

## Future Technical Considerations

- Consider moving more operations to WASM for performance
- Explore multi-threading for thumbnail generation
- Evaluate video transcoding for format compatibility
- Consider incremental loading for very large folders (50K+ videos)
- Explore IndexedDB as alternative to SQLite for renderer storage
