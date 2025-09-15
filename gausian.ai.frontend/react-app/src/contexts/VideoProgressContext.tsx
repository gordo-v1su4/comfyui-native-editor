import React, { createContext, useContext, useState, ReactNode } from 'react';

interface ShotProgress {
  index: number;
  length: number; // in frames
  promptId: string;
  clientId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  startTime: number;
  progress?: number;
  eta?: number;
}

interface VideoProgressState {
  isGenerating: boolean;
  groupId: string | null;
  shots: ShotProgress[];
  overallProgress: number;
  startTime: number | null;
  estimatedRemaining: string;
  modalEndpoint?: string;
  projectId?: string | null;
  expectedCount?: number;
  importedCount?: number;
}

interface VideoProgressContextType {
  progressState: VideoProgressState;
  startVideoGeneration: (groupId: string, shots: ShotProgress[], projectId?: string) => void;
  updateProgress: (progress: Partial<VideoProgressState>) => void;
  completeGeneration: () => void;
  cancelGeneration: () => void;
}

const VideoProgressContext = createContext<VideoProgressContextType | undefined>(undefined);

export const useVideoProgress = () => {
  const context = useContext(VideoProgressContext);
  if (!context) {
    throw new Error('useVideoProgress must be used within a VideoProgressProvider');
  }
  return context;
};

interface VideoProgressProviderProps {
  children: ReactNode;
}

export const VideoProgressProvider: React.FC<VideoProgressProviderProps> = ({ children }) => {
  const [progressState, setProgressState] = useState<VideoProgressState>({
    isGenerating: false,
    groupId: null,
    shots: [],
    overallProgress: 0,
    startTime: null,
    estimatedRemaining: '',
    projectId: null,
    expectedCount: 0,
    importedCount: 0,
  });

  const startVideoGeneration = (groupId: string, shots: ShotProgress[], projectId?: string) => {
    const modalEndpoint = localStorage.getItem('modalEndpoint') || '';
    setProgressState({
      isGenerating: true,
      groupId,
      shots: shots.map(shot => ({ ...shot, startTime: Date.now() })),
      overallProgress: 0,
      startTime: Date.now(),
      estimatedRemaining: `${Math.round(shots.length * 40 / 60)}m ${(shots.length * 40) % 60}s`,
      modalEndpoint,
      projectId: projectId || null,
      expectedCount: shots.length,
      importedCount: 0,
    });
  };

  const updateProgress = (progress: Partial<VideoProgressState>) => {
    setProgressState(prev => ({ ...prev, ...progress }));
  };

  const completeGeneration = () => {
    setProgressState(prev => ({
      ...prev,
      isGenerating: false,
      overallProgress: 100,
    }));

    // Keep the completed state for 3 seconds, then clear
    setTimeout(() => {
      setProgressState({
        isGenerating: false,
        groupId: null,
        shots: [],
        overallProgress: 0,
        startTime: null,
        estimatedRemaining: '',
      });
    }, 3000);
  };

  const cancelGeneration = () => {
    setProgressState({
      isGenerating: false,
      groupId: null,
      shots: [],
      overallProgress: 0,
      startTime: null,
      estimatedRemaining: '',
    });
  };

  return (
    <VideoProgressContext.Provider
      value={{
        progressState,
        startVideoGeneration,
        updateProgress,
        completeGeneration,
        cancelGeneration,
      }}
    >
      {children}
    </VideoProgressContext.Provider>
  );
};
