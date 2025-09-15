#!/usr/bin/env python3
"""
Enhanced Wan 2.2 T2V pipeline with character consistency and OpenCut integration.
"""

import json
import requests
import time
import subprocess
from pathlib import Path
from dotenv import load_dotenv
import os
import tempfile
import shutil
import webbrowser

# Get RunPod settings - configurable endpoint
RUNPOD_HOST = "hos2xy0zxfh6cu-8188.proxy.runpod.net"  # New endpoint
RUNPOD_PORT = 443
BASE_URL = f"https://{RUNPOD_HOST}:{RUNPOD_PORT}"

def test_wan22_models():
    """Test if Wan 2.2 models are available."""
    try:
        response = requests.get(f"{BASE_URL}/object_info", timeout=10)
        if response.status_code == 200:
            data = response.json()
            
            # Check for Wan 2.2 models
            unet_models = data.get("UNETLoader", {}).get("input", {}).get("required", {}).get("unet_name", [])
            if isinstance(unet_models, list) and len(unet_models) > 0:
                if isinstance(unet_models[0], list):
                    unet_models = unet_models[0]
            
            wan22_available = any("wan2.2" in model.lower() for model in unet_models)
            print(f"📊 Wan 2.2 models available: {wan22_available}")
            
            if wan22_available:
                print("✅ Wan 2.2 models found!")
                return True
            else:
                print("❌ Wan 2.2 models not available!")
                return False
        else:
            print(f"❌ API test failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ API test failed: {e}")
        return False

def calculate_frames(duration_seconds, fps=24):
    """Calculate number of frames for given duration."""
    return int(duration_seconds * fps)

def enhance_prompt_with_character(prompt, character_description):
    """Enhance video prompt with character consistency."""
    if character_description:
        # Extract key character traits
        character_traits = character_description.lower()
        
        # Add character consistency to the prompt
        enhanced_prompt = f"{prompt}, {character_description}, consistent character appearance, same person throughout"
        
        # Add specific character details if mentioned
        if "hair" in character_traits:
            enhanced_prompt += ", consistent hair style and color"
        if "clothing" in character_traits or "attire" in character_traits:
            enhanced_prompt += ", consistent clothing style"
        if "age" in character_traits:
            enhanced_prompt += ", consistent age appearance"
        
        return enhanced_prompt
    return prompt

def generate_wan22_video(workflow_template, prompt, negative, seed, shot_id, duration_seconds=2.0, character_description=None):
    """Generate Wan 2.2 video with flexible duration and character consistency."""
    
    # Calculate frames for the duration
    frames = calculate_frames(duration_seconds)
    
    # Create workflow with dynamic duration
    workflow = json.loads(json.dumps(workflow_template))
    
    # Enhance prompt with character consistency
    enhanced_prompt = enhance_prompt_with_character(prompt, character_description)
    
    # Clean the prompt for JSON compatibility (remove newlines and special characters)
    clean_prompt = enhanced_prompt.replace('\n', ' ').replace('\r', ' ').replace('"', "'")
    clean_negative = negative.replace('\n', ' ').replace('\r', ' ').replace('"', "'")
    
    # Replace placeholders
    workflow_str = json.dumps(workflow)
    workflow_str = workflow_str.replace("{PROMPT}", clean_prompt)
    workflow_str = workflow_str.replace("{NEGATIVE}", clean_negative)
    workflow_str = workflow_str.replace("{SEED}", str(seed))
    workflow_str = workflow_str.replace("{LENGTH}", str(frames))
    # Enforce compact resolution for speed
    workflow_str = workflow_str.replace("{WIDTH}", str(720))
    workflow_str = workflow_str.replace("{HEIGHT}", str(480))
    
    workflow = json.loads(workflow_str)
    
    print(f"🎬 Generating Wan 2.2 video for shot {shot_id}...")
    print(f"📝 Original prompt: {prompt[:50]}...")
    print(f"📝 Enhanced prompt: {enhanced_prompt[:50]}...")
    print(f"⏱️ Duration: {duration_seconds}s ({frames} frames)")
    
    # Submit workflow
    try:
        response = requests.post(f"{BASE_URL}/prompt", json={"prompt": workflow}, timeout=30)
        if response.status_code == 200:
            result = response.json()
            prompt_id = result["prompt_id"]
            print(f"✅ Shot {shot_id} queued with ID: {prompt_id}")
            
            # Wait for completion
            start_time = time.time()
            while True:
                time.sleep(2)
                elapsed = time.time() - start_time
                
                try:
                    history_response = requests.get(f"{BASE_URL}/history/{prompt_id}", timeout=10)
                    if history_response.status_code == 200:
                        history = history_response.json()
                        if prompt_id in history:
                            result = history[prompt_id]
                            if "outputs" in result:
                                print(f"✅ Shot {shot_id} completed in {elapsed:.1f}s!")
                                return result
                    else:
                        print(f"⏳ Shot {shot_id} still processing... ({elapsed:.1f}s elapsed)")
                except Exception as e:
                    print(f"⏳ Shot {shot_id} still processing... ({elapsed:.1f}s elapsed)")
                
                if elapsed > 900:  # 15 minutes timeout
                    print(f"❌ Shot {shot_id} timed out after 15 minutes")
                    return None
                    
        else:
            print(f"❌ Error submitting shot {shot_id}: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Error submitting shot {shot_id}: {e}")
        return None

