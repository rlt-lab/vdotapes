# Architecture Analysis: Why Current Approach Fails

## Current Architecture Issues

### 1. IntersectionObserver Fundamentals

**The Problem:**
```javascript
// Browser decides WHEN this fires
observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) loadVideo();
  });
});
```

**Why it fails:**
- Browser batches callbacks unpredictably
- Can miss entries during rapid scrolling
- No guarantee of callback order
- Different behavior across browsers
- We don't control timing

**Result:** Random videos don't load, no deterministic behavior

### 2. Video Element Lifecycle

**Current (Wrong):**
```javascript
// Clear src but element stays in DOM
video.src = '';
video.load();  // Releases player, but element remains
```

**Problem:**
- DOM element still exists (memory)
- Event listeners still attached
- IntersectionObserver still watching it
- Can be re-observed with stale state

**Better:**
```javascript
// Actually remove from DOM
video.remove();
delete elementPool[videoId];
```

### 3. State Management Split

**Current:**
- JavaScript Set tracks loaded videos
- DOM has actual video elements  
- WASM has viewport calculations
- **All three can get out of sync!**

**Result:** JavaScript thinks video is loaded, DOM has empty element, WASM says it's visible

### 4. Chrome's WebMediaPlayer Limit

**Hard facts:**
- Chrome limits ~75 WebMediaPlayer instances process-wide
- This includes ALL tabs, not just our app
- Creating/destroying rapidly hits hidden limits
- No amount of cleanup prevents hitting this eventually

**Current approach:**
- Loads 12-24 videos at once
- With 4 columns = 3-6 rows
- Destroys and creates players constantly while scrolling
- Accumulation is inevitable

## Why Rust/WASM Should Handle More

### What Rust Is Good At

1. **Deterministic Viewport Calculation**
   ```rust
   // Exact math, no browser behavior
   let visible_start = (scroll_top / item_height) as usize;
   let visible_end = ((scroll_top + viewport_height) / item_height) as usize;
   ```

2. **State Management**
   ```rust
   struct VideoState {
       loaded: HashSet<String>,
       in_viewport: HashSet<String>,
       lru_queue: VecDeque<String>,
       last_access: HashMap<String, Instant>,
   }
   ```
   
   All in one place, always consistent.

3. **Element Pool Management**
   ```rust
   struct ElementPool {
       available: Vec<VideoElement>,
       in_use: HashMap<String, VideoElement>,
       max_size: usize,
   }
   
   impl ElementPool {
       fn get_or_create(&mut self, video_id: &str) -> VideoElement {
           // Reuse existing element if available
           self.available.pop().unwrap_or_else(|| create_element())
       }
       
       fn recycle(&mut self, element: VideoElement) {
           element.clear();
           self.available.push(element);
       }
   }
   ```

4. **Hard Limits Enforcement**
   ```rust
   fn can_load_video(&self) -> bool {
       self.loaded.len() < MAX_PLAYERS  // Hard stop, no exceptions
   }
   ```

### What JavaScript Should Do (Minimal)

```javascript
// Just apply Rust's decisions
function applyDomOperations(operations) {
  operations.forEach(op => {
    switch (op.type) {
      case 'AttachVideo':
        const element = elementPool.get();
        element.src = op.video_path;
        container.appendChild(element);
        break;
        
      case 'DetachVideo':
        const element = document.querySelector(`[data-id="${op.video_id}"]`);
        element.src = '';
        elementPool.recycle(element);
        element.remove();
        break;
    }
  });
}
```

No logic, no state tracking, just DOM manipulation.

## Proposed: Virtual Scrolling with Rust

### Architecture

```
User Scrolls
    ↓
Rust calculates viewport (scroll position → visible range)
    ↓
Rust determines operations (add video_3, remove video_15, move video_7)
    ↓
Rust checks limits (can we create another player? no → keep existing)
    ↓
Rust returns minimal DomOperations
    ↓
JS applies operations (just DOM updates)
    ↓
JS notifies Rust of load success/error
    ↓
Rust updates state (LRU, loaded set, etc)
```

### Why This Works

1. **Deterministic** - Rust math, not browser callbacks
2. **Minimal DOM** - Only render visible items + small buffer
3. **Element Reuse** - Never destroy/create, just change src
4. **Hard Limits** - Rust enforces max players, JS can't exceed
5. **Single Source of Truth** - Rust has all state

### Implementation Sketch

