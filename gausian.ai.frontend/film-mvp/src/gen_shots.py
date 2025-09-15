"""
Shot generation module for creating cinematic shot descriptions and storyboards.
"""

import json
import argparse
import asyncio
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from enum import Enum
import cv2
import numpy as np
from datetime import datetime

try:
    from .llm import LLMClient
    from .prompts import FilmPrompts
except ImportError:
    from llm import LLMClient
    from prompts import FilmPrompts

class ShotType(Enum):
    """Enumeration of shot types."""
    EXTREME_WIDE = "extreme_wide"
    WIDE = "wide"
    MEDIUM_WIDE = "medium_wide"
    MEDIUM = "medium"
    MEDIUM_CLOSE = "medium_close"
    CLOSE_UP = "close_up"
    EXTREME_CLOSE = "extreme_close"
    OVER_THE_SHOULDER = "over_the_shoulder"
    POINT_OF_VIEW = "point_of_view"
    TRACKING = "tracking"
    DOLLY = "dolly"
    CRANE = "crane"
    AERIAL = "aerial"

class CameraAngle(Enum):
    """Enumeration of camera angles."""
    EYE_LEVEL = "eye_level"
    LOW_ANGLE = "low_angle"
    HIGH_ANGLE = "high_angle"
    DUTCH_ANGLE = "dutch_angle"
    BIRDS_EYE = "birds_eye"
    WORMS_EYE = "worms_eye"

@dataclass
class Shot:
    """Shot data structure."""
    shot_number: int
    shot_type: str
    camera_angle: str
    camera_movement: str
    duration: float
    location: str
    characters: List[str]
    action: str
    lighting: str
    composition: str
    color_palette: str
    sound_design: str
    emotional_impact: str
    notes: str

@dataclass
class Storyboard:
    """Storyboard data structure."""
    scene_number: int
    shots: List[Shot]
    total_duration: float
    scene_mood: str
    visual_style: str

