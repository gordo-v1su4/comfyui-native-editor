import React, { useState, useMemo, useRef, useEffect } from "react";
import { Player } from "@remotion/player";
import type { PlayerRef } from "@remotion/player";
import { AdvancedComposition } from "../remotion/AdvancedComposition";
import { TimelineEditor } from "./TimelineEditor";
import { VideoPreview } from "./VideoPreview";
import EditorShell from "./layout/EditorShell";
import Sidebar from "./Sidebar";
import Inspector from "./Inspector";
import { VideoProcessor } from "../utils/videoUtils";
import { NodeRenderer } from "../utils/nodeRenderer";
import { ExportProgress } from "./ExportProgress";
import { FrameRateSelector, analyzeFrameRates } from "./FrameRateSelector";
import type { Track } from "../types";
import { projectAPI, exportAPI, wsAPI } from "../api.js";
import { useNotifications, NotificationContainer } from "../hooks/useNotifications";
import { errorHandler, ErrorType } from "../utils/errorHandling";

interface AdvancedVideoEditorProps {
  currentProject: any;
  onBackToProjects: () => void;
}

export const AdvancedVideoEditor: React.FC<AdvancedVideoEditorProps> = ({
  currentProject,
  onBackToProjects,
}) => {
  console.log('🎬 AdvancedVideoEditor: Component mounted/rendered', { 
    projectId: currentProject?.id,
    projectName: currentProject?.name
  });

  // Notification system
  const { notifications, addNotification, removeNotification } = useNotifications();
  const [tracks, setTracks] = useState<Track[]>([
    { name: "Track 1", items: [] },
    { name: "Track 2", items: [] },
    { name: "Track 3", items: [] },
  ]);
  const [mediaImportComplete, setMediaImportComplete] = useState(false);

  // Prevent autosave during initial hydration/load
  const isHydratingTimeline = useRef<boolean>(false);
  const hasAttemptedInitialLoad = useRef<boolean>(false);

  // Reset media import completion when project changes
  useEffect(() => {
    setMediaImportComplete(false);
  }, [currentProject?.id]);

  // Handle media import completion
  const handleMediaImportComplete = (isComplete: boolean) => {
    console.log('🎬 AdvancedVideoEditor: Media import completion status:', isComplete);
    setMediaImportComplete(isComplete);
  };

  // Load timeline data from database on mount, but only after media import is complete
  useEffect(() => {
    if (currentProject?.id && mediaImportComplete) {
      console.log('🎬 AdvancedVideoEditor: Media import complete, loading timeline...');
      loadTimelineFromDatabase();
    } else if (!currentProject?.id && mediaImportComplete) {
      console.log('🎬 AdvancedVideoEditor: Media import complete but no project selected');
    }
  }, [currentProject?.id, mediaImportComplete]);

  // Track component lifecycle
  useEffect(() => {
    console.log('🎬 AdvancedVideoEditor: Component mounted');
    return () => {
      console.log('🎬 AdvancedVideoEditor: Component unmounting');
    };
  }, []);

  // Listen for timeline updates via socket (reuse shared client)
  useEffect(() => {
    if (!currentProject?.id) return;
    const socket = wsAPI.getSocket() || wsAPI.connect(currentProject.id);
    const handleTimelineUpdate = (data: any) => {
      if (data.projectId === currentProject.id) {
        console.log('🎬 AdvancedVideoEditor: Timeline update received:', data);
        loadTimelineFromDatabase();
      }
    };
    socket.on('timeline:new', handleTimelineUpdate);
    return () => {
      try { socket.off('timeline:new', handleTimelineUpdate); } catch {}
    };
  }, [currentProject?.id]);

  const loadTimelineFromDatabase = async () => {
    try {
      isHydratingTimeline.current = true;
      if (!currentProject?.id) {
        console.log('🎬 AdvancedVideoEditor: No current project, skipping timeline load');
        return;
      }

      // Wait for media to be ready before loading timeline
      if (!mediaFiles || mediaFiles.length === 0) {
        console.log('🎬 AdvancedVideoEditor: No media files loaded yet, waiting...');
        addNotification('Waiting for media to load...', 'info', 2000);
        return;
      }

      console.log('🎬 AdvancedVideoEditor: Loading timeline from database...');
      addNotification('Loading timeline from database...', 'info', 2000);
      
      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL ||
          import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
          window.location.origin
        }/api/projects/${currentProject.id}/timeline`,
        {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('authToken')}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to load timeline: ${response.status}`);
      }

      const data = await response.json();
      console.log('🎬 AdvancedVideoEditor: Timeline data loaded:', data);
      console.log('🎬 AdvancedVideoEditor: Timeline items count:', data.items?.length || 0);
      
      // Convert database timeline items to tracks format
      const newTracks = [
        { name: "Track 1", items: [] },
        { name: "Track 2", items: [] },
        { name: "Track 3", items: [] },
      ];

      // Filter for placed_video items and add to tracks
      const placedVideos = data.items?.filter((item: any) => item.type === 'placed_video') || [];
      console.log('🎬 AdvancedVideoEditor: Placed videos found:', placedVideos.length);
      
      // Get current media IDs from MediaImporter to validate timeline items
      const currentMediaIds = mediaFiles?.map(m => m.id) || [];
      console.log('🎬 AdvancedVideoEditor: Current media IDs:', currentMediaIds);
      
      // Filter out timeline items that reference non-existent media
      const validPlacedVideos = placedVideos.filter((item: any) => {
        const exists = currentMediaIds.includes(item.ref_id);
        if (!exists) {
          console.log('🎬 AdvancedVideoEditor: ⚠️ Filtering out timeline item with non-existent media ID:', item.ref_id);
          console.log('🎬 AdvancedVideoEditor: Available media IDs:', currentMediaIds);
          console.log('🎬 AdvancedVideoEditor: Timeline item details:', item);
        }
        return exists;
      });
      
      console.log('🎬 AdvancedVideoEditor: Valid placed videos after filtering:', validPlacedVideos.length);
      
      // Helper to build absolute, authenticated stream URL (reuse logic from MediaImporter)
      const buildStreamUrl = (projectId: string, mediaId: string) => {
        const API_BASE =
          import.meta.env.VITE_API_BASE_URL ||
          import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
          (typeof window !== 'undefined' ? window.location.origin : '');
        const token = (typeof window !== 'undefined' && localStorage.getItem('authToken')) || '';
        const base = `${API_BASE.replace(/\/$/, '')}/api/projects/${projectId}/media/${mediaId}/stream`;
        return token ? `${base}?t=${encodeURIComponent(token)}` : base;
      };

      validPlacedVideos.forEach((item: any) => {
        console.log('🎬 AdvancedVideoEditor: Processing timeline item:', item);
        const timelineItem = {
          id: item.id, // Timeline item ID for editing/state
          ref_id: item.ref_id, // Media asset ID for streaming/decoding
          type: "video",
          // Use absolute API base and include JWT in query for <video> auth
          src: buildStreamUrl(currentProject.id, item.ref_id),
          from: item.payload?.start_frame || 0,
          durationInFrames: item.payload?.duration_frames || 60,
          frameRate: item.payload?.fps || 24,
          track: item.payload?.track || 'Generated',
        };
        
        // Add to first track for now
        newTracks[0].items.push(timelineItem);
      });

      console.log('🎬 AdvancedVideoEditor: Converted timeline items:', newTracks[0].items);
      console.log('🎬 AdvancedVideoEditor: Setting tracks with', newTracks[0].items.length, 'items');
      setTracks(newTracks);
      
      if (validPlacedVideos.length > 0) {
        addNotification(`✅ Loaded ${validPlacedVideos.length} timeline items`, 'success', 3000);
      }
      
      // Clean up stale timeline items if any were filtered out
      if (validPlacedVideos.length < placedVideos.length) {
        const staleCount = placedVideos.length - validPlacedVideos.length;
        console.log(`🎬 AdvancedVideoEditor: Found ${staleCount} stale timeline items, cleaning up...`);
        await cleanupStaleTimelineItems(placedVideos, validPlacedVideos);
      }
    } catch (error) {
      console.error('🎬 AdvancedVideoEditor: Failed to load timeline:', error);
      
      // Log error to error handler
      errorHandler.logError('AdvancedVideoEditor', errorHandler.createError(
        ErrorType.TIMELINE_SAVE_FAILED,
        `Failed to load timeline: ${error}`,
        { projectId: currentProject?.id, error }
      ));
      
      addNotification('❌ Failed to load timeline from database', 'error', 5000);
      // Don't crash the app, just log the error
    }
    finally {
      // Mark initial load attempt finished, and stop hydration mode
      hasAttemptedInitialLoad.current = true;
      isHydratingTimeline.current = false;
    }
  };
  const [mediaFiles, setMediaFiles] = useState<any[]>([]);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [durationInFrames, setDurationInFrames] = useState(600); // 20 seconds at 30fps
  const [fps] = useState(30);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState("");
  const [showFrameRateSelector, setShowFrameRateSelector] = useState(false);
  const [frameRateOptions, setFrameRateOptions] = useState<any[]>([]);
  const [pendingExportData, setPendingExportData] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const playerRef = useRef<PlayerRef>(null);
  const isUserSeeking = useRef(false);
  const [selectedTimelineItem, setSelectedTimelineItem] = useState<any>(null);
  const videoPromptPanelRef = useRef<any>(null);

  const inputProps = useMemo(() => {
    return {
      tracks,
    };
  }, [tracks]);

  // Sync player position with timeline during playback
  useEffect(() => {
    if (isPlaying && playerRef.current) {
      const syncInterval = setInterval(() => {
        if (playerRef.current && !isUserSeeking.current) {
          const playerFrame = playerRef.current.getCurrentFrame();
          if (
            playerFrame !== undefined &&
            Math.abs(playerFrame - currentFrame) > 1
          ) {
            setCurrentFrame(playerFrame);
            setPlaybackTime(playerFrame / fps);
          }
        }
      }, 100); // Check every 100ms

      return () => clearInterval(syncInterval);
    }
  }, [isPlaying, currentFrame, fps]);

  // Advance timeline position when playing
  useEffect(() => {
    if (isPlaying) {
      const advanceInterval = setInterval(() => {
        if (!isUserSeeking.current) {
          setCurrentFrame((prevFrame) => {
            const nextFrame = prevFrame + 1;
            // Stop at the end of the timeline
            if (nextFrame >= durationInFrames) {
              setIsPlaying(false);
              return durationInFrames - 1;
            }
            return nextFrame;
          });
        }
      }, 1000 / fps); // Advance at the correct frame rate

      return () => clearInterval(advanceInterval);
    }
  }, [isPlaying, fps, durationInFrames]);

  // Sync player with timeline when user seeks
  useEffect(() => {
    if (playerRef.current && isUserSeeking.current) {
      playerRef.current.seekTo(currentFrame);
      setPlaybackTime(currentFrame / fps);
      isUserSeeking.current = false;
    }
  }, [currentFrame, fps]);

  // Update playbackTime when currentFrame changes while paused
  useEffect(() => {
    if (!isPlaying) {
      setPlaybackTime(currentFrame / fps);
    }
  }, [currentFrame, fps, isPlaying]);

  // Handle timeline extension - ensure items beyond old duration are still visible
  useEffect(() => {
    // Check if any items are positioned beyond the current duration
    const maxItemEnd = Math.max(
      ...tracks.flatMap((track) =>
        track.items.map((item) => item.from + item.durationInFrames)
      ),
      0
    );

    if (maxItemEnd > durationInFrames) {
      console.log(
        `Timeline needs extension: items extend to ${maxItemEnd} frames, current duration is ${durationInFrames}`
      );
      extendTimelineIfNeeded(maxItemEnd);
    }
  }, [tracks, durationInFrames]);

  // Load projects count for display
  useEffect(() => {
    const loadProjectsCount = async () => {
      try {
        const data = await projectAPI.getAll();
        const projectList = data.projects || [];
        setProjects(projectList);
      } catch (error) {
        console.error("Failed to load projects count:", error);
      }
    };

    loadProjectsCount();
  }, []);

  // Auto-save timeline when tracks change
  useEffect(() => {
    if (currentProject) {
      // Skip autosave until we've attempted an initial load, and while hydrating
      if (!hasAttemptedInitialLoad.current) {
        console.log('💾 Skipping autosave: initial load not attempted yet');
        return;
      }
      if (isHydratingTimeline.current) {
        console.log('💾 Skipping autosave: currently hydrating timeline from database');
        return;
      }
      // Also avoid autosaving before media import completes
      if (!mediaImportComplete) {
        console.log('💾 Skipping autosave: media import not complete');
        return;
      }
      const saveTimeline = async () => {
        try {
          console.log("💾 Auto-saving timeline changes...");
          
          // Convert tracks to timeline items format
          const timelineItems = tracks.flatMap(track => 
            track.items.map(item => ({
              refId: item.ref_id || item.id,
              startFrame: item.from,
              durationFrames: item.durationInFrames,
              track: track.name,
              fps: item.frameRate || 24
            }))
          );
          
          console.log("💾 Saving timeline items:", timelineItems);
          
          const response = await fetch(
            `${
              import.meta.env.VITE_API_BASE_URL ||
              import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
              window.location.origin
            }/api/projects/${currentProject.id}/timeline/placements`,
            {
              method: 'PUT',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('authToken')}`,
              },
              body: JSON.stringify({ items: timelineItems }),
            }
          );

          if (!response.ok) {
            throw new Error(`Failed to save timeline: ${response.status}`);
          }

          console.log('✅ Timeline auto-saved successfully');
          addNotification('💾 Timeline auto-saved', 'success', 2000);
        } catch (error) {
          console.error('❌ Failed to auto-save timeline:', error);
          addNotification('❌ Failed to auto-save timeline', 'error', 3000);
        }
      };
      
      // Debounced save after track changes
      const saveTimeout = setTimeout(saveTimeline, 2000);
      return () => clearTimeout(saveTimeout);
    }
  }, [tracks, currentProject, mediaImportComplete]);

  // Track processed batches to prevent duplicates
  const [processedBatches, setProcessedBatches] = useState<Set<string>>(new Set());

  // Handle batch completion and auto-align videos on timeline
  const handleBatchComplete = (batchVideos: any[]) => {
    console.log("🎬 Auto-aligning batch videos on timeline:", batchVideos);
    console.log("🎬 Batch videos IDs:", batchVideos.map(v => ({ id: v.id, filename: v.filename })));
    
    // Create a unique batch identifier
    const batchId = batchVideos.map(v => v.id).sort().join(',');
    
    // Check if this batch has already been processed
    if (processedBatches.has(batchId)) {
      console.log("🎬 Batch already processed, skipping:", batchId);
      return;
    }
    
    // Mark batch as processed
    setProcessedBatches(prev => new Set([...prev, batchId]));
    
    // Add notification for batch processing
    addNotification('Processing batch videos and adding to timeline...', 'info', 3000);
    
    // Extract batch information and create timeline items
    const timelineItems = batchVideos.map((video, index) => {
      // Extract batch info from filename
      const match = video.filename.match(/g([a-zA-Z0-9]+)_s(\d+)_sf(\d+)_df(\d+)_fps(\d+)/);
      if (match) {
        const [, groupId, shotNumber, startFrame, durationFrames, fps] = match;
        return {
          refId: video.id,
          startFrame: parseInt(startFrame),
          durationFrames: parseInt(durationFrames),
          track: 'Generated',
          fps: parseInt(fps),
          shotNumber: parseInt(shotNumber)
        };
      }
      
      // Fallback: calculate sequential placement
      const durationFrames = 60; // Default duration
      const fps = 24; // Default FPS
      return {
        refId: video.id,
        startFrame: index * durationFrames,
        durationFrames: durationFrames,
        track: 'Generated',
        fps: fps,
        shotNumber: index + 1
      };
    });
    
    // Sort by shot number to ensure proper order
    timelineItems.sort((a, b) => a.shotNumber - b.shotNumber);
    
    // Calculate sequential placement (overlapping if needed)
    let currentFrame = 0;
    const alignedItems = timelineItems.map(item => {
      const aligned = {
        ...item,
        startFrame: currentFrame
      };
      currentFrame += item.durationFrames;
      return aligned;
    });
    
    console.log("🎬 Aligned timeline items:", alignedItems);
    
    // Save to database timeline using the placements API with timing delay
    const saveToDatabase = async () => {
      try {
        if (!currentProject?.id) {
          console.log("🎬 No current project, skipping timeline save");
          return;
        }

        // Wait for media to be imported before creating timeline items
        console.log(`🎬 Waiting for media import to complete for ${batchVideos.length} videos...`);
        
        // Check if media exists in the database with retry logic
        const maxRetries = 10;
        const retryDelay = 2000; // 2 seconds
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          console.log(`🎬 Media readiness check attempt ${attempt}/${maxRetries}`);
          
          const mediaChecks = await Promise.all(
            batchVideos.map(async (video) => {
              try {
                const response = await fetch(
                  `${
                    import.meta.env.VITE_API_BASE_URL ||
                    import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
                    window.location.origin
                  }/api/projects/${currentProject.id}/media/${video.id}`,
                  {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${localStorage.getItem('authToken')}`,
                    },
                  }
                );
                return response.ok;
              } catch {
                return false;
              }
            })
          );
          
          const readyCount = mediaChecks.filter(Boolean).length;
          console.log(`🎬 Media readiness: ${readyCount}/${batchVideos.length} videos ready`);
          
          if (readyCount === batchVideos.length) {
            console.log(`🎬 All media ready, proceeding with timeline creation`);
            break;
          }
          
          if (attempt === maxRetries) {
            console.warn(`🎬 Media not ready after ${maxRetries} attempts, proceeding anyway`);
            addNotification('⚠️ Some videos may not be ready yet, timeline creation proceeding', 'warning', 5000);
            break;
          }
          
          // Wait before next attempt
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }

        const response = await fetch(
          `${
            import.meta.env.VITE_API_BASE_URL ||
            import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
            window.location.origin
          }/api/projects/${currentProject.id}/timeline/placements`,
          {
            method: 'PUT',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${localStorage.getItem('authToken')}`,
            },
            body: JSON.stringify({ 
              items: alignedItems.map(item => ({
                refId: item.refId,
                startFrame: item.startFrame,
                durationFrames: item.durationFrames,
                track: item.track,
                fps: item.fps
              }))
            }),
          }
        );

        if (response.ok) {
          console.log("🎬 Successfully saved timeline placements to database");
          addNotification(`✅ Added ${alignedItems.length} videos to timeline`, 'success', 4000);
          // Don't reload timeline immediately to prevent duplicates
          // The timeline will be updated via WebSocket events
        } else {
          const errorText = await response.text();
          console.error("🎬 Failed to save timeline placements:", response.status, errorText);
          
          errorHandler.logError('AdvancedVideoEditor', errorHandler.createError(
            ErrorType.TIMELINE_SAVE_FAILED,
            `Failed to save batch timeline placements: ${response.status} ${errorText}`,
            { projectId: currentProject.id, batchVideos, response }
          ));
          
          addNotification('❌ Failed to save timeline placements', 'error', 5000);
        }
      } catch (error) {
        console.error("🎬 Error saving timeline placements:", error);
        
        errorHandler.logError('AdvancedVideoEditor', errorHandler.createError(
          ErrorType.TIMELINE_SAVE_FAILED,
          `Error saving batch timeline placements: ${error}`,
          { projectId: currentProject.id, batchVideos, error }
        ));
        
        addNotification('❌ Error saving timeline placements', 'error', 5000);
        // Don't crash the app, just log the error
      }
    };

    // Save to database with delay
    saveToDatabase();
  };

  // Handle timeline updates from video prompt panel
  const handleTimelineUpdate = (items: any[]) => {
    console.log("🔄 Timeline update received from video prompt panel:", items);
    
    // Only process timeline updates if media import is complete
    if (!mediaImportComplete) {
      console.log("🔄 Skipping timeline update - media import not complete yet");
      return;
    }
    
    // Convert timeline items to tracks format
    const trackMap = new Map();
    
    // Initialize default tracks
    trackMap.set("Track 1", []);
    trackMap.set("Track 2", []);
    trackMap.set("Track 3", []);
    
    // Get current media IDs to validate timeline items
    const currentMediaIds = mediaFiles?.map(m => m.id) || [];
    console.log("🔄 Current media IDs for timeline update:", currentMediaIds);
    
    // Filter items to only include those with valid media IDs
    const validItems = items.filter(item => {
      const exists = currentMediaIds.includes(item.refId);
      if (!exists) {
        console.log("🔄 Filtering out timeline item with non-existent media ID:", item.refId);
      }
      return exists;
    });
    
    console.log(`🔄 Valid timeline items after filtering: ${validItems.length}/${items.length}`);
    
    // Group items by track
    validItems.forEach(item => {
      const trackName = item.track || "Track 1";
      if (!trackMap.has(trackName)) {
        trackMap.set(trackName, []);
      }
      
      const trackItem = {
        id: `timeline-${Date.now()}-${Math.random()}`, // Timeline item ID for editing/state
        ref_id: item.refId, // Media asset ID for streaming/decoding
        type: "video",
        src: `/api/projects/${currentProject?.id}/media/${item.refId}/stream`, // Use asset_id for streaming
        from: item.startFrame,
        durationInFrames: item.durationFrames,
        name: `Video ${item.refId.slice(0, 8)}`,
        frameRate: item.fps || 30,
      };
      
      trackMap.get(trackName).push(trackItem);
    });
    
    // Convert to tracks array
    const newTracks = Array.from(trackMap.entries()).map(([name, items]) => ({
      name,
      items: items.sort((a: any, b: any) => a.from - b.from), // Sort by start frame
    }));
    
    console.log("🔄 Converted tracks from persistence:", newTracks);
    setTracks(newTracks);
    
    // Clean up stale timeline items if any were filtered out
    if (validItems.length < items.length) {
      const staleCount = items.length - validItems.length;
      console.log(`🔄 Found ${staleCount} stale timeline items in persistence, cleaning up...`);
      // Note: We don't have timeline item IDs from persistence, so we can't clean them up here
      // The cleanup will happen when the database timeline is loaded
    }
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      setIsPlaying(false);
      if (playerRef.current) {
        playerRef.current.pause();
      }
    } else {
      // When resuming playback, ensure the player is at the current timeline position
      if (playerRef.current) {
        playerRef.current.seekTo(currentFrame);
      }
      setIsPlaying(true);
      if (playerRef.current) {
        playerRef.current.play();
      }
    }
  };

  const handleSeek = (frame: number) => {
    isUserSeeking.current = true;
    setCurrentFrame(frame);
    setPlaybackTime(frame / fps);

    // Clear the seeking flag after a short delay
    setTimeout(() => {
      isUserSeeking.current = false;
    }, 200);

    if (playerRef.current) {
      playerRef.current.seekTo(frame);
    }
  };

  const addTrack = () => {
    setTracks((prev) => [
      ...prev,
      { name: `Track ${prev.length + 1}`, items: [] },
    ]);
  };

  const removeTrack = (trackIndex: number) => {
    if (tracks.length > 1) {
      setTracks((prev) => prev.filter((_, index) => index !== trackIndex));
    }
  };

  const exportVideo = async () => {
    try {
      // Check if there's any content to export
      const hasContent = tracks.some((track) => track.items.length > 0);
      if (!hasContent) {
        alert(
          "No content to export. Please add some media to the timeline first."
        );
        return;
      }

      // Analyze frame rates in the timeline
      const frameRates = analyzeFrameRates(tracks);
      const uniqueFrameRates = frameRates.length;

      console.log("🔍 Frame rate analysis:", {
        frameRates,
        uniqueFrameRates,
        tracks: tracks.map((track) => ({
          name: track.name,
          items: track.items
            .filter((item) => item.type === "video")
            .map((item) => ({
              id: item.id,
              frameRate: item.frameRate,
              src: item.src,
            })),
        })),
      });

      // If we have multiple frame rates, show the selector
      if (uniqueFrameRates > 1) {
        setFrameRateOptions(frameRates);
        setPendingExportData({
          tracks: tracks,
          durationInFrames: durationInFrames,
          width: 1280,
          height: 720,
        });
        setShowFrameRateSelector(true);
        return;
      }

      // Lock export frame rate to 24fps for now
      const finalFps = 24;
      console.log(
        `Export frame rate locked to: ${finalFps} FPS (Constant Frame Rate)`
      );

      await performExport({
        tracks: tracks,
        durationInFrames: durationInFrames,
        fps: finalFps,
        width: 1280,
        height: 720,
      });
    } catch (error) {
      console.error("Export error:", error);
      alert(`Export failed: ${error}`);
    }
  };

  const performExport = async (exportData: any) => {
    try {
      // Show export dialog
      const format = prompt(
        "Choose export format:\n1. MP4 (recommended - H.264, best compatibility)\n2. WebM (VP9, smaller files)\n3. GIF (animated, larger files)\n\nEnter 1, 2, or 3:",
        "1"
      );

      if (!format) return;

      let outputFormat: "mp4" | "webm" | "gif" = "mp4";
      switch (format.trim()) {
        case "1":
        case "mp4":
          outputFormat = "mp4";
          break;
        case "2":
        case "webm":
          outputFormat = "webm";
          break;
        case "3":
        case "gif":
          outputFormat = "gif";
          break;
        default:
          alert("Invalid format. Using MP4.");
          outputFormat = "mp4";
      }

      // Get output filename
      const filename = prompt(
        "Enter output filename (without extension):",
        `timeline-export-${new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/:/g, "-")}`
      );

      if (!filename) return;

      // Start export process
      setIsExporting(true);
      setExportProgress(0);
      setExportStatus("Initializing export...");

      // Use Node.js-based renderer for all formats
      try {
        console.log(
          `Starting ${outputFormat.toUpperCase()} video render with Node.js...`
        );

        // Preflight: ensure we have items and reasonable duration to avoid hanging UI
        const totalItems = tracks.reduce((sum, t) => sum + t.items.length, 0);
        if (totalItems === 0) {
          throw new Error('No items on the timeline to export');
        }
        if (!Number.isFinite(durationInFrames) || durationInFrames <= 0) {
          throw new Error('Invalid timeline duration');
        }

        const nodeRenderer = new NodeRenderer();
        const videoBlob = await nodeRenderer.renderVideo(exportData, {
          format: outputFormat,
          filename: filename,
          quality: "medium",
          onProgress: (progress: number, status: string) => {
            setExportProgress(progress);
            setExportStatus(status);
          },
        });
        const actualExtension = outputFormat;

        // Create download link for the video
        const downloadUrl = URL.createObjectURL(videoBlob);
        const downloadLink = document.createElement("a");
        downloadLink.href = downloadUrl;
        downloadLink.download = `${filename}.${actualExtension}`;
        downloadLink.click();
        URL.revokeObjectURL(downloadUrl);

        // Reset export state
        setIsExporting(false);
        setExportProgress(0);
        setExportStatus("");

        const formatNote =
          outputFormat === "mp4"
            ? "MP4 format with H.264 codec (QuickTime compatible). If QuickTime shows 'incompatible', try VLC or Chrome browser."
            : outputFormat === "webm"
            ? "WebM format with VP9 codec (smaller files, Chrome/Firefox compatible)."
            : "GIF format (note: exported as WebM for compatibility).";

        alert(
          `✅ Video exported successfully!\n\nFile: ${filename}.${actualExtension}\nSize: ${(
            videoBlob.size /
            1024 /
            1024
          ).toFixed(
            2
          )} MB\n\n${formatNote}\n\n💡 QuickTime Compatibility Tips:\n• Try opening in VLC Media Player\n• Use Chrome browser to play the file\n• Convert using online tools if needed\n\nRendered entirely in your browser using WebCodecs!`
        );
      } catch (renderError) {
        console.error("Video render error:", renderError);

        // Reset export state
        setIsExporting(false);
        setExportProgress(0);
        setExportStatus("");

        // Fallback to manual export if rendering fails
        alert(
          `Video rendering failed: ${renderError}\n\nFalling back to manual export process.`
        );

        // Create a download link for the timeline data
        const timelineDataBlob = new Blob(
          [JSON.stringify(exportData, null, 2)],
          {
            type: "application/json",
          }
        );

        const downloadLink = document.createElement("a");
        downloadLink.href = URL.createObjectURL(timelineDataBlob);
        downloadLink.download = "timeline-data.json";
        downloadLink.click();

        // Show detailed instructions for manual export
        const instructions = `
Export data prepared!

📁 Timeline data saved as: timeline-data.json

🚀 To generate the video file, run this command in your terminal:

npm run render ${outputFormat} ${filename}

📊 Export Details:
• Format: ${outputFormat.toUpperCase()}
• Filename: ${filename}.${outputFormat}
• Duration: ${(durationInFrames / fps).toFixed(2)} seconds
• Resolution: 1280x720
• FPS: ${fps}
• Tracks: ${tracks.length}
• Total items: ${tracks.reduce((sum, track) => sum + track.items.length, 0)}

⏱️ Export time depends on video length and your computer's performance.

💡 Tip: WebCodecs rendering failed, using manual export as fallback.
        `;

        alert(instructions);
        console.log("Export data prepared:", exportData);
        console.log(`Run: npm run render ${outputFormat} ${filename}`);
      }
    } catch (error) {
      console.error("Export error:", error);

      // Reset export state
      setIsExporting(false);
      setExportProgress(0);
      setExportStatus("");

      alert(`Export failed: ${error}`);
    }
  };

  const cancelExport = () => {
    setIsExporting(false);
    setExportProgress(0);
    setExportStatus("");
    alert("Export cancelled by user.");
  };

  const handleFrameRateSelection = (selectedFps: number) => {
    if (pendingExportData) {
      const updatedExportData = {
        ...pendingExportData,
        fps: selectedFps,
      };
      performExport(updatedExportData);
    }
    setShowFrameRateSelector(false);
    setPendingExportData(null);
  };

  const handleFrameRateCancel = () => {
    setShowFrameRateSelector(false);
    setPendingExportData(null);
  };

  const handleDurationChange = (newDuration: number) => {
    const clampedDuration = Math.max(1, Math.min(newDuration, 10000)); // Min 1 frame, max 10000 frames
    setDurationInFrames(clampedDuration);

    // If current frame is beyond the new duration, clamp it
    if (currentFrame >= clampedDuration) {
      setCurrentFrame(clampedDuration - 1);
      setPlaybackTime((clampedDuration - 1) / fps);
    }
  };

  const extendTimelineIfNeeded = (requiredFrames: number) => {
    if (requiredFrames > durationInFrames) {
      const newDuration = Math.min(requiredFrames + 60, 10000); // Add 2 seconds buffer, max 10000 frames
      setDurationInFrames(newDuration);
      console.log(
        `Timeline extended from ${durationInFrames} to ${newDuration} frames (required: ${requiredFrames})`
      );

      // Also update playback time if we're at the end of the timeline
      if (currentFrame >= durationInFrames - 1) {
        setCurrentFrame(newDuration - 1);
        setPlaybackTime((newDuration - 1) / fps);
      }
    }
  };

  const saveTimelineToAPI = async (updatedTracks: Track[]) => {
    if (!currentProject) return;

    try {
      // For now, we'll just log the save attempt
      // In a full implementation, you'd want to save each track item to the API
      console.log("💾 Saving timeline to API for project:", currentProject.id);
      console.log("📋 Updated tracks:", updatedTracks);
    } catch (error) {
      console.error("Failed to save timeline:", error);
    }
  };

  const handleDropMedia = async (
    mediaFile: any,
    trackIndex: number,
    frame: number
  ) => {
    // Debug logging for duration calculation
    if (mediaFile.type === "video") {
      console.log(`🎬 Adding video to track:`, {
        name: mediaFile.name,
        duration: mediaFile.duration,
        frameRate: mediaFile.frameRate,
        timelineFps: fps,
        calculatedFrames: mediaFile.duration
          ? Math.floor(mediaFile.duration * (mediaFile.frameRate || fps))
          : 60,
        expectedSeconds: mediaFile.duration
          ? Math.floor(mediaFile.duration * (mediaFile.frameRate || fps)) / fps
          : 2,
      });
    }

    // Create a new item based on the media file type
    const newItem: any = {
      id: `${mediaFile.type}-${Date.now()}`,
      type: mediaFile.type,
      from: frame,
      durationInFrames: mediaFile.duration
        ? Math.floor(mediaFile.duration * (mediaFile.frameRate || fps))
        : 60, // Default 2 seconds
    };

    // Add type-specific properties
    if (mediaFile.type === "video") {
      // Use media ID for streaming if it's a project-scoped media file
      if (mediaFile.id && currentProject?.id) {
        const API_BASE =
          import.meta.env.VITE_API_BASE_URL ||
          import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
          (typeof window !== 'undefined' ? window.location.origin : '');
        const token = (typeof window !== 'undefined' && localStorage.getItem('authToken')) || '';
        const base = `${API_BASE.replace(/\/$/, '')}/api/projects/${currentProject.id}/media/${mediaFile.id}/stream`;
        newItem.src = token ? `${base}?t=${encodeURIComponent(token)}` : base;
      } else {
        newItem.src = mediaFile.url;
      }
      // Store the actual video frame rate for proper duration calculation
      newItem.frameRate = mediaFile.frameRate || fps;
      // CRITICAL FIX: Set ref_id to the media ID for VideoPromptPanel lookup
      newItem.ref_id = mediaFile.id;
    } else if (mediaFile.type === "image") {
      newItem.src = mediaFile.url;
      newItem.ref_id = mediaFile.id;
    } else if (mediaFile.type === "audio") {
      newItem.src = mediaFile.url;
      newItem.ref_id = mediaFile.id;
    }

    // Check if we need to extend the timeline for this new item
    const requiredFrames = frame + newItem.durationInFrames;
    if (requiredFrames > durationInFrames) {
      extendTimelineIfNeeded(requiredFrames);
    }

    // Add the item to the specified track
    setTracks((prevTracks) => {
      const newTracks = [...prevTracks];
      if (newTracks[trackIndex]) {
        newTracks[trackIndex] = {
          ...newTracks[trackIndex],
          items: [...newTracks[trackIndex].items, newItem],
        };
      }

      // Save to API if we have a current project
      if (currentProject) {
        saveTimelineToAPI(newTracks);
      }

      return newTracks;
    });

    // If this is a project-scoped media file, also save to database timeline
    if (currentProject && mediaFile.id && mediaFile.type === "video") {
      try {
        await saveTimelineItemToDatabase(mediaFile, newItem, trackIndex);
      } catch (error) {
        console.error("Failed to save timeline item to database:", error);
      }
    }
  };

  // Function to clean up stale timeline items from database
  const cleanupStaleTimelineItems = async (allItems: any[], validItems: any[]) => {
    if (!currentProject?.id) return;
    
    const validIds = new Set(validItems.map(item => item.id));
    const staleItems = allItems.filter(item => !validIds.has(item.id));
    
    if (staleItems.length === 0) return;
    
    try {
      console.log(`🎬 AdvancedVideoEditor: Cleaning up ${staleItems.length} stale timeline items...`);
      
      // First, try to clean up orphaned timeline items using the new endpoint
      const orphanedResponse = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL ||
          import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
          window.location.origin
        }/api/projects/${currentProject.id}/timeline/cleanup-orphaned`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('authToken')}`,
          },
        }
      );
      
      if (orphanedResponse.ok) {
        const orphanedResult = await orphanedResponse.json();
        console.log(`✅ Cleaned up ${orphanedResult.removed} orphaned timeline items`);
        if (orphanedResult.removed > 0) {
          addNotification(`✅ Cleaned up ${orphanedResult.removed} orphaned timeline items`, 'success', 3000);
        }
      }
      
      // Then clean up specific stale items
      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL ||
          import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
          window.location.origin
        }/api/projects/${currentProject.id}/timeline/cleanup`,
        {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('authToken')}`,
          },
          body: JSON.stringify({
            itemIds: staleItems.map(item => item.id)
          }),
        }
      );
      
      if (response.ok) {
        console.log(`✅ Cleaned up ${staleItems.length} stale timeline items`);
        addNotification(`✅ Cleaned up ${staleItems.length} stale timeline items`, 'success', 3000);
      } else {
        console.error('Failed to cleanup stale timeline items:', response.status);
      }
    } catch (error) {
      console.error('Error cleaning up stale timeline items:', error);
    }
  };

  // New function to save timeline items to database
  const saveTimelineItemToDatabase = async (
    mediaFile: any,
    timelineItem: any,
    trackIndex: number
  ) => {
    if (!currentProject?.id || !mediaFile.id) {
      console.log("No project ID or media ID, skipping database save");
      return;
    }

    try {
      addNotification('Saving timeline item to database...', 'info', 2000);
      
      // Validate project ID before making API call
      if (!currentProject?.id) {
        console.error("❌ Cannot save timeline item: currentProject.id is undefined");
        addNotification('❌ Cannot save timeline item: No project selected', 'error', 5000);
        return;
      }

      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL ||
          import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
          window.location.origin
        }/api/projects/${currentProject.id}/timeline/placements`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('authToken')}`,
          },
          body: JSON.stringify({
            items: [{
              refId: mediaFile.id, // Use the actual media ID
              startFrame: timelineItem.from,
              durationFrames: timelineItem.durationInFrames,
              track: `Track ${trackIndex + 1}`,
              fps: timelineItem.frameRate || fps,
            }]
          }),
        }
      );

      if (response.ok) {
        console.log("✅ Successfully saved media import timeline item to database");
        addNotification('✅ Timeline item saved to database', 'success', 3000);
      } else {
        const errorText = await response.text();
        console.error("❌ Failed to save timeline item to database:", response.status, errorText);
        
        errorHandler.logError('AdvancedVideoEditor', errorHandler.createError(
          ErrorType.TIMELINE_SAVE_FAILED,
          `Failed to save timeline item: ${response.status} ${errorText}`,
          { projectId: currentProject.id, mediaId: mediaFile.id, response }
        ));
        
        addNotification('❌ Failed to save timeline item to database', 'error', 5000);
      }
    } catch (error) {
      console.error("❌ Error saving timeline item to database:", error);
      
      errorHandler.logError('AdvancedVideoEditor', errorHandler.createError(
        ErrorType.TIMELINE_SAVE_FAILED,
        `Error saving timeline item: ${error}`,
        { projectId: currentProject.id, mediaId: mediaFile.id, error }
      ));
      
      addNotification('❌ Error saving timeline item to database', 'error', 5000);
    }
  };

  const loadVideosFromPath = async () => {
    const videoPath =
      "/Users/mingeonkim/Desktop/PROJECTS/film-mvp/wan22_enhanced_output/opencut_project/media";

    try {
      // Check if File System Access API is available
      if ("showDirectoryPicker" in window) {
        try {
          const dirHandle = await (window as any).showDirectoryPicker();

          // Recursively get all video files from the directory
          const getVideoFiles = async (handle: any): Promise<File[]> => {
            const files: File[] = [];
            for await (const entry of handle.values()) {
              if (entry.kind === "file") {
                const file = await entry.getFile();
                if (file.type.startsWith("video/")) {
                  files.push(file);
                }
              } else if (entry.kind === "directory") {
                const subFiles = await getVideoFiles(entry);
                files.push(...subFiles);
              }
            }
            return files;
          };

          const allVideoFiles = await getVideoFiles(dirHandle);

          // Sort files by name to maintain order
          allVideoFiles.sort((a, b) => a.name.localeCompare(b.name));

          // Add videos to track 1 in sequence
          let currentFrame = 0;
          for (const file of allVideoFiles) {
            const url = URL.createObjectURL(file);

            // Generate thumbnail and detect frame rate first
            let thumbnail: string | undefined;
            let detectedFrameRate: number = 30;

            try {
              thumbnail = await VideoProcessor.createVideoThumbnail(file);
              detectedFrameRate = await VideoProcessor.detectFrameRate(file);
            } catch (error) {
              console.warn(
                "Failed to create thumbnail or detect frame rate for:",
                file.name,
                error
              );
            }

            const duration = await getVideoDuration(url);
            const durationInFrames = Math.floor(
              duration * (detectedFrameRate || fps)
            );

            const videoItem = {
              id: `video-${Date.now()}-${Math.random()}`,
              type: "video" as const,
              src: url,
              from: currentFrame,
              durationInFrames: durationInFrames,
              frameRate: detectedFrameRate,
            };

            setTracks((prevTracks) => {
              const newTracks = [...prevTracks];
              if (newTracks[0]) {
                newTracks[0] = {
                  ...newTracks[0],
                  items: [...newTracks[0].items, videoItem],
                };
              }
              return newTracks;
            });

            // Also add to media files for the Media Importer panel
            const mediaFile = {
              id: `media-${Date.now()}-${Math.random()}`,
              name: file.name,
              type: "video" as const,
              url: url,
              size: file.size,
              duration: duration,
              thumbnail: thumbnail,
              frameRate: detectedFrameRate,
            };

            setMediaFiles((prev) => [...prev, mediaFile]);

            // Move to next position (no gap between videos)
            currentFrame += durationInFrames;
          }

          // Extend timeline if videos exceed current duration
          extendTimelineIfNeeded(currentFrame);

          console.log(`Loaded ${allVideoFiles.length} videos from directory`);
        } catch (error) {
          console.error("Error accessing directory:", error);
          alert(
            "Could not access directory. Please use 'Load Multiple Videos' instead."
          );
        }
      } else {
        // Fallback for browsers without File System Access API
        alert(
          "Your browser doesn't support direct file system access.\n\nPlease use the 'Load Multiple Videos' button to select the video files manually from:\n" +
            videoPath
        );

        // Provide instructions
        console.log("Manual steps:");
        console.log("1. Click 'Load Multiple Videos'");
        console.log("2. Navigate to:", videoPath);
        console.log("3. Select all video files");
        console.log("4. They will be added to track 1 in alphabetical order");
      }
    } catch (error) {
      console.error("Error loading videos:", error);
      alert("Error loading videos from path");
    }
  };

  const loadMultipleVideos = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "video/*";
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);

      // Sort files by name to maintain order
      files.sort((a, b) => a.name.localeCompare(b.name));

      // First, get all video durations
      const videoInfos: {
        file: File;
        duration: number;
        url: string;
        thumbnail?: string;
        frameRate: number;
      }[] = [];

      for (const file of files) {
        const url = URL.createObjectURL(file);
        const duration = await getVideoDuration(url);

        // Generate thumbnail and detect frame rate
        let thumbnail: string | undefined;
        let detectedFrameRate: number = 30;

        try {
          thumbnail = await VideoProcessor.createVideoThumbnail(file);
          detectedFrameRate = await VideoProcessor.detectFrameRate(file);
        } catch (error) {
          console.warn(
            "Failed to create thumbnail or detect frame rate for:",
            file.name,
            error
          );
        }

        videoInfos.push({
          file,
          duration,
          url,
          thumbnail,
          frameRate: detectedFrameRate,
        });
      }

      // Now add videos with proper spacing
      let currentFrame = 0;
      for (const videoInfo of videoInfos) {
        const durationInFrames = Math.floor(
          videoInfo.duration * (videoInfo.frameRate || fps)
        );

        const videoItem = {
          id: `video-${Date.now()}-${Math.random()}`,
          type: "video" as const,
          src: videoInfo.url,
          from: currentFrame,
          durationInFrames: durationInFrames,
          frameRate: videoInfo.frameRate,
        };

        setTracks((prevTracks) => {
          const newTracks = [...prevTracks];
          if (newTracks[0]) {
            newTracks[0] = {
              ...newTracks[0],
              items: [...newTracks[0].items, videoItem],
            };
          }
          return newTracks;
        });

        // Also add to media files for the Media Importer panel
        const mediaFile = {
          id: `media-${Date.now()}-${Math.random()}`,
          name: videoInfo.file.name,
          type: "video" as const,
          url: videoInfo.url,
          size: videoInfo.file.size,
          duration: videoInfo.duration,
          thumbnail: videoInfo.thumbnail,
          frameRate: videoInfo.frameRate,
        };

        setMediaFiles((prev) => [...prev, mediaFile]);

        // Move to next position (no gap between videos)
        currentFrame += durationInFrames;
      }

      // Extend timeline if videos exceed current duration
      extendTimelineIfNeeded(currentFrame);

      console.log(`Loaded ${files.length} videos with proper durations`);
    };
    input.click();
  };

  const getVideoDuration = (url: string): Promise<number> => {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.src = url;

      video.onloadedmetadata = () => {
        const duration = video.duration;
        video.remove();
        resolve(duration);
      };

      video.onerror = () => {
        console.error("Error loading video metadata");
        video.remove();
        resolve(6); // Default 6 seconds
      };
    });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Notification Container */}
      <NotificationContainer notifications={notifications} onRemove={removeNotification} />

      {/* Compact editor bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid #262933', background: '#0f1115', color: '#e5e7eb' }}>
        <div style={{ fontWeight: 600 }}>Editor</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={exportVideo} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #394152', background: '#0e1015', color: '#d1d7e3', cursor: 'pointer' }}>Export</button>
          <button onClick={onBackToProjects} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #475569', background: '#1f2937', color: '#e5e7eb', cursor: 'pointer' }}>← Back</button>
        </div>
      </div>

      {/* Export Progress Overlay */}
      <ExportProgress
        isVisible={isExporting}
        progress={exportProgress}
        status={exportStatus}
        onCancel={cancelExport}
      />

      {/* Frame Rate Selector */}
      {showFrameRateSelector && (
        <FrameRateSelector
          frameRates={frameRateOptions}
          selectedFps={frameRateOptions[0]?.fps || 30}
          onFrameRateChange={(fps) =>
            console.log("Frame rate changed to:", fps)
          }
          onConfirm={() =>
            handleFrameRateSelection(frameRateOptions[0]?.fps || 30)
          }
          onCancel={handleFrameRateCancel}
        />
      )}

      {/* Editor Shell (CapCut-like) */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
      <EditorShell
        sidebar={
          <Sidebar
            projectId={currentProject?.id}
            tracks={tracks}
            setTracks={setTracks}
            currentFrame={currentFrame}
            onMediaImportComplete={handleMediaImportComplete}
          />
        }
        player={
          <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: 10, borderBottom: "1px solid #262933", display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={handlePlayPause} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #394152", background: "#0e1015", color: "#d1d7e3", cursor: "pointer" }}>
                {isPlaying ? "⏸️ Pause" : "▶️ Play"}
              </button>
              <button onClick={() => handleSeek(0)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #394152", background: "#0e1015", color: "#d1d7e3", cursor: "pointer" }}>⏮️ Reset</button>
              <div style={{ marginLeft: "auto", fontSize: 12, color: "#9aa1ad" }}>
                {formatTime(playbackTime)} / {formatTime(durationInFrames / fps)}
              </div>
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <VideoPreview
                tracks={tracks}
                currentFrame={currentFrame}
                fps={fps}
                isPlaying={isPlaying}
                isUserSeeking={isUserSeeking.current}
              />
            </div>
          </div>
        }
        inspector={
          <Inspector
            projectId={currentProject?.id}
            selectedTimelineItem={selectedTimelineItem as any}
            onTimelineUpdate={handleTimelineUpdate}
            onBatchComplete={(batchVideos) => {
              console.log("🎬 Batch generation complete:", batchVideos);
              handleBatchComplete(batchVideos);
            }}
          />
        }
        timeline={
          <div style={{ height: "100%", overflow: "auto", padding: 10 }}>
            <TimelineEditor
              tracks={tracks}
              setTracks={setTracks}
              currentFrame={currentFrame}
              setCurrentFrame={setCurrentFrame}
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              fps={fps}
              durationInFrames={durationInFrames}
              onDurationChange={handleDurationChange}
              onDropMedia={handleDropMedia}
              onExtendTimeline={extendTimelineIfNeeded}
              onItemSelect={(item) => {
                if (item) {
                  const timelineItem = {
                    id: (item as any).id,
                    refId: (item as any).ref_id,
                    from: (item as any).from,
                    startFrame: (item as any).from,
                    durationInFrames: (item as any).durationInFrames,
                    durationFrames: (item as any).durationInFrames,
                    track: (item as any).track || "Generated",
                    frameRate: (item as any).frameRate || fps,
                    fps: (item as any).frameRate || fps,
                  } as any;
                  setSelectedTimelineItem(timelineItem);
                } else {
                  setSelectedTimelineItem(null);
                }
              }}
            />
          </div>
        }
      />
      </div>
    </div>
  );
};
