// api/server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import cookieParser from "cookie-parser";

import authRouter from "./routes/auth.js";
import projectsRouter from "./routes/projects.js";
import generationRouter from "./routes/generation.js";
import mediaRouter from "./routes/media.js";
import exportRouter from "./routes/export.js";
import videoRefsRouter from "./routes/videoReferences.js";
import timelineRouter from "./routes/timeline.js";
import { startJobWatcher } from "./services/jobWatcher.js";
import { uploadMonitor } from "./services/uploadMonitor.js";
import mediaMonitor from "./services/mediaMonitor.js";
import importWatcher from "./services/importWatcher.js";

// IMPORTANT: Routers import the shared Pool from db.js. Do NOT create another Pool here.

const FRONTENDS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function originAllowedByList(origin) {
  // Exact match or simple wildcard patterns like https://*.vercel.app
  return FRONTENDS.some((pat) => {
    if (!pat) return false;
    if (pat.includes("*")) {
      const re = new RegExp(
        "^" + pat
          .replace(/\./g, "\\.")
          .replace(/\*/g, ".*") + "$"
      );
      return re.test(origin);
    }
    return pat === origin;
  });
}

function originAllowed(origin) {
  if (!origin) return true; // same-origin / curl / server-to-server
  try {
    const u = new URL(origin);
    // Allow any Cloudflare tunnel host automatically
    if (u.hostname.endsWith(".trycloudflare.com")) return true;
  } catch {
    // fall through to list check
  }
  return originAllowedByList(origin);
}

const app = express();

// Behind Cloudflare/NGINX so Secure cookies & trust proxy work
app.set("trust proxy", 1);

// CORS MUST run before body parsers so even parser errors return CORS headers
const corsOptions = {
  origin(origin, cb) {
    const ok = originAllowed(origin);
    return cb(ok ? null : new Error(`CORS blocked origin: ${origin}`), ok);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
app.use(cors(corsOptions));
// Preflight first to avoid large body parsing before CORS
app.options("*", cors(corsOptions));

// Core middleware (after CORS)
// Bump JSON body limit to support large export payloads
app.use(express.json({ limit: "100mb" }));
app.use(cookieParser());

// API request logs (simple & safe)
app.use((req, _res, next) => {
  if (req.path.startsWith("/api/")) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    const ct = req.headers["content-type"];
    const origin = req.headers.origin;
    console.log("headers:", { origin, contentType: ct });
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      console.log("body:", req.body);
    }
  }
  next();
});

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// IMPORTANT: mount auth BEFORE any router that uses requireAuth internally
app.use("/api/auth", authRouter);

// Protected routers
app.use("/api/projects", projectsRouter);
app.use("/api/projects", generationRouter); // exposes /:id/generate-videos, etc.
app.use("/api", mediaRouter);
app.use("/api", timelineRouter);
app.use("/api", exportRouter);
app.use("/api", videoRefsRouter);

// 404 JSON for API paths
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  next();
});

// Error handler (after routes)
app.use((err, _req, res, _next) => {
  const msg = err?.message || "Server error";
  const code = err?.status || err?.statusCode || 500;
  console.error("Error handler:", { code, msg });
  res.status(code).json({ error: msg });
});

// HTTP + Socket.IO
const server = http.createServer(app);

// Socket.IO CORS with same logic (supports credentials)
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      try {
        if (originAllowed(origin)) return callback(null, true);
        return callback(new Error(`WS CORS blocked origin: ${origin}`), false);
      } catch (e) {
        return callback(e, false);
      }
    },
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  },
});

// Basic WS
io.on("connection", (socket) => {
  console.log("WS connected:", socket.id);
  socket.emit("hello", "world");
});

// Export io instance for use in other modules
export function getIO() {
  return io;
}

// Make io globally available for other modules
global.io = io;

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => console.log(`API listening on ${PORT}`));

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref(); // force-exit if something hangs
});
process.on("SIGINT", () => process.emit("SIGTERM"));

startJobWatcher({ io });

// Start upload monitor
uploadMonitor.start();

// Start media monitor
mediaMonitor.start();
// Start S3/Backblaze import watcher (fallback when notify fails)
importWatcher.start();
