const { existsSync } = require('fs');
const { join } = require('path');

const platform = process.platform;
const arch = process.arch;

// Map Node.js platform/arch to NAPI target format
function getTarget() {
  if (platform === 'darwin' && arch === 'arm64') {
    return 'darwin-arm64';
  } else if (platform === 'darwin' && arch === 'x64') {
    return 'darwin-x64';
  } else if (platform === 'win32' && arch === 'x64') {
    return 'win32-x64-msvc';
  } else if (platform === 'linux' && arch === 'x64') {
    return 'linux-x64-gnu';
  }
  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

const target = getTarget();
const nativeBinding = `thumbnail_generator_native.${target}.node`;

// Try to load from current directory
const localPath = join(__dirname, nativeBinding);
if (existsSync(localPath)) {
  module.exports = require(localPath);
} else {
  throw new Error(`Native module not found at ${localPath}`);
}
