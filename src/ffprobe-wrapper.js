const { spawn } = require('child_process');
const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

/**
 * FFprobe wrapper for video metadata extraction
 * Following KISS principle - straightforward command execution with error handling
 */
class FFprobeWrapper {
  constructor() {
    this.ffprobePath = null;
    this.initialized = false;
    this.defaultTimeout = 30000; // 30 seconds
    this.version = null;
  }

  /**
   * Initialize FFprobe wrapper - detect and verify installation
   */
  async initialize() {
    try {
      this.ffprobePath = await this.findFFprobe();
      this.version = await this.getVersion();
      this.initialized = true;
      console.log(`FFprobe initialized: ${this.version} at ${this.ffprobePath}`);
      return true;
    } catch (error) {
      console.error('Failed to initialize FFprobe:', error.message);
      this.initialized = false;
      return false;
    }
  }

  /**
   * Find FFprobe executable - try common locations
   * KISS: Simple path checking without complex discovery
   */
  async findFFprobe() {
    const isWindows = process.platform === 'win32';
    const exeName = isWindows ? 'ffprobe.exe' : 'ffprobe';

    const possiblePaths = [
      'ffprobe', // System PATH (works on all platforms if in PATH)
      // Windows-specific paths
      ...(isWindows ? [
        'ffprobe.exe',
        path.join(process.env.ProgramFiles || '', 'FFmpeg', 'bin', 'ffprobe.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'FFmpeg', 'bin', 'ffprobe.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'FFmpeg', 'bin', 'ffprobe.exe'),
        'C:\\FFmpeg\\bin\\ffprobe.exe',
      ] : []),
      // macOS/Linux paths
      '/usr/bin/ffprobe',
      '/usr/local/bin/ffprobe',
      '/opt/homebrew/bin/ffprobe', // Apple Silicon Homebrew
      // Bundled with app (platform-aware)
      path.join(process.resourcesPath || '', exeName),
      path.join(__dirname, '../bin', exeName),
    ];

    for (const probePath of possiblePaths) {
      try {
        // Quick version check to verify it's working
        execSync(`"${probePath}" -version`, {
          stdio: 'pipe',
          timeout: 5000,
          windowsHide: true,
        });
        return probePath;
      } catch (error) {
        // Try next path
        continue;
      }
    }

    throw new Error('FFprobe not found. Please install FFmpeg or ensure ffprobe is in PATH.');
  }

