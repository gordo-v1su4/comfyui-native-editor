// Global type for Vercel Analytics custom events in browser
declare global {
  interface Window {
    va?: (event: string, data?: Record<string, any>) => void;
  }
}

export {};

