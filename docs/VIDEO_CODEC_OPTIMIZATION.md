# Video Codec Optimization Guide

## The Codec Problem

**Not all video codecs are created equal!** Your GPU can decode some codecs **10-50x faster** than others.

With **6,300+ videos**, codec compatibility is critical for smooth playback.

---

## GPU Codec Support by Platform

### macOS (Apple Silicon M1/M2/M3)

✅ **Hardware Accelerated** (FAST):
- **H.264** (AVC) - ALL profiles (baseline, main, high)
- **HEVC** (H.265) - 8-bit and 10-bit
- **ProRes** - All variants
- **VP9** - Profile 0 and 2

❌ **Software Decoded** (SLOW):
- **AV1** - No hardware support yet on older Macs
- **VP8** - Software only
- **MPEG-2** - Software only

### macOS (Intel)

✅ **Hardware Accelerated** (FAST):
- **H.264** (AVC) - ALL profiles
- **HEVC** (H.265) - 8-bit only (10-bit is slow!)
- **VP9** - Partial support (depends on GPU)

❌ **Software Decoded** (SLOW):
- **AV1** - No support
- **10-bit HEVC** - Software fallback
- **VP8** - Software only

### Windows

✅ **Hardware Accelerated** (FAST):
- **H.264** (AVC) - ALL profiles (on most GPUs)
- **HEVC** (H.265) - Requires Windows 10+ and modern GPU
- **VP9** - Modern GPUs only (Intel 9th gen+, AMD Vega+, NVIDIA GTX 10+)
- **AV1** - Very modern GPUs (Intel 11th gen+, AMD RX 6000+, NVIDIA RTX 30+)

❌ **Software Decoded** (SLOW):
- Older codecs (MPEG-2, DivX, etc.)
- 10-bit HEVC on older hardware

### Linux

✅ **Hardware Accelerated** (FAST) with VA-API:
- **H.264** (AVC)
- **HEVC** (H.265) - Modern Intel/AMD GPUs
- **VP9** - Modern GPUs

❌ **Software Decoded** (SLOW):
- **AV1** - Limited support
- Older codecs

---

## Check Your Video Codecs

### Method 1: Use FFprobe (Command Line)

Check a single video:
```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,profile,pix_fmt,width,height \
  -of default=noprint_wrappers=1 \
  /path/to/video.mp4
```

**Output example**:
```
codec_name=h264
profile=High
pix_fmt=yuv420p
width=1920
height=1080
```

---

### Method 2: Scan All Videos

Create a script to check all your videos:

```bash
#!/bin/bash
# Save as: check_codecs.sh

echo "Scanning videos for codec information..."
echo "Codec,Profile,PixelFormat,Count" > codec_report.csv

find /path/to/videos -type f \( -name "*.mp4" -o -name "*.mkv" -o -name "*.mov" \) | while read file; do
  codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$file")
  profile=$(ffprobe -v error -select_streams v:0 -show_entries stream=profile -of default=noprint_wrappers=1:nokey=1 "$file")
  pixfmt=$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of default=noprint_wrappers=1:nokey=1 "$file")
  
  echo "$codec,$profile,$pixfmt" >> codec_data_temp.txt
done

# Count occurrences
sort codec_data_temp.txt | uniq -c | sort -rn >> codec_report.txt
rm codec_data_temp.txt

echo "Report saved to codec_report.txt"
```

Run it:
```bash
chmod +x check_codecs.sh
./check_codecs.sh
```

**Example output**:
```
   4253 h264,High,yuv420p
   1847 hevc,Main,yuv420p
    150 hevc,Main 10,yuv420p10le
     50 vp9,Profile 0,yuv420p
```

---

### Method 3: In Your App

Add a codec analyzer to your video scanner. Update `src/video-scanner.ts`:

