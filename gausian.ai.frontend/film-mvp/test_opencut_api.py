#!/usr/bin/env python3
"""
Test script to verify OpenCut API endpoints.
"""

import requests
import json

def test_api_endpoints():
    """Test the OpenCut API endpoints."""
    base_url = "http://localhost:3000"
    
    print("🧪 Testing OpenCut API endpoints...")
    
    # Test 1: Create a project
    print("\n1. Testing project creation...")
    project_data = {
        "name": "Test Project",
        "description": "API test project",
        "resolution": {"width": 720, "height": 480},
        "frameRate": 24
    }
    
    response = requests.post(f"{base_url}/api/projects", json=project_data)
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        project = response.json()
        project_id = project.get('id')
        print(f"✅ Project created: {project_id}")
    else:
        print(f"❌ Failed: {response.text}")
        return
    
    # Test 2: List projects
    print("\n2. Testing project listing...")
    response = requests.get(f"{base_url}/api/projects")
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        print("✅ Projects endpoint working")
    else:
        print(f"❌ Failed: {response.text}")
    
    # Test 3: Create timeline
    print("\n3. Testing timeline creation...")
    timeline_data = {
        "clips": [
            {
                "projectId": project_id,
                "videoId": "test-video-1",
                "startTime": 0.0,
                "duration": 5.0,
                "track": 0
            }
        ]
    }
    
    response = requests.post(f"{base_url}/api/projects/{project_id}/timeline", json=timeline_data)
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        print("✅ Timeline created")
    else:
        print(f"❌ Failed: {response.text}")
    
    # Test 4: Get timeline
    print("\n4. Testing timeline retrieval...")
    response = requests.get(f"{base_url}/api/projects/{project_id}/timeline")
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        timeline = response.json()
        print(f"✅ Timeline retrieved: {len(timeline.get('clips', []))} clips")
    else:
        print(f"❌ Failed: {response.text}")
    
    print("\n🎉 API testing completed!")

if __name__ == "__main__":
    test_api_endpoints()