def download_video(result, shot_id, out_dir, is_extension=False):
    """Download the generated video file."""
    outputs = result.get("outputs", {})
    
    for node_id, output in outputs.items():
        # Check for gifs (MP4 videos from VHS_VideoCombine)
        if "gifs" in output:
            for gif in output["gifs"]:
                filename = gif["filename"]
                print(f"📥 Downloading video: {filename}")
                
                video_url = f"{BASE_URL}/view?filename={filename}"
                try:
                    video_response = requests.get(video_url, stream=True, timeout=60)
                    if video_response.status_code == 200:
                        prefix = "extension" if is_extension else "shot"
                        video_path = out_dir / f"{prefix}_{shot_id:02d}_wan22_t2v.mp4"
                        with open(video_path, "wb") as f:
                            for chunk in video_response.iter_content(chunk_size=8192):
                                f.write(chunk)
                        print(f"✅ Video saved: {video_path}")
                        return video_path
                    else:
                        print(f"❌ Failed to download video: {video_response.status_code}")
                except Exception as e:
                    print(f"❌ Error downloading video: {e}")
        
        # Also check for images (fallback)
        elif "images" in output:
            for img in output["images"]:
                filename = img["filename"]
                print(f"📥 Downloading image: {filename}")
                image_url = f"{BASE_URL}/view?filename={filename}"
                try:
                    image_response = requests.get(image_url, stream=True, timeout=60)
                    if image_response.status_code == 200:
                        prefix = "extension" if is_extension else "shot"
                        image_path = out_dir / f"{prefix}_{shot_id:02d}_wan22_t2v.png"
                        with open(image_path, "wb") as f:
                            for chunk in image_response.iter_content(chunk_size=8192):
                                f.write(chunk)
                        print(f"✅ Image saved: {image_path}")
                        return image_path
                    else:
                        print(f"❌ Failed to download image: {image_response.status_code}")
                except Exception as e:
                    print(f"❌ Error downloading image: {e}")
    return None

def concatenate_videos(video_paths, output_path):
    """Concatenate multiple video files."""
    if not video_paths:
        print("❌ No video clips to combine")
        return None
    
    print(f"🎬 Creating final film from {len(video_paths)} clips...")
    
    # Create a file list for ffmpeg
    file_list = Path("wan22_enhanced_video_list.txt")
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

