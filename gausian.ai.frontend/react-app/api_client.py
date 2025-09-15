#!/usr/bin/env python3
"""
Python client for the Video Editor REST API.
This script demonstrates how to programmatically upload videos and manage timelines.
"""

import requests
import json
import os
import time
from pathlib import Path
from typing import List, Dict, Any, Optional

class VideoEditorAPI:
    """Client for the Video Editor REST API."""
    
    def __init__(self, base_url: str = "http://localhost:3001"):
        self.base_url = base_url
        self.session = requests.Session()
    
    def create_project(self, name: str, description: str = "", width: int = 720, height: int = 480, fps: int = 30) -> Dict[str, Any]:
        """Create a new video editing project."""
        data = {
            "name": name,
            "description": description,
            "width": width,
            "height": height,
            "fps": fps
        }
        
        response = self.session.post(f"{self.base_url}/api/projects", json=data)
        response.raise_for_status()
        return response.json()
    
    def get_projects(self) -> List[Dict[str, Any]]:
        """Get all projects."""
        response = self.session.get(f"{self.base_url}/api/projects")
        response.raise_for_status()
        return response.json()["projects"]
    
    def get_project(self, project_id: str) -> Dict[str, Any]:
        """Get a specific project."""
        response = self.session.get(f"{self.base_url}/api/projects/{project_id}")
        response.raise_for_status()
        return response.json()
    
    def delete_project(self, project_id: str) -> bool:
        """Delete a project."""
        response = self.session.delete(f"{self.base_url}/api/projects/{project_id}")
        response.raise_for_status()
        return True
    
    def upload_video(self, video_path: str) -> Dict[str, Any]:
        """Upload a video file."""
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")
        
        with open(video_path, "rb") as f:
            files = {"video": f}
            response = self.session.post(f"{self.base_url}/api/upload-video", files=files)
            response.raise_for_status()
            return response.json()
    
    def upload_video_base64(self, video_path: str) -> Dict[str, Any]:
        """Upload a video using base64 encoding."""
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")
        
        import base64
        
        with open(video_path, "rb") as f:
            video_data = f.read()
            base64_data = base64.b64encode(video_data).decode('utf-8')
        
        data = {
            "fileName": os.path.basename(video_path),
            "fileData": f"data:video/mp4;base64,{base64_data}",
            "fileType": "video/mp4"
        }
        
        response = self.session.post(f"{self.base_url}/api/upload-video-base64", json=data)
        response.raise_for_status()
        return response.json()
    
    def add_video_to_timeline(self, project_id: str, video_id: str, track_index: int = 0, 
                             start_frame: int = 0, duration_frames: int = 150) -> Dict[str, Any]:
        """Add a video to the timeline."""
        data = {
            "videoId": video_id,
            "trackIndex": track_index,
            "startFrame": start_frame,
            "durationInFrames": duration_frames
        }
        
        response = self.session.post(f"{self.base_url}/api/projects/{project_id}/timeline", json=data)
        response.raise_for_status()
        return response.json()
    
    def get_timeline(self, project_id: str) -> Dict[str, Any]:
        """Get the timeline for a project."""
        response = self.session.get(f"{self.base_url}/api/projects/{project_id}/timeline")
        response.raise_for_status()
        return response.json()
    
    def update_timeline_item(self, project_id: str, item_id: str, updates: Dict[str, Any]) -> bool:
        """Update a timeline item."""
        response = self.session.put(f"{self.base_url}/api/projects/{project_id}/timeline/{item_id}", json=updates)
        response.raise_for_status()
        return True
    
    def delete_timeline_item(self, project_id: str, item_id: str) -> bool:
        """Delete a timeline item."""
        response = self.session.delete(f"{self.base_url}/api/projects/{project_id}/timeline/{item_id}")
        response.raise_for_status()
        return True
    
    def bulk_upload_videos(self, project_id: str, video_paths: List[str], track_index: int = 0, 
                          start_frame: int = 0, spacing: int = 0) -> Dict[str, Any]:
        """Upload multiple videos and add them to the timeline."""
        files = []
        for video_path in video_paths:
            if not os.path.exists(video_path):
                raise FileNotFoundError(f"Video file not found: {video_path}")
            files.append(("videos", open(video_path, "rb")))
        
        data = {
            "trackIndex": track_index,
            "startFrame": start_frame,
            "spacing": spacing
        }
        
        try:
            response = self.session.post(f"{self.base_url}/api/projects/{project_id}/bulk-upload", 
                                       files=files, data=data)
            response.raise_for_status()
            return response.json()
        finally:
            # Close all file handles
            for _, file_handle in files:
                file_handle.close()
    
    def export_project(self, project_id: str, format: str = "mp4", quality: str = "medium", 
                      filename: Optional[str] = None) -> Dict[str, Any]:
        """Export a project as a video."""
        data = {
            "format": format,
            "quality": quality
        }
        if filename:
            data["filename"] = filename
        
        response = self.session.post(f"{self.base_url}/api/projects/{project_id}/export", json=data)
        response.raise_for_status()
        return response.json()
    
    def get_export_progress(self, render_id: str) -> Dict[str, Any]:
        """Get the progress of a video export."""
        response = self.session.get(f"{self.base_url}/api/render-progress/{render_id}")
        response.raise_for_status()
        return response.json()
    
    def get_videos(self) -> List[Dict[str, Any]]:
        """Get all uploaded videos."""
        response = self.session.get(f"{self.base_url}/api/videos")
        response.raise_for_status()
        return response.json()["videos"]
    
    def wait_for_export(self, render_id: str, timeout: int = 300, check_interval: int = 5) -> Dict[str, Any]:
        """Wait for an export to complete."""
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            progress = self.get_export_progress(render_id)
            
            if progress["status"] == "completed":
                return progress
            elif progress["status"] == "failed":
                raise Exception(f"Export failed: {progress.get('error', 'Unknown error')}")
            
            print(f"Export progress: {progress['progress']}%")
            time.sleep(check_interval)
        
        raise TimeoutError("Export timed out")

