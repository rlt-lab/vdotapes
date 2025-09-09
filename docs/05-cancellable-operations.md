# Implementation Plan 5: Cancellable Operations

**Priority:** HIGH
**Estimated Effort:** 1-2 days
**Dependencies:** None (can be implemented independently)

## Objective

Implement a comprehensive cancellation system for long-running operations (folder scanning, metadata extraction, database operations) to improve user experience and application responsiveness.

## Current Problem

- Users cannot cancel long-running folder scans
- No way to interrupt metadata extraction for large collections
- Application becomes unresponsive during heavy operations
- No feedback mechanism for operation progress
- Force-quit is the only way to stop unwanted operations

## Solution Design

### 1. Cancellation Token System

Create a robust cancellation system that can be used across all async operations.

```javascript
class CancellationToken {
  constructor() {
    this.cancelled = false;
    this.reason = null;
    this.callbacks = new Set();
    this.children = new Set();
  }

  cancel(reason = 'Operation cancelled') {
    if (this.cancelled) return;

    this.cancelled = true;
    this.reason = reason;

    // Notify all callbacks
    this.callbacks.forEach((callback) => {
      try {
        callback(reason);
      } catch (error) {
        console.error('Cancellation callback error:', error);
      }
    });

    // Cancel all child tokens
    this.children.forEach((child) => child.cancel(reason));

    // Clear references
    this.callbacks.clear();
    this.children.clear();
  }

  onCancelled(callback) {
    if (this.cancelled) {
      callback(this.reason);
      return;
    }
    this.callbacks.add(callback);
  }

  throwIfCancelled() {
    if (this.cancelled) {
      throw new CancellationError(this.reason);
    }
  }

  createChild() {
    const child = new CancellationToken();
    this.children.add(child);

    if (this.cancelled) {
      child.cancel(this.reason);
    }

    return child;
  }

  static combine(...tokens) {
    const combined = new CancellationToken();

    tokens.forEach((token) => {
      token.onCancelled((reason) => {
        combined.cancel(reason);
      });
    });

    return combined;
  }

  static timeout(milliseconds) {
    const token = new CancellationToken();
    setTimeout(() => {
      token.cancel(`Operation timed out after ${milliseconds}ms`);
    }, milliseconds);
    return token;
  }
}

class CancellationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CancellationError';
    this.cancelled = true;
  }
}
```

### 2. Operation Manager

Manage and track all cancellable operations in the application.

```javascript
class OperationManager {
  constructor() {
    this.operations = new Map();
    this.operationCounter = 0;
  }

  startOperation(name, operation, options = {}) {
    const id = ++this.operationCounter;
    const token = new CancellationToken();
    const timeout = options.timeout ? CancellationToken.timeout(options.timeout) : null;
    const effectiveToken = timeout ? CancellationToken.combine(token, timeout) : token;

    const operationInfo = {
      id,
      name,
      token,
      effectiveToken,
      startTime: Date.now(),
      progress: 0,
      status: 'running',
      onProgress: options.onProgress,
      onComplete: options.onComplete,
      onError: options.onError,
    };

    this.operations.set(id, operationInfo);

    // Execute operation
    this.executeOperation(operationInfo, operation);

    return {
      id,
      token: effectiveToken,
      cancel: (reason) => token.cancel(reason),
      onProgress: (callback) => (operationInfo.onProgress = callback),
      onComplete: (callback) => (operationInfo.onComplete = callback),
      onError: (callback) => (operationInfo.onError = callback),
    };
  }

  async executeOperation(operationInfo, operation) {
    try {
      const result = await operation(operationInfo.effectiveToken, (progress) => {
        operationInfo.progress = progress;
        if (operationInfo.onProgress) {
          operationInfo.onProgress(progress);
        }
      });

      operationInfo.status = 'completed';
      operationInfo.result = result;

      if (operationInfo.onComplete) {
        operationInfo.onComplete(result);
      }
    } catch (error) {
      operationInfo.status = error instanceof CancellationError ? 'cancelled' : 'failed';
      operationInfo.error = error;

      if (operationInfo.onError) {
        operationInfo.onError(error);
      }
    } finally {
      // Clean up after a delay to allow status checking
      setTimeout(() => {
        this.operations.delete(operationInfo.id);
      }, 5000);
    }
  }

  cancelOperation(id, reason = 'User cancelled') {
    const operation = this.operations.get(id);
    if (operation) {
      operation.token.cancel(reason);
      return true;
    }
    return false;
  }

  cancelAllOperations(reason = 'All operations cancelled') {
    for (const operation of this.operations.values()) {
      operation.token.cancel(reason);
    }
  }

  getOperationStatus(id) {
    return this.operations.get(id);
  }

  getAllOperations() {
    return Array.from(this.operations.values());
  }
}
```

