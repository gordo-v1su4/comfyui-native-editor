import React, { useState, useRef, useEffect, useCallback } from "react";
import type { Track } from "../types";
import { VideoProcessor, videoUtils } from "../utils/videoUtils";
import { mediaAPI, wsAPI } from "../api.js";

// Use backend base URL from env, fall back to current origin
const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
  (typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:3001");

interface VideoReference {
  id: string;
  name: string;
  source_url?: string;
  source_path?: string;
  source_type: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  thumbnail?: string;
  metadata?: any;
  created_at: string;
}

interface MediaFile {
  id: string;
  name: string;
  type: "image" | "video" | "audio";
  url: string;
  size: number;
  duration?: number;
  thumbnail?: string;
  width?: number;
  height?: number;
  format?: string;
  frameRate?: number;
  isTiny?: boolean;
}

interface MediaImporterProps {
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  currentFrame: number;
  mediaFiles?: MediaFile[];
  setMediaFiles?: React.Dispatch<React.SetStateAction<MediaFile[]>>;
  projectId?: string;
  onVideoReferenceSelect?: (videoRef: VideoReference) => void;
  onMediaImportComplete?: (isComplete: boolean) => void;
}

export const MediaImporter: React.FC<MediaImporterProps> = ({
  tracks,
  setTracks,
  currentFrame,
  mediaFiles: externalMediaFiles,
  setMediaFiles: externalSetMediaFiles,
  projectId,
  onMediaImportComplete,
}) => {
  // Add CSS for pulse animation
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  const [internalMediaFiles, setInternalMediaFiles] = useState<MediaFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [successMessages, setSuccessMessages] = useState<string[]>([]);
  const [isLoadingApiVideos, setIsLoadingApiVideos] = useState(false);
  const [hasLoadedVideos, setHasLoadedVideos] = useState(false);
  
  console.log("🎬 MediaImporter: Component rendered", { projectId, hasLoadedVideos });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mediaFiles = externalMediaFiles || internalMediaFiles;
  const setMediaFiles = externalSetMediaFiles || setInternalMediaFiles;

  // Function to add success message and auto-hide it after 2 seconds
  const addSuccessMessage = (message: string) => {
    setSuccessMessages((prev) => [...prev, message]);
    setTimeout(() => {
      setSuccessMessages((prev) => prev.filter((msg) => msg !== message));
    }, 2000);
  };

  // Build a proxied stream URL that carries the JWT in the query string.
  const buildStreamUrl = (projectId: string, mediaId: string) => {
    const base = `${API_BASE.replace(
      /\/$/,
      ""
    )}/api/projects/${projectId}/media/${mediaId}/stream`;
    const token =
      (typeof window !== "undefined" && localStorage.getItem("authToken")) ||
      "";
    const url = token ? `${base}?t=${encodeURIComponent(token)}` : base;
    console.log('🎬 MediaImporter: Building stream URL:', {
      projectId,
      mediaId,
      base,
      hasToken: !!token,
      finalUrl: url
    });
    return url;
  };

  // Function to validate and correct video duration
  const validateVideoDuration = async (
    mediaFile: MediaFile
  ): Promise<MediaFile> => {
    if (mediaFile.type !== "video" || !mediaFile.url) {
      return mediaFile;
    }

    try {
      // Try to get the actual duration from the video element
      const duration = await new Promise<number>((resolve) => {
        const video = document.createElement("video");
        video.src = mediaFile.url;

        video.onloadedmetadata = () => {
          let actualDuration = video.duration;

          // Validate duration
          if (!actualDuration || isNaN(actualDuration) || actualDuration <= 0) {
            console.warn(
              `Invalid duration for ${mediaFile.name}: ${actualDuration}, using stored value: ${mediaFile.duration}`
            );
            actualDuration = mediaFile.duration || 1;
          }

          video.remove();
          resolve(actualDuration);
        };

        video.onerror = () => {
          console.warn(
            `Failed to load metadata for ${mediaFile.name}, using stored duration: ${mediaFile.duration}`
          );
          video.remove();
          resolve(mediaFile.duration || 1);
        };
      });

      // Log duration information for debugging
      if (Math.abs(duration - (mediaFile.duration || 0)) > 0.1) {
        console.log(`Duration corrected for ${mediaFile.name}:`, {
          stored: mediaFile.duration,
          actual: duration,
          difference: Math.abs(duration - (mediaFile.duration || 0)),
          frameRate: mediaFile.frameRate,
          framesAtStoredFps: Math.floor(
            (mediaFile.duration || 0) * (mediaFile.frameRate || 30)
          ),
          framesAtActualFps: Math.floor(duration * (mediaFile.frameRate || 30)),
        });
      }

      return {
        ...mediaFile,
        duration: duration,
      };
    } catch (error) {
      console.warn(`Failed to validate duration for ${mediaFile.name}:`, error);
      return mediaFile;
    }
  };

  // Function to load video references from API server
  const loadVideoReferencesFromAPI = useCallback(async () => {
    setIsLoadingApiVideos(true);
    try {
      // Clear prior success badges so the red box doesn’t balloon
      setUploadErrors((prev) => prev.filter((m) => !m.startsWith("✅")));

      if (projectId) {
        // ---- Project-scoped load ----
        console.log(
          `🔄 Loading project-specific media for project: ${projectId}`
        );
        console.log('🔄 MediaImporter: Making API call to getByProject...');
        const data = await mediaAPI.getByProject(projectId); // already JSON
        console.log('🔄 MediaImporter: API response received:', data);

        // Accept any of these shapes: {media}, {items}, {videoReferences}
        const list: any[] = (
          data?.media ||
          data?.items ||
          data?.videoReferences ||
          []
        ).filter((v: any) => !v.kind || v.kind === "video");
        
        console.log('🔄 MediaImporter: Found videos in API response:', list.length);
        console.log('🔄 MediaImporter: Video details:', list.map(v => ({ id: v.id, filename: v.filename })));

        // Map backend rows -> MediaFile (force proxy URL to avoid CORS, and include ?t=<JWT>)
        const projectVideos: MediaFile[] = list.map((row: any) => {
          const proxied = buildStreamUrl(projectId, row.id);
          return {
            id: row.id,
            name: row.filename || row.name || row.id,
            type: "video",
            url: proxied,
            size: row.metadata?.size || 0,
            duration: row.duration || 0,
            thumbnail: row.thumbnail || undefined,
            width: row.width,
            height: row.height,
            format: row.codec,
            frameRate: row.fps,
          };
        });

        // CRITICAL FIX: Deduplicate by filename to prevent ID mismatches
        const deduplicatedVideos = projectVideos.reduce((acc: MediaFile[], video) => {
          const existingIndex = acc.findIndex(v => v.name === video.name);
          if (existingIndex >= 0) {
            console.log(`🔄 MediaImporter: Deduplicating video ${video.name} - keeping existing ID ${acc[existingIndex].id}, discarding ${video.id}`);
            // Keep the existing video, but update with latest metadata if needed
            acc[existingIndex] = { ...acc[existingIndex], ...video, id: acc[existingIndex].id };
          } else {
            acc.push(video);
          }
          return acc;
        }, []);

        console.log(`🔄 MediaImporter: Deduplication result: ${projectVideos.length} -> ${deduplicatedVideos.length} videos`);

        // Validate and correct video durations
        const validatedVideos = await Promise.all(
          deduplicatedVideos.map((video) => validateVideoDuration(video))
        );

        setMediaFiles(validatedVideos);

        // Generate thumbnails asynchronously (from the proxied URL)
        deduplicatedVideos.forEach(async (video) => {
          // Quick HEAD check for tiny-object JSON from stream proxy
          try {
            const headResp = await fetch(video.url, { method: 'HEAD', credentials: 'include' });
            const ct = headResp.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
              setMediaFiles((prev) => prev.map((f) => f.id === video.id ? { ...f, isTiny: true } : f));
              return; // Skip thumbnail until it becomes available
            }
          } catch {}
          try {
            const thumbnail = await VideoProcessor.createVideoThumbnailFromUrl(
              video.url,
              1
            );
            setMediaFiles((prev) =>
              prev.map((f) => (f.id === video.id ? { ...f, thumbnail } : f))
            );
          } catch (err) {
            console.warn(
              `⚠️ Failed to generate thumbnail for ${video.name}:`,
              err
            );
            const defaultThumbnail =
              "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSIjMjE5NkYzIi8+CjxwYXRoIGQ9Ik0yNCA0MEw0MCAzMkw0MCA0MEwyNCA0MFoiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo=";
            setMediaFiles((prev) =>
              prev.map((f) => f.id === video.id ? { ...f, thumbnail: defaultThumbnail } : f)
            );
          }
        });

        console.log(`Loaded ${deduplicatedVideos.length} project video references (deduplicated)`);
        if (deduplicatedVideos.length > 0) {
          addSuccessMessage(`✅ Successfully loaded ${deduplicatedVideos.length} video references from project (deduplicated)`);
        }
        
        // Notify parent component that media import is complete
        if (onMediaImportComplete) {
          onMediaImportComplete(true);
        }
      } else {
        // ---- Global load ----
        console.log("🔄 Loading global video references");
        const data = await mediaAPI.getAllVideoReferences(); // already JSON

        const list: any[] = (
          data?.items ||
          data?.media ||
          data?.videoReferences ||
          []
        ).filter((v: any) => !v.kind || v.kind === "video");

        const apiVideos: MediaFile[] = list.map((row: any) => {
          const raw =
            row.remote_url ||
            row.source_url ||
            row.source_path ||
            row.path ||
            "";
          const url =
            raw && typeof raw === "string"
              ? raw.startsWith("http")
                ? raw
                : `${API_BASE.replace(/\/$/, "")}${
                    raw.startsWith("/") ? "" : "/"
                  }${raw}`
              : "";

          return {
            id: row.id,
            name: row.filename || row.name || row.id,
            type: "video",
            url,
            size: row.metadata?.size || 0,
            duration: row.duration || 0,
            thumbnail: row.thumbnail || undefined,
            width: row.width,
            height: row.height,
            format: row.codec,
            frameRate: row.fps,
          };
        });

        // Validate and correct video durations
        const validatedApiVideos = await Promise.all(
          apiVideos.map((video) => validateVideoDuration(video))
        );

        setMediaFiles((prev) => {
          const seen = new Set(prev.map((f) => f.id));
          const add = validatedApiVideos.filter((v) => !seen.has(v.id));
          return [...prev, ...add];
        });

        apiVideos.forEach(async (video) => {
          try {
            const headResp = await fetch(video.url, { method: 'HEAD', credentials: 'include' });
            const ct = headResp.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
              setMediaFiles((prev) => prev.map((f) => f.id === video.id ? { ...f, isTiny: true } : f));
              return;
            }
          } catch {}
          try {
            const thumb = await VideoProcessor.createVideoThumbnailFromUrl(
              video.url,
              1
            );
            setMediaFiles((prev) =>
              prev.map((f) =>
                f.id === video.id ? { ...f, thumbnail: thumb } : f
              )
            );
          } catch (err) {
            console.warn(
              `⚠️ Failed to generate thumbnail for ${video.name}:`,
              err
            );
          }
        });

        console.log(`Loaded ${apiVideos.length} global video references`);
        if (apiVideos.length > 0) {
          addSuccessMessage(`✅ Successfully loaded ${apiVideos.length} video references from global API`);
        }
        
        // Notify parent component that media import is complete
        if (onMediaImportComplete) {
          onMediaImportComplete(true);
        }
      }
      
      // Mark as loaded to prevent re-loading
      setHasLoadedVideos(true);
    } catch (error) {
      console.error("Failed to load video references from API:", error);
      setUploadErrors((prev) => [
        ...prev,
        `Failed to load video references from API: ${String(error)}`,
      ]);
      
      // Notify parent component that media import is complete (even on error)
      if (onMediaImportComplete) {
        onMediaImportComplete(true);
      }
      
      // Mark as loaded even on error to prevent infinite retries
      setHasLoadedVideos(true);
    } finally {
      setIsLoadingApiVideos(false);
    }
  }, [projectId, onMediaImportComplete, addSuccessMessage]);

  // Reset loaded state when project changes
  useEffect(() => {
    setHasLoadedVideos(false);
  }, [projectId]);

  // Listen for new media uploads via socket (use shared ws client so it targets API host)
  useEffect(() => {
    if (!projectId) return;
    
    const handleNewMedia = (data: any) => {
      if (data.projectId === projectId) {
        console.log('🎬 MediaImporter: New media uploaded, reloading...');
        setHasLoadedVideos(false);
        setTimeout(() => {
          loadVideoReferencesFromAPI();
        }, 500);
      }
    };
    const socket = wsAPI.getSocket() || wsAPI.connect(projectId);
    socket.on('media:new', handleNewMedia);
    return () => {
      try { socket.off('media:new', handleNewMedia); } catch {}
    };
  }, [projectId]);

  // Load on mount / project change
  useEffect(() => {
    // Only load if we haven't loaded yet
    if (!projectId || hasLoadedVideos) return;
    
    console.log(`🔄 MediaImporter: Starting load process for project ${projectId}, hasLoadedVideos: ${hasLoadedVideos}`);
    
    const timer = setTimeout(() => {
      console.log(
        "🔄 MediaImporter: Attempting to load video references from API..."
      );
      loadVideoReferencesFromAPI();
    }, 1000); // Reduced delay to 1 second
    return () => clearTimeout(timer);
  }, [projectId, hasLoadedVideos, loadVideoReferencesFromAPI]); // Include the function in dependencies

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (!files) return;

    setIsUploading(true);
    setUploadErrors([]);
    const errors: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileType = file.type.split("/")[0] as "image" | "video" | "audio";

      if (!["image", "video", "audio"].includes(fileType)) {
        errors.push(`Unsupported file type: ${file.type}`);
        continue;
      }

      const fileUrl = URL.createObjectURL(file);

      const mediaFile: MediaFile = {
        id: `media-${Date.now()}-${i}`,
        name: file.name,
        type: fileType,
        url: fileUrl,
        size: file.size,
      };

      if (fileType === "video") {
        try {
          const videoInfo = await VideoProcessor.getVideoInfo(file);
          mediaFile.duration = videoInfo.duration;
          mediaFile.width = videoInfo.width;
          mediaFile.height = videoInfo.height;
          mediaFile.format = videoInfo.format;
          mediaFile.frameRate = videoInfo.frameRate;

          try {
            mediaFile.thumbnail = await VideoProcessor.createVideoThumbnail(
              file
            );
          } catch (error) {
            console.warn("Failed to create thumbnail:", error);
          }
        } catch (error) {
          errors.push(`${file.name}: Failed to process video - ${error}`);
          continue;
        }
      } else if (fileType === "audio") {
        try {
          const tempAudio = document.createElement("audio");
          tempAudio.src = fileUrl;
          tempAudio.onloadedmetadata = () => {
            setMediaFiles((prev) =>
              prev.map((mf) =>
                mf.id === mediaFile.id
                  ? { ...mf, duration: tempAudio.duration }
                  : mf
              )
            );
            URL.revokeObjectURL(tempAudio.src);
          };
          tempAudio.onerror = () => {
            URL.revokeObjectURL(tempAudio.src);
          };
        } catch (error) {
          console.warn("Failed to get audio duration:", error);
        }
      }

      setMediaFiles((prev) => [...prev, mediaFile]);

      if (projectId) {
        await addMediaToProject(mediaFile);
      }
    }

    setUploadErrors(errors);
    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeMediaFile = (mediaId: string) => {
    setMediaFiles((prev) => {
      const file = prev.find((f) => f.id === mediaId);
      if (file) URL.revokeObjectURL(file.url);
      return prev.filter((f) => f.id !== mediaId);
    });

    if (projectId) {
      const token =
        (typeof window !== "undefined" && localStorage.getItem("authToken")) ||
        "";
      fetch(
        `${API_BASE.replace(
          /\/$/,
          ""
        )}/api/projects/${projectId}/media/${mediaId}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        }
      ).catch(() => {});
    }
  };

  const addMediaToProject = async (mediaFile: MediaFile) => {
    if (!projectId) return;

    try {
      await mediaAPI.addMediaToProject(projectId, {
        mediaItems: [
          {
            name: mediaFile.name,
            type: mediaFile.type,
            filename: mediaFile.name,
            size: mediaFile.size,
            duration: mediaFile.duration,
          },
        ],
      });
      console.log(`✅ Added ${mediaFile.name} to project ${projectId}`);
    } catch (error) {
      console.error("Failed to add media to project:", error);
    }
  };

  return (
    <div style={{ padding: "8px", fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Library</div>

      {/* File Upload */}
      <div style={{ marginBottom: 8 }}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          onChange={handleFileUpload}
          style={{ display: "none" }}
        />
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            style={{ padding: "6px 10px", backgroundColor: "#007bff", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            {isUploading ? "Uploading..." : "📁 Import Media"}
          </button>
          <button
            onClick={() => {
              setHasLoadedVideos(false);
              setTimeout(() => {
                loadVideoReferencesFromAPI();
              }, 100);
            }}
            disabled={isLoadingApiVideos}
            style={{ padding: "6px 10px", backgroundColor: "#28a745", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            {isLoadingApiVideos ? "Loading..." : "🔄 Load Video References"}
          </button>
          <button
            onClick={() => {
              console.log("🔄 MediaImporter: Force loading videos...");
              try { if (typeof window !== 'undefined') { (window as any).va?.('importer_force_load', { projectId }); } } catch {}
              loadVideoReferencesFromAPI();
            }}
            disabled={isLoadingApiVideos}
            style={{ padding: "6px 10px", backgroundColor: "#ff9800", color: "white", border: "none", borderRadius: 4, cursor: "pointer", marginLeft: 8 }}
          >
            {isLoadingApiVideos ? "Loading..." : "🚀 Force Load"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#8b93a3", marginTop: 4 }}>
          Supported: Images, Videos (MP4/WebM/MOV), Audio (MP3/WAV)
        </div>
      </div>

      {/* Success Messages */}
      {successMessages.length > 0 && (
        <div
          style={{
            marginBottom: 8,
            padding: 8,
            backgroundColor: "#e8f5e8",
            color: "#2e7d32",
            borderRadius: "4px",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Success</div>
          <ul style={{ margin: "5px 0", paddingLeft: "20px" }}>
            {successMessages.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Upload Errors */}
      {uploadErrors.length > 0 && (
        <div
          style={{
            marginBottom: 8,
            padding: 8,
            backgroundColor: "#ffebee",
            color: "#c62828",
            borderRadius: "4px",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Upload Errors</div>
          <ul style={{ margin: "5px 0", paddingLeft: "20px" }}>
            {uploadErrors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Loading Indicator */}
      {isLoadingApiVideos && (
        <div
          style={{
            marginBottom: 8,
            padding: 8,
            backgroundColor: "#e3f2fd",
            borderRadius: "4px",
          }}
        >
          <div>🔄 Loading videos from API server...</div>
        </div>
      )}

      {/* Media Library */}
      {mediaFiles.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Media Library</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 8,
            }}
          >
            {mediaFiles.map((mediaFile) => (
              <div
                key={mediaFile.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/json",
                    JSON.stringify({ type: "media", mediaFile })
                  );
                  e.dataTransfer.effectAllowed = "copy";
                }}
                style={{ border: '1px solid #2b3140', borderRadius: 6, padding: 6, backgroundColor: '#0e1015', cursor: 'grab' }}
              >
                <div style={{ marginBottom: 6, textAlign: 'center' }}>
                  {mediaFile.type === "image" && (
                    <img
                      src={mediaFile.url}
                      alt={mediaFile.name}
                      style={{ width: '100%', height: 120, objectFit: 'contain', borderRadius: 4 }}
                    />
                  )}
                  {mediaFile.type === "video" && (
                    <div style={{ position: 'relative', width: '100%', aspectRatio: (mediaFile.width && mediaFile.height) ? `${mediaFile.width}/${mediaFile.height}` : '16/9', background: '#0a0c12', borderRadius: 4, overflow: 'hidden' }}>
                      {mediaFile.thumbnail ? (
                        <img src={mediaFile.thumbnail} alt={mediaFile.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: '#8b93a3' }}>
                          <span style={{ animation: 'pulse 1.5s infinite' }}>🎥</span>
                        </div>
                      )}
                    </div>
                  )}
                  {mediaFile.type === "audio" && (
                    <div style={{ fontSize: 18 }}>🎵</div>
                  )}
                </div>

                <div style={{ fontSize: 11, marginBottom: 6, color: '#b8c0cf' }}>
                  <div style={{ fontWeight: 600, color: '#d7deed', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mediaFile.name}</div>
                  <div style={{ opacity: 0.8 }}>
                    {mediaFile.duration ? videoUtils.formatDuration(mediaFile.duration) : '--'} • {videoUtils.formatFileSize(mediaFile.size)}
                  </div>
                  {mediaFile.width && mediaFile.height && (
                    <div style={{ opacity: 0.8 }}>{mediaFile.width}×{mediaFile.height}{mediaFile.frameRate ? ` @ ${mediaFile.frameRate}fps` : ''}</div>
                  )}
                  {mediaFile.format && <div style={{ opacity: 0.8 }}>{mediaFile.format}</div>}
                  {mediaFile.isTiny && (
                    <div style={{ marginTop: 6, padding: 6, background: '#fff3cd', color: '#856404', borderRadius: 4 }}>
                      <div style={{ fontWeight: 'bold', fontSize: 11 }}>Upload incomplete — retrying</div>
                      <button
                        onClick={() => {
                          const el = document.getElementById('video-prompt-panel');
                          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          else window.location.hash = '#video-prompt-panel';
                        }}
                        style={{
                          marginTop: 6,
                          padding: '4px 8px',
                          backgroundColor: '#1976d2',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 4,
                          fontSize: 11,
                          cursor: 'pointer'
                        }}
                      >
                        Regenerate
                      </button>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => removeMediaFile(mediaFile.id)}
                  style={{
                    width: '100%',
                    padding: 6,
                    backgroundColor: '#dc3545',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
