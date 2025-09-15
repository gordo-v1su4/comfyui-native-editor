import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Video,
  Img,
  Audio,
} from "remotion";
import type { Track, Item } from "../types";

interface AdvancedCompositionProps {
  tracks: Track[];
}

const AnimatedText: React.FC<{ text: string; color: string }> = ({
  text,
  color,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");

  return (
    <h1
      style={{
        fontFamily: "Arial, sans-serif",
        fontWeight: "bold",
        fontSize: 60,
        textAlign: "center",
        position: "absolute",
        bottom: 160,
        width: "100%",
      }}
    >
      {words.map((word, i) => {
        const delay = i * 5;
        const scale = spring({
          fps,
          frame: frame - delay,
          config: {
            damping: 200,
          },
        });

        return (
          <span
            key={word}
            style={{
              marginLeft: 10,
              marginRight: 10,
              display: "inline-block",
              color,
              transform: `scale(${scale})`,
            }}
          >
            {word}
          </span>
        );
      })}
    </h1>
  );
};

const AnimatedSolid: React.FC<{ color: string }> = ({ color }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const opacity = interpolate(
    frame,
    [0, 30, durationInFrames - 30, durationInFrames],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const scale = spring({
    frame,
    fps: 30,
    config: {
      damping: 100,
    },
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: color,
        opacity,
        transform: `scale(${scale})`,
      }}
    />
  );
};

const AnimatedVideo: React.FC<{ src: string }> = ({ src }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();

  const opacity = interpolate(
    frame,
    [
      0,
      Math.floor(fps * 0.5),
      durationInFrames - Math.floor(fps * 0.5),
      durationInFrames,
    ],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  return (
    <AbsoluteFill
      style={{
        opacity,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#000",
      }}
    >
      <Video
        src={src}
        // Ensure frame-perfect timing
        volume={1}
        playbackRate={1}
        // Force exact frame timing
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
        onError={(error) => {
          console.warn("Video playback error:", error);
          // Continue rendering even if video fails to load
        }}
      />
    </AbsoluteFill>
  );
};

const AnimatedImage: React.FC<{ src: string }> = ({ src }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const opacity = interpolate(
    frame,
    [0, 15, durationInFrames - 15, durationInFrames],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const scale = spring({
    frame,
    fps: 30,
    config: {
      damping: 100,
    },
  });

  return (
    <AbsoluteFill
      style={{
        opacity,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#000",
      }}
    >
      <Img
        src={src}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          transform: `scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
};

const AnimatedAudio: React.FC<{ src: string }> = ({ src }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const opacity = interpolate(
    frame,
    [0, 15, durationInFrames - 15, durationInFrames],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  return (
    <AbsoluteFill
      style={{
        opacity,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "transparent",
      }}
    >
      <Audio src={src} />
    </AbsoluteFill>
  );
};

const ItemComponent: React.FC<{ item: Item }> = ({ item }) => {
  if (item.type === "solid") {
    return <AnimatedSolid color={item.color} />;
  }

  if (item.type === "text") {
    return <AnimatedText text={item.text} color={item.color} />;
  }

  if (item.type === "video") {
    return <AnimatedVideo src={item.src} />;
  }

  if (item.type === "image") {
    return <AnimatedImage src={item.src} />;
  }

  if (item.type === "audio") {
    return <AnimatedAudio src={item.src} />;
  }

  return null;
};

const TrackComponent: React.FC<{ track: Track }> = ({ track }) => {
  return (
    <AbsoluteFill>
      {track.items.map((item) => (
        <Sequence
          key={item.id}
          from={item.from}
          durationInFrames={item.durationInFrames}
        >
          <ItemComponent item={item} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export const AdvancedComposition: React.FC<AdvancedCompositionProps> = ({
  tracks,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();

  // Global fade effect - frame-rate aware
  const fadeDuration = Math.floor(fps * 1); // 1 second fade
  const globalOpacity = interpolate(
    frame,
    [0, fadeDuration, durationInFrames - fadeDuration, durationInFrames],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "white",
        opacity: globalOpacity,
      }}
    >
      {tracks.map((track) => (
        <TrackComponent track={track} key={track.name} />
      ))}
    </AbsoluteFill>
  );
};