```typescript
// Add this to track codecs during scan
interface CodecStats {
  [codec: string]: {
    count: number;
    profiles: Set<string>;
  };
}

const codecStats: CodecStats = {};

// After metadata extraction for each video
const codec = video.codec; // e.g., "h264"
const profile = video.profile; // e.g., "High"

if (!codecStats[codec]) {
  codecStats[codec] = { count: 0, profiles: new Set() };
}
codecStats[codec].count++;
if (profile) codecStats[codec].profiles.add(profile);

// After scan completes, log results
console.log('Codec Distribution:', JSON.stringify(codecStats, null, 2));
```

---

## Hardware Acceleration Compatibility Matrix

| Codec | Pixel Format | macOS (AS) | macOS (Intel) | Windows 10+ | Linux VA-API |
|-------|-------------|------------|---------------|-------------|--------------|
| **H.264 Baseline** | yuv420p | ✅ Fast | ✅ Fast | ✅ Fast | ✅ Fast |
| **H.264 Main** | yuv420p | ✅ Fast | ✅ Fast | ✅ Fast | ✅ Fast |
| **H.264 High** | yuv420p | ✅ Fast | ✅ Fast | ✅ Fast | ✅ Fast |
| **H.265 8-bit** | yuv420p | ✅ Fast | ✅ Fast | ✅ Fast (modern GPU) | ✅ Fast (modern GPU) |
| **H.265 10-bit** | yuv420p10le | ✅ Fast | ❌ Slow (SW) | ⚠️ Depends on GPU | ⚠️ Depends on GPU |
| **VP9** | yuv420p | ✅ Fast | ⚠️ Partial | ⚠️ Modern GPU only | ⚠️ Modern GPU only |
| **AV1** | yuv420p | ❌ Slow (SW) | ❌ Slow (SW) | ⚠️ Very new GPU | ❌ Slow (SW) |

**Legend**:
- ✅ = Hardware accelerated, smooth playback
- ⚠️ = Depends on hardware, may be slow
- ❌ = Software decoded, very slow

---

## Optimization Strategies

### Strategy 1: Identify Problem Codecs

**Goal**: Find which videos are causing performance issues

1. Run codec analysis (see above)
2. Look for these "problem codecs":
   - **10-bit HEVC** (h265 Main 10 profile)
   - **VP8** (old YouTube codec)
   - **AV1** (too new for most hardware)
   - **Old codecs** (MPEG-2, DivX, etc.)

**Example analysis**:
```
4253 videos: H.264 (yuv420p) ← ✅ GOOD (hardware accelerated)
1847 videos: H.265 8-bit (yuv420p) ← ✅ GOOD (hardware accelerated)
 150 videos: H.265 10-bit (yuv420p10le) ← ⚠️ PROBLEM (might be slow!)
  50 videos: VP9 ← ⚠️ PROBLEM (depends on GPU)
```

---

### Strategy 2: Test Problem Videos

**Goal**: Confirm which codecs cause stuttering

1. Create a test grid with only problem codec videos
2. Load 20-30 videos
3. Monitor CPU/GPU usage

**If CPU usage is >50%**: Those videos are NOT hardware accelerated

---

### Strategy 3: Transcode Problem Videos (Optional)

**Goal**: Convert slow videos to fast codecs

#### Option A: Transcode to H.264 (Most Compatible)

```bash
#!/bin/bash
# Convert video to H.264 (hardware accelerated on all platforms)

INPUT="$1"
OUTPUT="${INPUT%.*}_h264.mp4"

ffmpeg -i "$INPUT" \
  -c:v libx264 \
  -preset medium \
  -crf 23 \
  -pix_fmt yuv420p \
  -c:a aac \
  -b:a 192k \
  "$OUTPUT"
```

**Pros**:
- ✅ Universal hardware acceleration
- ✅ Best compatibility
- ✅ Smaller file sizes

**Cons**:
- ⚠️ Lossy conversion (quality loss)
- ⚠️ Takes time to transcode

---

#### Option B: Transcode Only 10-bit HEVC → 8-bit HEVC