  /**
   * Get FFprobe version for debugging
   */
  async getVersion() {
    if (!this.ffprobePath) {
      throw new Error('FFprobe not initialized');
    }

    try {
      const output = execSync(`"${this.ffprobePath}" -version`, {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      });

      // Extract version from first line
      const match = output.match(/ffprobe version ([^\s]+)/);
      return match ? match[1] : 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Extract metadata from video file using FFprobe
   * KISS: Direct command execution with JSON output
   */
  async extractMetadata(videoPath, options = {}) {
    if (!this.initialized) {
      throw new Error('FFprobe not initialized. Call initialize() first.');
    }

    const timeout = options.timeout || this.defaultTimeout;

    try {
      // Verify file exists and is accessible
      await fs.access(videoPath);

      const rawOutput = await this.executeFFprobe(videoPath, timeout);
      const metadata = this.parseFFprobeOutput(rawOutput);

      return {
        success: true,
        metadata,
        filePath: videoPath,
        extractedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Metadata extraction failed for ${videoPath}:`, error.message);

      return {
        success: false,
        error: error.message,
        errorType: this.classifyError(error),
        filePath: videoPath,
        extractedAt: new Date().toISOString(),
        metadata: this.createFallbackMetadata(videoPath),
      };
    }
  }

  /**
   * Execute FFprobe command with proper error handling and timeout
   */
  executeFFprobe(videoPath, timeout) {
    return new Promise((resolve, reject) => {
      const args = [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        '-select_streams',
        'v:0', // First video stream only
        videoPath,
      ];

      const ffprobe = spawn(this.ffprobePath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let isTimeout = false;

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        isTimeout = true;
        ffprobe.kill('SIGKILL');
        reject(new Error(`FFprobe timeout after ${timeout}ms`));
      }, timeout);

      // Collect output
      ffprobe.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ffprobe.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle process completion
      ffprobe.on('close', (code) => {
        clearTimeout(timeoutHandle);

        if (isTimeout) return; // Already handled by timeout

        if (code !== 0) {
          const errorMsg = stderr || `FFprobe exited with code ${code}`;
          reject(new Error(errorMsg));
          return;
        }

        if (!stdout.trim()) {
          reject(new Error('FFprobe returned empty output'));
          return;
        }

        resolve(stdout);
      });

      // Handle spawn errors
      ffprobe.on('error', (error) => {
        clearTimeout(timeoutHandle);
        if (!isTimeout) {
          reject(new Error(`Failed to spawn FFprobe: ${error.message}`));
        }
      });
    });
  }

  /**
   * Parse FFprobe JSON output into structured metadata
   * YAGNI: Only extract fields we actually need
   */
  parseFFprobeOutput(jsonOutput) {
    try {
      const data = JSON.parse(jsonOutput);
      const format = data.format || {};
      const videoStream = data.streams?.find((s) => s.codec_type === 'video');
      const audioStream = data.streams?.find((s) => s.codec_type === 'audio');

      if (!videoStream) {
        throw new Error('No video stream found in file');
      }

      return {
        // Basic properties
        duration: this.parseFloat(format.duration),
        fileSize: this.parseInt(format.size),
        bitrate: this.parseInt(format.bit_rate),

        // Video properties
        width: this.parseInt(videoStream.width),
        height: this.parseInt(videoStream.height),
        codec: videoStream.codec_name || null,
        pixelFormat: videoStream.pix_fmt || null,
        frameRate: this.parseFrameRate(videoStream.r_frame_rate),

        // Calculated properties
        aspectRatio: this.calculateAspectRatio(videoStream.width, videoStream.height),
        resolution: this.getResolutionCategory(videoStream.width, videoStream.height),

        // Audio properties
        hasAudio: !!audioStream,
        audioCodec: audioStream?.codec_name || null,
        audioChannels: this.parseInt(audioStream?.channels),

        // Additional metadata
        formatName: format.format_name || null,
        title: format.tags?.title || null,
        creationTime: this.parseCreationTime(format.tags?.creation_time),

        // Quality assessment
        isValid: this.validateMetadata(videoStream, format),
      };
    } catch (error) {
      throw new Error(`Failed to parse FFprobe output: ${error.message}`);
    }
  }

  /**
   * Helper functions for parsing with null safety
   */
  parseFloat(value) {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }

  parseInt(value) {
    const parsed = parseInt(value);
    return isNaN(parsed) ? null : parsed;
  }

  parseFrameRate(frameRateStr) {
    if (!frameRateStr || frameRateStr === '0/0') return null;

    try {
      const [num, den] = frameRateStr.split('/').map(Number);
      return den && den !== 0 ? num / den : null;
    } catch {
      return null;
    }
  }

  calculateAspectRatio(width, height) {
    if (!width || !height) return null;

    const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(width, height);
    return `${width / divisor}:${height / divisor}`;
  }

  getResolutionCategory(width, height) {
    if (!width || !height) return null;

    const pixels = width * height;
    if (pixels >= 7680 * 4320) return '8K';
    if (pixels >= 3840 * 2160) return '4K';
    if (pixels >= 1920 * 1080) return '1080p';
    if (pixels >= 1280 * 720) return '720p';
    if (pixels >= 854 * 480) return '480p';
    return 'SD';
  }

  parseCreationTime(creationTime) {
    if (!creationTime) return null;

    try {
      return new Date(creationTime).getTime();
    } catch {
      return null;
    }
  }

  validateMetadata(videoStream, format) {
    return !!(videoStream?.width && videoStream?.height && format?.duration);
  }

  /**
   * Classify error types for better error handling
   */
  classifyError(error) {
    const message = error.message.toLowerCase();

    if (message.includes('timeout')) return 'timeout';
    if (message.includes('no such file') || message.includes('cannot open'))
      return 'file_not_found';
    if (message.includes('permission denied')) return 'permission_denied';
    if (message.includes('invalid data') || message.includes('no video stream'))
      return 'invalid_format';
    if (message.includes('spawn') || message.includes('not found')) return 'ffprobe_missing';

    return 'unknown';
  }

  /**
   * Create fallback metadata for failed extractions
   */
  createFallbackMetadata(videoPath) {
    return {
      duration: null,
      fileSize: null,
      bitrate: null,
      width: null,
      height: null,
      codec: null,
      pixelFormat: null,
      frameRate: null,
      aspectRatio: null,
      resolution: null,
      hasAudio: true, // Assume true for fallback
      audioCodec: null,
      audioChannels: null,
      formatName: null,
      title: path.basename(videoPath, path.extname(videoPath)),
      creationTime: null,
      isValid: false,
    };
  }

  /**
   * Check if FFprobe is available and working
   */
  async isAvailable() {
    try {
      await this.initialize();
      return this.initialized;
    } catch {
      return false;
    }
  }

  /**
   * Get wrapper status for debugging
   */
  getStatus() {
    return {
      initialized: this.initialized,
      ffprobePath: this.ffprobePath,
      version: this.version,
      timeout: this.defaultTimeout,
    };
  }
}

module.exports = FFprobeWrapper;
