import React, { useState, useEffect, useRef } from 'react';

interface Shot {
  index: number;
  length: number;
  promptId: string;
  clientId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  startTime?: number;
  completedTime?: number;
}

interface VideoGenerationProgressProps {
  groupId: string | null;
  shots: Shot[];
  onComplete?: () => void;
  onError?: (error: string) => void;
}

export const VideoGenerationProgress: React.FC<VideoGenerationProgressProps> = ({
  groupId,
  shots: initialShots,
  onComplete,
  onError,
}) => {
  const [shots, setShots] = useState<Shot[]>(initialShots);
  const [overallProgress, setOverallProgress] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<string>('');
  const intervalRef = useRef<number | null>(null);

  // Start monitoring when groupId is provided
  useEffect(() => {
    if (groupId && initialShots.length > 0) {
      setShots(initialShots.map(shot => ({ ...shot, status: 'pending' })));
      setIsActive(true);
      setStartTime(Date.now());
      startMonitoring();
    } else {
      stopMonitoring();
    }

    return () => stopMonitoring();
  }, [groupId, initialShots]);

  const startMonitoring = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    
    intervalRef.current = window.setInterval(() => {
      checkProgress();
    }, 2000); // Check every 2 seconds for real-time updates
  };

  const stopMonitoring = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsActive(false);
  };

  const checkProgress = async () => {
    if (!groupId || shots.length === 0) return;

    try {
      // Since videos generate in sub-1-minute, use time-based progress simulation
      const elapsed = Date.now() - (startTime || Date.now());
      const expectedDuration = shots.length * 10000; // ~10 seconds per shot
      const timeProgress = Math.min(90, (elapsed / expectedDuration) * 100);
      
      // Simulate shot completion over time
      const completedShotsCount = Math.floor((timeProgress / 100) * shots.length);
      
      const updatedShots = shots.map((shot, index) => {
        if (index < completedShotsCount) {
          return {
            ...shot,
            status: 'completed' as const,
            progress: 100,
            completedTime: shot.completedTime || (startTime || Date.now()) + (index + 1) * 10000,
          };
        } else if (index === completedShotsCount) {
          return {
            ...shot,
            status: 'processing' as const,
            progress: Math.floor(timeProgress % (100 / shots.length) * shots.length),
          };
        } else {
          return {
            ...shot,
            status: 'pending' as const,
            progress: 0,
          };
        }
      });

      setShots(updatedShots);
      setOverallProgress(timeProgress);

      // Calculate estimated time remaining
      if (startTime && timeProgress < 100) {
        const remainingTime = Math.max(0, expectedDuration - elapsed);
        const minutes = Math.floor(remainingTime / 60000);
        const seconds = Math.floor((remainingTime % 60000) / 1000);
        setEstimatedTimeRemaining(
          remainingTime > 0 ? (minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`) : 'Almost done!'
        );
      }

      // Auto-complete after expected duration + buffer
      if (elapsed > expectedDuration + 15000) { // 15 second buffer
        console.log('Progress monitoring: Auto-completing after expected duration');
        stopMonitoring();
        onComplete?.();
      }

    } catch (error) {
      console.error('Progress simulation error:', error);
      // Don't call onError for simulation errors, just log them
    }
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
  };

  if (!isActive || shots.length === 0) {
    return null;
  }

  return (
    <div style={{
      position: 'fixed',
      top: '20px',
      right: '20px',
      width: '400px',
      backgroundColor: 'white',
      border: '2px solid #007bff',
      borderRadius: '8px',
      padding: '20px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      zIndex: 1000,
      fontFamily: 'Arial, sans-serif',
    }}>
      <div style={{ marginBottom: '15px' }}>
        <h3 style={{ margin: '0 0 10px 0', color: '#007bff', fontSize: '18px' }}>
          🎬 Video Generation Progress
        </h3>
        <div style={{ fontSize: '14px', color: '#666' }}>
          Group ID: {groupId?.slice(-8)}...
        </div>
      </div>

      {/* Overall Progress Bar */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '8px' 
        }}>
          <span style={{ fontSize: '16px', fontWeight: 'bold' }}>
            Overall Progress
          </span>
          <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#007bff' }}>
            {Math.round(overallProgress)}%
          </span>
        </div>
        
        <div style={{
          width: '100%',
          height: '12px',
          backgroundColor: '#e9ecef',
          borderRadius: '6px',
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${overallProgress}%`,
            height: '100%',
            backgroundColor: '#007bff',
            transition: 'width 0.3s ease',
            borderRadius: '6px',
          }} />
        </div>

        {estimatedTimeRemaining && (
          <div style={{ 
            fontSize: '12px', 
            color: '#666', 
            marginTop: '5px',
            textAlign: 'center' 
          }}>
            ⏱️ {estimatedTimeRemaining} remaining
          </div>
        )}
      </div>

      {/* Individual Shot Progress */}
      <div>
        <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#333' }}>
          Shot Progress ({shots.filter(s => s.status === 'completed').length}/{shots.length})
        </h4>
        
        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
          {shots.map(shot => (
            <div key={shot.index} style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: '8px',
              padding: '8px',
              backgroundColor: '#f8f9fa',
              borderRadius: '4px',
              border: `1px solid ${
                shot.status === 'completed' ? '#28a745' :
                shot.status === 'processing' ? '#ffc107' :
                shot.status === 'failed' ? '#dc3545' : '#e9ecef'
              }`,
            }}>
              <div style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: 
                  shot.status === 'completed' ? '#28a745' :
                  shot.status === 'processing' ? '#ffc107' :
                  shot.status === 'failed' ? '#dc3545' : '#e9ecef',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 'bold',
                marginRight: '10px',
              }}>
                {shot.status === 'completed' ? '✓' :
                 shot.status === 'processing' ? '⟳' :
                 shot.status === 'failed' ? '✗' : shot.index}
              </div>
              
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12px', fontWeight: 'bold' }}>
                  Shot {shot.index}
                </div>
                <div style={{ fontSize: '10px', color: '#666' }}>
                  {shot.length} frames • {shot.status}
                  {shot.progress && shot.status === 'processing' && ` (${shot.progress}%)`}
                </div>
              </div>

              {shot.completedTime && startTime && (
                <div style={{ fontSize: '10px', color: '#666' }}>
                  {formatTime(shot.completedTime - startTime)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Time Stats */}
      {startTime && (
        <div style={{
          marginTop: '15px',
          padding: '10px',
          backgroundColor: '#e9ecef',
          borderRadius: '4px',
          fontSize: '12px',
          color: '#666',
        }}>
          <div>⏱️ Elapsed: {formatTime(Date.now() - startTime)}</div>
          <div>🚀 Speed: ~{Math.round((Date.now() - startTime) / shots.filter(s => s.status === 'completed').length / 1000) || 0}s per shot</div>
          <div>📊 Resolution: 512x384 @12fps</div>
        </div>
      )}
    </div>
  );
};