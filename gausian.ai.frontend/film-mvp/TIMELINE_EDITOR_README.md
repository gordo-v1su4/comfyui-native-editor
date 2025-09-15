# Web-based Timeline Editor

This project now includes a **Web-based Timeline Editor** that provides a visual interface to view and edit your AI-generated videos on a timeline.

## 🎬 What is the Timeline Editor?

The Timeline Editor is a web-based application that provides:

- **Visual Timeline Interface**: See your videos arranged on a timeline
- **Drag & Drop Editing**: Click to add videos to your timeline
- **Real-time Preview**: See video durations and total timeline length
- **Export Functionality**: Export your edited timeline as a final video
- **Modern UI**: Beautiful, responsive web interface

## 🚀 Getting Started

### 1. Launch the Timeline Editor

```bash
# Launch the timeline editor directly
python timeline_editor.py

# Or run the complete pipeline (includes timeline editor)
python run_enhanced_pipeline.py your-runpod-endpoint --character-prompt "your character"
```

### 2. Access the Editor

The timeline editor will automatically open in your browser at:

```
http://localhost:5000
```

## 📁 Files Overview

### Core Files

- **`timeline_editor.py`**: Main timeline editor application
- **`wan22_enhanced_pipeline.py`**: Updated to launch timeline editor
- **`concatenate_videos.py`**: Simple video concatenation script (backup)

## 🔧 How to Use the Timeline Editor

### 1. Load Videos

- Click the **"📁 Load Videos"** button
- The editor will automatically find all AI-generated videos in `wan22_enhanced_output/`
- Videos will appear in a grid with thumbnails and durations

### 2. Create Timeline

- Click on any video to add it to your timeline
- Videos are added sequentially to the main track
- You can see the total duration update in real-time

### 3. Edit Timeline

- Click on clips in the timeline to select them
- Selected clips are highlighted in red
- The timeline shows video names and durations

### 4. Export Video

- Click **"📤 Export Video"** to create the final concatenated video
- The exported video will be saved in `timeline_exports/`
- You'll get a success message with the file path

## 🌐 Timeline Editor Features

### Visual Interface

- **Dark Theme**: Professional dark interface
- **Responsive Design**: Works on desktop and mobile
- **Real-time Updates**: See changes immediately
- **Status Messages**: Clear feedback for all actions

### Video Management

- **Automatic Detection**: Finds all AI-generated videos
- **Duration Display**: Shows exact video durations
- **Thumbnail Preview**: Visual representation of videos
- **Sequential Ordering**: Videos are added in order

### Timeline Features

- **Main Track**: Single track for video arrangement
- **Clip Selection**: Click to select and highlight clips
- **Duration Calculation**: Automatic total duration calculation
- **Visual Timeline**: See all clips arranged horizontally

### Export Options

- **FFmpeg Integration**: Professional video concatenation
- **Quality Preservation**: Maintains original video quality
- **Multiple Formats**: Supports various video formats
- **Automatic Naming**: Timestamped output files

## 🎯 Workflow Example

```bash
# 1. Generate videos using the pipeline
python run_enhanced_pipeline.py your-runpod-endpoint --character-prompt "your character"

# 2. Timeline editor opens automatically
# 3. In the browser:
#    - Click "Load Videos" to see your AI-generated videos
#    - Click on videos to add them to the timeline
#    - Arrange them in the order you want
#    - Click "Export Video" to create the final film
# 4. Your final video is ready!
```

## 🔍 Troubleshooting

### Timeline Editor Not Opening

```bash
# Check if the server is running
curl http://localhost:5000

# Start manually if needed
python timeline_editor.py
```

### No Videos Found

- Make sure you have videos in `wan22_enhanced_output/`
- Check that videos follow the naming pattern: `shot_*_wan22_t2v.mp4`
- Run the video generation pipeline first

### Export Issues

- Ensure FFmpeg is installed: `ffmpeg -version`
- Check available disk space
- Verify video files are not corrupted

## 🌟 Benefits of Timeline Editor

### User Experience

- **Intuitive Interface**: Easy to use, no technical knowledge required
- **Visual Feedback**: See exactly what you're editing
- **Real-time Updates**: Immediate response to your actions
- **Professional Look**: Modern, polished interface

### Functionality

- **No Installation**: Runs in any web browser
- **Cross-Platform**: Works on Windows, Mac, Linux
- **Local Processing**: All processing happens on your machine
- **No Cloud Dependencies**: Works completely offline

### Technical Benefits

- **Fast Loading**: Quick video detection and loading
- **Efficient Processing**: Optimized for performance
- **Reliable Export**: Professional FFmpeg-based export
- **Extensible**: Easy to add new features

## 📋 API Endpoints

The timeline editor provides these API endpoints:

- `GET /` - Main timeline editor interface
- `GET /api/videos` - Get list of available videos
- `POST /api/timeline` - Create a timeline from clips
- `POST /api/export` - Export timeline as video

## 🎉 Success!

Your AI-generated films can now be edited using the timeline editor, where you can:

- View all your videos in a visual interface
- Arrange videos on a timeline
- See exact durations and total length
- Export professional final videos
- Work with a beautiful, intuitive interface

The timeline editor provides a complete solution for editing your AI-generated videos!

## 🔧 Advanced Usage

### Custom Video Sources

You can modify the `find_videos()` function to load videos from different directories:

```python
def find_videos() -> List[Dict[str, Any]]:
    videos = []
    # Change this path to load videos from different locations
    output_dir = Path("your_custom_directory")
    # ... rest of the function
```

### Multiple Tracks

The timeline editor can be extended to support multiple tracks:

```python
# In the HTML template, add more track elements
<div class="track">
    <div class="track-label">Audio Track</div>
    <div class="track-content"></div>
</div>
```

### Custom Export Options

Modify the export function to add custom FFmpeg options:

```python
cmd = [
    'ffmpeg', '-f', 'concat', '-safe', '0',
    '-i', str(file_list_path),
    '-c', 'copy',
    '-metadata', 'title=My AI Film',  # Add metadata
    str(output_path),
    '-y'
]
```

The timeline editor provides a professional, user-friendly way to edit your AI-generated videos!


