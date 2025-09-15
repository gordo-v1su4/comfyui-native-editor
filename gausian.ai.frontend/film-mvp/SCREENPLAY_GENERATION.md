# 🎬 AI Screenplay Generator

This system generates 1-minute film screenplays from user input and creates text-to-video prompts for the Wan 2.2 pipeline.

## 🚀 Quick Start

### Interactive Mode (Recommended)

```bash
python generate_screenplay.py
```

### Command Line Mode

```bash
python generate_screenplay.py \
  --characters "A young detective and a mysterious woman" \
  --mood "noir, mysterious, atmospheric" \
  --genre "thriller" \
  --setting "rainy city street at night" \
  --time "night" \
  --colors "dark blues, neon accents, high contrast" \
  --details "The detective follows a lead that leads to unexpected revelations"
```

## 📋 User Input Requirements

The system collects the following information from users:

### 👥 Characters

- **Description**: Who are the main characters?
- **Example**: "A young detective and a mysterious woman"
- **Purpose**: Defines the people in your story

### 🎨 Visual Mood

- **Description**: What's the overall visual feeling?
- **Examples**: noir, mysterious, cheerful, dramatic, romantic, action-packed, peaceful
- **Purpose**: Sets the tone and atmosphere

### 🎭 Genre

- **Description**: What type of film is it?
- **Examples**: drama, comedy, thriller, romance, sci-fi, action, horror, documentary
- **Purpose**: Determines story structure and visual style

### 🏙️ Setting

- **Description**: Where does the story take place?
- **Examples**: rainy city street, cozy coffee shop, futuristic space station, peaceful forest
- **Purpose**: Establishes the environment and context

### ⏰ Time of Day

- **Description**: When does the story happen?
- **Examples**: dawn, morning, afternoon, sunset, night, midnight
- **Purpose**: Affects lighting and mood

### 🎨 Color Palette

- **Description**: What colors dominate the visual style?
- **Examples**: warm oranges and yellows, cool blues and grays, vibrant neon colors, muted earth tones
- **Purpose**: Creates visual consistency

### 📝 Additional Details

- **Description**: Any other important story or visual details?
- **Optional**: Can be left blank
- **Purpose**: Adds depth and specificity

## 🔧 Generation Options

### Duration

- **Default**: 60 seconds (1 minute)
- **Range**: 30-120 seconds recommended
- **Purpose**: Total film length

### Number of Shots

- **Default**: 5 shots
- **Range**: 3-8 shots recommended
- **Purpose**: More shots = shorter individual shots, fewer shots = longer individual shots

### AI Model

- **Options**: openai, gemini, anthropic
- **Default**: openai
- **Purpose**: Which LLM to use for generation

### Project Name

- **Default**: my_film
- **Purpose**: Organizes files in data/projects/[project_name]/

## 📁 Output Files

The system generates two main files:

### 1. Screenplay JSON

- **Location**: `data/projects/[project_name]/screenplay.json`
- **Content**: Complete screenplay with all shots and metadata
- **Use**: Review and edit the screenplay

### 2. ComfyUI Prompts

- **Location**: `data/projects/[project_name]/shots_prompts_comfy.json`
- **Content**: Formatted prompts for the Wan 2.2 pipeline
- **Use**: Direct input to video generation pipeline

## 🎬 Workflow

1. **Generate Screenplay**: Run `python generate_screenplay.py`
2. **Review Output**: Check the generated screenplay and prompts
3. **Generate Video**: Run `python wan22_t2v_pipeline.py --runpod <your_endpoint>`
4. **Check Results**: View videos in `wan22_t2v_output/`

### 🚀 Quick Video Generation

For easy video generation with different RunPod endpoints:

```bash
# Simple wrapper script
python run_video_pipeline.py cueisznkx9fo3e-8188.proxy.runpod.net

# Or use the full pipeline directly
python wan22_t2v_pipeline.py --runpod cueisznkx9fo3e-8188.proxy.runpod.net
```

