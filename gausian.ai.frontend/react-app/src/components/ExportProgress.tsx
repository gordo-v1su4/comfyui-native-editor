import React from "react";

interface ExportProgressProps {
  isVisible: boolean;
  progress: number;
  status: string;
  onCancel?: () => void;
}

export const ExportProgress: React.FC<ExportProgressProps> = ({
  isVisible,
  progress,
  status,
  onCancel,
}) => {
  if (!isVisible) return null;

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
          borderRadius: "12px",
          padding: "30px",
          maxWidth: "400px",
          width: "90%",
          textAlign: "center",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
        }}
      >
        <div style={{ fontSize: "24px", marginBottom: "20px" }}>🎬</div>
        <h3 style={{ margin: "0 0 20px 0", color: "#333" }}>Rendering Video</h3>

        {/* Progress Bar */}
        <div
          style={{
            width: "100%",
            height: "8px",
            backgroundColor: "#e0e0e0",
            borderRadius: "4px",
            overflow: "hidden",
            marginBottom: "15px",
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              backgroundColor: "#007bff",
              borderRadius: "4px",
              transition: "width 0.3s ease",
            }}
          />
        </div>

        {/* Progress Text */}
        <div style={{ fontSize: "14px", color: "#666", marginBottom: "20px" }}>
          {progress.toFixed(1)}% Complete
        </div>

        {/* Status */}
        <div style={{ fontSize: "12px", color: "#888", marginBottom: "20px" }}>
          {status}
        </div>

        {/* Cancel Button */}
        {onCancel && (
          <button
            onClick={onCancel}
            style={{
              padding: "8px 16px",
              backgroundColor: "#dc3545",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            Cancel Export
          </button>
        )}

        {/* Info */}
        <div style={{ fontSize: "10px", color: "#999", marginTop: "15px" }}>
          Please don't close this tab while rendering...
        </div>
      </div>
    </div>
  );
};
