# 🎬 Gausian Native Editor

A high-performance, cross-platform video editor built in Rust with GPU acceleration and professional interchange support.

## ✨ Features

### Core Capabilities

- **Native Performance**: 100% Rust implementation with GPU-accelerated preview and rendering
- **Professional Interchange**: FCPXML, FCP7 XML, and EDL import/export for seamless workflow integration
- **Plugin System**: Support for Rust/WASM and Python plugins with sandbox execution
- **Hardware Acceleration**: Automatic detection and utilization of hardware encoders (VideoToolbox, NVENC, QSV, VAAPI)
- **Advanced Timeline**: Multi-track editing with precise frame-level control, snapping, and trimming tools
- **Audio Integration**: Real-time audio playback synchronized with video timeline

### Technical Highlights

- **GPU Pipeline**: wgpu-based renderer with WGSL shaders for YUV→RGB conversion, scaling, blending, and transforms
- **Memory Safety**: Zero unsafe code in core logic, robust error handling
- **Modular Architecture**: Clean separation between timeline, rendering, media I/O, and export systems
- **Cross-Platform**: Works on macOS, Windows, and Linux with native performance

## 🚀 Getting Started

### Prerequisites

1. **Rust toolchain** (latest stable):

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **FFmpeg** (required for media processing):

   ```bash
   # macOS
   brew install ffmpeg

   # Ubuntu/Debian
   sudo apt install ffmpeg

   # Windows
   # Download from https://ffmpeg.org/download.html
   ```

### Building from Source

```bash
# Clone the repository
cd /Users/mingeonkim/LocalDocuments/GausianAI

# Build the project
cargo build --release

# Or build in development mode (faster compilation, slower runtime)
cargo build
```

## 🖥️ Running the Application

### Desktop GUI Application

```bash
# Run the desktop editor
cargo run --bin desktop

# Or run the release build for better performance
cargo run --release --bin desktop
```

**Desktop Features:**

- **Timeline Editor**: Drag-and-drop video/audio clips, trim, move, and arrange
- **Asset Browser**: Import media files with automatic metadata detection
- **Real-time Preview**: GPU-accelerated video preview with audio synchronization
- **Export Options**: Export to MP4/MOV video or FCPXML/EDL for other editors
- **Hardware Detection**: Automatic detection of available hardware encoders

### Command Line Interface

```bash
# Show all available commands
cargo run --bin gausian-cli -- --help

# Create a new project
cargo run --bin gausian-cli -- new "My Project" --width 1920 --height 1080 --fps 30

# Import media files into a project
cargo run --bin gausian-cli -- import --project my_project.gausian file1.mp4 file2.mp4 --proxies --thumbnails

# Export a sequence
cargo run --bin gausian-cli -- export --project my_project.gausian --sequence "Main" --output export.mp4 --preset h264-1080p

# Convert between formats
cargo run --bin gausian-cli -- convert input.fcpxml output.edl --output-format edl

# Analyze media files
cargo run --bin gausian-cli -- analyze video1.mp4 video2.mp4 --waveforms --output analysis.json

# List available hardware encoders
cargo run --bin gausian-cli -- encoders
```

## 🏗️ Architecture Overview

### Crate Structure

```
crates/
├── timeline/          # Timeline graph, tracks, clips, effects, keyframes
├── project/           # SQLite project format, migrations, autosave
├── media-io/          # FFmpeg bindings, metadata, decode/encode, proxies
├── renderer/          # wgpu kernels (YUV→RGB, scale, blend, transforms)
├── exporters/         # FCPXML, FCP7 XML, EDL export/import
├── plugin-host/       # Rust/WASM plugin ABI, Python bridge
└── cli/               # Command-line interface

apps/
└── desktop/           # Native desktop application (eframe/egui)
```

### Database Schema

The project uses SQLite with a comprehensive schema supporting:

- **Projects**: Multi-project management with settings
- **Sequences**: Timeline sequences with metadata
- **Assets**: Media files with metadata, proxies, and cache
- **Usages**: Track how assets are used in sequences
- **Proxies**: Low-resolution proxies for performance
- **Cache**: Thumbnails, waveforms, and analysis data

## 🎯 Usage Examples

### Basic Video Editing Workflow

1. **Start the desktop app**:

   ```bash
   cargo run --bin desktop
   ```

2. **Import media files**:

   - Click "Import..." button in the Assets panel
   - Select your video/audio files
   - Files will be automatically analyzed and added to the asset library

3. **Build your timeline**:

   - Drag assets from the Assets panel to the timeline
   - Use mouse to select, move, and trim clips
   - Clips automatically snap to frame boundaries and seconds

