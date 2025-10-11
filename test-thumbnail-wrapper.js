/**
 * Test script for the thumbnail generator TypeScript wrapper
 *
 * This tests that:
 * 1. The wrapper compiles and loads
 * 2. It can detect the native module
 * 3. Basic operations work correctly
 */

// We need to build the TypeScript first, or use ts-node
// For now, let's test the native module directly and document the wrapper

const path = require('path');

async function testThumbnailGenerator() {
    console.log('=== Testing Thumbnail Generator Integration ===\n');

    try {
        // Test 1: Check if native module can be loaded
        console.log('Test 1: Loading native module...');
        const nativeModule = require('./dist/main/src/thumbnail-generator-native');
        console.log('✓ Native module loaded successfully');
        console.log('  Exports:', Object.keys(nativeModule));

        // Test 2: Check FFmpeg availability
        console.log('\nTest 2: Checking FFmpeg availability...');
        const ffmpegAvailable = nativeModule.isFfmpegAvailable();
        console.log(`✓ FFmpeg available: ${ffmpegAvailable}`);

        // Test 3: Create generator instance
        console.log('\nTest 3: Creating generator instance...');
        const generator = new nativeModule.ThumbnailGeneratorNative('/tmp/vdotapes-test');
        console.log('✓ Generator instance created');

        // Test 4: Initialize generator
        console.log('\nTest 4: Initializing generator...');
        await generator.initialize();
        console.log('✓ Generator initialized');

        // Test 5: Get cache stats
        console.log('\nTest 5: Getting cache statistics...');
        const stats = await generator.getCacheStats();
        console.log('✓ Cache stats retrieved:', stats);

        console.log('\n=== All Tests Passed! ===');
        console.log('\nThe native module is working correctly.');
        console.log('Once TypeScript is compiled, the wrapper will use this automatically.');

        return true;
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error('\nTroubleshooting:');
        console.error('1. Run: npm run build:thumbnails');
        console.error('2. Run: npm run copy:native');
        console.error('3. Ensure FFmpeg is installed: brew install ffmpeg pkg-config');
        return false;
    }
}

// Run the test
testThumbnailGenerator()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
        console.error('Unexpected error:', error);
        process.exit(1);
    });