### 3. Cancellable File Operations

Make file scanning and metadata extraction cancellable.

```javascript
// Update video-scanner.js
class CancellableVideoScanner {
  async scanDirectory(folderPath, cancellationToken, progressCallback) {
    const files = [];
    let processedCount = 0;

    try {
      await this.scanDirectoryRecursive(folderPath, files, cancellationToken, (count) => {
        processedCount = count;
        if (progressCallback) {
          progressCallback({
            phase: 'scanning',
            processed: processedCount,
            currentPath: folderPath,
          });
        }
      });

      return files;
    } catch (error) {
      if (error instanceof CancellationError) {
        console.log(`Scan cancelled: ${error.message}`);
        return files; // Return partial results
      }
      throw error;
    }
  }

  async scanDirectoryRecursive(dirPath, files, cancellationToken, progressCallback) {
    cancellationToken.throwIfCancelled();

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        cancellationToken.throwIfCancelled();

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await this.scanDirectoryRecursive(fullPath, files, cancellationToken, progressCallback);
        } else if (this.isVideoFile(entry.name)) {
          const fileInfo = await this.getFileInfo(fullPath);
          files.push(fileInfo);

          if (progressCallback) {
            progressCallback(files.length);
          }
        }

        // Yield control periodically
        if (files.length % 10 === 0) {
          await this.yield();
        }
      }
    } catch (error) {
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        console.warn(`Permission denied: ${dirPath}`);
        return; // Skip inaccessible directories
      }
      throw error;
    }
  }

  async yield() {
    return new Promise((resolve) => setImmediate(resolve));
  }
}
```

### 4. Cancellable Metadata Extraction

Make metadata extraction cancellable with progress reporting.

```javascript
// Update metadata extraction
class CancellableMetadataExtractor {
  async extractMetadataBatch(filePaths, cancellationToken, progressCallback) {
    const results = [];
    const total = filePaths.length;
    let completed = 0;
    let failed = 0;

    // Process in chunks to allow cancellation
    const chunkSize = 5;
    for (let i = 0; i < filePaths.length; i += chunkSize) {
      cancellationToken.throwIfCancelled();

      const chunk = filePaths.slice(i, i + chunkSize);
      const chunkPromises = chunk.map(async (filePath) => {
        try {
          cancellationToken.throwIfCancelled();
          const metadata = await this.extractSingleFile(filePath, cancellationToken);
          completed++;
          return { filePath, metadata, success: true };
        } catch (error) {
          if (error instanceof CancellationError) {
            throw error; // Re-throw cancellation
          }
          failed++;
          return { filePath, error, success: false };
        }
      });

      const chunkResults = await Promise.allSettled(chunkPromises);

      chunkResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      });

      // Report progress
      if (progressCallback) {
        progressCallback({
          phase: 'extracting',
          completed,
          failed,
          total,
          percentage: Math.round(((completed + failed) / total) * 100),
          currentFile: chunk[0], // First file in current chunk
        });
      }
    }

    return results;
  }

  async extractSingleFile(filePath, cancellationToken) {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn(this.ffprobePath, [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath,
      ]);

      let stdout = '';
      let stderr = '';

      // Set up cancellation
      const cancelHandler = (reason) => {
        ffprobe.kill('SIGTERM');
        reject(new CancellationError(reason));
      };

      cancellationToken.onCancelled(cancelHandler);

      ffprobe.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ffprobe.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === null) return; // Process was killed (likely cancelled)

        if (code !== 0) {
          reject(new Error(`FFprobe failed: ${stderr}`));
          return;
        }

        try {
          const metadata = this.parseMetadata(stdout);
          resolve(metadata);
        } catch (error) {
          reject(error);
        }
      });

      ffprobe.on('error', (error) => {
        reject(error);
      });
    });
  }
}
```

