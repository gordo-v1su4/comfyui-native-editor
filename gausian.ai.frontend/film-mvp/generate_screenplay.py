#!/usr/bin/env python3
"""
Interactive screenplay generator for creating 1-minute films.
"""

import asyncio
import argparse
from pathlib import Path
from typing import Optional

try:
    from src.screenplay_generator import ScreenplayGenerator, VideoDetails
except ImportError:
    from src.screenplay_generator import ScreenplayGenerator, VideoDetails

def get_user_input() -> VideoDetails:
    """Get video details from user input."""
    
    print("🎬 Welcome to the AI Screenplay Generator!")
    print("=" * 50)
    print("I'll help you create a 1-minute film screenplay.")
    print("Please provide the following details:\n")
    
    # Get character information
    print("👥 CHARACTERS")
    characters = input("Describe the main characters (e.g., 'A young detective and a mysterious woman'): ").strip()
    if not characters:
        characters = "A protagonist and supporting character"
    
    # Get visual mood
    print("\n🎨 VISUAL MOOD")
    print("Examples: noir, mysterious, cheerful, dramatic, romantic, action-packed, peaceful")
    visual_mood = input("What's the visual mood of your film? ").strip()
    if not visual_mood:
        visual_mood = "cinematic, atmospheric"
    
    # Get genre
    print("\n🎭 GENRE")
    print("Examples: drama, comedy, thriller, romance, sci-fi, action, horror, documentary")
    genre = input("What genre is your film? ").strip()
    if not genre:
        genre = "drama"
    
    # Get setting
    print("\n🏙️ SETTING")
    print("Examples: rainy city street, cozy coffee shop, futuristic space station, peaceful forest")
    setting = input("Where does your film take place? ").strip()
    if not setting:
        setting = "urban environment"
    
    # Get time of day
    print("\n⏰ TIME OF DAY")
    print("Examples: dawn, morning, afternoon, sunset, night, midnight")
    time_of_day = input("What time of day is it? ").strip()
    if not time_of_day:
        time_of_day = "day"
    
    # Get color palette
    print("\n🎨 COLOR PALETTE")
    print("Examples: warm oranges and yellows, cool blues and grays, vibrant neon colors, muted earth tones")
    color_palette = input("Describe the color palette: ").strip()
    if not color_palette:
        color_palette = "natural, cinematic"
    
    # Get additional details
    print("\n📝 ADDITIONAL DETAILS")
    print("Any other important details about your story, characters, or visual style?")
    additional_details = input("(Optional - press Enter to skip): ").strip()
    if not additional_details:
        additional_details = "A compelling story with visual impact"
    
    return VideoDetails(
        characters=characters,
        visual_mood=visual_mood,
        genre=genre,
        setting=setting,
        time_of_day=time_of_day,
        color_palette=color_palette,
        additional_details=additional_details
    )

def get_generation_options() -> dict:
    """Get generation options from user."""
    
    print("\n⚙️ GENERATION OPTIONS")
    print("=" * 30)
    
    # Duration
    print("📏 DURATION")
    duration = input("Target duration in seconds (default: 60): ").strip()
    try:
        duration = int(duration) if duration else 60
    except ValueError:
        duration = 60
    
    # Number of shots
    print("\n🎬 NUMBER OF SHOTS")
    print("More shots = shorter individual shots, fewer shots = longer individual shots")
    num_shots = input("Number of shots (default: 5): ").strip()
    try:
        num_shots = int(num_shots) if num_shots else 5
    except ValueError:
        num_shots = 5
    
    # LLM provider
    print("\n🤖 AI MODEL")
    print("Available: ollama, openai, gemini, anthropic")
    provider = input("Which AI model to use? (default: ollama): ").strip()
    if not provider:
        provider = "ollama"
    
    # Project name
    print("\n📁 PROJECT NAME")
    project_name = input("Project name for file organization (default: my_film): ").strip()
    if not project_name:
        project_name = "my_film"
    
    return {
        "duration": duration,
        "num_shots": num_shots,
        "provider": provider,
        "project_name": project_name
    }