## 📊 Example Output

### Screenplay Structure

```json
{
  "title": "The Redemption Path",
  "genre": "thriller",
  "duration": 60,
  "synopsis": "A troubled detective seeks redemption through solving a mysterious case...",
  "shots": [
    {
      "id": 1,
      "title": "The Detective's Office",
      "visual_description": "A dimly lit detective office with rain-streaked windows...",
      "prompt": "A cinematic shot of a detective office at night, rain streaking down the windows...",
      "negative_prompt": "blurry, low quality, cartoon, anime...",
      "duration": 12.0
    }
  ]
}
```

### ComfyUI Format

```json
{
  "title": "The Redemption Path",
  "shots": [
    {
      "id": 1,
      "prompt": "A cinematic shot of a detective office at night...",
      "negative": "blurry, low quality, cartoon, anime...",
      "seed": 123456789
    }
  ]
}
```

## 🎯 Features

### ✅ What It Does

- **Story Generation**: Creates compelling 1-minute narratives
- **Visual Planning**: Generates detailed shot descriptions
- **Prompt Optimization**: Creates text-to-video prompts optimized for Wan 2.2
- **Genre Adaptation**: Adjusts style based on genre
- **Negative Prompts**: Generates appropriate negative prompts
- **File Organization**: Saves files in organized project structure

### 🎨 Visual Style Control

- **Cinematic Language**: Uses professional cinematography terminology
- **Consistent Characters**: Maintains character consistency across shots
- **Atmospheric Details**: Includes lighting, mood, and environmental details
- **Camera Direction**: Specifies angles, movements, and composition

### 🔄 Integration

- **Seamless Pipeline**: Direct integration with Wan 2.2 video generation
- **Flexible Input**: Works with any user-provided details
- **Error Handling**: Graceful fallbacks if LLM fails
- **Multiple Formats**: Outputs both screenplay and pipeline formats

## 🚀 Advanced Usage

### RunPod Endpoint Configuration

Since RunPod endpoints change frequently, the pipeline supports dynamic endpoint configuration:

```bash
# Use command-line argument
python wan22_t2v_pipeline.py --runpod your-new-endpoint.proxy.runpod.net

# Use the wrapper script
python run_video_pipeline.py your-new-endpoint.proxy.runpod.net

# Check available models
python wan22_t2v_pipeline.py --runpod your-endpoint --help
```

### Custom Prompts

You can modify the prompts in `src/prompts.py` to customize the generation style.

### Multiple Projects

Create different projects for different films:

```bash
python generate_screenplay.py --project "my_thriller"
python generate_screenplay.py --project "my_romance"
```

### Batch Generation

Generate multiple screenplays with different parameters:

```bash
# Thriller
python generate_screenplay.py --genre thriller --mood dark --project thriller_1

# Romance
python generate_screenplay.py --genre romance --mood warm --project romance_1
```

## 🔧 Technical Details

### LLM Integration

- **OpenAI**: GPT-4 for high-quality generation
- **Gemini**: Google's model for cost-effective generation
- **Anthropic**: Claude for creative writing

### Prompt Engineering

- **Story Structure**: Ensures proper narrative arc
- **Visual Details**: Rich descriptions for video generation
- **Genre Consistency**: Maintains genre-appropriate style
- **Character Continuity**: Consistent character descriptions

### Error Handling

- **JSON Parsing**: Robust parsing with fallbacks
- **API Failures**: Graceful degradation with example responses
- **File Management**: Safe file operations with error checking

## 🎬 Next Steps

After generating a screenplay:

1. **Review**: Check the generated screenplay for quality
2. **Edit**: Modify prompts if needed
3. **Generate**: Run the video pipeline
4. **Iterate**: Generate new versions with different parameters

The system is designed to be iterative - you can generate multiple versions and choose the best one for video generation.
