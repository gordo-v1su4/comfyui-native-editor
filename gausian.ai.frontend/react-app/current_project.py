#!/usr/bin/env python3
"""
Quick script to show the current active project.
"""

import requests
import sys

def show_current_project():
    """Show the current active project."""
    api_base_url = "http://localhost:3001"
    
    try:
        response = requests.get(f"{api_base_url}/api/projects")
        
        if response.status_code != 200:
            print("❌ Failed to get projects")
            return
        
        projects = response.json().get("projects", [])
        
        if not projects:
            print("📭 No projects found")
            return
        
        # Get the most recent project
        latest_project = max(projects, key=lambda p: p.get('createdAt', ''))
        
        print(f"🎯 Current Project: {latest_project['name']}")
        print(f"📋 ID: {latest_project['id']}")
        print(f"📝 Description: {latest_project.get('description', 'No description')}")
        print(f"📊 Total Projects: {len(projects)}")
        
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    show_current_project()
