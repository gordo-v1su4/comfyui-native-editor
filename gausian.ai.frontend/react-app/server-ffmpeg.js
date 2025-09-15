import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// Store active renders
const activeRenders = new Map();

// Add CORS support
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json({ limit: "50mb" }));
app.use(express.static("dist"));

// Direct FFmpeg video render endpoint
app.post("/api/render-video", async (req, res) => {
  try {
    const {
      tracks,
      durationInFrames,
      fps,
      width,
      height,
      format,
      filename,
      quality,
      videoFiles,
    } = req.body;

    // Validate required fields
    if (!tracks || !Array.isArray(tracks)) {
      return res.status(400).json({ error: "Invalid or missing tracks data" });
    }

    if (!durationInFrames || !fps || !width || !height) {
      return res
        .status(400)
        .json({ error: "Missing required video parameters" });
    }

    console.log("Starting direct FFmpeg video render...");
    console.log("Format:", format);
    console.log("Quality:", quality);
    console.log("FPS:", fps);
    console.log("Timeline data:", {
      tracksCount: tracks.length,
      durationInFrames,
      width,
      height,
    });

    // Create output directory
    const outDir = path.resolve(__dirname, "out");
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Lock export frame rate to 24fps for now
    const renderFps = 24;
    console.log(
      `🎬 Export frame rate locked to ${renderFps} FPS (Constant Frame Rate)`
    );

    // Calculate duration in seconds
    const durationSeconds = durationInFrames / renderFps;
    console.log(`⏱️ Duration: ${durationSeconds.toFixed(2)} seconds`);

    // Configure quality settings
    const qualitySettings = {
      low: { crf: "28", preset: "ultrafast" },
      medium: { crf: "20", preset: "fast" },
      high: { crf: "16", preset: "slow" },
    };

    const settings = qualitySettings[quality] || qualitySettings.medium;

    // Process timeline tracks to create video composition
    console.log("Processing timeline tracks...");

    // Create temporary directory for video files
    const tempDir = path.resolve(__dirname, "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Save video files from base64 data
    const videoFilePaths = {};
    if (videoFiles) {
      console.log(
        `Processing ${Object.keys(videoFiles).length} video files...`
      );

      for (const [videoId, base64Data] of Object.entries(videoFiles)) {
        try {
          // Remove data URL prefix (e.g., "data:video/mp4;base64,")
          const base64Content = base64Data.split(",")[1];
          const videoBuffer = Buffer.from(base64Content, "base64");

          // Save to temporary file
          const videoPath = path.resolve(tempDir, `${videoId}.mp4`);
          fs.writeFileSync(videoPath, videoBuffer);
          videoFilePaths[videoId] = videoPath;

          console.log(
            `Saved video ${videoId} to ${videoPath} (${Math.round(
              videoBuffer.length / 1024
            )}KB)`
          );
        } catch (error) {
          console.error(`Failed to save video ${videoId}:`, error);
        }
      }
    }

    // Create a concat file for FFmpeg
    const concatFile = path.resolve(tempDir, "concat.txt");
    let concatContent = "";

    // Process timeline items by segments instead of frame-by-frame
    console.log("Processing timeline segments...");

    // Collect all video segments with their timing
    const videoSegments = [];

    for (const track of tracks) {
      for (const item of track.items) {
        if (item.type === "video" && videoFilePaths[item.id]) {
          videoSegments.push({
            id: item.id,
            filePath: videoFilePaths[item.id],
            startFrame: item.from,
            endFrame: item.from + item.durationInFrames,
            durationInFrames: item.durationInFrames,
            trackIndex: tracks.indexOf(track),
          });
        }
      }
    }

    // Sort segments by start frame
    videoSegments.sort((a, b) => a.startFrame - b.startFrame);

    console.log(`Found ${videoSegments.length} video segments`);

    // Create timeline-based concat using filter_complex
    console.log("Creating timeline-based concat using filter_complex...");

    // Sort segments by start frame for proper timeline order
    videoSegments.sort((a, b) => a.startFrame - b.startFrame);

    // Build FFmpeg filter_complex for precise concatenation
    let filterComplex = "";
    let inputIndex = 0;
    const inputArgs = [];
    const concatInputs = [];

    // Process timeline frame by frame to create precise concat
    let currentFrame = 0;

    while (currentFrame < durationInFrames) {
      // Find the highest priority video at current frame
      let activeSegment = null;
      for (let i = videoSegments.length - 1; i >= 0; i--) {
        const segment = videoSegments[i];
        if (
          currentFrame >= segment.startFrame &&
          currentFrame < segment.endFrame
        ) {
          activeSegment = segment;
          break;
        }
      }

      if (activeSegment) {
        // Calculate how many frames this segment should play
        const segmentEndFrame = Math.min(
          activeSegment.endFrame,
          durationInFrames
        );
        const framesToPlay = segmentEndFrame - currentFrame;
        const durationSeconds = framesToPlay / renderFps;

        // Add input for this video segment
        inputArgs.push("-i", activeSegment.filePath);

        // Add trim filter to get exact duration and scale to target resolution
        filterComplex += `[${inputIndex}:v:0]trim=duration=${durationSeconds},setpts=PTS-STARTPTS,scale=${width}:${height}[v${inputIndex}];`;

        concatInputs.push(`[v${inputIndex}]`);

        inputIndex++;
        currentFrame = segmentEndFrame;
        console.log(
          `Added video segment ${
            activeSegment.id
          } for ${framesToPlay} frames (${durationSeconds.toFixed(2)}s)`
        );
      } else {
        // Add black frame for empty space
        const blackDuration = 1 / renderFps;
        inputArgs.push(
          "-f",
          "lavfi",
          "-i",
          `color=color=black:size=${width}x${height}:rate=${renderFps}:duration=${blackDuration}`
        );

        filterComplex += `[${inputIndex}:v:0]trim=duration=${blackDuration},setpts=PTS-STARTPTS,scale=${width}:${height}[v${inputIndex}];`;

        concatInputs.push(`[v${inputIndex}]`);

        inputIndex++;
        currentFrame++;
      }
    }

    // Add concat filter (video only for now)
    filterComplex += `${concatInputs.join("")}concat=n=${
      concatInputs.length
    }:v=1:a=0[outv]`;

    console.log("Filter complex:", filterComplex);
    console.log("Input args:", inputArgs);
    console.log("Concat inputs:", concatInputs);

    // Validate filter complex
    if (!filterComplex || filterComplex.trim() === "") {
      throw new Error("Filter complex is empty");
    }

    if (concatInputs.length === 0) {
      throw new Error("No concat inputs generated");
    }

    // Configure output format using filter_complex
    let outputFormat, ffmpegArgs;

    // Start with input arguments and filter_complex
    ffmpegArgs = [
      ...inputArgs,
      "-filter_complex",
      filterComplex,
      "-map",
      "[outv]",
    ];

    console.log("Final FFmpeg args:", ffmpegArgs);

    // Validate FFmpeg args
    if (ffmpegArgs.length === 0) {
      throw new Error("FFmpeg args are empty");
    }

    switch (format.toLowerCase()) {
      case "webm":
        outputFormat = "webm";
        ffmpegArgs.push(
          "-c:v",
          "libvpx-vp9",
          "-crf",
          "30",
          "-b:v",
          "0",
          "-deadline",
          "good",
          "-cpu-used",
          "2"
        );
        break;
      case "gif":
        outputFormat = "gif";
        ffmpegArgs.push("-vf", "fps=15,scale=480:-1:flags=lanczos");
        break;
      case "mp4":
      default:
        outputFormat = "mp4";
        ffmpegArgs.push(
          "-c:v",
          "libx264",
          "-crf",
          settings.crf,
          "-preset",
          settings.preset,
          "-movflags",
          "+faststart",
          "-pix_fmt",
          "yuv420p",
          "-r",
          renderFps.toString(),
          "-fps_mode",
          "cfr"
        );
        break;
    }

    const outPath = path.resolve(outDir, `${filename}.${outputFormat}`);

    // Add output file to FFmpeg args with force overwrite
    ffmpegArgs.push("-y", outPath);

    console.log("FFmpeg command:", "ffmpeg", ffmpegArgs.join(" "));
    console.log("FFmpeg command array:", JSON.stringify(ffmpegArgs, null, 2));

    // Execute FFmpeg directly
    const ffmpegProcess = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Handle FFmpeg output
    let stderrOutput = "";

    ffmpegProcess.stdout.on("data", (data) => {
      console.log("FFmpeg stdout:", data.toString());
    });

    ffmpegProcess.stderr.on("data", (data) => {
      const stderrData = data.toString();
      stderrOutput += stderrData;
      console.log("FFmpeg stderr:", stderrData);
    });

    // Wait for FFmpeg to complete
    await new Promise((resolve, reject) => {
      ffmpegProcess.on("close", (code) => {
        if (code === 0) {
          console.log("FFmpeg render completed successfully");
          resolve();
        } else {
          console.error("Full FFmpeg stderr:", stderrOutput);
          reject(new Error(`FFmpeg process exited with code ${code}`));
        }
      });

      ffmpegProcess.on("error", (err) => {
        reject(new Error(`FFmpeg process error: ${err.message}`));
      });
    });

    console.log("Direct FFmpeg video render completed:", outPath);

    // Send the video file with proper headers
    res.setHeader(
      "Content-Type",
      `video/${outputFormat === "mp4" ? "mp4" : outputFormat}`
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}.${outputFormat}"`
    );
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    const fileStream = fs.createReadStream(outPath);
    fileStream.pipe(res);

    fileStream.on("end", () => {
      // Clean up the files after sending
      fs.unlinkSync(outPath);

      // Clean up temporary files
      try {
        // Remove original video files
        for (const videoPath of Object.values(videoFilePaths)) {
          fs.unlinkSync(videoPath);
        }

        // Remove temp directory
        fs.rmdirSync(tempDir);

        console.log("Temporary files cleaned up");
      } catch (err) {
        console.log("Temporary cleanup warning:", err.message);
      }

      console.log("Video file sent and cleaned up");
    });

    fileStream.on("error", (err) => {
      console.error("Error streaming file:", err);
      res.status(500).json({ error: "Failed to stream video file" });
    });
  } catch (error) {
    console.error("Direct FFmpeg render error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Progress tracking endpoints (simplified for FFmpeg)
app.post("/api/init-render", (req, res) => {
  const renderId = uuidv4();
  const {
    tracks,
    durationInFrames,
    fps,
    width,
    height,
    format,
    filename,
    quality,
  } = req.body;

  activeRenders.set(renderId, {
    status: "initializing",
    progress: 0,
    tracks,
    durationInFrames,
    fps,
    width,
    height,
    format,
    filename,
    quality,
    startTime: Date.now(),
  });

  console.log(`Render ${renderId} initialized`);
  res.json({ renderId });
});

app.get("/api/render-progress/:renderId", (req, res) => {
  const { renderId } = req.params;
  const render = activeRenders.get(renderId);

  if (!render) {
    return res.status(404).json({ error: "Render not found" });
  }

  res.json({
    progress: render.progress,
    status: render.status,
    completed: render.status === "completed",
  });
});

// Serve the React app
app.get("*", (req, res) => {
  res.sendFile(path.resolve(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  const serverUrl =
    process.env.VITE_API_BASE_URL ||
    process.env.VITE_CLOUDFLARE_TUNNEL_URL ||
    `http://localhost:${PORT}`;
  console.log(`🚀 FFmpeg-based server running on ${serverUrl}`);
  console.log(
    `🎬 Direct FFmpeg render API available at ${serverUrl}/api/render-video`
  );
  console.log(
    `📊 Progress tracking API available at ${serverUrl}/api/render-progress/:id`
  );
});
