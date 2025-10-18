# VDOTapes - Product Requirements Document

## Product Overview

VDOTapes is a desktop video browser application that provides an Instagram-style grid interface for browsing and organizing local video collections. It emphasizes performance, visual appeal, and user-friendly organization features.

## Target Users

- Content creators managing large video libraries
- Video editors organizing footage collections
- Anyone with extensive personal video collections
- Users who want a visual, grid-based approach to video browsing

## Core Value Proposition

Browse thousands of videos with smooth performance, automatic previews, and intuitive organization—all without uploading to the cloud or relying on slow file browsers.

## Key Features

### 1. Video Grid Browser

**Requirements:**
- Display videos in a responsive Instagram-style grid (1-12 columns)
- Auto-preview videos on hover or as they scroll into view
- Support for multiple video formats (MP4, WebM, OGG, MOV, AVI, WMV, FLV, MKV, M4V)
- Thumbnail generation and caching for fast initial load
- Smooth 60 FPS scrolling even with thousands of videos

**User Stories:**
- As a user, I can adjust the grid density (1-12 columns) to match my screen size
- As a user, I see video thumbnails immediately when browsing
- As a user, videos auto-play as I scroll through the grid
- As a user, the interface remains smooth even with 1000+ videos

### 2. Video Organization

**Requirements:**
- Favorites system - mark videos with a heart icon
- Tag system - add multiple tags to videos for categorization
- Tag autocomplete - suggest previously used tags
- Tag filtering - filter by one or multiple tags (AND/OR logic)
- Folder-based filtering - show videos from specific folders only
- Hidden videos - ability to hide videos from view
- Per-folder metadata storage - tags and data stored per folder

**User Stories:**
- As a user, I can favorite videos to find them quickly later
- As a user, I can tag videos with custom labels
- As a user, I can filter videos by tags using AND/OR logic
- As a user, I can filter to show only favorited videos
- As a user, I can filter by folder when browsing multiple folders
- As a user, I can hide videos I don't want to see

### 3. Sorting and Discovery

**Requirements:**
- Sort by folder name
- Sort by date (file modification date)
- Shuffle mode for random discovery
- All sorting states persist between sessions

**User Stories:**
- As a user, I can sort videos by folder or date
- As a user, I can shuffle videos for random browsing
- As a user, my sort preferences are remembered

### 4. Full-Screen Viewer

**Requirements:**
- Click any video to view full-screen
- ESC key or close button to exit
- Display video metadata (file path, date)
- Tag management in viewer
- Favorite toggle in viewer
- Hide video option in viewer

**User Stories:**
- As a user, I can view any video in full-screen mode
- As a user, I can manage tags while viewing a video
- As a user, I can favorite or hide videos from the viewer

### 5. Data Management

**Requirements:**
- Export backup of all favorites, tags, and settings
- Import backup to restore or transfer data
- SQLite database for persistent storage
- Per-folder metadata files for portable data

**User Stories:**
- As a user, I can export my data to back it up
- As a user, I can import data from a backup file
- As a user, my favorites and tags work even if I move folders

### 6. Performance

**Requirements:**
- Virtual scrolling - only render visible videos
- Smart video loading - limit concurrent video loads (max 50)
- Thumbnail preloading for smooth scrolling
- WASM-powered filtering for large collections (6K+ videos)
- Hardware-accelerated video decoding

**User Stories:**
- As a user, I can smoothly browse collections of 5000+ videos
- As a user, scrolling never lags or stutters
- As a user, videos load quickly without errors

## Non-Functional Requirements

### Performance Targets
- Initial scan: < 5 seconds for 1000 videos
- Grid render: 60 FPS with any number of videos
- Video load time: < 500ms after scroll
- Memory usage: < 500MB for 5000+ videos

### Reliability
- No video loading errors during normal browsing
- Automatic recovery from failed video loads
- Data persistence - never lose favorites or tags
- Graceful handling of missing or moved files

### Usability
- Keyboard shortcuts for common actions
- Visual feedback for all user actions
- Consistent UI patterns throughout
- Minimal clicks to accomplish tasks

### Compatibility
- macOS 10.15+
- Windows 10+
- Support for all common video codecs

## Future Enhancements (Not in Current Scope)

- Video playback controls (speed, volume)
- Video editing capabilities
- Batch operations (tag/favorite multiple videos)
- Search by filename
- Smart collections based on rules
- Cloud sync
- Mobile companion app
- Video transcoding

## Success Metrics

- User can browse 5000+ videos at 60 FPS
- Video loading success rate > 99%
- User finds features intuitive (< 5 min to learn)
- Users organize videos using tags and favorites
- Data never lost between sessions

## Technical Constraints

- Desktop-only (Electron framework)
- Local files only (no streaming/cloud)
- Single-user (no collaboration features)
- Read-only video files (no editing)
