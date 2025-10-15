import * as path from 'path';

import { app, BrowserWindow, ipcMain, dialog, IpcMainInvokeEvent } from 'electron';

import IPCHandlers = require('./ipc-handlers');

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null;
let ipcHandlers: IPCHandlers | null = null;

// Security: Disable remote content
// app.allowRendererProcessReuse = true; // Deprecated in newer Electron versions

// Set app name
app.setName('vdotapes');

// ========================================
// GPU/Hardware Acceleration Configuration
// ========================================
// Enable hardware acceleration for smooth video playback
// Critical for playing many videos simultaneously

// Enable GPU rasterization for better performance
app.commandLine.appendSwitch('enable-gpu-rasterization');

// Enable zero-copy for video decoding (reduces memory copies)
app.commandLine.appendSwitch('enable-zero-copy');

// Platform-specific optimizations
if (process.platform === 'darwin') {
  // macOS: Use Metal for better performance
  app.commandLine.appendSwitch('enable-metal');
} else if (process.platform === 'linux') {
  // Linux: Enable VA-API for hardware video decoding
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
  app.commandLine.appendSwitch('enable-accelerated-video-decode');
} else if (process.platform === 'win32') {
  // Windows: Enable D3D11 video decoding
  app.commandLine.appendSwitch('enable-features', 'D3D11VideoDecoder');
}

// Increase video decoder threads for better performance with many videos
app.commandLine.appendSwitch('video-threads', '8');

// Enable hardware overlays for better video compositing
app.commandLine.appendSwitch('enable-hardware-overlays');

// Ignore GPU blocklist (force enable GPU even if blacklisted)
// Remove this line if you experience crashes or visual glitches
app.commandLine.appendSwitch('ignore-gpu-blacklist');

console.log('[GPU] Hardware acceleration enabled with platform-specific optimizations');

interface FolderSelectionResult {
  readonly success: boolean;
  readonly path?: string;
  readonly error?: string;
}

function resolveAppPath(rel: string): string {
  // Works in dev (repo root) and prod (app.asar)
  return path.join(app.getAppPath(), rel);
}

function createWindow(): void {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Hardware acceleration settings
      webgl: true,                    // Enable WebGL (GPU rendering)
      backgroundThrottling: false,    // Don't throttle when in background
      offscreen: false,               // Use GPU rendering
    },
    icon: resolveAppPath('app/assets/icon.png'),
    titleBarStyle: 'default',
    show: false,
  });

  // Load the index.html file
  const indexPath = resolveAppPath('app/index.html');
  console.log('Loading index.html from:', indexPath);
  mainWindow.loadFile(indexPath);

  // Only open DevTools in development mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Security: Prevent new window creation
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
}

// App event handlers
app.whenReady().then(async () => {
  try {
    console.log('App is ready, initializing...');

    // Initialize IPC handlers
    console.log('Creating IPC handlers...');
    ipcHandlers = new IPCHandlers();

    console.log('Initializing IPC handlers...');
    await ipcHandlers.initialize();

    console.log('Registering IPC handlers...');
    ipcHandlers.registerHandlers();

    console.log('Creating window...');
    createWindow();

    console.log('App initialization complete');

    // macOS: Re-create window when dock icon is clicked
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error) {
    console.error('Error during app initialization:', error);
    app.quit();
  }
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cleanup on app quit
app.on('before-quit', () => {
  if (ipcHandlers) {
    ipcHandlers.cleanup();
  }
});

// Security: Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// IPC Handlers
ipcMain.handle(
  'select-folder',
  async (_event: IpcMainInvokeEvent): Promise<FolderSelectionResult> => {
    try {
      if (!mainWindow) {
        return { success: false, error: 'Main window not available' };
      }

      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Video Folder',
      });

      if (!result.canceled && result.filePaths.length > 0) {
        return { success: true, path: result.filePaths[0] };
      } else {
        return { success: false, error: 'No folder selected' };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
);

ipcMain.handle('get-app-version', (_event: IpcMainInvokeEvent): string => {
  return app.getVersion();
});

ipcMain.handle('get-app-name', (_event: IpcMainInvokeEvent): string => {
  return app.getName();
});

// Error handling
process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Security: Disable eval and other dangerous features
app.on('web-contents-created', (_event, contents) => {
  // Prevent navigation to external URLs
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== 'file://') {
      event.preventDefault();
    }
  });
});