async def generate_screenplay_interactive():
    """Interactive screenplay generation."""
    
    try:
        # Get user input
        video_details = get_user_input()
        options = get_generation_options()
        
        print(f"\n🎬 Generating your {video_details.genre} screenplay...")
        print("=" * 50)
        
        # Create generator
        generator = ScreenplayGenerator(llm_provider=options["provider"])
        
        # Generate screenplay
        screenplay = await generator.generate_screenplay(
            video_details=video_details,
            target_duration=options["duration"],
            num_shots=options["num_shots"]
        )
        
        # Save files
        project_slug = options["project_name"]
        
        # Save screenplay
        generator.save_screenplay(
            screenplay, 
            "screenplay.json", 
            project_slug
        )
        
        # Save ComfyUI prompts for the pipeline
        generator.save_comfy_prompts(
            screenplay, 
            "shots_prompts_comfy.json", 
            project_slug
        )
        
        # Display results
        print(f"\n✅ Screenplay generation completed!")
        print("=" * 50)
        print(f"📝 Title: {screenplay.title}")
        print(f"🎭 Genre: {screenplay.genre}")
        print(f"⏱️ Duration: {screenplay.duration} seconds")
        print(f"📹 Shots: {len(screenplay.shots)}")
        print(f"📖 Synopsis: {screenplay.synopsis}")
        
        print(f"\n📁 Files saved:")
        print(f"   📝 Screenplay: data/projects/{project_slug}/screenplay.json")
        print(f"   🎬 Pipeline prompts: data/projects/{project_slug}/shots_prompts_comfy.json")
        
        print(f"\n📹 Shot Breakdown:")
        for i, shot in enumerate(screenplay.shots, 1):
            print(f"   {i}. {shot.title} ({shot.duration:.1f}s)")
            print(f"      {shot.prompt[:80]}...")
        
        print(f"\n🚀 Next Steps:")
        print(f"   1. Review the generated screenplay")
        print(f"   2. Run the video pipeline: python wan22_t2v_pipeline.py")
        print(f"   3. Check the output in wan22_t2v_output/")
        
        return 0
        
    except Exception as e:
        print(f"❌ Error generating screenplay: {e}")
        return 1

def main():
    """Main function."""
    parser = argparse.ArgumentParser(description="Generate AI screenplay for 1-minute film")
    parser.add_argument("--interactive", "-i", action="store_true", help="Run in interactive mode")
    parser.add_argument("--characters", "-c", help="Character description")
    parser.add_argument("--mood", "-m", help="Visual mood")
    parser.add_argument("--genre", "-g", help="Film genre")
    parser.add_argument("--setting", "-s", help="Setting/location")
    parser.add_argument("--time", "-t", help="Time of day")
    parser.add_argument("--colors", help="Color palette")
    parser.add_argument("--details", "-d", help="Additional details")
    parser.add_argument("--duration", type=int, default=60, help="Duration in seconds")
    parser.add_argument("--shots", type=int, default=5, help="Number of shots")
    parser.add_argument("--provider", "-p", default="openai", help="LLM provider")
    parser.add_argument("--project", help="Project name")
    
    args = parser.parse_args()
    
    if args.interactive or not any([args.characters, args.mood, args.genre]):
        # Interactive mode
        return asyncio.run(generate_screenplay_interactive())
    else:
        # Command line mode
        video_details = VideoDetails(
            characters=args.characters or "A protagonist",
            visual_mood=args.mood or "cinematic",
            genre=args.genre or "drama",
            setting=args.setting or "urban environment",
            time_of_day=args.time or "day",
            color_palette=args.colors or "natural",
            additional_details=args.details or "A compelling story"
        )
        
        async def run_command_line():
            generator = ScreenplayGenerator(llm_provider=args.provider)
            project_slug = args.project or "command_line_film"
            
            screenplay = await generator.generate_screenplay(
                video_details=video_details,
                target_duration=args.duration,
                num_shots=args.shots
            )
            
            generator.save_screenplay(screenplay, "screenplay.json", project_slug)
            generator.save_comfy_prompts(screenplay, "shots_prompts_comfy.json", project_slug)
            
            print(f"✅ Screenplay generated: {screenplay.title}")
            return 0
        
        return asyncio.run(run_command_line())

if __name__ == "__main__":
    exit(main())
