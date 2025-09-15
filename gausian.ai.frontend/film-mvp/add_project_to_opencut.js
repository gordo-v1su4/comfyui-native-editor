// JavaScript to add project to OpenCut's IndexedDB
// Run this in the browser console on http://localhost:3000

const projectData = {
  id: "FZPXrmURdsf0LVHlHZntI",
  name: "The Green Knight's Vigil",
  thumbnail: "",
  createdAt: "2025-08-13T09:30:00.000Z",
  updatedAt: "2025-08-13T09:30:00.000Z",
  backgroundColor: "#000000",
  backgroundType: "color",
  blurIntensity: 8,
  bookmarks: [],
  fps: 24,
  canvasSize: { width: 720, height: 480 },
  canvasMode: "preset",
};

async function addProjectToOpenCut() {
  try {
    console.log("Adding project to OpenCut...");

    // Open IndexedDB
    const dbName = "video-editor-projects";
    const request = indexedDB.open(dbName, 1);

    request.onerror = () => {
      console.error("Failed to open IndexedDB");
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(["projects"], "readwrite");
      const store = transaction.objectStore("projects");

      // Store the project
      const addRequest = store.put(projectData);

      addRequest.onsuccess = () => {
        console.log("✅ Project added successfully!");
        console.log("Project ID:", projectData.id);
        console.log("Project Name:", projectData.name);

        // Refresh the page to show the new project
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      };

      addRequest.onerror = () => {
        console.error("Failed to store project");
      };
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" });
      }
    };
  } catch (error) {
    console.error("Error adding project:", error);
  }
}

// Run the function
addProjectToOpenCut();


