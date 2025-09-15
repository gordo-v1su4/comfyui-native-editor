import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";

// In-memory storage (replace with database in production)
const users = new Map();
const projects = new Map();
const videoReferences = new Map(); // Changed from media to videoReferences
const timelineItems = new Map();
const projectScripts = new Map(); // key: `${userId}:${projectId}` → screenplay object
const projectChats = new Map(); // key: `${userId}:${projectId}` → [{role, content, ts}]

// Generate JWT token
export const generateToken = (userId, username) => {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: "7d" });
};

// Verify JWT token
export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

// Hash password
export const hashPassword = async (password) => {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
};

// Compare password
export const comparePassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

// Authentication middleware
export const authenticateUser = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Access token required" });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.user = decoded;
  next();
};

// Generate user ID
export const generateUserId = () => uuidv4();

// User operations
export const createUser = async (userId, username, email, passwordHash) => {
  users.set(userId, {
    id: userId,
    username,
    email,
    password_hash: passwordHash,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
};

export const getUserByUsername = (username) => {
  for (const user of users.values()) {
    if (user.username === username) {
      return user;
    }
  }
  return null;
};

export const getUserById = (userId) => {
  return users.get(userId) || null;
};

// Project operations
export const createProject = (
  projectId,
  userId,
  name,
  description,
  width,
  height,
  fps
) => {
  const project = {
    id: projectId,
    user_id: userId,
    name,
    description,
    width,
    height,
    fps,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  projects.set(projectId, project);
  return project;
};

export const getProjectsByUserId = (userId) => {
  const userProjects = [];
  for (const project of projects.values()) {
    if (project.user_id === userId) {
      userProjects.push(project);
    }
  }
  return userProjects.sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
};

export const getProjectById = (projectId, userId) => {
  const project = projects.get(projectId);
  if (project && project.user_id === userId) {
    return project;
  }
  return null;
};

export const deleteProject = (projectId, userId) => {
  const project = projects.get(projectId);
  if (project && project.user_id === userId) {
    projects.delete(projectId);
    return true;
  }
  return false;
};

// Video Reference operations (NEW - replaces media operations)
export const createVideoReference = (
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
) => {
  const videoRef = {
    id: videoId,
    user_id: userId,
    project_id: projectId, // Add project_id to make it project-specific
    name,
    source_url: sourceUrl,
    source_path: sourcePath,
    source_type: sourceType, // 'url', 'local_file', 'google_drive', 'dropbox', etc.
    duration,
    width,
    height,
    fps,
    codec,
    thumbnail,
    metadata: metadata || {},
    created_at: new Date().toISOString(),
  };
  videoReferences.set(videoId, videoRef);
  return videoRef;
};

export const getVideoReferencesByUserId = (userId) => {
  const userVideos = [];
  for (const videoRef of videoReferences.values()) {
    if (videoRef.user_id === userId) {
      userVideos.push(videoRef);
    }
  }
  return userVideos.sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
};

export const getVideoReferencesByProjectId = (projectId, userId) => {
  const projectVideos = [];
  for (const videoRef of videoReferences.values()) {
    if (videoRef.user_id === userId && videoRef.project_id === projectId) {
      projectVideos.push(videoRef);
    }
  }
  return projectVideos.sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
};

export const getVideoReferenceById = (videoId, userId) => {
  const videoRef = videoReferences.get(videoId);
  if (videoRef && videoRef.user_id === userId) {
    return videoRef;
  }
  return null;
};

export const deleteVideoReference = (videoId, userId) => {
  const videoRef = videoReferences.get(videoId);
  if (videoRef && videoRef.user_id === userId) {
    videoReferences.delete(videoId);
    return true;
  }
  return false;
};

// Timeline operations (updated to use video references)
export const addTimelineItem = (
  itemId,
  projectId,
  videoReferenceId,
  trackIndex,
  startTime,
  duration,
  fromFrame,
  durationFrames
) => {
  const item = {
    id: itemId,
    project_id: projectId,
    video_reference_id: videoReferenceId, // Reference to video reference
    track_index: trackIndex,
    start_time: startTime, // Start time in source video
    duration: duration, // Duration to play
    from_frame: fromFrame,
    duration_frames: durationFrames,
    created_at: new Date().toISOString(),
  };
  timelineItems.set(itemId, item);
  return item;
};

export const getTimelineByProjectId = (projectId, userId) => {
  // First verify the project belongs to the user
  const project = getProjectById(projectId, userId);
  if (!project) return null;

  const items = [];
  for (const item of timelineItems.values()) {
    if (item.project_id === projectId) {
      items.push(item);
    }
  }

  // Group by track and include video reference data
  const trackMap = new Map();
  items.forEach((item) => {
    if (!trackMap.has(item.track_index)) {
      trackMap.set(item.track_index, {
        name: `Track ${item.track_index + 1}`,
        items: [],
      });
    }

    // Get video reference data
    const videoRef = videoReferences.get(item.video_reference_id);
    const timelineItem = {
      id: item.id,
      videoReferenceId: item.video_reference_id,
      type: "video",
      src: videoRef ? videoRef.source_url || videoRef.source_path : "unknown",
      sourceType: videoRef ? videoRef.source_type : "unknown",
      name: videoRef ? videoRef.name : "Unknown Video",
      from: item.from_frame,
      durationInFrames: item.duration_frames,
      startTime: item.start_time,
      duration: item.duration,
      // Include video reference metadata
      videoMetadata: videoRef
        ? {
            width: videoRef.width,
            height: videoRef.height,
            fps: videoRef.fps,
            codec: videoRef.codec,
            thumbnail: videoRef.thumbnail,
          }
        : null,
    };

    trackMap.get(item.track_index).items.push(timelineItem);
  });

  // Ensure at least 3 tracks are always present
  let finalTracks = Array.from(trackMap.values());
  const minTracks = 3;

  // Add default tracks if we have fewer than the minimum
  for (let i = finalTracks.length; i < minTracks; i++) {
    finalTracks.push({
      name: `Track ${i + 1}`,
      items: [],
    });
  }

  return {
    tracks: finalTracks,
    duration: Math.max(
      ...items.map((item) => item.from_frame + item.duration_frames),
      0
    ),
  };
};

export const deleteTimelineItem = (itemId, projectId, userId) => {
  // First verify the project belongs to the user
  const project = getProjectById(projectId, userId);
  if (!project) return false;

  const item = timelineItems.get(itemId);
  if (item && item.project_id === projectId) {
    timelineItems.delete(itemId);
    return true;
  }
  return false;
};

// Screenplay (script) operations
export const getScriptByProjectId = (projectId, userId) => {
  const key = `${userId}:${projectId}`;
  return projectScripts.get(key) || null;
};

export const saveScriptForProject = (projectId, userId, script) => {
  const key = `${userId}:${projectId}`;
  const existing = projectScripts.get(key);
  const toStore = {
    id: existing?.id || uuidv4(),
    project_id: projectId,
    user_id: userId,
    title: script?.title || existing?.title || "Untitled",
    logline: script?.logline || existing?.logline || "",
    outline: script?.outline || existing?.outline || [],
    beats: script?.beats || existing?.beats || [],
    scenes: script?.scenes || existing?.scenes || [],
    screenplay: script?.screenplay || existing?.screenplay || "",
    updated_at: new Date().toISOString(),
    created_at: existing?.created_at || new Date().toISOString(),
  };
  projectScripts.set(key, toStore);
  return toStore;
};

// Chat (AI assistant) operations
export const getChatHistory = (projectId, userId) => {
  const key = `${userId}:${projectId}`;
  return projectChats.get(key) || [];
};

export const appendChatMessage = (projectId, userId, role, content) => {
  const key = `${userId}:${projectId}`;
  const history = projectChats.get(key) || [];
  const message = { role, content, ts: new Date().toISOString() };
  const next = [...history, message];
  projectChats.set(key, next);
  return message;
};

export const clearChatHistory = (projectId, userId) => {
  const key = `${userId}:${projectId}`;
  projectChats.delete(key);
};

// Legacy media functions (for backward compatibility)
export const addMedia = (
  mediaId,
  userId,
  projectId,
  name,
  type,
  filename,
  size,
  duration
) => {
  // Convert to video reference format
  return createVideoReference(
    mediaId,
    userId,
    name,
    null, // sourceUrl
    `/uploads/${userId}/${filename}`, // sourcePath (legacy)
    "local_file", // sourceType
    duration,
    null, // width
    null, // height
    null, // fps
    null, // codec
    null, // thumbnail
    { size, type, filename } // metadata
  );
};

export const getMediaByUserId = (userId) => {
  return getVideoReferencesByUserId(userId);
};

export const getMediaByProjectId = (projectId, userId) => {
  // For project-specific media, we'll return all user's video references
  // since they can be used in any project
  return getVideoReferencesByUserId(userId);
};

export const deleteMedia = (mediaId, userId) => {
  return deleteVideoReference(mediaId, userId);
};
