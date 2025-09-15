#!/usr/bin/env python3
"""
Script to properly lay out videos sequentially in the Quick Sequential Layout project.
This will add the 7 videos with correct timing, duration, and metadata.
"""

import requests
import json

def layout_sequential_project():
    """Lay out videos sequentially in the Quick Sequential Layout project."""
    api_base_url = "http://localhost:3001"
    project_id = "1bb94e2c-0b09-490e-a03d-a54a521f65c5"  # Quick Sequential Layout project
    
    print("🎬 Laying out videos in Quick Sequential Layout project")
    print("=" * 60)
    
    # 1. Get available videos
    print("1️⃣ Getting available videos...")
    response = requests.get(f"{api_base_url}/api/videos")
    
    if response.status_code != 200:
        print(f"❌ Failed to get videos: {response.text}")
        return
    
    videos = response.json().get("videos", [])
    print(f"✅ Found {len(videos)} videos")
    
    if len(videos) < 7:
        print(f"⚠️  Warning: Only {len(videos)} videos available, but we need 7")
    
    # 2. Clear existing timeline
    print("\n2️⃣ Clearing existing timeline...")
    timeline_response = requests.get(f"{api_base_url}/api/projects/{project_id}/timeline")
    
    if timeline_response.status_code == 200:
        timeline = timeline_response.json()
        tracks = timeline.get("tracks", [])
        
        # Delete existing items
        for track in tracks:
            items = track.get("items", [])
            for item in items:
                delete_response = requests.delete(
                    f"{api_base_url}/api/projects/{project_id}/timeline/{item['id']}"
                )
                if delete_response.status_code in [200, 204]:
                    print(f"   🗑️  Deleted item: {item.get('name', 'Unknown')}")
    
    # 3. Add videos sequentially
    print("\n3️⃣ Adding videos sequentially...")
    current_time = 0.0
    
    for i, video in enumerate(videos[:7]):  # Only use first 7 videos
        video_name = video.get("name", f"Video {i+1}")
        duration = video.get("duration", 4.0)  # Default 4 seconds if not available
        
        # Convert duration from seconds to frames (assuming 30fps)
        duration_in_frames = int(duration * 30)
        start_frame = int(current_time * 30)
        
        timeline_item = {
            "videoId": video.get("name", ""),  # Use filename as videoId
            "trackIndex": 0,
            "startFrame": start_frame,
            "durationInFrames": duration_in_frames
        }
        
        response = requests.post(
            f"{api_base_url}/api/projects/{project_id}/timeline",
            headers={"Content-Type": "application/json"},
            json=timeline_item
        )
        
        if response.status_code in [200, 201]:
            print(f"✅ Added {video_name} at {current_time:.2f}s (duration: {duration:.2f}s)")
            current_time += duration
        else:
            print(f"❌ Failed to add {video_name}: {response.text}")
    
    # 4. Verify the layout
    print("\n4️⃣ Verifying timeline layout...")
    timeline_response = requests.get(f"{api_base_url}/api/projects/{project_id}/timeline")
    
    if timeline_response.status_code == 200:
        timeline = timeline_response.json()
        tracks = timeline.get("tracks", [])
        
        if tracks and tracks[0].get("items"):
            items = tracks[0]["items"]
            print(f"✅ Timeline has {len(items)} items")
            print("📋 Timeline layout:")
            
            for i, item in enumerate(items):
                src = item.get("src", "Unknown")
                name = src.split("/")[-1] if src != "Unknown" else "Unknown"
                start_frames = item.get("from", 0)
                duration_frames = item.get("durationInFrames", 0)
                start_seconds = start_frames / 30.0  # Convert frames to seconds
                duration_seconds = duration_frames / 30.0
                print(f"   {i+1}. {name} (start: {start_seconds:.2f}s, duration: {duration_seconds:.2f}s)")
            
            total_duration_frames = sum(item.get("durationInFrames", 0) for item in items)
            total_duration = total_duration_frames / 30.0
            print(f"\n📊 Total timeline duration: {total_duration:.2f} seconds")
        else:
            print("⚠️  No items found in timeline")
    else:
        print(f"❌ Failed to get timeline: {timeline_response.text}")
    
    print(f"\n🎉 Sequential layout complete!")
    print(f"🌐 View in browser: http://localhost:5177")
    print(f"📁 Project ID: {project_id}")

if __name__ == "__main__":
    layout_sequential_project()