```rust
// video_virtual_scroller.rs

#[wasm_bindgen]
pub struct VirtualScroller {
    videos: Vec<VideoItem>,
    element_pool: ElementPool,
    viewport: Viewport,
    state: VideoState,
    max_players: usize,  // Hard limit: 6
}

#[wasm_bindgen]
impl VirtualScroller {
    #[wasm_bindgen(js_name = onScroll)]
    pub fn on_scroll(&mut self, scroll_top: f64) -> JsValue {
        // 1. Calculate visible range
        let (start, end) = self.calc_visible_range(scroll_top);
        
        // 2. Determine what's needed
        let needed_videos: Vec<&VideoItem> = self.videos[start..end].iter().collect();
        
        // 3. Get current loaded
        let currently_loaded = self.state.loaded.clone();
        
        // 4. Calculate operations with hard limit
        let mut ops = Vec::new();
        
        // Unload videos outside viewport (prioritize unloading)
        for video_id in &currently_loaded {
            if !needed_videos.iter().any(|v| &v.id == video_id) {
                ops.push(DomOperation::Detach { video_id: video_id.clone() });
                self.state.unload(video_id);
            }
        }
        
        // Load videos in viewport (but only if under limit)
        for video in needed_videos {
            if !currently_loaded.contains(&video.id) {
                if self.state.loaded.len() < self.max_players {
                    ops.push(DomOperation::Attach {
                        video_id: video.id.clone(),
                        video_path: video.path.clone(),
                        position: /* calculate position */,
                    });
                    self.state.load(&video.id);
                } else {
                    // Hit limit, stop loading
                    break;
                }
            }
        }
        
        // Return operations
        to_value(&ops).unwrap()
    }
    
    #[wasm_bindgen(js_name = notifyLoaded)]
    pub fn notify_loaded(&mut self, video_id: String) {
        self.state.mark_loaded(&video_id);
    }
    
    #[wasm_bindgen(js_name = notifyError)]
    pub fn notify_error(&mut self, video_id: String) {
        self.state.mark_error(&video_id);
        self.state.unload(&video_id);
    }
}
```

### JavaScript (Thin Layer)

```javascript
// Virtual scroller coordinator
class VirtualScrollCoordinator {
  constructor(scroller) {
    this.scroller = scroller;  // Rust VirtualScroller
    this.elementPool = new VideoElementPool();
    
    window.addEventListener('scroll', () => {
      const ops = this.scroller.onScroll(window.scrollY);
      this.applyOperations(ops);
    });
  }
  
  applyOperations(operations) {
    operations.forEach(op => {
      switch (op.type) {
        case 'Attach':
          const element = this.elementPool.acquire();
          element.dataset.videoId = op.video_id;
          element.src = op.video_path;
          element.style.top = op.position.top + 'px';
          element.style.left = op.position.left + 'px';
          
          element.addEventListener('loadedmetadata', () => {
            this.scroller.notifyLoaded(op.video_id);
          });
          
          element.addEventListener('error', () => {
            this.scroller.notifyError(op.video_id);
          });
          
          container.appendChild(element);
          break;
          
        case 'Detach':
          const el = document.querySelector(`[data-video-id="${op.video_id}"]`);
          if (el) {
            el.src = '';
            el.load();
            el.remove();
            this.elementPool.release(el);
          }
          break;
      }
    });
  }
}
```

## Why MAX_PLAYERS Should Be 6 (Not 12)

**Chrome's limit breakdown:**
- Total limit: ~75 players
- Background tabs: ~10-20 players
- System overhead: ~10 players
- **Safe app limit: ~45 players**

**But rapid creation/destruction:**
- Chrome doesn't instantly free players
- Garbage collection lag
- Hidden players not fully destroyed
- **Effective safe limit with churn: ~15 players**

**With scroll behavior:**
- User scrolls up/down constantly
- Creating and destroying every second
- Accumulation happens
- **Conservative safe limit: 6-8 players**

**Why 6 works:**
- 4 columns × 1.5 rows = 6 videos visible
- No buffer needed (Rust loads instantly)
- Room for 1-2 "zombie" players still cleaning up
- Far from any limit

## Immediate Actions (No Architecture Change)

Even without rewriting, we can:

1. **Set MAX to 6** (not 12)
   ```javascript
   maxActiveVideos: 6  // Very conservative
   ```

2. **Actually remove elements**
   ```javascript
   video.remove();  // Not just video.src = ''
   ```

3. **Use WASM's reconciliation results**
   ```javascript
   const result = wasmEngine.calculateViewport(/*...*/);
   applyDomOperations(result.operations);  // We ignored this!
   ```

4. **Force clear cache**
   ```bash
   rm -rf ~/Library/Application\ Support/vdotapes/
   ```

## Long-Term: Full Rust Virtual Scroller

**Effort:** ~2-3 days

**Files to create:**
- `src/video-grid-wasm/src/virtual_scroller.rs`
- `src/video-grid-wasm/src/element_pool.rs`
- `app/virtual-scroll-coordinator.js` (thin layer)

**Benefits:**
- Deterministic viewport calculation
- Hard player limits enforced in Rust
- Element reuse (never destroy/create)
- Single source of truth for state
- No browser callback unpredictability

**Trade-offs:**
- More complex initial implementation
- Slightly more rigid UI (fixed item heights)
- Need to handle window resize in Rust

## Recommendation

**Immediate (Today):**
1. Set maxActiveVideos to 6
2. Actually remove video elements from DOM
3. Clear Electron cache completely
4. Test if THIS finally works

**Short-term (This Week):**
1. Use WASM reconciliation results (already computed!)
2. Implement element pool in JavaScript
3. Reduce to 4-5 videos max

**Long-term (Next Sprint):**
1. Full virtual scroller in Rust
2. Element reuse strategy
3. Zero video destruction during scroll
4. Target: Handle 10,000+ videos smoothly

The issue isn't TypeScript vs Rust for the backend. The issue is we built a WASM viewport manager and then used IntersectionObserver instead of using it!
