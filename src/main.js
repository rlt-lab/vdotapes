const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const IPCHandlers = require('./ipc-handlers');

// Keep a global reference of the window object
let mainWindow;
let ipcHandlers;

// Security: Disable remote content
app.allowRendererProcessReuse = true;

// Set app name
app.setName('VDOTapes');

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    icon: path.join(__dirname, '../app/assets/icon.png'),
    titleBarStyle: 'default',
    show: false
  });

  // Load the index.html file
  const indexPath = path.join(__dirname, '../app/index.html');
  console.log('Loading index.html from:', indexPath);
  mainWindow.loadFile(indexPath);

  // Only open DevTools in development mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
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
ipcMain.handle('select-folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Video Folder'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] };
    } else {
      return { success: false, error: 'No folder selected' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-app-name', () => {
  return app.getName();
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Security: Disable eval and other dangerous features
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
  });

  contents.on('will-navigate', (event, navigationUrl) => {
    event.preventDefault();
  });
});
