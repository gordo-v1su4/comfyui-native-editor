"""
Story generation module for creating film stories using AI.
"""

import json
import asyncio
import argparse
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from datetime import datetime

try:
    from .llm import LLMClient
    from .prompts import FilmPrompts
except ImportError:
    from llm import LLMClient
    from prompts import FilmPrompts

@dataclass
class Character:
    """Character data structure."""
    name: str
    age: int
    occupation: str
    role: str
    description: str
    personality: List[str]
    background: str
    goals: str
    conflicts: List[str]
    dialogue_style: str

@dataclass
class Scene:
    """Scene data structure."""
    scene_number: int
    location: str
    time_of_day: str
    duration: int
    characters: List[str]
    action: str
    dialogue: List[Dict[str, str]]
    mood: str
    shots: List[Dict[str, Any]]

@dataclass
class Story:
    """Story data structure."""
    title: str
    genre: str
    duration: int
    synopsis: str
    themes: List[str]
    characters: List[Character]
    scenes: List[Scene]
    visual_style: str
    target_audience: str
    created_at: str

class StoryGenerator:
    """Main class for generating film stories using AI."""
    
    def __init__(self, llm_provider: str = "openai"):
        self.llm_client = LLMClient(provider=llm_provider)
        self.prompts = FilmPrompts()
    
    async def generate_story_concept(
        self,
        genre: str,
        duration: int,
        audience: str,
        themes: List[str]
    ) -> Dict[str, Any]:
        """Generate a story concept using AI."""
        
        prompt = self.prompts.get_prompt(
            "story_concept",
            genre=genre,
            duration=duration,
            audience=audience,
            themes=", ".join(themes)
        )
        
        response = await self.llm_client.generate_text(
            prompt=prompt,
            temperature=0.8,
            max_tokens=1000
        )
        
        # Parse the response to extract structured data
        # This is a simplified parser - in production you might want more robust parsing
        story_data = self._parse_story_concept(response)
        
        return {
            "concept": response,
            "parsed_data": story_data,
            "metadata": {
                "genre": genre,
                "duration": duration,
                "audience": audience,
                "themes": themes,
                "generated_at": datetime.now().isoformat()
            }
        }
    
    async def develop_character(
        self,
        name: str,
        age: int,
        occupation: str,
        role: str
    ) -> Character:
        """Develop a detailed character profile."""
        
        prompt = self.prompts.get_prompt(
            "character_development",
            name=name,
            age=age,
            occupation=occupation,
            role=role
        )
        
        response = await self.llm_client.generate_text(
            prompt=prompt,
            temperature=0.7,
            max_tokens=800
        )
        
        # Parse character data from response
        character_data = self._parse_character(response)
        
        return Character(
            name=name,
            age=age,
            occupation=occupation,
            role=role,
            **character_data
        )
    
    async def generate_dialogue(
        self,
        characters: List[str],
        setting: str,
        mood: str,
        conflict: str,
        objective: str,
        num_lines: int = 10
    ) -> List[Dict[str, str]]:
        """Generate dialogue for a scene."""
        
        prompt = self.prompts.get_prompt(
            "dialogue_generation",
            characters=", ".join(characters),
            setting=setting,
            mood=mood,
            conflict=conflict,
            objective=objective,
            num_lines=num_lines
        )
        
        response = await self.llm_client.generate_text(
            prompt=prompt,
            temperature=0.8,
            max_tokens=600
        )
        
        return self._parse_dialogue(response, characters)
    
    async def create_full_story(
        self,
        genre: str,
        duration: int,
        audience: str,
        themes: List[str],
        num_characters: int = 3,
        num_scenes: int = 5
    ) -> Story:
        """Create a complete story with characters and scenes."""
        
        # Generate story concept
        concept_data = await self.generate_story_concept(
            genre, duration, audience, themes
        )
        
        # Extract character names from concept
        character_names = self._extract_character_names(concept_data["concept"])
        
        # Develop characters
        characters = []
        for i, name in enumerate(character_names[:num_characters]):
            character = await self.develop_character(
                name=name,
                age=25 + (i * 10),  # Simple age distribution
                occupation="Unknown",
                role="Main character" if i == 0 else "Supporting character"
            )
            characters.append(character)
        
        # Generate scenes
        scenes = []
        for i in range(num_scenes):
            scene = await self._generate_scene(
                scene_number=i + 1,
                characters=characters,
                genre=genre,
                story_concept=concept_data["concept"]
            )
            scenes.append(scene)
        
        return Story(
            title=concept_data["parsed_data"].get("title", "Untitled Story"),
            genre=genre,
            duration=duration,
            synopsis=concept_data["parsed_data"].get("synopsis", ""),
            themes=themes,
            characters=characters,
            scenes=scenes,
            visual_style=concept_data["parsed_data"].get("visual_style", ""),
            target_audience=audience,
            created_at=datetime.now().isoformat()
        )
    
    async def _generate_scene(
        self,
        scene_number: int,
        characters: List[Character],
        genre: str,
        story_concept: str
    ) -> Scene:
        """Generate a single scene."""
        
        # Generate scene details
        scene_prompt = f"""
        Based on this story concept: {story_concept}
        
        Create scene {scene_number} details:
        - Location
        - Time of day
        - Duration (in minutes)
        - Characters present
        - Action/conflict
        - Mood
        
        Format as JSON with keys: location, time_of_day, duration, characters, action, mood
        """
        
        scene_response = await self.llm_client.generate_text(
            prompt=scene_prompt,
            temperature=0.7,
            max_tokens=300
        )
        
        scene_data = self._parse_json_response(scene_response)
        
        # Generate dialogue for the scene
        dialogue = await self.generate_dialogue(
            characters=scene_data.get("characters", []),
            setting=scene_data.get("location", ""),
            mood=scene_data.get("mood", ""),
            conflict=scene_data.get("action", ""),
            objective=f"Advance the story in scene {scene_number}"
        )
        
        return Scene(
            scene_number=scene_number,
            location=scene_data.get("location", ""),
            time_of_day=scene_data.get("time_of_day", ""),
            duration=scene_data.get("duration", 2),
            characters=scene_data.get("characters", []),
            action=scene_data.get("action", ""),
            dialogue=dialogue,
            mood=scene_data.get("mood", ""),
            shots=[]  # Will be populated by shot generation
        )
    
    def _parse_story_concept(self, response: str) -> Dict[str, Any]:
        """Parse story concept response into structured data."""
        # This is a simplified parser - in production you'd want more robust parsing
        return {
            "title": "Generated Story",
            "synopsis": response[:200] + "..." if len(response) > 200 else response,
            "visual_style": "Cinematic and engaging"
        }
    
    def _parse_character(self, response: str) -> Dict[str, Any]:
        """Parse character response into structured data."""
        return {
            "description": "Character description",
            "personality": ["Trait 1", "Trait 2"],
            "background": "Character background",
            "goals": "Character goals",
            "conflicts": ["Internal conflict", "External conflict"],
            "dialogue_style": "Natural and conversational"
        }
    
    def _parse_dialogue(self, response: str, characters: List[str]) -> List[Dict[str, str]]:
        """Parse dialogue response into structured format."""
        # Simplified parsing - in production you'd want more sophisticated parsing
        lines = response.split('\n')
        dialogue = []
        
        for line in lines:
            if ':' in line and any(char in line for char in characters):
                parts = line.split(':', 1)
                if len(parts) == 2:
                    dialogue.append({
                        "character": parts[0].strip(),
                        "line": parts[1].strip()
                    })
        
        return dialogue
    
    def _extract_character_names(self, concept: str) -> List[str]:
        """Extract character names from story concept."""
        # Simplified extraction - in production you'd want more sophisticated NLP
        return ["Protagonist", "Antagonist", "Supporting Character"]
    
    def _parse_json_response(self, response: str) -> Dict[str, Any]:
        """Parse JSON response from LLM."""
        try:
            # Try to extract JSON from response
            start = response.find('{')
            end = response.rfind('}') + 1
            if start != -1 and end != 0:
                json_str = response[start:end]
                return json.loads(json_str)
        except (json.JSONDecodeError, ValueError):
            pass
        
        # Fallback to default values
        return {
            "location": "Unknown location",
            "time_of_day": "Day",
            "duration": 2,
            "characters": [],
            "action": "Scene action",
            "mood": "Neutral"
        }
    
    def save_story(self, story: Story, filename: str, project_slug: str = "default") -> None:
        """Save story to JSON file."""
        project_path = Path("data/projects") / project_slug
        project_path.mkdir(parents=True, exist_ok=True)
        
        file_path = project_path / filename
        
        # Add metadata
        story_data = asdict(story)
        story_data["metadata"] = {
            "created_at": datetime.now().isoformat(),
            "project_slug": project_slug,
            "version": "1.0"
        }
        
        with open(file_path, 'w') as f:
            json.dump(story_data, f, indent=2)
        
        print(f"Story saved to: {file_path}")
    
    def load_story(self, filename: str, project_slug: str = "default") -> Story:
        """Load story from JSON file."""
        with open(filename, 'r') as f:
            data = json.load(f)
        
        # Reconstruct objects from dict
        characters = [Character(**char_data) for char_data in data["characters"]]
        scenes = [Scene(**scene_data) for scene_data in data["scenes"]]
        
        return Story(
            title=data["title"],
            genre=data["genre"],
            duration=data["duration"],
            synopsis=data["synopsis"],
            themes=data["themes"],
            characters=characters,
            scenes=scenes,
            visual_style=data["visual_style"],
            target_audience=data["target_audience"],
            created_at=data["created_at"]
        )

