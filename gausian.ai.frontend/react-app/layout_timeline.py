#!/usr/bin/env python3
"""
Script to programmatically lay out imported videos on the timeline.
This script will:
1. Create a new project
2. Get all available videos from the API
3. Add them to the timeline in sequence
4. Display the final timeline layout
"""

import requests
import json
import time
from typing import List, Dict, Any

class TimelineLayout:
    def __init__(self, api_base_url: str = "http://localhost:3001"):
        self.api_base_url = api_base_url
        self.project_id = None
        
    def create_project(self, name: str = "Auto Layout Project") -> str:
        """Create a new project and return the project ID."""
        print(f"🎬 Creating project: {name}")
        
        response = requests.post(f"{self.api_base_url}/api/projects", json={
            "name": name,
            "description": "Automatically created project with timeline layout"
        })
        
        if response.status_code == 201:
            project_data = response.json()
            self.project_id = project_data["id"]
            print(f"✅ Project created with ID: {self.project_id}")
            return self.project_id
        else:
            raise Exception(f"Failed to create project: {response.text}")
    
    def get_available_videos(self) -> List[Dict[str, Any]]:
        """Get all available videos from the API."""
        print("📹 Fetching available videos...")
        
        response = requests.get(f"{self.api_base_url}/api/videos")
        
        if response.status_code == 200:
            data = response.json()
            videos = data["videos"]
            print(f"✅ Found {len(videos)} videos")
            
            # Sort videos by name to ensure consistent order
            videos.sort(key=lambda x: x["name"])
            
            for video in videos:
                print(f"   📹 {video['name']} ({video.get('duration', 0):.2f}s)")
            
            return videos
        else:
            raise Exception(f"Failed to get videos: {response.text}")
    
    def add_video_to_timeline(self, video: Dict[str, Any], start_time: float = 0) -> Dict[str, Any]:
        """Add a video to the timeline at a specific start time."""
        if not self.project_id:
            raise Exception("No project created. Call create_project() first.")
        
        timeline_item = {
            "type": "video",
            "videoId": video["id"],
            "videoPath": video["path"],
            "startTime": start_time,
            "duration": video.get("duration", 0),
            "track": 0  # Place all videos on track 0
        }
        
        print(f"🎬 Adding {video['name']} to timeline at {start_time:.2f}s")
        
        response = requests.post(
            f"{self.api_base_url}/api/projects/{self.project_id}/timeline",
            json=timeline_item
        )
        
        if response.status_code == 201:
            result = response.json()
            print(f"✅ Added to timeline with ID: {result['itemId']}")
            return result
        else:
            raise Exception(f"Failed to add video to timeline: {response.text}")
    
    def layout_videos_sequentially(self, videos: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Layout videos sequentially on the timeline."""
        print("\n🎬 Laying out videos sequentially on timeline...")
        
        timeline_items = []
        current_time = 0.0
        
        for video in videos:
            # Add video to timeline
            result = self.add_video_to_timeline(video, current_time)
            timeline_items.append(result)
            
            # Move to next position
            duration = video.get("duration", 0)
            current_time += duration
            
            # Add a small gap between videos (0.5 seconds)
            current_time += 0.5
        
        print(f"✅ Layout complete! Total timeline duration: {current_time:.2f}s")
        return timeline_items
    
    def layout_videos_parallel(self, videos: List[Dict[str, Any]], max_tracks: int = 3) -> List[Dict[str, Any]]:
        """Layout videos in parallel across multiple tracks."""
        print(f"\n🎬 Laying out videos in parallel across {max_tracks} tracks...")
        
        timeline_items = []
        track_times = [0.0] * max_tracks  # Track current time for each track
        
        for i, video in enumerate(videos):
            # Find track with earliest end time
            track = track_times.index(min(track_times))
            
            # Add video to timeline on this track
            timeline_item = {
                "type": "video",
                "videoId": video["id"],
                "videoPath": video["path"],
                "startTime": track_times[track],
                "duration": video.get("duration", 0),
                "track": track
            }
            
            print(f"🎬 Adding {video['name']} to track {track} at {track_times[track]:.2f}s")
            
            response = requests.post(
                f"{self.api_base_url}/api/projects/{self.project_id}/timeline",
                json=timeline_item
            )
            
            if response.status_code == 201:
                result = response.json()
                timeline_items.append(result)
                
                # Update track time
                duration = video.get("duration", 0)
                track_times[track] += duration + 0.5  # Add gap
                
                print(f"✅ Added to timeline with ID: {result['itemId']}")
            else:
                raise Exception(f"Failed to add video to timeline: {response.text}")
        
        max_time = max(track_times)
        print(f"✅ Parallel layout complete! Timeline duration: {max_time:.2f}s")
        return timeline_items
    
    def get_timeline(self) -> Dict[str, Any]:
        """Get the current timeline for the project."""
        if not self.project_id:
            raise Exception("No project created. Call create_project() first.")
        
        response = requests.get(f"{self.api_base_url}/api/projects/{self.project_id}/timeline")
        
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Failed to get timeline: {response.text}")
    
    def display_timeline(self):
        """Display the current timeline layout."""
        print("\n📋 Current Timeline Layout:")
        print("=" * 60)
        
        timeline = self.get_timeline()
        tracks = timeline.get("tracks", [])
        
        for track_idx, track in enumerate(tracks):
            print(f"\n🎵 Track {track_idx}:")
            for item in track.get("items", []):
                print(f"   📹 {item.get('name', 'Unknown')} | "
                      f"Start: {item.get('startTime', 0):.2f}s | "
                      f"Duration: {item.get('duration', 0):.2f}s")
    
    def open_in_browser(self):
        """Open the project in the browser."""
        if self.project_id:
            url = f"http://localhost:5177"
            print(f"\n🌐 Opening project in browser: {url}")
            print(f"   Project ID: {self.project_id}")
            return url
        else:
            raise Exception("No project created. Call create_project() first.")

def main():
    """Main function to demonstrate timeline layout."""
    print("🎬 Timeline Layout Script")
    print("=" * 40)
    
    # Initialize timeline layout
    layout = TimelineLayout()
    
    try:
        # Create a new project
        layout.create_project("Auto Layout Demo")
        
        # Get available videos
        videos = layout.get_available_videos()
        
        if not videos:
            print("❌ No videos found. Please upload some videos first.")
            return
        
        # Choose layout method
        print("\n🎬 Choose layout method:")
        print("1. Sequential layout (videos in sequence)")
        print("2. Parallel layout (videos across multiple tracks)")
        
        choice = input("Enter choice (1 or 2): ").strip()
        
        if choice == "1":
            # Sequential layout
            layout.layout_videos_sequentially(videos)
        elif choice == "2":
            # Parallel layout
            max_tracks = int(input("Enter number of tracks (default 3): ") or "3")
            layout.layout_videos_parallel(videos, max_tracks)
        else:
            print("Invalid choice. Using sequential layout.")
            layout.layout_videos_sequentially(videos)
        
        # Display final timeline
        layout.display_timeline()
        
        # Open in browser
        url = layout.open_in_browser()
        print(f"\n✅ Timeline layout complete!")
        print(f"🌐 View in browser: {url}")
        
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()
