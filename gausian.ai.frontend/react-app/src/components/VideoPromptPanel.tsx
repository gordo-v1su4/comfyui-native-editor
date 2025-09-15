import React, { useEffect, useState, useRef } from 'react';
import { wsAPI, videoGenerationAPI } from '../api.js';
import { useVideoProgress } from '../contexts/VideoProgressContext';

interface TimelineItem {
  id?: string;
  refId: string;
  startFrame: number;
  durationFrames: number;
  track: string;
  fps: number;
}

interface MediaItem {
  id: string;
  filename: string;
  kind: string;
  remote_url: string;
  meta: {
    source?: string;
    uploaded_at?: string;
    auto_imported?: boolean;
    generation_settings?: {
      resolution?: string;
      fps?: number;
      source?: string;
      prompt?: string;
      negative_prompt?: string;
      seed?: number;
      width?: number;
      height?: number;
      length?: number;
      duration_frames?: number;
    };
  };
  created_at: string;
}

interface VideoPromptPanelProps {
  projectId: string;
  selectedTimelineItem?: TimelineItem | null;
  onTimelineUpdate?: (items: TimelineItem[]) => void;
  onGenerationProgress?: (progress: any) => void;
  onNewMedia?: (media: any) => void;
  onBatchComplete?: (batchVideos: MediaItem[]) => void;
}

