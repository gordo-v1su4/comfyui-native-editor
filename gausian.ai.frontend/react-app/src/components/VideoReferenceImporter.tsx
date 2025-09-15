import React, { useState, useEffect } from "react";
import { mediaAPI } from "../api.js";

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

interface VideoReferenceImporterProps {
  projectId?: string;
  onVideoReferenceAdded?: (videoRef: VideoReference) => void;
}

const VideoReferenceImporter: React.FC<VideoReferenceImporterProps> = ({
  projectId,
  onVideoReferenceAdded,
}) => {
  const [videoReferences, setVideoReferences] = useState<VideoReference[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    sourceUrl: "",
    sourcePath: "",
    sourceType: "url" as "url" | "local_file" | "google_drive" | "dropbox",
    duration: "",
    width: "",
    height: "",
    fps: "",
    codec: "",
  });

  useEffect(() => {
    loadVideoReferences();
  }, []);

  const loadVideoReferences = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("authToken");
      const data = await mediaAPI.getAllVideoReferences();
      setVideoReferences(data.videoReferences || []);
    } catch (error) {
      setError("Error loading video references");
    } finally {
      setLoading(false);
    }
  };

  const extractMetadata = async () => {
    if (!formData.sourceUrl && !formData.sourcePath) {
      setError("Please provide either a URL or file path");
      return;
    }

    try {
      setLoading(true);
      const token = localStorage.getItem("authToken");
      const metadata = await mediaAPI.extractMetadata({
        sourceUrl: formData.sourceUrl || undefined,
        sourcePath: formData.sourcePath || undefined,
      });
        setFormData((prev) => ({
          ...prev,
          duration: metadata.duration?.toString() || "",
          width: metadata.width?.toString() || "",
          height: metadata.height?.toString() || "",
          fps: metadata.fps?.toString() || "",
          codec: metadata.codec || "",
        }));
      } else {
        setError(
          "Failed to extract metadata. You can still add the video reference manually."
        );
      }
    } catch (error) {
      setError(
        "Failed to extract metadata. You can still add the video reference manually."
      );
    } finally {
      setLoading(false);
    }
  };

  const addVideoReference = async () => {
    if (!formData.name) {
      setError("Video name is required");
      return;
    }

    if (!formData.sourceUrl && !formData.sourcePath) {
      setError("Either source URL or file path is required");
      return;
    }

    try {
      setLoading(true);
      const token = localStorage.getItem("authToken");
      const newVideoRef = await mediaAPI.createVideoReference({
        name: formData.name,
        sourceUrl: formData.sourceUrl || undefined,
        sourcePath: formData.sourcePath || undefined,
        sourceType: formData.sourceType,
        duration: formData.duration
          ? parseFloat(formData.duration)
          : undefined,
        width: formData.width ? parseInt(formData.width) : undefined,
        height: formData.height ? parseInt(formData.height) : undefined,
        fps: formData.fps ? parseFloat(formData.fps) : undefined,
        codec: formData.codec || undefined,
      });
        setVideoReferences((prev) => [newVideoRef, ...prev]);
        setFormData({
          name: "",
          sourceUrl: "",
          sourcePath: "",
          sourceType: "url",
          duration: "",
          width: "",
          height: "",
          fps: "",
          codec: "",
        });
        setShowAddForm(false);
        setError(null);

        if (onVideoReferenceAdded) {
          onVideoReferenceAdded(newVideoRef);
        }
      } else {
        const errorData = await response.json();
        setError(errorData.error || "Failed to add video reference");
      }
    } catch (error) {
      setError("Error adding video reference");
    } finally {
      setLoading(false);
    }
  };

  const deleteVideoReference = async (videoId: string) => {
    if (!confirm("Are you sure you want to delete this video reference?")) {
      return;
    }

    try {
      const token = localStorage.getItem("authToken");
      await mediaAPI.deleteVideo(videoId);
      setVideoReferences((prev) => prev.filter((v) => v.id !== videoId));
    } catch (error) {
      setError("Error deleting video reference");
    }
  };

  const getSourceDisplay = (videoRef: VideoReference) => {
    if (videoRef.source_url) {
      return videoRef.source_url.length > 50
        ? videoRef.source_url.substring(0, 50) + "..."
        : videoRef.source_url;
    }
    if (videoRef.source_path) {
      return videoRef.source_path.length > 50
        ? videoRef.source_path.substring(0, 50) + "..."
        : videoRef.source_path;
    }
    return "Unknown source";
  };

  return (
    <div
      style={{
        padding: "1rem",
        backgroundColor: "#f8f9fa",
        borderRadius: "8px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <h3 style={{ margin: 0, color: "#333" }}>Video References</h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          {showAddForm ? "Cancel" : "Add Video Reference"}
        </button>
      </div>

      {error && (
        <div
          style={{
            backgroundColor: "#fee",
            color: "#c33",
            padding: "0.75rem",
            borderRadius: "4px",
            marginBottom: "1rem",
            border: "1px solid #fcc",
          }}
        >
          {error}
        </div>
      )}

      {showAddForm && (
        <div
          style={{
            backgroundColor: "white",
            padding: "1rem",
            borderRadius: "4px",
            marginBottom: "1rem",
            border: "1px solid #ddd",
          }}
        >
          <h4 style={{ marginTop: 0 }}>Add Video Reference</h4>

          <div style={{ marginBottom: "1rem" }}>
            <label
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontWeight: "bold",
              }}
            >
              Video Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="Enter video name"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #ddd",
                borderRadius: "4px",
              }}
            />
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontWeight: "bold",
              }}
            >
              Source Type
            </label>
            <select
              value={formData.sourceType}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  sourceType: e.target.value as any,
                }))
              }
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #ddd",
                borderRadius: "4px",
              }}
            >
              <option value="url">URL (Google Drive, Dropbox, etc.)</option>
              <option value="local_file">Local File Path</option>
              <option value="google_drive">Google Drive</option>
              <option value="dropbox">Dropbox</option>
            </select>
          </div>

          {formData.sourceType === "url" ||
          formData.sourceType === "google_drive" ||
          formData.sourceType === "dropbox" ? (
            <div style={{ marginBottom: "1rem" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "0.5rem",
                  fontWeight: "bold",
                }}
              >
                Source URL *
              </label>
              <input
                type="url"
                value={formData.sourceUrl}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    sourceUrl: e.target.value,
                  }))
                }
                placeholder="https://drive.google.com/file/d/... or https://dropbox.com/s/..."
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                }}
              />
            </div>
          ) : (
            <div style={{ marginBottom: "1rem" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "0.5rem",
                  fontWeight: "bold",
                }}
              >
                File Path *
              </label>
              <input
                type="text"
                value={formData.sourcePath}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    sourcePath: e.target.value,
                  }))
                }
                placeholder="/Users/username/Videos/my_video.mp4"
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                }}
              />
            </div>
          )}

          <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
            <button
              onClick={extractMetadata}
              disabled={
                loading || (!formData.sourceUrl && !formData.sourcePath)
              }
              style={{
                padding: "0.5rem 1rem",
                backgroundColor: "#28a745",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "Extracting..." : "Extract Metadata"}
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "1rem",
              marginBottom: "1rem",
            }}
          >
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem" }}>
                Duration (seconds)
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.duration}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, duration: e.target.value }))
                }
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem" }}>
                Width
              </label>
              <input
                type="number"
                value={formData.width}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, width: e.target.value }))
                }
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem" }}>
                Height
              </label>
              <input
                type="number"
                value={formData.height}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, height: e.target.value }))
                }
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem" }}>
                FPS
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.fps}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, fps: e.target.value }))
                }
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem" }}>
              Codec
            </label>
            <input
              type="text"
              value={formData.codec}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, codec: e.target.value }))
              }
              placeholder="h264, h265, etc."
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #ddd",
                borderRadius: "4px",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: "1rem" }}>
            <button
              onClick={addVideoReference}
              disabled={loading}
              style={{
                padding: "0.5rem 1rem",
                backgroundColor: "#007bff",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "Adding..." : "Add Video Reference"}
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              style={{
                padding: "0.5rem 1rem",
                backgroundColor: "#6c757d",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && !showAddForm && (
        <div style={{ textAlign: "center", padding: "1rem" }}>
          Loading video references...
        </div>
      )}

      {!loading && videoReferences.length === 0 && (
        <div style={{ textAlign: "center", padding: "1rem", color: "#666" }}>
          No video references found. Add your first video reference above.
        </div>
      )}

      {videoReferences.length > 0 && (
        <div style={{ display: "grid", gap: "1rem" }}>
          {videoReferences.map((videoRef) => (
            <div
              key={videoRef.id}
              style={{
                backgroundColor: "white",
                padding: "1rem",
                borderRadius: "4px",
                border: "1px solid #ddd",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ flex: 1 }}>
                <h4 style={{ margin: "0 0 0.5rem 0", color: "#333" }}>
                  {videoRef.name}
                </h4>
                <p
                  style={{
                    margin: "0 0 0.5rem 0",
                    fontSize: "0.9rem",
                    color: "#666",
                  }}
                >
                  Source: {getSourceDisplay(videoRef)}
                </p>
                <p
                  style={{
                    margin: "0 0 0.5rem 0",
                    fontSize: "0.9rem",
                    color: "#666",
                  }}
                >
                  Type: {videoRef.source_type} | Duration:{" "}
                  {videoRef.duration ? `${videoRef.duration}s` : "Unknown"}
                </p>
                {videoRef.width && videoRef.height && (
                  <p style={{ margin: "0", fontSize: "0.9rem", color: "#666" }}>
                    Resolution: {videoRef.width}x{videoRef.height}
                    {videoRef.fps && ` | FPS: ${videoRef.fps}`}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={() => deleteVideoReference(videoRef.id)}
                  style={{
                    padding: "0.25rem 0.5rem",
                    backgroundColor: "#dc3545",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VideoReferenceImporter;
