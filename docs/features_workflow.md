# Junior Developer Workflow Guide

## Prerequisites

- Review the [App Features Roadmap](app_features_roadmap.md) to understand feature complexity and requirements
- Ensure development environment is set up with proper debugging tools
- Create a feature branch for each implementation

## Development Workflow

### Phase 1: Easy Implementation Features (Week 1)

#### Feature 1: Show Subfolder Name on Hover

**Reference**: App Features Roadmap - Easy Implementation #1

1. **Setup**

   ```bash
   git checkout -b feature/subfolder-hover-tooltip
   ```

2. **Implementation Steps**
   - Locate the video thumbnail component
   - Find the current tooltip/hover implementation
   - Replace `path.basename(filePath)` with `path.dirname(filePath).split('/').pop()`
   - Test hover behavior on thumbnails in different subfolders

3. **Testing Checklist**
   - [ ] Hover shows subfolder name instead of filename
   - [ ] Works across all subfolders
   - [ ] No performance issues with hover events

4. **Commit and PR**
   ```bash
   git add .
   git commit -m "feat: show subfolder name on thumbnail hover"
   git push origin feature/subfolder-hover-tooltip
   ```

#### Feature 2: Open File Location in OS Browser

**Reference**: App Features Roadmap - Easy Implementation #2

1. **Setup**

   ```bash
   git checkout main && git pull
   git checkout -b feature/open-file-location
   ```

2. **Implementation Steps**
   - Add context menu infrastructure (if not exists)
   - Create utility function for OS-specific file browser commands:
     ```javascript
     const openFileLocation = (filePath) => {
       const { shell } = require('electron');
       shell.showItemInFolder(filePath);
     };
     ```
   - Add "Open Location" option to context menu
   - Wire up click handler

3. **Testing Checklist**
   - [ ] Context menu appears on right-click
   - [ ] "Open Location" option visible
   - [ ] Opens correct folder and highlights file
   - [ ] Works on Windows, macOS, Linux

4. **Commit and PR**

#### Feature 3: Add to Favorites

**Reference**: App Features Roadmap - Easy Implementation #3

1. **Setup**

   ```bash
   git checkout main && git pull
   git checkout -b feature/favorites-system
   ```

2. **Implementation Steps**
   - Add favorites state to main app state:
     ```javascript
     const [favorites, setFavorites] = useState([]);
     ```
   - Create favorites utility functions:
     ```javascript
     const addToFavorites = (filePath) => {
       /* implementation */
     };
     const removeFromFavorites = (filePath) => {
       /* implementation */
     };
     const isFavorite = (filePath) => {
       /* implementation */
     };
     ```
   - Add "Add to Favorites" context menu option
   - Add visual indicator (star icon) to thumbnail component
   - Persist favorites to localStorage or app settings

3. **Testing Checklist**
   - [ ] Can add/remove favorites via context menu
   - [ ] Star icon appears on favorited items
   - [ ] Favorites persist after app restart
   - [ ] Context menu shows "Remove from Favorites" for favorited items

4. **Commit and PR**

### Phase 2: Medium Implementation Features (Week 2-3)

#### Feature 4: Hide/Show Files Toggle

**Reference**: App Features Roadmap - Medium Implementation #4

1. **Setup**

   ```bash
   git checkout main && git pull
   git checkout -b feature/hide-show-files
   ```

2. **Implementation Steps**
   - Add hidden files state:
     ```javascript
     const [hiddenFiles, setHiddenFiles] = useState([]);
     const [showHidden, setShowHidden] = useState(false);
     ```
   - Create hide/show utility functions
   - Add "Hide" option to context menu (toggle based on current state)
   - Add "Show Hidden" button to navbar
   - Filter main view based on hidden status and showHidden flag
   - Add visual indicator for hidden files when showHidden is true

3. **Testing Checklist**
   - [ ] Files can be hidden via context menu
   - [ ] Hidden files don't appear in main view by default
   - [ ] "Show Hidden" button reveals hidden files
   - [ ] Hidden files have visual indicator when shown
   - [ ] Context menu shows "Unhide" for hidden files

4. **Commit and PR**

