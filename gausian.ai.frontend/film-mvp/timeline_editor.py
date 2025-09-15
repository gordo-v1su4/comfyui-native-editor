#!/usr/bin/env python3
"""
Web-based Timeline Editor for AI-generated videos.
Provides a visual interface to view and edit videos on a timeline.
"""

import os
import json
import base64
import subprocess
import webbrowser
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any

from flask import Flask, request, jsonify, render_template_string, send_file
from flask_cors import CORS
import time

app = Flask(__name__)
CORS(app)

# Global variables
projects_dir = Path("timeline_projects")
projects_dir.mkdir(exist_ok=True)

# HTML template for the timeline editor
TIMELINE_EDITOR_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Video Timeline Editor</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #1a1a1a;
            color: #ffffff;
            overflow-x: auto;
        }
        
        .header {
            background: #2d2d2d;
            padding: 20px;
            border-bottom: 2px solid #444;
        }
        
        .header h1 {
            color: #00ff88;
            margin-bottom: 10px;
        }
        
        .controls {
            display: flex;
            gap: 20px;
            align-items: center;
            margin-bottom: 20px;
        }
        
        .btn {
            background: #00ff88;
            color: #000;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            transition: background 0.3s;
        }
        
        .btn:hover {
            background: #00cc6a;
        }
        
        .btn.secondary {
            background: #444;
            color: #fff;
        }
        
        .btn.secondary:hover {
            background: #555;
        }
        
        .timeline-container {
            padding: 20px;
            min-height: 400px;
        }
        
        .timeline {
            background: #2d2d2d;
            border: 1px solid #444;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }
        
        .timeline-header {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid #444;
        }
        
        .timeline-title {
            font-size: 24px;
            font-weight: bold;
            color: #00ff88;
            flex: 1;
        }
        
        .timeline-duration {
            color: #ccc;
            font-size: 14px;
        }
        
        .timeline-tracks {
            position: relative;
        }
        
        .track {
            display: flex;
            align-items: center;
            margin-bottom: 10px;
            min-height: 80px;
            background: #333;
            border-radius: 5px;
            padding: 10px;
            position: relative;
        }
        
        .track-label {
            width: 120px;
            font-weight: bold;
            color: #00ff88;
            margin-right: 20px;
        }
        
        .track-content {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 10px;
            overflow-x: auto;
            padding: 10px;
            background: #222;
            border-radius: 5px;
            min-height: 60px;
        }
        
        .clip {
            background: linear-gradient(135deg, #00ff88, #00cc6a);
            color: #000;
            padding: 10px;
            border-radius: 5px;
            min-width: 120px;
            text-align: center;
            font-weight: bold;
            cursor: pointer;
            transition: transform 0.2s;
            position: relative;
            border: 2px solid transparent;
        }
        
        .clip:hover {
            transform: scale(1.05);
            border-color: #fff;
        }
        
        .clip.selected {
            border-color: #ff6b6b;
            background: linear-gradient(135deg, #ff6b6b, #ff5252);
        }
        
        .clip-duration {
            font-size: 12px;
            margin-top: 5px;
            opacity: 0.8;
        }
        
        .video-preview {
            background: #000;
            border-radius: 8px;
            padding: 20px;
            margin-top: 20px;
        }
        
        .video-preview h3 {
            color: #00ff88;
            margin-bottom: 15px;
        }
        
        .video-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }
        
        .video-item {
            background: #333;
            border-radius: 8px;
            padding: 15px;
            text-align: center;
            cursor: pointer;
            transition: background 0.3s;
        }
        
        .video-item:hover {
            background: #444;
        }
        
        .video-item.selected {
            background: #00ff88;
            color: #000;
        }
        
        .video-thumbnail {
            width: 100%;
            height: 120px;
            background: #222;
            border-radius: 5px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 10px;
            font-size: 24px;
        }
        
        .video-name {
            font-weight: bold;
            margin-bottom: 5px;
        }
        
        .video-duration {
            font-size: 12px;
            opacity: 0.8;
        }
        
        .status {
            background: #2d2d2d;
            padding: 15px;
            border-radius: 8px;
            margin-top: 20px;
            border-left: 4px solid #00ff88;
        }
        
        .loading {
            text-align: center;
            padding: 40px;
            color: #ccc;
        }
        
        .error {
            background: #ff4444;
            color: #fff;
            padding: 15px;
            border-radius: 5px;
            margin: 10px 0;
        }
        
        .success {
            background: #00ff88;
            color: #000;
            padding: 15px;
            border-radius: 5px;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎬 AI Video Timeline Editor</h1>
        <div class="controls">
            <button class="btn" onclick="loadVideos()">📁 Load Videos</button>
            <button class="btn" onclick="createTimeline()">🎬 Create Timeline</button>
            <button class="btn secondary" onclick="exportVideo()">📤 Export Video</button>
            <button class="btn secondary" onclick="refreshData()">🔄 Refresh</button>
        </div>
    </div>
    
    <div class="timeline-container">
        <div id="status" class="status">
            <strong>Ready!</strong> Click "Load Videos" to start editing your AI-generated videos.
        </div>
        
        <div id="video-preview" class="video-preview" style="display: none;">
            <h3>📹 Available Videos</h3>
            <div id="video-grid" class="video-grid"></div>
        </div>
        
        <div id="timeline" class="timeline" style="display: none;">
            <div class="timeline-header">
                <div class="timeline-title">Timeline</div>
                <div class="timeline-duration">Duration: <span id="total-duration">0s</span></div>
            </div>
            <div class="timeline-tracks">
                <div class="track">
                    <div class="track-label">Main Track</div>
                    <div id="track-content" class="track-content"></div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        let videos = [];
        let timeline = [];
        let selectedClip = null;
        
        async function loadVideos() {
            try {
                updateStatus('Loading videos...', 'loading');
                
                const response = await fetch('/api/videos');
                const data = await response.json();
                
                if (data.success) {
                    videos = data.videos;
                    displayVideos();
                    updateStatus(`Loaded ${videos.length} videos successfully!`, 'success');
                } else {
                    updateStatus('Failed to load videos: ' + data.error, 'error');
                }
            } catch (error) {
                updateStatus('Error loading videos: ' + error.message, 'error');
            }
        }
        
        function displayVideos() {
            const videoGrid = document.getElementById('video-grid');
            const videoPreview = document.getElementById('video-preview');
            
            videoGrid.innerHTML = '';
            
            videos.forEach((video, index) => {
                const videoItem = document.createElement('div');
                videoItem.className = 'video-item';
                videoItem.onclick = () => selectVideo(index);
                
                videoItem.innerHTML = `
                    <div class="video-thumbnail">🎬</div>
                    <div class="video-name">${video.name}</div>
                    <div class="video-duration">${video.duration.toFixed(2)}s</div>
                `;
                
                videoGrid.appendChild(videoItem);
            });
            
            videoPreview.style.display = 'block';
        }
        
        function selectVideo(index) {
            // Remove previous selection
            document.querySelectorAll('.video-item').forEach(item => {
                item.classList.remove('selected');
            });
            
            // Add selection to clicked item
            event.target.closest('.video-item').classList.add('selected');
            
            // Add to timeline
            const video = videos[index];
            timeline.push({
                id: timeline.length,
                video: video,
                startTime: timeline.length > 0 ? timeline[timeline.length - 1].startTime + timeline[timeline.length - 1].video.duration : 0
            });
            
            displayTimeline();
            updateStatus(`Added ${video.name} to timeline`, 'success');
        }
        
        function displayTimeline() {
            const trackContent = document.getElementById('track-content');
            const totalDuration = document.getElementById('total-duration');
            const timelineDiv = document.getElementById('timeline');
            
            trackContent.innerHTML = '';
            
            let total = 0;
            
            timeline.forEach((clip, index) => {
                const clipElement = document.createElement('div');
                clipElement.className = 'clip';
                clipElement.onclick = () => selectClip(index);
                
                clipElement.innerHTML = `
                    <div>${clip.video.name}</div>
                    <div class="clip-duration">${clip.video.duration.toFixed(2)}s</div>
                `;
                
                trackContent.appendChild(clipElement);
                total += clip.video.duration;
            });
            
            totalDuration.textContent = total.toFixed(2) + 's';
            timelineDiv.style.display = 'block';
        }
        
        function selectClip(index) {
            // Remove previous selection
            document.querySelectorAll('.clip').forEach(clip => {
                clip.classList.remove('selected');
            });
            
            // Add selection to clicked clip
            event.target.closest('.clip').classList.add('selected');
            selectedClip = index;
            
            updateStatus(`Selected clip: ${timeline[index].video.name}`, 'success');
        }
        
        async function createTimeline() {
            if (timeline.length === 0) {
                updateStatus('No videos in timeline. Add some videos first!', 'error');
                return;
            }
            
            try {
                updateStatus('Creating timeline...', 'loading');
                
                const response = await fetch('/api/timeline', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        clips: timeline.map(clip => ({
                            video_path: clip.video.path,
                            name: clip.video.name,
                            start_time: clip.startTime
                        }))
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    updateStatus('Timeline created successfully!', 'success');
                } else {
                    updateStatus('Failed to create timeline: ' + data.error, 'error');
                }
            } catch (error) {
                updateStatus('Error creating timeline: ' + error.message, 'error');
            }
        }
        
        async function exportVideo() {
            if (timeline.length === 0) {
                updateStatus('No timeline to export. Create a timeline first!', 'error');
                return;
            }
            
            try {
                updateStatus('Exporting video...', 'loading');
                
                const response = await fetch('/api/export', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        clips: timeline.map(clip => ({
                            video_path: clip.video.path,
                            name: clip.video.name,
                            start_time: clip.startTime
                        }))
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    updateStatus(`Video exported successfully! File: ${data.output_path}`, 'success');
                } else {
                    updateStatus('Failed to export video: ' + data.error, 'error');
                }
            } catch (error) {
                updateStatus('Error exporting video: ' + error.message, 'error');
            }
        }
        
        function refreshData() {
            loadVideos();
        }
        
        function updateStatus(message, type) {
            const statusDiv = document.getElementById('status');
            statusDiv.innerHTML = `<strong>${message}</strong>`;
            statusDiv.className = `status ${type}`;
        }
        
        // Load videos on page load
        window.onload = function() {
            loadVideos();
        };
    </script>
</body>
</html>
"""

def get_video_duration(video_path: str) -> float:
    """Get video duration using FFmpeg."""
    try:
        cmd = [
            'ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
            '-of', 'csv=p=0', video_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            return float(result.stdout.strip())
        else:
            return 5.0  # Default duration
            
    except Exception as e:
        print(f"⚠️ Could not get video duration: {e}")
        return 5.0  # Default duration

def find_videos() -> List[Dict[str, Any]]:
    """Find all video files in the output directory."""
    videos = []
    output_dir = Path("wan22_enhanced_output")
    
    if not output_dir.exists():
        return videos
    
    video_files = list(output_dir.glob("shot_*_wan22_t2v.mp4"))
    video_files.sort()
    
    for video_file in video_files:
        duration = get_video_duration(str(video_file))
        videos.append({
            "name": video_file.name,
            "path": str(video_file),
            "duration": duration,
            "size": video_file.stat().st_size
        })
    
    return videos

def concatenate_videos(video_files: list, output_name: str = "timeline_export.mp4") -> str:
    """Concatenate videos using FFmpeg."""
    try:
        if not video_files:
            raise Exception("No video files provided")
        
        # Create output directory
        output_dir = Path("timeline_exports")
        output_dir.mkdir(exist_ok=True)
        
        # Create file list for FFmpeg
        file_list_path = output_dir / "file_list.txt"
        with open(file_list_path, 'w') as f:
            for video_file in video_files:
                f.write(f"file '{os.path.abspath(video_file)}'\n")
        
        # Output path
        output_path = output_dir / output_name
        
        print(f"🎬 Concatenating {len(video_files)} videos...")
        
        # Concatenate videos using FFmpeg
        cmd = [
            'ffmpeg', '-f', 'concat', '-safe', '0',
            '-i', str(file_list_path),
            '-c', 'copy', str(output_path),
            '-y'  # Overwrite output file
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        
        if result.returncode == 0:
            print(f"✅ Successfully created: {output_path}")
            return str(output_path)
        else:
            raise Exception(f"FFmpeg failed: {result.stderr}")
            
    except Exception as e:
        print(f"❌ Failed to concatenate videos: {e}")
        raise

@app.route('/')
def timeline_editor():
    """Serve the timeline editor interface."""
    return TIMELINE_EDITOR_HTML

@app.route('/api/videos', methods=['GET'])
def get_videos():
    """Get list of available videos."""
    try:
        videos = find_videos()
        return jsonify({
            "success": True,
            "videos": videos
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/api/timeline', methods=['POST'])
def create_timeline():
    """Create a timeline from the provided clips."""
    try:
        data = request.get_json()
        clips = data.get('clips', [])
        
        # Save timeline data
        timeline_data = {
            "created_at": datetime.now().isoformat(),
            "clips": clips,
            "total_duration": sum(clip.get('duration', 5.0) for clip in clips)
        }
        
        timeline_file = projects_dir / f"timeline_{int(time.time())}.json"
        with open(timeline_file, 'w') as f:
            json.dump(timeline_data, f, indent=2)
        
        return jsonify({
            "success": True,
            "timeline_id": timeline_file.stem,
            "message": f"Timeline created with {len(clips)} clips"
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/api/export', methods=['POST'])
def export_video():
    """Export the timeline as a video."""
    try:
        data = request.get_json()
        clips = data.get('clips', [])
        
        if not clips:
            return jsonify({
                "success": False,
                "error": "No clips provided"
            }), 400
        
        # Extract video paths
        video_paths = [clip['video_path'] for clip in clips]
        
        # Concatenate videos
        output_name = f"timeline_export_{int(time.time())}.mp4"
        output_path = concatenate_videos(video_paths, output_name)
        
        return jsonify({
            "success": True,
            "output_path": output_path,
            "message": f"Video exported successfully"
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

def start_server(host='localhost', port=5000):
    """Start the timeline editor server."""
    print(f"🚀 Starting Timeline Editor on http://{host}:{port}")
    print(f"📁 Projects directory: {projects_dir.absolute()}")
    print(f"🌐 Open your browser to: http://{host}:{port}")
    
    # Open browser automatically
    webbrowser.open(f"http://{host}:{port}")
    
    app.run(host=host, port=port, debug=True)

if __name__ == '__main__':
    start_server()


