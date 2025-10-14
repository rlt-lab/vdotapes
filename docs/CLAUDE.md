# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VDOTapes is a cross-platform desktop video viewer application built with Electron. It provides an Instagram-style grid layout for browsing video collections with auto-preview, filtering, and favorites functionality.

## Development Commands

```bash
# Install dependencies
npm install

# Development mode with DevTools
npm run dev

# Production mode
npm start

# Build commands
npm run build        # All platforms
npm run build:mac    # macOS only (.app + .dmg)
npm run build:win    # Windows only (.exe + installer)
npm run pack         # Unpacked build for testing
```

## Architecture Overview

### Process Architecture

- **Main Process** (main.js): Electron backend with window management and security policies
- **Renderer Process** (app/): Frontend UI running in isolated context
- **Preload Script** (preload.js): Secure IPC bridge exposing limited APIs

### Security Model

- Context isolation enabled
- Node integration disabled
- All IPC communication through secure contextBridge API
- Content Security Policy enforced

### Key Components

**Frontend (app/)**:

- `renderer.js`: VdoTapesApp class managing UI state and video grid
- Uses Intersection Observer for lazy loading and auto-preview
- Responsive grid layout (1-12 columns adjustable)

**Backend Modules (src/)**:

- `database.js`: SQLite operations with migration support
- `video-scanner.js`: Scans directories for video files (MP4, WebM, OGG, MOV, AVI, WMV, FLV, MKV, M4V)
- `ipc-handlers.js`: Backend API implementations
- `thumbnail-gen.js`: Thumbnail generation capabilities (not fully implemented)

**IPC API Surface**:

- `vdoTapesAPI.selectVideoFolder()`: Opens folder picker
- `vdoTapesAPI.getVideos()`: Retrieves video list from database
- `vdoTapesAPI.updateFavorite()`: Toggle favorite status
- `vdoTapesAPI.getSetting()` / `setSetting()`: Persistent settings
- `vdoTapesAPI.getSubfolders()`: Get folder structure

### Database Schema

- `videos`: Video metadata (path, stats, folder info)
- `favorites`: User's favorited videos
- `settings`: Persistent app settings
- `thumbnails`: Thumbnail storage (prepared but unused)

## Testing Status

Currently no testing framework is implemented. When adding tests, consider:

- Unit tests for video-scanner.js and database.js modules
- Integration tests for IPC communication
- UI tests for renderer process functionality

## Important Development Notes

1. **File Paths**: Always use absolute paths in IPC communication
2. **Video Formats**: Support for MP4, WebM, OGG, MOV, AVI, WMV, FLV, MKV, M4V
3. **Performance**: Videos lazy-load using Intersection Observer
4. **State Management**: Frontend state managed in VdoTapesApp class
5. **Error Handling**: All IPC handlers include try-catch with console logging

## Current Feature Development

The project has active feature development documented in:

- `features_roadmap.md`: Planned features (context menus, multi-view, etc.)
- Recent commits show active development on UI improvements and dependency updates

When implementing new features:

1. Follow existing IPC pattern for main/renderer communication
2. Update database schema if needed (see migration examples in database.js)
3. Maintain security model - no direct file system access from renderer
4. Test on both macOS and Windows platforms

## UI Design and Visual Reference

This project has Playwright MCP server configured for visual testing and UI design work. When working on UI changes:

### Taking Screenshots for Reference

Use the Playwright MCP server to capture current UI state before making changes:

1. **Launch the app**: Run `npm run dev` to start the application
2. **Take screenshots**: Use Playwright MCP tools to navigate and capture screenshots
3. **Document changes**: Screenshots help compare before/after states during UI development

### Common UI Testing Scenarios

- Grid layout responsiveness (1-12 columns)
- Video preview functionality
- Toolbar and control interactions
- Filter and sort UI elements
- Favorites and tagging interfaces

Screenshots should be taken at different viewport sizes and with various video collections loaded to ensure consistent UI behavior across different usage scenarios.
- use prompt-engineer subagent to adjust all prompts given before executing them.