class ShotGenerator:
    """Main class for generating cinematic shots and storyboards."""
    
    def __init__(self, llm_provider: str = "openai"):
        self.llm_client = LLMClient(provider=llm_provider)
        self.prompts = FilmPrompts()
    
    async def generate_shot_description(
        self,
        location: str,
        time_of_day: str,
        mood: str,
        characters: List[str],
        action: str
    ) -> Shot:
        """Generate a detailed shot description."""
        
        prompt = self.prompts.get_prompt(
            "shot_description",
            location=location,
            time_of_day=time_of_day,
            mood=mood,
            characters=", ".join(characters),
            action=action
        )
        
        response = await self.llm_client.generate_text(
            prompt=prompt,
            temperature=0.7,
            max_tokens=500
        )
        
        # Parse shot data from response
        shot_data = self._parse_shot_description(response)
        
        return Shot(
            shot_number=1,  # Will be set by storyboard generator
            **shot_data
        )
    
    async def generate_storyboard(
        self,
        scene_number: int,
        duration: int,
        location: str,
        characters: List[str],
        action: str,
        num_shots: int = 5
    ) -> Storyboard:
        """Generate a complete storyboard for a scene."""
        
        prompt = self.prompts.get_prompt(
            "storyboard",
            scene_number=scene_number,
            duration=duration,
            location=location,
            characters=", ".join(characters),
            action=action,
            num_shots=num_shots
        )
        
        response = await self.llm_client.generate_text(
            prompt=prompt,
            temperature=0.7,
            max_tokens=1000
        )
        
        # Parse storyboard data
        shots_data = self._parse_storyboard(response, num_shots)
        
        # Create Shot objects
        shots = []
        for i, shot_data in enumerate(shots_data):
            shot = Shot(
                shot_number=i + 1,
                **shot_data
            )
            shots.append(shot)
        
        return Storyboard(
            scene_number=scene_number,
            shots=shots,
            total_duration=sum(shot.duration for shot in shots),
            scene_mood=self._determine_scene_mood(action),
            visual_style=self._determine_visual_style(location, action)
        )
    
    async def generate_technical_specs(
        self,
        location: str,
        time_of_day: str,
        mood: str,
        budget: str = "low"
    ) -> Dict[str, Any]:
        """Generate technical specifications for filming."""
        
        prompt = self.prompts.get_prompt(
            "technical_specs",
            location=location,
            time_of_day=time_of_day,
            mood=mood,
            budget=budget
        )
        
        response = await self.llm_client.generate_text(
            prompt=prompt,
            temperature=0.6,
            max_tokens=800
        )
        
        return self._parse_technical_specs(response)
    
    def suggest_shot_sequence(
        self,
        scene_type: str,
        mood: str,
        duration: float
    ) -> List[Dict[str, Any]]:
        """Suggest a shot sequence based on scene type and mood."""
        
        # Predefined shot sequences for common scene types
        sequences = {
            "conversation": [
                {"type": "wide", "angle": "eye_level", "duration": 0.3, "purpose": "establish location"},
                {"type": "medium", "angle": "eye_level", "duration": 0.4, "purpose": "show both characters"},
                {"type": "close_up", "angle": "eye_level", "duration": 0.2, "purpose": "emotional reaction"},
                {"type": "over_the_shoulder", "angle": "eye_level", "duration": 0.3, "purpose": "dialogue"},
                {"type": "close_up", "angle": "eye_level", "duration": 0.2, "purpose": "response"}
            ],
            "action": [
                {"type": "wide", "angle": "eye_level", "duration": 0.2, "purpose": "establish action"},
                {"type": "medium", "angle": "low_angle", "duration": 0.3, "purpose": "build tension"},
                {"type": "close_up", "angle": "eye_level", "duration": 0.1, "purpose": "reaction shot"},
                {"type": "tracking", "angle": "eye_level", "duration": 0.4, "purpose": "follow action"}
            ],
            "establishing": [
                {"type": "extreme_wide", "angle": "high_angle", "duration": 0.5, "purpose": "establish location"},
                {"type": "wide", "angle": "eye_level", "duration": 0.3, "purpose": "show context"},
                {"type": "medium", "angle": "eye_level", "duration": 0.2, "purpose": "introduce characters"}
            ]
        }
        
        # Adjust sequence based on mood
        if mood == "tense":
            # Add more close-ups and low angles
            for shot in sequences.get(scene_type, sequences["conversation"]):
                if shot["type"] == "medium":
                    shot["angle"] = "low_angle"
                elif shot["type"] == "close_up":
                    shot["duration"] *= 1.5  # Hold longer for tension
        
        return sequences.get(scene_type, sequences["conversation"])
    
    def calculate_shot_duration(
        self,
        shot_type: str,
        action_complexity: str,
        mood: str
    ) -> float:
        """Calculate appropriate shot duration based on various factors."""
        
        base_durations = {
            "extreme_wide": 3.0,
            "wide": 2.5,
            "medium_wide": 2.0,
            "medium": 1.5,
            "medium_close": 1.2,
            "close_up": 1.0,
            "extreme_close": 0.8,
            "over_the_shoulder": 1.5,
            "point_of_view": 1.0,
            "tracking": 2.5,
            "dolly": 2.0,
            "crane": 3.0,
            "aerial": 4.0
        }
        
        base_duration = base_durations.get(shot_type, 1.5)
        
        # Adjust for action complexity
        complexity_multipliers = {
            "simple": 0.8,
            "moderate": 1.0,
            "complex": 1.3
        }
        base_duration *= complexity_multipliers.get(action_complexity, 1.0)
        
        # Adjust for mood
        mood_multipliers = {
            "calm": 1.2,
            "neutral": 1.0,
            "tense": 0.8,
            "energetic": 0.7
        }
        base_duration *= mood_multipliers.get(mood, 1.0)
        
        return round(base_duration, 1)
    
    def _parse_shot_description(self, response: str) -> Dict[str, Any]:
        """Parse shot description response into structured data."""
        # Simplified parsing - in production you'd want more sophisticated parsing
        return {
            "shot_type": "medium",
            "camera_angle": "eye_level",
            "camera_movement": "static",
            "duration": 2.0,
            "location": "Scene location",
            "characters": ["Character 1", "Character 2"],
            "action": "Scene action",
            "lighting": "Natural lighting",
            "composition": "Rule of thirds",
            "color_palette": "Warm tones",
            "sound_design": "Ambient sound",
            "emotional_impact": "Creates tension",
            "notes": "Additional notes"
        }
    
    def _parse_storyboard(self, response: str, num_shots: int) -> List[Dict[str, Any]]:
        """Parse storyboard response into structured data."""
        # Simplified parsing - in production you'd want more sophisticated parsing
        shots = []
        for i in range(num_shots):
            shots.append({
                "shot_type": "medium",
                "camera_angle": "eye_level",
                "camera_movement": "static",
                "duration": 2.0,
                "location": f"Location {i+1}",
                "characters": ["Character 1"],
                "action": f"Action {i+1}",
                "lighting": "Natural lighting",
                "composition": "Rule of thirds",
                "color_palette": "Warm tones",
                "sound_design": "Ambient sound",
                "emotional_impact": "Creates mood",
                "notes": f"Shot {i+1} notes"
            })
        return shots
    
    def _parse_technical_specs(self, response: str) -> Dict[str, Any]:
        """Parse technical specifications response."""
        return {
            "camera_equipment": ["DSLR Camera", "Tripod", "Lenses"],
            "lighting_setup": ["LED panels", "Diffusers", "Reflectors"],
            "sound_equipment": ["Shotgun microphone", "Boom pole", "Recorder"],
            "set_design": ["Props", "Set dressing"],
            "costume_makeup": ["Character costumes", "Basic makeup"],
            "special_effects": ["None"],
            "post_production": ["Color grading", "Sound mixing"],
            "shooting_time": "4 hours"
        }
    
    def _determine_scene_mood(self, action: str) -> str:
        """Determine scene mood based on action description."""
        action_lower = action.lower()
        if any(word in action_lower for word in ["fight", "chase", "run", "escape"]):
            return "tense"
        elif any(word in action_lower for word in ["laugh", "dance", "celebrate"]):
            return "energetic"
        elif any(word in action_lower for word in ["cry", "argue", "conflict"]):
            return "dramatic"
        else:
            return "neutral"
    
    def _determine_visual_style(self, location: str, action: str) -> str:
        """Determine visual style based on location and action."""
        if "outdoor" in location.lower() or "nature" in location.lower():
            return "Naturalistic"
        elif "urban" in location.lower() or "city" in location.lower():
            return "Gritty"
        elif "futuristic" in location.lower() or "sci-fi" in action.lower():
            return "Stylized"
        else:
            return "Classical"
    
    def save_storyboard(self, storyboard: Storyboard, filename: str, project_slug: str = "default") -> None:
        """Save storyboard to JSON file."""
        project_path = Path("data/projects") / project_slug
        project_path.mkdir(parents=True, exist_ok=True)
        
        file_path = project_path / filename
        
        # Add metadata
        storyboard_data = asdict(storyboard)
        storyboard_data["metadata"] = {
            "created_at": datetime.now().isoformat(),
            "project_slug": project_slug,
            "version": "1.0"
        }
        
        with open(file_path, 'w') as f:
            json.dump(storyboard_data, f, indent=2)
        
        print(f"Storyboard saved to: {file_path}")
    
    def load_storyboard(self, filename: str, project_slug: str = "default") -> Storyboard:
        """Load storyboard from JSON file."""
        with open(filename, 'r') as f:
            data = json.load(f)
        
        # Reconstruct Shot objects
        shots = [Shot(**shot_data) for shot_data in data["shots"]]
        
        return Storyboard(
            scene_number=data["scene_number"],
            shots=shots,
            total_duration=data["total_duration"],
            scene_mood=data["scene_mood"],
            visual_style=data["visual_style"]
        )
    
    def generate_shot_image(self, shot: Shot, output_path: Path, width: int = 1920, height: int = 1080) -> None:
        """Generate a visual representation of a shot."""
        # Create a background based on the shot type and mood
        image = np.zeros((height, width, 3), dtype=np.uint8)
        
        # Set background color based on mood
        mood_colors = {
            "tense": (20, 20, 40),      # Dark blue
            "dramatic": (40, 20, 20),   # Dark red
            "calm": (20, 40, 20),       # Dark green
            "energetic": (40, 40, 20),  # Dark yellow
            "neutral": (30, 30, 30)     # Dark gray
        }
        
        # Use emotional_impact to determine mood, or default to neutral
        mood = "neutral"
        if hasattr(shot, 'emotional_impact') and shot.emotional_impact:
            if any(word in shot.emotional_impact.lower() for word in ["tense", "suspense", "danger"]):
                mood = "tense"
            elif any(word in shot.emotional_impact.lower() for word in ["dramatic", "conflict", "intense"]):
                mood = "dramatic"
            elif any(word in shot.emotional_impact.lower() for word in ["calm", "peaceful", "quiet"]):
                mood = "calm"
            elif any(word in shot.emotional_impact.lower() for word in ["energetic", "exciting", "dynamic"]):
                mood = "energetic"
        
        bg_color = mood_colors.get(mood, mood_colors["neutral"])
        image[:] = bg_color
        
        # Add shot information as text
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 1.5
        color = (255, 255, 255)
        thickness = 2
        
        # Shot title
        title = f"Shot {shot.shot_number:02d}"
        title_size = cv2.getTextSize(title, font, font_scale, thickness)[0]
        title_x = 50
        title_y = 100
        
        cv2.putText(image, title, (title_x, title_y), font, font_scale, color, thickness)
        
        # Shot type
        shot_type_text = f"Type: {shot.shot_type.replace('_', ' ').title()}"
        cv2.putText(image, shot_type_text, (title_x, title_y + 50), font, 1, color, thickness)
        
        # Camera angle
        angle_text = f"Angle: {shot.camera_angle.replace('_', ' ').title()}"
        cv2.putText(image, angle_text, (title_x, title_y + 100), font, 1, color, thickness)
        
        # Duration
        duration_text = f"Duration: {shot.duration}s"
        cv2.putText(image, duration_text, (title_x, title_y + 150), font, 1, color, thickness)
        
        # Action description
        action_lines = self._wrap_text(shot.action, 60)
        for i, line in enumerate(action_lines[:3]):  # Limit to 3 lines
            cv2.putText(image, line, (title_x, title_y + 200 + i * 30), font, 0.8, color, thickness)
        
        # Characters
        if shot.characters:
            chars_text = f"Characters: {', '.join(shot.characters)}"
            cv2.putText(image, chars_text, (title_x, title_y + 300), font, 0.8, color, thickness)
        
        # Location
        location_text = f"Location: {shot.location}"
        cv2.putText(image, location_text, (title_x, title_y + 330), font, 0.8, color, thickness)
        
        # Save the image
        cv2.imwrite(str(output_path), image)
    
    def _wrap_text(self, text: str, max_width: int) -> List[str]:
        """Wrap text to fit within a specified width."""
        words = text.split()
        lines = []
        current_line = ""
        
        for word in words:
            if len(current_line + " " + word) <= max_width:
                current_line += (" " + word) if current_line else word
            else:
                if current_line:
                    lines.append(current_line)
                current_line = word
        
        if current_line:
            lines.append(current_line)
        
        return lines
    
    def generate_all_shot_images(self, storyboard: Storyboard, project_slug: str) -> List[Path]:
        """Generate images for all shots in a storyboard."""
        project_path = Path("data/projects") / project_slug
        frames_dir = project_path / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)
        
        generated_images = []
        
        for shot in storyboard.shots:
            output_filename = f"shot_{shot.shot_number:02d}.png"
            output_path = frames_dir / output_filename
            
            print(f"Generating shot {shot.shot_number}: {output_filename}")
            self.generate_shot_image(shot, output_path)
            generated_images.append(output_path)
        
        print(f"✅ Generated {len(generated_images)} shot images in {frames_dir}")
        return generated_images
    
    def create_shots_prompts_file(self, storyboard: Storyboard, project_slug: str) -> Path:
        """Create a shots_prompts.json file for the video maker."""
        project_path = Path("data/projects") / project_slug
        
        shots_data = {
            "metadata": {
                "created_at": datetime.now().isoformat(),
                "project_slug": project_slug,
                "scene_number": storyboard.scene_number,
                "total_duration": storyboard.total_duration,
                "scene_mood": storyboard.scene_mood,
                "visual_style": storyboard.visual_style
            },
            "data": {
                "shots": [asdict(shot) for shot in storyboard.shots],
                "shot_duration": 2.0,  # Default duration per shot
                "total_shots": len(storyboard.shots)
            }
        }
        
        output_path = project_path / "shots_prompts.json"
        with open(output_path, 'w') as f:
            json.dump(shots_data, f, indent=2)
        
        print(f"Shots prompts saved to: {output_path}")
        return output_path

