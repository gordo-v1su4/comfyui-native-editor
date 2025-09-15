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

export class NodeRenderer {
  private serverUrl: string;

  constructor(serverUrl?: string) {
    this.serverUrl =
      serverUrl ||
      import.meta.env.VITE_API_BASE_URL ||
      import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
      window.location.origin ||
      "http://localhost:3001";
  }

  async renderVideo(
    timelineData: TimelineData,
    options: RenderOptions
  ): Promise<Blob> {
    console.log("Starting Node.js video render...", {
      timelineData,
      options,
    });

    try {
      options.onProgress?.(10, "Preparing timeline data...");

      // Prepare the export data with video files
      const exportData: any = {
        tracks: timelineData.tracks,
        durationInFrames: timelineData.durationInFrames,
        fps: timelineData.fps,
        width: timelineData.width,
        height: timelineData.height,
        format: options.format,
        filename: options.filename,
        quality: options.quality || "medium",
        videoFiles: {} as Record<string, string>, // Will store base64 video data
      };

      // Convert video blob URLs to base64 data
      console.log("Converting video files to base64...");
      for (const track of timelineData.tracks) {
        for (const item of track.items) {
          if (item.type === "video") {
            try {
              // Fetch the video blob from the URL
              const videoResponse = await fetch(item.src);
              const videoBlob = await videoResponse.blob();

              // Convert to base64
              const reader = new FileReader();
              const base64Promise = new Promise<string>((resolve) => {
                reader.onload = () => resolve(reader.result as string);
              });
              reader.readAsDataURL(videoBlob);

              const base64Data = await base64Promise;
              exportData.videoFiles[item.id] = base64Data;

              console.log(
                `Converted video ${item.id} to base64 (${Math.round(
                  base64Data.length / 1024
                )}KB)`
              );
            } catch (error) {
              console.error(`Failed to convert video ${item.id}:`, error);
            }
          }
        }
      }

      console.log("🚀 Sending export data to server:", {
        fps: timelineData.fps,
        durationInFrames: timelineData.durationInFrames,
        tracks: timelineData.tracks.length,
      });

      options.onProgress?.(20, "Sending data to Node.js server...");

      // Send the data to the Node.js server for rendering
      const authToken = localStorage.getItem("authToken");
      const response = await fetch(`${this.serverUrl}/api/render-video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify(exportData),
      });

      // Handle different response formats
      if (response.status === 202) {
        // Queued response - handle async export
        const queuedResponse = await response.json();
        console.log("Export queued:", queuedResponse);

        if (queuedResponse.ok && queuedResponse.exportId) {
          return await this.handleQueuedExport(
            queuedResponse.exportId,
            options
          );
        } else {
          throw new Error("Invalid queued response format");
        }
      } else if (response.status === 200) {
        // Immediate video blob response
        options.onProgress?.(80, "Downloading rendered video...");

        // Get the video blob from the response
        const videoBlob = await response.blob();

        // Validate the blob
        if (!videoBlob || videoBlob.size === 0) {
          throw new Error("Received empty video blob from server");
        }

        console.log("Video blob received:", {
          size: videoBlob.size,
          type: videoBlob.type,
        });

        options.onProgress?.(100, "Export complete!");
        return videoBlob;
      } else {
        // Error response
        const errorText = await response.text();
        throw new Error(`Server error: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.error("Node.js render error:", error);
      throw new Error(`Video rendering failed: ${error}`);
    }
  }

  // Handle queued export with progress tracking
  private async handleQueuedExport(
    exportId: string,
    options: RenderOptions
  ): Promise<Blob> {
    console.log(`Handling queued export: ${exportId}`);

    // Poll for progress and completion
    let attempts = 0;
    const maxAttempts = 300; // 5 minutes with 1-second intervals

    while (attempts < maxAttempts) {
      try {
        const authToken = localStorage.getItem("authToken");
        const progressResponse = await fetch(
          `${this.serverUrl}/api/render-progress/${exportId}`,
          {
            headers: {
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            },
            credentials: "include",
          }
        );

        if (!progressResponse.ok) {
          throw new Error(`Progress check failed: ${progressResponse.status}`);
        }

        const progressData = await progressResponse.json();
        console.log("Export progress:", progressData);

        // Update progress
        if (progressData.progress !== undefined) {
          const progress = Math.min(90, 20 + progressData.progress * 0.7);
          options.onProgress?.(
            progress,
            progressData.status || "Processing..."
          );
        }

        // Check if export is complete (support both "completed" and "done")
        const isCompleted =
          progressData.status === "completed" || progressData.status === "done";
        const downloadUrl = progressData.downloadUrl || progressData.resultUrl;
        if (isCompleted && downloadUrl) {
          options.onProgress?.(95, "Downloading completed video...");

          // Download the completed video
          const authToken = localStorage.getItem("authToken");
          const videoResponse = await fetch(downloadUrl, {
            headers: {
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            },
            credentials: "include",
          });
          if (!videoResponse.ok) {
            throw new Error(
              `Failed to download video: ${videoResponse.status}`
            );
          }

          const videoBlob = await videoResponse.blob();
          options.onProgress?.(100, "Export complete!");
          return videoBlob;
        }

        // Check for errors
        if (
          progressData.status === "failed" ||
          progressData.status === "error"
        ) {
          throw new Error(
            `Export failed: ${progressData.error || "Unknown error"}`
          );
        }

        // Wait before next check
        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempts++;
      } catch (error) {
        console.error("Progress check error:", error);
        attempts++;

        if (attempts >= maxAttempts) {
          throw new Error("Export timed out");
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    throw new Error("Export timed out after maximum attempts");
  }

  // Alternative method for server-side rendering with progress tracking
  async renderVideoWithProgress(
    timelineData: TimelineData,
    options: RenderOptions
  ): Promise<Blob> {
    console.log("Starting Node.js video render with progress tracking...");

    try {
      options.onProgress?.(10, "Preparing timeline data...");

      // First, send the timeline data to the server
      const initResponse = await fetch(`${this.serverUrl}/api/init-render`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tracks: timelineData.tracks,
          durationInFrames: timelineData.durationInFrames,
          fps: timelineData.fps,
          width: timelineData.width,
          height: timelineData.height,
          format: options.format,
          filename: options.filename,
          quality: options.quality || "medium",
        }),
      });

      if (!initResponse.ok) {
        const errorText = await initResponse.text();
        throw new Error(`Server error: ${initResponse.status} - ${errorText}`);
      }

      const { renderId } = await initResponse.json();

      options.onProgress?.(20, "Starting video rendering...");

      // Poll for progress
      let progress = 20;
      const progressInterval = setInterval(async () => {
        try {
          const progressResponse = await fetch(
            `${this.serverUrl}/api/render-progress/${renderId}`
          );

          if (progressResponse.ok) {
            const progressData = await progressResponse.json();
            progress = Math.min(90, 20 + progressData.progress * 0.7);
            options.onProgress?.(progress, progressData.status);

            if (progressData.completed) {
              clearInterval(progressInterval);
            }
          }
        } catch (error) {
          console.warn("Progress polling error:", error);
        }
      }, 1000);

      // Wait for completion
      const completionResponse = await fetch(
        `${this.serverUrl}/api/render-complete/${renderId}`
      );

      clearInterval(progressInterval);

      if (!completionResponse.ok) {
        const errorText = await completionResponse.text();
        throw new Error(
          `Render completion error: ${completionResponse.status} - ${errorText}`
        );
      }

      options.onProgress?.(95, "Downloading rendered video...");

      // Download the completed video
      const videoResponse = await fetch(
        `${this.serverUrl}/api/download-video/${renderId}`
      );

      if (!videoResponse.ok) {
        const errorText = await videoResponse.text();
        throw new Error(
          `Download error: ${videoResponse.status} - ${errorText}`
        );
      }

      const videoBlob = await videoResponse.blob();

      options.onProgress?.(100, "Export complete!");
      return videoBlob;
    } catch (error) {
      console.error("Node.js render error:", error);
      throw new Error(`Video rendering failed: ${error}`);
    }
  }
}
