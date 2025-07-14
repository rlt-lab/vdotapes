# VDOTapes 🎬

**High-performance video viewer with Instagram-style browsing**

VDOTapes is a beautiful, cross-platform desktop application for browsing and organizing your video collections. Built with Electron, it provides a responsive grid layout with automatic video previews, smart filtering, and persistent favorites.

## ✨ Features

### 🎯 Core Functionality
- **📁 Folder Selection** - Browse and scan video collections from any directory
- **🎬 Multi-Format Support** - MP4, WebM, OGG, MOV, AVI, WMV, FLV, MKV, M4V
- **📱 Responsive Grid** - Instagram-style layout with customizable columns (1-12)
- **⚡ Auto-Preview** - Videos automatically play when scrolled into view
- **💾 Smart Looping** - 5-second preview segments for long videos
- **🔍 Advanced Filtering** - Filter by folder, sort by date/name, favorites-only view
- **🎲 Shuffle Mode** - Random video browsing for discovery
- **❤️ Favorites System** - Mark and filter your favorite videos
- **💾 Persistent Settings** - Remembers your preferences across sessions

### 🛡️ Security & Performance
- **🔒 Secure Architecture** - Context isolation, disabled Node integration
- **⚡ High Performance** - Lazy loading, intersection observer, optimized database
- **💾 SQLite Database** - Fast, reliable storage with WAL mode
- **🎯 Memory Efficient** - Proper cleanup and blob URL management

### 🎨 User Experience
- **🌙 Dark Theme** - Modern, eye-friendly interface
- **📱 Touch Support** - Mobile-friendly responsive design
- **♿ Accessible** - Proper contrast and focus states
- **🔄 Smooth Animations** - Polished transitions and hover effects

## 🚀 Quick Start

### Option 1: Download Pre-built (Recommended)

