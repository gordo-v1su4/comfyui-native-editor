import { useState, useEffect } from "react";
import { AdvancedVideoEditor } from "./components/AdvancedVideoEditor";
import { ProjectSelector } from "./components/ProjectSelector";
import Login from "./components/Login";
import Screenwriter from "./components/Screenwriter";
import GlobalVideoProgress from "./components/GlobalVideoProgress";
import { VideoProgressProvider } from "./contexts/VideoProgressContext";
import { GlobalVideoProgressOverlay } from "./components/GlobalVideoProgressOverlay";
import ErrorBoundary from "./components/ErrorBoundary";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { Analytics } from "@vercel/analytics/react";

function App() {
  const [currentProject, setCurrentProject] = useState<any>(null);
  const [activeView, setActiveView] = useState<"editor" | "screenwriter">(
    "screenwriter"
  );
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    // Check if user is already logged in
    const token = localStorage.getItem("authToken");
    const savedUser = localStorage.getItem("user");

    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
      setIsAuthenticated(true);
    }

    setLoading(false);
  }, []);

  // Detect mobile/tablet to relax overflow constraints and enable scrolling
  useEffect(() => {
    const update = () => {
      try {
        const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
        const small = w <= 820; // typical tablet/phone cutoff
        const coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        // Treat as mobile if the viewport is small OR it's a coarse pointer on a reasonably small screen
        const mobile = small || (coarse && w <= 1024);
        setIsMobile(!!mobile);
      } catch {
        setIsMobile(false);
      }
    };
    update();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
  }, []);

  const handleLogin = (token: string, userData: any) => {
    setUser(userData);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("user");
    setUser(null);
    setIsAuthenticated(false);
    setCurrentProject(null);
  };

  const handleProjectSelect = (project: any) => {
    setCurrentProject(project);
    setActiveView("screenwriter");
  };

  const handleBackToProjects = () => {
    setCurrentProject(null);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <VideoProgressProvider>
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        width: '100vw',
        height: isMobile ? 'auto' : '100vh',
        minHeight: isMobile ? '100dvh' as any : undefined,
        overflowX: 'hidden',
        overflowY: isMobile ? 'auto' : 'hidden',
      }}>
        {/* Header with user info and logout */}
        <div
          style={{
            backgroundColor: "#f8f9fa",
            padding: "1rem",
            borderBottom: "1px solid #dee2e6",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h3 style={{ margin: 0, color: "#333" }}>Video Editor</h3>
            <small style={{ color: "#666" }}>Welcome, {user?.username}</small>
          </div>
          {currentProject && (
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => setActiveView("editor")}
                style={{ padding: "0.5rem 1rem" }}
              >
                Editor
              </button>
              <button
                onClick={() => setActiveView("screenwriter")}
                style={{ padding: "0.5rem 1rem" }}
              >
                Screenwriter
              </button>
            </div>
          )}
          <button
            onClick={handleLogout}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#dc3545",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Logout
          </button>
        </div>

        <div style={{ flex: 1, overflow: isMobile ? 'visible' : 'hidden' }}>
          {currentProject ? (
            activeView === "editor" ? (
              <ErrorBoundary>
                <AdvancedVideoEditor
                  currentProject={currentProject}
                  onBackToProjects={handleBackToProjects}
                />
              </ErrorBoundary>
            ) : (
              <ErrorBoundary>
                <Screenwriter
                  projectId={currentProject.id}
                  onBack={handleBackToProjects}
                />
              </ErrorBoundary>
            )
          ) : (
            <ErrorBoundary>
              <ProjectSelector onProjectSelect={handleProjectSelect} />
            </ErrorBoundary>
          )}
        </div>

        {/* Global Video Progress - persists across view changes */}
        <GlobalVideoProgress projectId={currentProject?.id || null} />
        
        {/* Global Video Progress Overlay - persists across navigation */}
        <GlobalVideoProgressOverlay />

        {/* Vercel Speed Insights */}
        <SpeedInsights />
        {/* Vercel Web Analytics */}
        <Analytics />
      </div>
    </VideoProgressProvider>
  );
}

export default App;
