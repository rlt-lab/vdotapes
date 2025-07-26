# App Features Roadmap

## Easy Implementation

### 1. Show Subfolder Name on Hover
- **Description**: Replace file name tooltip with subfolder name when hovering over video thumbnails
- **Implementation**: Simple UI change - modify tooltip content to show `path.dirname()` instead of `path.basename()`
- **Estimated Effort**: 1-2 hours

### 2. Open File Location in OS Browser
- **Description**: Right-click context menu option to open file location in system file explorer
- **Implementation**: Add context menu item that calls OS-specific command (`explorer`, `open`, `xdg-open`)
- **Estimated Effort**: 2-3 hours

### 3. Add to Favorites
- **Description**: Right-click option to mark files as favorites
- **Implementation**: 
  - Add favorites array to app state
  - Context menu item to toggle favorite status
  - Visual indicator (star icon) on favorited items
- **Estimated Effort**: 4-6 hours

## Medium Implementation

### 4. Hide/Show Files Toggle
- **Description**: Hide files from main view with navbar button to show hidden files
- **Implementation**:
  - Add hidden files array to app state
  - Filter main view based on hidden status
  - Toggle button in navbar
  - Context menu "Hide" option
- **Estimated Effort**: 6-8 hours

### 5. Move to Subfolder
- **Description**: Context menu option to move files between subfolders within root directory
- **Implementation**:
  - Scan root directory for subfolders
  - Modal/dropdown UI for subfolder selection
  - File system move operation
  - Refresh view after move
- **Estimated Effort**: 8-12 hours

## Complex Implementation

### 6. Multi-View Feature
- **Description**: Side-by-side expanded view of up to 3 selected videos
- **Implementation**:
  - Multi-view state management (max 3 items, FIFO queue)
  - Context menu "Add to Multi-View" option
  - Navbar Multi-View button
  - New view component with side-by-side layout
  - Video player integration for expanded view
  - Responsive design for 1-3 videos
- **Estimated Effort**: 16-24 hours

## Technical Considerations

### State Management
- Hidden files array
- Favorites array  
- Multi-view queue (max 3 items)

### File System Operations
- Move files between directories
- Directory scanning for subfolders
- OS integration for file browser

### UI Components Needed
- Context menu system
- Modal/dropdown for subfolder selection
- Multi-view layout component
- Navbar buttons (Show Hidden, Multi-View)

### Error Handling
- File move failures
- Directory access permissions
- Invalid file paths