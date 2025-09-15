# 🎬 Enhanced Wan 2.2 T2V Pipeline with Flux Kontext & OpenCut

## 🌟 Overview

This enhanced pipeline combines **Flux Kontext** for consistent character generation, **Wan 2.2** for true video generation, and **OpenCut** for professional video editing. The result is a complete filmmaking workflow from screenplay to final edited video.

## ✨ Key Features

### 🎨 **Flux Kontext Character Generation**

- Generates consistent character reference images
- Ensures character consistency across all video shots
- Uses advanced character design prompts
- Creates reusable character assets

### 🎬 **Flexible Video Duration**

- Support for custom video durations (1-60+ seconds)
- Automatic video extension beyond 5-second limits
- Dynamic frame calculation based on target duration
- Seamless video concatenation

### ✂️ **OpenCut Integration**

- Automatic project file creation
- Timeline with all video clips
- Character reference images included
- Browser-based editing interface
- Professional video editing capabilities

## 🚀 Quick Start

### 1. **Generate Screenplay**

```bash
python generate_screenplay.py
```

### 2. **Run Enhanced Pipeline**

```bash
# Simple usage
python run_enhanced_pipeline.py hos2xy0zxfh6cu-8188.proxy.runpod.net

# With custom character
python run_enhanced_pipeline.py hos2xy0zxfh6cu-8188.proxy.runpod.net \
  --character-prompt "A young woman with flowing hair and mystical aura"

# With custom duration
python run_enhanced_pipeline.py hos2xy0zxfh6cu-8188.proxy.runpod.net \
  --max-duration 8.0
```

## 📁 Project Structure

```
film-mvp/
├── wan22_flux_opencut_pipeline.py    # Main enhanced pipeline
├── run_enhanced_pipeline.py          # Simple wrapper script
├── workflows/
│   ├── flux_kontext_character.json   # Flux Kontext character generation
│   ├── wan22_t2v_flexible.json       # Flexible Wan 2.2 video generation
│   └── wan22_i2v_extension.json      # Image-to-video extension
├── data/projects/
│   └── mythical_discovery/
│       └── shots_prompts_comfy.json  # Screenplay data
└── wan22_flux_opencut_output/        # Generated content
    ├── character_reference.png       # Character reference image
    ├── shot_01_wan22_t2v.mp4        # Individual video shots
    ├── ...
    ├── inner_mythical_final_film.mp4 # Final compiled film
    └── opencut_project/              # OpenCut project files
        ├── media/                    # Video assets
        └── inner_mythical.opencut    # Project file
```

## 🔧 Technical Details

### **Flux Kontext Integration**

- Uses `flux_kontext_v1.0.safetensors` checkpoint
- Generates 512x768 character reference images
- Implements character consistency prompts
- Supports custom character descriptions

### **Wan 2.2 Video Generation**

- Dynamic frame calculation: `frames = duration_seconds * 24fps`
- Flexible duration support with placeholders
- Character consistency through enhanced prompts
- Automatic video concatenation

### **OpenCut Project Creation**

- Creates structured project files
- Includes all video clips in timeline
- Adds character reference images
- Supports browser-based editing

## 🎯 Usage Examples

### **Mythical Discovery Film**

```bash
# Generate the mythical discovery screenplay
python generate_screenplay.py

# Run with mystical character
python run_enhanced_pipeline.py hos2xy0zxfh6cu-8188.proxy.runpod.net \
  --character-prompt "A young woman with ethereal beauty, flowing hair, and mystical aura, modern urban setting"
```

### **Custom Character Design**

```bash
python run_enhanced_pipeline.py hos2xy0zxfh6cu-8188.proxy.runpod.net \
  --character-prompt "A professional businesswoman in her 30s, confident posture, modern attire, clear facial features"
```

### **Long-Form Content**

