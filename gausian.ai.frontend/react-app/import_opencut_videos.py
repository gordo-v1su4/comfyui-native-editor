#!/usr/bin/env python3
"""
Script to import all videos from OpenCut project media folder into the video editor.
This uses the REST API to upload videos and make them available in the media importer panel.
"""

import requests
import os
import json
from pathlib import Path
from typing import List, Dict, Any

class VideoImporter:
    """Import videos from OpenCut project into the video editor."""
    
    def __init__(self, base_url: str = "http://localhost:3001"):
        self.base_url = base_url
        self.session = requests.Session()
    
    def upload_video(self, video_path: str) -> Dict[str, Any]:
        """Upload a single video file."""
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")
        
        print(f"📤 Uploading: {os.path.basename(video_path)}")
        
        with open(video_path, "rb") as f:
            files = {"video": f}
            response = self.session.post(f"{self.base_url}/api/upload-video", files=files)
            response.raise_for_status()
            return response.json()
    
    def get_uploaded_videos(self) -> List[Dict[str, Any]]:
        """Get list of all uploaded videos."""
        response = self.session.get(f"{self.base_url}/api/videos")
        response.raise_for_status()
        return response.json()["videos"]
    
    def import_opencut_videos(self, media_folder: str) -> List[Dict[str, Any]]:
        """Import all videos from OpenCut media folder."""
        media_path = Path(media_folder)
        
        if not media_path.exists():
            raise FileNotFoundError(f"Media folder not found: {media_folder}")
        
        # Find all video files
        video_extensions = ['.mp4', '.webm', '.avi', '.mov', '.mkv']
        video_files = []
        
        for ext in video_extensions:
            video_files.extend(media_path.glob(f"*{ext}"))
        
        if not video_files:
            print("❌ No video files found in the media folder")
            return []
        
        print(f"🎬 Found {len(video_files)} video files to import")
        print("=" * 50)
        
        uploaded_videos = []
        
        for video_file in sorted(video_files):
            try:
                video_info = self.upload_video(str(video_file))
                uploaded_videos.append(video_info)
                print(f"✅ Uploaded: {video_info['originalName']} ({video_info['size']} bytes)")
                
                if 'duration' in video_info and video_info['duration']:
                    print(f"   ⏱️ Duration: {video_info['duration']:.2f} seconds")
                
            except Exception as e:
                print(f"❌ Failed to upload {video_file.name}: {e}")
        
        return uploaded_videos
    
    def create_project_with_videos(self, project_name: str, video_paths: List[str]) -> Dict[str, Any]:
        """Create a new project and add all videos to the timeline."""
        print(f"\n🎬 Creating project: {project_name}")
        
        # Create project
        project_data = {
            "name": project_name,
            "description": f"Imported from OpenCut project: {project_name}",
            "width": 720,
            "height": 480,
            "fps": 30
        }
        
        response = self.session.post(f"{self.base_url}/api/projects", json=project_data)
        response.raise_for_status()
        project = response.json()
        project_id = project["id"]
        
        print(f"✅ Created project: {project['name']} (ID: {project_id})")
        
        # Upload videos and add to timeline
        timeline_items = []
        current_frame = 0
        
        for i, video_path in enumerate(video_paths):
            try:
                # Upload video
                video_info = self.upload_video(video_path)
                
                # Add to timeline
                timeline_data = {
                    "videoId": video_info["id"],
                    "trackIndex": 0,
                    "startFrame": current_frame,
                    "durationInFrames": 150  # 5 seconds at 30fps
                }
                
                response = self.session.post(f"{self.base_url}/api/projects/{project_id}/timeline", json=timeline_data)
                response.raise_for_status()
                timeline_result = response.json()
                
                timeline_items.append(timeline_result["videoItem"])
                current_frame += 150  # Move to next position
                
                print(f"✅ Added to timeline: {video_info['originalName']} at frame {timeline_data['startFrame']}")
                
            except Exception as e:
                print(f"❌ Failed to add {video_path} to timeline: {e}")
        
        print(f"\n🎉 Project created with {len(timeline_items)} videos in timeline")
        return project

def main():
    """Main function to import OpenCut videos."""
    
    # Path to OpenCut media folder
    opencut_media_folder = "/Users/mingeonkim/LocalDocuments/altogether/film-mvp/wan22_enhanced_output/opencut_project/media"
    
    print("🎬 OpenCut Video Importer")
    print("=" * 50)
    print(f"📁 Source folder: {opencut_media_folder}")
    print(f"🌐 API endpoint: http://localhost:3001")
    print()
    
    try:
        # Initialize importer
        importer = VideoImporter()
        
        # Check if server is running
        try:
            response = importer.session.get("http://localhost:3001/api/videos")
            response.raise_for_status()
            print("✅ Server is running and responding")
        except requests.exceptions.ConnectionError:
            print("❌ Error: Could not connect to the API server.")
            print("Make sure the server is running on http://localhost:3001")
            print("Run: cd react-app && npm run server")
            return
        except Exception as e:
            print(f"❌ Error connecting to server: {e}")
            return
        
        # Import all videos
        uploaded_videos = importer.import_opencut_videos(opencut_media_folder)
        
        if uploaded_videos:
            print(f"\n🎉 Successfully imported {len(uploaded_videos)} videos!")
            print("\n📋 Uploaded videos:")
            for video in uploaded_videos:
                print(f"   - {video['originalName']} ({video['size']} bytes)")
            
            # Show current videos in the system
            print(f"\n📊 Total videos in system:")
            all_videos = importer.get_uploaded_videos()
            print(f"   - {len(all_videos)} videos available")
            
            print(f"\n🌐 View in React app: http://localhost:3001")
            print(f"📖 Videos are now available in the media importer panel")
            
            # Optionally create a project with all videos
            create_project = input(f"\n🤔 Create a project with all videos in timeline? (y/n): ").lower().strip()
            if create_project in ['y', 'yes']:
                video_paths = [str(Path(opencut_media_folder) / f"shot_{i:02d}.mp4") for i in range(1, 8)]
                project = importer.create_project_with_videos("OpenCut Import", video_paths)
                print(f"🎬 Project created: {project['name']}")
                print(f"📁 Project ID: {project['id']}")
        else:
            print("❌ No videos were imported")
            
    except Exception as e:
        print(f"❌ Error during import: {e}")

if __name__ == "__main__":
    main()
