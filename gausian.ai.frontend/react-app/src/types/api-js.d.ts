// Minimal ambient types for the JS API client so TS stops complaining.
// Extend these as you add endpoints.

declare module "../api.js" {
  export const mediaAPI: {
    getByProject(projectId: string): Promise<{
      ok?: boolean;
      media?: any[];
      items?: any[];
      videoReferences?: any[];
    }>;
    getAllVideoReferences(): Promise<{
      ok?: boolean;
      items?: any[];
      media?: any[];
      videoReferences?: any[];
    }>;
    addMediaToProject(projectId: string, data: any): Promise<{ ok?: boolean }>;
  };
    // (Optional) add other APIs if you import them from TS files elsewhere:
    export const authAPI: any;
    export const projectAPI: any;
    export const videoGenerationAPI: any;
    export const wsAPI: any;
    export const api: any;
    const _default: any;
    export default _default;
}
