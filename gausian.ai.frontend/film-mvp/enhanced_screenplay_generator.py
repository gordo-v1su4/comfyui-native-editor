#!/usr/bin/env python3
"""
Enhanced Screenplay Generator with User Input
Generates detailed screenplay with character descriptions and shot breakdowns using Ollama.
"""

import json
import os
import asyncio
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

# Import LLM client
try:
    from src.llm import LLMClient
except ImportError:
    from llm import LLMClient

load_dotenv()

class EnhancedScreenplayGenerator:
    """Generates enhanced screenplays with character consistency and detailed shot descriptions using Ollama."""
    
    def __init__(self, llm_provider="ollama"):
        """Initialize the screenplay generator with Ollama support."""
        self.llm_client = LLMClient(provider=llm_provider)
        self.provider = llm_provider
    
    async def generate_screenplay_from_user_input(self, user_prompt, project_name=None, character_description=None):
        """
        Generate a complete screenplay from user input using Ollama.
        
        Args:
            user_prompt: User's story idea/concept
            project_name: Name for the project
            character_description: Optional character description for consistency
            
        Returns:
            Dictionary containing screenplay data
        """
        print(f"🎬 Generating screenplay from user input using {self.provider}...")
        print(f"📝 User prompt: {user_prompt}")
        
        # Generate character description if not provided
        if not character_description:
            character_description = await self._generate_character_description(user_prompt)
        
        # Generate screenplay structure
        screenplay_data = await self._generate_screenplay_structure(user_prompt, character_description)
        
        # Generate detailed shots
        shots = await self._generate_detailed_shots(screenplay_data, character_description)
        
        # Create final screenplay
        final_screenplay = {
            "project_name": project_name or "Generated_Project",
            "title": project_name or "Generated Film",
            "character_description": character_description,
            "user_prompt": user_prompt,
            "generated_at": datetime.now().isoformat(),
            "total_duration": sum(shot.get("duration", 5.0) for shot in shots),
            "shot_count": len(shots),
            "shots": shots,
            "metadata": {
                "version": "enhanced_v3.0",
                "llm_provider": self.provider,
                "character_consistency": True,
                "motion_enhancement": True,
                "structured_prompts": True
            }
        }
        
        return final_screenplay
    
    async def _generate_character_description(self, user_prompt):
        """Generate a detailed character description for consistency using Ollama."""
        prompt = f"""
        Based on this story concept: "{user_prompt}"
        
        Create a detailed character description for the main character(s) that will be used for consistent video generation.
        Focus on:
        - Physical appearance (age, gender, hair, clothing style)
        - Facial features and expressions
        - Body type and posture
        - Clothing and style preferences
        - Any distinctive features
        
        Make it detailed enough for AI video generation to maintain consistency across multiple shots.
        Return only the character description, no additional text.
        """
        
        try:
            response = await self.llm_client.generate_text(
                prompt=prompt,
                temperature=0.7,
                max_tokens=300
            )
            return response.strip()
        except Exception as e:
            print(f"⚠️ Could not generate character description: {e}")
            # Fallback character description
            return "A young adult in their mid-20s, with a modern and approachable appearance. Clean, well-groomed with natural expressions and professional attire suitable for the scene context."
    
    async def _generate_screenplay_structure(self, user_prompt, character_description):
        """Generate the basic screenplay structure using Ollama."""
        prompt = f"""
        Create a screenplay structure for this story: "{user_prompt}"
        
        Character: {character_description}
        
        Create a 5-8 scene screenplay with:
        1. Scene descriptions
        2. Character actions and emotions
        3. Visual elements and settings
        4. Story progression
        
        Focus on visual storytelling that works well for AI video generation.
        Keep scenes concise but impactful.
        """
        
        try:
            response = await self.llm_client.generate_text(
                prompt=prompt,
                temperature=0.8,
                max_tokens=800
            )
            return {
                "title": f"Film based on: {user_prompt[:50]}...",
                "structure": response.strip()
            }
        except Exception as e:
            print(f"⚠️ Could not generate screenplay structure: {e}")
            # Fallback structure
            return {
                "title": f"Film based on: {user_prompt[:50]}...",
                "structure": f"""
                    Scene 1: Introduction - {character_description} in a modern setting, establishing the story context.
                    Scene 2: Development - Character shows emotion and movement, advancing the narrative.
                    Scene 3: Climax - Dramatic moment with enhanced motion and expression.
                    Scene 4: Resolution - Calm conclusion with subtle character interaction.
                    """
            }
    
    async def _generate_detailed_shots(self, screenplay_data, character_description):
        """Generate detailed shot descriptions for video generation in structured format using Ollama."""
        prompt = f"""
        Based on this screenplay structure:
        {screenplay_data.get('structure', '')}
        
        Character: {character_description}
        
        Create 8-10 detailed shots for video generation. For each shot, provide the prompt in this exact structured format:
        
        **Main Subject:**
        **Clothing / Appearance:**
        **Pose / Action:**
        **Expression / Emotion:**
        **Camera Direction & Framing:**
        **Environment / Background:**
        **Lighting & Atmosphere:**
        **Style Enhancers:**
        
        For each shot, also provide:
        - Shot ID (1, 2, 3, etc.)
        - Duration (3-8 seconds)
        - Motion requirements (static, walking, gesturing, etc.)
        - Negative prompt for quality control
        
        Format as JSON-compatible structure with the structured prompt format above.
        """
        
        try:
            response = await self.llm_client.generate_text(
                prompt=prompt,
                temperature=0.7,
                max_tokens=1500
            )
            
            # Parse the response to extract shot data
            content = response.strip()
            shots = self._parse_shot_response(content)
            return shots
        except Exception as e:
            print(f"⚠️ Could not generate detailed shots: {e}")
            # Fallback shots
            return self._generate_fallback_shots(character_description)
    
    def _parse_shot_response(self, content):
        """Parse the AI response into structured shot data."""
        try:
            # Try to extract JSON-like structure
            lines = content.split('\n')
            shots = []
            current_shot = {}
            
            for line in lines:
                line = line.strip()
                if line.startswith('Shot') or line.startswith('{'):
                    if current_shot:
                        shots.append(current_shot)
                    current_shot = {"id": len(shots) + 1}
                
                if "prompt:" in line.lower() or "description:" in line.lower():
                    current_shot["prompt"] = line.split(':', 1)[1].strip()
                elif "duration:" in line.lower():
                    try:
                        current_shot["duration"] = float(line.split(':')[1].strip().split()[0])
                    except:
                        current_shot["duration"] = 5.0
                elif "motion:" in line.lower():
                    current_shot["motion"] = line.split(':', 1)[1].strip()
                elif "negative:" in line.lower():
                    current_shot["negative"] = line.split(':', 1)[1].strip()
            
            if current_shot:
                shots.append(current_shot)
            
            # Ensure all shots have required fields
            for shot in shots:
                shot.setdefault("prompt", "Professional scene with character")
                shot.setdefault("duration", 5.0)
                shot.setdefault("motion", "subtle movement")
                shot.setdefault("negative", "blurry, low quality, distorted")
                shot.setdefault("seed", 123456789 + shot["id"] * 1000)
            
            return shots[:10]  # Limit to 10 shots
            
        except Exception as e:
            print(f"⚠️ Could not parse shot response: {e}")
            return self._generate_fallback_shots("A young adult character")
    
    def _generate_fallback_shots(self, character_description):
        """Generate fallback shots when AI generation fails, using structured format."""
        return [
            {
                "id": 1,
                "prompt": f"""**Main Subject:** {character_description}

**Clothing / Appearance:** Professional, well-fitted attire appropriate for a close-up portrait, clean and modern styling that enhances the character's features.

**Pose / Action:** Direct gaze toward camera, confident and engaging posture, subtle head movement to create natural motion.

**Expression / Emotion:** Confident, approachable expression with genuine warmth, eyes showing intelligence and character depth.

**Camera Direction & Framing:** Close-up portrait framing, rule of thirds composition, shallow depth of field to focus on facial features.

**Environment / Background:** Clean, minimal background with subtle depth, professional studio-like setting that doesn't distract from the subject.

**Lighting & Atmosphere:** Professional three-point lighting setup, soft key light from front-left, subtle fill light, rim light for separation, warm and inviting atmosphere.

**Style Enhancers:** High-quality cinematic rendering, subtle motion blur, shallow depth of field effects, professional color grading with warm tones.""",
                "duration": 4.0,
                "motion": "subtle head movement",
                "negative": "blurry, low quality, distorted, multiple people",
                "seed": 123456789
            },
            {
                "id": 2,
                "prompt": f"""**Main Subject:** {character_description}

**Clothing / Appearance:** Professional business attire, well-tailored clothing that conveys competence and style, appropriate for a modern office environment.

**Pose / Action:** Seated in a thoughtful pose, gentle hand gestures while speaking or thinking, natural and relaxed body language.

**Expression / Emotion:** Thoughtful and engaged expression, showing intelligence and focus, eyes reflecting active thinking or listening.

**Camera Direction & Framing:** Medium shot composition, eye-level camera angle, balanced framing that includes upper body and some environment.

**Environment / Background:** Modern office setting with clean lines and contemporary furniture, professional atmosphere with subtle background details.

**Lighting & Atmosphere:** Natural lighting from large windows, soft ambient office lighting, balanced exposure that maintains professional appearance.

**Style Enhancers:** Clean, professional color grading, subtle depth of field, natural motion blur, high-quality rendering suitable for business content.""",
                "duration": 5.0,
                "motion": "gentle gesturing",
                "negative": "blurry, low quality, cluttered background",
                "seed": 123456790
            },
            {
                "id": 3,
                "prompt": f"""**Main Subject:** {character_description}

**Clothing / Appearance:** Casual yet stylish urban attire, comfortable clothing suitable for walking, modern street fashion that reflects personality.

**Pose / Action:** Walking confidently through urban environment, natural stride with purpose, arms swinging naturally, head held high.

**Expression / Emotion:** Confident and determined expression, eyes focused ahead, slight smile showing contentment and purpose.

**Camera Direction & Framing:** Wide establishing shot, slightly low angle for empowerment, dynamic composition that captures movement and environment.

**Environment / Background:** Modern urban street with contemporary architecture, people in background, city atmosphere with movement and life.

**Lighting & Atmosphere:** Golden hour lighting creating warm, cinematic atmosphere, natural sunlight casting long shadows, dramatic sky colors.

**Style Enhancers:** Cinematic color grading with warm golden tones, motion blur from walking, depth of field effects, filmic quality with slight grain.""",
                "duration": 6.0,
                "motion": "walking motion",
                "negative": "blurry, low quality, crowded scene",
                "seed": 123456791
            },
            {
                "id": 4,
                "prompt": f"""**Main Subject:** {character_description}

**Clothing / Appearance:** Simple, elegant attire that allows focus on emotional expression, neutral colors that don't distract from the moment.

**Pose / Action:** Close-up framing focusing on facial features, subtle movements that convey emotional depth, natural and unposed.

**Expression / Emotion:** Deep emotional expression showing vulnerability and strength, eyes conveying complex feelings, authentic human emotion.

**Camera Direction & Framing:** Extreme close-up on face, intimate framing that captures every subtle expression, tight composition for emotional impact.

**Environment / Background:** Minimal background that doesn't distract, focus entirely on the subject's emotional state and expression.

**Lighting & Atmosphere:** Dramatic lighting that enhances emotional impact, chiaroscuro effects, moody atmosphere that supports the emotional tone.

**Style Enhancers:** High contrast black and white or dramatic color grading, shallow depth of field, intimate cinematography, emotional color palette.""",
                "duration": 4.0,
                "motion": "emotional expression change",
                "negative": "blurry, low quality, static expression",
                "seed": 123456792
            },
            {
                "id": 5,
                "prompt": f"""**Main Subject:** {character_description}

**Clothing / Appearance:** Professional attire that conveys determination and focus, well-fitted clothing that allows for confident movement and posture.

**Pose / Action:** Strong, determined pose showing focus and purpose, confident body language that conveys leadership and capability.

**Expression / Emotion:** Determined and focused expression, eyes showing concentration and drive, slight intensity that conveys purpose.

**Camera Direction & Framing:** Medium close-up shot, slightly low angle for empowerment, dynamic composition that captures determination and strength.

**Environment / Background:** Professional environment that supports the determined mood, clean and focused background that doesn't distract.

**Lighting & Atmosphere:** Dramatic lighting that enhances the determined mood, strong key lighting, subtle shadows that add depth and character.

**Style Enhancers:** High contrast lighting, dramatic color grading, sharp focus, cinematic quality that enhances the determined atmosphere.""",
                "duration": 5.0,
                "motion": "subtle facial expressions",
                "negative": "blurry, low quality, flat lighting",
                "seed": 123456793
            },
            {
                "id": 6,
                "prompt": f"""**Main Subject:** {character_description}

**Clothing / Appearance:** Futuristic or high-tech attire that fits the setting, modern clothing with subtle technological elements or sleek styling.

**Pose / Action:** Exploring or interacting with the futuristic environment, curious and engaged movements, natural exploration of the space.

**Expression / Emotion:** Wonder and curiosity, eyes showing amazement and interest, slight smile of discovery and engagement.

**Camera Direction & Framing:** Wide establishing shot that captures both subject and environment, balanced composition showing scale and wonder.

**Environment / Background:** Futuristic setting with high-tech elements, neon lighting, advanced technology visible in background, sci-fi atmosphere.

**Lighting & Atmosphere:** Neon lighting creating futuristic atmosphere, cool blue and purple tones, dramatic lighting that enhances the sci-fi mood.

**Style Enhancers:** Cool color grading with neon accents, futuristic lighting effects, high-tech atmosphere, cinematic sci-fi quality.""",
                "duration": 7.0,
                "motion": "exploring movement",
                "negative": "blurry, low quality, outdated setting",
                "seed": 123456794
            },
            {
                "id": 7,
                "prompt": f"""**Main Subject:** {character_description}

**Clothing / Appearance:** Casual attire that allows for natural movement and expression, comfortable clothing suitable for emotional moments.

**Pose / Action:** Sudden reaction or movement, natural response to something unexpected, authentic human reaction captured in the moment.

**Expression / Emotion:** Shocked or surprised expression, eyes wide with amazement or concern, genuine emotional response to the situation.

**Camera Direction & Framing:** Close-up shot that captures the immediate reaction, tight framing on facial expression, intimate composition.

**Environment / Background:** Minimal background that doesn't distract from the reaction, focus on the emotional moment and expression.

**Lighting & Atmosphere:** Intense lighting that enhances the dramatic moment, strong contrast, moody atmosphere that supports the emotional impact.

**Style Enhancers:** High contrast lighting, dramatic color grading, sharp focus on expression, cinematic quality that captures the emotional moment.""",
                "duration": 4.0,
                "motion": "sudden reaction",
                "negative": "blurry, low quality, calm expression",
                "seed": 123456795
            },
            {
                "id": 8,
                "prompt": f"""**Main Subject:** {character_description}

**Clothing / Appearance:** Athletic or action-appropriate attire, clothing that allows for dynamic movement and action sequences.

**Pose / Action:** Dynamic action pose, energetic movement, strong and purposeful actions that convey power and capability.

**Expression / Emotion:** Determined and focused expression during action, eyes showing concentration and drive, intense emotional state.

**Camera Direction & Framing:** Dynamic camera angle that captures the action, slightly low angle for empowerment, movement-oriented composition.

**Environment / Background:** Action-appropriate environment, dynamic background that supports the movement and energy of the scene.

**Lighting & Atmosphere:** Dynamic lighting that enhances the action, strong key lighting, dramatic shadows that add depth and energy.

**Style Enhancers:** Motion blur effects, dynamic color grading, action-oriented cinematography, energetic atmosphere and pacing.""",
                "duration": 6.0,
                "motion": "action sequence",
                "negative": "blurry, low quality, static pose",
                "seed": 123456796
            }
        ]
    
    def save_screenplay(self, screenplay_data, output_dir="data/projects"):
        """Save the screenplay to a JSON file."""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        # Create project directory
        project_name = screenplay_data["title"].replace(" ", "_").replace(":", "").replace(".", "")
        project_dir = output_path / project_name
        project_dir.mkdir(exist_ok=True)
        
        # Save screenplay
        screenplay_file = project_dir / "screenplay.json"
        with open(screenplay_file, 'w') as f:
            json.dump(screenplay_data, f, indent=2)
        
        # Save ComfyUI format
        comfyui_file = project_dir / "shots_prompts_comfy.json"
        comfyui_data = {
            "title": screenplay_data["title"],
            "character_description": screenplay_data["character_description"],
            "user_prompt": screenplay_data["user_prompt"],
            "shots": screenplay_data["shots"]
        }
        with open(comfyui_file, 'w') as f:
            json.dump(comfyui_data, f, indent=2)
        
        print(f"✅ Screenplay saved to: {screenplay_file}")
        print(f"✅ ComfyUI format saved to: {comfyui_file}")
        
        return str(project_dir)

async def main():
    """Main function for command-line usage."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Generate enhanced screenplay from user input")
    parser.add_argument("prompt", help="User's story idea or concept")
    parser.add_argument("--project-name", help="Project name")
    parser.add_argument("--character", help="Character description")
    parser.add_argument("--output-dir", default="data/projects", help="Output directory")
    
    args = parser.parse_args()
    
    generator = EnhancedScreenplayGenerator()
    
    try:
        screenplay = await generator.generate_screenplay_from_user_input(
            args.prompt, args.project_name, args.character
        )
        
        project_dir = await generator.save_screenplay(screenplay, args.output_dir)
        
        print(f"\n🎉 Screenplay generated successfully!")
        print(f"📁 Project directory: {project_dir}")
        print(f"📊 Total shots: {screenplay['shot_count']}")
        print(f"⏱️ Total duration: {screenplay['total_duration']:.1f}s")
        print(f"🎭 Character: {screenplay['character_description'][:100]}...")
        
    except Exception as e:
        print(f"❌ Error generating screenplay: {e}")

if __name__ == "__main__":
    asyncio.run(main())
