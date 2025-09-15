#!/usr/bin/env python3
"""
Simple script to concatenate AI-generated videos using FFmpeg.
"""

import os
import subprocess
import webbrowser
from pathlib import Path
import time

def check_ffmpeg():
    """Check if FFmpeg is available."""
    try:
        result = subprocess.run(['ffmpeg', '-version'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            print("✅ FFmpeg is available")
            return True
        else:
            print("❌ FFmpeg not found")
            return False
    except (subprocess.TimeoutExpired, FileNotFoundError):
        print("❌ FFmpeg not found. Please install FFmpeg:")
        print("   macOS: brew install ffmpeg")
        print("   Ubuntu: sudo apt install ffmpeg")
        print("   Windows: Download from https://ffmpeg.org/")
        return False

def get_video_duration(video_path: str) -> float:
    """Get video duration using FFmpeg."""
    try:
        cmd = [
            'ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
            '-of', 'csv=p=0', video_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            return float(result.stdout.strip())
        else:
            return 5.0  # Default duration
            
    except Exception as e:
        print(f"⚠️ Could not get video duration: {e}")
        return 5.0  # Default duration

def concatenate_videos(video_files: list, output_name: str = "final_video.mp4") -> str:
    """Concatenate videos using FFmpeg."""
    try:
        if not video_files:
            raise Exception("No video files provided")
        
        # Create output directory
        output_dir = Path("final_videos")
        output_dir.mkdir(exist_ok=True)
        
        # Create file list for FFmpeg
        file_list_path = output_dir / "file_list.txt"
        with open(file_list_path, 'w') as f:
            for video_file in video_files:
                f.write(f"file '{os.path.abspath(video_file)}'\n")
        
        # Output path
        output_path = output_dir / output_name
        
        print(f"🎬 Concatenating {len(video_files)} videos...")
        print(f"📁 Output: {output_path}")
        
        # Concatenate videos using FFmpeg
        cmd = [
            'ffmpeg', '-f', 'concat', '-safe', '0',
            '-i', str(file_list_path),
            '-c', 'copy', str(output_path),
            '-y'  # Overwrite output file
        ]
        
        print(f"🔄 Running: {' '.join(cmd)}")
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        
        if result.returncode == 0:
            print(f"✅ Successfully created: {output_path}")
            return str(output_path)
        else:
            print(f"❌ FFmpeg failed: {result.stderr}")
            raise Exception(f"FFmpeg failed: {result.stderr}")
            
    except Exception as e:
        print(f"❌ Failed to concatenate videos: {e}")
        raise

def main():
    """Main function to concatenate AI-generated videos."""
    # Check FFmpeg
    if not check_ffmpeg():
        return
    
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
    total_duration = 0.0
    
    for i, video_file in enumerate(video_files, 1):
        duration = get_video_duration(str(video_file))
        total_duration += duration
        print(f"  {i:2d}. {video_file.name} ({duration:.2f}s)")
    
    print(f"📊 Total duration: {total_duration:.2f}s")
    
    try:
        # Create project name
        project_name = "The Green Knight's Vigil"
        output_name = f"{project_name.replace(' ', '_')}_final.mp4"
        
        # Concatenate videos
        final_video_path = concatenate_videos(video_files, output_name)
        
        print(f"\n🎉 Success! Final video created:")
        print(f"📁 File: {final_video_path}")
        print(f"⏱️ Duration: {total_duration:.2f}s")
        print(f"📊 Clips: {len(video_files)}")
        
        # Open the final video
        if os.path.exists(final_video_path):
            print(f"\n🚀 Opening final video...")
            webbrowser.open(f"file://{os.path.abspath(final_video_path)}")
        
        print(f"\n🎬 Your AI-generated film is ready!")
        print(f"📁 Final video: {final_video_path}")
        
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()


