// src/api.js
import { io } from "socket.io-client";
import axios from "axios";

// -------- Base URLs --------
const ENV = import.meta.env || {};
const API_BASE =
  ENV.VITE_API_BASE_URL ||
  ENV.VITE_CLOUDFLARE_TUNNEL_URL ||
  window.__API_BASE__ ||
  window.location.origin ||
  "http://localhost:3001";

// Prefer API_BASE for WS to ensure same-origin CORS rules unless explicitly overridden
const WS_BASE = ENV.VITE_WS_BASE_URL || API_BASE;

// -------- JWT storage + helpers --------
let AUTH_TOKEN = null;
try {
  // Prefer 'authToken' (used by components), fallback to 'jwt'
  AUTH_TOKEN = localStorage.getItem("authToken") || localStorage.getItem("jwt") || null;
} catch {
  /* ignore */
}

export function setAuthToken(t) {
  AUTH_TOKEN = t || null;
  try {
    if (AUTH_TOKEN) {
      localStorage.setItem("jwt", AUTH_TOKEN);
      localStorage.setItem("authToken", AUTH_TOKEN);
    } else {
      localStorage.removeItem("jwt");
      localStorage.removeItem("authToken");
    }
  } catch {
    /* ignore */
  }
}

function maybeCaptureTokenFromBody(body) {
  try {
    const tok = body && typeof body === "object" && body.token;
    if (tok && typeof tok === "string" && tok.length > 10) setAuthToken(tok);
  } catch {
    /* ignore */
  }
}

// Debug helpers
if (typeof window !== "undefined") {
  window.setJwt = (t) => {
    setAuthToken(t);
    console.log("JWT set?", !!t);
  };
  window.getJwt = () => AUTH_TOKEN;
  window.apiBase = API_BASE;
}

// -------- Axios instance --------
export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // best-effort cookie auth
  headers: { "Content-Type": "application/json" },
});

// Add Authorization to all axios requests
api.interceptors.request.use((config) => {
  if (!config.headers) config.headers = {};
  if (AUTH_TOKEN && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${AUTH_TOKEN}`;
  }
  config.withCredentials = true;
  return config;
});

// Capture token from any axios JSON response
api.interceptors.response.use((res) => {
  if (res && res.data) maybeCaptureTokenFromBody(res.data);
  return res;
});

// -------- Global fetch bridge (covers any direct fetch() usage) --------
if (typeof window !== "undefined" && !window.__apiFetchPatched) {
  const origFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    // Normalize URL
    let url = typeof input === "string" ? input : (input && input.url) || "";
    const isAbsolute = /^https?:\/\//i.test(url);

    // Determine if this request goes to our API
    const toApi =
      // absolute requests to API_BASE
      (isAbsolute && url.startsWith(API_BASE)) ||
      // relative requests that look like "/api/..."
      (!isAbsolute && typeof url === "string" && url.startsWith("/api/"));

    // Ensure headers object
    const headers = new Headers((init && init.headers) || {});
    // Attach Authorization when targeting our API
    if (toApi && AUTH_TOKEN && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${AUTH_TOKEN}`);
    }
    // Keep cookies flowing when possible
    const finalInit = { credentials: "include", ...init, headers };

    const resp = await origFetch(input, finalInit);

    // Try to capture token off any JSON body
    try {
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        // clone so downstream code can still read
        const clone = resp.clone();
        const data = await clone.json();
        maybeCaptureTokenFromBody(data);
      }
    } catch {
      /* ignore */
    }

    return resp;
  };

  window.__apiFetchPatched = true;
}

// -------- Lightweight fetch-based client used by the rest of this file --------
const apiClient = {
  baseURL: API_BASE,

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    if (AUTH_TOKEN && !headers.Authorization) {
      headers.Authorization = `Bearer ${AUTH_TOKEN}`;
    }
    const res = await fetch(url, {
      credentials: "include",
      ...options,
      headers,
    });
    if (!res.ok) {
      let msg = `API Error: ${res.status} ${res.statusText}`;
      try {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const body = await res.json();
          maybeCaptureTokenFromBody(body);
          if (body?.error) msg += ` – ${body.error}`;
          throw new Error(msg);
        }
        const text = await res.text();
        if (text) msg += ` – ${text}`;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await res.json();
      maybeCaptureTokenFromBody(body);
      return body;
    }
    return res.text();
  },

  get(ep) {
    return this.request(ep, { method: "GET" });
  },
  post(ep, data) {
    return this.request(ep, { method: "POST", body: JSON.stringify(data) });
  },
  put(ep, data) {
    return this.request(ep, { method: "PUT", body: JSON.stringify(data) });
  },
  delete(ep) {
    return this.request(ep, { method: "DELETE" });
  },

  upload(endpoint, formData) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {};
    if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
    return fetch(url, {
      method: "POST",
      body: formData,
      credentials: "include",
      headers,
    }).then(async (res) => {
      if (!res.ok)
        throw new Error(`Upload Error: ${res.status} ${res.statusText}`);
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const body = await res.json();
        maybeCaptureTokenFromBody(body);
        return body;
      }
      return res.text();
    });
  },
};

