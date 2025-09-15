"""
Utilities module with helper functions for the film MVP project.
"""

import os
import json
import logging
from typing import Dict, List, Any, Optional, Union
from pathlib import Path
from datetime import datetime
import hashlib
import re

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class FileManager:
    """Utility class for file operations."""
    
    def __init__(self, base_path: str = "data/projects"):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)
    
    def save_json(self, data: Dict[str, Any], filename: str, project_name: str = "default") -> str:
        """Save data to JSON file."""
        project_path = self.base_path / project_name
        project_path.mkdir(exist_ok=True)
        
        file_path = project_path / f"{filename}.json"
        
        # Add metadata
        data_with_metadata = {
            "metadata": {
                "created_at": datetime.now().isoformat(),
                "version": "1.0",
                "project": project_name
            },
            "data": data
        }
        
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data_with_metadata, f, indent=2, ensure_ascii=False)
        
        logger.info(f"Saved data to {file_path}")
        return str(file_path)
    
    def load_json(self, filename: str, project_name: str = "default") -> Dict[str, Any]:
        """Load data from JSON file."""
        file_path = self.base_path / project_name / f"{filename}.json"
        
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        logger.info(f"Loaded data from {file_path}")
        return data.get("data", data)
    
    def list_projects(self) -> List[str]:
        """List all projects."""
        projects = []
        for item in self.base_path.iterdir():
            if item.is_dir():
                projects.append(item.name)
        return projects
    
    def list_project_files(self, project_name: str) -> List[str]:
        """List all files in a project."""
        project_path = self.base_path / project_name
        if not project_path.exists():
            return []
        
        files = []
        for item in project_path.iterdir():
            if item.is_file() and item.suffix == '.json':
                files.append(item.stem)
        return files
    
    def delete_project(self, project_name: str) -> bool:
        """Delete a project and all its files."""
        project_path = self.base_path / project_name
        if project_path.exists():
            import shutil
            shutil.rmtree(project_path)
            logger.info(f"Deleted project: {project_name}")
            return True
        return False

class TextProcessor:
    """Utility class for text processing."""
    
    @staticmethod
    def clean_text(text: str) -> str:
        """Clean and normalize text."""
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text.strip())
        
        # Remove special characters that might cause issues
        text = re.sub(r'[^\w\s\.\,\!\?\-\:\;\(\)]', '', text)
        
        return text
    
    @staticmethod
    def extract_sentences(text: str) -> List[str]:
        """Extract sentences from text."""
        # Simple sentence splitting
        sentences = re.split(r'[.!?]+', text)
        return [s.strip() for s in sentences if s.strip()]
    
    @staticmethod
    def count_words(text: str) -> int:
        """Count words in text."""
        return len(text.split())
    
    @staticmethod
    def estimate_reading_time(text: str, words_per_minute: int = 200) -> float:
        """Estimate reading time in minutes."""
        word_count = TextProcessor.count_words(text)
        return word_count / words_per_minute
    
    @staticmethod
    def extract_keywords(text: str, max_keywords: int = 10) -> List[str]:
        """Extract keywords from text (simplified version)."""
        # Remove common stop words
        stop_words = {
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those'
        }
        
        words = re.findall(r'\b\w+\b', text.lower())
        word_freq = {}
        
        for word in words:
            if word not in stop_words and len(word) > 2:
                word_freq[word] = word_freq.get(word, 0) + 1
        
        # Sort by frequency and return top keywords
        sorted_words = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)
        return [word for word, freq in sorted_words[:max_keywords]]

class ValidationUtils:
    """Utility class for data validation."""
    
    @staticmethod
    def validate_story_data(data: Dict[str, Any]) -> List[str]:
        """Validate story data structure."""
        errors = []
        
        required_fields = ['title', 'genre', 'duration', 'synopsis']
        for field in required_fields:
            if field not in data:
                errors.append(f"Missing required field: {field}")
        
        if 'duration' in data and not isinstance(data['duration'], int):
            errors.append("Duration must be an integer")
        
        if 'duration' in data and data['duration'] <= 0:
            errors.append("Duration must be positive")
        
        if 'characters' in data and not isinstance(data['characters'], list):
            errors.append("Characters must be a list")
        
        if 'scenes' in data and not isinstance(data['scenes'], list):
            errors.append("Scenes must be a list")
        
        return errors
    
    @staticmethod
    def validate_character_data(data: Dict[str, Any]) -> List[str]:
        """Validate character data structure."""
        errors = []
        
        required_fields = ['name', 'age', 'occupation', 'role']
        for field in required_fields:
            if field not in data:
                errors.append(f"Missing required field: {field}")
        
        if 'age' in data and not isinstance(data['age'], int):
            errors.append("Age must be an integer")
        
        if 'age' in data and (data['age'] < 0 or data['age'] > 120):
            errors.append("Age must be between 0 and 120")
        
        return errors
    
    @staticmethod
    def validate_scene_data(data: Dict[str, Any]) -> List[str]:
        """Validate scene data structure."""
        errors = []
        
        required_fields = ['scene_number', 'location', 'action']
        for field in required_fields:
            if field not in data:
                errors.append(f"Missing required field: {field}")
        
        if 'scene_number' in data and not isinstance(data['scene_number'], int):
            errors.append("Scene number must be an integer")
        
        if 'duration' in data and not isinstance(data['duration'], (int, float)):
            errors.append("Duration must be a number")
        
        return errors

