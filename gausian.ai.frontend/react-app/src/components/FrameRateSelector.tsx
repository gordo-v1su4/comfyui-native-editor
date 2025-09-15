import React, { useState, useEffect } from "react";

export interface FrameRateOption {
  fps: number;
  count: number;
  videos: string[];
}

interface FrameRateSelectorProps {
  frameRates: FrameRateOption[];
  selectedFps: number;
  onFrameRateChange: (fps: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export const FrameRateSelector: React.FC<FrameRateSelectorProps> = ({
  frameRates,
  selectedFps,
  onFrameRateChange,
  onConfirm,
  onCancel,
}) => {
  const [localSelectedFps, setLocalSelectedFps] = useState(selectedFps);

  useEffect(() => {
    setLocalSelectedFps(selectedFps);
  }, [selectedFps]);

  const handleConfirm = () => {
    onFrameRateChange(localSelectedFps);
    onConfirm();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: "white",
          padding: "30px",
          borderRadius: "12px",
          maxWidth: "600px",
          width: "90%",
          maxHeight: "80vh",
          overflow: "auto",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: "20px", color: "#333" }}>
          🎬 Frame Rate Selection
        </h2>

        <p style={{ marginBottom: "20px", color: "#666", lineHeight: "1.5" }}>
          Your videos have different frame rates. Please choose the frame rate
          for your final video:
        </p>

        <div style={{ marginBottom: "25px" }}>
          {frameRates.map((option) => (
            <div
              key={option.fps}
              style={{
                border: `2px solid ${
                  localSelectedFps === option.fps ? "#007bff" : "#ddd"
                }`,
                borderRadius: "8px",
                padding: "15px",
                marginBottom: "10px",
                cursor: "pointer",
                backgroundColor:
                  localSelectedFps === option.fps ? "#f8f9ff" : "#fff",
                transition: "all 0.2s ease",
              }}
              onClick={() => setLocalSelectedFps(option.fps)}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <h3 style={{ margin: "0 0 5px 0", color: "#333" }}>
                    {option.fps} FPS
                  </h3>
                  <p
                    style={{
                      margin: "0 0 8px 0",
                      color: "#666",
                      fontSize: "14px",
                    }}
                  >
                    {option.count} video{option.count !== 1 ? "s" : ""} at this
                    frame rate
                  </p>
                  <div style={{ fontSize: "12px", color: "#888" }}>
                    <strong>Videos:</strong>{" "}
                    {option.videos.slice(0, 3).join(", ")}
                    {option.videos.length > 3 &&
                      ` +${option.videos.length - 3} more`}
                  </div>
                </div>
                <div
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    border: `2px solid ${
                      localSelectedFps === option.fps ? "#007bff" : "#ddd"
                    }`,
                    backgroundColor:
                      localSelectedFps === option.fps
                        ? "#007bff"
                        : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {localSelectedFps === option.fps && (
                    <div
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: "white",
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginBottom: "20px",
            padding: "15px",
            backgroundColor: "#f8f9fa",
            borderRadius: "8px",
          }}
        >
          <h4 style={{ margin: "0 0 10px 0", color: "#333" }}>
            💡 Frame Rate Tips:
          </h4>
          <ul
            style={{
              margin: 0,
              paddingLeft: "20px",
              color: "#666",
              fontSize: "14px",
            }}
          >
            <li>
              <strong>24 FPS:</strong> Cinematic look, film standard
            </li>
            <li>
              <strong>25 FPS:</strong> PAL TV standard (Europe)
            </li>
            <li>
              <strong>30 FPS:</strong> NTSC TV standard (US), web standard
            </li>
            <li>
              <strong>50 FPS:</strong> PAL HD standard
            </li>
            <li>
              <strong>60 FPS:</strong> Smooth motion, gaming standard
            </li>
          </ul>
        </div>

        <div
          style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: "10px 20px",
              border: "1px solid #ddd",
              borderRadius: "6px",
              backgroundColor: "white",
              color: "#666",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            style={{
              padding: "10px 20px",
              border: "none",
              borderRadius: "6px",
              backgroundColor: "#007bff",
              color: "white",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "bold",
            }}
          >
            Use {localSelectedFps} FPS
          </button>
        </div>
      </div>
    </div>
  );
};

// Utility function to analyze frame rates from video items
export const analyzeFrameRates = (tracks: any[]): FrameRateOption[] => {
  const frameRateMap = new Map<number, { count: number; videos: string[] }>();

  tracks.forEach((track) => {
    track.items.forEach((item: any) => {
      if (item.type === "video" && item.frameRate) {
        const fps = item.frameRate;
        if (!frameRateMap.has(fps)) {
          frameRateMap.set(fps, { count: 0, videos: [] });
        }
        const entry = frameRateMap.get(fps)!;
        entry.count++;
        entry.videos.push(item.src || "Unknown video");
      }
    });
  });

  return Array.from(frameRateMap.entries())
    .map(([fps, data]) => ({
      fps,
      count: data.count,
      videos: data.videos,
    }))
    .sort((a, b) => b.count - a.count); // Sort by count (most common first)
};
