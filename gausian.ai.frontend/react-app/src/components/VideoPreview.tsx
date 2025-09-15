import React, { useRef, useEffect, useState, useMemo } from "react";
import type { Track } from "../types";
import { retryManager, errorHandler, ErrorType } from "../utils/errorHandling";

interface VideoPreviewProps {
  tracks: Track[];
  currentFrame: number;
  fps: number;
  isPlaying: boolean;
  isUserSeeking?: boolean; // Add this prop to track manual seeking
}

interface VideoItem {
  id: string;
  src: string;
  from: number;
  durationInFrames: number;
  trackIndex: number;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({
  tracks,
  currentFrame,
  fps,
  isPlaying,
  isUserSeeking = false,
}) => {
  const [videoItems, setVideoItems] = useState<VideoItem[]>([]);
  const [videoErrors, setVideoErrors] = useState<{ [key: string]: string }>({});
  const [videoLoaded, setVideoLoaded] = useState<{ [key: string]: boolean }>(
    {}
  );
  const [videoRetrying, setVideoRetrying] = useState<{ [key: string]: boolean }>({});
  const videoRefs = useRef<{ [key: string]: HTMLVideoElement | null }>({});

  // Extract all video items from tracks
  useEffect(() => {
    const videos: VideoItem[] = [];
    tracks.forEach((track, trackIndex) => {
      track.items.forEach((item) => {
        if (item.type === "video") {
          videos.push({
            id: item.id,
            src: item.src,
            from: item.from,
            durationInFrames: item.durationInFrames,
            trackIndex,
          });
        }
      });
    });
    setVideoItems(videos);

    // Clean up video references and states for removed videos
    const currentVideoIds = new Set(videos.map((v) => v.id));

    // Clean up videoRefs
    Object.keys(videoRefs.current).forEach((videoId) => {
      if (!currentVideoIds.has(videoId)) {
        const videoElement = videoRefs.current[videoId];
        if (videoElement) {
          videoElement.pause();
          videoElement.src = "";
          videoElement.load();
        }
        delete videoRefs.current[videoId];
        // Clean up retry timers
        retryManager.clearTimer(`video-load-${videoId}`);
      }
    });

    // Clean up videoLoaded states
    setVideoLoaded((prev) => {
      const newState = { ...prev };
      Object.keys(newState).forEach((videoId) => {
        if (!currentVideoIds.has(videoId)) {
          delete newState[videoId];
        }
      });
      return newState;
    });

    // Clean up videoErrors states
    setVideoErrors((prev) => {
      const newState = { ...prev };
      Object.keys(newState).forEach((videoId) => {
        if (!currentVideoIds.has(videoId)) {
          delete newState[videoId];
        }
      });
      return newState;
    });

    // Clean up videoRetrying states
    setVideoRetrying((prev) => {
      const newState = { ...prev };
      Object.keys(newState).forEach((videoId) => {
        if (!currentVideoIds.has(videoId)) {
          delete newState[videoId];
        }
      });
      return newState;
    });
  }, [tracks]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      // Clean up all retry timers
      videoItems.forEach(video => {
        retryManager.clearTimer(`video-load-${video.id}`);
      });
    };
  }, [videoItems]);

  // Find the active video based on playhead position and track priority
  const activeVideo = useMemo(() => {
    const videosAtCurrentFrame = videoItems.filter((videoItem) => {
      const videoStartFrame = videoItem.from;
      const videoEndFrame = videoItem.from + videoItem.durationInFrames;
      return currentFrame >= videoStartFrame && currentFrame < videoEndFrame;
    });

    if (videosAtCurrentFrame.length === 0) {
      return null;
    }

    // Sort by track index (lower number = higher priority) and return the first one
    return videosAtCurrentFrame.sort((a, b) => a.trackIndex - b.trackIndex)[0];
  }, [videoItems, currentFrame]);

  // Sync only the active video with timeline
  useEffect(() => {
    if (!activeVideo) {
      // Hide all videos when no active video
      videoItems.forEach((videoItem) => {
        const videoElement = videoRefs.current[videoItem.id];
        if (videoElement) {
          videoElement.style.display = "none";
          videoElement.pause();
        }
      });
      return;
    }

    // Show only the active video and hide all others
    videoItems.forEach((videoItem) => {
      const videoElement = videoRefs.current[videoItem.id];
      if (!videoElement || !videoLoaded[videoItem.id]) return;

      if (videoItem.id === activeVideo.id) {
        // Show and sync the active video
        videoElement.style.display = "block";

        const videoStartFrame = videoItem.from;
        const videoFrame = currentFrame - videoStartFrame;
        const videoTime = videoFrame / fps;

        // Ensure videoTime is within valid range
        if (videoTime < 0) {
          videoElement.currentTime = 0;
        } else if (videoTime > videoElement.duration) {
          videoElement.currentTime = videoElement.duration;
        } else {
          // Only update if the difference is significant (more than 0.5 seconds) and not playing
          // This prevents constant seeking during playback which causes jumping
          if (
            Math.abs(videoElement.currentTime - videoTime) > 0.5 &&
            !isPlaying
          ) {
            videoElement.currentTime = videoTime;
          }
        }

        // Control playback based on global play state
        if (isPlaying) {
          // When resuming playback, respect manual seeking
          // If user was seeking, don't force sync immediately
          if (
            !isUserSeeking &&
            Math.abs(videoElement.currentTime - videoTime) > 1.0
          ) {
            videoElement.currentTime = videoTime;
          }
          videoElement.play().catch((error) => {
            console.log("Video play error:", error);
          });
        } else {
          videoElement.pause();
        }
      } else {
        // Hide all other videos and pause them
        videoElement.style.display = "none";
        videoElement.pause();
        // Reset other videos to their start time to prevent conflicts
        const otherVideoStartFrame = videoItem.from;
        const otherVideoTime = (currentFrame - otherVideoStartFrame) / fps;
        if (otherVideoTime >= 0 && otherVideoTime <= videoElement.duration) {
          videoElement.currentTime = otherVideoTime;
        }
      }
    });
  }, [
    activeVideo,
    currentFrame,
    fps,
    isPlaying,
    videoItems,
    videoLoaded,
    isUserSeeking,
  ]);

  // Handle video load events
  const handleVideoLoad = (videoId: string) => {
    const videoElement = videoRefs.current[videoId];
    if (videoElement) {
      videoElement.muted = true; // Mute for autoplay
      videoElement.loop = false;
      videoElement.controls = false; // Controls handled by outer UI
      setVideoLoaded((prev) => ({ ...prev, [videoId]: true }));
    }
  };

  const handleVideoError = async (videoId: string, error: string) => {
    console.error(`Video error for ${videoId}:`, error);
    console.log(`🎬 VideoPreview: Available video refs:`, Object.keys(videoRefs.current));
    console.log(`🎬 VideoPreview: Looking for video element with ID: ${videoId}`);
    
    // Log error to error handler
    errorHandler.logError('VideoPreview', errorHandler.createError(
      ErrorType.VIDEO_LOAD_FAILED,
      `Video ${videoId} failed to load: ${error}`,
      { videoId, error }
    ));

    // Try to retry loading the video
    const videoItem = videoItems.find(v => v.id === videoId);
    if (videoItem && videoItem.src) {
      console.log(`🎬 VideoPreview: Found video item for retry:`, videoItem);
      setVideoRetrying(prev => ({ ...prev, [videoId]: true }));
      
      try {
        await retryManager.retry(
          `video-load-${videoId}`,
          async () => {
            return new Promise<void>((resolve, reject) => {
              const videoElement = videoRefs.current[videoId];
              console.log(`🎬 VideoPreview: Retry - looking for video element:`, videoElement);
              if (!videoElement) {
                console.error(`🎬 VideoPreview: Video element not found for ID: ${videoId}`);
                console.log(`🎬 VideoPreview: Available refs:`, Object.keys(videoRefs.current));
                reject(new Error('Video element not found'));
                return;
              }

              // Clear previous error
              setVideoErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[videoId];
                return newErrors;
              });

              // Try to reload the video
              videoElement.load();
              
              const handleLoad = () => {
                videoElement.removeEventListener('loadeddata', handleLoad);
                videoElement.removeEventListener('error', handleError);
                setVideoRetrying(prev => ({ ...prev, [videoId]: false }));
                resolve();
              };

              const handleError = () => {
                videoElement.removeEventListener('loadeddata', handleLoad);
                videoElement.removeEventListener('error', handleError);
                setVideoRetrying(prev => ({ ...prev, [videoId]: false }));
                reject(new Error('Video still failed to load after retry'));
              };

              videoElement.addEventListener('loadeddata', handleLoad);
              videoElement.addEventListener('error', handleError);

              // Timeout after 10 seconds
              setTimeout(() => {
                videoElement.removeEventListener('loadeddata', handleLoad);
                videoElement.removeEventListener('error', handleError);
                setVideoRetrying(prev => ({ ...prev, [videoId]: false }));
                reject(new Error('Video load timeout'));
              }, 10000);
            });
          }
        );
        
        console.log(`✅ Video ${videoId} loaded successfully after retry`);
      } catch (retryError) {
        console.error(`❌ Video ${videoId} failed to load after retries:`, retryError);
        setVideoErrors((prev) => ({ 
          ...prev, 
          [videoId]: `Failed to load after multiple attempts: ${error}` 
        }));
        setVideoRetrying(prev => ({ ...prev, [videoId]: false }));
      }
    } else {
      setVideoErrors((prev) => ({ ...prev, [videoId]: error }));
    }
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ fontSize: 11, color: '#9aa1ad', padding: '6px 8px', borderBottom: '1px solid #20242e' }}>
        {activeVideo
          ? `Active: Track ${activeVideo.trackIndex + 1} • Frames ${activeVideo.from}–${activeVideo.from + activeVideo.durationInFrames}`
          : 'No active video'}
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {activeVideo && activeVideo.src ? (
          <video
            key={activeVideo.id}
            ref={(el) => {
              if (el) {
                videoRefs.current[activeVideo.id] = el;
              } else {
                delete videoRefs.current[activeVideo.id];
              }
            }}
            src={activeVideo.src}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            onLoadedMetadata={() => handleVideoLoad(activeVideo.id)}
            onError={(e) => {
              const error = e.currentTarget.error;
              const errorMessage = error ? `Error ${error.code}: ${error.message}` : 'Failed to load video';
              handleVideoError(activeVideo.id, errorMessage);
            }}
            muted
            preload="metadata"
            controls={false}
            crossOrigin="use-credentials"
            playsInline
          />
        ) : (
          <div style={{ color: '#6b7280', fontSize: 12 }}>No video at current frame</div>
        )}

        {activeVideo && videoErrors[activeVideo?.id] && (
          <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(31,41,55,0.8)', color: '#fca5a5', fontSize: 11, padding: '4px 6px', borderRadius: 4 }}>
            {videoErrors[activeVideo.id]}
          </div>
        )}
      </div>
    </div>
  );
};
