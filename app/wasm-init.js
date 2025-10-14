// WASM Module Initialization
// Moved from inline script to fix CSP

import init, { VideoGridEngine } from './wasm/video_grid_wasm.js';

// Initialize WASM module
async function loadWasm() {
  try {
    await init();
    window.VideoGridEngine = VideoGridEngine;
    console.log('✅ WASM Grid Engine loaded successfully!');

    // Dispatch event to signal WASM is ready
    window.dispatchEvent(new Event('wasm-ready'));
  } catch (error) {
    console.error('❌ Failed to load WASM Grid Engine:', error);
    // Fallback: app will work without WASM, just slower
    window.dispatchEvent(new Event('wasm-failed'));
  }
}

loadWasm();
