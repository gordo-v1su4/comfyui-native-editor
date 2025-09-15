"""
Film MVP - AI-powered film story generation toolkit.

This package provides tools for generating film stories, characters, dialogue,
and shot descriptions using large language models.
"""

__version__ = "1.0.0"
__author__ = "Film MVP Team"

from .llm import LLMClient
from .prompts import FilmPrompts
from .storygen import StoryGenerator, Story, Character, Scene
from .gen_shots import ShotGenerator, Shot, Storyboard, ShotType, CameraAngle
from .make_cut import VideoMaker
from .utils import (
    FileManager, 
    TextProcessor, 
    ValidationUtils, 
    ConfigManager, 
    PerformanceMonitor,
    file_manager,
    config_manager,
    performance_monitor
)

__all__ = [
    "LLMClient",
    "FilmPrompts", 
    "StoryGenerator",
    "Story",
    "Character", 
    "Scene",
    "ShotGenerator",
    "Shot",
    "Storyboard",
    "ShotType",
    "CameraAngle",
    "VideoMaker",
    "FileManager",
    "TextProcessor",
    "ValidationUtils", 
    "ConfigManager",
    "PerformanceMonitor",
    "file_manager",
    "config_manager",
    "performance_monitor"
]
