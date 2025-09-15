#!/usr/bin/env python3
"""
Script to copy API-created project data to OpenCut's IndexedDB storage.
This will make the project appear in OpenCut's UI.
"""

import os
import json
import requests
import base64
import time
from pathlib import Path
import glob

def copy_project_to_opencut_ui(project_id, opencut_url="http://localhost:3000"):
    """Copy project data to OpenCut's UI storage."""
    
    # Read the project data we created via API
    project_file = Path("OpenCut/apps/web/data/opencut-projects") / f"{project_id}.json"
    media_file = Path("OpenCut/apps/web/data/opencut-projects") / f"{project_id}-media.json"
    timeline_file = Path("OpenCut/apps/web/data/opencut-projects") / f"{project_id}-timeline.json"
    
    if not project_file.exists():
        print(f"❌ Project file not found: {project_file}")
        return False
    
    try:
        # Read project data
        with open(project_file, 'r') as f:
            project_data = json.load(f)
        
        print(f"📁 Project data loaded: {project_data['name']}")
        
        # Create a simple HTML page that will inject the project into OpenCut's IndexedDB
        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <title>OpenCut Project Injector</title>
</head>
<body>
    <h1>Injecting Project: {project_data['name']}</h1>
    <div id="status">Initializing...</div>
    
    <script>
        const projectData = {json.dumps(project_data)};
        
        async function injectProject() {{
            try {{
                // Open IndexedDB
                const dbName = 'video-editor-projects';
                const request = indexedDB.open(dbName, 1);
                
                request.onerror = () => {{
                    document.getElementById('status').innerHTML = '❌ Failed to open IndexedDB';
                }};
                
                request.onsuccess = (event) => {{
                    const db = event.target.result;
                    const transaction = db.transaction(['projects'], 'readwrite');
                    const store = transaction.objectStore('projects');
                    
                    // Convert project data to OpenCut format
                    const opencutProject = {{
                        id: projectData.id,
                        name: projectData.name,
                        thumbnail: projectData.thumbnail,
                        createdAt: projectData.createdAt,
                        updatedAt: projectData.updatedAt,
                        backgroundColor: projectData.backgroundColor,
                        backgroundType: projectData.backgroundType,
                        blurIntensity: projectData.blurIntensity,
                        bookmarks: projectData.bookmarks,
                        fps: projectData.fps,
                        canvasSize: projectData.canvasSize,
                        canvasMode: projectData.canvasMode
                    }};
                    
                    // Store the project
                    const addRequest = store.put(opencutProject);
                    
                    addRequest.onsuccess = () => {{
                        document.getElementById('status').innerHTML = '✅ Project injected successfully!';
                        document.getElementById('status').style.color = 'green';
                        
                        // Redirect to OpenCut after a short delay
                        setTimeout(() => {{
                            window.location.href = 'http://localhost:3000/projects';
                        }}, 2000);
                    }};
                    
                    addRequest.onerror = () => {{
                        document.getElementById('status').innerHTML = '❌ Failed to store project';
                        document.getElementById('status').style.color = 'red';
                    }};
                }};
                
                request.onupgradeneeded = (event) => {{
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains('projects')) {{
                        db.createObjectStore('projects', {{ keyPath: 'id' }});
                    }}
                }};
                
            }} catch (error) {{
                document.getElementById('status').innerHTML = '❌ Error: ' + error.message;
                document.getElementById('status').style.color = 'red';
            }}
        }}
        
        // Run injection when page loads
        window.onload = injectProject;
    </script>
</body>
</html>
"""
        
        # Save the HTML file
        html_file = Path("inject_project.html")
        with open(html_file, 'w') as f:
            f.write(html_content)
        
        print(f"📄 Created injection page: {html_file.absolute()}")
        print(f"🌐 Opening injection page...")
        
        # Open the injection page
        import webbrowser
        webbrowser.open(f"file://{html_file.absolute()}")
        
        print("\n📋 Instructions:")
        print("1. The injection page will open in your browser")
        print("2. It will automatically inject the project into OpenCut's storage")
        print("3. After 2 seconds, it will redirect you to OpenCut's projects page")
        print("4. Your project should now appear in the projects list")
        
        return True
        
    except Exception as e:
        print(f"❌ Error copying project: {e}")
        return False

def main():
    """Main function to copy project to OpenCut UI."""
    print("🎬 Copying project to OpenCut UI...")
    
    # Find the most recent project ID from our API calls
    projects_dir = Path("OpenCut/apps/web/data/opencut-projects")
    if not projects_dir.exists():
        print("❌ No projects directory found")
        return
    
    project_files = list(projects_dir.glob("*.json"))
    if not project_files:
        print("❌ No project files found")
        return
    
    # Get the most recent project (assuming it's the one we just created)
    latest_project = max(project_files, key=lambda f: f.stat().st_mtime)
    project_id = latest_project.stem  # Remove .json extension
    
    # If it ends with -timeline or -media, extract the base project ID
    if project_id.endswith('-timeline'):
        project_id = project_id[:-9]  # Remove '-timeline'
    elif project_id.endswith('-media'):
        project_id = project_id[:-6]  # Remove '-media'
    
    print(f"📁 Found project: {project_id}")
    
    # Copy to OpenCut UI
    success = copy_project_to_opencut_ui(project_id)
    
    if success:
        print(f"\n🎉 Project injection initiated!")
        print(f"📁 Project ID: {project_id}")
        print(f"🌐 Check OpenCut at: http://localhost:3000/projects")
    else:
        print("❌ Failed to copy project to OpenCut UI")

if __name__ == "__main__":
    main()
