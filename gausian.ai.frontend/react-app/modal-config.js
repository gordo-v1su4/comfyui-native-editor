// Modal ComfyUI Configuration
// Update this file with your Modal deployment endpoint

export const MODAL_CONFIG = {
  // Your Modal ComfyUI endpoint URL
  // Get this from your Modal deployment console
  endpoint: "https://maengo31--headless-comfyui-server-comfyui.modal.run",

  // Default video generation settings
  defaultSettings: {
    resolution: "720x480", // Preferred resolution for faster generation
    fps: 24,
    maxDuration: 5.0, // Maximum duration per shot in seconds
    characterDescription:
      "For character consistency: Use detailed, specific character descriptions including age, hair color/style, eye color, clothing, and distinctive features. Example: 'Sarah: 25-year-old woman with shoulder-length brown hair, green eyes, cream sweater, jeans. Mike: 28-year-old man with short dark hair, blue eyes, navy blue button-down shirt, khaki pants.' Always maintain the same character descriptions across all shots.",
  },

  // Workflow template path (relative to project root)
  workflowTemplate: "../comfy-modal/wan22_t2v_flexible.json",

  // Timeout settings
  timeouts: {
    generation: 900000, // 15 minutes per video
    download: 60000, // 1 minute for download
    api: 30000, // 30 seconds for API calls
  },
};

// Helper function to validate Modal endpoint
export function validateModalEndpoint(endpoint) {
  if (!endpoint || endpoint === "https://your-modal-endpoint.modal.run") {
    return {
      valid: false,
      error: "Please provide a valid Modal ComfyUI endpoint URL",
    };
  }

  if (!endpoint.startsWith("https://")) {
    return {
      valid: false,
      error: "Modal endpoint must start with https://",
    };
  }

  return { valid: true };
}

// Helper function to get default settings
export function getDefaultSettings() {
  return { ...MODAL_CONFIG.defaultSettings };
}

// Helper function to update endpoint
export function updateModalEndpoint(newEndpoint) {
  MODAL_CONFIG.endpoint = newEndpoint;
  // In a real app, you might want to save this to localStorage or a config file
  localStorage.setItem("modalEndpoint", newEndpoint);
}

// Helper function to get saved endpoint
export function getSavedEndpoint() {
  return localStorage.getItem("modalEndpoint") || MODAL_CONFIG.endpoint;
}
