#!/usr/bin/env python3
"""
Script to open OpenCut and provide instructions for uploading generated videos.
"""

import os
import webbrowser
import time
from pathlib import Path
import glob

def main():
    """Open OpenCut and provide upload instructions."""
    print("🎬 Opening OpenCut for video upload...")
    
    # Find generated videos
    output_dir = Path("wan22_enhanced_output")
    video_pattern = output_dir / "shot_*_wan22_t2v.mp4"
    video_files = sorted(glob.glob(str(video_pattern)))
    
    if not video_files:
        print("❌ No video files found in wan22_enhanced_output/")
        return
    
    print(f"📁 Found {len(video_files)} video files:")
    for i, video in enumerate(video_files, 1):
        print(f"  {i}. {os.path.basename(video)}")
    
    # Get project name
    project_name = "The Green Knight's Vigil"
    
    print(f"\n🎬 Opening OpenCut for project: {project_name}")
    print("🌐 URL: http://localhost:3000")
    
    # Open OpenCut in browser
    webbrowser.open("http://localhost:3000")
    
    print("\n📋 Manual Upload Instructions:")
    print("=" * 50)
    print("1. In OpenCut, create a new project or open existing project")
    print("2. Set project resolution to 720x480 for consistency")
    print("3. Drag and drop the following video files to the timeline:")
    
    for i, video in enumerate(video_files, 1):
        video_name = os.path.basename(video)
        print(f"   - {video_name}")
    
    print("\n4. Arrange videos in chronological order:")
    for i, video in enumerate(video_files, 1):
        video_name = os.path.basename(video)
        start_time = (i - 1) * 5.0
        print(f"   - {video_name} at {start_time}s")
    
    print(f"\n5. Total timeline duration: {len(video_files) * 5.0}s")
    print("6. Save the project when complete")
    
    print("\n📁 Video files location:")
    print(f"   {output_dir.absolute()}")
    
    print("\n🎉 Your AI-generated film is ready for editing in OpenCut!")

if __name__ == "__main__":
    main()


