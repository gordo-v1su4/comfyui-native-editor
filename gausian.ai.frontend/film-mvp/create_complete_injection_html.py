#!/usr/bin/env python3
"""
Script to create complete injection HTML file with project, media, and timeline data.
"""

import json
import os
from pathlib import Path

def create_complete_injection_html(project_id):
    """Create complete injection HTML file with project, media, and timeline data."""
    
    # Read project data
    project_file = Path("OpenCut/apps/web/data/opencut-projects") / f"{project_id}.json"
    media_file = Path("OpenCut/apps/web/data/opencut-projects") / f"{project_id}-media.json"
    timeline_file = Path("OpenCut/apps/web/data/opencut-projects") / f"{project_id}-timeline.json"
    
    if not project_file.exists():
        print(f"❌ Project file not found: {project_file}")
        return False
    
    try:
        with open(project_file, 'r') as f:
            project_data = json.load(f)
        
        media_items = []
        if media_file.exists():
            with open(media_file, 'r') as f:
                media_items = json.load(f)
        
        timeline_data = None
        if timeline_file.exists():
            with open(timeline_file, 'r') as f:
                timeline_data = json.load(f)
        
        print(f"📁 Project data loaded: {project_data['name']}")
        print(f"📁 Media items: {len(media_items)}")
        print(f"📁 Timeline clips: {len(timeline_data['clips']) if timeline_data else 0}")
        
        # Create complete injection HTML
        html_content = f"""<!DOCTYPE html>
<html>
<head>
    <title>OpenCut Complete Project Injection</title>
    <style>
        body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; }}
        .status {{ margin: 20px; padding: 10px; border-radius: 5px; }}
        .success {{ background: #d4edda; color: #155724; }}
        .error {{ background: #f8d7da; color: #721c24; }}
        .info {{ background: #d1ecf1; color: #0c5460; }}
    </style>
</head>
<body>
    <h1>OpenCut Complete Project Injection</h1>
    <div id="status" class="status info">Initializing...</div>
    
    <script>
        // Complete injection script for OpenCut project
        // This will inject project, media, and timeline data
        
        const projectData = {json.dumps(project_data, indent=10)};
        const mediaItems = {json.dumps(media_items, indent=10)};
        const timelineData = {json.dumps(timeline_data, indent=10)};
        
        let injectionStep = 0;
        const totalSteps = 3;
        
        function updateStatus(message, type = 'info') {{
            const statusEl = document.getElementById('status');
            statusEl.innerHTML = `Step ${{injectionStep}}/${{totalSteps}}: ${{message}}`;
            statusEl.className = `status ${{type}}`;
        }}
        
        // Step 1: Inject project data
        async function injectProject() {{
            injectionStep = 1;
            updateStatus('Injecting project data...', 'info');
            
            return new Promise((resolve, reject) => {{
                if (typeof indexedDB === 'undefined') {{
                    setTimeout(() => injectProject().then(resolve).catch(reject), 100);
                    return;
                }}
                
                try {{
                    const dbName = 'video-editor-projects';
                    const request = indexedDB.open(dbName, 1);
                    
                    request.onerror = () => {{
                        reject(new Error('Failed to open projects IndexedDB'));
                    }};
                    
                    request.onsuccess = (event) => {{
                        const db = event.target.result;
                        const transaction = db.transaction(['projects'], 'readwrite');
                        const store = transaction.objectStore('projects');
                        
                        const addRequest = store.put(projectData);
                        
                        addRequest.onsuccess = () => {{
                            console.log('✅ Project injected successfully:', projectData.name);
                            resolve();
                        }};
                        
                        addRequest.onerror = () => {{
                            reject(new Error('Failed to store project'));
                        }};
                    }};
                    
                    request.onupgradeneeded = (event) => {{
                        const db = event.target.result;
                        if (!db.objectStoreNames.contains('projects')) {{
                            db.createObjectStore('projects', {{ keyPath: 'id' }});
                        }}
                    }};
                }} catch (error) {{
                    reject(error);
                }}
            }});
        }}
        
        // Step 2: Inject media items
        async function injectMediaItems() {{
            injectionStep = 2;
            updateStatus('Injecting media items...', 'info');
            
            if (mediaItems.length === 0) {{
                console.log('No media items to inject');
                return;
            }}
            
            return new Promise((resolve, reject) => {{
                try {{
                    const dbName = `video-editor-media-${{projectData.id}}`;
                    const request = indexedDB.open(dbName, 1);
                    
                    request.onerror = () => {{
                        reject(new Error('Failed to open media IndexedDB'));
                    }};
                    
                    request.onsuccess = (event) => {{
                        const db = event.target.result;
                        const transaction = db.transaction(['media-metadata'], 'readwrite');
                        const store = transaction.objectStore('media-metadata');
                        
                        let completed = 0;
                        let failed = 0;
                        
                        mediaItems.forEach((mediaItem) => {{
                            const addRequest = store.put({{
                                id: mediaItem.id,
                                name: mediaItem.name,
                                type: mediaItem.type,
                                size: 0, // Will be set when file is loaded
                                lastModified: Date.now(),
                                width: mediaItem.width,
                                height: mediaItem.height,
                                duration: mediaItem.duration,
                            }});
                            
                            addRequest.onsuccess = () => {{
                                completed++;
                                if (completed + failed === mediaItems.length) {{
                                    if (failed === 0) {{
                                        console.log(`✅ ${{completed}} media items injected successfully`);
                                        resolve();
                                    }} else {{
                                        reject(new Error(`${{failed}} media items failed to inject`));
                                    }}
                                }}
                            }};
                            
                            addRequest.onerror = () => {{
                                failed++;
                                if (completed + failed === mediaItems.length) {{
                                    reject(new Error(`${{failed}} media items failed to inject`));
                                }}
                            }};
                        }});
                    }};
                    
                    request.onupgradeneeded = (event) => {{
                        const db = event.target.result;
                        if (!db.objectStoreNames.contains('media-metadata')) {{
                            db.createObjectStore('media-metadata', {{ keyPath: 'id' }});
                        }}
                    }};
                }} catch (error) {{
                    reject(error);
                }}
            }});
        }}
        
        // Step 3: Inject timeline data
        async function injectTimeline() {{
            injectionStep = 3;
            updateStatus('Injecting timeline data...', 'info');
            
            if (!timelineData || !timelineData.clips) {{
                console.log('No timeline data to inject');
                return;
            }}
            
            return new Promise((resolve, reject) => {{
                try {{
                    const dbName = `video-editor-timelines-${{projectData.id}}`;
                    const request = indexedDB.open(dbName, 1);
                    
                    request.onerror = () => {{
                        reject(new Error('Failed to open timeline IndexedDB'));
                    }};
                    
                    request.onsuccess = (event) => {{
                        const db = event.target.result;
                        const transaction = db.transaction(['timeline'], 'readwrite');
                        const store = transaction.objectStore('timeline');
                        
                        // Create timeline tracks from clips
                        const tracks = [
                            {{
                                id: 'main-track',
                                type: 'media',
                                order: 0,
                                name: 'Main Track',
                                elements: timelineData.clips.map((clip, index) => ({{
                                    id: `clip-${{index}}`,
                                    type: 'media',
                                    mediaId: clip.videoId,
                                    name: `Clip ${{index + 1}}`,
                                    duration: clip.duration,
                                    startTime: clip.startTime,
                                    trimStart: 0,
                                    trimEnd: 0,
                                }}))
                            }}
                        ];
                        
                        const timelineDataToStore = {{
                            tracks: tracks,
                            lastModified: new Date().toISOString(),
                        }};
                        
                        const addRequest = store.put('timeline', timelineDataToStore);
                        
                        addRequest.onsuccess = () => {{
                            console.log('✅ Timeline injected successfully');
                            resolve();
                        }};
                        
                        addRequest.onerror = () => {{
                            reject(new Error('Failed to store timeline'));
                        }};
                    }};
                    
                    request.onupgradeneeded = (event) => {{
                        const db = event.target.result;
                        if (!db.objectStoreNames.contains('timeline')) {{
                            db.createObjectStore('timeline', {{ keyPath: 'id' }});
                        }}
                    }};
                }} catch (error) {{
                    reject(error);
                }}
            }});
        }}
        
        // Main injection process
        async function performCompleteInjection() {{
            try {{
                await injectProject();
                await injectMediaItems();
                await injectTimeline();
                
                updateStatus('✅ Complete injection successful! Redirecting to OpenCut...', 'success');
                
                // Redirect to OpenCut after successful injection
                setTimeout(() => {{
                    window.location.href = 'http://localhost:3000/projects';
                }}, 2000);
                
            }} catch (error) {{
                console.error('❌ Injection failed:', error);
                updateStatus(`❌ Injection failed: ${{error.message}}`, 'error');
            }}
        }}
        
        // Start the complete injection process
        performCompleteInjection();
    </script>
</body>
</html>"""
        
        # Save to public directory
        inject_dir = Path("OpenCut/apps/web/public/inject")
        inject_dir.mkdir(parents=True, exist_ok=True)
        
        html_file = inject_dir / f"{project_id}.html"
        with open(html_file, 'w') as f:
            f.write(html_content)
        
        print(f"✅ Created complete injection HTML: {html_file}")
        print(f"🌐 URL: http://localhost:3000/inject/{project_id}.html")
        
        return True
        
    except Exception as e:
        print(f"❌ Error creating complete injection HTML: {e}")
        return False

def main():
    """Main function."""
    import sys
    
    if len(sys.argv) != 2:
        print("Usage: python create_complete_injection_html.py <project_id>")
        return
    
    project_id = sys.argv[1]
    create_complete_injection_html(project_id)

if __name__ == "__main__":
    main()