export const VideoPromptPanel = React.forwardRef<any, VideoPromptPanelProps>(({ 
  projectId,
  selectedTimelineItem,
  onTimelineUpdate,
  onGenerationProgress,
  onNewMedia,
  onBatchComplete,
}, ref) => {
  const { startVideoGeneration } = useVideoProgress();
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchGroups, setBatchGroups] = useState<Map<string, { expected: number, received: MediaItem[], lastReceived: number }>>(new Map());
  const socketRef = useRef<any>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const batchTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Editable generation fields
  const [editedPrompt, setEditedPrompt] = useState<string>("");
  const [editedNegative, setEditedNegative] = useState<string>("");
  const [editedWidth, setEditedWidth] = useState<number | undefined>(undefined);
  const [editedHeight, setEditedHeight] = useState<number | undefined>(undefined);
  const [editedFps, setEditedFps] = useState<number | undefined>(undefined);
  const [editedLength, setEditedLength] = useState<number | undefined>(undefined); // frames
  const [editedSeed, setEditedSeed] = useState<number | undefined>(undefined);

  // Determine if current selection matches a timeline item (for replace vs add labeling)
  const matchedItem = React.useMemo(() => {
    if (!selectedTimelineItem) return null;
    return (
      timelineItems.find(
        (ti) =>
          ti.refId === selectedTimelineItem.refId &&
          ti.startFrame === selectedTimelineItem.startFrame &&
          ti.durationFrames === selectedTimelineItem.durationFrames
      ) || null
    );
  }, [timelineItems, selectedTimelineItem]);

  // Load timeline and media on mount
  useEffect(() => {
    if (projectId) {
      loadTimeline();
      loadMedia();
      setupSocket();
    }
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      // Clear all batch timeouts
      const timeoutMap = batchTimeoutRef.current;
      timeoutMap.forEach(timeout => clearTimeout(timeout));
      timeoutMap.clear();
    };
  }, [projectId]);

  // Update selected media when timeline item changes
  useEffect(() => {
    console.log('🎬 VideoPromptPanel: Timeline item changed:', selectedTimelineItem);
    console.log('🎬 VideoPromptPanel: Media items count:', mediaItems.length);
    console.log('🎬 VideoPromptPanel: Available media IDs:', mediaItems.map(m => ({ id: m.id, filename: m.filename })));
    
    if (selectedTimelineItem && mediaItems.length > 0) {
      console.log('🎬 VideoPromptPanel: Looking for media with refId:', selectedTimelineItem.refId);
      const media = mediaItems.find(m => m.id === selectedTimelineItem.refId);
      
      if (media) {
        console.log('🎬 VideoPromptPanel: ✅ Found matching media:', {
          id: media.id,
          filename: media.filename,
          hasGenerationSettings: !!media.meta?.generation_settings,
          generationSettings: media.meta?.generation_settings
        });
        setSelectedMedia(media);
        // Initialize editable fields from media generation settings and timeline selection
        const gs = (media.meta && media.meta.generation_settings) || ({} as any);
        const res = typeof gs.resolution === 'string' ? gs.resolution : '';
        let w = Number(gs.width) || 0;
        let h = Number(gs.height) || 0;
        if ((!w || !h) && res) {
          const m = res.match(/(\d+)\s*[x×]\s*(\d+)/i);
          if (m) { w = Number(m[1]); h = Number(m[2]); }
        }
        setEditedPrompt(String(gs.prompt || ''));
        setEditedNegative(String(gs.negative_prompt || ''));
        setEditedWidth(w || undefined);
        setEditedHeight(h || undefined);
        setEditedFps((selectedTimelineItem && selectedTimelineItem.fps) || Number(gs.fps) || undefined);
        setEditedLength((selectedTimelineItem && selectedTimelineItem.durationFrames) || Number(gs.duration_frames || gs.length) || undefined);
        setEditedSeed(gs.seed != null ? Number(gs.seed) : undefined);

        // Track prompt loaded from meta
        try {
          if ((gs && (gs.prompt || gs.negative_prompt)) && typeof window !== 'undefined') {
            (window as any).va?.('prompt_panel_prompt_loaded', {
              projectId,
              mediaId: media.id,
              source: 'meta',
            });
          }
        } catch {}

        // If prompts missing, fetch from backend prompts endpoint as fallback
        const missingPrompts = !gs || (!gs.prompt && !gs.negative_prompt);
        if (missingPrompts && media.id && projectId) {
          (async () => {
            try {
              const base = (
                import.meta.env.VITE_API_BASE_URL ||
                import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
                window.location.origin
              );
              const resp = await fetch(`${base}/api/projects/${projectId}/media/${media.id}/prompts`, {
                method: 'GET',
                credentials: 'include',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${localStorage.getItem('authToken')}`,
                },
              });
              if (resp.ok) {
                const data = await resp.json();
                const p = data?.prompts || null;
                if (p) {
                  setEditedPrompt(String(p.positive_prompt || ''));
                  setEditedNegative(String(p.negative_prompt || ''));
                  const ww = Number(p.width) || w || undefined;
                  const hh = Number(p.height) || h || undefined;
                  setEditedWidth(ww);
                  setEditedHeight(hh);
                  setEditedFps((selectedTimelineItem && selectedTimelineItem.fps) || Number(p.fps) || undefined);
                  setEditedLength((selectedTimelineItem && selectedTimelineItem.durationFrames) || Number(p.length) || undefined);
                  setEditedSeed(p.seed != null ? Number(p.seed) : undefined);

                  // Track prompt loaded from backend endpoint
                  try {
                    if (typeof window !== 'undefined') {
                      (window as any).va?.('prompt_panel_prompt_loaded', {
                        projectId,
                        mediaId: media.id,
                        source: String(data?.source || 'endpoint'),
                      });
                    }
                  } catch {}
                }
              }
            } catch (e) {
              console.warn('Prompt fetch failed:', e);
            }
          })();
        }
      } else {
        console.log('🎬 VideoPromptPanel: ❌ No media found for refId:', selectedTimelineItem.refId);
        console.log('🎬 VideoPromptPanel: Available media IDs:', mediaItems.map(m => m.id));
        
        // Fallback: Try to find media by filename if refId doesn't match
        // This handles cases where timeline and media systems might be out of sync
        const fallbackMedia = mediaItems.find(m => 
          m.filename && selectedTimelineItem.refId && 
          m.filename.includes(selectedTimelineItem.refId)
        );
        
        if (fallbackMedia) {
          console.log('🎬 VideoPromptPanel: 🔄 Found fallback media by filename:', {
            id: fallbackMedia.id,
            filename: fallbackMedia.filename,
            hasGenerationSettings: !!fallbackMedia.meta?.generation_settings
          });
          setSelectedMedia(fallbackMedia);
          const gs2 = (fallbackMedia.meta && fallbackMedia.meta.generation_settings) || ({} as any);
          const res2 = typeof gs2.resolution === 'string' ? gs2.resolution : '';
          let w2 = Number(gs2.width) || 0;
          let h2 = Number(gs2.height) || 0;
          if ((!w2 || !h2) && res2) {
            const m2 = res2.match(/(\d+)\s*[x×]\s*(\d+)/i);
            if (m2) { w2 = Number(m2[1]); h2 = Number(m2[2]); }
          }
          setEditedPrompt(String(gs2.prompt || ''));
          setEditedNegative(String(gs2.negative_prompt || ''));
          setEditedWidth(w2 || undefined);
          setEditedHeight(h2 || undefined);
          setEditedFps((selectedTimelineItem && selectedTimelineItem.fps) || Number(gs2.fps) || undefined);
          setEditedLength((selectedTimelineItem && selectedTimelineItem.durationFrames) || Number(gs2.duration_frames || gs2.length) || undefined);
          setEditedSeed(gs2.seed != null ? Number(gs2.seed) : undefined);
        } else {
          setSelectedMedia(null);
          setEditedPrompt('');
          setEditedNegative('');
          setEditedWidth(undefined);
          setEditedHeight(undefined);
          setEditedFps(undefined);
          setEditedLength(undefined);
          setEditedSeed(undefined);
        }
      }
    } else {
      console.log('🎬 VideoPromptPanel: No timeline item or media items available');
      setSelectedMedia(null);
      setEditedPrompt('');
      setEditedNegative('');
      setEditedWidth(undefined);
      setEditedHeight(undefined);
      setEditedFps(undefined);
      setEditedLength(undefined);
      setEditedSeed(undefined);
    }
  }, [selectedTimelineItem, mediaItems]);

  const loadTimeline = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL ||
          import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
          window.location.origin
        }/api/projects/${projectId}/timeline`,
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
      
      // Filter for placed_video items and map to TimelineItem format
      const placedVideos = data.items
        ?.filter((item: any) => item.type === 'placed_video')
        .map((item: any) => ({
          id: item.id,
          refId: item.ref_id,
          startFrame: item.payload?.start_frame || 0,
          durationFrames: item.payload?.duration_frames || 60,
          track: item.payload?.track || 'Generated',
          fps: item.payload?.fps || 24,
        })) || [];

      setTimelineItems(placedVideos);
      onTimelineUpdate?.(placedVideos);
    } catch (error) {
      console.error('Failed to load timeline:', error);
      setError(`Failed to load timeline: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMedia = async () => {
    try {
      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL ||
          import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
          window.location.origin
        }/api/projects/${projectId}/media`,
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
        throw new Error(`Failed to load media: ${response.status}`);
      }

      const data = await response.json();
      console.log('🎬 VideoPromptPanel: Loaded media data:', data);
      console.log('🎬 VideoPromptPanel: First media item:', data.media?.[0]);
      console.log('🎬 VideoPromptPanel: All media IDs:', data.media?.map(m => ({ 
        id: m.id, 
        filename: m.filename,
        hasGenerationSettings: !!m.meta?.generation_settings,
        generationSettings: m.meta?.generation_settings
      })));
      
      const mediaItems = data.media || [];
      console.log('🎬 VideoPromptPanel: Setting media items count:', mediaItems.length);
      setMediaItems(mediaItems);
    } catch (error) {
      console.error('Failed to load media:', error);
      setError(`Failed to load media: ${error}`);
    }
  };

  const setupSocket = () => {
    if (!projectId) return;

    socketRef.current = wsAPI.connect(projectId);

    // Handle new media
    socketRef.current.on('media:new', (data: any) => {
      const { projectId: eventProjectId, media } = data;
      
      if (eventProjectId === projectId) {
        console.log('New media received:', media);
        // Track imported media only for generated videos
        try {
          if (typeof window !== 'undefined') {
            const src = media?.meta?.source || media?.meta?.generation_settings?.source;
            if (src === 'modal_generated') {
              (window as any).va?.('clip_regenerate_imported', {
                projectId,
                mediaId: media?.id,
                storage: media?.storage_backend || 's3',
              });
            }
          }
        } catch {}
        setMediaItems(prev => {
          const exists = prev.some(m => m.id === media.id);
          if (!exists) {
            return [...prev, media];
          }
          return prev;
        });
        
        // Check if this completes a batch
        checkBatchCompletion(media);
        
        onNewMedia?.(media);
      }
    });

    // Handle timeline updates
    socketRef.current.on('timeline:new', (data: any) => {
      const { projectId: eventProjectId } = data || {};
      const tItem = (data && (data.timelineItem || data.item)) || null;
      const type = tItem?.type || data?.type;
      const refId = tItem?.ref_id || data?.refId;
      
      if (eventProjectId === projectId) {
        console.log('Timeline update:', { type, refId, media });
        // Track replacement success for placed_* items
        try {
          if (typeof window !== 'undefined' && type && String(type).startsWith('placed_')) {
            (window as any).va?.('timeline_replace_success', {
              projectId,
              timelineItemId: tItem?.id,
              refId: refId,
              type,
            });
          }
        } catch {}
        // Reload timeline to get latest data
        loadTimeline();
      }
    });
  };

  const saveTimeline = async (items: TimelineItem[] = timelineItems) => {
    try {
      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL ||
          import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
          window.location.origin
        }/api/projects/${projectId}/timeline/placements`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('authToken')}`,
          },
          body: JSON.stringify({ items }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to save timeline: ${response.status}`);
      }

      console.log('✅ Timeline saved successfully');
    } catch (error) {
      console.error('Failed to save timeline:', error);
      setError(`Failed to save timeline: ${error}`);
    }
  };

  const debouncedSaveTimeline = () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeline();
    }, 1000); // 1 second debounce
  };

  const updateTimelineItem = (refId: string, updates: Partial<TimelineItem>) => {
    setTimelineItems(prev => {
      const updated = prev.map(item => 
        item.refId === refId ? { ...item, ...updates } : item
      );
      onTimelineUpdate?.(updated);
      return updated;
    });

    // Auto-save on update
    debouncedSaveTimeline();
  };

  // Extract batch information from filename
  const extractBatchInfo = (filename: string) => {
    // Format: u{userId}_p{projectId}_g{groupId}_s{shotNumber}_sf{startFrame}_df{durationFrames}_fps{fps}
    const match = filename.match(/g([a-zA-Z0-9]+)_s(\d+)_sf(\d+)_df(\d+)_fps(\d+)/);
    if (match) {
      return {
        groupId: match[1],
        shotNumber: parseInt(match[2]),
        startFrame: parseInt(match[3]),
        durationFrames: parseInt(match[4]),
        fps: parseInt(match[5])
      };
    }
    return null;
  };

  // Check if a batch is complete and trigger alignment
  const checkBatchCompletion = (media: MediaItem) => {
    const batchInfo = extractBatchInfo(media.filename);
    if (!batchInfo) return;

    const { groupId, shotNumber } = batchInfo;
    
    setBatchGroups(prev => {
      const newGroups = new Map(prev);
      const existing = newGroups.get(groupId);
      const now = Date.now();
      
      if (existing) {
        // Add this media to the batch
        const updated = {
          ...existing,
          received: [...existing.received, media],
          lastReceived: now
        };
        newGroups.set(groupId, updated);
        
        console.log(`[BATCH] Group ${groupId}: Received ${updated.received.length} videos`);
        
        // Reset the timeout for this batch
        const timeoutMap = batchTimeoutRef.current;
        if (timeoutMap.has(groupId)) {
          clearTimeout(timeoutMap.get(groupId)!);
        }
        
        // Set a new timeout to check for batch completion
        const timeout = setTimeout(() => {
          console.log(`[BATCH] Timeout reached for group ${groupId}, processing batch`);
          processBatch(groupId);
        }, 5000); // 5 second timeout
        
        timeoutMap.set(groupId, timeout);
      } else {
        // Start tracking this batch
        newGroups.set(groupId, {
          expected: 0,
          received: [media],
          lastReceived: now
        });
        
        // Set initial timeout
        const timeoutMap = batchTimeoutRef.current;
        const timeout = setTimeout(() => {
          console.log(`[BATCH] Timeout reached for group ${groupId}, processing batch`);
          processBatch(groupId);
        }, 5000); // 5 second timeout
        
        timeoutMap.set(groupId, timeout);
      }
      
      return newGroups;
    });
  };

  // Process a completed batch
  const processBatch = (groupId: string) => {
    setBatchGroups(prev => {
      const newGroups = new Map(prev);
      const batch = newGroups.get(groupId);
      
      if (batch && batch.received.length > 0) {
        // Sort by shot number to ensure proper order
        const sortedVideos = batch.received.sort((a, b) => {
          const aInfo = extractBatchInfo(a.filename);
          const bInfo = extractBatchInfo(b.filename);
          return (aInfo?.shotNumber || 0) - (bInfo?.shotNumber || 0);
        });
        
        console.log(`[BATCH] Processing batch ${groupId} with ${sortedVideos.length} videos`);
        onBatchComplete?.(sortedVideos);
        
        // Remove from tracking
        newGroups.delete(groupId);
      }
      
      // Clear timeout
      const timeoutMap = batchTimeoutRef.current;
      if (timeoutMap.has(groupId)) {
        clearTimeout(timeoutMap.get(groupId)!);
        timeoutMap.delete(groupId);
      }
      
      return newGroups;
    });
  };

  // Expose methods for parent components
  React.useImperativeHandle(ref, () => ({
    saveTimeline: () => saveTimeline(),
    loadTimeline,
    updateTimelineItem,
    timelineItems,
  }));

  const formatPrompt = (prompt: string) => {
    if (!prompt) return 'No prompt available';
    return prompt.length > 200 ? `${prompt.substring(0, 200)}...` : prompt;
  };

  const formatNegativePrompt = (negative: string) => {
    if (!negative) return 'None';
    return negative.length > 100 ? `${negative.substring(0, 100)}...` : negative;
  };

  return (
    <div
      id="video-prompt-panel"
      style={{
        padding: 8,
        border: '1px solid #262933',
        borderRadius: 6,
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: '100%',
        overflow: 'hidden',
        wordBreak: 'break-word',
        background: '#0e1015',
        color: '#cbd5e1',
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Video Prompt</div>
      
      {error && (
        <div style={{ color: 'red', marginBottom: '10px' }}>
          Error: {error}
        </div>
      )}

      {selectedMedia ? (
        <div>
          <div style={{ marginBottom: '15px' }}>
            <strong>Selected Video:</strong>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
              {selectedMedia.filename}
            </div>
          </div>

          {selectedMedia.meta?.generation_settings ? (
            <div style={{ fontSize: '12px' }}>
              <div style={{ marginBottom: 8 }}>
                <strong>Positive Prompt:</strong>
                <div style={{ marginTop: 4 }}>
                  <textarea
                    value={editedPrompt}
                    onChange={(e) => setEditedPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      // Prevent global timeline shortcuts while typing
                      if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Delete' || e.key === 'Backspace' || e.key.startsWith('Arrow')) {
                        e.stopPropagation();
                      }
                    }}
                    rows={5}
                    style={{ width: '100%', padding: 8, borderRadius: 4, fontFamily: 'monospace', fontSize: 12, backgroundColor: '#0f131a', color: '#e5e7eb', border: '1px solid #303645', boxSizing: 'border-box' }}
                    placeholder="Enter prompt..."
                  />
                </div>
              </div>

              <div style={{ marginBottom: 8 }}>
                <strong>Negative Prompt:</strong>
                <div style={{ marginTop: 4 }}>
                  <textarea
                    value={editedNegative}
                    onChange={(e) => setEditedNegative(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Delete' || e.key === 'Backspace' || e.key.startsWith('Arrow')) {
                        e.stopPropagation();
                      }
                    }}
                    rows={4}
                    style={{ width: '100%', padding: 8, borderRadius: 4, fontFamily: 'monospace', fontSize: 12, backgroundColor: '#0f131a', color: '#e5e7eb', border: '1px solid #303645', boxSizing: 'border-box' }}
                    placeholder="Enter negative prompt..."
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <strong>Resolution:</strong>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <input type="number" placeholder="width" value={editedWidth ?? ''}
                      onChange={(e) => setEditedWidth(e.target.value ? Number(e.target.value) : undefined)}
                      style={{ width: 80, padding: 4, background: '#0f131a', color: '#e5e7eb', border: '1px solid #303645', borderRadius: 4 }} />
                    ×
                    <input type="number" placeholder="height" value={editedHeight ?? ''}
                      onChange={(e) => setEditedHeight(e.target.value ? Number(e.target.value) : undefined)}
                      style={{ width: 80, padding: 4, background: '#0f131a', color: '#e5e7eb', border: '1px solid #303645', borderRadius: 4 }} />
                  </div>
                </div>
                <div>
                  <strong>FPS:</strong>
                  <div style={{ marginTop: 4 }}>
                    <input type="number" placeholder="fps" value={editedFps ?? ''}
                      onChange={(e) => setEditedFps(e.target.value ? Number(e.target.value) : undefined)}
                      style={{ width: 80, padding: 4, background: '#0f131a', color: '#e5e7eb', border: '1px solid #303645', borderRadius: 4 }} />
                  </div>
                </div>
                <div>
                  <strong>Length (frames):</strong>
                  <div style={{ marginTop: 4 }}>
                    <input type="number" placeholder="frames" value={editedLength ?? ''}
                      onChange={(e) => setEditedLength(e.target.value ? Number(e.target.value) : undefined)}
                      style={{ width: 100, padding: 4, background: '#0f131a', color: '#e5e7eb', border: '1px solid #303645', borderRadius: 4 }} />
                  </div>
                </div>
                <div>
                  <strong>Seed:</strong>
                  <div style={{ marginTop: 4 }}>
                    <input type="number" placeholder="seed" value={editedSeed ?? ''}
                      onChange={(e) => setEditedSeed(e.target.value ? Number(e.target.value) : undefined)}
                      style={{ width: 120, padding: 4, background: '#0f131a', color: '#e5e7eb', border: '1px solid #303645', borderRadius: 4 }} />
                  </div>
                </div>
              </div>

      <div style={{ marginTop: '10px' }}>
        {/* Regenerate Clip Button */}
        <div style={{ marginTop: '10px' }}>
          <div style={{ fontSize: '11px', color: matchedItem ? '#2e7d32' : '#666', marginBottom: 6 }}>
            {matchedItem ? 'Action: Replace existing timeline item' : 'Action: Add as new placed clip'}
          </div>
          <button
            onClick={async () => {
              try {
                if (!selectedTimelineItem) return;
                setIsLoading(true);
                setError(null);

                // Find current timeline item ID if available
                const currentItem = matchedItem;

                // Use user-edited values or fallbacks
                const width = editedWidth || 512;
                const height = editedHeight || 384;
                const fps = editedFps || selectedTimelineItem.fps || 24;
                const length = editedLength || selectedTimelineItem.durationFrames || 60;
                const params = {
                  prompt: String(editedPrompt || ''),
                  negative: String(editedNegative || ''),
                  width,
                  height,
                  length,
                  fps,
                  seed: editedSeed,
                };

                // Always include refId so backend can fall back if timelineItemId is stale
                const body: any = {
                  params,
                  refId: selectedTimelineItem.refId,
                };
                // Provide timelineItemId only if it looks like a UUID; otherwise, let server fall back via refId
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                const candidateId = currentItem?.id || selectedTimelineItem?.id;
                if (candidateId && uuidRegex.test(String(candidateId))) {
                  body.timelineItemId = candidateId;
                }

                console.log('🎬 Regenerating clip with:', body);
                const resp = await videoGenerationAPI.regenerateClip(projectId, body);
                console.log('🎬 Regenerate response:', resp);

                // Track submission event
                try {
                  if (typeof window !== 'undefined') {
                    (window as any).va?.('clip_regenerate_submitted', {
                      projectId,
                      timelineItemId: body.timelineItemId || null,
                      refId: body.refId,
                      width,
                      height,
                      length,
                      fps,
                      hasSeed: typeof editedSeed === 'number',
                    });
                  }
                } catch {}

                // Kick off per-job progress (single-shot)
                const promptId = resp?.promptId || '';
                const clientId = resp?.clientId || '';
                const endpoint = resp?.endpoint || '';
                // Ensure progress overlay uses the exact Modal endpoint for this job
                if (endpoint) {
                  try { localStorage.setItem('modalEndpoint', String(endpoint)); } catch {}
                }
                const shotLen = Number(length) || 60;
                startVideoGeneration(`regen-${Date.now()}`, [{
                  index: 1,
                  length: shotLen,
                  promptId: String(promptId),
                  clientId: String(clientId),
                  status: 'pending',
                  startTime: Date.now(),
                } as any], projectId);
                // Rely on sockets (media:new / timeline:new) and progress overlay to reflect updates
              } catch (e: any) {
                console.error('Regenerate failed:', e);
                setError(`Regenerate failed: ${e?.message || e}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={!selectedTimelineItem || !selectedMedia || isLoading}
            style={{ marginTop: 6, padding: '6px 10px', backgroundColor: '#0d6efd', color: '#fff', border: 'none', borderRadius: 4, cursor: selectedTimelineItem && selectedMedia && !isLoading ? 'pointer' : 'not-allowed' }}
          >
            {isLoading ? 'Regenerating…' : 'Regenerate Clip'}
          </button>
        </div>
      </div>
            </div>
          ) : (
        <div style={{ padding: 12, textAlign: 'center', color: '#8b93a3', backgroundColor: '#0f131a', borderRadius: 6 }}>
          <div style={{ fontSize: '12px' }}>
            No generation data available for this video.
            <br />
            This video may have been uploaded manually.
          </div>
        </div>
      )}
        </div>
      ) : (
        <div style={{ padding: 12, textAlign: 'center', color: '#8b93a3', backgroundColor: '#0f131a', borderRadius: 6 }}>
          <div style={{ fontSize: '12px' }}>
            Select a video clip from the timeline to view its generation prompt.
          </div>
        </div>
      )}

      {/* Removed verbose debug/status boxes for a cleaner UI */}
    </div>
  );
});
