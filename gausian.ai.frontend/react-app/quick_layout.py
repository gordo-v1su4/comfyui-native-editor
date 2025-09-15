#!/usr/bin/env python3
"""
Quick script to programmatically layout videos on timeline.
Usage: python quick_layout.py [sequential|parallel]
"""

import requests
import sys
import json

def quick_layout(layout_type="sequential"):
    """Quick layout function."""
    api_base_url = "http://localhost:3001"
    
    print(f"🎬 Quick Timeline Layout ({layout_type})")
    print("=" * 40)
    
    # Create project
    print("🎬 Creating project...")
    response = requests.post(f"{api_base_url}/api/projects", json={
        "name": f"Quick {layout_type.title()} Layout",
        "description": f"Automatically created {layout_type} layout"
    })
    
    if response.status_code != 201:
        print(f"❌ Failed to create project: {response.text}")
        return
    
    project_data = response.json()
    project_id = project_data["id"]
    print(f"✅ Project created: {project_id}")
    
    # Get videos
    print("📹 Getting videos...")
    response = requests.get(f"{api_base_url}/api/videos")
    
    if response.status_code != 200:
        print(f"❌ Failed to get videos: {response.text}")
        return
    
    videos = response.json()["videos"]
    videos.sort(key=lambda x: x["name"])
    print(f"✅ Found {len(videos)} videos")
    
    # Layout videos
    if layout_type == "sequential":
        current_time = 0.0
        for video in videos:
            timeline_item = {
                "type": "video",
                "videoId": video["id"],
                "videoPath": video["path"],
                "startTime": current_time,
                "duration": video.get("duration", 0),
                "track": 0
            }
            
            response = requests.post(
                f"{api_base_url}/api/projects/{project_id}/timeline",
                json=timeline_item
            )
            
            if response.status_code in [200, 201]:
                duration = video.get("duration", 0)
                print(f"✅ Added {video['name']} at {current_time:.2f}s ({duration:.2f}s)")
                current_time += duration + 0.5  # Add gap
            else:
                print(f"❌ Failed to add {video['name']}: {response.text}")
    
    elif layout_type == "parallel":
        track_times = [0.0, 0.0, 0.0]  # 3 tracks
        
        for video in videos:
            # Find track with earliest end time
            track = track_times.index(min(track_times))
            
            timeline_item = {
                "type": "video",
                "videoId": video["id"],
                "videoPath": video["path"],
                "startTime": track_times[track],
                "duration": video.get("duration", 0),
                "track": track
            }
            
            response = requests.post(
                f"{api_base_url}/api/projects/{project_id}/timeline",
                json=timeline_item
            )
            
            if response.status_code in [200, 201]:
                duration = video.get("duration", 0)
                print(f"✅ Added {video['name']} to track {track} at {track_times[track]:.2f}s ({duration:.2f}s)")
                track_times[track] += duration + 0.5  # Add gap
            else:
                print(f"❌ Failed to add {video['name']}: {response.text}")
    
    print(f"\n✅ Layout complete!")
    print(f"🌐 View in browser: http://localhost:5177")
    print(f"📋 Project ID: {project_id}")

if __name__ == "__main__":
    layout_type = sys.argv[1] if len(sys.argv) > 1 else "sequential"
    
    if layout_type not in ["sequential", "parallel"]:
        print("Usage: python quick_layout.py [sequential|parallel]")
        sys.exit(1)
    
    quick_layout(layout_type)
