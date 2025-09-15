import React from "react";
import { AbsoluteFill } from "remotion";
import type { Track } from "../types";

interface MainProps {
  tracks: Track[];
}

export const Main: React.FC<MainProps> = ({ tracks }) => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "white",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div style={{ fontSize: 40, fontWeight: "bold" }}>Video Composition</div>
      <div style={{ marginTop: 20 }}>
        {tracks.map((track, index) => (
          <div key={index} style={{ marginBottom: 10 }}>
            Track {index + 1}: {track.items.length} items
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
