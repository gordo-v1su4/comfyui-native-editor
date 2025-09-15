#!/usr/bin/env python3
"""
Make Cut - Video generation module for creating rough cuts from shot images.

This module takes shot images and creates a video rough cut with specified timing.
"""

import os
import json
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional
import cv2
import numpy as np
from datetime import datetime

try:
    from .utils import file_manager, config_manager, performance_monitor
except ImportError:
    from utils import file_manager, config_manager, performance_monitor

class VideoMaker:
    """Class for creating video rough cuts from shot images."""
    
    def __init__(self, project_slug: str):
        self.project_slug = project_slug
        self.project_dir = Path("data/projects") / project_slug
        self.frames_dir = self.project_dir / "frames"
        self.output_dir = self.project_dir / "output"
        
        # Create directories if they don't exist
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Video settings
        self.fps = 24
        self.default_shot_duration = 2.0  # seconds per shot
        
    def load_shot_data(self) -> Dict[str, Any]:
        """Load shot data from the project."""
        try:
            shots_file = self.project_dir / "shots_prompts.json"
            if not shots_file.exists():
                raise FileNotFoundError(f"Shots file not found: {shots_file}")
            
            with open(shots_file, 'r') as f:
                data = json.load(f)
            
            return data.get("data", {})
        except Exception as e:
            print(f"Error loading shot data: {e}")
            return {}
    
    def get_shot_images(self) -> List[Path]:
        """Get list of shot image files."""
        if not self.frames_dir.exists():
            raise FileNotFoundError(f"Frames directory not found: {self.frames_dir}")
        
        # Look for shot images (png, jpg, jpeg)
        image_extensions = ['.png', '.jpg', '.jpeg']
        shot_images = []
        
        for ext in image_extensions:
            shot_images.extend(self.frames_dir.glob(f"shot_*{ext}"))
        
        # Sort by shot number
        shot_images.sort(key=lambda x: int(x.stem.split('_')[1]))
        
        return shot_images
    
    def create_placeholder_image(self, width: int = 1920, height: int = 1080, 
                               text: str = "Shot Placeholder", shot_num: int = 1) -> np.ndarray:
        """Create a placeholder image for shots that don't exist."""
        # Create a dark background
        image = np.zeros((height, width, 3), dtype=np.uint8)
        image[:] = (20, 20, 40)  # Dark blue-gray
        
        # Add text
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 2
        color = (255, 255, 255)
        thickness = 3
        
        # Center the text
        text_size = cv2.getTextSize(text, font, font_scale, thickness)[0]
        text_x = (width - text_size[0]) // 2
        text_y = (height + text_size[1]) // 2
        
        cv2.putText(image, text, (text_x, text_y), font, font_scale, color, thickness)
        
        # Add shot number
        shot_text = f"Shot {shot_num:02d}"
        shot_text_size = cv2.getTextSize(shot_text, font, 1, 2)[0]
        shot_text_x = 50
        shot_text_y = height - 50
        
        cv2.putText(image, shot_text, (shot_text_x, shot_text_y), font, 1, (200, 200, 200), 2)
        
        return image
    
    def load_image(self, image_path: Path) -> np.ndarray:
        """Load and resize image to standard dimensions."""
        if not image_path.exists():
            print(f"Warning: Image not found: {image_path}")
            return self.create_placeholder_image(text="Missing Shot", 
                                               shot_num=int(image_path.stem.split('_')[1]))
        
        image = cv2.imread(str(image_path))
        if image is None:
            print(f"Warning: Could not load image: {image_path}")
            return self.create_placeholder_image(text="Invalid Image", 
                                               shot_num=int(image_path.stem.split('_')[1]))
        
        # Resize to standard dimensions
        target_width, target_height = 1920, 1080
        image = cv2.resize(image, (target_width, target_height))
        
        return image
    
    def create_rough_cut(self, output_filename: str = "rough_cut.mp4", 
                        shot_duration: float = None) -> str:
        """Create a rough cut video from shot images."""
        
        performance_monitor.start_timer("video_creation")
        
        # Load shot data
        shot_data = self.load_shot_data()
        shots = shot_data.get("shots", [])
        
        # Get shot images
        shot_images = self.get_shot_images()
        
        if not shot_images:
            raise ValueError("No shot images found in frames directory")
        
        print(f"Found {len(shot_images)} shot images")
        
        # Use shot duration from data or default
        if shot_duration is None:
            shot_duration = shot_data.get("shot_duration", self.default_shot_duration)
        
        # Calculate frames per shot
        frames_per_shot = int(shot_duration * self.fps)
        total_frames = len(shot_images) * frames_per_shot
        
        print(f"Creating video: {len(shot_images)} shots, {shot_duration}s each, {total_frames} total frames")
        
        # Setup video writer
        output_path = self.output_dir / output_filename
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        video_writer = cv2.VideoWriter(str(output_path), fourcc, self.fps, (1920, 1080))
        
        if not video_writer.isOpened():
            raise RuntimeError("Could not open video writer")
        
        # Create video frames
        for i, image_path in enumerate(shot_images):
            print(f"Processing shot {i+1}/{len(shot_images)}: {image_path.name}")
            
            # Load and process image
            image = self.load_image(image_path)
            
            # Write frames for this shot
            for frame in range(frames_per_shot):
                video_writer.write(image)
        
        # Release video writer
        video_writer.release()
        
        performance_monitor.end_timer("video_creation")
        
        # Calculate video duration
        video_duration = len(shot_images) * shot_duration
        
        print(f"✅ Video created: {output_path}")
        print(f"   Duration: {video_duration:.1f} seconds")
        print(f"   Resolution: 1920x1080")
        print(f"   FPS: {self.fps}")
        
        return str(output_path)
    
    def add_transitions(self, video_path: str, transition_type: str = "fade") -> str:
        """Add transitions between shots (placeholder for future enhancement)."""
        print(f"Note: Transitions not yet implemented. Video saved as: {video_path}")
        return video_path
    
    def create_shot_list(self) -> List[Dict[str, Any]]:
        """Create a shot list for the video."""
        shot_images = self.get_shot_images()
        shot_data = self.load_shot_data()
        
        shot_list = []
        for i, image_path in enumerate(shot_images):
            shot_info = {
                "shot_number": i + 1,
                "image_file": image_path.name,
                "duration": shot_data.get("shot_duration", self.default_shot_duration),
                "start_time": i * shot_data.get("shot_duration", self.default_shot_duration),
                "end_time": (i + 1) * shot_data.get("shot_duration", self.default_shot_duration)
            }
            shot_list.append(shot_info)
        
        return shot_list
    
    def save_shot_list(self, filename: str = "shot_list.json") -> str:
        """Save shot list to JSON file."""
        shot_list = self.create_shot_list()
        
        output_data = {
            "metadata": {
                "created_at": datetime.now().isoformat(),
                "project": self.project_slug,
                "total_shots": len(shot_list),
                "total_duration": sum(shot["duration"] for shot in shot_list)
            },
            "shots": shot_list
        }
        
        output_path = self.output_dir / filename
        with open(output_path, 'w') as f:
            json.dump(output_data, f, indent=2)
        
        print(f"Shot list saved: {output_path}")
        return str(output_path)

def main():
    """Main function for command line usage."""
    parser = argparse.ArgumentParser(description="Create video rough cut from shot images")
    parser.add_argument("project_slug", help="Project slug/name")
    parser.add_argument("--output", "-o", default="rough_cut.mp4", help="Output filename")
    parser.add_argument("--duration", "-d", type=float, help="Duration per shot in seconds")
    parser.add_argument("--shot-list", "-s", action="store_true", help="Generate shot list")
    
    args = parser.parse_args()
    
    try:
        # Create video maker
        video_maker = VideoMaker(args.project_slug)
        
        # Create rough cut
        output_path = video_maker.create_rough_cut(
            output_filename=args.output,
            shot_duration=args.duration
        )
        
        # Generate shot list if requested
        if args.shot_list:
            video_maker.save_shot_list()
        
        print(f"\n🎬 Rough cut completed successfully!")
        print(f"   Project: {args.project_slug}")
        print(f"   Output: {output_path}")
        
    except Exception as e:
        print(f"❌ Error creating rough cut: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main())
