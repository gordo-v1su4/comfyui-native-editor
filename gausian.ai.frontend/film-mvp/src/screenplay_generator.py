"""
Screenplay generation module for creating 1-minute films with text-to-video prompts.
"""

import json
import asyncio
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
class VideoDetails:
    """User input for video generation."""
    characters: str
    visual_mood: str
    genre: str
    setting: str
    time_of_day: str
    color_palette: str
    additional_details: str

@dataclass
class Shot:
    """Individual shot data."""
    id: int
    title: str
    visual_description: str
    prompt: str
    negative_prompt: str
    seed: Optional[int]
    duration: float  # in seconds

@dataclass
class Screenplay:
    """Complete screenplay with shots."""
    title: str
    genre: str
    duration: int  # total duration in seconds
    synopsis: str
    visual_style: str
    shots: List[Shot]
    created_at: str
    video_details: VideoDetails

class ScreenplayGenerator:
    """Main class for generating screenplays and text-to-video prompts."""
    
    def __init__(self, llm_provider: str = "openai"):
        self.llm_client = LLMClient(provider=llm_provider)
        self.prompts = FilmPrompts()
    
    async def generate_screenplay(
        self,
        video_details: VideoDetails,
        target_duration: int = 60,  # 1 minute
        num_shots: int = 5
    ) -> Screenplay:
        """Generate a complete screenplay from user input."""
        
        print(f"🎬 Generating {video_details.genre} screenplay...")
        print(f"   Characters: {video_details.characters}")
        print(f"   Mood: {video_details.visual_mood}")
        print(f"   Setting: {video_details.setting}")
        print(f"   Duration: {target_duration} seconds")
        print(f"   Shots: {num_shots}")
        
        # Step 1: Generate story outline
        story_outline = await self._generate_story_outline(video_details, num_shots)
        
        # Step 2: Enhance shots with detailed prompts
        enhanced_shots = await self._enhance_shots_with_prompts(story_outline, video_details)
        
        # Step 3: Create final screenplay
        screenplay = Screenplay(
            title=story_outline.get("title", f"{video_details.genre.title()} Film"),
            genre=video_details.genre,
            duration=target_duration,
            synopsis=story_outline.get("synopsis", ""),
            visual_style=video_details.visual_mood,
            shots=enhanced_shots,
            created_at=datetime.now().isoformat(),
            video_details=video_details
        )
        
        return screenplay
    
    async def _generate_story_outline(
        self,
        video_details: VideoDetails,
        num_shots: int
    ) -> Dict[str, Any]:
        """Generate a story outline with visual shots."""
        
        # Create a comprehensive prompt for story generation
        story_prompt = f"""
        You are a professional screenwriter and storyboard artist.
        
        Create a compelling 1-minute cinematic film outline based on these details:
        
        CHARACTERS: {video_details.characters}
        VISUAL MOOD: {video_details.visual_mood}
        GENRE: {video_details.genre}
        SETTING: {video_details.setting}
        TIME OF DAY: {video_details.time_of_day}
        COLOR PALETTE: {video_details.color_palette}
        ADDITIONAL DETAILS: {video_details.additional_details}
        
        Requirements:
        - Create exactly {num_shots} shots
        - Each shot should be 10-15 seconds (total ~60 seconds)
        - Focus on visual storytelling with minimal or no dialogue
        - Maintain consistent characters, setting, and visual style
        - Create a clear narrative arc with beginning, middle, and end
        - Each shot should advance the story or reveal character
        
        Return a JSON response with this structure:
        {{
            "title": "Film Title",
            "synopsis": "Brief 2-3 sentence synopsis",
            "shots": [
                {{
                    "id": 1,
                    "title": "Shot Title",
                    "visual": "Detailed visual description for text-to-video generation",
                    "duration": 12.0,
                    "style": "cinematic, filmic, 35mm, {video_details.visual_mood}"
                }},
                // ... more shots
            ]
        }}
        
        Make each shot description rich in visual details that can be used for AI video generation.
        Focus on camera angles, lighting, character positions, actions, and atmosphere.
        """
        
        response = await self.llm_client.generate_text(
            prompt=story_prompt,
            temperature=0.8,
            max_tokens=2000
        )
        
        # Parse the JSON response
        try:
            # Try to extract JSON from response
            start = response.find('{')
            end = response.rfind('}') + 1
            if start != -1 and end != 0:
                json_str = response[start:end]
                return json.loads(json_str)
        except (json.JSONDecodeError, ValueError) as e:
            print(f"Warning: Could not parse JSON response: {e}")
        
        # Fallback: create a basic outline
        return self._create_fallback_outline(video_details, num_shots)
    
    async def _enhance_shots_with_prompts(
        self,
        story_outline: Dict[str, Any],
        video_details: VideoDetails
    ) -> List[Shot]:
        """Enhance story outline shots with detailed text-to-video prompts."""
        
        shots_data = story_outline.get("shots", [])
        enhanced_shots = []
        
        for shot_data in shots_data:
            # Generate detailed prompt for text-to-video
            prompt = await self._generate_shot_prompt(shot_data, video_details)
            
            # Generate negative prompt
            negative_prompt = self._generate_negative_prompt(video_details.genre)
            
            shot = Shot(
                id=shot_data.get("id", len(enhanced_shots) + 1),
                title=shot_data.get("title", f"Shot {len(enhanced_shots) + 1}"),
                visual_description=shot_data.get("visual", ""),
                prompt=prompt,
                negative_prompt=negative_prompt,
                seed=None,  # Will be set by pipeline
                duration=shot_data.get("duration", 12.0)
            )
            
            enhanced_shots.append(shot)
        
        return enhanced_shots
    
    async def _generate_shot_prompt(
        self,
        shot_data: Dict[str, Any],
        video_details: VideoDetails
    ) -> str:
        """Generate a detailed text-to-video prompt for a shot in structured format."""
        
        prompt_template = f"""
        You are a professional cinematographer and visual artist.
        
        Create a detailed text-to-video prompt for this shot in the following structured format:
        
        SHOT DESCRIPTION: {shot_data.get('visual', '')}
        CHARACTERS: {video_details.characters}
        GENRE: {video_details.genre}
        VISUAL MOOD: {video_details.visual_mood}
        SETTING: {video_details.setting}
        TIME OF DAY: {video_details.time_of_day}
        COLOR PALETTE: {video_details.color_palette}
        STYLE: {shot_data.get('style', 'cinematic, filmic, 35mm')}
        
        Format the prompt exactly like this structure:
        
        **Main Subject:**
        **Clothing / Appearance:**
        **Pose / Action:**
        **Expression / Emotion:**
        **Camera Direction & Framing:**
        **Environment / Background:**
        **Lighting & Atmosphere:**
        **Style Enhancers:**
        
        Requirements:
        - Fill in each section with detailed, specific information
        - Use cinematic terminology and descriptive language
        - Include specific visual elements for AI video generation
        - Maintain consistency with the character and setting
        - Focus on what the camera sees and captures
        - Keep each section concise but detailed
        - Use the exact formatting with **bold** headers
        
        Return only the structured prompt, no additional text or formatting.
        """
        
        response = await self.llm_client.generate_text(
            prompt=prompt_template,
            temperature=0.7,
            max_tokens=500
        )
        
        # Clean up the response
        prompt = response.strip()
        if prompt.startswith('"') and prompt.endswith('"'):
            prompt = prompt[1:-1]
        
        # Ensure the prompt has the required structure
        if "**Main Subject:**" not in prompt:
            # Fallback to structured format
            prompt = self._create_structured_prompt_fallback(shot_data, video_details)
        
        return prompt
    
    def _create_structured_prompt_fallback(
        self,
        shot_data: Dict[str, Any],
        video_details: VideoDetails
    ) -> str:
        """Create a fallback structured prompt if AI generation fails."""
        
        visual_desc = shot_data.get('visual', '')
        characters = video_details.characters
        setting = video_details.setting
        time_of_day = video_details.time_of_day
        mood = video_details.visual_mood
        
        return f"""**Main Subject:** {characters}

**Clothing / Appearance:** Modern, clean attire appropriate for the scene, well-fitted clothing that reflects the character's personality and the {mood} atmosphere.

**Pose / Action:** {visual_desc.split('.')[0] if visual_desc else 'Natural, relaxed pose that conveys the emotional state of the scene'}

**Expression / Emotion:** {mood} expression that matches the scene's emotional tone, authentic and engaging facial features.

**Camera Direction & Framing:** Cinematic framing with careful attention to composition, using the rule of thirds and dynamic angles to enhance the visual storytelling.

**Environment / Background:** {setting} during {time_of_day}, with atmospheric details that support the {mood} mood and enhance the narrative.

**Lighting & Atmosphere:** {mood} lighting that creates depth and mood, with natural light sources and atmospheric effects that enhance the cinematic quality.

**Style Enhancers:** High-quality cinematic rendering, subtle motion blur, depth of field effects, and color grading that enhances the {mood} atmosphere."""
    
    def _generate_negative_prompt(self, genre: str) -> str:
        """Generate a negative prompt based on genre."""
        
        base_negative = "blurry, low quality, low resolution, watermark, text, logo, distorted, deformed, ugly, bad anatomy"
        
        genre_specific = {
            "drama": "cartoon, anime, illustration, painting, drawing, artificial, fake",
            "comedy": "dark, gloomy, horror, scary, violent, blood, gore",
            "thriller": "bright, cheerful, happy, cartoon, anime, childish",
            "romance": "violent, scary, horror, dark, gloomy, depressing",
            "sci-fi": "vintage, retro, old-fashioned, historical, period piece",
            "action": "static, still, motionless, slow, peaceful, calm",
            "horror": "bright, cheerful, happy, cartoon, anime, cute"
        }
        
        additional = genre_specific.get(genre.lower(), "")
        
        return f"{base_negative}, {additional}".strip(", ")
    
    def _create_fallback_outline(
        self,
        video_details: VideoDetails,
        num_shots: int
    ) -> Dict[str, Any]:
        """Create a fallback outline if JSON parsing fails."""
        
        shots = []
        for i in range(num_shots):
            shot = {
                "id": i + 1,
                "title": f"Shot {i + 1}",
                "visual": f"A {video_details.visual_mood} scene featuring {video_details.characters} in {video_details.setting} during {video_details.time_of_day}",
                "duration": 60.0 / num_shots,
                "style": f"cinematic, filmic, 35mm, {video_details.visual_mood}"
            }
            shots.append(shot)
        
        return {
            "title": f"{video_details.genre.title()} Film",
            "synopsis": f"A {video_details.visual_mood} {video_details.genre} film featuring {video_details.characters} in {video_details.setting}.",
            "shots": shots
        }
    
    def save_screenplay(
        self,
        screenplay: Screenplay,
        filename: str,
        project_slug: str = "default"
    ) -> None:
        """Save screenplay to JSON file."""
        project_path = Path("data/projects") / project_slug
        project_path.mkdir(parents=True, exist_ok=True)
        
        file_path = project_path / filename
        
        # Convert to dict for JSON serialization
        screenplay_data = asdict(screenplay)
        
        # Add metadata
        screenplay_data["metadata"] = {
            "created_at": datetime.now().isoformat(),
            "project_slug": project_slug,
            "version": "1.0",
            "generator": "ScreenplayGenerator"
        }
        
        with open(file_path, 'w') as f:
            json.dump(screenplay_data, f, indent=2)
        
        print(f"📝 Screenplay saved to: {file_path}")
    
    def load_screenplay(
        self,
        filename: str,
        project_slug: str = "default"
    ) -> Screenplay:
        """Load screenplay from JSON file."""
        project_path = Path("data/projects") / project_slug
        file_path = project_path / filename
        
        with open(file_path, 'r') as f:
            data = json.load(f)
        
        # Reconstruct objects from dict
        video_details = VideoDetails(**data["video_details"])
        shots = [Shot(**shot_data) for shot_data in data["shots"]]
        
        return Screenplay(
            title=data["title"],
            genre=data["genre"],
            duration=data["duration"],
            synopsis=data["synopsis"],
            visual_style=data["visual_style"],
            shots=shots,
            created_at=data["created_at"],
            video_details=video_details
        )
    
    def create_comfy_prompts(self, screenplay: Screenplay) -> Dict[str, Any]:
        """Convert screenplay to ComfyUI format for the Wan 2.2 pipeline."""
        
        shots_data = []
        for shot in screenplay.shots:
            shot_data = {
                "id": shot.id,
                "prompt": shot.prompt,
                "negative": shot.negative_prompt,
                "seed": shot.seed or (123456789 + shot.id * 1000)
            }
            shots_data.append(shot_data)
        
        return {
            "title": screenplay.title,
            "genre": screenplay.genre,
            "duration": screenplay.duration,
            "synopsis": screenplay.synopsis,
            "shots": shots_data,
            "metadata": {
                "created_at": screenplay.created_at,
                "visual_style": screenplay.visual_style,
                "characters": screenplay.video_details.characters,
                "setting": screenplay.video_details.setting
            }
        }
    
    def save_comfy_prompts(
        self,
        screenplay: Screenplay,
        filename: str = "shots_prompts_comfy.json",
        project_slug: str = "default"
    ) -> None:
        """Save screenplay in ComfyUI format for the pipeline."""
        project_path = Path("data/projects") / project_slug
        project_path.mkdir(parents=True, exist_ok=True)
        
        file_path = project_path / filename
        
        comfy_data = self.create_comfy_prompts(screenplay)
        
        with open(file_path, 'w') as f:
            json.dump(comfy_data, f, indent=2)
        
        print(f"🎬 ComfyUI prompts saved to: {file_path}")