```bash
#!/bin/bash
# Convert 10-bit HEVC to 8-bit HEVC (faster on most hardware)

INPUT="$1"
OUTPUT="${INPUT%.*}_8bit.mp4"

ffmpeg -i "$INPUT" \
  -c:v libx265 \
  -preset medium \
  -crf 28 \
  -pix_fmt yuv420p \
  -c:a copy \
  "$OUTPUT"
```

**Pros**:
- ✅ Hardware accelerated on more systems
- ✅ Keeps audio untouched
- ✅ Still good quality

**Cons**:
- ⚠️ Still HEVC (not all systems support it)
- ⚠️ Larger than H.264

---

### Strategy 4: Smart Loading Based on Codec

**Goal**: Load fewer videos if they use slow codecs

Add codec-aware loading to your app:

```typescript
// In video-scanner.ts or metadata extraction
interface VideoWithCodec extends Video {
  codec: string;
  isHardwareAccelerated: boolean;
}

// Check if codec is hardware accelerated
function isHardwareAccelerated(codec: string, profile?: string): boolean {
  const platform = process.platform;
  
  // H.264 is always hardware accelerated
  if (codec === 'h264') return true;
  
  // H.265 8-bit is usually hardware accelerated
  if (codec === 'hevc' || codec === 'h265') {
    // 10-bit is slow on Intel Macs and older hardware
    if (profile?.includes('10')) {
      return platform === 'darwin' && process.arch === 'arm64'; // Only Apple Silicon
    }
    return true; // 8-bit HEVC
  }
  
  // VP9 depends on GPU (assume yes on Apple Silicon)
  if (codec === 'vp9') {
    return platform === 'darwin' && process.arch === 'arm64';
  }
  
  // Everything else is likely software decoded
  return false;
}

// Adjust max videos based on codec mix
function calculateMaxVideos(videos: VideoWithCodec[]): number {
  const hwAccelCount = videos.filter(v => v.isHardwareAccelerated).length;
  const swDecodedCount = videos.length - hwAccelCount;
  
  if (swDecodedCount === 0) {
    return 50; // All hardware accelerated, can load many
  } else if (swDecodedCount < 10) {
    return 40; // A few slow ones, reduce slightly
  } else {
    return 30; // Many slow codecs, be conservative
  }
}
```

Then in `renderer.js`:
```javascript
// Adjust maxActiveVideos based on codec distribution
const maxVideos = calculateMaxVideos(this.allVideos);
this.smartLoader.updateConfig({ maxActiveVideos: maxVideos });
```

---

## Recommended Workflow

### For Your 6,300 Videos

#### Step 1: Analyze Codec Distribution

Run the codec analysis script on your collection:
```bash
./check_codecs.sh /path/to/your/videos
```

Expected result:
```
Codec Distribution:
- H.264: 70-90% (fast)
- H.265 8-bit: 10-20% (usually fast)
- H.265 10-bit: 0-10% (might be slow)
- Other: 0-5% (usually slow)
```

---

#### Step 2: Identify Performance Impact

Calculate potential impact:
```javascript
// If you have:
// 5670 H.264 videos (90%)
//  567 H.265 8-bit videos (9%)
//   63 H.265 10-bit videos (1%)

// Impact assessment:
// - 90% of videos will be fast
// - 9% will be fast on modern GPUs
// - 1% might be slow (10-bit HEVC)

// With 50 videos loaded:
// Expected: 45 fast + 4-5 fast + 0-1 slow = Good performance
```

**If >5% of your videos are slow codecs**, consider transcoding or reducing `maxActiveVideos`.

---

#### Step 3: Make Decision

**Option A: Good Codec Mix (>90% H.264/H.265)**
- ✅ Keep current settings
- ✅ Enable hardware acceleration (previous guide)
- ✅ Test with your actual videos