def main():
    """Main function for command line usage."""
    parser = argparse.ArgumentParser(description="Generate shot images and storyboards")
    parser.add_argument("project_slug", help="Project slug/name")
    parser.add_argument("--scene", "-s", type=int, default=1, help="Scene number")
    parser.add_argument("--duration", "-d", type=int, default=3, help="Scene duration in minutes")
    parser.add_argument("--location", "-l", default="Unknown location", help="Scene location")
    parser.add_argument("--characters", "-c", nargs="+", default=["Character 1"], help="Characters in scene")
    parser.add_argument("--action", "-a", default="Scene action", help="Scene action description")
    parser.add_argument("--shots", "-n", type=int, default=5, help="Number of shots")
    parser.add_argument("--generate-images", "-i", action="store_true", help="Generate shot images")
    parser.add_argument("--provider", "-pr", choices=["openai", "gemini", "anthropic"], default="openai", help="LLM provider to use")
    
    args = parser.parse_args()
    
    async def run_shot_generation():
        try:
            print(f"🎬 Generating shots for project: {args.project_slug}")
            print(f"   Scene: {args.scene}")
            print(f"   Duration: {args.duration} minutes")
            print(f"   Location: {args.location}")
            print(f"   Characters: {', '.join(args.characters)}")
            print(f"   Action: {args.action}")
            print(f"   Shots: {args.shots}")
            
            # Create shot generator
            generator = ShotGenerator(llm_provider=args.provider)
            
            # Generate storyboard
            storyboard = await generator.generate_storyboard(
                scene_number=args.scene,
                duration=args.duration,
                location=args.location,
                characters=args.characters,
                action=args.action,
                num_shots=args.shots
            )
            
            # Save storyboard
            generator.save_storyboard(storyboard, "storyboard.json", args.project_slug)
            
            # Create shots prompts file
            generator.create_shots_prompts_file(storyboard, args.project_slug)
            
            # Generate images if requested
            if args.generate_images:
                generator.generate_all_shot_images(storyboard, args.project_slug)
            
            print(f"\n✅ Shot generation completed!")
            print(f"   Total shots: {len(storyboard.shots)}")
            print(f"   Total duration: {storyboard.total_duration:.1f} minutes")
            print(f"   Scene mood: {storyboard.scene_mood}")
            print(f"   Visual style: {storyboard.visual_style}")
            
        except Exception as e:
            print(f"❌ Error generating shots: {e}")
            return 1
        
        return 0
    
    return asyncio.run(run_shot_generation())

if __name__ == "__main__":
    exit(main())