**Coming Soon:** Pre-built releases will be available on [GitHub Releases](https://github.com/yourusername/vdotapes/releases)

- **macOS:** Download `VDOTapes-1.0.0-arm64.dmg` and drag to Applications
- **Windows:** Download `VDOTapes 1.0.0.exe` (portable) or `VDOTapes Setup 1.0.0.exe` (installer)

### Option 2: Build from Source

If you prefer to build the app yourself:

```bash
# Clone and setup
git clone https://github.com/yourusername/vdotapes.git
cd vdotapes
npm install

# Build for your platform
npm run build:mac    # macOS
npm run build:win    # Windows
npm run build        # All platforms

# Find your build in the dist/ folder
```

### First Launch
1. **Open VDOTapes** from your Applications/Start Menu (or run the built executable)
2. **Click "📁 Select Video Folder"** to choose your video collection
3. **Wait for scan** - the app will index your videos
4. **Start browsing** - videos appear in a beautiful grid layout
5. **Customize** - adjust grid size, filters, and preferences

## 🎮 Usage Guide

### Basic Navigation
- **Grid Browsing** - Scroll through your video collection
- **Auto-Play** - Videos preview automatically when visible
- **Click to Expand** - Click any video for full-screen view
- **Close Expanded** - Press ESC or click the × button

### Filtering & Sorting
- **Folder Filter** - Use dropdown to show videos from specific folders
- **Sort Options** - Sort by folder, date, or name
- **Favorites** - Click heart icons to mark favorites
- **Favorites Only** - Toggle to show only favorited videos
- **Shuffle** - Randomize video order for discovery

### Customization
- **Grid Size** - Adjust columns (1-12) using the number input
- **Settings** - Your preferences are automatically saved
- **Responsive** - Layout adapts to window size

## 🛠️ Development

### Prerequisites
- **Node.js** 18+ 
- **npm** or **yarn**
- **Git**

### Setup
```bash
# Clone the repository
git clone https://github.com/yourusername/vdotapes.git
cd vdotapes

# Install dependencies
npm install

# Start development mode
npm run dev
```

### Available Scripts
```bash
npm start          # Start the app in development
npm run dev        # Start with DevTools open
npm run build      # Build for all platforms (creates dist/ folder)
npm run build:mac  # Build macOS app (.app + .dmg)
npm run build:win  # Build Windows app (.exe + installer)
npm run pack       # Create unpacked build for testing
```

### Build Outputs
After building, you'll find the following in the `dist/` folder:

**macOS:**
- `VDOTapes.app` - Application bundle
- `VDOTapes-1.0.0-arm64.dmg` - Disk image installer

**Windows:**
- `VDOTapes 1.0.0.exe` - Portable executable (no install required)
- `VDOTapes Setup 1.0.0.exe` - Traditional installer
- `win-unpacked/` - Unpacked application folder

### Project Structure
```
vdotapes/
├── app/                    # Frontend application
│   ├── assets/            # Icons and static assets
│   ├── index.html         # Main UI
│   ├── renderer.js        # Frontend logic
│   └── styles.css         # Styling
├── src/                   # Backend modules
│   ├── database.js        # SQLite database operations
│   ├── ipc-handlers.js    # IPC communication
│   ├── thumbnail-gen.js   # Thumbnail generation
│   └── video-scanner.js   # Video file scanning
├── main.js               # Electron main process
├── preload.js            # Secure IPC bridge
├── package.json          # Dependencies and scripts
└── README.md            # This file
```

### Architecture
- **Main Process** (`main.js`) - Electron backend with security policies
- **Renderer Process** (`app/`) - Frontend UI with responsive design
- **IPC Bridge** (`preload.js`) - Secure communication between processes
- **Database** (`src/database.js`) - SQLite with optimized queries
- **Video Scanner** (`src/video-scanner.js`) - Multi-format file detection
- **IPC Handlers** (`src/ipc-handlers.js`) - Backend API endpoints

## 🔧 Configuration

### Build Configuration
The app is configured for cross-platform distribution:

**macOS:**
- Creates `.app` bundle and `.dmg` installer
- Code signed (if certificates available)
- Category: Video applications

**Windows:**
- Creates portable `.exe` (no installation required)
- Creates NSIS installer for traditional installation
- 64-bit architecture only

### Database Schema
- **videos** - Video metadata and file information
- **favorites** - User favorite selections
- **thumbnails** - Thumbnail storage (future feature)
- **settings** - User preferences and app state

## 🐛 Troubleshooting

### Common Issues

**App won't start:**
- Check Node.js version (requires 18+)
- Try `npm install` to reinstall dependencies
- Check console for error messages

**Videos not loading:**
- Verify video format is supported
- Check file permissions
- Ensure videos are not corrupted

**Performance issues:**
- Reduce grid column count
- Close other applications
- Check available disk space

**Build errors:**
- Clear `node_modules` and reinstall
- Update electron-builder: `npm update electron-builder`
- Check platform-specific requirements

### Debug Mode
Run with development tools:
```bash
npm run dev
```

## 🤝 Contributing

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Guidelines
- Follow existing code style
- Add tests for new features
- Update documentation
- Test on multiple platforms

## 📋 Roadmap

### Immediate Goals
- [ ] **GitHub Releases** - Automated builds and releases for easy downloads
- [ ] **Thumbnail Generation** - Automatic video thumbnails
- [ ] **Drag & Drop** - Folder selection via drag and drop

### Planned Features
- [ ] **Keyboard Shortcuts** - Navigation and control shortcuts
- [ ] **Context Menus** - Right-click actions for videos
- [ ] **Search Functionality** - Search across video names and folders
- [ ] **Export/Import** - Backup and restore favorites/settings
- [ ] **Video Metadata** - Detailed video information display
- [ ] **Batch Operations** - Multi-select and batch actions

### Future Enhancements
- [ ] **Video Editing** - Basic trimming and editing capabilities
- [ ] **Playlists** - Create and manage video playlists
- [ ] **Cloud Sync** - Sync favorites across devices
- [ ] **Advanced Filters** - Date ranges, file size, duration filters
- [ ] **Video Analytics** - Viewing statistics and insights

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Electron** - Cross-platform desktop framework
- **better-sqlite3** - High-performance database
- **Canvas** - Graphics processing capabilities
- **Electron Builder** - Packaging and distribution

## 📞 Support

- **Issues** - [GitHub Issues](https://github.com/yourusername/vdotapes/issues)
- **Discussions** - [GitHub Discussions](https://github.com/yourusername/vdotapes/discussions)
- **Email** - [your-email@example.com]

---

**VDOTapes** - Making video browsing beautiful and efficient since 2024 🎬✨ 
