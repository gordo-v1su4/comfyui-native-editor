import React, { useState, useRef, useCallback } from "react";
import type { Track, Item } from "../types";

interface TimelineEditorProps {
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  currentFrame: number;
  setCurrentFrame: (frame: number) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  fps: number;
  durationInFrames: number;
  onDurationChange?: (duration: number) => void;
  onDropMedia?: (mediaFile: any, trackIndex: number, frame: number) => void;
  onExtendTimeline?: (requiredFrames: number) => void;
  onItemSelect?: (item: Item | null) => void;
}

const TIMELINE_HEIGHT = 220;
const TRACK_HEIGHT = 48;
const DEFAULT_FRAME_WIDTH = 2; // pixels per frame

export const TimelineEditor: React.FC<TimelineEditorProps> = ({
  tracks,
  setTracks,
  currentFrame,
  setCurrentFrame,
  isPlaying,
  setIsPlaying,
  fps,
  durationInFrames,
  onDurationChange,
  onDropMedia,
  onExtendTimeline,
  onItemSelect,
}) => {
  const [frameWidth, setFrameWidth] = useState<number>(DEFAULT_FRAME_WIDTH);
  const [draggedItem, setDraggedItem] = useState<{
    item: Item;
    trackIndex: number;
    originalTrackIndex: number;
    originalFrom: number;
    grabOffset: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const timelineRef = useRef<HTMLDivElement>(null);

  const formatTime = (frame: number) => {
    const seconds = frame / fps;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!timelineRef.current) return;

      // Check if we clicked on the background (not on an item)
      const target = e.target as HTMLElement;
      if (
        target.classList.contains("timeline") ||
        target === timelineRef.current
      ) {
        handleTimelineBackgroundClick();
      }

      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;

      // Calculate frame directly from the timeline content area
      const frame = Math.floor(x / frameWidth);
      const clampedFrame = Math.max(0, Math.min(frame, durationInFrames - 1));
      setCurrentFrame(clampedFrame);
    },
    [setCurrentFrame, durationInFrames, frameWidth]
  );

  // Keyboard shortcuts for selection
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts while typing in inputs/textareas/contenteditable
      const active = (document.activeElement as HTMLElement | null);
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelectedItems();
      } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        // Select all items
        const allItemIds = new Set<string>();
        tracks.forEach((track) => {
          track.items.forEach((item) => allItemIds.add(item.id));
        });
        setSelectedItems(allItemIds);
      } else if (e.key === "Escape") {
        setSelectedItems(new Set());
      } else if (e.key === " ") {
        e.preventDefault(); // Prevent page scrolling
        setIsPlaying(!isPlaying);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedItems, tracks, isPlaying, setIsPlaying]);

  const handleItemMouseDown = (
    e: React.MouseEvent,
    item: Item,
    trackIndex: number
  ) => {
    e.stopPropagation();
    setIsDragging(true);
    // Calculate grab offset: where the mouse is relative to the item's left edge
    const itemLeft = item.from * frameWidth;
    const mouseX = e.clientX;
    const timelineLeft = timelineRef.current?.getBoundingClientRect().left || 0;
    const grabOffset = mouseX - (timelineLeft + itemLeft);

    setDraggedItem({
      item,
      trackIndex,
      originalTrackIndex: trackIndex,
      originalFrom: item.from,
      grabOffset: grabOffset,
    });
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !draggedItem || !timelineRef.current) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // Use grab offset to maintain the original mouse position relative to the item
      const adjustedX = x - draggedItem.grabOffset;
      const newFrom = Math.max(0, Math.floor(adjustedX / frameWidth));

      // Check if we need to extend the timeline first
      const requiredFrames = newFrom + draggedItem.item.durationInFrames;
      if (requiredFrames > durationInFrames && onExtendTimeline) {
        onExtendTimeline(requiredFrames);
      }

      // Determine potential target track based on Y position (below the ruler area)
      let targetTrackIndex = draggedItem.trackIndex;
      const tracksAreaTop = 20; // ruler height
      if (y >= tracksAreaTop) {
        const relativeY = y - tracksAreaTop;
        const indexGuess = Math.floor(relativeY / TRACK_HEIGHT);
        targetTrackIndex = Math.max(0, Math.min(indexGuess, tracks.length - 1));
      }

      // Update item position and move across tracks if needed
      setTracks((prevTracks) => {
        const newTracks = [...prevTracks];

        // If moving to a different track, remove from old and add to new
        if (targetTrackIndex !== draggedItem.trackIndex) {
          const oldItems = newTracks[draggedItem.trackIndex].items;
          const movingItem = oldItems.find((it) => it.id === draggedItem.item.id);
          if (movingItem) {
            newTracks[draggedItem.trackIndex].items = oldItems.filter(
              (it) => it.id !== draggedItem.item.id
            );
            newTracks[targetTrackIndex].items = [
              ...newTracks[targetTrackIndex].items,
              { ...movingItem, from: newFrom },
            ];
          }
        } else {
          // Same track: just update horizontal position
          newTracks[targetTrackIndex].items = newTracks[targetTrackIndex].items.map(
            (trackItem) =>
              trackItem.id === draggedItem.item.id
                ? { ...trackItem, from: newFrom }
                : trackItem
          );
        }

        return newTracks;
      });

      // Keep draggedItem's current track index in sync when crossing tracks
      if (targetTrackIndex !== draggedItem.trackIndex) {
        setDraggedItem((prev) => (prev ? { ...prev, trackIndex: targetTrackIndex } : prev));
      }
    },
    [isDragging, draggedItem, setTracks, durationInFrames, onExtendTimeline, frameWidth]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDraggedItem(null);
  }, []);

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const removeItem = (trackIndex: number, itemId: string) => {
    setTracks((prevTracks) => {
      const newTracks = [...prevTracks];
      newTracks[trackIndex].items = newTracks[trackIndex].items.filter(
        (item) => item.id !== itemId
      );
      return newTracks;
    });
    // Remove from selection if it was selected
    setSelectedItems((prev) => {
      const newSet = new Set(prev);
      newSet.delete(itemId);
      return newSet;
    });
  };

  const handleItemClick = (e: React.MouseEvent, itemId: string) => {
    e.stopPropagation();

    if (e.ctrlKey || e.metaKey) {
      // Multi-select with Ctrl/Cmd
      setSelectedItems((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(itemId)) {
          newSet.delete(itemId);
        } else {
          newSet.add(itemId);
        }
        return newSet;
      });
    } else {
      // Single select
      setSelectedItems(new Set([itemId]));
      
      // Find the selected item and notify parent
      let selectedItem: Item | null = null;
      for (const track of tracks) {
        const item = track.items.find(item => item.id === itemId);
        if (item) {
          selectedItem = item;
          break;
        }
      }
      onItemSelect?.(selectedItem);
    }
  };

  const handleTimelineBackgroundClick = () => {
    // Deselect all when clicking on empty timeline area
    setSelectedItems(new Set());
    onItemSelect?.(null);
  };

  const deleteSelectedItems = () => {
    if (selectedItems.size === 0) return;

    setTracks((prevTracks) => {
      const newTracks = [...prevTracks];
      newTracks.forEach((track) => {
        track.items = track.items.filter((item) => !selectedItems.has(item.id));
      });
      return newTracks;
    });
    setSelectedItems(new Set());
  };

  const handleDrop = (e: React.DragEvent, trackIndex: number) => {
    e.preventDefault();

    try {
      const data = JSON.parse(e.dataTransfer.getData("application/json"));
      if (data.type === "media" && onDropMedia) {
        // Calculate the frame position from the drop coordinates
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const frame = Math.floor(x / frameWidth);
        const clampedFrame = Math.max(0, Math.min(frame, durationInFrames - 1));

        onDropMedia(data.mediaFile, trackIndex, clampedFrame);
      }
    } catch (error) {
      console.error("Error processing dropped media:", error);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  return (
    <div className="timeline-editor" style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <style>
        {`
            @keyframes pulse {
              0% { opacity: 1; }
              50% { opacity: 0.5; }
              100% { opacity: 1; }
            }
          `}
      </style>
      <div className="timeline-controls" style={{ marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <button onClick={() => setCurrentFrame(currentFrame - 1)}>⏮️</button>
          <button onClick={() => setIsPlaying(!isPlaying)}>
            {isPlaying ? "⏸️" : "▶️"}
          </button>
          <button
            onClick={() => setCurrentFrame(currentFrame + 1)}
            disabled={currentFrame >= durationInFrames - 1}
          >
            ⏭️
          </button>
          <span>
            {formatTime(currentFrame)} / {formatTime(durationInFrames)}
          </span>
          <span>Frame: {currentFrame}</span>

          {/* Duration Control */}
          {onDurationChange && (
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <span style={{ fontSize: "12px", color: "#666" }}>Duration:</span>
              <input
                type="number"
                value={durationInFrames}
                onChange={(e) =>
                  onDurationChange(parseInt(e.target.value) || 1)
                }
                min="1"
                max="10000"
                style={{
                  width: "80px",
                  padding: "4px 8px",
                  fontSize: "12px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                }}
              />
              <span style={{ fontSize: "12px", color: "#666" }}>
                frames ({(durationInFrames / fps).toFixed(1)}s)
              </span>
            </div>
          )}

          {isPlaying && (
            <span
              style={{
                color: "red",
                fontWeight: "bold",
                animation: "pulse 1s infinite",
              }}
            >
              ▶️ Playing
            </span>
          )}
          <span style={{ fontSize: "12px", color: "#666" }}>
            🔄 Bidirectional Sync
          </span>

          {/* Selection Controls */}
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            {selectedItems.size > 0 && (
              <>
                <span style={{ fontSize: "12px", color: "#666" }}>
                  Selected: {selectedItems.size} item
                  {selectedItems.size !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={deleteSelectedItems}
                  style={{
                    padding: "4px 8px",
                    fontSize: "10px",
                    backgroundColor: "#dc3545",
                    color: "white",
                    border: "none",
                    borderRadius: "3px",
                    cursor: "pointer",
                  }}
                >
                  🗑️ Delete
                </button>
                <button
                  onClick={() => setSelectedItems(new Set())}
                  style={{
                    padding: "4px 8px",
                    fontSize: "10px",
                    backgroundColor: "#6c757d",
                    color: "white",
                    border: "none",
                    borderRadius: "3px",
                    cursor: "pointer",
                  }}
                >
                  ✕ Clear
                </button>
              </>
            )}
          </div>
        </div>

        {/* Selection Instructions */}
        <div style={{ fontSize: "11px", color: "#666", marginTop: "5px" }}>
          <span style={{ fontSize: 11 }}>
            💡 Click to select • Ctrl/Cmd+Click for multi-select •
            Delete/Backspace to remove • Ctrl/Cmd+A to select all • Esc to
            deselect
          </span>
        </div>
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0, border: '1px solid #262933', backgroundColor: '#0f1115', overflow: 'auto' }}>
        {/* Track Labels Column */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: 100, height: '100%', backgroundColor: '#10141b', borderRight: '1px solid #262933', zIndex: 5 }}>
          {/* Timeline ruler label */}
          <div style={{ height: 20, backgroundColor: '#0f131a', borderBottom: '1px solid #262933', display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 11, color: '#9aa1ad' }}>Tracks</div>

          {/* Track names */}
          {tracks.map((track) => (
            <div key={track.name} style={{ height: TRACK_HEIGHT, borderBottom: '1px solid #262933', display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 11, color: '#cbd5e1' }}>{track.name}</div>
          ))}
        </div>

        {/* Timeline Content */}
        <div ref={timelineRef} className="timeline" style={{ position: 'absolute', left: 100, top: 0, right: 0, height: '100%', minWidth: `${durationInFrames * frameWidth}px`, cursor: 'pointer' }} onClick={handleTimelineClick}>
          {/* Timeline ruler */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 20, backgroundColor: '#0f131a', borderBottom: '1px solid #262933', display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 11 }}>
            {Array.from(
              { length: Math.ceil(durationInFrames / fps) },
              (_, i) => (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: i * fps * frameWidth,
                    width: 1,
                    height: "100%",
                    backgroundColor: "#999",
                  }}
                />
              )
            )}
          </div>

          {/* Playhead */}
          <div style={{ position: 'absolute', left: currentFrame * frameWidth, top: 0, width: 2, height: '100%', backgroundColor: '#ff3b30', zIndex: 10, boxShadow: '0 0 4px rgba(255, 59, 48, 0.6)', transition: isPlaying ? 'none' : 'left 0.1s ease-out' }} />

          {/* Tracks */}
          {tracks.map((track, trackIndex) => (
            <div key={track.name} style={{ position: 'absolute', top: 20 + trackIndex * TRACK_HEIGHT, left: 0, right: 0, height: TRACK_HEIGHT, borderBottom: '1px solid #262933', display: 'flex', alignItems: 'center' }}
              onDrop={(e) => handleDrop(e, trackIndex)}
              onDragOver={handleDragOver}
            >
              {/* Timeline content */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 0,
                  bottom: 0,
                }}
              >
                {track.items.map((item) => {
                  const isSelected = selectedItems.has(item.id);
                  return (
                    <div
                      key={item.id}
                      style={{
                        position: "absolute",
                        left: item.from * frameWidth,
                        top: 6,
                        width: item.durationInFrames * frameWidth,
                        height: TRACK_HEIGHT - 12,
                        backgroundColor:
                          item.type === "solid"
                            ? item.color
                            : item.type === "text"
                            ? "#4CAF50"
                            : item.type === "video"
                            ? "#2196F3"
                            : item.type === "image"
                            ? "#FF9800"
                            : "#9C27B0",
                        border: isSelected
                          ? "2px solid #FFD700"
                          : "1px solid #333",
                        borderRadius: 4,
                        cursor: "grab",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        color: "white",
                        userSelect: "none",
                        boxShadow: isSelected
                          ? "0 0 8px rgba(255, 215, 0, 0.6)"
                          : "none",
                      }}
                      onMouseDown={(e) =>
                        handleItemMouseDown(e, item, trackIndex)
                      }
                      onClick={(e) => handleItemClick(e, item.id)}
                    >
                      {item.type === "text"
                        ? item.text
                        : item.type === "image"
                        ? "🖼️"
                        : item.type === "audio"
                        ? "🎵"
                        : item.type}
                      <button
                        style={{
                          position: "absolute",
                          top: 2,
                          right: 2,
                          width: 16,
                          height: 16,
                          fontSize: "10px",
                          backgroundColor: "rgba(255,255,255,0.8)",
                          border: "none",
                          borderRadius: "50%",
                          cursor: "pointer",
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeItem(trackIndex, item.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
