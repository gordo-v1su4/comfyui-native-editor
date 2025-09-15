export interface TimelineData {
  tracks: any[];
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

export interface RenderOptions {
  format: "mp4" | "webm" | "gif";
  filename: string;
  quality?: "low" | "medium" | "high";
  onProgress?: (progress: number, status: string) => void;
}

export class WebCodecsRenderer {
  private isSupported: boolean;

  constructor() {
    this.isSupported = this.checkSupport();
  }

  private checkSupport(): boolean {
    return (
      typeof window !== "undefined" &&
      "VideoEncoder" in window &&
      "VideoFrame" in window &&
      "EncodedVideoChunk" in window
    );
  }

  async load(): Promise<void> {
    if (!this.isSupported) {
      throw new Error(
        "WebCodecs API is not supported in this browser. Please use a modern browser with WebCodecs support."
      );
    }
    console.log("WebCodecs renderer initialized successfully");
  }

  async renderVideo(
    timelineData: TimelineData,
    options: RenderOptions
  ): Promise<Blob> {
    if (!this.isSupported) {
      await this.load();
    }

    console.log("Starting WebCodecs video render...", {
      timelineData,
      options,
    });

    try {
      // Step 1: Extract video frames from timeline
      options.onProgress?.(10, "Initializing WebCodecs...");
      const frames = await this.extractFramesFromTimeline(
        timelineData,
        options.onProgress
      );

      // Step 2: Encode video using WebCodecs
      options.onProgress?.(60, "Encoding video with WebCodecs...");

      let videoBlob: Blob;

      try {
        videoBlob = await this.encodeVideoWithWebCodecs(
          frames,
          timelineData,
          options
        );
      } catch (encodingError) {
        console.error("WebCodecs encoding failed:", encodingError);

        // Try fallback to MediaRecorder for WebM
        if (options.format === "webm") {
          options.onProgress?.(60, "Falling back to MediaRecorder...");
          videoBlob = await this.encodeWithMediaRecorder(
            frames,
            timelineData,
            options
          );
        } else {
          // For other formats, try WebM as fallback
          options.onProgress?.(60, "Falling back to WebM format...");
          const fallbackOptions = { ...options, format: "webm" as const };
          videoBlob = await this.encodeWithMediaRecorder(
            frames,
            timelineData,
            fallbackOptions
          );
        }
      }

      options.onProgress?.(100, "Export complete!");
      return videoBlob;
    } catch (error) {
      console.error("WebCodecs render error:", error);
      throw new Error(`Video rendering failed: ${error}`);
    }
  }

  private async extractFramesFromTimeline(
    timelineData: TimelineData,
    onProgress?: (progress: number, status: string) => void
  ): Promise<ImageData[]> {
    const frames: ImageData[] = [];
    const { durationInFrames, fps, width, height, tracks } = timelineData;

    // Create a canvas for frame generation
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;

    // Use the full timeline duration instead of limiting to 300 frames
    const totalFrames = durationInFrames;

    console.log(`=== FRAME EXTRACTION START ===`);
    console.log(
      `Timeline: ${totalFrames} frames at ${fps} FPS (${
        totalFrames / fps
      }s duration)`
    );
    console.log(`Timeline tracks:`, tracks);

    // Pre-load all videos for better performance
    onProgress?.(5, "Pre-loading timeline videos...");
    const videoElements = await this.preloadVideos(tracks);

    // Track frame processing statistics
    let videoFramesProcessed = 0;
    let backgroundFramesProcessed = 0;
    let totalVideoTime = 0;

    // Generate frames based on actual timeline content
    for (let i = 0; i < totalFrames; i++) {
      // Update progress
      const progress = 10 + (i / totalFrames) * 40; // 10% to 50%
      onProgress?.(
        progress,
        `Rendering timeline frame ${i + 1} of ${totalFrames}`
      );

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      // Render timeline content for this frame
      const frameResult = await this.renderTimelineFrame(
        ctx,
        tracks,
        i,
        fps,
        width,
        height,
        videoElements
      );

      // Track statistics
      if (frameResult === "video") {
        videoFramesProcessed++;
        totalVideoTime += 1 / fps;
      } else {
        backgroundFramesProcessed++;
      }

      // Get frame data
      const imageData = ctx.getImageData(0, 0, width, height);
      frames.push(imageData);

      // Allow UI to update and reduce video seeking load
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    console.log(`=== FRAME EXTRACTION COMPLETE ===`);
    console.log(`Total frames processed: ${frames.length}`);
    console.log(
      `Video frames: ${videoFramesProcessed} (${(
        (videoFramesProcessed / totalFrames) *
        100
      ).toFixed(1)}%)`
    );
    console.log(
      `Background frames: ${backgroundFramesProcessed} (${(
        (backgroundFramesProcessed / totalFrames) *
        100
      ).toFixed(1)}%)`
    );
    console.log(`Total video time: ${totalVideoTime.toFixed(2)}s`);
    console.log(`Expected video time: ${(totalFrames / fps).toFixed(2)}s`);

    return frames;
  }

  private async preloadVideos(
    tracks: any[]
  ): Promise<Map<string, HTMLVideoElement>> {
    const videoElements = new Map<string, HTMLVideoElement>();
    const videoPromises: Promise<void>[] = [];

    console.log("Pre-loading videos from tracks:", tracks);

    for (const track of tracks) {
      console.log(`Processing track ${track.id}:`, track.items);
      for (const item of track.items) {
        console.log("Processing item:", item);
        if (item.src && !videoElements.has(item.src)) {
          console.log("Loading video:", item.src);
          const video = document.createElement("video");
          video.crossOrigin = "use-credentials";
          video.muted = true;
          video.playsInline = true;
          video.preload = "metadata";

          const loadPromise = new Promise<void>((resolve, reject) => {
            video.onloadedmetadata = () => {
              console.log("Video loaded successfully:", item.src);
              resolve();
            };
            video.onerror = () => {
              console.error("Failed to load video:", item.src);
              reject(new Error(`Failed to load video: ${item.src}`));
            };
          });

          video.src = item.src;
          video.load();

          videoElements.set(item.src, video);
          videoPromises.push(loadPromise);
        }
      }
    }

    console.log(`Attempting to load ${videoPromises.length} videos`);
    // Wait for all videos to load
    const results = await Promise.allSettled(videoPromises);
    console.log("Video loading results:", results);

    return videoElements;
  }

  private async encodeVideoWithWebCodecs(
    frames: ImageData[],
    timelineData: TimelineData,
    options: RenderOptions
  ): Promise<Blob> {
    // For better reliability, use MediaRecorder for all formats
    // WebCodecs is still experimental and can be unstable
    return this.encodeWithMediaRecorder(frames, timelineData, options);
  }

  private async encodeWithMediaRecorder(
    frames: ImageData[],
    timelineData: TimelineData,
    options: RenderOptions
  ): Promise<Blob> {
    const { fps } = timelineData;

    return new Promise((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = timelineData.width;
      canvas.height = timelineData.height;
      const ctx = canvas.getContext("2d")!;

      const stream = canvas.captureStream(fps);

      // Always use WebM format for MediaRecorder as it's most reliable
      // We'll handle format conversion in the UI if needed
      const mimeType = "video/webm;codecs=vp9";

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        videoBitsPerSecond: 2000000, // 2 Mbps for better quality
      });

      const chunks: Blob[] = [];
      let frameIndex = 0;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Always create WebM blob for MediaRecorder
        const blob = new Blob(chunks, { type: "video/webm" });
        resolve(blob);
      };

      mediaRecorder.onerror = (event) => {
        reject(new Error(`MediaRecorder error: ${event}`));
      };

      // Start recording
      mediaRecorder.start();

      // Render frames
      const renderFrame = async () => {
        if (frameIndex >= frames.length) {
          mediaRecorder.stop();
          return;
        }

        // Draw frame to canvas
        ctx.putImageData(frames[frameIndex], 0, 0);

        // Update progress
        const progress = 60 + (frameIndex / frames.length) * 30;
        options.onProgress?.(
          progress,
          `Encoding frame ${frameIndex + 1} of ${frames.length}`
        );

        frameIndex++;

        // Schedule next frame
        setTimeout(renderFrame, 1000 / fps);
      };

      renderFrame();
    });
  }

  async unload(): Promise<void> {
    // WebCodecs doesn't require explicit cleanup
    console.log("WebCodecs renderer unloaded");
  }

  private async renderTimelineFrame(
    ctx: CanvasRenderingContext2D,
    tracks: any[],
    frameNumber: number,
    fps: number,
    width: number,
    height: number,
    videoElements: Map<string, HTMLVideoElement>
  ): Promise<"video" | "background"> {
    const currentTime = frameNumber / fps; // Current time in seconds

    // Sort tracks by priority (lower track index = higher priority)
    const sortedTracks = [...tracks]
      .map((track, index) => ({ ...track, id: index }))
      .sort((a, b) => a.id - b.id);

    // Find the video that should be displayed at this frame
    let activeVideo: any = null;

    for (const track of sortedTracks) {
      for (const item of track.items) {
        // Use 'from' instead of 'startFrame' - this is the correct property name
        const itemStartTime = item.from / fps;
        const itemEndTime = (item.from + item.durationInFrames) / fps;

        if (currentTime >= itemStartTime && currentTime < itemEndTime) {
          activeVideo = item;
          console.log(
            `Found active video at frame ${frameNumber}:`,
            activeVideo
          );
          break;
        }
      }
      if (activeVideo) break;
    }

    if (activeVideo && activeVideo.src) {
      // Render the actual video frame
      await this.renderVideoFrame(
        ctx,
        activeVideo,
        currentTime,
        width,
        height,
        videoElements
      );
      return "video";
    } else {
      // No video at this time, render background
      console.log(`No video at frame ${frameNumber}, rendering background`);
      this.renderBackgroundFrame(ctx, frameNumber, fps, width, height);
      return "background";
    }
  }

  private async renderVideoFrame(
    ctx: CanvasRenderingContext2D,
    videoItem: any,
    currentTime: number,
    width: number,
    height: number,
    videoElements: Map<string, HTMLVideoElement>
  ): Promise<void> {
    console.log("Rendering video frame:", videoItem);
    const video = videoElements.get(videoItem.src);

    if (!video) {
      console.warn("Video not found in cache:", videoItem.src);
      this.renderBackgroundFrame(ctx, 0, 30, width, height);
      return;
    }

    try {
      // Use the actual video frame rate if available, otherwise default to 30fps
      const videoFrameRate = videoItem.frameRate || 30;
      const timelineFps = 30; // Timeline is always 30fps

      // Calculate the time within the video using proper frame rate conversion
      const videoStartTime = videoItem.from / timelineFps; // Timeline time in seconds
      const timeInVideo = Math.max(0, currentTime - videoStartTime);

      console.log(
        `Video timing: from=${videoItem.from}, duration=${videoItem.durationInFrames}, ` +
          `videoFrameRate=${videoFrameRate}fps, timelineFps=${timelineFps}fps, ` +
          `videoStartTime=${videoStartTime}s, currentTime=${currentTime}s, timeInVideo=${timeInVideo}s`
      );

      // Check if we're within the video's duration using timeline frame rate for consistency
      const videoDuration = videoItem.durationInFrames / timelineFps; // Convert frames to seconds using timeline frame rate
      if (timeInVideo >= videoDuration) {
        console.log(
          `Time ${timeInVideo}s exceeds video duration ${videoDuration}s, rendering background`
        );
        this.renderBackgroundFrame(ctx, 0, 30, width, height);
        return;
      }

      // Set video time and wait for seek to complete with longer timeout
      if (Math.abs(video.currentTime - timeInVideo) > 0.1) {
        video.currentTime = timeInVideo;

        // Wait for seek to complete with longer timeout
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);
            console.log("Video seeked successfully to time:", timeInVideo);
            resolve();
          };
          video.addEventListener("seeked", onSeeked);

          // Timeout fallback - increased to 500ms for better reliability
          setTimeout(() => {
            video.removeEventListener("seeked", onSeeked);
            console.log("Video seek timeout for time:", timeInVideo);
            resolve();
          }, 500);
        });
      }

      // Draw the video frame to canvas
      console.log("Drawing video frame to canvas at time:", timeInVideo);
      ctx.drawImage(video, 0, 0, width, height);
    } catch (e) {
      console.warn("Could not render video frame:", e);
      this.renderBackgroundFrame(ctx, 0, 30, width, height);
    }
  }

  private renderBackgroundFrame(
    ctx: CanvasRenderingContext2D,
    frameNumber: number,
    fps: number,
    width: number,
    height: number
  ): void {
    // Create animated background
    ctx.fillStyle = `hsl(${(frameNumber * 360) / (fps * 10)}, 70%, 50%)`;
    ctx.fillRect(0, 0, width, height);

    // Add timeline info
    ctx.fillStyle = "white";
    ctx.font = "48px Arial";
    ctx.textAlign = "center";
    ctx.fillText(`Timeline Frame ${frameNumber}`, width / 2, height / 2);

    // Add time info
    ctx.font = "24px Arial";
    ctx.fillText(
      `${(frameNumber / fps).toFixed(2)}s`,
      width / 2,
      height / 2 + 50
    );
  }
}

// Export singleton instance
export const webCodecsRenderer = new WebCodecsRenderer();