```bash
python run_enhanced_pipeline.py hos2xy0zxfh6cu-8188.proxy.runpod.net \
  --max-duration 10.0 \
  --character-prompt "A wise elder with long white hair, traditional robes, serene expression"
```

## 📊 Output Files

### **Generated Videos**

- `shot_01_wan22_t2v.mp4` - Individual video shots
- `inner_mythical_final_film.mp4` - Final compiled film
- Character reference images for consistency

### **OpenCut Project**

- `.opencut` project file with timeline
- All video assets in organized structure
- Ready for professional editing

## 🌐 OpenCut Integration

### **Automatic Opening**

The pipeline automatically:

1. Creates OpenCut project file
2. Opens browser to OpenCut web interface
3. Provides project file location for import

### **Manual Import**

If automatic opening fails:

1. Navigate to [OpenCut.org](https://opencut.org)
2. Import the generated `.opencut` project file
3. Edit videos in the professional timeline

## 🔄 Workflow Process

1. **Character Generation** → Flux Kontext creates consistent character
2. **Video Generation** → Wan 2.2 generates videos with character consistency
3. **Video Compilation** → Individual shots combined into final film
4. **Project Creation** → OpenCut project with timeline and assets
5. **Editing Ready** → Professional video editing environment

## ⚙️ Configuration Options

### **Command Line Arguments**

- `--runpod <endpoint>` - RunPod server endpoint
- `--character-prompt <text>` - Character description
- `--max-duration <seconds>` - Maximum clip duration
- `--project <name>` - Project name

### **Character Prompts**

- Focus on facial features and appearance
- Include style and personality traits
- Specify age, gender, and characteristics
- Add clothing and setting context

## 🎨 Character Consistency

The pipeline ensures character consistency by:

1. **Flux Kontext Generation** - Creates reference character image
2. **Enhanced Prompts** - Adds character consistency to video prompts
3. **Visual Reference** - Uses character image as visual guide
4. **Prompt Engineering** - Maintains character traits across shots

## 📈 Performance

### **Generation Times**

- Character generation: ~2-3 minutes
- Video generation: ~5-6 minutes per shot
- Project creation: ~30 seconds
- Total pipeline: ~30-60 minutes for 6 shots

### **Quality Settings**

- Video resolution: 480x480 (optimized for speed)
- Frame rate: 24fps (cinematic quality)
- Character resolution: 512x768 (high detail)
- Output format: MP4 (web compatible)

## 🛠️ Troubleshooting

### **Model Availability**

```bash
# Check available models
python debug_models.py
```

### **Character Generation Issues**

- Ensure Flux Kontext models are available
- Check character prompt clarity
- Verify RunPod endpoint connectivity

### **Video Generation Issues**

- Confirm Wan 2.2 models are loaded
- Check prompt length and clarity
- Verify duration settings

### **OpenCut Integration**

- Ensure browser can open URLs
- Check project file permissions
- Verify video file compatibility

## 🎬 Example Output

### **Character Reference**

- High-quality character image
- Consistent facial features
- Professional appearance
- Reusable across projects

### **Video Shots**

- True video with motion
- Character consistency
- Professional quality
- Ready for editing

### **Final Film**

- Compiled video sequence
- Smooth transitions
- Professional quality
- OpenCut project ready

## 🔮 Future Enhancements

- **Audio Integration** - Add background music and sound effects
- **Advanced Editing** - Automated transitions and effects
- **Batch Processing** - Multiple character generation
- **Quality Upscaling** - Higher resolution output
- **Cloud Storage** - Automatic backup and sharing

## 📚 Resources

- [OpenCut Documentation](https://opencut.org/docs)
- [Flux Kontext Models](https://huggingface.co/flux-ai/flux-kontext)
- [Wan 2.2 Documentation](https://github.com/wan2-2/wan2-2)
- [ComfyUI Workflows](https://github.com/comfyanonymous/ComfyUI)

---

**🎉 Ready to create professional films with AI-powered character consistency and video editing!**

