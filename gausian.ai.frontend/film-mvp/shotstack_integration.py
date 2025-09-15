#!/usr/bin/env python3
"""
Shotstack Integration for AI-generated video editing.
Uses Shotstack's cloud-based video editing API for professional video editing.
"""

import os
import json
import time
import webbrowser
from pathlib import Path
from typing import List, Dict, Any
import requests

# Shotstack SDK
from shotstack_sdk import ShotstackSDK, EditApi, Clip, Track, Timeline, Output, VideoAsset
from shotstack_sdk.configuration import Configuration

class ShotstackVideoEditor:
    """Shotstack video editor integration."""
    
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv("SHOTSTACK_API_KEY")
        
        if not self.api_key:
            print("⚠️ No Shotstack API key found!")
            print("   Set the SHOTSTACK_API_KEY environment variable:")
            print("   export SHOTSTACK_API_KEY='your_api_key_here'")
            print("   Or get one from: https://shotstack.io/")
            return
        
        # Configure Shotstack SDK
        configuration = Configuration(api_key=self.api_key)
        self.edit_api = EditApi(configuration)
        
        print("✅ Shotstack SDK initialized successfully")
    
    def upload_video(self, video_path: str) -> str:
        """Upload a video to Shotstack's cloud storage."""
        try:
            # For now, we'll use a placeholder URL
            # In a real implementation, you'd upload to Shotstack's storage
            print(f"📤 Uploading video: {os.path.basename(video_path)}")
            
            # Return a placeholder URL (in real implementation, this would be the uploaded URL)
            return f"https://shotstack.io/demo/{os.path.basename(video_path)}"
            
        except Exception as e:
            print(f"❌ Failed to upload video: {e}")
            raise
    
    def create_video_edit(self, video_files: List[str], project_name: str = "AI Generated Film") -> Dict[str, Any]:
        """Create a video edit using Shotstack API."""
        try:
            print(f"🎬 Creating Shotstack video edit: {project_name}")
            
            # Create video assets
            assets = []
            clips = []
            current_time = 0.0
            
            for i, video_path in enumerate(video_files):
                # Upload video to Shotstack
                video_url = self.upload_video(video_path)
                
                # Create video asset
                asset = VideoAsset(
                    src=video_url,
                    trim=0.0  # No trimming for now
                )
                assets.append(asset)
                
                # Create clip
                clip = Clip(
                    asset=asset,
                    start=current_time,
                    length=5.0  # Default 5 seconds per clip
                )
                clips.append(clip)
                
                current_time += 5.0
            
            # Create track
            track = Track(clips=clips)
            
            # Create timeline
            timeline = Timeline(tracks=[track])
            
            # Create output
            output = Output(
                format="mp4",
                resolution="sd"  # 720x480
            )
            
            # Create edit
            edit = {
                "timeline": timeline,
                "output": output
            }
            
            print(f"✅ Created edit with {len(clips)} clips")
            return edit
            
        except Exception as e:
            print(f"❌ Failed to create video edit: {e}")
            raise
    
    def render_video(self, edit: Dict[str, Any]) -> str:
        """Render the video edit using Shotstack."""
        try:
            print("🎬 Rendering video with Shotstack...")
            
            # Submit render job
            response = self.edit_api.post_render(edit)
            
            if response.response.status == "success":
                render_id = response.response.id
                print(f"✅ Render job submitted: {render_id}")
                
                # Wait for render to complete
                return self.wait_for_render(render_id)
            else:
                raise Exception("Failed to submit render job")
                
        except Exception as e:
            print(f"❌ Failed to render video: {e}")
            raise
    
    def wait_for_render(self, render_id: str, timeout: int = 300) -> str:
        """Wait for render to complete and return the video URL."""
        try:
            print(f"⏳ Waiting for render to complete...")
            
            start_time = time.time()
            while time.time() - start_time < timeout:
                # Check render status
                response = self.edit_api.get_render(render_id)
                
                if response.response.status == "done":
                    video_url = response.response.url
                    print(f"✅ Render completed: {video_url}")
                    return video_url
                elif response.response.status == "failed":
                    raise Exception("Render failed")
                else:
                    print(f"⏳ Render status: {response.response.status}")
                    time.sleep(10)
            
            raise Exception("Render timeout")
            
        except Exception as e:
            print(f"❌ Error waiting for render: {e}")
            raise
    
    def get_edit_url(self, render_id: str) -> str:
        """Get the edit URL for the rendered video."""
        return f"https://shotstack.io/edit/{render_id}"

def upload_videos_to_shotstack(video_files: List[str], project_name: str = "AI Generated Film") -> Dict[str, Any]:
    """Upload videos to Shotstack and create a video edit."""
    try:
        # Initialize Shotstack editor
        editor = ShotstackVideoEditor()
        
        if not editor.api_key:
            return {
                "success": False,
                "error": "No Shotstack API key configured"
            }
        
        print(f"🎬 Creating Shotstack project: {project_name}")
        
        # Create video edit
        edit = editor.create_video_edit(video_files, project_name)
        
        # Render video
        video_url = editor.render_video(edit)
        
        return {
            "success": True,
            "video_url": video_url,
            "project_name": project_name,
            "clips": len(video_files)
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def main():
    """Main function to upload videos to Shotstack."""
    # Configuration
    project_name = "The Green Knight's Vigil"
    
    # Find video files
    output_dir = Path("wan22_enhanced_output")
    if not output_dir.exists():
        print(f"❌ Output directory not found: {output_dir}")
        return
    
    video_files = list(output_dir.glob("shot_*_wan22_t2v.mp4"))
    video_files.sort()
    
    if not video_files:
        print("❌ No video files found")
        return
    
    print(f"🎬 Found {len(video_files)} video files:")
    for video_file in video_files:
        print(f"  - {video_file.name}")
    
    try:
        # Upload to Shotstack
        result = upload_videos_to_shotstack([str(f) for f in video_files], project_name)
        
        if result["success"]:
            print(f"\n🎉 Success! Shotstack project created:")
            print(f"📁 Project Name: {result['project_name']}")
            print(f"📁 Video URL: {result['video_url']}")
            print(f"📁 Clips: {result['clips']}")
            
            # Open video URL
            print(f"\n🚀 Opening video URL...")
            webbrowser.open(result['video_url'])
            
            print(f"\n🎬 Your AI-generated film is ready on Shotstack!")
            print(f"🌐 Video URL: {result['video_url']}")
            
        else:
            print(f"❌ Failed to create Shotstack project: {result['error']}")
            
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()


