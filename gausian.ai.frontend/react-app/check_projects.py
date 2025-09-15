#!/usr/bin/env python3
"""
Script to check and display all available projects.
"""

import requests
import json
from datetime import datetime

def check_projects():
    """Check and display all available projects."""
    api_base_url = "http://localhost:3001"
    
    print("📁 Project Checker")
    print("=" * 40)
    
    # Get all projects
    print("🔍 Fetching projects...")
    response = requests.get(f"{api_base_url}/api/projects")
    
    if response.status_code != 200:
        print(f"❌ Failed to get projects: {response.text}")
        return
    
    projects = response.json().get("projects", [])
    
    if not projects:
        print("📭 No projects found.")
        print("💡 Create a project using: python quick_layout.py sequential")
        return
    
    print(f"✅ Found {len(projects)} project(s):")
    print()
    
    for i, project in enumerate(projects, 1):
        print(f"📁 Project {i}:")
        print(f"   ID: {project['id']}")
        print(f"   Name: {project['name']}")
        print(f"   Description: {project.get('description', 'No description')}")
        
        # Format creation date
        created_at = project.get('createdAt', '')
        if created_at:
            try:
                dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                formatted_date = dt.strftime('%Y-%m-%d %H:%M:%S')
                print(f"   Created: {formatted_date}")
            except:
                print(f"   Created: {created_at}")
        
        # Get timeline info
        timeline_response = requests.get(f"{api_base_url}/api/projects/{project['id']}/timeline")
        if timeline_response.status_code == 200:
            timeline = timeline_response.json()
            tracks = timeline.get("tracks", [])
            total_items = sum(len(track.get("items", [])) for track in tracks)
            print(f"   Timeline Items: {total_items}")
            
            if total_items > 0:
                print("   Timeline Contents:")
                for track_idx, track in enumerate(tracks):
                    items = track.get("items", [])
                    if items:
                        print(f"     Track {track_idx}: {len(items)} items")
                        for item in items[:3]:  # Show first 3 items
                            name = item.get('name', 'Unknown')
                            start = item.get('startTime', 0)
                            duration = item.get('duration', 0)
                            print(f"       - {name} (start: {start:.2f}s, duration: {duration:.2f}s)")
                        if len(items) > 3:
                            print(f"       ... and {len(items) - 3} more items")
        else:
            print("   Timeline: No timeline data")
        
        print()
    
    # Show current active project (most recent)
    if projects:
        latest_project = max(projects, key=lambda p: p.get('createdAt', ''))
        print(f"🎯 Current Active Project: {latest_project['name']} (ID: {latest_project['id']})")
        print(f"🌐 View in browser: http://localhost:5177")

def get_current_project():
    """Get the most recent project (current active project)."""
    api_base_url = "http://localhost:3001"
    
    response = requests.get(f"{api_base_url}/api/projects")
    
    if response.status_code != 200:
        return None
    
    projects = response.json().get("projects", [])
    
    if not projects:
        return None
    
    # Return the most recent project
    return max(projects, key=lambda p: p.get('createdAt', ''))

if __name__ == "__main__":
    check_projects()