def create_opencut_project(video_paths, character_description, project_name, out_dir):
    """Create an OpenCut project file for video editing."""
    
    # Create OpenCut project structure
    opencut_dir = out_dir / "opencut_project"
    opencut_dir.mkdir(exist_ok=True)
    
    # Copy videos to OpenCut project
    media_dir = opencut_dir / "media"
    media_dir.mkdir(exist_ok=True)
    
    video_files = []
    for i, video_path in enumerate(video_paths):
        if video_path and video_path.exists():
            # Copy video to media directory
            new_video_path = media_dir / f"shot_{i+1:02d}.mp4"
            shutil.copy2(video_path, new_video_path)
            video_files.append(str(new_video_path))
    
    # Create character reference text file
    if character_description:
        character_file = media_dir / "character_description.txt"
        with open(character_file, 'w') as f:
            f.write(f"Character Description: {character_description}\n")
            f.write(f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Project: {project_name}\n")
    
    # Create OpenCut project file
    project_data = {
        "name": project_name,
        "version": "1.0.0",
        "character_description": character_description,
        "timeline": {
            "tracks": [
                {
                    "id": "video_track_1",
                    "type": "video",
                    "clips": []
                }
            ]
        },
        "media": video_files,
        "settings": {
            "resolution": "1920x1080",
            "fps": 24,
            "duration": 0
        }
    }
    
    # Add clips to timeline
    current_time = 0
    for i, video_path in enumerate(video_files):
        # Get video duration
        try:
            duration_cmd = [
                "ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                "-of", "csv=p=0", video_path
            ]
            duration_result = subprocess.run(duration_cmd, capture_output=True, text=True, check=True)
            duration = float(duration_result.stdout.strip())
        except:
            duration = 5.0  # Default duration
        
        clip_data = {
            "id": f"clip_{i+1}",
            "media_path": video_path,
            "start_time": current_time,
            "duration": duration,
            "name": f"Shot {i+1}"
        }
        
        project_data["timeline"]["tracks"][0]["clips"].append(clip_data)
        current_time += duration
    
    project_data["settings"]["duration"] = current_time
    
    # Save project file
    project_file = opencut_dir / f"{project_name}.opencut"
    with open(project_file, 'w') as f:
        json.dump(project_data, f, indent=2)
    
    print(f"🎬 OpenCut project created: {project_file}")
    return project_file

def open_opencut_project(project_file):
    """Open the OpenCut project in the browser."""
    try:
        # Try to open OpenCut if it's installed locally
        opencut_cmd = ["opencut", str(project_file)]
        subprocess.run(opencut_cmd, check=True)
        print("🎬 Opened OpenCut project in application")
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Launch Shotstack integration
        print("🎬 Launching Shotstack integration...")
        try:
            import subprocess
            import sys
            
            # Launch Shotstack integration
            print("📤 Starting Shotstack integration...")
            subprocess.run([
                sys.executable, "shotstack_simple.py"
            ], check=True)
            
            print("✅ Shotstack integration completed!")
            print("🌐 Visit: https://shotstack.io/")
            print("📁 You can now edit your videos using Shotstack's professional tools")
            
        except Exception as e:
            print(f"⚠️ Failed to launch Shotstack integration: {e}")
            print("📁 You can manually run the Shotstack integration")
            print("💡 Run: python shotstack_simple.py")

def main():
    """Main function."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Generate Wan 2.2 T2V videos with character consistency and OpenCut integration")
    parser.add_argument("--runpod", "-r", help="RunPod endpoint")
    parser.add_argument("--port", "-p", type=int, default=443, help="RunPod port")
    parser.add_argument("--project", help="Project name to use")
    parser.add_argument("--max-duration", type=float, default=5.0, help="Maximum duration per clip before extension")
    parser.add_argument("--character-prompt", help="Character description for consistency")
    
    args = parser.parse_args()
    
    # Update BASE_URL if RunPod endpoint provided
    global BASE_URL
    if args.runpod:
        RUNPOD_HOST = args.runpod
        RUNPOD_PORT = args.port
        BASE_URL = f"https://{RUNPOD_HOST}:{RUNPOD_PORT}"
    
    print("🎬 Starting Enhanced Wan 2.2 T2V Pipeline with Character Consistency & OpenCut...")
    print(f"🌐 Using: {BASE_URL}")
    print(f"⏱️ Max duration per clip: {args.max_duration}s")
    
    # Test model availability
    if not test_wan22_models():
        print("❌ Wan 2.2 models not available!")
        return
    
    # Load shots
    shots_file = None
    possible_paths = [
        Path("data/projects/lin_to_past/shots_prompts_comfy.json"),
        Path("data/projects/mythical_discovery/shots_prompts_comfy.json"),
        Path("data/projects/test_screenplay/shots_prompts_comfy.json"),
        Path("data/projects/my_film/shots_prompts_comfy.json"),
        Path("data/projects/default/shots_prompts_comfy.json")
    ]
    
    for path in possible_paths:
        if path.exists():
            shots_file = path
            break
    
    if not shots_file:
        print("❌ No shots_prompts_comfy.json found!")
        print("   Please run: python generate_screenplay.py")
        return
    
    with open(shots_file, 'r') as f:
        shots_data = json.load(f)
    
    shots = shots_data["shots"]
    project_name = shots_data.get("title", "My Film")
    print(f"📋 Processing {len(shots)} shots for: {project_name}")
    print(f"📁 Using: {shots_file}")
    
    # Load workflow template
    t2v_workflow_path = Path("workflows/wan22_t2v_flexible.json")
    
    with open(t2v_workflow_path, 'r') as f:
        t2v_template = json.load(f)
    
    # Create output directory
    out_dir = Path("wan22_enhanced_output")
    out_dir.mkdir(exist_ok=True)
    
    # Get character description
    character_description = args.character_prompt or "A young woman in her late 20s, beautiful, modern, professional appearance, clear facial features, consistent character design"
    
    print(f"\n🎨 Character consistency enabled:")
    print(f"📝 Character: {character_description}")
    
    # Process each shot
    final_video_paths = []
    total_start_time = time.time()
    
    for shot_idx, shot in enumerate(shots):
        shot_id = shot["id"]
        prompt = shot["prompt"]
        negative = shot.get("negative", "blurry, low quality, low resolution, static, no motion")
        seed = shot.get("seed", 123456789 + shot_id * 1000)
        
        # Get duration from shot data or use default
        duration = shot.get("duration", 10.0)  # Default 10 seconds
        
        print(f"\n🎬 Shot {shot_idx + 1}/{len(shots)} (ID: {shot_id})")
        print(f"📝 Prompt: {prompt[:100]}...")
        print(f"⏱️ Target duration: {duration}s")
        
        # Generate video with character consistency
        if duration <= args.max_duration:
            # Generate single video
            result = generate_wan22_video(t2v_template, prompt, negative, seed, shot_id, duration, character_description)
            if result:
                video_path = download_video(result, shot_id, out_dir)
                if video_path:
                    final_video_paths.append(video_path)
            else:
                print(f"❌ Failed to generate video for shot {shot_id}")
        else:
            # For now, just generate the max duration video
            print(f"🔄 Duration {duration}s exceeds max {args.max_duration}s, generating {args.max_duration}s clip...")
            result = generate_wan22_video(t2v_template, prompt, negative, seed, shot_id, args.max_duration, character_description)
            if result:
                video_path = download_video(result, shot_id, out_dir)
                if video_path:
                    final_video_paths.append(video_path)
            else:
                print(f"❌ Failed to generate video for shot {shot_id}")
    
    # Create final film
    if final_video_paths:
        final_path = out_dir / f"{project_name.lower().replace(' ', '_')}_final_film.mp4"
        concatenate_videos(final_video_paths, final_path)
        
        # Create OpenCut project
        print(f"\n🎬 Creating OpenCut project...")
        project_file = create_opencut_project(final_video_paths, character_description, project_name, out_dir)
        
        # Open OpenCut project
        print(f"\n🎬 Opening OpenCut project...")
        open_opencut_project(project_file)
        
        total_time = time.time() - total_start_time
        print(f"\n🎉 Enhanced pipeline completed!")
        print(f"📁 Final film: {final_path}")
        print(f"📁 OpenCut project: {project_file}")
        print(f"📊 Generated {len(final_video_paths)} video clips")
        print(f"⏱️ Total time: {total_time/60:.1f} minutes")
    else:
        print("❌ No videos were generated successfully")

    # Automatically upload to OpenCut UI
    print("\n🎬 Automatically uploading to OpenCut...")
    try:
        import subprocess
        import sys
        
        # Run the automated upload script
        result = subprocess.run([
            sys.executable, "upload_to_opencut_automated.py"
        ], capture_output=True, text=True)
        
        if result.returncode == 0:
            print("✅ Successfully uploaded to OpenCut UI!")
            print("🌐 Your project is now visible in OpenCut's projects list")
        else:
            print("⚠️ OpenCut upload failed, but videos are ready for manual upload")
            print(f"�� Videos location: {out_dir}")
            
    except Exception as e:
        print(f"⚠️ OpenCut upload failed: {e}")
        print("📁 Videos are ready for manual upload to OpenCut")
    
    print("=" * 60)
    print("🎉 Enhanced pipeline completed successfully!")

if __name__ == "__main__":
    main()

