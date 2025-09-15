import React, { useEffect, useState } from "react";
import { wsAPI, videoGenerationAPI } from "../api.js";

interface GlobalVideoProgressProps {
  projectId: string | null;
}

interface ProgressData {
  jobId: string;
  projectId: string;
  status: string;
  totalShots: number;
  completedShots: number;
  failedShots: number;
  queuedShots: number;
  shots: any[];
  startTime: number;
  endTime?: number;
  progress: number;
}

const GlobalVideoProgress: React.FC<GlobalVideoProgressProps> = ({
  projectId,
}) => {
  const [activeJobs, setActiveJobs] = useState<Map<string, ProgressData>>(
    new Map()
  );
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!projectId) {
      console.log("❌ No projectId provided, skipping WebSocket connection");
      return;
    }

    console.log(`🔌 Attempting WebSocket connection for project: ${projectId}`);

    // Request notification permission (guard for mobile Safari lacking Notification)
    const notifSupported = typeof window !== 'undefined' && 'Notification' in window && typeof Notification !== 'undefined';
    if (notifSupported) {
      try {
        if (Notification.permission === "default") {
          Notification.requestPermission().catch(() => {});
        }
      } catch {}
    }

    // Initialize WebSocket connection
    const newSocket = wsAPI.connect(projectId);

    newSocket.on("connect", () => {
      console.log("🔌 Global WebSocket connected successfully");
      setIsConnected(true);
      // Join project-specific room
      newSocket.emit("join-project", projectId);
      console.log(`📁 Joining project room: ${projectId}`);
    });

    newSocket.on("connect_error", (error) => {
      console.error("❌ WebSocket connection error:", error);
      setIsConnected(false);
    });

    newSocket.on("disconnect", () => {
      console.log("🔌 Global WebSocket disconnected");
      setIsConnected(false);
    });

    newSocket.on("video-progress", (data: ProgressData) => {
      console.log("📊 Received progress update:", data);

      // Add job to active jobs
      setActiveJobs((prev) => {
        const newJobs = new Map(prev);

        if (data.status === "completed") {
          // Show completion notification
          if (notifSupported) {
            try {
              if (Notification.permission === "granted") {
                new Notification("Video Generation Complete!", {
                  body: `Successfully generated ${data.completedShots} videos from your screenplay.`,
                  icon: "/favicon.ico",
                });
              }
            } catch {}
          }

          // Remove completed jobs after a delay
          setTimeout(() => {
            setActiveJobs((current) => {
              const updated = new Map(current);
              updated.delete(data.jobId);
              return updated;
            });
          }, 5000); // Keep for 5 seconds to show completion
        } else {
          newJobs.set(data.jobId, data);
        }
        return newJobs;
      });
    });

    setSocket(newSocket);

    // Cleanup on unmount
    return () => {
      if (newSocket) {
        newSocket.emit("leave-project", projectId);
        newSocket.disconnect();
      }
    };
  }, [projectId]);

  // Don't show anything when no active jobs
  if (activeJobs.size === 0) {
    return null;
  }

  return (
    <div className="fixed top-20 right-4 z-50 space-y-2 max-w-sm">
      {Array.from(activeJobs.values()).map((job) => (
        <div
          key={job.jobId}
          className="bg-white border border-gray-200 rounded-lg p-4 shadow-lg"
        >
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-900">
              🎬 Video Generation
            </h4>
            <button
              onClick={async () => {
                try {
                  await videoGenerationAPI.pause(job.projectId, job.jobId);
                } catch (e) {
                  console.error("Failed to pause job", e);
                }
              }}
              className="text-xs bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
            >
              Pause & Close Modal
            </button>
          </div>

          {/* Progress Bar */}
          <div className="mb-3">
            <div className="flex justify-between text-xs text-gray-600 mb-1">
              <span>
                {job.status === "completed" ? "Complete" : "Generating..."}
              </span>
              <span>{job.progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${job.progress}%` }}
              ></div>
            </div>
          </div>

          {/* Statistics */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="text-center">
              <div className="text-lg font-bold text-blue-600">
                {job.totalShots}
              </div>
              <div className="text-xs text-gray-500">Total</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-green-600">
                {job.completedShots}
              </div>
              <div className="text-xs text-gray-500">Done</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-yellow-600">
                {job.queuedShots}
              </div>
              <div className="text-xs text-gray-500">Queue</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-red-600">
                {job.failedShots}
              </div>
              <div className="text-xs text-gray-500">Failed</div>
            </div>
          </div>

          {/* Status Messages */}
          {job.status === "completed" && (
            <div className="p-2 bg-green-50 border border-green-200 rounded text-xs">
              <div className="flex items-center">
                <span className="text-green-600 mr-1">✅</span>
                <span className="text-green-800">
                  All videos generated successfully!
                </span>
              </div>
            </div>
          )}

          {job.failedShots > 0 &&
            job.completedShots + job.failedShots === job.totalShots && (
              <div className="p-2 bg-red-50 border border-red-200 rounded text-xs">
                <div className="flex items-center">
                  <span className="text-red-600 mr-1">⚠️</span>
                  <span className="text-red-800">
                    {job.failedShots} failed, {job.completedShots} completed
                  </span>
                </div>
              </div>
            )}

          {/* Time Estimate */}
          {job.status !== "completed" && job.completedShots > 0 && (
            <div className="text-xs text-gray-600">
              ⏱️ ~
              {Math.round(
                (((Date.now() - job.startTime) / job.completedShots) *
                  (job.totalShots - job.completedShots)) /
                  1000 /
                  60
              )}
              m remaining
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default GlobalVideoProgress;
