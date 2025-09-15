import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { execFile } from "node:child_process";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";

// Load environment variables from .env file
dotenv.config();

import {
  authenticateUser,
  generateToken,
  hashPassword,
  comparePassword,
  generateUserId,
  createUser,
  getUserByUsername,
  getUserById,
  createProject,
  getProjectsByUserId,
  getProjectById,
  deleteProject,
  createVideoReference,
  getVideoReferencesByUserId,
  getVideoReferencesByProjectId,
  getVideoReferenceById,
  deleteVideoReference,
  addTimelineItem,
  getTimelineByProjectId,
  deleteTimelineItem,
  // Screenplay
  getScriptByProjectId,
  saveScriptForProject,
  // AI Chat
  getChatHistory,
  appendChatMessage,
  clearChatHistory,
  // Legacy functions for backward compatibility
  addMedia,
  getMediaByUserId,
  getMediaByProjectId,
  deleteMedia,
} from "./simple-auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://localhost:4173",
      FRONTEND_URL,
      API_DOMAIN,
      // Allow all Vercel preview deployments
      /^https:\/\/.*\.vercel\.app$/,
      // Allow all Cloudflare tunnel domains
      /^https:\/\/.*\.trycloudflare\.com$/,
      // Allow all ngrok domains
      /^https:\/\/.*\.ngrok\.io$/,
      /^https:\/\/.*\.ngrok-free\.app$/,
    ].filter(Boolean), // Remove any null/undefined values
    methods: ["GET", "POST"],
    credentials: true,
  },
});
const PORT = process.env.PORT || 3001;

// Environment-based CORS configuration
const API_BASE_URL =
  process.env.VITE_API_BASE_URL ||
  process.env.VITE_CLOUDFLARE_TUNNEL_URL ||
  "http://localhost:3001";
const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.VITE_CLOUDFLARE_TUNNEL_URL ||
  "http://localhost:5173";

// Extract domain from API_BASE_URL for CORS
const getDomainFromUrl = (url) => {
  try {
    const urlObj = new URL(url);
    return urlObj.origin;
  } catch (error) {
    console.warn(`Invalid URL format: ${url}`);
    return null;
  }
};

const API_DOMAIN = getDomainFromUrl(API_BASE_URL);

// Log CORS configuration for debugging
console.log("🔧 CORS Configuration:");
console.log(`   API_BASE_URL: ${API_BASE_URL}`);
console.log(`   FRONTEND_URL: ${FRONTEND_URL}`);
console.log(`   API_DOMAIN: ${API_DOMAIN}`);

// Simple auth system (in-memory storage)

// Store active renders
const activeRenders = new Map();

// Configure multer for file uploads with user-specific directories
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Get user ID from request (will be set by middleware)
    const userId = req.user?.userId || "anonymous";
    const uploadDir = path.resolve(__dirname, "public", "uploads", userId);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    console.log(
      `File upload attempt: ${file.originalname}, mimetype: ${file.mimetype}`
    );

    // Allow all files with video extensions regardless of mimetype
    const videoExtensions = [".mp4", ".webm", ".avi", ".mov", ".mkv"];
    const fileExtension = file.originalname
      .toLowerCase()
      .substring(file.originalname.lastIndexOf("."));

    if (videoExtensions.includes(fileExtension)) {
      console.log(
        `✅ Allowing file: ${file.originalname} (extension: ${fileExtension})`
      );
      cb(null, true);
    } else {
      console.log(
        `❌ Rejecting file: ${file.originalname} (mimetype: ${file.mimetype}, extension: ${fileExtension})`
      );
      cb(new Error("Invalid file type. Only video files are allowed."), false);
    }
  },
});