async def main():
    """Main function for testing the screenplay generator."""
    
    # Example usage
    video_details = VideoDetails(
        characters="A young detective and a mysterious woman",
        visual_mood="noir, mysterious, atmospheric",
        genre="thriller",
        setting="rainy city street at night",
        time_of_day="night",
        color_palette="dark blues, neon accents, high contrast",
        additional_details="The detective is following a lead that leads to unexpected revelations"
    )
    
    generator = ScreenplayGenerator(llm_provider="openai")
    
    try:
        # Generate screenplay
        screenplay = await generator.generate_screenplay(
            video_details=video_details,
            target_duration=60,
            num_shots=5
        )
        
        # Save screenplay
        generator.save_screenplay(screenplay, "example_screenplay.json", "test_screenplay")
        
        # Save ComfyUI prompts
        generator.save_comfy_prompts(screenplay, "shots_prompts_comfy.json", "test_screenplay")
        
        print(f"\n✅ Screenplay generation completed!")
        print(f"   Title: {screenplay.title}")
        print(f"   Genre: {screenplay.genre}")
        print(f"   Duration: {screenplay.duration} seconds")
        print(f"   Shots: {len(screenplay.shots)}")
        
        # Print first shot as example
        if screenplay.shots:
            first_shot = screenplay.shots[0]
            print(f"\n📹 Example Shot:")
            print(f"   Title: {first_shot.title}")
            print(f"   Duration: {first_shot.duration}s")
            print(f"   Prompt: {first_shot.prompt[:100]}...")
        
    except Exception as e:
        print(f"❌ Error generating screenplay: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(asyncio.run(main()))
