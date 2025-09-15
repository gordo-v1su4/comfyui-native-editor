#!/usr/bin/env python3
"""
Script to clean up duplicate videos from the API server.
"""

import requests
import json

def cleanup_duplicates():
    """Remove duplicate videos from the API server."""
    
    print("🧹 Cleaning up duplicate videos...")
    
    try:
        # Get all videos
        response = requests.get("http://localhost:3001/api/videos")
        response.raise_for_status()
        data = response.json()
        
        videos = data["videos"]
        print(f"Found {len(videos)} total videos")
        
        # Group by original filename (without timestamp)
        video_groups = {}
        for video in videos:
            # Extract original filename (remove timestamp prefix)
            if "-shot_" in video["name"]:
                original_name = video["name"].split("-shot_")[1]  # Get "shot_01.mp4" part
            else:
                original_name = video["name"]
            
            if original_name not in video_groups:
                video_groups[original_name] = []
            video_groups[original_name].append(video)
        
        # Keep only the most recent version of each video
        videos_to_keep = []
        videos_to_remove = []
        
        for original_name, video_list in video_groups.items():
            if len(video_list) > 1:
                print(f"📁 {original_name}: {len(video_list)} duplicates found")
                
                # Sort by upload time (newest first)
                sorted_videos = sorted(video_list, key=lambda x: x["uploadedAt"], reverse=True)
                
                # Keep the newest one
                videos_to_keep.append(sorted_videos[0])
                videos_to_remove.extend(sorted_videos[1:])
                
                print(f"   ✅ Keeping: {sorted_videos[0]['name']}")
                for video in sorted_videos[1:]:
                    print(f"   ❌ Removing: {video['name']}")
            else:
                videos_to_keep.append(video_list[0])
        
        print(f"\n📊 Summary:")
        print(f"   Videos to keep: {len(videos_to_keep)}")
        print(f"   Videos to remove: {len(videos_to_remove)}")
        
        if videos_to_remove:
            # Note: The current API doesn't have a delete endpoint
            # We'll need to manually clean up the files
            print(f"\n⚠️  Note: API doesn't have delete endpoint yet.")
            print(f"   To clean up, you can:")
            print(f"   1. Stop the API server")
            print(f"   2. Delete files from: public/uploads/")
            print(f"   3. Restart the API server")
            
            # Show which files to delete
            print(f"\n📋 Files to delete manually:")
            for video in videos_to_remove:
                print(f"   - {video['name']}")
        else:
            print("✅ No duplicates found!")
            
        return videos_to_keep
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return []

if __name__ == "__main__":
    cleanup_duplicates()
