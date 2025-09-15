#!/usr/bin/env python3
"""
Script to upload generated videos to OpenCut and create a timeline project via API.
"""

import os
import json
import requests
import base64
import time
from pathlib import Path
import glob

def upload_video_to_opencut(video_path, opencut_url="http://localhost:3000"):
    """Upload a video file to OpenCut via API."""
    try:
        # Read video file and encode as base64
        with open(video_path, 'rb') as f:
            video_data = f.read()
            base64_data = base64.b64encode(video_data).decode('utf-8')
        
        # Prepare upload request
        upload_data = {
            "fileName": os.path.basename(video_path),
            "fileType": "video/mp4",
            "fileData": base64_data
        }
        
        response = requests.post(f"{opencut_url}/api/upload-video", json=upload_data)
        
        if response.status_code == 200:
            return response.json()
        else:
            print(f"❌ Failed to upload {video_path}: {response.status_code}")
            print(f"Response: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Error uploading {video_path}: {e}")
        return None

def create_opencut_project(project_name, video_files, opencut_url="http://localhost:3000"):
    """Create a new OpenCut project with uploaded videos via API."""
    try:
        # Create project
        project_data = {
            "name": project_name,
            "description": f"AI-generated film: {project_name}",
            "resolution": {"width": 720, "height": 480},
            "frameRate": 24
        }
        
        response = requests.post(f"{opencut_url}/api/projects", json=project_data)
        
        if response.status_code != 200:
            print(f"❌ Failed to create project: {response.status_code}")
            print(f"Response: {response.text}")
            return None
            
        project = response.json()
        project_id = project.get('id')
        
        if not project_id:
            print("❌ No project ID returned")
            return None
            
        print(f"✅ Created project: {project_name} (ID: {project_id})")
        
        # Upload videos and add to timeline
        timeline_clips = []
        
        for i, video_path in enumerate(video_files):
            print(f"📤 Uploading video {i+1}/{len(video_files)}: {os.path.basename(video_path)}")
            
            upload_result = upload_video_to_opencut(video_path, opencut_url)
            if upload_result:
                clip_data = {
                    "projectId": project_id,
                    "videoId": upload_result.get('videoId'),
                    "startTime": i * 5.0,  # 5 seconds per clip
                    "duration": 5.0,
                    "track": 0
                }
                timeline_clips.append(clip_data)
                print(f"✅ Added to timeline at {clip_data['startTime']}s")
            else:
                print(f"❌ Failed to add {video_path} to timeline")
        
        # Add clips to timeline
        if timeline_clips:
            timeline_response = requests.post(
                f"{opencut_url}/api/projects/{project_id}/timeline",
                json={"clips": timeline_clips}
            )
            
            if timeline_response.status_code == 200:
                print(f"✅ Timeline created with {len(timeline_clips)} clips")
            else:
                print(f"❌ Failed to create timeline: {timeline_response.status_code}")
                print(f"Response: {timeline_response.text}")
        
        return project_id
        
    except Exception as e:
        print(f"❌ Error creating project: {e}")
        return None

def main():
    """Main function to upload videos and create OpenCut project."""
    print("🎬 Uploading videos to OpenCut via API...")
    
    # Find generated videos
    output_dir = Path("wan22_enhanced_output")
    video_pattern = output_dir / "shot_*_wan22_t2v.mp4"
    video_files = sorted(glob.glob(str(video_pattern)))
    
    if not video_files:
        print("❌ No video files found in wan22_enhanced_output/")
        return
    
    print(f"📁 Found {len(video_files)} video files:")
    for video in video_files:
        print(f"  - {os.path.basename(video)}")
    
    # Get project name from final film
    final_film = output_dir / "the_green_knight's_vigil_final_film.mp4"
    project_name = "The Green Knight's Vigil"
    
    if final_film.exists():
        project_name = "The Green Knight's Vigil"
    
    print(f"🎬 Creating OpenCut project: {project_name}")
    
    # Create project and upload videos
    project_id = create_opencut_project(project_name, video_files)
    
    if project_id:
        print(f"\n🎉 Success! OpenCut project created via API:")
        print(f"🌐 OpenCut URL: http://localhost:3000")
        print(f"📁 Project ID: {project_id}")
        print(f"🎬 Project Name: {project_name}")
        print(f"📊 Timeline: {len(video_files)} clips, {len(video_files) * 5}s total")
        
        # Open OpenCut in browser
        import webbrowser
        webbrowser.open(f"http://localhost:3000/projects/{project_id}")
        
    else:
        print("❌ Failed to create OpenCut project")

if __name__ == "__main__":
    main()
