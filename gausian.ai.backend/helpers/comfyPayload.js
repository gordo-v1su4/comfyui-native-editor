// helpers/comfyPayload.js
export function ensurePromptObject(workflow) {
    // Accept object or JSON string; normalize to object
    if (typeof workflow === "string") {
      try { workflow = JSON.parse(workflow); }
      catch { throw new Error("prompt is a string but not valid JSON"); }
    }
    if (workflow == null || typeof workflow !== "object" || Array.isArray(workflow)) {
      throw new Error("prompt must be an object mapping node ids -> node objects");
    }
  
    // Minimal schema sanity: every node must be an object with class_type
    for (const [k, v] of Object.entries(workflow)) {
      if (!v || typeof v !== "object" || Array.isArray(v)) {
        throw new Error(`node ${k} is not an object`);
      }
      if (!("class_type" in v)) {
        throw new Error(`node ${k} missing class_type`);
      }
    }
    return workflow;
  }