#### Feature 5: Move to Subfolder

**Reference**: App Features Roadmap - Medium Implementation #5

1. **Setup**

   ```bash
   git checkout main && git pull
   git checkout -b feature/move-to-subfolder
   ```

2. **Implementation Steps**
   - Create function to scan root directory for subfolders:
     ```javascript
     const getSubfolders = (rootPath) => {
       // Use fs.readdirSync with isDirectory check
     };
     ```
   - Create modal/dropdown component for subfolder selection
   - Add "Move to Subfolder" context menu option
   - Implement file move operation with error handling:
     ```javascript
     const moveFile = async (sourcePath, targetFolder) => {
       // Use fs.promises.rename or fs.promises.copyFile + unlink
     };
     ```
   - Refresh file view after successful move
   - Add loading states and error notifications

3. **Testing Checklist**
   - [ ] Context menu shows "Move to Subfolder"
   - [ ] Modal opens with dropdown of available subfolders
   - [ ] File successfully moves to selected subfolder
   - [ ] View refreshes after move
   - [ ] Error handling for move failures
   - [ ] Loading indicator during move operation

4. **Commit and PR**

### Phase 3: Complex Implementation Features (Week 4-5)

#### Feature 6: Multi-View Feature

**Reference**: App Features Roadmap - Complex Implementation #6

1. **Setup**

   ```bash
   git checkout main && git pull
   git checkout -b feature/multi-view
   ```

2. **Implementation Steps**

   **Step 2a: State Management**
   - Add multi-view state with FIFO queue logic:

     ```javascript
     const [multiViewQueue, setMultiViewQueue] = useState([]);
     const [isMultiViewActive, setIsMultiViewActive] = useState(false);

     const addToMultiView = (filePath) => {
       setMultiViewQueue((prev) => {
         const newQueue = prev.filter((item) => item !== filePath);
         newQueue.push(filePath);
         return newQueue.slice(-3); // Keep max 3 items
       });
     };
     ```

   **Step 2b: Context Menu Integration**
   - Add "Add to Multi-View" context menu option
   - Wire up to addToMultiView function
   - Show visual indicator for items in multi-view queue

   **Step 2c: Navbar Button**
   - Add "Multi-View" button to navbar
   - Toggle isMultiViewActive state
   - Show queue count badge if items in queue

   **Step 2d: Multi-View Component**
   - Create new component for side-by-side view
   - Handle responsive layout for 1-3 videos
   - Integrate video player for expanded view
   - Add controls to remove items from queue

3. **Testing Checklist**
   - [ ] Can add videos to multi-view via context menu
   - [ ] Max 3 videos maintained (FIFO removal)
   - [ ] Multi-view button shows queue count
   - [ ] Multi-view displays videos side-by-side
   - [ ] Videos play in expanded mode
   - [ ] Can remove videos from multi-view
   - [ ] Responsive layout works with 1-3 videos

4. **Commit and PR**

## General Development Guidelines

### Code Quality

- Write clear, documented code with comments
- Follow existing code style and patterns
- Use meaningful variable and function names
- Add proper error handling for all file operations

### Testing Strategy

- Test each feature thoroughly before moving to next
- Test edge cases (empty folders, permission errors, etc.)
- Verify features work across different operating systems
- Test performance with large numbers of files

### Git Workflow

- One feature per branch
- Clear, descriptive commit messages
- Small, focused commits
- Create PR for each feature for code review

### Documentation

- Update any relevant documentation
- Add inline comments for complex logic
- Document any new configuration options
- Update user-facing help text if needed

## Troubleshooting Common Issues

### File System Operations

- Always use proper error handling for file operations
- Check file permissions before attempting moves
- Use path.resolve() for consistent path handling
- Test with files that have special characters in names

### UI/UX Considerations

- Ensure context menus don't interfere with existing functionality
- Add loading states for operations that take time
- Provide user feedback for successful operations
- Handle edge cases gracefully (empty states, errors)

### Performance

- Debounce hover events to prevent excessive updates
- Use efficient data structures for state management
- Avoid unnecessary re-renders in React components
- Consider virtualization for large file lists