def main():
    """Main function for command line usage."""
    parser = argparse.ArgumentParser(description="Generate film story using AI")
    parser.add_argument("--genre", "-g", default="drama", help="Film genre")
    parser.add_argument("--duration", "-d", type=int, default=10, help="Duration in minutes")
    parser.add_argument("--audience", "-a", default="adults", help="Target audience")
    parser.add_argument("--themes", "-t", nargs="+", default=["redemption"], help="Story themes")
    parser.add_argument("--characters", "-c", type=int, default=3, help="Number of characters")
    parser.add_argument("--scenes", "-s", type=int, default=5, help="Number of scenes")
    parser.add_argument("--project", "-p", default="default", help="Project slug")
    parser.add_argument("--output", "-o", default="story.json", help="Output filename")
    parser.add_argument("--provider", "-pr", choices=["openai", "gemini", "anthropic"], default="openai", help="LLM provider to use")
    
    args = parser.parse_args()
    
    async def run_story_generation():
        try:
            print(f"🎬 Generating {args.genre} story...")
            print(f"   Duration: {args.duration} minutes")
            print(f"   Audience: {args.audience}")
            print(f"   Themes: {', '.join(args.themes)}")
            print(f"   Characters: {args.characters}")
            print(f"   Scenes: {args.scenes}")
            print(f"   Project: {args.project}")
            
            # Create story generator
            generator = StoryGenerator(llm_provider=args.provider)
            
            # Generate story
            story = await generator.create_full_story(
                genre=args.genre,
                duration=args.duration,
                audience=args.audience,
                themes=args.themes,
                num_characters=args.characters,
                num_scenes=args.scenes
            )
            
            # Save story
            generator.save_story(story, args.output, args.project)
            
            print(f"\n✅ Story generation completed!")
            print(f"   Title: {story.title}")
            print(f"   Genre: {story.genre}")
            print(f"   Duration: {story.duration} minutes")
            print(f"   Characters: {len(story.characters)}")
            print(f"   Scenes: {len(story.scenes)}")
            
        except Exception as e:
            print(f"❌ Error generating story: {e}")
            return 1
        
        return 0
    
    return asyncio.run(run_story_generation())

if __name__ == "__main__":
    exit(main())
