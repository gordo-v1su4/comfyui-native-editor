# Shotstack Integration

This project integrates with **Shotstack** for professional video editing.

## 🎬 What is Shotstack?

Shotstack is a cloud-based video editing platform that provides:

- Professional video editing tools
- Cloud processing (no local resources needed)
- REST API for easy integration
- Multiple video formats support

## 🚀 Getting Started

### 1. Get API Key

1. Visit [https://shotstack.io/](https://shotstack.io/)
2. Sign up for an account
3. Get your API key
4. Set environment variable: `export SHOTSTACK_API_KEY='your_key'`

### 2. Run Integration

```bash
python shotstack_simple.py
```

### 3. Complete Pipeline

```bash
python run_enhanced_pipeline.py your-runpod-endpoint --character-prompt "your character"
```

## 📁 Files

- `shotstack_simple.py`: Shotstack integration script
- `wan22_enhanced_pipeline.py`: Updated to use Shotstack
- `run_enhanced_pipeline.py`: Updated wrapper

## 🎯 Workflow

1. AI generates videos
2. Videos are prepared for Shotstack
3. Access Shotstack's professional editing tools
4. Edit and export your final film

## 🌟 Benefits

- Professional video editing
- Cloud-based processing
- No local installation needed
- Industry-standard tools

## 🔧 Usage

```bash
# Test integration
python shotstack_simple.py

# Run full pipeline
python run_enhanced_pipeline.py endpoint --character-prompt "description"
```

Your AI-generated films can now be edited professionally using Shotstack!


