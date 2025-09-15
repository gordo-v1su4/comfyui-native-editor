import React from "react";
import { MediaImporter } from "./MediaImporter";
import type { Track } from "../types";

interface SidebarProps {
  projectId: string;
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  currentFrame: number;
  onMediaImportComplete?: (isComplete: boolean) => void;
}

/**
 * Left sidebar containing Media Library and a lightweight "Generated" staging area.
 * Staging is a placeholder for now; the auto-placement continues to run via
 * AdvancedVideoEditor's existing logic.
 */
export const Sidebar: React.FC<SidebarProps> = ({
  projectId,
  tracks,
  setTracks,
  currentFrame,
  onMediaImportComplete,
}) => {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontSize: 12 }}>
      <div style={{ padding: "8px 10px", borderBottom: "1px solid #262933" }}>
        <div style={{ fontWeight: 600, fontSize: 12 }}>Media</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <MediaImporter
          tracks={tracks}
          setTracks={setTracks}
          currentFrame={currentFrame}
          projectId={projectId}
          onMediaImportComplete={onMediaImportComplete}
        />
      </div>
      <div style={{ borderTop: "1px solid #262933", padding: 8 }}>
        <div style={{ fontSize: 11, color: "#9aa1ad", marginBottom: 6 }}>Generated</div>
        <div style={{
          fontSize: 11,
          color: "#8b93a3",
          background: "#0e1015",
          padding: 6,
          borderRadius: 6,
          border: "1px dashed #303645",
        }}>
          Recently generated clips will appear here in future iterations.
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