## Implementation Steps

### Phase 1: Core Cancellation System (Day 1)

1. **Create cancellation infrastructure**
   - Implement CancellationToken class
   - Create OperationManager for tracking operations
   - Add CancellationError class

2. **Update IPC for cancellation**
   - Add cancel operation IPC handlers
   - Implement operation status queries
   - Add progress reporting channels

```javascript
// In ipc-handlers.js
class IPCHandlers {
  registerCancellationHandlers() {
    ipcMain.handle('start-folder-scan', async (event, folderPath) => {
      const operation = this.operationManager.startOperation(
        'folder-scan',
        async (token, progress) => {
          return await this.videoScanner.scanDirectory(folderPath, token, progress);
        },
        {
          timeout: 300000, // 5 minute timeout
          onProgress: (progress) => {
            event.sender.send('folder-scan-progress', progress);
          },
        }
      );

      return { operationId: operation.id };
    });

    ipcMain.handle('cancel-operation', async (event, operationId) => {
      return this.operationManager.cancelOperation(operationId);
    });

    ipcMain.handle('get-operation-status', async (event, operationId) => {
      return this.operationManager.getOperationStatus(operationId);
    });
  }
}
```

### Phase 2: UI Integration (Day 1-2)

1. **Add cancellation UI components**
   - Cancel buttons for long operations
   - Progress bars with cancellation
   - Operation status indicators

```javascript
// In renderer.js
class OperationUI {
  constructor() {
    this.activeOperations = new Map();
  }

  async startFolderScan(folderPath) {
    try {
      const { operationId } = await vdoTapesAPI.startFolderScan(folderPath);
      this.showOperationProgress(operationId, 'Scanning folder...');
      return operationId;
    } catch (error) {
      this.showError('Failed to start folder scan', error);
    }
  }

  showOperationProgress(operationId, title) {
    const progressElement = this.createProgressElement(operationId, title);
    this.activeOperations.set(operationId, progressElement);

    // Listen for progress updates
    vdoTapesAPI.onFolderScanProgress((progress) => {
      this.updateProgress(operationId, progress);
    });
  }

  createProgressElement(operationId, title) {
    const container = document.createElement('div');
    container.className = 'operation-progress';
    container.innerHTML = `
      <div class="progress-header">
        <span class="progress-title">${title}</span>
        <button class="cancel-btn" onclick="app.cancelOperation('${operationId}')">
          Cancel
        </button>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
      <div class="progress-info">
        <span class="progress-text">Starting...</span>
        <span class="progress-percentage">0%</span>
      </div>
    `;

    document.getElementById('operations-container').appendChild(container);
    return container;
  }

  async cancelOperation(operationId) {
    const success = await vdoTapesAPI.cancelOperation(operationId);
    if (success) {
      this.updateOperationStatus(operationId, 'Cancelling...');
    }
  }

  updateProgress(operationId, progress) {
    const element = this.activeOperations.get(operationId);
    if (!element) return;

    const progressBar = element.querySelector('.progress-fill');
    const progressText = element.querySelector('.progress-text');
    const progressPercentage = element.querySelector('.progress-percentage');

    progressBar.style.width = `${progress.percentage || 0}%`;
    progressPercentage.textContent = `${Math.round(progress.percentage || 0)}%`;

    if (progress.phase === 'scanning') {
      progressText.textContent = `Scanning... (${progress.processed || 0} files found)`;
    } else if (progress.phase === 'extracting') {
      progressText.textContent = `Extracting metadata... (${progress.completed}/${progress.total})`;
    }
  }
}
```

2. **Add keyboard shortcuts**
   - Escape key to cancel current operation
   - Ctrl/Cmd+. for emergency stop

```javascript
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    this.cancelCurrentOperation();
  } else if ((event.ctrlKey || event.metaKey) && event.key === '.') {
    this.emergencyStopAllOperations();
  }
});
```

