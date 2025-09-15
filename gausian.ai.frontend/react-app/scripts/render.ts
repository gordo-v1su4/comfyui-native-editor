import { renderMedia } from "@remotion/renderer";
import { selectComposition } from "@remotion/renderer";
import { bundle } from "@remotion/bundler";
import path from "node:path";
import fs from "node:fs";

// Default timeline data if none provided
const defaultTimelineData = {
  tracks: [
    {
      name: "Track 1",
      items: [],
    },
  ],
  durationInFrames: 600,
  fps: 24, // Locked to 24fps for export
  width: 1280,
  height: 720,
};

async function main() {
  // Get command line arguments
  const args = process.argv.slice(2);
  const format = args[0] || "mp4";
  const filename = args[1] || "timeline-export";

  // Try to read timeline data from a JSON file (created by the export function)
  let timelineData = defaultTimelineData;
  const timelineDataPath = path.resolve(process.cwd(), "timeline-data.json");

  if (fs.existsSync(timelineDataPath)) {
    try {
      const data = fs.readFileSync(timelineDataPath, "utf8");
      timelineData = JSON.parse(data);
      console.log("Using timeline data from file");
    } catch (error) {
      console.warn("Failed to read timeline data, using defaults:", error);
    }
  }

  const entry = path.resolve(__dirname, "..", "remotion", "index.tsx");

  const bundled = await bundle(entry);

  const comp = await selectComposition({
    serveUrl: bundled,
    id: "Advanced",
    inputProps: {
      tracks: timelineData.tracks,
      durationInFrames: timelineData.durationInFrames,
      fps: timelineData.fps,
      width: timelineData.width,
      height: timelineData.height,
    },
  });

  // Create output directory if it doesn't exist
  const outDir = path.resolve(process.cwd(), "out");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.resolve(outDir, `${filename}.${format}`);

  // Configure codec based on format
  let codec: string;
  switch (format.toLowerCase()) {
    case "webm":
      codec = "vp8";
      break;
    case "gif":
      codec = "gif";
      break;
    case "mp4":
    default:
      codec = "h264";
      break;
  }

  console.log(`Starting export...`);
  console.log(`Format: ${format.toUpperCase()}`);
  console.log(`Filename: ${filename}.${format}`);
  console.log(
    `Duration: ${(timelineData.durationInFrames / timelineData.fps).toFixed(
      2
    )} seconds`
  );
  console.log(`Resolution: ${timelineData.width}x${timelineData.height}`);
  console.log(`FPS: ${timelineData.fps}`);

  await renderMedia({
    composition: comp,
    serveUrl: bundled,
    codec: codec as any,
    outputLocation: outPath,
  });

  console.log(`✅ Export completed: ${outPath}`);

  // Clean up timeline data file
  if (fs.existsSync(timelineDataPath)) {
    fs.unlinkSync(timelineDataPath);
  }
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
