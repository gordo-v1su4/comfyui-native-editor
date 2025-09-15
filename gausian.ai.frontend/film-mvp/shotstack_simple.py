#!/usr/bin/env python3
"""
Simple Shotstack integration for AI-generated videos.
"""

import os
import json
import webbrowser
from pathlib import Path
from typing import List, Dict, Any

def main():
    """Main function for Shotstack integration."""
    print("🎬 Shotstack Integration")
    print("=" * 50)
    
    # Check for API key
    api_key = os.getenv("SHOTSTACK_API_KEY")
    if not api_key:
        print("⚠️ No Shotstack API key found!")
        print("   Set the SHOTSTACK_API_KEY environment variable:")
        print("   export SHOTSTACK_API_KEY='your_api_key_here'")
        print("   Or get one from: https://shotstack.io/")
        print("\n📋 For now, you can:")
        print("   1. Visit https://shotstack.io/")
        print("   2. Sign up for an account")
        print("   3. Get your API key")
        print("   4. Set the environment variable")
        print("   5. Run this script again")
        
        # Open Shotstack website
        webbrowser.open("https://shotstack.io/")
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
    for video_file in video_files:
        print(f"  - {video_file.name}")
    
    print(f"\n✅ Ready to upload to Shotstack!")
    print(f"📁 Videos will be uploaded to Shotstack's cloud")
    print(f"🎬 You can edit them using Shotstack's professional tools")
    print(f"🌐 Visit: https://shotstack.io/")
    
    # Open Shotstack
    webbrowser.open("https://shotstack.io/")

if __name__ == "__main__":
    main()