### Phase 3: Integration and Testing (Day 2)

1. **Update all long-running operations**
   - Folder scanning
   - Metadata extraction
   - Database operations
   - File operations

2. **Add operation persistence**
   - Save operation state to resume after restart
   - Handle partial completion gracefully

```javascript
class OperationPersistence {
  saveOperationState(operationId, state) {
    const operations = this.getStoredOperations();
    operations[operationId] = {
      ...state,
      timestamp: Date.now(),
    };
    localStorage.setItem('pendingOperations', JSON.stringify(operations));
  }

  getStoredOperations() {
    try {
      return JSON.parse(localStorage.getItem('pendingOperations') || '{}');
    } catch {
      return {};
    }
  }

  resumePendingOperations() {
    const operations = this.getStoredOperations();
    const now = Date.now();

    Object.entries(operations).forEach(([id, state]) => {
      // Only resume operations from the last hour
      if (now - state.timestamp < 3600000) {
        this.showResumeDialog(id, state);
      }
    });
  }
}
```

## Files to Modify

1. **Create new files:**
   - `src/cancellation-token.js` - Core cancellation system
   - `src/operation-manager.js` - Operation tracking and management

2. **src/ipc-handlers.js**
   - Add cancellation IPC handlers
   - Integrate with OperationManager

3. **src/video-scanner.js**
   - Make scanning operations cancellable
   - Add progress reporting

4. **src/metadata-extractor.js** (from Plan 4)
   - Make metadata extraction cancellable
   - Add batch processing with cancellation

5. **app/renderer.js**
   - Add operation UI components
   - Handle cancellation requests
   - Show progress and status

6. **app/index.html**
   - Add operations container
   - Include new JavaScript files

## Success Criteria

- **Responsiveness:** All operations can be cancelled within 2 seconds
- **User Experience:** Clear progress indication and cancellation options
- **Data Integrity:** Partial results preserved when operations are cancelled
- **Performance:** Cancellation doesn't cause memory leaks or resource issues

## Testing Plan

1. **Cancellation Testing**
   - Test cancellation at various stages of operations
   - Verify clean resource cleanup
   - Test rapid cancel/restart scenarios

2. **Progress Reporting**
   - Verify accurate progress calculation
   - Test progress UI updates
   - Check progress persistence

3. **Edge Cases**
   - Network-mounted folders
   - Very large file collections
   - System resource constraints
   - Application restart during operations

## User Experience Improvements

### 1. Smart Cancellation

```javascript
// Offer smart cancellation options
class SmartCancellation {
  async cancelWithOptions(operationId) {
    const operation = this.operationManager.getOperationStatus(operationId);

    if (operation.name === 'metadata-extraction' && operation.progress > 50) {
      // Offer to keep already extracted data
      const keepPartial = await this.showDialog({
        title: 'Cancel Metadata Extraction',
        message: `${operation.progress}% complete. Keep data for processed videos?`,
        buttons: ['Keep Partial Data', 'Discard All', 'Continue'],
      });

      if (keepPartial === 'Continue') return false;

      operation.keepPartialResults = keepPartial === 'Keep Partial Data';
    }

    return this.operationManager.cancelOperation(operationId);
  }
}
```

### 2. Background Operations

```javascript
// Allow operations to continue in background
class BackgroundOperations {
  moveToBackground(operationId) {
    const operation = this.activeOperations.get(operationId);
    if (operation) {
      operation.inBackground = true;
      this.minimizeProgressUI(operationId);
      this.showBackgroundIndicator();
    }
  }

  showBackgroundIndicator() {
    // Small indicator showing background operations
    const indicator = document.getElementById('background-ops-indicator');
    indicator.style.display = 'block';
    indicator.textContent = `${this.getBackgroundOperationsCount()} operations running`;
  }
}
```

## Rollback Plan

- Feature flag to enable/disable cancellation system
- Graceful fallback to blocking operations
- Maintain backward compatibility with existing code

## Next Steps

After completion, this enables:

- Better user experience for all long-running operations
- Foundation for background processing
- More sophisticated progress reporting
- Ability to handle very large video collections without blocking UI
