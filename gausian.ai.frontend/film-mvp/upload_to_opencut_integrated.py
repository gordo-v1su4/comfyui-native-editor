#!/usr/bin/env python3
"""
Integrated script to upload videos and create OpenCut projects that appear in the UI.
"""

import os
import json
import requests
import base64
import time
from pathlib import Path
import glob

def upload_videos_and_create_project(project_name, video_files, opencut_url="http://localhost:3000"):
    """Upload videos and create a project that integrates with OpenCut UI."""
    try:
        print(f"🎬 Creating integrated project: {project_name}")
        
        # Prepare videos data
        videos_data = []
        for i, video_path in enumerate(video_files):
            print(f"📤 Preparing video {i+1}/{len(video_files)}: {os.path.basename(video_path)}")
            
            # Read and encode video
            with open(video_path, 'rb') as f:
                video_data = f.read()
                base64_data = base64.b64encode(video_data).decode('utf-8')
            
            # Add to videos array
            videos_data.append({
                "fileName": os.path.basename(video_path),
                "fileType": "video/mp4",
                "fileData": base64_data,
                "startTime": i * 5.0,  # 5 seconds per clip
                "duration": 5.0,
            })
        
        # Create integrated project
        project_data = {
            "name": project_name,
            "description": f"AI-generated film: {project_name}",
            "resolution": {"width": 720, "height": 480},
            "frameRate": 24,
            "videos": videos_data
        }
        
        print("🚀 Sending to OpenCut integration API...")
        response = requests.post(f"{opencut_url}/api/integrate-project", json=project_data)
        
        if response.status_code != 200:
            print(f"❌ Failed to create integrated project: {response.status_code}")
            print(f"Response: {response.text}")
            return None
            
        result = response.json()
        project_id = result.get('projectId')
        
        if not project_id:
            print("❌ No project ID returned")
            return None
            
        print(f"✅ Integrated project created: {project_name} (ID: {project_id})")
        print(f"📊 Timeline: {len(video_files)} clips, {len(video_files) * 5}s total")
        
        return project_id
        
    except Exception as e:
        print(f"❌ Error creating integrated project: {e}")
        return None

def main():
    """Main function to upload videos and create integrated OpenCut project."""
    print("🎬 Uploading videos to OpenCut with UI integration...")
    
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
    
    # Get project name
    project_name = "The Green Knight's Vigil"
    
    # Create integrated project
    project_id = upload_videos_and_create_project(project_name, video_files)
    
    if project_id:
        print(f"\n🎉 Success! Integrated project created:")
        print(f"🌐 OpenCut URL: http://localhost:3000")
        print(f"📁 Project ID: {project_id}")
        print(f"🎬 Project Name: {project_name}")
        
        # Now copy to OpenCut UI
        print(f"\n🔄 Copying project to OpenCut UI...")
        
        # Import and run the copy function
        try:
            from copy_project_to_opencut import copy_project_to_opencut_ui
            success = copy_project_to_opencut_ui(project_id)
            
            if success:
                print(f"✅ Project copied to OpenCut UI!")
                print(f"🌐 Check your projects at: http://localhost:3000/projects")
            else:
                print(f"❌ Failed to copy project to UI")
                
        except ImportError:
            print(f"⚠️  Copy script not available, but project data is saved")
            print(f"📁 Project data location: OpenCut/data/opencut-projects/{project_id}.json")
        
    else:
        print("❌ Failed to create integrated project")

if __name__ == "__main__":
    main()


