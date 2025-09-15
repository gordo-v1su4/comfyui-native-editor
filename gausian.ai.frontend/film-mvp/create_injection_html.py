#!/usr/bin/env python3
"""
Script to create injection HTML file for a specific project.
"""

import json
import os
from pathlib import Path

def create_injection_html(project_id):
    """Create injection HTML file for a specific project."""
    
    # Read project data
    project_file = Path("OpenCut/apps/web/data/opencut-projects") / f"{project_id}.json"
    
    if not project_file.exists():
        print(f"❌ Project file not found: {project_file}")
        return False
    
    try:
        with open(project_file, 'r') as f:
            project_data = json.load(f)
        
        # Create injection HTML
        html_content = f"""<!DOCTYPE html>
<html>
<head>
    <title>OpenCut Project Auto-Injection</title>
    <style>
        body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; }}
        .status {{ margin: 20px; padding: 10px; border-radius: 5px; }}
        .success {{ background: #d4edda; color: #155724; }}
        .error {{ background: #f8d7da; color: #721c24; }}
    </style>
</head>
<body>
    <h1>OpenCut Project Auto-Injection</h1>
    <div id="status" class="status">Initializing...</div>
    
    <script>
        // Auto-injection script for OpenCut project
        // This will be executed automatically when OpenCut loads
        
        const projectData = {json.dumps(project_data, indent=10)};
        
        // Wait for OpenCut to be ready
        function injectProject() {{
          if (typeof indexedDB === 'undefined') {{
            setTimeout(injectProject, 100);
            return;
          }}
          
          try {{
            const dbName = 'video-editor-projects';
            const request = indexedDB.open(dbName, 1);
            
            request.onerror = () => {{
              console.error('Failed to open IndexedDB for project injection');
              document.getElementById('status').innerHTML = '❌ Failed to open IndexedDB';
              document.getElementById('status').className = 'status error';
            }};
            
            request.onsuccess = (event) => {{
              const db = event.target.result;
              const transaction = db.transaction(['projects'], 'readwrite');
              const store = transaction.objectStore('projects');
              
              // Store the project
              const addRequest = store.put(projectData);
              
              addRequest.onsuccess = () => {{
                console.log('✅ Project injected successfully:', projectData.name);
                document.getElementById('status').innerHTML = '✅ Project injected successfully!<br>Redirecting to OpenCut...';
                document.getElementById('status').className = 'status success';
                
                // Trigger a refresh of the projects list
                setTimeout(() => {{
                  window.location.href = 'http://localhost:3000/projects';
                }}, 2000);
              }};
              
              addRequest.onerror = () => {{
                console.error('Failed to store project in IndexedDB');
                document.getElementById('status').innerHTML = '❌ Failed to store project';
                document.getElementById('status').className = 'status error';
              }};
            }};
            
            request.onupgradeneeded = (event) => {{
              const db = event.target.result;
              if (!db.objectStoreNames.contains('projects')) {{
                db.createObjectStore('projects', {{ keyPath: 'id' }});
              }}
            }};
          }} catch (error) {{
            console.error('Error injecting project:', error);
            document.getElementById('status').innerHTML = '❌ Error: ' + error.message;
            document.getElementById('status').className = 'status error';
          }}
        }}
        
        // Start injection
        injectProject();
    </script>
</body>
</html>"""
        
        # Save to public directory
        inject_dir = Path("OpenCut/apps/web/public/inject")
        inject_dir.mkdir(parents=True, exist_ok=True)
        
        html_file = inject_dir / f"{project_id}.html"
        with open(html_file, 'w') as f:
            f.write(html_content)
        
        print(f"✅ Created injection HTML: {html_file}")
        print(f"🌐 URL: http://localhost:3000/inject/{project_id}.html")
        
        return True
        
    except Exception as e:
        print(f"❌ Error creating injection HTML: {e}")
        return False

def main():
    """Main function."""
    import sys
    
    if len(sys.argv) != 2:
        print("Usage: python create_injection_html.py <project_id>")
        return
    
    project_id = sys.argv[1]
    create_injection_html(project_id)

if __name__ == "__main__":
    main()