4. **Preview your edit**:

   - Press Space or click Play to preview
   - Audio and video are synchronized automatically
   - GPU-accelerated preview for smooth playback

5. **Export your project**:
   - Click "Export..." in the top toolbar
   - Choose format: MP4/MOV for video, FCPXML/EDL for other editors
   - Export will be processed using hardware encoders when available

### Professional Workflow Integration

**Export to Final Cut Pro**:

```bash
cargo run --bin gausian-cli -- convert my_timeline.json final_cut.fcpxml --output-format fcpxml
```

**Export to Avid/Premiere (EDL)**:

```bash
cargo run --bin gausian-cli -- convert my_timeline.json avid_edit.edl --output-format edl
```

**Batch Processing**:

```bash
# Analyze multiple files
cargo run --bin gausian-cli -- analyze *.mp4 --waveforms --output batch_analysis.json

# Import with proxy generation
cargo run --bin gausian-cli -- import --project batch_project.gausian *.mp4 --proxies --thumbnails
```

## 🔧 Development

### Adding New Features

The modular architecture makes it easy to extend:

1. **New Export Formats**: Add to `crates/exporters/src/`
2. **New Effects**: Add to `crates/renderer/src/` with WGSL shaders
3. **New Media Formats**: Extend `crates/media-io/src/`
4. **New Plugins**: Use the plugin SDK in `crates/plugin-host/`

### Plugin Development

**Rust/WASM Plugin**:

```rust
// plugin.rs
#[no_mangle]
pub extern "C" fn plugin_main() -> i32 {
    // Your effect logic here
    0 // Return 0 for success
}
```

**Python Plugin**:

```python
# plugin.py
def process(context):
    # Access timeline data
    sequence = context['sequence']
    parameters = context['parameters']

    # Your processing logic here

    return {
        "success": True,
        "output_items": [],
        "logs": ["Plugin executed successfully"]
    }
```

### Testing

```bash
# Run all tests
cargo test

# Test specific crate
cargo test --package timeline

# Run with verbose output
cargo test -- --nocapture
```

## 📋 Current Status

### ✅ Implemented

- ✅ Core timeline and project management
- ✅ GPU-accelerated preview and rendering
- ✅ Audio playback and synchronization
- ✅ Asset management with metadata
- ✅ FCPXML/FCP7/EDL export/import
- ✅ Plugin system with WASM and Python support
- ✅ Hardware encoder detection
- ✅ Command-line interface
- ✅ Cross-platform desktop application

### 🚧 In Progress / Future Features

- Advanced color grading and LUT support
- Cloud rendering service integration
- Advanced effects and transitions
- Multi-window workspace
- Collaborative editing features
- Marketplace for plugins and templates

## 🎮 Controls

### Desktop Application

- **Space**: Play/Pause
- **Mouse**: Click timeline to seek, drag clips to move/trim
- **Zoom**: Use zoom slider or "Fit" button to adjust timeline view
- **Import**: Drag files to import path field or use Import button
- **Export**: Use Export button for various output formats

### Timeline Editing

- **Click clip**: Select
- **Drag center**: Move clip
- **Drag edges**: Trim start/end
- **Snapping**: Automatic snapping to seconds and clip edges

## 🛠️ Requirements

### Minimum System Requirements

- **OS**: macOS 10.15+, Windows 10+, or Linux with OpenGL 3.3+
- **RAM**: 8 GB minimum, 16 GB recommended
- **GPU**: Any GPU with wgpu support (most modern GPUs)
- **Storage**: 2 GB free space for application and cache

### Recommended for Best Performance

- **RAM**: 32 GB or more for 4K editing
- **GPU**: Dedicated GPU with 4+ GB VRAM
- **Storage**: SSD for media files and cache
- **Hardware Encoders**: NVENC (NVIDIA), VideoToolbox (Apple), or QSV (Intel)

## 📄 License

- **Core**: MPL-2.0 (Mozilla Public License 2.0)
- **Pro Features**: Separate commercial license for advanced codecs and cloud features

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 🐛 Troubleshooting

### Common Issues

**"FFmpeg not found"**:

- Install FFmpeg and ensure it's in your PATH
- On macOS: `brew install ffmpeg`
- On Windows: Download from https://ffmpeg.org/

**"No hardware encoders detected"**:

- This is normal on some systems
- Software encoders will be used (slower but functional)
- Ensure GPU drivers are up to date

**Performance Issues**:

- Close other GPU-intensive applications
- Reduce preview resolution in timeline
- Enable proxy generation for large files

## 📞 Support

For questions, bug reports, or feature requests, please open an issue on the project repository.

---

**Built with ❤️ in Rust** | **GPU-Accelerated** | **Cross-Platform** | **Open Source**
