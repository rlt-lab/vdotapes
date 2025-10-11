# VDOTapes

A desktop video browser with an Instagram-style grid layout. Browse your video collections with auto-preview, filtering, and favorites.

## What it does

Point it at a folder with videos, and it'll show them in a responsive grid. Videos preview automatically as you scroll. Mark favorites, filter by folder, shuffle, or sort however you want. It remembers your settings between sessions.

Supports MP4, WebM, OGG, MOV, AVI, WMV, FLV, MKV, and M4V.

## Building from source

```bash
git clone https://github.com/rlt-lab/vdotapes.git
cd vdotapes
npm install
npm run dev  # Run in development mode
```

Build for your platform:
```bash
npm run build:mac    # macOS
npm run build:win    # Windows
npm run build        # Both
```

## How to use it

1. Launch the app
2. Click "Select Video Folder"
3. Wait for it to scan
4. Browse your videos

The grid adjusts from 1-12 columns. Click any video to view it full-screen. Press ESC to close. Heart icon to favorite. Filter dropdown to show specific folders. Shuffle button to randomize. Your preferences stick around

## Development

Built with Electron. The main process handles the backend stuff, renderer process runs the UI, and they talk through a secure IPC bridge. SQLite database for storage, Intersection Observer for lazy loading.

Project structure:
```
app/         # Frontend (HTML, CSS, JS)
src/         # Backend (database, video scanning, IPC handlers)
```

## License

MIT License - see [LICENSE](LICENSE)