// -------- WebSocket client --------
let socket = null;
const wsClient = {
  connect(projectId) {
    if (socket) socket.disconnect();
    
    console.log("🔌 Connecting to WebSocket at:", WS_BASE);
    
    socket = io(WS_BASE, {
      // Allow transport negotiation (fallback to polling behind proxies/tunnels)
      path: "/socket.io",
      withCredentials: true,
      timeout: 20000,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      query: { projectId },
    });
    
    socket.on("connect", () => console.log("✅ WebSocket connected successfully"));
    socket.on("disconnect", () => console.log("🔌 WebSocket disconnected"));
    socket.on("connect_error", (e) => {
      console.error("❌ WebSocket connect error:", e);
      console.error("❌ Error details:", {
        message: e.message,
        description: e.description,
        context: e.context,
        type: e.type
      });
    });
    
    // Add timeout handling
    setTimeout(() => {
      if (socket && !socket.connected) {
        console.error("❌ WebSocket connection timeout after 20s");
        socket.disconnect();
      }
    }, 20000);
    
    return socket;
  },
  disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  },
  getSocket() {
    return socket;
  },
};

// -------- Auth API --------
export const authAPI = {
  async login(credentials) {
    const resp = await apiClient.post("/api/auth/login", credentials);
    // token will be captured automatically too
    return resp;
  },
  async register(userData) {
    const resp = await apiClient.post("/api/auth/register", userData);
    return resp;
  },
  async logout() {
    setAuthToken(null);
    return apiClient.post("/api/auth/logout");
  },
  getHealth: () => apiClient.get("/api/health"),
  me: () => apiClient.get("/api/auth/me"),
};

// -------- Project API --------
export const projectAPI = {
  getAll: () => apiClient.get("/api/projects"),
  getById: (id) => apiClient.get(`/api/projects/${id}`),
  create: (data) => apiClient.post("/api/projects", data),
  update: (id, data) => apiClient.put(`/api/projects/${id}`, data),
  delete: (id) => apiClient.delete(`/api/projects/${id}`),
  getTimeline: (id) => apiClient.get(`/api/projects/${id}/timeline`),
  addTimelineItem: (id, item) =>
    apiClient.post(`/api/projects/${id}/timeline`, item),
  updateTimelineItem: (id, itemId, item) =>
    apiClient.put(`/api/projects/${id}/timeline/${itemId}`, item),
  deleteTimelineItem: (id, itemId) =>
    apiClient.delete(`/api/projects/${id}/timeline/${itemId}`),
  
  // New timeline persistence endpoints
  saveTimelinePlacements: (id, items) =>
    apiClient.put(`/api/projects/${id}/timeline/placements`, { items }),
  deleteTimelinePlacement: (id, refId) =>
    apiClient.delete(`/api/projects/${id}/timeline/placements/${refId}`),
  
  // New screenplay extraction endpoint
  extractScreenplay: (id, data) =>
    apiClient.post(`/api/projects/${id}/screenplay/extract`, data),
  
  // New batch video generation endpoint
  generateFromScreenplay: (id, data) =>
    apiClient.post(`/api/projects/${id}/generate-from-screenplay`, data),
  // Preview plan (no queueing)
  planFromScreenplay: (id, data) =>
    apiClient.post(`/api/projects/${id}/generate-from-screenplay/plan`, data),
  // Progress by prompt ids
  generationStatus: (id, ids) =>
    apiClient.get(`/api/projects/${id}/generation-status?ids=${encodeURIComponent(ids.join(","))}`),
};

// -------- Generation API --------
export const videoGenerationAPI = {
  generate: (projectId, data) => {
    const body = data && data.params ? data : { params: data };
    return apiClient.post(`/api/projects/${projectId}/generate-videos`, body);
  },
  regenerateClip: (projectId, data) => {
    // data: { timelineItemId?, refId?, params: { prompt, negative?, width, height, length?, fps?, seed? }, replace? }
    return apiClient.post(`/api/projects/${projectId}/regenerate-clip`, data);
  },
  getStatus: (projectId, promptId) =>
    apiClient.get(
      `/api/projects/${projectId}/generate-videos/${encodeURIComponent(
        promptId
      )}/status`
    ),
};

// -------- Media API --------
export const mediaAPI = {
  uploadVideo: (formData) => apiClient.upload("/api/upload-video", formData),
  bulkUpload: (projectId, formData) =>
    apiClient.upload(`/api/projects/${projectId}/bulk-upload`, formData),
  getByProject: (projectId) =>
    apiClient.get(`/api/projects/${projectId}/media`),
  getVideoReferences: (projectId) =>
    apiClient.get(`/api/projects/${projectId}/video-references`),
  getAllVideoReferences: () => apiClient.get("/api/video-references"),
  extractMetadata: (data) =>
    apiClient.post("/api/extract-video-metadata", data),
  createVideoReference: (data) => apiClient.post("/api/video-references", data),
  addMediaToProject: (projectId, data) =>
    apiClient.post(`/api/projects/${projectId}/media`, data),
  deleteVideo: (id) => apiClient.delete(`/api/video-references/${id}`),
};

// -------- Export API --------
export const exportAPI = {
  exportVideo: (data) => apiClient.post("/api/export-video", data),
};

// -------- WebSocket API --------
export const wsAPI = {
  connect: wsClient.connect,
  disconnect: wsClient.disconnect,
  getSocket: wsClient.getSocket,
};

// Legacy convenience
export const getHealth = authAPI.getHealth;
export const createProject = projectAPI.create;

// Useful exports
export const apiBase = API_BASE;

// Default export
export default apiClient;