// Add CORS support
app.use((req, res, next) => {
  // Allow specific origins for production and development
  const allowedOrigins = [
    // Development origins
    "http://localhost:5173", // Vite dev server
    "http://localhost:3000", // Alternative dev port
    "http://localhost:4173", // Vite preview server
    // Environment-based origins
    FRONTEND_URL,
    API_DOMAIN,
    // Allow all Vercel preview deployments
    "https://*.vercel.app",
    // Allow specific Vercel domain
    "https://gausian-ai.vercel.app",
    // Allow all Cloudflare tunnel domains
    "https://*.trycloudflare.com",
    // Allow all ngrok domains
    "https://*.ngrok.io",
    "https://*.ngrok-free.app",
  ].filter(Boolean); // Remove any null/undefined values

  const origin = req.headers.origin;

  // Check if origin is in allowed list or matches patterns
  const isAllowed = allowedOrigins.some((allowedOrigin) => {
    if (allowedOrigin.includes("*")) {
      // Handle wildcard patterns
      const pattern = allowedOrigin.replace("*", ".*");
      return new RegExp(pattern).test(origin);
    }
    return allowedOrigin === origin;
  });

  if (isAllowed) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json({ limit: "50mb" }));
app.use(express.static("dist"));
app.use(
  "/uploads",
  express.static(path.resolve(__dirname, "public", "uploads"))
);

// Enhanced video export API endpoint with FFmpeg support
app.post("/api/export-video", async (req, res) => {
  try {
    const { tracks, durationInFrames, fps, width, height, format, filename } =
      req.body;

    console.log("Starting enhanced video export...");
    console.log("Format:", format);
    console.log("Filename:", filename);
    console.log("Duration:", durationInFrames / fps, "seconds");
    console.log("FPS:", fps);

    // Create output directory
    const outDir = path.resolve(__dirname, "out");
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Bundle the Remotion composition
    const entry = path.resolve(__dirname, "remotion", "index.tsx");
    const bundled = await bundle(entry);

    // Select the composition
    const comp = await selectComposition({
      serveUrl: bundled,
      id: "Advanced",
      inputProps: {
        tracks: tracks,
        durationInFrames: durationInFrames,
        fps: renderFps,
        width: width,
        height: height,
      },
    });

    // Configure codec based on format with enhanced settings
    let codec, outputFormat;
    switch (format.toLowerCase()) {
      case "webm":
        codec = "vp9";
        outputFormat = "webm";
        break;
      case "gif":
        codec = "gif";
        outputFormat = "gif";
        break;
      case "mp4":
      default:
        codec = "h264";
        outputFormat = "mp4";
        break;
    }

    const outPath = path.resolve(outDir, `${filename}.${outputFormat}`);

    // Render the video with enhanced settings
    await renderMedia({
      composition: comp,
      serveUrl: bundled,
      codec: codec,
      outputLocation: outPath,
      // Enhanced encoding settings for better quality and frame rate
    });

    console.log("Enhanced video export completed:", outPath);

    // For now, return a queued response to match the expected format
    // The actual video processing will happen asynchronously
    const exportId = uuidv4();

    // Store export job for progress tracking
    activeRenders.set(exportId, {
      status: "queued",
      progress: 0,
      tracks,
      durationInFrames,
      fps,
      width,
      height,
      format: outputFormat,
      filename,
      startTime: Date.now(),
    });

    // Return 202 status with export ID
    res.status(202).json({
      ok: true,
      exportId,
      status: "queued",
      message: "Export job queued successfully",
    });

    // Process the export asynchronously
    processExportAsync(exportId, outPath, outputFormat, filename);
  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to process export asynchronously
async function processExportAsync(exportId, outPath, outputFormat, filename) {
  try {
    console.log(`Starting async export processing for ${exportId}`);

    // Update status to processing
    const render = activeRenders.get(exportId);
    if (render) {
      render.status = "processing";
      render.progress = 10;
      activeRenders.set(exportId, render);
    }

    // Simulate processing time (replace with actual video processing)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Update progress
    if (render) {
      render.progress = 50;
      render.status = "processing";
      activeRenders.set(exportId, render);
    }

    // Simulate more processing
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Mark as completed
    if (render) {
      render.status = "completed";
      render.progress = 100;
      render.downloadUrl = `/api/download-export/${exportId}`;
      activeRenders.set(exportId, render);
    }

    console.log(`Export ${exportId} completed successfully`);
  } catch (error) {
    console.error(`Export ${exportId} failed:`, error);

    // Mark as failed
    const render = activeRenders.get(exportId);
    if (render) {
      render.status = "failed";
      render.error = error.message;
      activeRenders.set(exportId, render);
    }
  }
}

// New API endpoint for Node.js-based rendering
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

    console.log("Starting Node.js-based video render...");
    console.log("Format:", format);
    console.log("Quality:", quality);
    console.log("FPS:", fps);
    console.log("Received FPS from client:", fps);
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

    // Ensure frame-perfect rendering with proper timing
    const frameDuration = 1 / renderFps;
    console.log(
      `⏱️ Frame duration: ${frameDuration.toFixed(4)} seconds per frame`
    );

    // Bundle the Remotion composition
    const entry = path.resolve(__dirname, "remotion", "index.tsx");
    const bundled = await bundle(entry);

    // Select the composition
    const comp = await selectComposition({
      serveUrl: bundled,
      id: "Advanced",
      inputProps: {
        tracks: tracks,
        durationInFrames: durationInFrames,
        fps: renderFps,
        width: width,
        height: height,
      },
    });

    // Configure quality settings
    const qualitySettings = {
      low: { crf: "28", preset: "ultrafast" },
      medium: { crf: "20", preset: "fast" },
      high: { crf: "16", preset: "slow" },
    };

    const settings = qualitySettings[quality] || qualitySettings.medium;

    // Configure codec and format
    let codec, outputFormat, ffmpegSettings;
    switch (format.toLowerCase()) {
      case "webm":
        codec = "vp9";
        outputFormat = "webm";
        ffmpegSettings = {
          "-c:v": "libvpx-vp9",
          "-crf": "30",
          "-b:v": "0",
          "-deadline": "good",
          "-cpu-used": "2",
        };
        break;
      case "gif":
        codec = "gif";
        outputFormat = "gif";
        ffmpegSettings = {
          "-vf": "fps=15,scale=480:-1:flags=lanczos",
        };
        break;
      case "mp4":
      default:
        codec = "h264";
        outputFormat = "mp4";
        ffmpegSettings = {
          "-c:v": "libx264",
          "-crf": settings.crf,
          "-preset": settings.preset,
          "-movflags": "+faststart",
          "-pix_fmt": "yuv420p",

          // Ensure constant frame rate (CFR)
          "-r": renderFps.toString(),
          "-fps_mode": "cfr",
          // Prevent frame dropping and ensure smooth playback

          // Force keyframe interval for consistent timing
        };
        break;
    }

    const outPath = path.resolve(outDir, `${filename}.${outputFormat}`);

    // Render with enhanced FFmpeg settings
    await renderMedia({
      composition: comp,
      serveUrl: bundled,
      codec: codec,
      outputLocation: outPath,
    });

    console.log("Node.js video render completed:", outPath);

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
      // Clean up the file after sending
      fs.unlinkSync(outPath);
      console.log("Video file sent and cleaned up");
    });

    fileStream.on("error", (err) => {
      console.error("Error streaming file:", err);
      res.status(500).json({ error: "Failed to stream video file" });
    });
  } catch (error) {
    console.error("Node.js render error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Download endpoint for completed exports
app.get("/api/download-export/:exportId", (req, res) => {
  const { exportId } = req.params;
  const render = activeRenders.get(exportId);

  if (!render) {
    return res.status(404).json({ error: "Export not found" });
  }

  if (render.status !== "completed") {
    return res.status(400).json({ error: "Export not completed yet" });
  }

  // For now, return a success message
  // In a real implementation, you would serve the actual video file
  res.json({
    ok: true,
    exportId,
    status: "completed",
    message: "Export ready for download",
  });
});

// Progress tracking endpoints
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

// ===== PROJECT MANAGEMENT API =====

// Create a new project
app.post("/api/projects", authenticateUser, async (req, res) => {
  try {
    const {
      name,
      description,
      width = 1920,
      height = 1080,
      fps = 30,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Project name is required" });
    }

    const projectId = uuidv4();
    const userId = req.user.userId;

    // Create project in database
    createProject(projectId, userId, name, description, width, height, fps);

    const project = {
      id: projectId,
      name,
      description: description || "",
      width,
      height,
      fps,
      tracks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    res.status(201).json(project);
  } catch (error) {
    console.error("Error creating project:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get all projects
app.get("/api/projects", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.userId;
    const projectsList = getProjectsByUserId(userId);
    res.json({ projects: projectsList });
  } catch (error) {
    console.error("Error getting projects:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get a specific project
app.get("/api/projects/:projectId", authenticateUser, async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.userId;
    const project = getProjectById(projectId, userId);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json(project);
  } catch (error) {
    console.error("Error getting project:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a project
app.delete("/api/projects/:projectId", authenticateUser, async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.userId;

    const deleted = deleteProject(projectId, userId);

    if (!deleted) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json({ message: "Project deleted successfully" });
  } catch (error) {
    console.error("Error deleting project:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== VIDEO UPLOAD API =====

// Upload video file
app.post(
  "/api/upload-video",
  authenticateUser,
  upload.single("video"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No video file provided" });
      }

      const { projectId } = req.body;
      if (!projectId) {
        return res.status(400).json({ error: "projectId is required" });
      }

      const videoId = uuidv4();
      const userId = req.user.userId;
      const videoInfo = {
        id: videoId,
        filename: req.file.filename,
        originalName: req.file.originalname,
        path: `/uploads/${userId}/${req.file.filename}`,
        fullPath: req.file.path,
        size: req.file.size,
        mimetype: req.file.mimetype,
        uploadedAt: new Date().toISOString(),
      };

      // Get video duration using FFmpeg
      const getVideoDuration = (filePath) => {
        return new Promise((resolve, reject) => {
          const ffprobe = spawn("ffprobe", [
            "-v",
            "quiet",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            filePath,
          ]);

          let duration = "";
          ffprobe.stdout.on("data", (data) => {
            duration += data.toString();
          });

          ffprobe.on("close", (code) => {
            if (code === 0) {
              resolve(parseFloat(duration.trim()));
            } else {
              resolve(0); // Default duration if ffprobe fails
            }
          });

          ffprobe.on("error", () => {
            resolve(0); // Default duration if ffprobe not available
          });
        });
      };

      getVideoDuration(req.file.path).then(async (duration) => {
        videoInfo.duration = duration;

        // Create video reference for this project
        const videoRef = createVideoReference(
          videoId,
          userId,
          projectId, // Use the project ID from the request
          req.file.originalname,
          `/uploads/${userId}/${req.file.filename}`,
          req.file.path,
          "local_file",
          duration,
          null, // width
          null, // height
          null, // fps
          null, // codec
          null, // thumbnail
          { size: req.file.size, uploadedAt: new Date().toISOString() }
        );

        res.json(videoInfo);
      });
    } catch (error) {
      console.error("Error uploading video:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Pause an active video generation job and stop the Modal app immediately
app.post(
  "/api/projects/:projectId/video-generation-pause/:jobId",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId, jobId } = req.params;
      const userId = req.user.userId;

      const project = getProjectById(projectId, userId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const jobInfo = videoJobs.get(jobId);
      if (!jobInfo) return res.status(404).json({ error: "Job not found" });
      if (jobInfo.userId !== userId)
        return res.status(403).json({ error: "Access denied" });

      // Mark as paused
      jobInfo.status = "paused";
      videoJobs.set(jobId, jobInfo);

      // Stop the Modal app backing this job
      await stopModalApp(jobInfo.modalEndpoint);

      // Stop the job monitor
      stopJobMonitor(jobId);

      // Notify clients
      emitVideoProgress(projectId, jobId, {
        jobId,
        projectId,
        status: "paused",
        totalShots: jobInfo.totalShots,
        completedShots: jobInfo.completedShots,
        failedShots: jobInfo.failedShots,
        queuedShots:
          jobInfo.totalShots - jobInfo.completedShots - jobInfo.failedShots,
        shots: jobInfo.shots,
        startTime: jobInfo.startTime,
        endTime: Date.now(),
        progress: Math.round(
          (jobInfo.completedShots / jobInfo.totalShots) * 100
        ),
      });

      res.json({ success: true, status: "paused" });
    } catch (error) {
      console.error("Error pausing generation:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Upload video with base64 data
app.post("/api/upload-video-base64", (req, res) => {
  try {
    const { fileName, fileData, fileType } = req.body;

    if (!fileName || !fileData) {
      return res
        .status(400)
        .json({ error: "fileName and fileData are required" });
    }

    const videoId = uuidv4();
    const uploadDir = path.resolve(__dirname, "public", "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Decode base64 data
    const base64Data = fileData.replace(/^data:video\/[a-z]+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    const filename = `${Date.now()}-${fileName}`;
    const filePath = path.resolve(uploadDir, filename);
    fs.writeFileSync(filePath, buffer);

    const videoInfo = {
      id: videoId,
      filename: filename,
      originalName: fileName,
      path: `/uploads/${filename}`,
      fullPath: filePath,
      size: buffer.length,
      mimetype: fileType || "video/mp4",
      uploadedAt: new Date().toISOString(),
    };

    res.json(videoInfo);
  } catch (error) {
    console.error("Error uploading video:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== TIMELINE MANAGEMENT API =====

// Add video reference to timeline
app.post(
  "/api/projects/:projectId/timeline",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const {
        videoReferenceId,
        trackIndex = 0,
        startTime = 0,
        duration,
        startFrame = 0,
        durationInFrames,
      } = req.body;
      const userId = req.user.userId;

      // Verify project belongs to user
      const project = getProjectById(projectId, userId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (!videoReferenceId) {
        return res.status(400).json({ error: "videoReferenceId is required" });
      }

      // Verify video reference belongs to user
      const videoRef = getVideoReferenceById(videoReferenceId, userId);
      if (!videoRef) {
        return res.status(404).json({ error: "Video reference not found" });
      }

      // Create timeline item in database
      const itemId = uuidv4();
      addTimelineItem(
        itemId,
        projectId,
        videoReferenceId,
        trackIndex,
        startTime,
        duration || videoRef.duration,
        startFrame,
        durationInFrames ||
          Math.round((duration || videoRef.duration) * project.fps)
      );

      const timelineItem = {
        id: itemId,
        videoReferenceId: videoReferenceId,
        type: "video",
        src: videoRef.source_url || videoRef.source_path,
        sourceType: videoRef.source_type,
        name: videoRef.name,
        from: startFrame,
        durationInFrames:
          durationInFrames ||
          Math.round((duration || videoRef.duration) * project.fps),
        startTime: startTime,
        duration: duration || videoRef.duration,
      };

      res.json({
        success: true,
        timelineItem,
        trackIndex,
        message: "Video reference added to timeline successfully",
      });
    } catch (error) {
      console.error("Error adding video reference to timeline:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ===== SCREENPLAY (SCRIPT) API =====

// Get screenplay for a project
app.get(
  "/api/projects/:projectId/script",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user.userId;

      const project = getProjectById(projectId, userId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const script = getScriptByProjectId(projectId, userId);
      res.json({ script });
    } catch (error) {
      console.error("Error getting script:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ===== AI (Gemini) Chat API (SSE) =====
app.post(
  "/api/projects/:projectId/script/ai/chat",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user.userId;
      const { message, model } = req.body || {};

      const project = getProjectById(projectId, userId);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "message is required" });
      }

      // Append user message
      appendChatMessage(projectId, userId, "user", message);

      // SSE setup
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const API_KEY = process.env.GEMINI_API_KEY;
      const MODEL =
        model || process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
      if (!API_KEY) {
        res.write(`event: error\n`);
        res.write(
          `data: ${JSON.stringify({ error: "GEMINI_API_KEY not set" })}\n\n`
        );
        return res.end();
      }

      const history = getChatHistory(projectId, userId).slice(-20);
      const systemPrompt = [
        "You are an AI screenwriting assistant for 1-minute films.",
        "You can help in two ways:",
        "1) GUIDED PROCESS: If the user wants to build a film step-by-step, ask these questions one at a time:",
        "   - Characters: Who are the main characters?",
        "   - Visual Mood: overall visual feeling (e.g., noir, mysterious, dramatic)",
        "   - Genre: drama, comedy, thriller, romance, sci-fi, action, horror, documentary",
        "   - Setting: where does the story take place",
        "   - Time of Day: dawn, morning, afternoon, sunset, night, midnight",
        "   - Color Palette: dominant colors",
        "   - Additional Details: any important story/visual notes",
        "2) DIRECT SCREENPLAY: If the user asks for a complete screenplay, write it immediately in proper screenplay format with:",
        "   - FADE IN at the beginning",
        "   - Scene headers (INT./EXT. LOCATION - TIME)",
        "   - Character names in CAPS with dialogue",
        "   - Action descriptions",
        "   - FADE OUT at the end",
        "Always respond appropriately to the user's request - either guide them through questions OR write a complete screenplay directly.",
      ].join("\n");

      const payload = {
        contents: [
          { role: "user", parts: [{ text: systemPrompt }] },
          ...history.map((h) => ({
            role: h.role === "assistant" ? "model" : "user",
            parts: [{ text: h.content }],
          })),
          { role: "user", parts: [{ text: message }] },
        ],
        generationConfig: { temperature: 0.7, topK: 40, topP: 0.9 },
      };

      const fetchFn = global.fetch || (await import("node-fetch")).default;
      const resp = await fetchFn(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          MODEL
        )}:generateContent?key=${API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!resp.ok) {
        const text = await resp.text();
        res.write(`event: error\n`);
        res.write(
          `data: ${JSON.stringify({ status: resp.status, body: text })}\n\n`
        );
        return res.end();
      }

      const json = await resp.json();
      const candidate = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const chunks = candidate.match(/.{1,256}/g) || [];
      for (const chunk of chunks) {
        res.write(`event: token\n`);
        res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
      }

      appendChatMessage(projectId, userId, "assistant", candidate);
      res.write(`event: done\n`);
      res.write(`data: {}\n\n`);
      res.end();
    } catch (error) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: String(error) })}\n\n`);
      res.end();
    }
  }
);

app.get(
  "/api/projects/:projectId/script/ai/history",
  authenticateUser,
  (req, res) => {
    const { projectId } = req.params;
    const userId = req.user.userId;
    const project = getProjectById(projectId, userId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const history = getChatHistory(projectId, userId);
    res.json({ history });
  }
);

app.delete(
  "/api/projects/:projectId/script/ai/history",
  authenticateUser,
  (req, res) => {
    const { projectId } = req.params;
    const userId = req.user.userId;
    const project = getProjectById(projectId, userId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    clearChatHistory(projectId, userId);
    res.json({ ok: true });
  }
);

// Save/update screenplay for a project
app.post(
  "/api/projects/:projectId/script",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user.userId;
      const scriptBody = req.body || {};

      const project = getProjectById(projectId, userId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const saved = saveScriptForProject(projectId, userId, scriptBody);
      res.status(201).json({ script: saved });
    } catch (error) {
      console.error("Error saving script:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Get timeline for a project
app.get(
  "/api/projects/:projectId/timeline",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user.userId;

      const timeline = getTimelineByProjectId(projectId, userId);
      if (!timeline) {
        return res.status(404).json({ error: "Project not found" });
      }

      res.json({
        projectId,
        tracks: timeline.tracks,
        duration: timeline.duration,
      });
    } catch (error) {
      console.error("Error getting timeline:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Update timeline item
app.put("/api/projects/:projectId/timeline/:itemId", (req, res) => {
  try {
    const { projectId, itemId } = req.params;
    const updates = req.body;

    const project = projects.get(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    let itemFound = false;
    for (const track of project.tracks) {
      const itemIndex = track.items.findIndex((item) => item.id === itemId);
      if (itemIndex !== -1) {
        track.items[itemIndex] = { ...track.items[itemIndex], ...updates };
        itemFound = true;
        break;
      }
    }

    if (!itemFound) {
      return res.status(404).json({ error: "Timeline item not found" });
    }

    project.updatedAt = new Date().toISOString();

    // Save to file system
    const projectFile = path.resolve(
      __dirname,
      "data",
      "projects",
      `${projectId}.json`
    );
    fs.writeFileSync(projectFile, JSON.stringify(project, null, 2));

    res.json({ success: true, message: "Timeline item updated successfully" });
  } catch (error) {
    console.error("Error updating timeline item:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete timeline item
app.delete("/api/projects/:projectId/timeline/:itemId", (req, res) => {
  try {
    const { projectId, itemId } = req.params;

    const project = projects.get(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    let itemFound = false;
    for (const track of project.tracks) {
      const itemIndex = track.items.findIndex((item) => item.id === itemId);
      if (itemIndex !== -1) {
        track.items.splice(itemIndex, 1);
        itemFound = true;
        break;
      }
    }

    if (!itemFound) {
      return res.status(404).json({ error: "Timeline item not found" });
    }

    project.updatedAt = new Date().toISOString();

    // Save to file system
    const projectFile = path.resolve(
      __dirname,
      "data",
      "projects",
      `${projectId}.json`
    );
    fs.writeFileSync(projectFile, JSON.stringify(project, null, 2));

    res.json({ success: true, message: "Timeline item deleted successfully" });
  } catch (error) {
    console.error("Error deleting timeline item:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== BULK OPERATIONS API =====

// Upload multiple videos and add to timeline
app.post(
  "/api/projects/:projectId/bulk-upload",
  upload.array("videos", 10),
  (req, res) => {
    try {
      const { projectId } = req.params;
      const { trackIndex = 0, startFrame = 0, spacing = 0 } = req.body;
      const userId = req.user?.userId; // Get userId if authenticated

      const project = projects.get(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No video files provided" });
      }

      const uploadedVideos = [];
      let currentFrame = parseInt(startFrame);

      for (const file of req.files) {
        const videoId = uuidv4();

        // Create video reference for this project
        if (userId) {
          createVideoReference(
            videoId,
            userId,
            projectId,
            file.originalname,
            `/uploads/${file.filename}`,
            file.path,
            "local_file",
            5.0, // Default duration
            null, // width
            null, // height
            null, // fps
            null, // codec
            null, // thumbnail
            { size: file.size, uploadedAt: new Date().toISOString() }
          );
        }

        const videoItem = {
          id: videoId,
          type: "video",
          src: `/uploads/${file.filename}`,
          from: currentFrame,
          durationInFrames: 150, // Default 5 seconds at 30fps
          originalName: file.originalname,
        };

        // Ensure track exists
        while (project.tracks.length <= trackIndex) {
          project.tracks.push({
            name: `Track ${project.tracks.length + 1}`,
            items: [],
          });
        }

        // Add video to track
        project.tracks[trackIndex].items.push(videoItem);
        uploadedVideos.push(videoItem);

        // Calculate next position
        currentFrame += videoItem.durationInFrames + parseInt(spacing || 0);
      }

      project.updatedAt = new Date().toISOString();

      // Save to file system
      const projectFile = path.resolve(
        __dirname,
        "data",
        "projects",
        `${projectId}.json`
      );
      fs.writeFileSync(projectFile, JSON.stringify(project, null, 2));

      res.json({
        success: true,
        uploadedVideos,
        totalVideos: uploadedVideos.length,
        message: `${uploadedVideos.length} videos added to timeline successfully`,
      });
    } catch (error) {
      console.error("Error bulk uploading videos:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ===== EXPORT API =====

// Export project as video
app.post("/api/projects/:projectId/export", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { format = "mp4", quality = "medium", filename } = req.body;

    const project = projects.get(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Convert project tracks to the format expected by the renderer
    const tracks = project.tracks.map((track) => ({
      name: track.name,
      items: track.items,
    }));

    const durationInFrames = tracks.reduce((max, track) => {
      const trackDuration = track.items.reduce(
        (sum, item) => Math.max(sum, item.from + item.durationInFrames),
        0
      );
      return Math.max(max, trackDuration);
    }, 0);

    // Create render request
    const renderId = uuidv4();
    const render = {
      id: renderId,
      projectId,
      tracks,
      durationInFrames,
      fps: project.fps,
      width: project.width,
      height: project.height,
      format,
      quality,
      filename: filename || `${project.name}_export`,
      status: "processing",
      progress: 0,
      createdAt: Date.now(),
    };

    activeRenders.set(renderId, render);

    // Start rendering (this would integrate with your existing render logic)
    // For now, we'll just return the render ID
    res.json({
      success: true,
      renderId,
      message: "Export started successfully",
    });
  } catch (error) {
    console.error("Error exporting project:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== VIDEO REFERENCES API =====

// Create a new video reference for a specific project
app.post(
  "/api/projects/:projectId/video-references",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const {
        name,
        sourceUrl,
        sourcePath,
        sourceType = "url",
        duration,
        width,
        height,
        fps,
        codec,
        thumbnail,
        metadata,
      } = req.body;
      const userId = req.user.userId;

      // Verify project belongs to user
      const project = getProjectById(projectId, userId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (!name) {
        return res.status(400).json({ error: "Video name is required" });
      }

      if (!sourceUrl && !sourcePath) {
        return res
          .status(400)
          .json({ error: "Either sourceUrl or sourcePath is required" });
      }

      const videoId = uuidv4();
      const videoRef = createVideoReference(
        videoId,
        userId,
        projectId,
        name,
        sourceUrl,
        sourcePath,
        sourceType,
        duration,
        width,
        height,
        fps,
        codec,
        thumbnail,
        metadata
      );

      res.status(201).json(videoRef);
    } catch (error) {
      console.error("Error creating video reference:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Get all video references for a specific project
app.get(
  "/api/projects/:projectId/video-references",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user.userId;

      // Verify project belongs to user
      const project = getProjectById(projectId, userId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const videoRefs = getVideoReferencesByProjectId(projectId, userId);

      res.json({ videoReferences: videoRefs });
    } catch (error) {
      console.error("Error getting video references:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Get a specific video reference for a project
app.get(
  "/api/projects/:projectId/video-references/:videoId",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId, videoId } = req.params;
      const userId = req.user.userId;

      // Verify project belongs to user
      const project = getProjectById(projectId, userId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const videoRef = getVideoReferenceById(videoId, userId);

      if (!videoRef) {
        return res.status(404).json({ error: "Video reference not found" });
      }

      // Verify video reference belongs to this project
      if (videoRef.project_id !== projectId) {
        return res
          .status(404)
          .json({ error: "Video reference not found in this project" });
      }

      res.json(videoRef);
    } catch (error) {
      console.error("Error getting video reference:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Delete a video reference from a project
app.delete(
  "/api/projects/:projectId/video-references/:videoId",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId, videoId } = req.params;
      const userId = req.user.userId;

      // Verify project belongs to user
      const project = getProjectById(projectId, userId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Verify video reference belongs to this project
      const videoRef = getVideoReferenceById(videoId, userId);
      if (!videoRef || videoRef.project_id !== projectId) {
        return res
          .status(404)
          .json({ error: "Video reference not found in this project" });
      }

      const deleted = deleteVideoReference(videoId, userId);
      if (!deleted) {
        return res.status(404).json({ error: "Video reference not found" });
      }

      res.json({ message: "Video reference deleted successfully" });
    } catch (error) {
      console.error("Error deleting video reference:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Extract metadata from video URL (helper endpoint)
app.post("/api/extract-video-metadata", authenticateUser, async (req, res) => {
  try {
    const { sourceUrl, sourcePath } = req.body;

    if (!sourceUrl && !sourcePath) {
      return res
        .status(400)
        .json({ error: "Either sourceUrl or sourcePath is required" });
    }

    const videoSource = sourceUrl || sourcePath;

    // Try to extract metadata using FFmpeg
    const getVideoMetadata = (videoSource) => {
      return new Promise((resolve, reject) => {
        const ffprobe = spawn("ffprobe", [
          "-v",
          "quiet",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          videoSource,
        ]);

        let output = "";
        ffprobe.stdout.on("data", (data) => {
          output += data.toString();
        });

        ffprobe.on("close", (code) => {
          if (code === 0) {
            try {
              const metadata = JSON.parse(output);
              const videoStream = metadata.streams.find(
                (s) => s.codec_type === "video"
              );

              resolve({
                duration: parseFloat(metadata.format.duration),
                width: videoStream ? videoStream.width : null,
                height: videoStream ? videoStream.height : null,
                fps: videoStream ? eval(videoStream.r_frame_rate) : null,
                codec: videoStream ? videoStream.codec_name : null,
                size: parseInt(metadata.format.size),
                bitrate: parseInt(metadata.format.bit_rate),
              });
            } catch (parseError) {
              reject(new Error("Failed to parse metadata"));
            }
          } else {
            reject(new Error("Failed to extract metadata"));
          }
        });

        ffprobe.on("error", () => {
          reject(new Error("FFprobe not available"));
        });
      });
    };

    const metadata = await getVideoMetadata(videoSource);
    res.json(metadata);
  } catch (error) {
    console.error("Error extracting video metadata:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== UTILITY API =====

// Get available videos for a specific project (legacy endpoint - now returns project-specific video references)
app.get(
  "/api/projects/:projectId/videos",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user.userId;

      // Verify project belongs to user
      const project = getProjectById(projectId, userId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const videoRefs = getVideoReferencesByProjectId(projectId, userId);

      const videos = videoRefs.map((videoRef) => ({
        id: videoRef.id,
        name: videoRef.name,
        path: videoRef.source_url || videoRef.source_path,
        sourceType: videoRef.source_type,
        size: videoRef.metadata?.size,
        duration: videoRef.duration,
        uploadedAt: videoRef.created_at,
      }));

      res.json({ videos });
    } catch (error) {
      console.error("Error getting videos:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Get project-specific media
app.get(
  "/api/projects/:projectId/media",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user.userId;

      // Verify project belongs to user
      const project = getProjectById(projectId, userId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Return only video references for this specific project
      const videoRefs = getVideoReferencesByProjectId(projectId, userId);

      res.json({ videoReferences: videoRefs });
    } catch (error) {
      console.error("Error getting project media:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Add media to project
app.post(
  "/api/projects/:projectId/media",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const { mediaItems } = req.body;
      const userId = req.user.userId;

      // Verify project belongs to user
      const project = getProjectById(projectId, userId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Add new media items to database
      const newMediaItems = [];
      for (const item of mediaItems) {
        const mediaId = uuidv4();
        addMedia(
          mediaId,
          userId,
          projectId,
          item.name,
          item.type,
          item.filename,
          item.size,
          item.duration
        );
        newMediaItems.push({
          id: mediaId,
          ...item,
          addedAt: new Date().toISOString(),
        });
      }

      res.status(201).json({
        message: "Media added to project successfully",
        mediaItems: newMediaItems,
      });
    } catch (error) {
      console.error("Error adding media to project:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Remove media from project
app.delete(
  "/api/projects/:projectId/media/:mediaId",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId, mediaId } = req.params;
      const userId = req.user.userId;

      // Verify project belongs to user
      const project = getProjectById(projectId, userId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Remove media from database
      const deleted = deleteMedia(mediaId, userId);
      if (!deleted) {
        return res.status(404).json({ error: "Media item not found" });
      }

      res.json({ message: "Media removed from project successfully" });
    } catch (error) {
      console.error("Error removing media from project:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Get render progress
app.get("/api/render-progress/:renderId", (req, res) => {
  const { renderId } = req.params;
  const render = activeRenders.get(renderId);

  if (!render) {
    return res.status(404).json({ error: "Render not found" });
  }

  // Normalize response shape for clients expecting ok + "done"
  const normalizedStatus = render.status === "completed" ? "done" : render.status;
  res.json({
    ok: true,
    renderId,
    status: normalizedStatus,
    progress: render.progress,
    error: render.error,
  });
});

app.get("/api/render-complete/:renderId", async (req, res) => {
  const { renderId } = req.params;
  const render = activeRenders.get(renderId);

  if (!render) {
    return res.status(404).json({ error: "Render not found" });
  }

  // Start the actual rendering process
  try {
    render.status = "rendering";
    render.progress = 10;

    // Create output directory
    const outDir = path.resolve(__dirname, "out");
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Bundle the Remotion composition
    const entry = path.resolve(__dirname, "remotion", "index.tsx");
    const bundled = await bundle(entry);

    render.progress = 30;

    // Select the composition
    const comp = await selectComposition({
      serveUrl: bundled,
      id: "Advanced",
      inputProps: {
        tracks: render.tracks,
        durationInFrames: render.durationInFrames,
        fps: render.fps,
        width: render.width,
        height: render.height,
      },
    });

    render.progress = 50;

    // Configure quality settings
    const qualitySettings = {
      low: { crf: "28", preset: "ultrafast" },
      medium: { crf: "20", preset: "fast" },
      high: { crf: "16", preset: "slow" },
    };

    const settings = qualitySettings[render.quality] || qualitySettings.medium;

    // Configure codec and format
    let codec, outputFormat, ffmpegSettings;
    switch (render.format.toLowerCase()) {
      case "webm":
        codec = "vp9";
        outputFormat = "webm";
        ffmpegSettings = {
          "-c:v": "libvpx-vp9",
          "-crf": "30",
          "-b:v": "0",
          "-deadline": "good",
          "-cpu-used": "2",
        };
        break;
      case "gif":
        codec = "gif";
        outputFormat = "gif";
        ffmpegSettings = {
          "-vf": "fps=15,scale=480:-1:flags=lanczos",
        };
        break;
      case "mp4":
      default:
        codec = "h264";
        outputFormat = "mp4";
        ffmpegSettings = {
          "-c:v": "libx264",
          "-crf": settings.crf,
          "-preset": settings.preset,
          "-movflags": "+faststart",
          "-pix_fmt": "yuv420p",

          // Ensure constant frame rate (CFR)
          "-r": renderFps.toString(),
          "-fps_mode": "cfr",
          // Prevent frame dropping and ensure smooth playback

          // Force keyframe interval for consistent timing
        };
        break;
    }

    const outPath = path.resolve(outDir, `${render.filename}.${outputFormat}`);
    render.outputPath = outPath;
    render.progress = 70;

    // Render with enhanced FFmpeg settings
    await renderMedia({
      composition: comp,
      serveUrl: bundled,
      codec: codec,
      outputLocation: outPath,
    });

    render.status = "completed";
    render.progress = 100;
    render.completedAt = Date.now();

    console.log(`Render ${renderId} completed:`, outPath);
    res.json({ success: true, outputPath: outPath });
  } catch (error) {
    render.status = "failed";
    render.error = error.message;
    console.error(`Render ${renderId} failed:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/download-video/:renderId", (req, res) => {
  const { renderId } = req.params;
  const render = activeRenders.get(renderId);

  if (!render || render.status !== "completed") {
    return res.status(404).json({ error: "Render not found or not completed" });
  }

  const outputFormat =
    render.format === "gif" ? "gif" : render.format === "webm" ? "webm" : "mp4";

  res.download(
    render.outputPath,
    `${render.filename}.${outputFormat}`,
    (err) => {
      if (err) {
        console.error("Error sending file:", err);
        res.status(500).json({ error: "Failed to send video file" });
      } else {
        // Clean up the file and render data
        fs.unlinkSync(render.outputPath);
        activeRenders.delete(renderId);
        console.log(`Render ${renderId} cleaned up`);
      }
    }
  );
});

// Authentication endpoints
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ error: "Username, email, and password are required" });
    }

    // Check if user already exists
    const existingUser = getUserByUsername(username);
    if (existingUser) {
      return res.status(409).json({ error: "Username already exists" });
    }

    // Create new user
    const userId = generateUserId();
    const passwordHash = await hashPassword(password);
    await createUser(userId, username, email, passwordHash);

    // Generate token
    const token = generateToken(userId, username);

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: { id: userId, username, email },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    // Find user
    const user = getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Check password
    const isValidPassword = await comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Generate token
    const token = generateToken(user.id, user.username);

    res.json({
      message: "Login successful",
      token,
      user: { id: user.id, username: user.username, email: user.email },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/auth/me", authenticateUser, async (req, res) => {
  try {
    const user = getUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      user: { id: user.id, username: user.username, email: user.email },
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ error: "Failed to get user info" });
  }
});

// ===== AI VIDEO GENERATION API =====

// Track active video generations to prevent duplicates
const activeGenerations = new Map();

// Track video generation jobs
const videoJobs = new Map();

// Track retry attempts for failed video generations
const retryAttempts = new Map();
const MAX_RETRY_ATTEMPTS = 2;

// ===== SERVER-SIDE JOB MONITOR (SCHEDULER) =====
// Minimal, idempotent, horizontally scalable-friendly design

function nowMs() {
  return Date.now();
}

function setInitialMonitorState(jobInfo) {
  jobInfo.status = jobInfo.status || "processing";
  jobInfo.pollIntervalMs = jobInfo.pollIntervalMs || 15000; // 15s
  jobInfo.nextPollAt = jobInfo.nextPollAt || nowMs();
  jobInfo.locked = false;
}

async function pollJobOnce(jobId) {
  const jobInfo = videoJobs.get(jobId);
  if (!jobInfo) return;
  if (jobInfo.status === "completed" || jobInfo.status === "paused") return;
  if (jobInfo.locked) return;

  // Backoff gate
  if (jobInfo.nextPollAt && nowMs() < jobInfo.nextPollAt) return;

  jobInfo.locked = true;
  try {
    let completedShots = 0;
    let failedShots = 0;
    let anyChange = false;
    const updatedShots = [];

    for (const shot of jobInfo.shots) {
      if (shot.status === "completed" || shot.status === "failed") {
        updatedShots.push(shot);
        if (shot.status === "completed") completedShots++;
        if (shot.status === "failed") failedShots++;
        continue;
      }

      try {
        const modalEndpoint = (jobInfo.modalEndpoint || "").replace(/\/+$/, "");
        const historyResponse = await fetch(
          `${modalEndpoint}/history/${shot.promptId}`
        );
        if (historyResponse.ok) {
          const history = await historyResponse.json();
          if (shot.promptId in history) {
            const result = history[shot.promptId];
            if (result.outputs) {
              // Completed -> download
              const videoPath = await downloadGeneratedVideo(
                result,
                shot.shotId || shot.shotId || shot.id,
                modalEndpoint
              );
              if (videoPath) {
                const videoId = uuidv4();
                createVideoReference(
                  videoId,
                  jobInfo.userId,
                  jobInfo.projectId,
                  shot.title,
                  `/uploads/generated/${path.basename(videoPath)}`,
                  videoPath,
                  "url",
                  shot.duration,
                  shot.width,
                  shot.height,
                  shot.fps,
                  "h264",
                  null,
                  { prompt: shot.prompt, negative: shot.negative }
                );

                // Place on timeline end-to-end by shotIndex
                const itemId = uuidv4();
                const startFrame =
                  shot.shotIndex * Math.round(shot.duration * shot.fps);
                addTimelineItem(
                  itemId,
                  jobInfo.projectId,
                  videoId,
                  0,
                  0,
                  shot.duration,
                  startFrame,
                  Math.round(shot.duration * shot.fps)
                );

                shot.status = "completed";
                shot.videoId = videoId;
                shot.timelineItemId = itemId;
                shot.videoUrl = `/uploads/generated/${path.basename(
                  videoPath
                )}`;
                completedShots++;
                anyChange = true;

                // Emit per-shot update
                emitVideoProgress(jobInfo.projectId, jobId, {
                  jobId,
                  projectId: jobInfo.projectId,
                  status: "processing",
                  totalShots: jobInfo.totalShots,
                  completedShots,
                  failedShots,
                  queuedShots:
                    jobInfo.totalShots - completedShots - failedShots,
                  shots: jobInfo.shots,
                  startTime: jobInfo.startTime,
                  progress: Math.round(
                    (completedShots / jobInfo.totalShots) * 100
                  ),
                  lastCompletedShot: shot.title,
                });
              }
            }
          }
        }
      } catch (e) {
        // Soft-fail; will retry next tick
      }

      updatedShots.push(shot);
    }

    // Update jobInfo
    jobInfo.completedShots = completedShots;
    jobInfo.failedShots = failedShots;
    jobInfo.shots = updatedShots;

    if (completedShots + failedShots === jobInfo.totalShots) {
      jobInfo.status = "completed";
      jobInfo.endTime = nowMs();
    }

    // Emit summary update
    emitVideoProgress(jobInfo.projectId, jobId, {
      jobId,
      projectId: jobInfo.projectId,
      status: jobInfo.status,
      totalShots: jobInfo.totalShots,
      completedShots,
      failedShots,
      queuedShots: jobInfo.totalShots - completedShots - failedShots,
      shots: jobInfo.shots,
      startTime: jobInfo.startTime,
      endTime: jobInfo.endTime,
      progress: Math.round((completedShots / jobInfo.totalShots) * 100),
    });

    // Backoff logic
    if (jobInfo.status === "completed") {
      jobInfo.nextPollAt = Number.POSITIVE_INFINITY;
    } else {
      // If there was a change, keep or reduce interval; else back off to max 45s
      const minMs = 15000;
      const maxMs = 45000;
      if (anyChange) {
        jobInfo.pollIntervalMs = Math.max(
          minMs,
          Math.floor(jobInfo.pollIntervalMs * 0.75)
        );
      } else {
        jobInfo.pollIntervalMs = Math.min(
          maxMs,
          Math.floor((jobInfo.pollIntervalMs || minMs) * 1.25)
        );
      }
      jobInfo.nextPollAt = nowMs() + jobInfo.pollIntervalMs;
    }
  } finally {
    jobInfo.locked = false;
    videoJobs.set(jobId, jobInfo);
  }
}

// Scheduler tick: scan jobs and poll a few eligible ones per tick
const MAX_POLLS_PER_TICK = 10;
async function monitorJobsTick() {
  try {
    const dueJobs = [];
    for (const [jobId, jobInfo] of videoJobs.entries()) {
      if (!jobInfo) continue;
      if (jobInfo.status === "completed" || jobInfo.status === "paused")
        continue;
      setInitialMonitorState(jobInfo);
      if (!jobInfo.nextPollAt || nowMs() >= jobInfo.nextPollAt) {
        dueJobs.push(jobId);
      }
    }

    // Limit per tick to avoid overload
    const slice = dueJobs.slice(0, MAX_POLLS_PER_TICK);
    await Promise.all(slice.map((jid) => pollJobOnce(jid)));
  } catch (e) {
    // Never throw
  }
}

// Start scheduler (5s cadence)
setInterval(monitorJobsTick, 5000);

// ===== WEBSOCKET PROGRESS TRACKING =====

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`🔌 WebSocket connected: ${socket.id}`);

  // Join project-specific room for progress updates
  socket.on("join-project", (projectId) => {
    const roomName = `project-${projectId}`;
    socket.join(roomName);
    console.log(
      `📁 Socket ${socket.id} joined project ${projectId} (room: ${roomName})`
    );

    // Log all rooms this socket is in
    const rooms = Array.from(socket.rooms);
    console.log(`🏠 Socket ${socket.id} is now in rooms:`, rooms);
  });

  // Leave project room
  socket.on("leave-project", (projectId) => {
    socket.leave(`project-${projectId}`);
    console.log(`📁 Socket ${socket.id} left project ${projectId}`);
  });

  socket.on("disconnect", () => {
    console.log(`🔌 WebSocket disconnected: ${socket.id}`);
  });
});

// Function to emit progress updates to project room
function emitVideoProgress(projectId, jobId, progress) {
  const roomName = `project-${projectId}`;
  const payload = {
    jobId,
    projectId,
    ...progress,
  };

  console.log(`📡 Emitting progress to room: ${roomName}`);
  console.log(`📊 Progress payload:`, payload);

  io.to(roomName).emit("video-progress", payload);

  // Log connected clients in the room
  const room = io.sockets.adapter.rooms.get(roomName);
  if (room) {
    console.log(`👥 Clients in room ${roomName}:`, room.size);
  } else {
    console.log(`⚠️ No clients in room ${roomName}`);
  }
}

// Server-side job monitor variables
const jobMonitorIntervals = new Map(); // Stores interval IDs for each job
const jobMonitorLocks = new Map(); // Simple in-memory lock for idempotency
const POLLING_INTERVAL_MS = 15000; // Initial polling interval (15 seconds)
const MAX_POLLING_INTERVAL_MS = 45000; // Max polling interval (45 seconds)

// Process a single job: poll Modal, download videos, update timeline
async function processJob(jobId, projectId, userId, modalEndpoint) {
  const lockKey = `${jobId}-${projectId}`;

  // Check if another process is already handling this job
  if (jobMonitorLocks.get(lockKey)) {
    console.log(`🔒 Job ${jobId} already being processed, skipping`);
    return;
  }

  // Set lock
  jobMonitorLocks.set(lockKey, true);

  try {
    const jobInfo = videoJobs.get(jobId);
    if (!jobInfo) {
      console.log(`❌ Job ${jobId} not found in videoJobs`);
      stopJobMonitor(jobId);
      return;
    }

    if (jobInfo.status === "completed" || jobInfo.status === "paused") {
      console.log(`✅ Job ${jobId} is ${jobInfo.status}, stopping monitor`);
      stopJobMonitor(jobId);
      return;
    }

    console.log(`🔍 Processing job ${jobId} for project ${projectId}`);

    let hasUpdates = false;

    // Poll Modal history for all shots in this job
    for (const shot of jobInfo.shots) {
      if (shot.status !== "queued") continue; // Skip completed/failed shots

      try {
        const endpoint = (modalEndpoint || "").replace(/\/+$/, "");
        const historyResponse = await fetch(
          `${endpoint}/history/${shot.promptId}`
        );

        if (!historyResponse.ok) {
          if (historyResponse.status === 404) {
            console.log(`⏳ Shot ${shot.promptId} not found in history yet`);
            continue;
          }
          throw new Error(`HTTP ${historyResponse.status}`);
        }

        const historyData = await historyResponse.json();

        if (historyData.status === "completed" && historyData.outputs) {
          console.log(`✅ Shot ${shot.promptId} completed, downloading...`);

          // Download the video
          const videoUrl = historyData.outputs.video_url;
          const videoResponse = await fetch(videoUrl);

          if (!videoResponse.ok) {
            throw new Error(
              `Failed to download video: ${videoResponse.status}`
            );
          }

          const videoBuffer = await videoResponse.arrayBuffer();
          const fileName = `${shot.promptId}_generated.mp4`;
          const filePath = path.join(process.cwd(), "uploads", fileName);

          // Save video file
          fs.writeFileSync(filePath, Buffer.from(videoBuffer));
          console.log(`💾 Saved video: ${filePath}`);

          // Create video reference
          const videoInfo = await getVideoMetadata(filePath);
          const videoReference = createVideoReference(
            userId,
            fileName,
            filePath,
            videoInfo.duration,
            videoInfo.width,
            videoInfo.height,
            videoInfo.fps,
            projectId
          );

          // Add to timeline with proper positioning
          const existingItems = getTimelineByProjectId(projectId, userId);
          const lastItem = existingItems.sort(
            (a, b) => b.startFrame - a.startFrame
          )[0];

          const startFrame = lastItem
            ? lastItem.startFrame + lastItem.durationFrames
            : 0;

          addTimelineItem(
            projectId,
            userId,
            videoReference.id,
            "video",
            startFrame,
            Math.round(videoInfo.duration * videoInfo.fps),
            0 // track
          );

          console.log(`📽️ Added to timeline at frame ${startFrame}`);

          // Update shot status
          shot.status = "completed";
          shot.videoReference = videoReference;
          jobInfo.completedShots++;
          hasUpdates = true;
        } else if (historyData.status === "failed") {
          console.log(`❌ Shot ${shot.promptId} failed: ${historyData.error}`);
          shot.status = "failed";
          shot.error = historyData.error || "Unknown error";
          jobInfo.failedShots++;
          hasUpdates = true;
        }
      } catch (error) {
        console.error(`⚠️ Error processing shot ${shot.promptId}:`, error);
        // Don't mark as failed yet, might be temporary network issue
      }
    }

    // Update job info if there were changes
    if (hasUpdates) {
      videoJobs.set(jobId, jobInfo);

      // Calculate progress
      const progress = Math.round(
        (jobInfo.completedShots / jobInfo.totalShots) * 100
      );

      // Emit progress update
      const progressData = {
        jobId,
        projectId,
        status: jobInfo.status,
        totalShots: jobInfo.totalShots,
        completedShots: jobInfo.completedShots,
        failedShots: jobInfo.failedShots,
        queuedShots:
          jobInfo.totalShots - jobInfo.completedShots - jobInfo.failedShots,
        shots: jobInfo.shots,
        startTime: jobInfo.startTime,
        progress,
      };

      emitVideoProgress(projectId, jobId, progressData);
      console.log(
        `📡 Emitted progress update: ${progress}% (${jobInfo.completedShots}/${jobInfo.totalShots})`
      );

      // Check if job is complete
      if (jobInfo.completedShots + jobInfo.failedShots >= jobInfo.totalShots) {
        jobInfo.status = "completed";
        jobInfo.endTime = Date.now();
        videoJobs.set(jobId, jobInfo);

        console.log(`🎉 Job ${jobId} completed! Stopping Modal app...`);
        await stopModalApp(modalEndpoint);
        stopJobMonitor(jobId);

        // Final progress emit
        emitVideoProgress(projectId, jobId, {
          ...progressData,
          status: "completed",
          endTime: jobInfo.endTime,
          progress: 100,
        });
      }
    }
  } catch (error) {
    console.error(`❌ Error in processJob for ${jobId}:`, error);
  } finally {
    // Release lock
    jobMonitorLocks.delete(lockKey);
  }
}

// Start monitoring a job
function startJobMonitor(jobId, projectId, userId, modalEndpoint) {
  if (jobMonitorIntervals.has(jobId)) {
    console.log(`⚠️ Monitor already running for job ${jobId}`);
    return;
  }

  console.log(`🎬 Starting monitor for job ${jobId}`);

  // Start with immediate processing
  processJob(jobId, projectId, userId, modalEndpoint);

  // Set up interval for periodic polling
  const intervalId = setInterval(async () => {
    await processJob(jobId, projectId, userId, modalEndpoint);
  }, POLLING_INTERVAL_MS);

  jobMonitorIntervals.set(jobId, intervalId);
}

// Stop monitoring a job
function stopJobMonitor(jobId) {
  const intervalId = jobMonitorIntervals.get(jobId);
  if (intervalId) {
    clearInterval(intervalId);
    jobMonitorIntervals.delete(jobId);
    console.log(`🛑 Stopped monitor for job ${jobId}`);
  }

  // Clean up lock
  const jobInfo = videoJobs.get(jobId);
  if (jobInfo) {
    const lockKey = `${jobId}-${jobInfo.projectId}`;
    jobMonitorLocks.delete(lockKey);
  }
}

// Gracefully stop a Modal app given its endpoint URL
async function stopModalApp(modalEndpoint) {
  try {
    const endpoint = (modalEndpoint || "").replace(/\/+$/, "");
    if (!endpoint) return;

    // Extract app name from endpoint like: https://user--appname-comfyui.modal.run
    const match = endpoint.match(
      /https:\/\/([^-]+)--([^-]+)-comfyui\.modal\.run/
    );
    if (!match) {
      console.log(`⚠️ Could not parse app name from endpoint: ${endpoint}`);
      return;
    }

    const [, user, appName] = match;
    const fullAppName = `${user}/${appName}`;

    console.log(`🛑 Stopping Modal app: ${fullAppName}`);

    await new Promise((resolve, reject) => {
      const { execFile } = require("child_process");
      execFile("modal", ["app", "stop", fullAppName], (error) => {
        if (error) {
          console.error(
            `❌ Failed to stop Modal app ${fullAppName}:`,
            error.message
          );
          reject(error);
        } else {
          console.log(`✅ Successfully stopped Modal app: ${fullAppName}`);
          resolve();
        }
      });
    });
  } catch (error) {
    console.error("Error stopping Modal app:", error);
  }
}

// ===== MODAL APP MANAGEMENT =====

async function isModalHealthy(rawEndpoint) {
  try {
    const endpoint = (rawEndpoint || "").replace(/\/+$/, "");
    if (!endpoint) return false;
    const resp = await fetch(`${endpoint}/health`, { method: "GET" });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

function deployModalAppViaCLI() {
  return new Promise((resolve, reject) => {
    try {
      const modalDir = path.resolve(__dirname, "../comfy-modal");
      const scriptName = "headless_comfyui_gpt.py";
      const child = execFile(
        "modal",
        ["deploy", scriptName],
        { cwd: modalDir },
        (error, stdout, stderr) => {
          if (error) {
            return reject(new Error(`Modal deploy failed: ${error.message}`));
          }
          const out = `${stdout || ""}${stderr || ""}`;
          const match = out.match(/https:\/\/[^\s]+modal\.run\S*/);
          if (match && match[0]) {
            resolve(match[0].replace(/\n/g, "").trim());
          } else {
            reject(
              new Error("Could not parse Modal endpoint from deploy output")
            );
          }
        }
      );
    } catch (e) {
      reject(e);
    }
  });
}

async function ensureModalAppEndpoint(preferredEndpoint) {
  const normalized = (preferredEndpoint || "").replace(/\/+$/, "");
  if (await isModalHealthy(normalized)) return normalized;

  // Try configured default
  try {
    const { MODAL_CONFIG } = await import("./modal-config.js");
    const fromConfig = (MODAL_CONFIG?.endpoint || "").replace(/\/+$/, "");
    if (await isModalHealthy(fromConfig)) return fromConfig;
  } catch (_) {
    // ignore
  }

  // Deploy a new Modal app and return its endpoint
  const deployed = await deployModalAppViaCLI();
  if (!(await isModalHealthy(deployed))) {
    throw new Error(
      "Modal app deployment reported URL but health check failed"
    );
  }
  return deployed;
}

// Generate videos from screenplay and add to timeline
app.post(
  "/api/projects/:projectId/generate-videos",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user.userId;
      const {
        modalEndpoint = "https://maengo31--headless-comfyui-server-comfyui.modal.run",
        resolution = "720x480",
        fps = 24,
        maxDuration = 5.0,
        characterDescription,
      } = req.body;

      // Check if generation is already in progress
      if (activeGenerations.has(projectId)) {
        return res.status(409).json({
          error:
            "Video generation already in progress for this project. Please wait for completion.",
        });
      }

      // Mark generation as active
      activeGenerations.set(projectId, { startTime: Date.now(), userId });

      // Verify project belongs to user
      const project = getProjectById(projectId, userId);
      if (!project) {
        activeGenerations.delete(projectId); // Clean up
        return res.status(404).json({ error: "Project not found" });
      }

      // Get screenplay data
      const script = getScriptByProjectId(projectId, userId);
      if (!script || !script.screenplay) {
        return res.status(400).json({
          error: "No screenplay found. Please complete the screenplay first.",
        });
      }

      console.log(
        `🎬 Starting AI video generation for project: ${project.name}`
      );
      // Ensure Modal app is alive or auto-deploy one
      const ensuredEndpoint = await ensureModalAppEndpoint(modalEndpoint);
      console.log(`🌐 Modal endpoint: ${ensuredEndpoint}`);

      // Parse resolution
      const [width, height] = resolution.split("x").map(Number);
      if (!width || !height) {
        activeGenerations.delete(projectId); // Clean up
        return res.status(400).json({
          error:
            "Invalid resolution format. Use 'widthxheight' (e.g., '720x480')",
        });
      }

      // Extract shots from screenplay using AI
      const shots = await extractShotsFromScreenplay(script, ensuredEndpoint, {
        width,
        height,
        fps,
        maxDuration,
        characterDescription,
      });

      if (!shots || shots.length === 0) {
        return res
          .status(400)
          .json({ error: "Failed to extract shots from screenplay" });
      }

      // Save ComfyUI prompts (like generate_screenplay.py)
      const comfyPromptsPath = saveComfyPrompts(shots, projectId, userId);
      if (comfyPromptsPath) {
        console.log(`✅ ComfyUI prompts saved for project ${projectId}`);
      }

      // Queue videos for generation (don't wait for completion)
      const jobId = uuidv4();
      const jobShots = [];

      for (let i = 0; i < shots.length; i++) {
        const shot = shots[i];
        console.log(`🎬 Queuing video ${i + 1}/${shots.length}: ${shot.title}`);

        // Queue the video generation
        const videoJob = await queueVideoGeneration(
          shot,
          ensuredEndpoint,
          {
            width,
            height,
            fps,
            characterDescription,
          },
          projectId,
          userId,
          i
        );

        if (videoJob) {
          jobShots.push(videoJob);
        }
      }

      // Store job information for monitoring
      const jobInfo = {
        jobId,
        projectId,
        userId,
        totalShots: shots.length,
        queuedShots: jobShots.length,
        completedShots: 0,
        failedShots: 0,
        shots: jobShots,
        startTime: Date.now(),
        status: "queued",
        modalEndpoint: ensuredEndpoint,
      };

      videoJobs.set(jobId, jobInfo);

      // Emit initial progress update
      const initialProgress = {
        jobId,
        projectId,
        status: "queued",
        totalShots: shots.length,
        completedShots: 0,
        failedShots: 0,
        queuedShots: jobShots.length,
        shots: jobShots,
        startTime: Date.now(),
        progress: 0,
      };

      emitVideoProgress(projectId, jobId, initialProgress);
      console.log(`🎬 Initial progress emitted for job ${jobId}`);

      // Start server-side job monitor
      startJobMonitor(jobId, projectId, userId, ensuredEndpoint);

      // Clean up active generation tracking
      activeGenerations.delete(projectId);

      res.json({
        success: true,
        message: `Queued ${jobShots.length} videos for generation`,
        jobId: jobId,
        totalShots: shots.length,
        projectId: projectId,
      });
    } catch (error) {
      console.error("Error generating videos:", error);
      // Clean up active generation tracking on error
      activeGenerations.delete(projectId);
      res.status(500).json({ error: error.message });
    }
  }
);

// Monitor video generation progress
app.get(
  "/api/projects/:projectId/video-generation-status/:jobId",
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId, jobId } = req.params;
      const userId = req.user.userId;

      // Verify project belongs to user
      const project = getProjectById(projectId, userId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Get job information
      const jobInfo = videoJobs.get(jobId);
      if (!jobInfo) {
        return res.status(404).json({ error: "Job not found" });
      }

      // Check if job belongs to user
      if (jobInfo.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Update job status by checking each shot
      let completedShots = 0;
      let failedShots = 0;
      const updatedShots = [];

      for (const shot of jobInfo.shots) {
        if (shot.status === "completed" || shot.status === "failed") {
          updatedShots.push(shot);
          if (shot.status === "completed") completedShots++;
          if (shot.status === "failed") failedShots++;
          continue;
        }

        // Check if this shot is completed
        try {
          const modalEndpoint = (jobInfo.modalEndpoint || "").replace(
            /\/+$/,
            ""
          );
          const historyResponse = await fetch(
            `${modalEndpoint}/history/${shot.promptId}`
          );

          if (historyResponse.ok) {
            const history = await historyResponse.json();
            if (shot.promptId in history) {
              const result = history[shot.promptId];
              if (result.outputs) {
                // Video is completed
                const videoPath = await downloadGeneratedVideo(
                  result,
                  shot.shotId,
                  modalEndpoint
                );

                if (videoPath) {
                  // Create video reference
                  const videoId = uuidv4();
                  const videoRef = createVideoReference(
                    videoId,
                    userId,
                    projectId,
                    shot.title,
                    `/uploads/generated/${path.basename(videoPath)}`,
                    videoPath,
                    "url",
                    shot.duration,
                    shot.width,
                    shot.height,
                    shot.fps,
                    "h264",
                    null,
                    { prompt: shot.prompt, negative: shot.negative }
                  );

                  // Add to timeline
                  const itemId = uuidv4();
                  const startFrame =
                    shot.shotIndex * Math.round(shot.duration * shot.fps);
                  addTimelineItem(
                    itemId,
                    projectId,
                    videoId,
                    0, // trackIndex
                    0, // startTime
                    shot.duration,
                    startFrame,
                    Math.round(shot.duration * shot.fps)
                  );

                  shot.status = "completed";
                  shot.videoId = videoId;
                  shot.timelineItemId = itemId;
                  shot.videoUrl = `/uploads/generated/${path.basename(
                    videoPath
                  )}`;
                  completedShots++;

                  // Emit individual shot completion
                  emitVideoProgress(projectId, jobId, {
                    jobId,
                    projectId,
                    status: "processing",
                    totalShots: jobInfo.totalShots,
                    completedShots,
                    failedShots,
                    queuedShots:
                      jobInfo.totalShots - completedShots - failedShots,
                    shots: updatedShots,
                    startTime: jobInfo.startTime,
                    progress: Math.round(
                      (completedShots / jobInfo.totalShots) * 100
                    ),
                    lastCompletedShot: shot.title,
                  });
                } else {
                  shot.status = "failed";
                  shot.error = "Failed to download video";
                  failedShots++;
                }
              }
            }
          }
        } catch (error) {
          console.error(`Error checking shot ${shot.shotId}:`, error);
          // Don't mark as failed yet, just continue
        }

        updatedShots.push(shot);
      }

      // Update job info
      jobInfo.completedShots = completedShots;
      jobInfo.failedShots = failedShots;
      jobInfo.shots = updatedShots;

      // Check if job is complete
      if (completedShots + failedShots === jobInfo.totalShots) {
        jobInfo.status = "completed";
        jobInfo.endTime = Date.now();
      }

      // Emit progress update via WebSocket
      const progressData = {
        jobId,
        projectId,
        status: jobInfo.status,
        totalShots: jobInfo.totalShots,
        completedShots,
        failedShots,
        queuedShots: jobInfo.totalShots - completedShots - failedShots,
        shots: updatedShots,
        startTime: jobInfo.startTime,
        endTime: jobInfo.endTime,
        progress: Math.round((completedShots / jobInfo.totalShots) * 100),
      };

      // Emit progress update
      emitVideoProgress(projectId, jobId, progressData);

      // Log progress for debugging
      console.log(
        `📊 Progress Update - Job ${jobId}: ${completedShots}/${jobInfo.totalShots} completed (${progressData.progress}%)`
      );

      res.json(progressData);
    } catch (error) {
      console.error("Error monitoring video generation:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Helper function to extract shots from screenplay using AI
async function extractShotsFromScreenplay(script, modalEndpoint, options) {
  try {
    // Use Gemini to analyze screenplay and extract shots
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
      throw new Error("GEMINI_API_KEY not set");
    }

    const systemPrompt = `You are an AI assistant that extracts video shots from a screenplay and creates optimized ComfyUI prompts.
    
    Analyze the screenplay and create a list of shots with the following structure:
    - Each shot should be 2-5 seconds long
    - Extract visual descriptions and actions
    - Create optimized prompts specifically for ComfyUI video generation
    - Include negative prompts for quality
    - Maintain character consistency across all shots
    - Use consistent seeds for better character consistency
    
    IMPORTANT: For character consistency, include detailed character descriptions in every prompt:
    - Use the same character descriptions for the same characters across all shots
    - Include physical appearance, clothing, age, and distinctive features
    - Reference the characterDescription parameter if provided
    - Use consistent visual style and lighting across all shots
    
    Return a JSON array of shots with this exact format:
    [
      {
        "id": 1,
        "title": "Shot Title",
        "prompt": "Detailed visual description including consistent character appearance, lighting, and cinematic composition for ComfyUI video generation",
        "negative": "blurry, low quality, low resolution, static, no motion, inconsistent character appearance, poor lighting, bad composition",
        "duration": 3.0,
        "description": "Brief shot description",
        "seed": 123456789
      }
    ]
    
    Focus on visual elements, character actions, cinematic moments, and consistent visual style while maintaining character consistency.`;

    const payload = {
      contents: [
        { role: "user", parts: [{ text: systemPrompt }] },
        {
          role: "user",
          parts: [
            {
              text: `Screenplay:\n${script.screenplay}\n\nLogline: ${
                script.logline
              }\n\nCharacter Description: ${
                options.characterDescription ||
                "Young adults in casual clothing"
              }\n\nIMPORTANT: Use the character description to maintain consistent character appearance across all shots.`,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.7, topK: 40, topP: 0.9 },
    };

    const fetchFn = global.fetch || (await import("node-fetch")).default;
    const resp = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!resp.ok) {
      throw new Error(`Gemini API error: ${resp.status}`);
    }

    const json = await resp.json();
    const content = json.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Extract JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("Failed to extract shots JSON from AI response");
    }

    const shots = JSON.parse(jsonMatch[0]);
    console.log(`📋 Extracted ${shots.length} shots from screenplay`);

    // Add seeds if not provided
    shots.forEach((shot, index) => {
      if (!shot.seed) {
        shot.seed = 123456789 + index * 10; // Consistent seeds for character consistency
      }
    });

    return shots;
  } catch (error) {
    console.error("Error extracting shots:", error);
    throw error;
  }
}

// Helper function to save ComfyUI prompts (like generate_screenplay.py)
function saveComfyPrompts(shots, projectId, userId) {
  try {
    const comfyData = {
      title: "Generated from Web App",
      genre: "drama",
      duration: shots.reduce((total, shot) => total + shot.duration, 0),
      synopsis: "Screenplay generated from web application",
      shots: shots.map((shot) => ({
        id: shot.id,
        prompt: shot.prompt,
        negative: shot.negative,
        seed: shot.seed || 123456789 + shot.id * 10,
      })),
      metadata: {
        created_at: new Date().toISOString(),
        visual_style: "cinematic",
        characters: "Generated from web app",
        setting: "Generated from web app",
      },
    };

    // Save to project directory
    const projectDir = path.resolve(__dirname, "data", "projects", projectId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    const filePath = path.resolve(projectDir, "shots_prompts_comfy.json");
    fs.writeFileSync(filePath, JSON.stringify(comfyData, null, 2));

    console.log(`🎬 ComfyUI prompts saved to: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error("Error saving ComfyUI prompts:", error);
    return null;
  }
}

// Helper function to queue video generation (returns immediately)
async function queueVideoGeneration(
  shot,
  modalEndpoint,
  options,
  projectId,
  userId,
  shotIndex
) {
  try {
    console.log(`🎬 Queuing video for shot: ${shot.title}`);

    // Normalize endpoint to avoid double slashes causing 404s
    const endpoint = (modalEndpoint || "").replace(/\/+$/, "");

    // Load the workflow template
    const workflowPath = path.resolve(
      __dirname,
      "../comfy-modal/wan22_t2v_flexible.json"
    );
    if (!fs.existsSync(workflowPath)) {
      throw new Error("Workflow template not found");
    }

    const workflowTemplate = JSON.parse(fs.readFileSync(workflowPath, "utf8"));

    // Calculate frames
    const frames = Math.round(shot.duration * options.fps);

    // Create workflow with shot parameters
    const workflow = JSON.parse(JSON.stringify(workflowTemplate));

    // Replace placeholders in workflow
    const workflowStr = JSON.stringify(workflow)
      .replace("{PROMPT}", shot.prompt.replace(/"/g, "'"))
      .replace("{NEGATIVE}", shot.negative.replace(/"/g, "'"))
      .replace("{SEED}", (123456789 + shot.id * 1000).toString())
      .replace("{LENGTH}", frames.toString())
      .replace("{WIDTH}", options.width.toString())
      .replace("{HEIGHT}", options.height.toString());

    const finalWorkflow = JSON.parse(workflowStr);

    // Submit to Modal ComfyUI
    const response = await fetch(`${endpoint}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: finalWorkflow }),
    });

    if (!response.ok) {
      throw new Error(`Modal API error: ${response.status}`);
    }

    const result = await response.json();
    const promptId = result.prompt_id;

    console.log(`⏳ Video queued with ID: ${promptId}`);

    // Return job information (don't wait for completion)
    return {
      shotId: shot.id,
      shotIndex: shotIndex,
      title: shot.title,
      promptId: promptId,
      status: "queued",
      startTime: Date.now(),
      duration: shot.duration,
      prompt: shot.prompt,
      negative: shot.negative,
      width: options.width,
      height: options.height,
      fps: options.fps,
    };
  } catch (error) {
    console.error(`Error queuing video for shot ${shot.id}:`, error);
    return null;
  }
}

// Helper function to generate video from a shot using Modal ComfyUI (original function for direct generation)
async function generateVideoFromShot(
  shot,
  modalEndpoint,
  options,
  progressCallback = null
) {
  try {
    console.log(`🎬 Generating video for shot: ${shot.title}`);

    // Normalize endpoint to avoid double slashes causing 404s
    const endpoint = (modalEndpoint || "").replace(/\/+$/, "");

    if (progressCallback) {
      progressCallback(`Starting video generation for: ${shot.title}`);
    }

    // Load the workflow template
    const workflowPath = path.resolve(
      __dirname,
      "../comfy-modal/wan22_t2v_flexible.json"
    );
    if (!fs.existsSync(workflowPath)) {
      throw new Error("Workflow template not found");
    }

    const workflowTemplate = JSON.parse(fs.readFileSync(workflowPath, "utf8"));

    // Calculate frames
    const frames = Math.round(shot.duration * options.fps);

    // Create workflow with shot parameters
    const workflow = JSON.parse(JSON.stringify(workflowTemplate));

    // Replace placeholders in workflow
    const workflowStr = JSON.stringify(workflow)
      .replace("{PROMPT}", shot.prompt.replace(/"/g, "'"))
      .replace("{NEGATIVE}", shot.negative.replace(/"/g, "'"))
      .replace("{SEED}", (123456789 + shot.id * 1000).toString())
      .replace("{LENGTH}", frames.toString())
      .replace("{WIDTH}", options.width.toString())
      .replace("{HEIGHT}", options.height.toString());

    const finalWorkflow = JSON.parse(workflowStr);

    // Submit to Modal ComfyUI
    const response = await fetch(`${endpoint}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: finalWorkflow }),
    });

    if (!response.ok) {
      throw new Error(`Modal API error: ${response.status}`);
    }

    const result = await response.json();
    const promptId = result.prompt_id;

    console.log(`⏳ Video generation queued with ID: ${promptId}`);

    if (progressCallback) {
      progressCallback(`Video queued with ID: ${promptId}`);
    }

    // Check queue status to estimate wait time
    try {
      const queueResponse = await fetch(`${endpoint}/queue`);
      if (queueResponse.ok) {
        const queue = await queueResponse.json();
        const queueLength = queue.queue_running?.length || 0;
        const pendingLength = queue.queue_pending?.length || 0;
        console.log(
          `📊 Queue status: ${queueLength} running, ${pendingLength} pending`
        );

        // Estimate wait time (rough estimate: 2-3 minutes per video)
        const estimatedWait = (queueLength + pendingLength) * 2.5;
        if (estimatedWait > 0) {
          console.log(
            `⏱️ Estimated wait time: ~${estimatedWait.toFixed(1)} minutes`
          );
          if (progressCallback) {
            progressCallback(
              `Estimated wait time: ~${estimatedWait.toFixed(1)} minutes`
            );
          }
        }
      }
    } catch (e) {
      console.log("⚠️ Could not check queue status");
    }

    // Wait for completion with optimized polling
    const startTime = Date.now();
    let pollInterval = 15000; // Start with 15 seconds
    let consecutiveErrors = 0;
    let lastPollTime = 0;

    while (true) {
      const now = Date.now();
      const timeSinceLastPoll = now - lastPollTime;

      // Ensure minimum interval between polls
      if (timeSinceLastPoll < pollInterval) {
        await new Promise((resolve) =>
          setTimeout(resolve, pollInterval - timeSinceLastPoll)
        );
      }

      lastPollTime = Date.now();
      const elapsed = (Date.now() - startTime) / 1000;

      try {
        console.log(
          `🔍 Polling history for ${promptId} (interval: ${
            pollInterval / 1000
          }s, elapsed: ${elapsed.toFixed(1)}s)`
        );
        const historyResponse = await fetch(`${endpoint}/history/${promptId}`);

        if (historyResponse.ok) {
          const history = await historyResponse.json();
          if (promptId in history) {
            const result = history[promptId];
            if (result.outputs) {
              console.log(`✅ Video completed in ${elapsed.toFixed(1)}s`);

              // Download the video
              const videoPath = await downloadGeneratedVideo(
                result,
                shot.id,
                endpoint
              );
              if (videoPath) {
                return {
                  url: `/uploads/generated/${path.basename(videoPath)}`,
                  localPath: videoPath,
                  duration: shot.duration,
                };
              }
            }
          }

          // Reset error count on successful response
          consecutiveErrors = 0;

          // Increase poll interval for longer-running tasks (exponential backoff)
          if (elapsed > 60) {
            pollInterval = Math.min(pollInterval * 1.5, 45000); // Max 45 seconds
          }

          // Ensure minimum 15-second interval between polls
          pollInterval = Math.max(pollInterval, 15000);
        } else {
          consecutiveErrors++;
          console.log(
            `⚠️ History check failed (${historyResponse.status}), attempt ${consecutiveErrors}`
          );

          // Increase interval on consecutive errors
          if (consecutiveErrors > 2) {
            pollInterval = Math.min(pollInterval * 2, 90000); // Max 90 seconds
          }
        }
      } catch (e) {
        consecutiveErrors++;
        console.log(
          `⏳ Still processing... (${elapsed.toFixed(
            1
          )}s elapsed, ${consecutiveErrors} errors)`
        );

        // Increase interval on consecutive errors
        if (consecutiveErrors > 2) {
          pollInterval = Math.min(pollInterval * 2, 90000); // Max 90 seconds
        }
      }

      if (elapsed > 900) {
        // 15 minutes timeout
        throw new Error("Video generation timed out");
      }
    }
  } catch (error) {
    console.error(`Error generating video for shot ${shot.id}:`, error);
    return null;
  }
}

// Helper function to download generated video
async function downloadGeneratedVideo(result, shotId, modalEndpoint) {
  try {
    const outputs = result.outputs || {};

    for (const nodeId in outputs) {
      const output = outputs[nodeId];

      // Check for video files
      if (output.gifs) {
        for (const gif of output.gifs) {
          const filename = gif.filename;
          console.log(`📥 Downloading video: ${filename}`);

          const endpoint = (modalEndpoint || "").replace(/\/+$/, "");
          const videoUrl = `${endpoint}/view?filename=${filename}`;
          const videoResponse = await fetch(videoUrl);

          if (videoResponse.ok) {
            // Create uploads directory
            const uploadDir = path.resolve(
              __dirname,
              "public",
              "uploads",
              "generated"
            );
            if (!fs.existsSync(uploadDir)) {
              fs.mkdirSync(uploadDir, { recursive: true });
            }

            const videoPath = path.resolve(
              uploadDir,
              `shot_${shotId}_generated.mp4`
            );
            const buffer = await videoResponse.arrayBuffer();
            fs.writeFileSync(videoPath, Buffer.from(buffer));

            console.log(`✅ Video saved: ${videoPath}`);
            return videoPath;
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error("Error downloading video:", error);
    return null;
  }
}

// Generate videos from screenplay endpoint
app.post("/api/projects/:projectId/generate-from-screenplay", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { screenplay, fps = 24, width = 1280, height = 720, negative = "", seed } = req.body;

    console.log(`🎬 Generating videos from screenplay for project: ${projectId}`);
    console.log(`📝 Screenplay length: ${screenplay?.length || 0}`);
    console.log(`⚙️ Settings: ${fps}fps, ${width}x${height}, seed: ${seed}`);

    // Validate required fields
    if (!screenplay || typeof screenplay !== 'string') {
      return res.status(400).json({ 
        error: "Invalid screenplay data", 
        details: "Screenplay must be a non-empty string" 
      });
    }

    if (!projectId) {
      return res.status(400).json({ 
        error: "Missing project ID" 
      });
    }

    // For now, return a success response indicating the generation started
    // In a real implementation, this would:
    // 1. Parse the screenplay to extract shot information
    // 2. Call Modal/ComfyUI to generate videos for each shot
    // 3. Return a group ID for tracking progress
    
    const groupId = uuidv4();
    const shots = [
      { id: 1, prompt: "Sample shot 1", duration: 10 },
      { id: 2, prompt: "Sample shot 2", duration: 15 }
    ];

    console.log(`✅ Video generation initiated for group: ${groupId}`);

    res.status(200).json({
      ok: true,
      groupId,
      shots,
      message: "Video generation started successfully",
      status: "queued"
    });

  } catch (error) {
    console.error("❌ Error in generate-from-screenplay:", error);
    res.status(500).json({
      error: "Internal server error during video generation",
      details: error.message
    });
  }
});

// Serve the React app
app.get("*", (req, res) => {
  res.sendFile(path.resolve(__dirname, "dist", "index.html"));
});

// Initialize database and start server
const startServer = async () => {
  try {
    // Simple auth system initialized

    server.listen(PORT, () => {
      const serverUrl =
        process.env.VITE_API_BASE_URL ||
        process.env.VITE_CLOUDFLARE_TUNNEL_URL ||
        `http://localhost:${PORT}`;
      const wsUrl =
        process.env.VITE_WS_BASE_URL ||
        process.env.VITE_CLOUDFLARE_TUNNEL_URL ||
        `ws://localhost:${PORT}`;

      console.log(`🚀 Enhanced server running on ${serverUrl}`);
      console.log(`🔐 Authentication endpoints:`);
      console.log(`   📝 Register: ${serverUrl}/api/auth/register`);
      console.log(`   🔑 Login: ${serverUrl}/api/auth/login`);
      console.log(`   👤 Profile: ${serverUrl}/api/auth/me`);
      console.log(
        `📹 Video export API available at ${serverUrl}/api/export-video`
      );
      console.log(
        `🎬 Node.js render API available at ${serverUrl}/api/render-video`
      );
      console.log(
        `📊 Progress tracking API available at ${serverUrl}/api/render-progress/:id`
      );
      console.log(`\n🎬 NEW: Video Editor REST API Endpoints:`);
      console.log(`   📁 Projects: ${serverUrl}/api/projects`);
      console.log(`   📤 Upload: ${serverUrl}/api/upload-video`);
      console.log(`   🎬 Timeline: ${serverUrl}/api/projects/:id/timeline`);
      console.log(
        `   📦 Bulk Upload: ${serverUrl}/api/projects/:id/bulk-upload`
      );
      console.log(`   📋 Videos: ${serverUrl}/api/videos`);
      console.log(`   📖 API Docs: See API_DOCUMENTATION.md`);
      console.log(`   🧪 Test API: python test_api.py`);
      console.log(`🔌 WebSocket: ${wsUrl}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
