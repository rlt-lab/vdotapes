// Simple test script for the native thumbnail generator
const { ThumbnailGeneratorNative } = require('./thumbnail_generator_native.darwin-arm64.node');

async function test() {
    console.log('Testing native thumbnail generator...\n');

    try {
        // Create generator instance
        const generator = new ThumbnailGeneratorNative('/tmp/vdotapes-test-thumbnails');
        console.log('✓ Generator instance created');

        // Initialize
        await generator.initialize();
        console.log('✓ Generator initialized');

        // Check FFmpeg availability
        const { isFfmpegAvailable } = require('./thumbnail_generator_native.darwin-arm64.node');
        const ffmpegAvailable = isFfmpegAvailable();
        console.log(`✓ FFmpeg available: ${ffmpegAvailable}`);

        // Get cache stats
        const stats = await generator.getCacheStats();
        console.log(`✓ Cache stats:`, stats);

        console.log('\n✅ All tests passed!');
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

test();
