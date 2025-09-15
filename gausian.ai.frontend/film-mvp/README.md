# Film MVP - AI-Powered Film Story Generation

An AI-powered toolkit for generating film stories, characters, dialogue, and shot descriptions using large language models.

## Features

- **Multi-Provider AI Support**: Use OpenAI GPT-4, Google Gemini, or Anthropic Claude for story generation
- **Story Generation**: Create complete film stories with plots, characters, and scenes
- **Character Development**: Generate detailed character profiles and backstories
- **Dialogue Generation**: Create natural, engaging dialogue for film scenes
- **Shot Generation**: Generate cinematic shot descriptions and storyboards
- **Technical Specifications**: Get filming recommendations and technical specs
- **Project Management**: Organize and manage multiple film projects

## Project Structure

```
film-mvp/
├── .env                    # Environment variables and API keys
├── requirements.txt        # Python dependencies
├── README.md              # This file
├── data/
│   └── projects/          # Project data storage
└── src/
    ├── __init__.py        # Package initialization
    ├── llm.py             # LLM client for AI interactions
    ├── prompts.py         # Predefined prompts for film generation
    ├── storygen.py        # Story generation module
    ├── gen_shots.py       # Shot and storyboard generation
    └── utils.py           # Utility functions and helpers
```

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd film-mvp
```

2. Create a virtual environment:

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:

```bash
pip install -r requirements.txt
```

4. Set up environment variables:

```bash
cp .env.example .env
# Edit .env with your API keys
```

## Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# API Keys
OPENAI_API_KEY=your_openai_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Database Configuration
DATABASE_URL=sqlite:///film_mvp.db

# Application Settings
DEBUG=True
LOG_LEVEL=INFO

# File Storage
UPLOAD_FOLDER=./uploads
MAX_CONTENT_LENGTH=16777216

# Model Settings
DEFAULT_MODEL=gpt-4
TEMPERATURE=0.7
MAX_TOKENS=2000

# Provider Settings
DEFAULT_PROVIDER=openai  # Options: openai, gemini, anthropic
```

## Usage

### Using Different AI Providers

The system supports multiple AI providers. You can specify which provider to use:

```python
from src import StoryGenerator

# Use OpenAI (default)
generator = StoryGenerator(llm_provider="openai")

# Use Google Gemini
generator = StoryGenerator(llm_provider="gemini")

# Use Anthropic Claude
generator = StoryGenerator(llm_provider="anthropic")
```

### Command Line Usage with Providers

```bash
# Generate story with OpenAI
python run_storygen.py --genre drama --provider openai

# Generate story with Gemini
python run_storygen.py --genre thriller --provider gemini

# Generate shots with specific provider
python run_gen_shots.py project_name --provider gemini
```

### Basic Story Generation

```python
import asyncio
from src import StoryGenerator

async def create_story():
    generator = StoryGenerator()

    # Generate a story concept
    story = await generator.create_full_story(
        genre="drama",
        duration=10,
        audience="adults",
        themes=["redemption", "family"],
        num_characters=3,
        num_scenes=5
    )

    # Save the story
    generator.save_story(story, "my_story.json")
    print(f"Story created: {story.title}")

# Run the async function
asyncio.run(create_story())
```

### Character Development

```python
import asyncio
from src import StoryGenerator

async def develop_character():
    generator = StoryGenerator()

    character = await generator.develop_character(
        name="Sarah",
        age=28,
        occupation="Detective",
        role="Protagonist"
    )

    print(f"Character: {character.name}")
    print(f"Background: {character.background}")
    print(f"Goals: {character.goals}")

asyncio.run(develop_character())
```

### Shot Generation

```python
import asyncio
from src import ShotGenerator

async def create_storyboard():
    generator = ShotGenerator()

    storyboard = await generator.generate_storyboard(
        scene_number=1,
        duration=3,
        location="Coffee shop",
        characters=["Sarah", "Mike"],
        action="Sarah confronts Mike about the case",
        num_shots=5
    )

    print(f"Storyboard created for scene {storyboard.scene_number}")
    print(f"Total duration: {storyboard.total_duration} minutes")

    for shot in storyboard.shots:
        print(f"Shot {shot.shot_number}: {shot.shot_type} - {shot.action}")

asyncio.run(create_storyboard())
```

### Dialogue Generation

```python
import asyncio
from src import StoryGenerator

async def generate_dialogue():
    generator = StoryGenerator()

    dialogue = await generator.generate_dialogue(
        characters=["Sarah", "Mike"],
        setting="Police station interrogation room",
        mood="tense",
        conflict="Sarah suspects Mike is hiding information",
        objective="Reveal the truth about the case",
        num_lines=8
    )

    for line in dialogue:
        print(f"{line['character']}: {line['line']}")

asyncio.run(generate_dialogue())
```

## API Reference

### StoryGenerator

Main class for generating film stories.

#### Methods

- `create_full_story(genre, duration, audience, themes, num_characters, num_scenes)`: Create a complete story
- `generate_story_concept(genre, duration, audience, themes)`: Generate story concept
- `develop_character(name, age, occupation, role)`: Develop character profile
- `generate_dialogue(characters, setting, mood, conflict, objective, num_lines)`: Generate dialogue
- `save_story(story, filename)`: Save story to JSON file
- `load_story(filename)`: Load story from JSON file

### ShotGenerator

Main class for generating shots and storyboards.

#### Methods

- `generate_storyboard(scene_number, duration, location, characters, action, num_shots)`: Generate storyboard
- `generate_shot_description(location, time_of_day, mood, characters, action)`: Generate shot description
- `generate_technical_specs(location, time_of_day, mood, budget)`: Generate technical specs
- `suggest_shot_sequence(scene_type, mood, duration)`: Suggest shot sequence
- `calculate_shot_duration(shot_type, action_complexity, mood)`: Calculate shot duration

### Utilities

#### FileManager

- `save_json(data, filename, project_name)`: Save data to JSON
- `load_json(filename, project_name)`: Load data from JSON
- `list_projects()`: List all projects
- `list_project_files(project_name)`: List project files

#### TextProcessor

- `clean_text(text)`: Clean and normalize text
- `extract_sentences(text)`: Extract sentences
- `count_words(text)`: Count words
- `estimate_reading_time(text, words_per_minute)`: Estimate reading time
- `extract_keywords(text, max_keywords)`: Extract keywords

#### ValidationUtils

- `validate_story_data(data)`: Validate story data
- `validate_character_data(data)`: Validate character data
- `validate_scene_data(data)`: Validate scene data

## Supported Genres

- Drama
- Comedy
- Thriller
- Romance
- Sci-Fi
- Action
- Horror
- Documentary

## Shot Types

- Extreme Wide
- Wide
- Medium Wide
- Medium
- Medium Close
- Close Up
- Extreme Close
- Over the Shoulder
- Point of View
- Tracking
- Dolly
- Crane
- Aerial

## Camera Angles

- Eye Level
- Low Angle
- High Angle
- Dutch Angle
- Bird's Eye
- Worm's Eye

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions, please open an issue on the GitHub repository.

## Roadmap

- [ ] Web interface for story generation
- [ ] Integration with video editing software
- [ ] Real-time collaboration features
- [ ] Advanced shot visualization
- [ ] Music and sound effect suggestions
- [ ] Budget estimation tools
- [ ] Casting recommendations
- [ ] Location scouting assistance
