# Shotstack Integration

This project now integrates with **Shotstack** for professional cloud-based video editing capabilities.

## 🎬 What is Shotstack?

Shotstack is a cloud-based video editing platform that provides:

- **Professional Video Editing**: Industry-standard video editing tools
- **Cloud Processing**: No local resources required
- **REST API**: Easy integration with any application
- **Multiple Formats**: Support for various video formats
- **Advanced Features**: Transitions, effects, animations, and more

## 🚀 Getting Started

### 1. Get Shotstack API Key

1. Visit [https://shotstack.io/](https://shotstack.io/)
2. Sign up for an account
3. Get your API key from the dashboard
4. Set the environment variable:

```bash
export SHOTSTACK_API_KEY='your_api_key_here'
```

### 2. Test the Integration

```bash
python shotstack_simple.py
```

### 3. Run the Complete Pipeline

```bash
# Run the full pipeline with Shotstack integration
python run_enhanced_pipeline.py hos2xy0zxfh6cu-8188.proxy.runpod.net --character-prompt "A young woman with flowing hair and mystical aura"
```

## 📁 Files Overview

### Core Integration Files

- **`shotstack_simple.py`**: Simple Shotstack integration script
- **`wan22_enhanced_pipeline.py`**: Updated to use Shotstack
- **`run_enhanced_pipeline.py`**: Updated wrapper script

## 🔧 How It Works

### 1. Video Generation

- AI generates video clips using Wan 2.2 T2V model
- Videos are saved locally in `wan22_enhanced_output/`

### 2. Shotstack Integration

- Videos are prepared for upload to Shotstack
- Shotstack API is used for professional video editing
- Cloud-based processing and rendering

### 3. Professional Editing

- Access Shotstack's professional editing tools
- Cloud-based timeline editing
- Advanced effects and transitions

## 🌐 Shotstack Features

### Professional Video Editing

- **Timeline Editing**: Professional timeline interface
- **Multiple Tracks**: Audio, video, and effects tracks
- **Transitions**: Professional video transitions
- **Effects**: Advanced video effects and filters
- **Text & Graphics**: Add titles, captions, and graphics

### Cloud Processing

- **No Local Resources**: All processing in the cloud
- **Scalable**: Handle large video files
- **Fast Rendering**: Optimized cloud rendering
- **Multiple Formats**: Export in various formats

### API Integration

- **REST API**: Easy integration with any application
- **SDK Support**: Python SDK available
- **Webhooks**: Real-time notifications
- **Documentation**: Comprehensive API documentation

## 🎯 Example Workflow

```bash
# 1. Generate screenplay (if needed)
python generate_screenplay.py

# 2. Run complete pipeline with Shotstack integration
python run_enhanced_pipeline.py your-runpod-endpoint --character-prompt "Your character description"

# 3. Shotstack integration launches automatically
# 4. Visit Shotstack to edit your videos professionally
# 5. Export your final film
```

## 🔍 Troubleshooting

### API Key Issues

```bash
# Check if API key is set
echo $SHOTSTACK_API_KEY

# Set API key if missing
export SHOTSTACK_API_KEY='your_api_key_here'
```

### Manual Integration

If automatic integration fails, you can:

1. Visit [https://shotstack.io/](https://shotstack.io/)
2. Sign up for an account
3. Upload your videos manually
4. Use Shotstack's professional editing tools

## 🌟 Benefits of Shotstack Integration

### Professional Features

- **Industry Standard**: Professional video editing tools
- **Cloud-Based**: No local installation required
- **Scalable**: Handle large projects
- **Collaborative**: Share projects with team members

### Integration Benefits

- **REST API**: Easy integration with any application
- **Python SDK**: Native Python support
- **Documentation**: Comprehensive documentation
- **Support**: Professional support available

### Technical Benefits

- **Fast Processing**: Cloud-based processing
- **Reliable**: Professional infrastructure
- **Secure**: Enterprise-grade security
- **Extensible**: Easy to add new features

## 📋 API Usage Examples

### Basic Integration

```python
from shotstack_sdk import ShotstackSDK, EditApi

# Initialize SDK
configuration = Configuration(api_key="your_api_key")
edit_api = EditApi(configuration)

# Create video edit
edit = {
    "timeline": timeline,
    "output": output
}

# Submit render
response = edit_api.post_render(edit)
```

### Video Upload

```python
# Upload video to Shotstack
video_url = upload_video("video.mp4")

# Create video asset
asset = VideoAsset(src=video_url)
```

### Timeline Creation

```python
# Create clips
clips = [Clip(asset=asset, start=0, length=5.0)]

# Create track
track = Track(clips=clips)

# Create timeline
timeline = Timeline(tracks=[track])
```

## 🎉 Success!

Your AI-generated films are now integrated with Shotstack, where you can:

- Edit videos professionally
- Use advanced effects and transitions
- Export in multiple formats
- Collaborate with team members
- Access professional editing tools

The integration provides a seamless workflow from AI video generation to professional video editing!

## 📚 Resources

- **Shotstack Website**: [https://shotstack.io/](https://shotstack.io/)
- **API Documentation**: [https://shotstack.io/docs/](https://shotstack.io/docs/)
- **Python SDK**: [https://github.com/shotstack/shotstack-sdk-python](https://github.com/shotstack/shotstack-sdk-python)
- **Examples**: [https://shotstack.io/docs/examples/](https://shotstack.io/docs/examples/)

## 🔧 Advanced Usage

### Custom Video Processing

You can extend the integration to add custom video processing:

```python
def custom_video_processing(video_path):
    # Add custom processing logic
    processed_video = process_video(video_path)
    return upload_to_shotstack(processed_video)
```

### Batch Processing

Process multiple videos at once:

```python
def batch_process_videos(video_files):
    for video_file in video_files:
        upload_to_shotstack(video_file)
        create_edit_project(video_file)
```

### Webhook Integration

Set up webhooks for real-time notifications:

```python
def setup_webhooks():
    webhook_url = "https://your-app.com/webhook"
    shotstack.setup_webhook(webhook_url)
```

The Shotstack integration provides professional video editing capabilities for your AI-generated films!


