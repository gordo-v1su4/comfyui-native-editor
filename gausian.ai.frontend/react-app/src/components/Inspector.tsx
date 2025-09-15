import React, { useState } from "react";
import { VideoPromptPanel } from "./VideoPromptPanel";

type TabKey = "video" | "adjust" | "prompts" | "mask";

interface TimelineItemLike {
  id?: string;
  ref_id?: string; // AdvancedVideoEditor uses ref_id on its timeline items
  refId?: string;  // VideoPromptPanel expects refId
  startFrame?: number;
  durationFrames?: number;
  track?: string;
  fps?: number;
}

interface InspectorProps {
  projectId: string;
  selectedTimelineItem: TimelineItemLike | null;
  onTimelineUpdate?: (items: any[]) => void;
  onBatchComplete?: (batchVideos: any[]) => void;
}

/**
 * Right-side inspector with tabs. Hosts the existing VideoPromptPanel under
 * the Prompts tab. Other tabs are placeholders for now.
 */
export const Inspector: React.FC<InspectorProps> = ({
  projectId,
  selectedTimelineItem,
  onTimelineUpdate,
  onBatchComplete,
}) => {
  const [tab, setTab] = useState<TabKey>("prompts");

  // Normalize the selected item shape for VideoPromptPanel
  const normalizedSelection = selectedTimelineItem
    ? {
        id: selectedTimelineItem.id,
        refId:
          (selectedTimelineItem as any).refId ||
          (selectedTimelineItem as any).ref_id ||
          "",
        startFrame: Number((selectedTimelineItem as any).from ?? selectedTimelineItem.startFrame ?? 0),
        durationFrames: Number(
          (selectedTimelineItem as any).durationInFrames ?? selectedTimelineItem.durationFrames ?? 0
        ),
        track:
          (selectedTimelineItem as any).track ||
          (selectedTimelineItem as any).name ||
          "",
        fps: Number((selectedTimelineItem as any).frameRate ?? selectedTimelineItem.fps ?? 24),
      }
    : null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontSize: 12 }}>
      <div style={{ borderBottom: "1px solid #262933", padding: 6 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {([
            ["video", "Video"],
            ["adjust", "Adjust"],
            ["prompts", "Prompts"],
            ["mask", "Mask"],
          ] as [TabKey, string][]) .map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                padding: "4px 8px",
                fontSize: 11,
                borderRadius: 6,
                border: "1px solid #303645",
                background: tab === k ? "#1f2430" : "#0e1015",
                color: "#c9d1e3",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
        {tab === "prompts" && (
          <VideoPromptPanel
            projectId={projectId}
            selectedTimelineItem={normalizedSelection as any}
            onTimelineUpdate={onTimelineUpdate}
            onBatchComplete={onBatchComplete}
          />
        )}

        {tab === "video" && (
          <div style={{ color: "#9aa1ad", fontSize: 12 }}>
            Basic video properties will appear here (exposure, contrast, saturation, etc.).
          </div>
        )}

        {tab === "adjust" && (
          <div style={{ color: "#9aa1ad", fontSize: 12 }}>
            Adjustment controls (position, scale, transform) – placeholder for now.
          </div>
        )}

        {tab === "mask" && (
          <div style={{ color: "#9aa1ad", fontSize: 12 }}>
            Mask tools (point/box/brush) will appear here with a canvas overlay in the Player.
          </div>
        )}
      </div>
    </div>
  );
};

export default Inspector;
