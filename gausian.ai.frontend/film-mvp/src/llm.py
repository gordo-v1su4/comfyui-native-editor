"""
LLM module for handling AI model interactions in the film MVP project.
"""

import os
import asyncio
import requests
from typing import Dict, List, Optional, Any
import openai

# Conditional imports for optional dependencies
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    genai = None

try:
    from anthropic import Anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False
    Anthropic = None

from dotenv import load_dotenv

load_dotenv()

class LLMClient:
    """Client for interacting with various LLM providers."""
    
    def __init__(self, provider: str = "openai"):
        self.provider = provider
        self.openai_client = None
        self.gemini_model = None
        self.anthropic_client = None
        self.ollama_url = "http://localhost:11434"
        
        if provider == "openai":
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise ValueError("OPENAI_API_KEY not found in environment variables")
            self.openai_client = openai.OpenAI(api_key=api_key)
        elif provider == "gemini":
            if not GEMINI_AVAILABLE:
                raise ImportError("google-generativeai is not installed. Run: pip install google-generativeai")
            api_key = os.getenv("GEMINI_API_KEY")
            if not api_key:
                raise ValueError("GEMINI_API_KEY not found in environment variables")
            genai.configure(api_key=api_key)
            self.gemini_model = genai.GenerativeModel('gemini-1.5-flash')
        elif provider == "anthropic":
            if not ANTHROPIC_AVAILABLE:
                raise ImportError("anthropic is not installed. Run: pip install anthropic")
            api_key = os.getenv("ANTHROPIC_API_KEY")
            if not api_key:
                raise ValueError("ANTHROPIC_API_KEY not found in environment variables")
            self.anthropic_client = Anthropic(api_key=api_key)
        elif provider == "ollama":
            # Test Ollama connection
            try:
                response = requests.get(f"{self.ollama_url}/api/tags", timeout=5)
                if response.status_code != 200:
                    raise ConnectionError("Ollama is not running or not accessible")
            except Exception as e:
                raise ConnectionError(f"Could not connect to Ollama: {e}")
    
    async def generate_text(
        self,
        prompt: str,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        **kwargs
    ) -> str:
        """Generate text using the specified LLM provider."""
        
        if self.provider == "openai":
            return await self._generate_openai(
                prompt, model, temperature, max_tokens, **kwargs
            )
        elif self.provider == "gemini":
            if not GEMINI_AVAILABLE:
                raise ImportError("google-generativeai is not installed. Run: pip install google-generativeai")
            return await self._generate_gemini(
                prompt, model, temperature, max_tokens, **kwargs
            )
        elif self.provider == "anthropic":
            if not ANTHROPIC_AVAILABLE:
                raise ImportError("anthropic is not installed. Run: pip install anthropic")
            return await self._generate_anthropic(
                prompt, model, temperature, max_tokens, **kwargs
            )
        elif self.provider == "ollama":
            return await self._generate_ollama(
                prompt, model, temperature, max_tokens, **kwargs
            )
        else:
            raise ValueError(f"Unsupported provider: {self.provider}")
    
    async def _generate_openai(
        self,
        prompt: str,
        model: Optional[str],
        temperature: float,
        max_tokens: int,
        **kwargs
    ) -> str:
        """Generate text using OpenAI API."""
        model = model or os.getenv("DEFAULT_MODEL", "gpt-4")
        
        response = self.openai_client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens,
            **kwargs
        )
        
        return response.choices[0].message.content
    
    async def _generate_gemini(
        self,
        prompt: str,
        model: Optional[str],
        temperature: float,
        max_tokens: int,
        **kwargs
    ) -> str:
        """Generate text using Google Gemini API."""
        try:
            # Create generation config
            generation_config = genai.types.GenerationConfig(
                temperature=temperature,
                max_output_tokens=max_tokens,
                **kwargs
            )
            
            # Generate response
            response = self.gemini_model.generate_content(
                prompt,
                generation_config=generation_config
            )
            
            return response.text
            
        except Exception as e:
            print(f"Gemini API error: {e}")
            # Return a fallback response for testing
            return self._get_fallback_response(prompt)
    
    def _get_fallback_response(self, prompt: str) -> str:
        """Provide fallback responses for testing when API is not available."""
        if "story concept" in prompt.lower():
            return """
            Title: The Redemption Path
            Synopsis: A troubled detective seeks redemption through solving a mysterious case that forces her to confront her past.
            Main Characters: Detective Sarah (35, troubled but determined), Mike Johnson (28, mysterious suspect)
            Key Plot Points: Sarah receives a case that mirrors her own past mistakes, investigation leads to unexpected revelations, Sarah must choose between justice and redemption
            Emotional Arc: From guilt and despair to hope and redemption
            Visual Style: Gritty noir with moments of warmth, high contrast lighting, urban setting
            """
        elif "character development" in prompt.lower():
            return """
            Physical Description: Average height, determined expression, slightly disheveled but professional appearance
            Personality Traits: Intelligent, persistent, haunted by past mistakes, compassionate, analytical
            Background: Former rising star detective who made a critical error that cost lives, now seeking redemption
            Goals: Solve the current case, find personal redemption, restore her reputation
            Internal Conflicts: Guilt over past mistakes, fear of failure, desire for justice vs. personal redemption
            External Conflicts: Resistance from colleagues, time pressure, dangerous suspects
            Character Arc: From self-doubt to confidence, from guilt to acceptance
            Dialogue Style: Direct and professional, occasional moments of vulnerability, uses police jargon naturally
            """
        elif "dialogue" in prompt.lower():
            return """
            SARAH: (examining evidence) This doesn't add up. The timeline is wrong.
            MIKE: (nervous) I told you, I wasn't there that night.
            SARAH: (looking up) Then where were you? And why do your fingerprints match?
            MIKE: (defensive) I don't know! Maybe someone framed me.
            SARAH: (skeptical) Convenient. But evidence doesn't lie.
            MIKE: (desperate) Please, you have to believe me. I'm innocent.
            SARAH: (softening) I want to believe you. But I need the truth.
            """
        elif "shot description" in prompt.lower():
            return """
            Shot Type: Medium close-up
            Camera Angle: Eye level
            Camera Movement: Static
            Duration: 2.0 seconds
            Location: Police station interrogation room
            Characters: Detective Sarah, Mike Johnson
            Action: Sarah confronts Mike with evidence
            Lighting: Harsh overhead fluorescent lighting
            Composition: Two-shot with Sarah in foreground, Mike in background
            Color Palette: High contrast black and white with blue tint
            Sound Design: Tense silence, distant office sounds
            Emotional Impact: Builds tension and suspicion
            Notes: Focus on facial expressions and body language
            """
        else:
            return "Generated content based on the provided prompt."
    
    async def _generate_anthropic(
        self,
        prompt: str,
        model: Optional[str],
        temperature: float,
        max_tokens: int,
        **kwargs
    ) -> str:
        """Generate text using Anthropic API."""
        model = model or "claude-3-sonnet-20240229"
        
        response = self.anthropic_client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            messages=[{"role": "user", "content": prompt}],
            **kwargs
        )
        
        return response.content[0].text
    
    async def _generate_ollama(
        self,
        prompt: str,
        model: Optional[str],
        temperature: float,
        max_tokens: int,
        **kwargs
    ) -> str:
        """Generate text using Ollama API."""
        model = model or "llama3.2:latest"
        try:
            response = requests.post(
                f"{self.ollama_url}/api/generate",
                json={
                    "model": model, 
                    "prompt": prompt, 
                    "stream": False,
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens
                    }
                },
                timeout=120  # 2 minutes timeout for large models
            )
            response.raise_for_status()
            result = response.json()
            return result.get("response", "")
        except requests.exceptions.Timeout:
            print(f"⚠️ Ollama request timed out - model may be loading or too slow")
            return self._get_fallback_response(prompt)
        except requests.exceptions.RequestException as e:
            print(f"⚠️ Ollama API error: {e}")
            return self._get_fallback_response(prompt)
    
    def batch_generate(
        self,
        prompts: List[str],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        **kwargs
    ) -> List[str]:
        """Generate text for multiple prompts in batch."""
        results = []
        for prompt in prompts:
            # Note: This is a simplified batch implementation
            # In production, you might want to use async batching
            if self.provider == "openai":
                try:
                    response = self.openai_client.chat.completions.create(
                        model=model or os.getenv("DEFAULT_MODEL", "gpt-4"),
                        messages=[{"role": "user", "content": prompt}],
                        temperature=temperature,
                        max_tokens=max_tokens,
                        **kwargs
                    )
                    results.append(response.choices[0].message.content)
                except Exception as e:
                    print(f"OpenAI API error: {e}")
                    results.append(self._get_fallback_response(prompt))
            elif self.provider == "gemini":
                if not GEMINI_AVAILABLE:
                    print("google-generativeai is not installed. Using fallback response.")
                    results.append(self._get_fallback_response(prompt))
                else:
                    try:
                        response = self.gemini_model.generate_content(prompt)
                        results.append(response.text)
                    except Exception as e:
                        print(f"Gemini API error: {e}")
                        results.append(self._get_fallback_response(prompt))
            elif self.provider == "anthropic":
                if not ANTHROPIC_AVAILABLE:
                    print("anthropic is not installed. Using fallback response.")
                    results.append(self._get_fallback_response(prompt))
                else:
                    try:
                        response = self.anthropic_client.messages.create(
                            model=model or "claude-3-sonnet-20240229",
                            max_tokens=max_tokens,
                            temperature=temperature,
                            messages=[{"role": "user", "content": prompt}],
                            **kwargs
                        )
                        results.append(response.content[0].text)
                    except Exception as e:
                        print(f"Anthropic API error: {e}")
                        results.append(self._get_fallback_response(prompt))
            elif self.provider == "ollama":
                try:
                    response = requests.post(
                        f"{self.ollama_url}/api/generate",
                        json={
                            "model": model or "llama3.2:latest", 
                            "prompt": prompt, 
                            "stream": False,
                            "options": {
                                "temperature": temperature,
                                "num_predict": max_tokens
                            }
                        },
                        timeout=120  # 2 minutes timeout for large models
                    )
                    response.raise_for_status()
                    result = response.json()
                    results.append(result.get("response", ""))
                except requests.exceptions.Timeout:
                    print(f"⚠️ Ollama request timed out - model may be loading or too slow")
                    results.append(self._get_fallback_response(prompt))
                except requests.exceptions.RequestException as e:
                    print(f"⚠️ Ollama API error: {e}")
                    results.append(self._get_fallback_response(prompt))
            else:
                results.append(self._get_fallback_response(prompt))
        
        return results
