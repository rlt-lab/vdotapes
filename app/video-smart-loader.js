/**
 * Smart Video Loader - Lightweight alternative to heavy virtualization
 * Renders all videos but intelligently manages video loading and playback
 */

class VideoSmartLoader {
    constructor(options = {}) {
        this.loadBuffer = options.loadBuffer || 20; // Videos to keep loaded above/below viewport
        this.observer = null;
        this.loadedVideos = new Set();
        this.activeVideos = new Set();
        this.maxActiveVideos = options.maxActiveVideos || 30;
        
        // Performance tracking
        this.lastCleanup = Date.now();
        this.cleanupInterval = 10000; // 10 seconds
        
        this.init();
    }
    
    init() {
        this.setupIntersectionObserver();
        this.startPeriodicCleanup();
    }
    
    setupIntersectionObserver() {
        // Simple, fast observer - just for loading/unloading
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const video = entry.target.querySelector('video');
                if (!video) return;
                
                const videoId = entry.target.dataset.videoId;
                
                if (entry.isIntersecting) {
                    // Load and play video
                    this.loadVideo(video, entry.target, videoId);
                } else {
                    // Just pause, don't unload immediately
                    this.pauseVideo(video, videoId);
                }
            });
        }, {
            root: null,
            rootMargin: '500px', // Large margin for smooth loading
            threshold: 0.1
        });
    }
    
    observeVideoItems(container) {
        const videoItems = container.querySelectorAll('.video-item');
        videoItems.forEach(item => {
            this.observer.observe(item);
        });
    }
    
    loadVideo(videoElement, container, videoId) {
        const src = videoElement.dataset.src;
        if (!src) return;
        
        // If video is already loaded, just resume
        if (this.loadedVideos.has(videoId)) {
            this.resumeVideo(videoElement, videoId);
            return;
        }
        
        // Load video for the first time
        if (!videoElement.src) {
            container.classList.add('loading');
            
            videoElement.src = src;
            videoElement.preload = 'metadata';
            
            const handleLoad = () => {
                container.classList.remove('loading');
                videoElement.classList.add('loaded');
                this.loadedVideos.add(videoId);
                this.startVideoPlayback(videoElement, videoId);
            };
            
            const handleError = () => {
                container.classList.remove('loading');
                container.classList.add('error');
            };
            
            videoElement.addEventListener('loadedmetadata', handleLoad, { once: true });
            videoElement.addEventListener('error', handleError, { once: true });
        } else {
            this.resumeVideo(videoElement, videoId);
        }
    }
    
    startVideoPlayback(videoElement, videoId) {
        try {
            this.activeVideos.add(videoId);
            
            if (videoElement.duration && videoElement.duration > 20) {
                this.setupPreviewLoop(videoElement);
            } else {
                videoElement.play().catch(() => {});
            }
        } catch (error) {
            videoElement.play().catch(() => {});
        }
    }
    
    setupPreviewLoop(video) {
        const duration = video.duration;
        if (!duration || isNaN(duration) || duration <= 0) {
            video.play().catch(() => {});
            return;
        }
        
        const midpoint = duration / 2;
        const halfDuration = 2.5; // 5 second preview
        const start = Math.max(0, midpoint - halfDuration);
        const end = Math.min(duration, midpoint + halfDuration);
        
        if (video._loopHandler) {
            video.removeEventListener('timeupdate', video._loopHandler);
        }
        
        const loopHandler = () => {
            if (video.currentTime >= end) {
                video.currentTime = start;
            }
        };
        
        video._loopHandler = loopHandler;
        video.addEventListener('timeupdate', loopHandler);
        
        video.addEventListener('seeked', () => video.play().catch(() => {}), { once: true });
        video.currentTime = start;
    }
    
    resumeVideo(videoElement, videoId) {
        if (videoElement.paused && videoElement.src) {
            this.activeVideos.add(videoId);
            
            if (videoElement.duration && videoElement.duration > 20 && !videoElement._loopHandler) {
                this.setupPreviewLoop(videoElement);
            } else {
                videoElement.play().catch(() => {});
            }
        }
    }
    
    pauseVideo(videoElement, videoId) {
        if (!videoElement.paused) {
            videoElement.pause();
        }
        this.activeVideos.delete(videoId);
    }
    
    startPeriodicCleanup() {
        setInterval(() => {
            this.performCleanup();
        }, this.cleanupInterval);
    }
    
    performCleanup() {
        // If we have too many active videos, clean up the oldest ones
        if (this.activeVideos.size > this.maxActiveVideos) {
            const videoItems = document.querySelectorAll('.video-item');
            const visibleVideos = new Set();
            
            // Find currently visible videos
            videoItems.forEach(item => {
                const rect = item.getBoundingClientRect();
                const isVisible = rect.top < window.innerHeight + 200 && rect.bottom > -200;
                
                if (isVisible) {
                    visibleVideos.add(item.dataset.videoId);
                }
            });
            
            // Clean up non-visible videos
            videoItems.forEach(item => {
                const videoId = item.dataset.videoId;
                const video = item.querySelector('video');
                
                if (!visibleVideos.has(videoId) && this.loadedVideos.has(videoId)) {
                    // Unload video to free memory
                    if (video && video.src) {
                        video.pause();
                        video.src = '';
                        video.load(); // Reset video element
                        
                        if (video._loopHandler) {
                            video.removeEventListener('timeupdate', video._loopHandler);
                            video._loopHandler = null;
                        }
                    }
                    
                    this.loadedVideos.delete(videoId);
                    this.activeVideos.delete(videoId);
                    item.classList.remove('loading');
                    item.querySelector('video')?.classList.remove('loaded');
                }
            });
            
            console.log(`Cleanup: ${this.loadedVideos.size} videos loaded, ${this.activeVideos.size} active`);
        }
    }
    
    // Public methods
    getStats() {
        return {
            loadedVideos: this.loadedVideos.size,
            activeVideos: this.activeVideos.size,
            maxActiveVideos: this.maxActiveVideos
        };
    }
    
    destroy() {
        if (this.observer) {
            this.observer.disconnect();
        }
        this.loadedVideos.clear();
        this.activeVideos.clear();
    }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VideoSmartLoader;
} else {
    window.VideoSmartLoader = VideoSmartLoader;
}