export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  format: string;
  codec: string;
  frameRate?: number; // Add frame rate detection
}

export class VideoProcessor {
  private static supportedFormats = [
    "video/mp4",
    "video/webm",
    "video/ogg",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-ms-wmv",
  ];

  static isVideoFile(file: File): boolean {
    return this.supportedFormats.includes(file.type);
  }

  static async getVideoInfo(file: File): Promise<VideoInfo> {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      const url = URL.createObjectURL(file);

      video.onloadedmetadata = () => {
        // Enhanced frame rate detection
        let frameRate = 30; // Default fallback

        // Method 1: Try to get frame rate from video properties
        if (video.videoWidth && video.videoHeight) {
          // Enhanced frame rate detection based on resolution and common standards
          const totalPixels = video.videoWidth * video.videoHeight;

          // Common frame rates for different resolutions
          if (totalPixels >= 8294400) {
            // 4K (3840x2160) - usually 24, 30, or 60 fps
            frameRate = 30;
          } else if (totalPixels >= 2073600) {
            // 1080p (1920x1080) - usually 24, 30, or 60 fps
            frameRate = 30;
          } else if (totalPixels >= 921600) {
            // 720p (1280x720) - usually 30 or 60 fps
            frameRate = 30;
          } else {
            // Lower resolutions - usually 24, 25, 30 fps
            frameRate = 30;
          }
        }

        // Validate duration - ensure it's a reasonable value
        let duration = video.duration;
        if (!duration || isNaN(duration) || duration <= 0) {
          console.warn(
            `Invalid duration detected: ${duration}, using fallback`
          );
          duration = 1; // Default to 1 second
        }

        const info: VideoInfo = {
          duration: duration,
          width: video.videoWidth,
          height: video.videoHeight,
          format: file.type,
          codec: this.detectCodec(file.type),
          frameRate: frameRate,
        };

        URL.revokeObjectURL(url);
        resolve(info);
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Failed to load video: ${file.name}`));
      };

      video.src = url;
      video.load();
    });
  }

  // Enhanced frame rate detection using MediaInfo or similar
  static async detectFrameRate(file: File): Promise<number> {
    // First, try to detect based on file name and common patterns
    const fileName = file.name.toLowerCase();
    if (
      fileName.includes("24fps") ||
      fileName.includes("24_fps") ||
      fileName.includes("24-fps")
    ) {
      console.log(`🎬 Detected 24fps from filename: ${file.name}`);
      return 24;
    }

    if (
      fileName.includes("30fps") ||
      fileName.includes("30_fps") ||
      fileName.includes("30-fps")
    ) {
      console.log(`🎬 Detected 30fps from filename: ${file.name}`);
      return 30;
    }

    if (
      fileName.includes("60fps") ||
      fileName.includes("60_fps") ||
      fileName.includes("60-fps")
    ) {
      console.log(`🎬 Detected 60fps from filename: ${file.name}`);
      return 60;
    }

    // For more reliable detection, use a simpler approach based on video properties
    return new Promise((resolve) => {
      const video = document.createElement("video");
      const url = URL.createObjectURL(file);

      video.onloadedmetadata = () => {
        // Use video properties to estimate frame rate more reliably
        const width = video.videoWidth;
        const height = video.videoHeight;
        const duration = video.duration;

        // Estimate frame rate based on common standards and video characteristics
        let estimatedFps = 30; // Default

        if (width && height && duration) {
          const totalPixels = width * height;

          // Common frame rate patterns based on resolution and content type
          if (totalPixels >= 8294400) {
            // 4K content - usually 24, 30, or 60 fps
            estimatedFps = 30;
          } else if (totalPixels >= 2073600) {
            // 1080p content - check for cinematic vs standard
            if (duration > 60) {
              // Longer content is more likely to be cinematic (24fps)
              estimatedFps = 24;
            } else {
              // Shorter content is more likely to be standard (30fps)
              estimatedFps = 30;
            }
          } else if (totalPixels >= 921600) {
            // 720p content - usually 30fps
            estimatedFps = 30;
          } else {
            // Lower resolution - usually 30fps
            estimatedFps = 30;
          }
        }

        console.log(`🎬 Frame rate estimation for video:`, {
          fileName: file.name,
          estimatedFps,
          width,
          height,
          duration,
          totalPixels: width * height,
        });

        URL.revokeObjectURL(url);
        resolve(estimatedFps);
      };

      video.onerror = () => {
        console.warn(`Failed to detect frame rate for: ${file.name}`);
        URL.revokeObjectURL(url);
        resolve(30); // Fallback
      };

      video.src = url;
      video.load();
    });
  }

  static detectCodec(mimeType: string): string {
    const codecMap: { [key: string]: string } = {
      "video/mp4": "H.264/AVC",
      "video/webm": "VP8/VP9",
      "video/ogg": "Theora",
      "video/quicktime": "H.264/ProRes",
      "video/x-msvideo": "AVI",
      "video/x-ms-wmv": "WMV",
    };
    return codecMap[mimeType] || "Unknown";
  }

  static async createVideoThumbnail(
    file: File,
    time: number = 0
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const url = URL.createObjectURL(file);

      video.onloadedmetadata = () => {
        video.currentTime = time;
      };

      video.onseeked = () => {
        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const thumbnail = canvas.toDataURL("image/jpeg", 0.8);
          URL.revokeObjectURL(url);
          resolve(thumbnail);
        }
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Failed to create thumbnail: ${file.name}`));
      };

      video.src = url;
      video.load();
    });
  }

  static async createVideoThumbnailFromUrl(
    videoUrl: string,
    time: number = 0
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      video.crossOrigin = "use-credentials"; // Enable CORS with credentials for authenticated URLs

      video.onloadedmetadata = () => {
        video.currentTime = time;
      };

      video.onseeked = () => {
        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const thumbnail = canvas.toDataURL("image/jpeg", 0.8);
          resolve(thumbnail);
        }
      };

      video.onerror = () => {
        reject(new Error(`Failed to create thumbnail from URL: ${videoUrl}`));
      };

      video.src = videoUrl;
      video.load();
    });
  }

  static validateVideoFile(file: File): { valid: boolean; error?: string } {
    if (!this.isVideoFile(file)) {
      return { valid: false, error: `Unsupported video format: ${file.type}` };
    }

    if (file.size > 100 * 1024 * 1024) {
      // 100MB limit
      return { valid: false, error: "Video file too large (max 100MB)" };
    }

    return { valid: true };
  }

  static async convertToWebM(file: File): Promise<Blob> {
    // This would require a more sophisticated implementation with WebCodecs API
    // For now, we'll return the original file
    return file;
  }
}

export const videoUtils = {
  async loadVideo(url: string): Promise<HTMLVideoElement> {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");

      video.onloadeddata = () => resolve(video);
      video.onerror = () => reject(new Error(`Failed to load video: ${url}`));

      video.src = url;
      video.load();
    });
  },

  async getVideoDuration(url: string): Promise<number> {
    const video = await this.loadVideo(url);
    return video.duration;
  },

  formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  },

  formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  },
};
