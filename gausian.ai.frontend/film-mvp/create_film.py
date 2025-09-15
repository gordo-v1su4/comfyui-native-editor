#!/usr/bin/env python3
import json
import requests
import time
import subprocess
from pathlib import Path
from dotenv import load_dotenv
import os

# Load RunPod configuration
load_dotenv('.env.runpod')

# Get RunPod settings
RUNPOD_HOST = os.getenv("COMFY_HOST", "o2c41tri8h2drt-3000.proxy.runpod.net")
RUNPOD_PORT = int(os.getenv("COMFY_PORT", "443"))
BASE_URL = f"https://{RUNPOD_HOST}:{RUNPOD_PORT}"

def generate_shot_frames(workflow_template, prompt, negative, shot_id, num_frames=16):
    """Generate frames for a single shot."""
    
    print(f"🎬 Generating {num_frames} frames for shot {shot_id}...")
    print(f"📝 Prompt: {prompt[:50]}...")
    
    shot_dir = Path(f"shot_{shot_id:02d}_frames")
    shot_dir.mkdir(exist_ok=True)
    
    saved_frames = []
    
    for frame_idx in range(num_frames):
        # Create a seed that varies slightly for each frame
        seed = 123456789 + shot_id * 1000 + frame_idx * 10
        
        # Substitute placeholders
        def substitute_placeholders(workflow, prompt, negative, seed):
            def _rec(v):
                if isinstance(v, dict):
                    return {k: _rec(val) for k, val in v.items()}
                if isinstance(v, list):
                    return [_rec(x) for x in v]
                if isinstance(v, str):
                    if v == "{PROMPT}": return prompt
                    if v == "{NEGATIVE}": return negative
                    if v == "{SEED}": return seed
                    return v
                return v
            return _rec(workflow)
        
        workflow = substitute_placeholders(workflow_template, prompt, negative, seed)
        
        print(f"  📤 Frame {frame_idx + 1}/{num_frames}...")
        
        # Submit workflow
        response = requests.post(f"{BASE_URL}/prompt", json={"prompt": workflow}, timeout=60)
        if response.status_code != 200:
            print(f"    ❌ Error: {response.text}")
            continue
        
        result = response.json()
        prompt_id = result.get("prompt_id")
        
        # Wait for result
        start_time = time.time()
        while True:
            time.sleep(2)
            r = requests.get(f"{BASE_URL}/history/{prompt_id}")
            if r.status_code == 200:
                data = r.json()
                if prompt_id in data and data[prompt_id].get("outputs"):
                    # Download the generated image
                    outputs = data[prompt_id].get("outputs", {})
                    for node_id, output in outputs.items():
                        for img in output.get("images", []):
                            filename = img["filename"]
                            img_url = f"{BASE_URL}/view?filename={filename}"
                            img_response = requests.get(img_url, stream=True)
                            
                            if img_response.status_code == 200:
                                # Save the image locally
                                frame_path = shot_dir / f"frame_{frame_idx:02d}.png"
                                with open(frame_path, "wb") as f:
                                    f.write(img_response.content)
                                saved_frames.append(frame_path)
                                print(f"    ✅ Frame {frame_idx + 1} saved")
                                break
                    break
            
            # Timeout after 2 minutes per frame
            if time.time() - start_time > 120:
                print(f"    ❌ Frame {frame_idx + 1} timed out")
                break
    
    return saved_frames, shot_dir

def create_shot_video(frames, shot_dir, shot_id, fps=8):
    """Create a video from frames for a single shot."""
    if not frames:
        print(f"❌ No frames generated for shot {shot_id}")
        return None
    
    print(f"🎬 Creating video for shot {shot_id} from {len(frames)} frames...")
    
    # Create video using ffmpeg
    video_path = Path(f"shot_{shot_id:02d}_video.mp4")
    
    # Build ffmpeg command
    input_pattern = str(shot_dir / "frame_%02d.png")
    cmd = [
        "ffmpeg", "-y",  # Overwrite output
        "-framerate", str(fps),
        "-i", input_pattern,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-crf", "23",  # Good quality
        str(video_path)
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print(f"✅ Shot {shot_id} video created: {video_path}")
        return video_path
    except subprocess.CalledProcessError as e:
        print(f"❌ Error creating video for shot {shot_id}: {e.stderr}")
        return None

def create_final_film(video_paths, output_path, target_duration=60):
    """Create final 1-minute film from video clips."""
    if not video_paths:
        print("❌ No video clips to combine")
        return None
    
    print(f"🎬 Creating final {target_duration}s film from {len(video_paths)} clips...")
    
    # Create a file list for ffmpeg
    file_list = Path("video_list.txt")
    with open(file_list, "w") as f:
        for video_path in video_paths:
            if video_path and video_path.exists():
                f.write(f"file '{video_path}'\n")
    
    # Use ffmpeg to concatenate videos
    cmd = [
        "ffmpeg", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(file_list),
        "-c", "copy",
        str(output_path)
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print(f"🎉 Final film created: {output_path}")
        
        # Get video duration
        duration_cmd = [
            "ffprobe", "-v", "quiet", "-show_entries", "format=duration",
            "-of", "csv=p=0", str(output_path)
        ]
        duration_result = subprocess.run(duration_cmd, capture_output=True, text=True, check=True)
        duration = float(duration_result.stdout.strip())
        print(f"📊 Final duration: {duration:.1f}s")
        
        return output_path
    except subprocess.CalledProcessError as e:
        print(f"❌ Error creating final film: {e.stderr}")
        return None
    finally:
        # Clean up file list
        if file_list.exists():
            file_list.unlink()

def main():
    print("🎬 Starting 1-minute film generation...")
    
    # Load shots
    shots_file = Path("data/projects/test_gemini/shots_prompts_comfy.json")
    with open(shots_file, 'r') as f:
        shots_data = json.load(f)
    
    shots = shots_data["shots"]
    print(f"📋 Processing {len(shots)} shots...")
    
    # Load workflow template
    workflow_path = Path("workflows/sdxl_video_sequence.json")
    with open(workflow_path, 'r') as f:
        template = json.load(f)
    
    # Create output directory
    out_dir = Path("film_output")
    out_dir.mkdir(exist_ok=True)
    
    # Process each shot
    video_paths = []
    total_start_time = time.time()
    
    for shot_idx, shot in enumerate(shots):
        shot_id = shot["id"]
        prompt = shot["prompt"]
        negative = shot.get("negative", "blurry, low quality, low resolution")
        
        print(f"\n🎬 Shot {shot_idx + 1}/{len(shots)} (ID: {shot_id})")
        print(f"📝 Prompt: {prompt}")
        
        # Generate frames for this shot
        frames, shot_dir = generate_shot_frames(template, prompt, negative, shot_id, num_frames=16)
        
        if frames:
            # Create video from frames
            video_path = create_shot_video(frames, shot_dir, shot_id, fps=8)
            if video_path:
                video_paths.append(video_path)
        else:
            print(f"❌ Failed to generate frames for shot {shot_id}")
    
    # Create final film
    if video_paths:
        final_path = out_dir / "final_film.mp4"
        create_final_film(video_paths, final_path, target_duration=60)
        
        total_time = time.time() - total_start_time
        print(f"\n🎉 Film generation completed!")
        print(f"📁 Final film: {final_path}")
        print(f"📊 Generated {len(video_paths)} video clips")
        print(f"⏱️ Total time: {total_time/60:.1f} minutes")
        print(f"💰 Estimated RunPod cost: ${total_time/3600 * 0.6:.2f}")
    else:
        print("❌ No videos were generated successfully")

if __name__ == "__main__":
    main()
