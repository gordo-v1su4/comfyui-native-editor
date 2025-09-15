import React, { useEffect, useRef } from 'react';
import { useVideoProgress } from '../contexts/VideoProgressContext';

export const GlobalVideoProgressOverlay: React.FC = () => {
  const { progressState, updateProgress, completeGeneration } = useVideoProgress();
  const queueClearedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!progressState.isGenerating || !progressState.startTime) return;

    // Track actual media imports to delay completion until clips are available
    let socket: any | null = null;
    try {
      const { wsAPI } = require('../api.js');
      socket = wsAPI.getSocket && wsAPI.getSocket();
      if (!socket && wsAPI.connect && progressState.projectId) {
        socket = wsAPI.connect(progressState.projectId);
      }
      if (socket && progressState.projectId) {
        const handler = (data: any) => {
          if (data?.projectId === progressState.projectId) {
            // Increment imported count defensively to avoid stale closures
            const current = Number(progressState.importedCount || 0);
            const expected = Number(progressState.expectedCount || 0);
            const next = Math.min(current + 1, expected || current + 1);
            updateProgress({ importedCount: next });
          }
        };
        socket.on('media:new', handler);
      }
    } catch {}

    const interval = setInterval(async () => {
      try {
        // Try to get real progress from Modal app first
        const modalEndpoint = progressState.modalEndpoint;
        if (modalEndpoint) {
          try {
            console.log(`[PROGRESS] Fetching real progress from: ${modalEndpoint}/progress-status`);
            const response = await fetch(`${modalEndpoint}/progress-status`);
            if (response.ok) {
              const modalData = await response.json();
              console.log('[PROGRESS] Real Modal data:', modalData);
              
              // Use real Modal WebSocket progress data
            const overallProgress = modalData.overall_progress || 0;
            const queuePending = modalData.queue_pending || 0;
            const queueRunning = modalData.queue_running || 0;
            const jobDetails = modalData.job_details || [];
              
              // Calculate progress based on actual WebSocket data
              const totalJobs = progressState.shots.length;
              const completedJobs = Math.max(0, totalJobs - queuePending - queueRunning);
              const realProgress = modalData.websocket_progress ? overallProgress : 
                (totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0);
              
              // Update shots based on real progress and WebSocket data
              const updatedShots = progressState.shots.map((shot, index) => {
                if (index < completedJobs) {
                  return { ...shot, status: 'completed' as const, progress: 100 };
                } else if (index < completedJobs + queueRunning) {
                  // Use real WebSocket progress if available
                  const jobDetail = jobDetails[index - completedJobs];
                  const realProgress = jobDetail ? jobDetail.progress_percent : 50;
                  return { ...shot, status: 'processing' as const, progress: Math.round(realProgress) };
                } else {
                  return { ...shot, status: 'pending' as const, progress: 0 };
                }
              });
              
              // Calculate realistic time remaining
              const avgTimePerShot = 40; // 40 seconds average
              const remainingJobs = queuePending + queueRunning;
              const estimatedSeconds = remainingJobs * avgTimePerShot;
              const minutes = Math.floor(estimatedSeconds / 60);
              const seconds = estimatedSeconds % 60;
              const estimatedRemaining = estimatedSeconds > 0 ? 
                (minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`) : 
                'Almost done!';
              
              updateProgress({
                shots: updatedShots,
                // Cap at 99% until completion criteria satisfied
                overallProgress: Math.min(99, realProgress),
                estimatedRemaining,
              });

              const allImported = (progressState.expectedCount || 0) > 0 && (progressState.importedCount || 0) >= (progressState.expectedCount || 0);

              // Gracefully wait for uploads/imports after queue drains
              const queueZero = (queuePending === 0 && queueRunning === 0);
              if (!queueZero) {
                queueClearedAtRef.current = null;
              } else if (queueClearedAtRef.current == null) {
                queueClearedAtRef.current = Date.now();
              }

              const graceSatisfied = queueClearedAtRef.current != null && (Date.now() - queueClearedAtRef.current) > 45000; // 45s grace

              if (queueZero && (allImported || graceSatisfied)) {
                console.log('Video generation completed (queue empty and imports satisfied).');
                completeGeneration();
                clearInterval(interval);
              }
              
              return; // Successfully used real data
            }
          } catch (modalError) {
            console.warn('Modal progress check failed, falling back to time-based:', modalError);
          }
        }
        
        // Fallback: Time-based simulation with accurate timing
        const elapsed = Date.now() - progressState.startTime!;
        const expectedDuration = progressState.shots.length * 45000; // include upload/import time
        const timeProgress = Math.min(90, (elapsed / expectedDuration) * 100);
        
        const completedShotsCount = Math.floor((timeProgress / 100) * progressState.shots.length);
        
        const updatedShots = progressState.shots.map((shot, index) => {
          if (index < completedShotsCount) {
            return { ...shot, status: 'completed' as const, progress: 100 };
          } else if (index === completedShotsCount) {
            return { ...shot, status: 'processing' as const, progress: Math.floor(timeProgress % (100 / progressState.shots.length) * progressState.shots.length) };
          } else {
            return { ...shot, status: 'pending' as const, progress: 0 };
          }
        });

        const remainingTime = Math.max(0, expectedDuration - elapsed);
        const minutes = Math.floor(remainingTime / 60000);
        const seconds = Math.floor((remainingTime % 60000) / 1000);
        const estimatedRemaining = remainingTime > 0 ? 
          (minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`) : 
          'Almost done!';

        updateProgress({
          shots: updatedShots,
          overallProgress: timeProgress,
          estimatedRemaining,
        });

        const allImported = (progressState.expectedCount || 0) > 0 && (progressState.importedCount || 0) >= (progressState.expectedCount || 0);
        if (elapsed > expectedDuration + 60000 || allImported) {
          completeGeneration();
          clearInterval(interval);
        }
        
      } catch (error) {
        console.error('Progress update error:', error);
      }
    }, 3000); // Update every 3 seconds for less aggressive polling

    return () => clearInterval(interval);
  }, [progressState.isGenerating, progressState.startTime, progressState.shots.length]);

  if (!progressState.isGenerating) return null;

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const completedShots = progressState.shots.filter(s => s.status === 'completed').length;

  return (
    <div style={{
      position: 'fixed', 
      top: 0, 
      left: 0, 
      width: '100%', 
      height: '100%',
      backgroundColor: 'rgba(0,0,0,0.8)', 
      color: 'white', 
      zIndex: 9999,
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      flexDirection: 'column', 
      padding: '20px',
    }}>
      <div style={{
        backgroundColor: '#222', 
        borderRadius: '10px', 
        padding: '30px',
        width: '90%', 
        maxWidth: '600px', 
        boxShadow: '0 0 20px rgba(0,0,0,0.5)',
      }}>
        <h2 style={{ 
          textAlign: 'center', 
          marginBottom: '20px', 
          color: '#4CAF50',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px'
        }}>
          🎬 Video Generation Progress
          <span style={{ 
            fontSize: '12px', 
            backgroundColor: '#333', 
            padding: '4px 8px', 
            borderRadius: '4px' 
          }}>
            Persists across views
          </span>
        </h2>
        
        {progressState.groupId && (
          <p style={{ fontSize: '14px', marginBottom: '15px', textAlign: 'center' }}>
            Group ID: {progressState.groupId}
          </p>
        )}

        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '16px', marginBottom: '10px' }}>Overall Progress</h3>
          <div style={{ 
            backgroundColor: '#444', 
            height: '15px', 
            borderRadius: '8px', 
            overflow: 'hidden' 
          }}>
            <div style={{
              width: `${progressState.overallProgress}%`, 
              height: '100%', 
              backgroundColor: '#4CAF50',
              transition: 'width 0.5s ease-in-out',
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              fontSize: '10px', 
              fontWeight: 'bold',
            }}>
              {Math.round(progressState.overallProgress)}%
            </div>
          </div>
          <p style={{ textAlign: 'right', fontSize: '12px', marginTop: '5px' }}>
            ⏱️ {progressState.estimatedRemaining} remaining
          </p>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '16px', marginBottom: '10px' }}>
            Shot Progress ({completedShots}/{progressState.shots.length})
          </h3>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', 
            gap: '10px' 
          }}>
            {progressState.shots.map((shot, idx) => (
              <div key={idx} style={{
                backgroundColor: '#333', 
                borderRadius: '8px', 
                padding: '10px',
                border: `1px solid ${
                  shot.status === 'completed' ? '#4CAF50' :
                  shot.status === 'processing' ? '#FFC107' :
                  shot.status === 'failed' ? '#F44336' : '#666'
                }`,
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center',
                fontSize: '12px',
              }}>
                <span style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                  Shot {shot.index}
                </span>
                <span style={{ fontSize: '10px', color: '#BBB' }}>
                  {shot.length} frames
                </span>
                <div style={{
                  width: '100%', 
                  height: '5px', 
                  backgroundColor: '#555', 
                  borderRadius: '2px',
                  marginTop: '5px',
                }}>
                  <div style={{
                    width: `${shot.progress || 0}%`, 
                    height: '100%', 
                    backgroundColor:
                      shot.status === 'completed' ? '#4CAF50' :
                      shot.status === 'processing' ? '#FFC107' : '#F44336',
                    borderRadius: '2px', 
                    transition: 'width 0.3s',
                  }} />
                </div>
                <span style={{ 
                  marginTop: '5px', 
                  color:
                    shot.status === 'completed' ? '#4CAF50' :
                    shot.status === 'processing' ? '#FFC107' :
                    shot.status === 'failed' ? '#F44336' : '#BBB'
                }}>
                  {shot.status === 'completed' ? '✓ Completed' :
                   shot.status === 'processing' ? `⟳ Processing (${shot.progress || 0}%)` :
                   shot.status === 'failed' ? '✗ Failed' : '○ Pending'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ fontSize: '12px', color: '#BBB', textAlign: 'center' }}>
          <p>⏱️ Elapsed: {progressState.startTime ? formatTime(Date.now() - progressState.startTime) : '0s'}</p>
          <p>🚀 Speed: ~40s per shot • 2 tqdm cycles per video</p>
          <p>📊 Resolution: 512x384 @12fps • 8 sampling steps</p>
          <p>🔌 Real-time: ComfyUI WebSocket progress tracking</p>
          <p style={{ marginTop: '10px', color: '#4CAF50' }}>
            💡 You can navigate between Editor and Screenwriter - this progress will persist!
          </p>
        </div>
      </div>
    </div>
  );
};
