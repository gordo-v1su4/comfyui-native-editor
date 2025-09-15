"""
Prompts module containing predefined prompts for film story generation.
"""

from typing import Dict, List, Any

class FilmPrompts:
    """Collection of prompts for film-related AI generation tasks."""
    
    # Story Generation Prompts
    STORY_CONCEPT_PROMPT = """
    You are a creative film writer. Generate a compelling story concept for a short film.
    
    Requirements:
    - Genre: {genre}
    - Duration: {duration} minutes
    - Target audience: {audience}
    - Key themes: {themes}
    
    Please provide:
    1. A brief synopsis (2-3 sentences)
    2. Main characters and their motivations
    3. Key plot points
    4. Emotional arc
    5. Visual style suggestions
    
    Make it engaging and original while staying within the specified parameters.
    """
    
    CHARACTER_DEVELOPMENT_PROMPT = """
    Develop a detailed character profile for a film character.
    
    Character basics:
    - Name: {name}
    - Age: {age}
    - Occupation: {occupation}
    - Role in story: {role}
    
    Please provide:
    1. Physical description
    2. Personality traits
    3. Background and history
    4. Goals and motivations
    5. Internal conflicts
    6. External conflicts
    7. Character arc throughout the story
    8. Dialogue style and speech patterns
    
    Make the character three-dimensional and relatable.
    """
    
    DIALOGUE_GENERATION_PROMPT = """
    Generate natural, engaging dialogue for a film scene.
    
    Scene context:
    - Characters: {characters}
    - Setting: {setting}
    - Mood: {mood}
    - Conflict: {conflict}
    - Scene objective: {objective}
    
    Guidelines:
    - Keep dialogue natural and conversational
    - Show character personality through speech
    - Advance the plot or reveal character
    - Avoid exposition dumps
    - Include subtext when appropriate
    - Vary sentence lengths and rhythms
    
    Generate {num_lines} lines of dialogue that feel authentic to the characters and situation.
    """
    
    # Shot Generation Prompts
    SHOT_DESCRIPTION_PROMPT = """
    Describe a cinematic shot for a film scene.
    
    Scene details:
    - Location: {location}
    - Time of day: {time_of_day}
    - Mood: {mood}
    - Characters present: {characters}
    - Action: {action}
    
    Please provide:
    1. Shot type (close-up, medium, wide, etc.)
    2. Camera angle and movement
    3. Lighting setup
    4. Composition details
    5. Color palette suggestions
    6. Sound design notes
    7. Emotional impact of the shot
    
    Focus on creating visual storytelling that enhances the narrative.
    """
    
    STORYBOARD_PROMPT = """
    Create a detailed storyboard description for a film sequence.
    
    Sequence details:
    - Scene number: {scene_number}
    - Duration: {duration}
    - Location: {location}
    - Characters: {characters}
    - Key action: {action}
    
    For each shot in the sequence, provide:
    1. Shot number
    2. Shot type and angle
    3. Camera movement
    4. Character positions and movements
    5. Key visual elements
    6. Lighting and atmosphere
    7. Sound cues
    8. Transition to next shot
    
    Create a sequence of {num_shots} shots that tell the story visually.
    """
    
    # Genre-Specific Prompts
    GENRE_PROMPTS = {
        "drama": """
        Create a dramatic scene that explores human emotions and relationships.
        Focus on character development, internal conflicts, and emotional truth.
        Use subtle gestures and meaningful silences to convey depth.
        """,
        
        "comedy": """
        Create a comedic scene that is both funny and character-driven.
        Use timing, wordplay, and situational humor.
        Ensure the comedy serves the story and character development.
        """,
        
        "thriller": """
        Create a suspenseful scene that builds tension and keeps the audience engaged.
        Use pacing, visual cues, and sound design to create unease.
        Balance action with character development.
        """,
        
        "romance": """
        Create a romantic scene that feels authentic and emotionally resonant.
        Focus on chemistry between characters and emotional vulnerability.
        Avoid clichés while maintaining romantic tension.
        """,
        
        "sci-fi": """
        Create a science fiction scene that balances futuristic elements with human emotion.
        Establish clear rules for your world while keeping characters relatable.
        Use visual and conceptual elements to enhance the story.
        """
    }
    
    # Technical Prompts
    TECHNICAL_SPECS_PROMPT = """
    Provide technical specifications for filming a scene.
    
    Scene requirements:
    - Location: {location}
    - Time of day: {time_of_day}
    - Mood: {mood}
    - Budget level: {budget}
    
    Please specify:
    1. Camera equipment recommendations
    2. Lighting setup and equipment
    3. Sound recording requirements
    4. Set design and props needed
    5. Costume and makeup considerations
    6. Special effects requirements
    7. Post-production needs
    8. Estimated shooting time
    
    Provide practical, achievable specifications for the given budget level.
    """
    
    
    STORY_OUTLINE_PROMPT = """You are a screenwriter.
    Task: Create an outline for a 1-minute cinematic film from the idea below.
    Return exactly 5 shots. Each shot: 1–2 sentences, purely visual, no dialogue.
    Keep consistent character/setting/time-of-day/style across shots.

    Idea:
    {idea}

    Return JSON:
    {{
    "shots": [
        {{ "id": 1, "title": "...", "visual": "...", "style": "cinematic, filmic, 35mm" }},
        {{ "id": 2, "title": "...", "visual": "...", "style": "cinematic, filmic, 35mm" }},
        {{ "id": 3, "title": "...", "visual": "...", "style": "cinematic, filmic, 35mm" }},
        {{ "id": 4, "title": "...", "visual": "...", "style": "cinematic, filmic, 35mm" }},
        {{ "id": 5, "title": "...", "visual": "...", "style": "cinematic, filmic, 35mm" }}
    ]
    }}
    """

    SHOTS_ENHANCE_PROMPT = """You are a storyboard artist.
    Refine each shot into a Stable Diffusion prompt (explicit nouns, no pronouns).
    Keep consistent character tokens and style. Add a sensible negative prompt.
    Return JSON:
    {{
    "shots": [
        {{ "id": 1, "prompt": "...", "negative": "lowres, blurry, watermark", "seed": null }},
        {{ "id": 2, "prompt": "...", "negative": "lowres, blurry, watermark", "seed": null }},
        {{ "id": 3, "prompt": "...", "negative": "lowres, blurry, watermark", "seed": null }},
        {{ "id": 4, "prompt": "...", "negative": "lowres, blurry, watermark", "seed": null }},
        {{ "id": 5, "prompt": "...", "negative": "lowres, blurry, watermark", "seed": null }}
    ]
    }}
    Shots JSON:
    {shots_json}
    """
    
    @classmethod
    def get_prompt(cls, prompt_type: str, **kwargs) -> str:
        """Get a formatted prompt by type."""
        if prompt_type == "story_concept":
            return cls.STORY_CONCEPT_PROMPT.format(**kwargs)
        elif prompt_type == "character_development":
            return cls.CHARACTER_DEVELOPMENT_PROMPT.format(**kwargs)
        elif prompt_type == "dialogue_generation":
            return cls.DIALOGUE_GENERATION_PROMPT.format(**kwargs)
        elif prompt_type == "shot_description":
            return cls.SHOT_DESCRIPTION_PROMPT.format(**kwargs)
        elif prompt_type == "storyboard":
            return cls.STORYBOARD_PROMPT.format(**kwargs)
        elif prompt_type == "technical_specs":
            return cls.TECHNICAL_SPECS_PROMPT.format(**kwargs)
        else:
            raise ValueError(f"Unknown prompt type: {prompt_type}")
    
    @classmethod
    def get_genre_prompt(cls, genre: str) -> str:
        """Get a genre-specific prompt."""
        return cls.GENRE_PROMPTS.get(genre.lower(), cls.GENRE_PROMPTS["drama"])