def main():
    """Example usage of the Video Editor API."""
    
    # Initialize the API client
    api = VideoEditorAPI()
    
    try:
        print("🎬 Video Editor API Client Demo")
        print("=" * 50)
        
        # 1. Create a new project
        print("\n1. Creating a new project...")
        project = api.create_project(
            name="AI Generated Film Demo",
            description="A demo project created via API",
            width=720,
            height=480,
            fps=30
        )
        project_id = project["id"]
        print(f"✅ Created project: {project['name']} (ID: {project_id})")
        
        # 2. Upload a video (if available)
        video_path = "../film-mvp/wan22_enhanced_output/shot_01.mp4"
        if os.path.exists(video_path):
            print(f"\n2. Uploading video: {video_path}")
            video_info = api.upload_video(video_path)
            print(f"✅ Uploaded video: {video_info['originalName']} (ID: {video_info['id']})")
            
            # 3. Add video to timeline
            print("\n3. Adding video to timeline...")
            timeline_result = api.add_video_to_timeline(
                project_id=project_id,
                video_id=video_info["id"],
                track_index=0,
                start_frame=0,
                duration_frames=150
            )
            print(f"✅ Added video to timeline: {timeline_result['message']}")
        
        # 4. Get timeline
        print("\n4. Getting timeline...")
        timeline = api.get_timeline(project_id)
        print(f"✅ Timeline has {len(timeline['tracks'])} tracks")
        for i, track in enumerate(timeline['tracks']):
            print(f"   Track {i}: {len(track['items'])} items")
        
        # 5. Get all projects
        print("\n5. Listing all projects...")
        projects = api.get_projects()
        print(f"✅ Found {len(projects)} projects:")
        for p in projects:
            print(f"   - {p['name']} (ID: {p['id']})")
        
        # 6. Get uploaded videos
        print("\n6. Listing uploaded videos...")
        videos = api.get_videos()
        print(f"✅ Found {len(videos)} videos:")
        for v in videos:
            print(f"   - {v['name']} ({v['size']} bytes)")
        
        print("\n🎉 API demo completed successfully!")
        print(f"📁 Project data saved to: data/projects/{project_id}.json")
        print(f"🌐 View in React app: http://localhost:3001")
        
    except requests.exceptions.ConnectionError:
        print("❌ Error: Could not connect to the API server.")
        print("Make sure the server is running on http://localhost:3001")
        print("Run: cd react-app && npm run server")
    except Exception as e:
        print(f"❌ Error: {e}")

def bulk_upload_example():
    """Example of bulk uploading multiple videos."""
    
    api = VideoEditorAPI()
    
    try:
        print("🎬 Bulk Upload Example")
        print("=" * 30)
        
        # Create project
        project = api.create_project("Bulk Upload Demo")
        project_id = project["id"]
        
        # Find video files
        video_dir = Path("../film-mvp/wan22_enhanced_output")
        video_files = list(video_dir.glob("shot_*.mp4"))
        
        if video_files:
            print(f"Found {len(video_files)} video files")
            
            # Bulk upload
            result = api.bulk_upload_videos(
                project_id=project_id,
                video_paths=[str(f) for f in video_files],
                track_index=0,
                start_frame=0,
                spacing=30  # 1 second spacing at 30fps
            )
            
            print(f"✅ Bulk upload completed: {result['message']}")
            print(f"📊 Uploaded {result['totalVideos']} videos")
            
        else:
            print("No video files found for bulk upload")
            
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "bulk":
        bulk_upload_example()
    else:
        main()
