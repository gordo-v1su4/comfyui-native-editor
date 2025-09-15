#!/usr/bin/env python3
"""
Fully automated script to upload videos to OpenCut and make them immediately visible in the UI.
"""

import os
import json
import requests
import base64
import time
import webbrowser
from pathlib import Path
import glob

def upload_videos_and_create_project(project_name, video_files, opencut_url="http://localhost:3000"):
    """Upload videos and create a project that will be automatically visible in OpenCut UI."""
    try:
        print(f"🎬 Creating automated OpenCut project: {project_name}")
        
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
        
        # Create project data
        project_data = {
            "name": project_name,
            "description": f"AI-generated film: {project_name}",
            "resolution": {"width": 720, "height": 480},
            "frameRate": 24,
            "videos": videos_data
        }
        
        print("🚀 Sending to OpenCut automated API...")
        response = requests.post(f"{opencut_url}/api/create-opencut-project", json=project_data)
        
        if response.status_code != 200:
            print(f"❌ Failed to create automated project: {response.status_code}")
            print(f"Response: {response.text}")
            return None
            
        result = response.json()
        project_id = result.get('projectId')
        injection_url = result.get('injectionUrl')
        
        if not project_id:
            print("❌ No project ID returned")
            return None
            
        print(f"✅ Automated project created: {project_name} (ID: {project_id})")
        print(f"📊 Timeline: {len(video_files)} clips, {len(video_files) * 5}s total")
        
        # Create complete injection HTML file
        print("📄 Creating complete injection HTML file...")
        try:
            from create_complete_injection_html import create_complete_injection_html
            if create_complete_injection_html(project_id):
                print("✅ Complete injection HTML created successfully")
            else:
                print("⚠️ Failed to create complete injection HTML")
        except ImportError:
            print("⚠️ Complete injection HTML creation skipped")
        
        return {
            'project_id': project_id,
            'injection_url': f"http://localhost:3000/inject/{project_id}.html",
            'result': result
        }
        
    except Exception as e:
        print(f"❌ Error creating automated project: {e}")
        return None

def main():
    """Main function to upload videos and create automated OpenCut project."""
    print("🎬 Uploading videos to OpenCut with full automation...")
    
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
    
    # Create automated project
    result = upload_videos_and_create_project(project_name, video_files)
    
    if result:
        project_id = result['project_id']
        injection_url = result['injection_url']
        
        print(f"\n🎉 Success! Automated project created:")
        print(f"🌐 OpenCut URL: http://localhost:3000")
        print(f"📁 Project ID: {project_id}")
        print(f"🎬 Project Name: {project_name}")
        
        # Automatically open the injection page
        print(f"\n🔄 Opening auto-injection page...")
        print(f"📄 Injection URL: {injection_url}")
        
        try:
            webbrowser.open(injection_url)
            print(f"✅ Auto-injection page opened in browser")
            print(f"⏳ The project will be automatically injected into OpenCut's UI")
            print(f"🔄 You will be redirected to OpenCut's projects page in 2 seconds")
            print(f"📋 Your project should then appear in the projects list")
            
        except Exception as e:
            print(f"❌ Failed to open injection page: {e}")
            print(f"📋 Please manually open: {injection_url}")
        
        print(f"\n🎬 Your AI-generated film is ready for editing in OpenCut!")
        print(f"📁 Project data saved to: OpenCut/apps/web/data/opencut-projects/{project_id}.json")
        
    else:
        print("❌ Failed to create automated project")

if __name__ == "__main__":
    main()
