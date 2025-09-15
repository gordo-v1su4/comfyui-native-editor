import React, { useState, useEffect } from "react";
import { projectAPI } from "../api.js";

interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

interface ProjectSelectorProps {
  onProjectSelect: (project: Project) => void;
}

export const ProjectSelector: React.FC<ProjectSelectorProps> = ({
  onProjectSelect,
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Normalize API project shape to UI shape
  const normalizeProject = (p: any): Project => ({
    id: p.id,
    name: p.name,
    description: p.description,
    createdAt: p.createdAt || p.created_at || new Date().toISOString(),
  });

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const data = await projectAPI.getAll();
      const list = Array.isArray(data?.projects) ? data.projects : [];
      setProjects(list.map(normalizeProject));
    } catch (error) {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  const createNewProject = async () => {
    const projectName = prompt("Enter project name:");
    if (!projectName) return;

    try {
      const newProjectResp = await projectAPI.create({
        name: projectName,
        description: "New project created from project selector",
      });
      const apiProject = newProjectResp?.project || newProjectResp;
      const normalized = normalizeProject(apiProject);
      setProjects([...projects, normalized]);
      onProjectSelect(normalized);
    } catch (error) {
      alert("Failed to create project");
    }
  };

  const deleteProject = async (projectId: string, projectName: string) => {
    if (
      !confirm(
        `Are you sure you want to delete "${projectName}"? This action cannot be undone.`
      )
    ) {
      return;
    }

    try {
      const token = localStorage.getItem("authToken");
      await projectAPI.delete(projectId);
      setProjects(projects.filter((p) => p.id !== projectId));
    } catch (error) {
      alert("Failed to delete project");
    }
  };

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          fontSize: "18px",
          color: "#666",
        }}
      >
        🔄 Loading projects...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          fontSize: "18px",
          color: "#666",
        }}
      >
        <div style={{ marginBottom: "20px" }}>❌ {error}</div>
        <button
          onClick={loadProjects}
          style={{
            padding: "10px 20px",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          🔄 Retry
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "40px",
        fontFamily: "Arial, sans-serif",
        maxWidth: "1200px",
        margin: "0 auto",
      }}
    >
      <div
        style={{
          textAlign: "center",
          marginBottom: "40px",
        }}
      >
        <h1 style={{ fontSize: "2.5em", marginBottom: "10px", color: "#333" }}>
          🎬 Video Editor
        </h1>
        <p style={{ fontSize: "1.2em", color: "#666", marginBottom: "30px" }}>
          Select a project to continue editing or create a new one
        </p>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "30px",
        }}
      >
        <h2 style={{ margin: 0, color: "#333" }}>
          📁 Projects ({projects.length})
        </h2>
        <button
          onClick={createNewProject}
          style={{
            padding: "12px 24px",
            backgroundColor: "#28a745",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "16px",
            fontWeight: "bold",
          }}
        >
          ➕ Create New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px",
            backgroundColor: "#f8f9fa",
            borderRadius: "8px",
            border: "2px dashed #dee2e6",
          }}
        >
          <div style={{ fontSize: "48px", marginBottom: "20px" }}>📁</div>
          <h3 style={{ marginBottom: "10px", color: "#495057" }}>
            No projects yet
          </h3>
          <p style={{ color: "#6c757d", marginBottom: "20px" }}>
            Create your first project to get started with video editing
          </p>
          <button
            onClick={createNewProject}
            style={{
              padding: "12px 24px",
              backgroundColor: "#007bff",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "16px",
            }}
          >
            🚀 Create First Project
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))",
            gap: "20px",
          }}
        >
          {projects.map((project) => (
            <div
              key={project.id}
              style={{
                border: "1px solid #dee2e6",
                borderRadius: "8px",
                padding: "20px",
                backgroundColor: "white",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                transition: "transform 0.2s, box-shadow 0.2s",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 4px 8px rgba(0,0,0,0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.1)";
              }}
              onClick={() => onProjectSelect(project)}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "15px",
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: "1.2em",
                    color: "#333",
                    flex: 1,
                  }}
                >
                  {project.name}
                </h3>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteProject(project.id, project.name);
                  }}
                  style={{
                    padding: "4px 8px",
                    backgroundColor: "#dc3545",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "12px",
                  }}
                >
                  🗑️
                </button>
              </div>

              <p
                style={{
                  margin: "0 0 15px 0",
                  color: "#6c757d",
                  fontSize: "14px",
                  lineHeight: "1.4",
                }}
              >
                {project.description || "No description"}
              </p>

              <div
                style={{
                  fontSize: "12px",
                  color: "#868e96",
                  marginBottom: "15px",
                }}
              >
                <div>🆔 {project.id}</div>
                <div>
                  📅 Created: {new Date(project.createdAt).toLocaleString()}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onProjectSelect(project);
                  }}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#007bff",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                >
                  🎬 Open Project
                </button>
                <span
                  style={{
                    fontSize: "12px",
                    color: "#6c757d",
                  }}
                >
                  Click to open
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: "40px",
          textAlign: "center",
          padding: "20px",
          backgroundColor: "#f8f9fa",
          borderRadius: "8px",
        }}
      >
        <h4 style={{ marginBottom: "10px", color: "#495057" }}>💡 Tips</h4>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            color: "#6c757d",
            fontSize: "14px",
          }}
        >
          <li>• Click on any project card to open it in the timeline editor</li>
          <li>
            • Use the "Create New Project" button to start a fresh project
          </li>
          <li>
            • Projects are automatically saved and can be accessed anytime
          </li>
        </ul>
      </div>
    </div>
  );
};