class ConfigManager:
    """Utility class for configuration management."""
    
    def __init__(self, config_file: str = "config.json"):
        self.config_file = Path(config_file)
        self.config = self._load_config()
    
    def _load_config(self) -> Dict[str, Any]:
        """Load configuration from file."""
        default_config = {
            "llm": {
                "provider": "openai",
                "default_model": "gpt-4",
                "temperature": 0.7,
                "max_tokens": 2000
            },
            "story": {
                "default_genre": "drama",
                "default_duration": 10,
                "max_characters": 5,
                "max_scenes": 10
            },
            "shots": {
                "default_shots_per_scene": 5,
                "min_shot_duration": 0.5,
                "max_shot_duration": 10.0
            },
            "output": {
                "format": "json",
                "include_metadata": True,
                "pretty_print": True
            }
        }
        
        if self.config_file.exists():
            try:
                with open(self.config_file, 'r') as f:
                    user_config = json.load(f)
                # Merge with defaults
                return self._merge_configs(default_config, user_config)
            except (json.JSONDecodeError, IOError) as e:
                logger.warning(f"Error loading config file: {e}. Using defaults.")
        
        return default_config
    
    def _merge_configs(self, default: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
        """Merge user config with defaults."""
        result = default.copy()
        
        def merge_dicts(d1: Dict[str, Any], d2: Dict[str, Any]) -> None:
            for key, value in d2.items():
                if key in d1 and isinstance(d1[key], dict) and isinstance(value, dict):
                    merge_dicts(d1[key], value)
                else:
                    d1[key] = value
        
        merge_dicts(result, user)
        return result
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get configuration value."""
        keys = key.split('.')
        value = self.config
        
        for k in keys:
            if isinstance(value, dict) and k in value:
                value = value[k]
            else:
                return default
        
        return value
    
    def set(self, key: str, value: Any) -> None:
        """Set configuration value."""
        keys = key.split('.')
        config = self.config
        
        for k in keys[:-1]:
            if k not in config:
                config[k] = {}
            config = config[k]
        
        config[keys[-1]] = value
    
    def save(self) -> None:
        """Save configuration to file."""
        with open(self.config_file, 'w') as f:
            json.dump(self.config, f, indent=2)
    
    def reset_to_defaults(self) -> None:
        """Reset configuration to defaults."""
        self.config = self._load_config()
        self.save()

class PerformanceMonitor:
    """Utility class for monitoring performance."""
    
    def __init__(self):
        self.metrics = {}
        self.start_times = {}
    
    def start_timer(self, name: str) -> None:
        """Start a timer for a named operation."""
        self.start_times[name] = datetime.now()
    
    def end_timer(self, name: str) -> float:
        """End a timer and return duration in seconds."""
        if name not in self.start_times:
            raise ValueError(f"Timer '{name}' was not started")
        
        duration = (datetime.now() - self.start_times[name]).total_seconds()
        
        if name not in self.metrics:
            self.metrics[name] = []
        
        self.metrics[name].append(duration)
        del self.start_times[name]
        
        logger.info(f"Operation '{name}' took {duration:.2f} seconds")
        return duration
    
    def get_average_time(self, name: str) -> float:
        """Get average time for a named operation."""
        if name not in self.metrics:
            return 0.0
        
        return sum(self.metrics[name]) / len(self.metrics[name])
    
    def get_total_time(self, name: str) -> float:
        """Get total time for a named operation."""
        if name not in self.metrics:
            return 0.0
        
        return sum(self.metrics[name])
    
    def get_metrics_summary(self) -> Dict[str, Any]:
        """Get summary of all metrics."""
        summary = {}
        for name, times in self.metrics.items():
            summary[name] = {
                "count": len(times),
                "average": sum(times) / len(times),
                "total": sum(times),
                "min": min(times),
                "max": max(times)
            }
        return summary

# Global instances
file_manager = FileManager()
config_manager = ConfigManager()
performance_monitor = PerformanceMonitor()
