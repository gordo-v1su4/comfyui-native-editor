#!/usr/bin/env python3
"""
Wrapper script for the enhanced Wan 2.2 T2V pipeline with Flux Kontext and Shotstack integration.
"""

import subprocess
import sys
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("🎬 Enhanced Wan 2.2 T2V Pipeline with Flux Kontext & Shotstack")
        print("=" * 60)
        print("Usage:")
        print("  python run_enhanced_pipeline.py <runpod_endpoint> [options]")
        print("")
        print("Options:")
        print("  --character-prompt <text>  Character description for Flux Kontext")
        print("  --max-duration <seconds>   Maximum duration per clip (default: 5.0)")
        print("  --project <name>           Project name")
        print("")
        print("Example:")
        print("  python run_enhanced_pipeline.py hos2xy0zxfh6cu-8188.proxy.runpod.net")
        print("  python run_enhanced_pipeline.py hos2xy0zxfh6cu-8188.proxy.runpod.net --character-prompt 'A young woman with flowing hair and mystical aura'")
        print("")
        print("Features:")
        print("  ✅ Flux Kontext character generation for consistency")
        print("  ✅ Flexible video duration support")
        print("  ✅ Shotstack professional video editing")
        print("  ✅ Cloud-based video processing and editing")
        return 1

    runpod_endpoint = sys.argv[1]
    
    # Check if screenplay exists
    screenplay_paths = [
        Path("data/projects/mythical_discovery/shots_prompts_comfy.json"),
        Path("data/projects/test_screenplay/shots_prompts_comfy.json"),
        Path("data/projects/my_film/shots_prompts_comfy.json"),
        Path("data/projects/default/shots_prompts_comfy.json")
    ]
    
    screenplay_found = any(path.exists() for path in screenplay_paths)
    if not screenplay_found:
        print("❌ No screenplay found!")
        print("   Please run: python generate_screenplay.py")
        return 1

    # Build command
    cmd = [
        "python", "wan22_enhanced_pipeline.py",
        "--runpod", runpod_endpoint
    ]
    
    # Add additional arguments
    for i, arg in enumerate(sys.argv[2:], 2):
        if arg.startswith("--"):
            cmd.append(arg)
            if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith("--"):
                cmd.append(sys.argv[i + 1])

    print("🚀 Starting Enhanced Pipeline...")
    print(f"🌐 RunPod: {runpod_endpoint}")
    print(f"📋 Command: {' '.join(cmd)}")
    print("=" * 60)
    
    # Run the pipeline
    try:
        result = subprocess.run(cmd, check=True)
        print("=" * 60)
        print("🎉 Enhanced pipeline completed successfully!")
        return 0
    except subprocess.CalledProcessError as e:
        print("=" * 60)
        print(f"❌ Pipeline failed with exit code: {e.returncode}")
        return e.returncode
    except KeyboardInterrupt:
        print("\n⏹️ Pipeline interrupted by user")
        return 1

if __name__ == "__main__":
    sys.exit(main())