**Option B: Some Problem Codecs (5-10% slow)**
- ⚠️ Reduce `maxActiveVideos` from 50 to 30-40
- ⚠️ Consider transcoding problem videos
- ⚠️ Monitor CPU usage

**Option C: Many Problem Codecs (>10% slow)**
- ❌ Reduce `maxActiveVideos` to 20-30
- ❌ Seriously consider batch transcoding
- ❌ Or accept higher CPU usage

---

## Batch Transcode Script

If you decide to transcode problematic videos:

```bash
#!/bin/bash
# batch_transcode.sh
# Converts 10-bit HEVC videos to 8-bit H.264 for better compatibility

QUALITY=23  # Lower = better quality (18-28 recommended)
INPUT_DIR="$1"
OUTPUT_DIR="${INPUT_DIR}_transcoded"

mkdir -p "$OUTPUT_DIR"

echo "Finding 10-bit HEVC videos..."
find "$INPUT_DIR" -type f \( -name "*.mp4" -o -name "*.mkv" -o -name "*.mov" \) | while read input_file; do
  
  # Check if it's 10-bit HEVC
  pix_fmt=$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of default=noprint_wrappers=1:nokey=1 "$input_file")
  codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$input_file")
  
  if [[ "$codec" == "hevc" && "$pix_fmt" == "yuv420p10le" ]]; then
    echo "Converting: $input_file"
    
    relative_path="${input_file#$INPUT_DIR/}"
    output_file="$OUTPUT_DIR/${relative_path%.*}_h264.mp4"
    output_dir=$(dirname "$output_file")
    
    mkdir -p "$output_dir"
    
    # Transcode with hardware acceleration if available
    ffmpeg -hwaccel auto -i "$input_file" \
      -c:v libx264 \
      -preset medium \
      -crf $QUALITY \
      -pix_fmt yuv420p \
      -c:a aac \
      -b:a 192k \
      "$output_file"
    
    echo "✓ Converted: $output_file"
  fi
done

echo "Transcoding complete! Transcoded videos are in: $OUTPUT_DIR"
```

**Usage**:
```bash
chmod +x batch_transcode.sh
./batch_transcode.sh /path/to/your/videos
```

**This will**:
- Find all 10-bit HEVC videos
- Convert them to H.264 8-bit
- Save to a new directory
- Keep originals intact

---

## Performance Expectations

### With Hardware Acceleration + Good Codecs (H.264/H.265 8-bit)

**50 videos playing**:
- CPU: 10-30%
- GPU: 40-80%
- Smooth playback ✅

**30 videos playing**:
- CPU: 5-15%
- GPU: 20-50%
- Very smooth ✅

### With Software Decoding + Bad Codecs (10-bit HEVC, AV1)

**50 videos playing**:
- CPU: 80-100% ❌
- GPU: <10%
- Stuttering, dropped frames

**20 videos playing**:
- CPU: 40-60% ⚠️
- GPU: <10%
- Playable but choppy

---

## Quick Test: Check Hardware Acceleration

1. Load 20 H.264 videos
2. Monitor CPU usage

**If CPU < 20%**: ✅ Hardware acceleration is working!
**If CPU > 50%**: ❌ Hardware acceleration NOT working or bad codecs

---

## Summary

### For Your 6,300 Videos:

1. ✅ **Run codec analysis** to see what you have
2. ✅ **Enable hardware acceleration** (previous guide)
3. ✅ **Test with your actual videos**
4. ⚠️ **If stuttering**: Check if problem codecs exist
5. ⚠️ **Consider transcoding** 10-bit HEVC or other slow codecs
6. ✅ **Adjust maxActiveVideos** based on codec mix

**Most likely scenario**: If you have mostly H.264/H.265 videos, enabling hardware acceleration will fix everything. If you have exotic codecs (AV1, 10-bit HEVC), you might need to transcode or reduce concurrent videos.

**Next step**: Enable hardware acceleration first (see previous guide), then test with your videos to see if codec optimization is needed!
