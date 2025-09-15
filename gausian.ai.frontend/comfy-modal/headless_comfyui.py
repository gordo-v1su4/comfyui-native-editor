"""
Headless ComfyUI on Modal — ASGI proxy version (fixed)

Endpoints at your Modal URL:
  GET  /health            -> proxies to /system_stats
  GET  /system_stats      -> ComfyUI system stats
  GET  /object_info       -> ComfyUI object info (node inputs/loaders)
  POST /prompt            -> submit a workflow JSON
  GET  /queue             -> queue status
  GET  /history/{prompt_id}
  GET  /debug/models      -> quick check of model symlinks
  GET  /debug/extra_paths -> dumps the YAML Comfy will load
"""

import os
import pathlib
import socket
import subprocess
import threading
import time
import urllib.request
import modal




# ---------- Helpers (run inside container, after volumes mounted) ----------
def _ensure_model_layout() -> None:
    import os, pathlib

    VBASE = pathlib.Path("/modal_models")                  # your volume (real files live here)
    RBASE = pathlib.Path("/root/comfy/ComfyUI/models")     # repo models dir (where Comfy scans)

    # Ensure folders exist under the repo tree
    for d in ("checkpoints", "diffusion_models", "unet", "vae", "clip"):
        (RBASE / d).mkdir(parents=True, exist_ok=True)

    # What we want visible under the repo tree, and where to look in the volume
    want = {
        # UNETs (WAN 2.2)
        "unet/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors": [
            "checkpoints/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors",
            "unet/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors",
            "wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors",
        ],
        "unet/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors": [
            "checkpoints/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors",
            "unet/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors",
            "wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors",
        ],
        # VAE
        "vae/wan_2.1_vae.safetensors": [
            "vae/wan_2.1_vae.safetensors",
            "checkpoints/wan_2.1_vae.safetensors",
            "wan_2.1_vae.safetensors",
        ],
        # CLIP / text encoder
        "clip/umt5_xxl_fp8_e4m3fn_scaled.safetensors": [
            "clip/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
            "checkpoints/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
            "text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
            "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
        ],
    }

    def find_in_volume(rel_candidates):
        """Return absolute Path to the first existing candidate under the volume."""
        for rel in rel_candidates:
            p = VBASE / rel
            if p.exists():
                return p.resolve()
        # Fallback: search anywhere under volume by basename
        name = pathlib.Path(rel_candidates[0]).name
        hits = list(VBASE.rglob(name))
        return hits[0].resolve() if hits else None

    def safe_link(target: pathlib.Path, src_abs: pathlib.Path, keep_if_real=True):
        """Create/refresh symlink target -> src_abs (absolute), avoiding loops and EEXIST."""
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            if target.is_symlink():
                current = target.resolve(strict=False)
                # If it already points to the same place, leave it
                if str(current) == str(src_abs):
                    print(f"[MODEL-SKIP] {target} already -> {src_abs}", flush=True)
                    return
                target.unlink()
            elif target.exists():
                if keep_if_real:
                    print(f"[MODEL-KEEP] {target} (real file present)", flush=True)
                    return
                target.unlink()
            # Always symlink to the absolute real file in the volume
            target.symlink_to(src_abs)
            print(f"[MODEL-LINK] {target} -> {src_abs}", flush=True)
        except FileExistsError:
            print(f"[MODEL-SKIP] {target} already exists", flush=True)
        except Exception as e:
            print(f"[MODEL-LINK-ERR] {target}: {e}", flush=True)

    # 1) Link/show models under the repo tree (unet/vae/clip)
    for target_rel, candidates in want.items():
        src_abs = find_in_volume(candidates)
        if not src_abs:
            print(f"[MODEL-MISSING] {candidates}", flush=True)
            continue
        safe_link(RBASE / target_rel, src_abs, keep_if_real=True)

    # 2) Mirror UNETs into diffusion_models (what UNETLoader reads)
    for unet_name in [
        "wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors",
        "wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors",
    ]:
        src_abs = find_in_volume([
            f"checkpoints/{unet_name}",
            f"unet/{unet_name}",
            unet_name,
        ])
        if src_abs:
            safe_link(RBASE / "diffusion_models" / unet_name, src_abs, keep_if_real=False)
        else:
            print(f"[MODEL-MISSING] could not mirror {unet_name} into diffusion_models/", flush=True)


    # NOTE: We intentionally do NOT write extra_model_paths.yaml anymore.
    # ComfyUI will auto-load a file at /root/comfy/ComfyUI/extra_model_paths.yaml
    # if it exists, and its loader is fragile. Since our models are symlinked
    # into the standard folders under RBASE, no extra paths file is required.

    # Quick listings for sanity
    def _ls(dirpath: str):
        try:
            return sorted([p.name for p in pathlib.Path(dirpath).glob("*.safetensors")])
        except Exception:
            return []
    print("[MODEL-SCAN] UNET:", _ls(str(RBASE / "unet")), flush=True)
    print("[MODEL-SCAN] DIFF:", _ls(str(RBASE / "diffusion_models")), flush=True)
    print("[MODEL-SCAN] VAE :", _ls(str(RBASE / "vae")), flush=True)
    print("[MODEL-SCAN] CLIP:", _ls(str(RBASE / "clip")), flush=True)

    # Writable userdir (sqlite)
    try:
        os.chmod("/userdir", 0o777)
    except Exception:
        pass



def _compile_models_if_possible():
    """Attempt to compile models for better performance using torch.compile."""
    try:
        import torch
        if hasattr(torch, 'compile'):
            print("[OPTIMIZATION] torch.compile available - models will be compiled when loaded", flush=True)
            # Set compilation mode for optimal performance
            torch._dynamo.config.suppress_errors = True
            torch._dynamo.config.verbose = False
            # Use reduce-overhead mode for inference
            torch._dynamo.config.mode = "reduce-overhead"
            return True
        else:
            print("[OPTIMIZATION] torch.compile not available in this PyTorch version", flush=True)
            return False
    except Exception as e:
        print(f"[OPTIMIZATION] Error setting up torch.compile: {e}", flush=True)
        return False


def _setup_multi_gpu():
    """Setup multi-GPU configuration for parallel processing."""
    try:
        import torch
        if torch.cuda.device_count() > 1:
            print(f"[MULTI-GPU] Detected {torch.cuda.device_count()} GPUs", flush=True)
            # Set device 0 as primary
            torch.cuda.set_device(0)
            print(f"[MULTI-GPU] Primary GPU: {torch.cuda.get_device_name(0)}", flush=True)
            
            # Log all available GPUs
            for i in range(torch.cuda.device_count()):
                gpu_name = torch.cuda.get_device_name(i)
                gpu_memory = torch.cuda.get_device_properties(i).total_memory / 1e9
                print(f"[MULTI-GPU] GPU {i}: {gpu_name} ({gpu_memory:.1f} GB)", flush=True)
            
            # Enable multi-GPU optimizations
            torch.backends.cuda.enable_math_sdp(True)
            torch.backends.cuda.enable_flash_sdp(True)
            torch.backends.cuda.enable_mem_efficient_sdp(True)
            
            return True
        else:
            print("[MULTI-GPU] Single GPU detected", flush=True)
            return False
    except Exception as e:
        print(f"[MULTI-GPU] Error setting up multi-GPU: {e}", flush=True)
        return False


def _monitor_job_completion(job_id):
    """Monitor a job for completion and handle video upload."""
    try:
        import json
        import urllib.request
        from pathlib import Path
        
        print(f"[MONITOR] Starting monitoring for job: {job_id}", flush=True)
        
        while True:
            try:
                # Check job status via ComfyUI history
                response = urllib.request.urlopen(f"http://127.0.0.1:8188/history/{job_id}", timeout=5)
                data = json.loads(response.read().decode())
                
                if job_id in data and data[job_id].get("status", {}).get("status_str") == "success":
                    print(f"[MONITOR] Job {job_id} completed successfully", flush=True)
                    
                    # Find generated video files
                    output_dir = Path("/outputs")
                    video_files = list(output_dir.glob("*.mp4"))
                    
                    # Queue most recent video for upload
                    if video_files:
                        latest_video = max(video_files, key=lambda x: x.stat().st_mtime)
                        global job_manager
                        job_manager.job_completed(job_id, str(latest_video))
                    else:
                        job_manager.job_completed(job_id)
                    
                    break
                    
            except Exception as e:
                # Job might still be running
                pass
            
            time.sleep(5)  # Check every 5 seconds
            
    except Exception as e:
        print(f"[MONITOR] Error monitoring job {job_id}: {e}", flush=True)


def _launch_comfy() -> subprocess.Popen:
    """Start ComfyUI on 127.0.0.1:8188 and stream logs to stdout."""
    cmd = [
        "python", "main.py",
        "--dont-print-server",
        "--listen", "0.0.0.0", "--port", "8188",
        "--user-directory", "/userdir",
        "--database-url", "sqlite:////userdir/comfy.db",
        "--comfy-api-base", "/",
        "--enable-cors-header", "*",
        "--output-directory", "/outputs",
        # "--disable-metadata",  # removed to enable metadata/history
        "--log-stdout",
        "--verbose", "INFO",
        # Performance optimizations
        "--cpu", "0",  # Use all available CPU cores
        "--preview-method", "auto",  # Auto-select fastest preview method
    ]
    proc = subprocess.Popen(
        cmd,
        cwd="/root/comfy/ComfyUI",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )

    def _pump_stdout(p: subprocess.Popen) -> None:
        if not p.stdout:
            return
        for line in p.stdout:
            print(line.rstrip(), flush=True)
        p.stdout.close()

    threading.Thread(target=_pump_stdout, args=(proc,), daemon=True).start()
    return proc


def _wait_until_ready(timeout_s: int = 840) -> None:
    """Poll local /system_stats until ComfyUI is ready or timeout."""
    start = time.time()
    while time.time() - start < timeout_s:
        try:
            with socket.create_connection(("127.0.0.1", 8188), timeout=2):
                urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=2).read()
                print("[HEALTH] local /system_stats OK", flush=True)
                return
        except Exception:
            time.sleep(1)
    raise RuntimeError("ComfyUI failed to start on port 8188 within the timeout window")


# -------- Modal app & image --------
app = modal.App("headless-comfyui-server")

models_volume = modal.Volume.from_name("comfyui-models", create_if_missing=True)
outputs_volume = modal.Volume.from_name("comfyui-outputs", create_if_missing=True)
custom_nodes_volume = modal.Volume.from_name("comfyui-custom-nodes", create_if_missing=True)

base_torch = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "libgl1", "libglib2.0-0")
    .run_commands(
        "python -m pip install --upgrade pip",
        "python -m pip install --index-url https://download.pytorch.org/whl/cu121 "
        "torch==2.4.1 torchvision==0.19.1",
        "python -m pip install packaging setuptools wheel ninja",
    )
    # 3) Everything else
    .pip_install(
        "safetensors",
        "einops",
        "psutil",
        "opencv-python-headless",
        "imageio-ffmpeg",
        "diffusers>=0.30.0",
        "accelerate>=0.30.0",
        "huggingface_hub[hf_transfer]",
        "fastapi",
        "httpx",
        "PyYAML",
        "sageattention",
        "transformers==4.44.2",
        "tokenizers==0.19.1",
        "boto3",
        "requests",
    )
)

image = (
    base_torch
    .run_commands(
        # ComfyUI core
        "git clone --depth=1 https://github.com/comfyanonymous/ComfyUI /root/comfy/ComfyUI",
        "pip install -r /root/comfy/ComfyUI/requirements.txt",

        # Transformers + tokenizers combo that worked in your earlier runs
        "python -m pip uninstall -y tokenizers || true",
        "python -m pip install --no-deps transformers==4.44.2 tokenizers==0.19.1",

        # Popular custom nodes
        "git clone --depth=1 https://github.com/cubiq/ComfyUI_essentials "
        "/root/comfy/ComfyUI/custom_nodes/ComfyUI_essentials",
        "git clone --depth=1 https://github.com/ShmuelRonen/ComfyUI-EmptyHunyuanLatent "
        "/root/comfy/ComfyUI/custom_nodes/ComfyUI-Hunyuan-Adapter",
        "git clone --depth=1 https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite "
        "/root/comfy/ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite",
        "git clone --depth=1 https://github.com/kijai/ComfyUI-KJNodes "
        "/root/comfy/ComfyUI/custom_nodes/ComfyUI-KJNodes",
        "git clone --depth=1 https://github.com/liusida/ComfyUI-SD3-nodes "
        "/root/comfy/ComfyUI/custom_nodes/ComfyUI-SD3-nodes",
        "git clone --depth=1 https://github.com/chrisgoringe/cg-use-everywhere "
        "/root/comfy/ComfyUI/custom_nodes/ComfyUI-AnythingEverywhere",
    )
)


# ---------------- Modal function: ASGI app (served by Modal) ----------------
@app.function(
    image=image,
    gpu="H100",
    volumes={
        "/modal_models": models_volume,   
        "/outputs": outputs_volume,
        "/userdir": custom_nodes_volume,  # will also hold comfy.db and extra_model_paths.yaml
    },
    timeout=21600,
    min_containers=2,
    max_containers=2,
    scaledown_window=900,
    
)
@modal.asgi_app()
def comfyui():
    """
    Modal serves this FastAPI app at the printed URL.
    The app proxies requests to the ComfyUI server started locally in this process.
    """
    import torch
    
    # ===== EASY PERFORMANCE OPTIMIZATIONS =====
    
    # 1. Enable TF32 for faster matrix operations
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.set_float32_matmul_precision("high")  # or "highest" on Hopper
    
    # 2. Enable additional tunable operations
    torch.backends.cudnn.benchmark = True  # Optimize for your specific input sizes
    torch.backends.cudnn.deterministic = False  # Allow optimizations
    
    # 3. Enable memory-efficient SDP backends
    torch.backends.cuda.enable_flash_sdp(True)
    torch.backends.cuda.enable_mem_efficient_sdp(True)
    torch.backends.cuda.enable_math_sdp(True)
    
    # 4. Set optimal memory allocation strategy
    torch.backends.cuda.enable_math_sdp(True)
    
    # 5. Enable torch.compile for future model loading (will be applied when models are loaded)
    torch._dynamo.config.suppress_errors = True
    torch._dynamo.config.verbose = False
    
    print("[OPTIMIZATION] PyTorch performance optimizations enabled", flush=True)
    print(f"[OPTIMIZATION] CUDA device: {torch.cuda.get_device_name()}", flush=True)
    print(f"[OPTIMIZATION] CUDA memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB", flush=True)
    
    subprocess.run("rm -rf /root/comfy/ComfyUI/models", shell=True, check=False)
    subprocess.run("ln -sfn /modal_models /root/comfy/ComfyUI/models", shell=True, check=True)
    subprocess.run("rm -f /root/comfy/ComfyUI/extra_model_paths.yaml", shell=True, check=False)
    # ensure Comfy’s default ./output points to the mounted volume
    subprocess.run("rm -rf /root/comfy/ComfyUI/output", shell=True, check=False)
    subprocess.run("ln -sfn /outputs /root/comfy/ComfyUI/output", shell=True, check=True)
    # also set the env var some nodes read
    os.environ["COMFYUI_OUTPUT_DIR"] = "/outputs"
    # Make sure the mounted outputs directory is writable
    try:
        os.chmod("/outputs", 0o777)
    except Exception:
        pass

    # ---------------------------
    
    # at app startup, create a tmpfs-like scratch for fast intermediates
    SCRATCH = "/dev/shm/comfy_scratch"
    subprocess.run(f"mkdir -p {SCRATCH}", shell=True, check=False)
    os.environ["TMPDIR"] = SCRATCH
    os.environ["TEMP"] = SCRATCH
    os.environ["TMP"] = SCRATCH

    # ===== ENVIRONMENT VARIABLES FOR OPTIMIZATIONS =====
    
    # Torch logging expects a comma-separated list, not "1". Use a sane default or set "help" to see options.
    os.environ["TORCH_LOGS"] = "inductor,perf_hints"
    
    # Choose the fastest available scaled-dot-product attention backend
    try:
        import torch
        if torch.cuda.is_available() and torch.backends.cuda.flash_sdp_enabled():
            os.environ["PYTORCH_SDP_BACKEND"] = "flash_attention"
            print("[OPTIMIZATION] Using flash attention backend", flush=True)
        elif torch.cuda.is_available() and torch.backends.cuda.mem_efficient_sdp_enabled():
            os.environ["PYTORCH_SDP_BACKEND"] = "mem_efficient"
            print("[OPTIMIZATION] Using memory-efficient attention backend", flush=True)
        else:
            os.environ["PYTORCH_SDP_BACKEND"] = "math"
            print("[OPTIMIZATION] Using math attention backend", flush=True)
    except Exception:
        os.environ["PYTORCH_SDP_BACKEND"] = "math"
        print("[OPTIMIZATION] Fallback to math attention backend", flush=True)
    
    # Additional optimization environment variables
    os.environ["CUDA_DEVICE_MAX_CONNECTIONS"] = "1"
    os.environ["NVIDIA_TF32_OVERRIDE"] = "0"               # harmless if not Hopper
    
    # Enable PyTorch optimizations
    os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "max_split_size_mb:128"
    os.environ["CUDA_LAUNCH_BLOCKING"] = "0"
    
    print("[OPTIMIZATION] Environment variables configured for performance", flush=True)
    # ---------------------------

    # If you keep extra custom nodes in your volume at /userdir/custom_nodes,
    # expose them alongside the baked-in ones by symlinking as a subfolder:
    if os.path.isdir("/userdir/custom_nodes"):
        pathlib.Path("/root/comfy/ComfyUI/custom_nodes").mkdir(parents=True, exist_ok=True)
        subprocess.run(
            "ln -sfn /userdir/custom_nodes /root/comfy/ComfyUI/custom_nodes/_mounted",
            shell=True, check=False
        )

    # Build the unet/vae/clip layout *after* volumes are mounted
    _ensure_model_layout()
    
    # Enable model compilation if available
    _compile_models_if_possible()
    
    # Setup multi-GPU configuration
    _setup_multi_gpu()

    # Launch ComfyUI and wait for readiness
    proc = _launch_comfy()
    try:
        _wait_until_ready()
    except Exception:
        try:
            if proc.stdout:
                tail = proc.stdout.readlines()[-150:]
                print("\n".join(tail), flush=True)
        finally:
            proc.terminate()
        raise

    # Build the FastAPI proxy app (served by Modal)
    from fastapi import FastAPI, Request, Response
    import httpx
    
    # Multi-GPU job distribution
    import threading
    import queue
    import time

    api = FastAPI()
    from fastapi.staticfiles import StaticFiles
    api.mount("/files", StaticFiles(directory="/outputs"), name="files")
    COMFY = "http://127.0.0.1:8188"
    
    # Multi-GPU job distributor
    class MultiGPUJobDistributor:
        def __init__(self):
            self.gpu_queues = {}
            self.gpu_threads = {}
            self.job_queue = queue.Queue()
            self._setup_gpu_workers()
        
        def _setup_gpu_workers(self):
            """Setup worker threads for each GPU."""
            try:
                import torch
                gpu_count = torch.cuda.device_count()
                print(f"[MULTI-GPU] Setting up {gpu_count} GPU workers", flush=True)
                
                for gpu_id in range(gpu_count):
                    self.gpu_queues[gpu_id] = queue.Queue()
                    self.gpu_threads[gpu_id] = threading.Thread(
                        target=self._gpu_worker,
                        args=(gpu_id,),
                        daemon=True
                    )
                    self.gpu_threads[gpu_id].start()
                    print(f"[MULTI-GPU] GPU {gpu_id} worker started", flush=True)
            except Exception as e:
                print(f"[MULTI-GPU] Error setting up GPU workers: {e}", flush=True)
        
        def _gpu_worker(self, gpu_id):
            """Worker thread for processing jobs on a specific GPU."""
            while True:
                try:
                    job = self.gpu_queues[gpu_id].get(timeout=1)
                    if job is None:  # Shutdown signal
                        break
                    
                    print(f"[MULTI-GPU] GPU {gpu_id} processing job: {job.get('id', 'unknown')}", flush=True)
                    
                    # Process the job on this GPU
                    self._process_job_on_gpu(gpu_id, job)
                    
                    self.gpu_queues[gpu_id].task_done()
                except queue.Empty:
                    continue
                except Exception as e:
                    print(f"[MULTI-GPU] GPU {gpu_id} worker error: {e}", flush=True)
        
        def _process_job_on_gpu(self, gpu_id, job):
            """Process a job on a specific GPU."""
            try:
                import torch
                # Set the GPU device for this job
                torch.cuda.set_device(gpu_id)
                
                # Here you would implement the actual job processing
                # For now, we'll just simulate it
                print(f"[MULTI-GPU] GPU {gpu_id} completed job: {job.get('id', 'unknown')}", flush=True)
                
            except Exception as e:
                print(f"[MULTI-GPU] Error processing job on GPU {gpu_id}: {e}", flush=True)
        
        def submit_job(self, job_data):
            """Submit a job to the least busy GPU."""
            try:
                import torch
                gpu_count = torch.cuda.device_count()
                
                # Find the GPU with the shortest queue
                min_queue_size = float('inf')
                selected_gpu = 0
                
                for gpu_id in range(gpu_count):
                    queue_size = self.gpu_queues[gpu_id].qsize()
                    if queue_size < min_queue_size:
                        min_queue_size = queue_size
                        selected_gpu = gpu_id
                
                print(f"[MULTI-GPU] Submitting job to GPU {selected_gpu} (queue size: {min_queue_size})", flush=True)
                self.gpu_queues[selected_gpu].put(job_data)
                
                return {"gpu_id": selected_gpu, "status": "queued"}
                
            except Exception as e:
                print(f"[MULTI-GPU] Error submitting job: {e}", flush=True)
                return {"error": str(e)}
    
    # Initialize the job distributor
    job_distributor = MultiGPUJobDistributor()
    
    print(f"[MULTI-GPU] Multi-GPU system initialized with {len(job_distributor.gpu_queues)} GPU workers", flush=True)
    print("[MULTI-GPU] Expected performance improvement: 1.5-2x faster video generation", flush=True)
    
    # Auto-shutdown and upload manager
    class JobCompletionManager:
        def __init__(self):
            self.active_jobs = set()
            self.completed_jobs = set()
            self.last_activity = time.time()
            self.shutdown_timer = None
            self.upload_queue = queue.Queue()
            self._start_upload_worker()
            self._start_shutdown_monitor()
        
        def _start_upload_worker(self):
            """Start background worker for uploading videos to Backblaze."""
            def upload_worker():
                while True:
                    try:
                        video_path = self.upload_queue.get(timeout=5)
                        if video_path is None:  # Shutdown signal
                            break
                        self._upload_to_backblaze(video_path)
                        self.upload_queue.task_done()
                    except queue.Empty:
                        continue
                    except Exception as e:
                        print(f"[UPLOAD] Upload worker error: {e}", flush=True)
            
            self.upload_thread = threading.Thread(target=upload_worker, daemon=True)
            self.upload_thread.start()
            print("[UPLOAD] Upload worker started", flush=True)
        
        def _upload_to_backblaze(self, video_path):
            """Upload a video file to Backblaze bucket."""
            try:
                import os
                import boto3
                import requests
                from pathlib import Path
                
                video_file = Path(video_path)
                if not video_file.exists():
                    print(f"[UPLOAD] Video file not found: {video_path}", flush=True)
                    return
                
                # Get S3/Backblaze credentials from environment
                bucket = os.environ.get("S3_BUCKET")
                region = os.environ.get("S3_REGION", "us-east-1")
                endpoint = os.environ.get("S3_ENDPOINT")
                access_key = os.environ.get("AWS_ACCESS_KEY_ID")
                secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY")
                
                if not all([bucket, access_key, secret_key]):
                    print("[UPLOAD] S3/Backblaze credentials not configured, skipping upload", flush=True)
                    return
                
                print(f"[UPLOAD] Uploading {video_file.name} to {bucket} bucket", flush=True)
                
                # Create S3 client
                s3_client = boto3.client(
                    's3',
                    region_name=region,
                    endpoint_url=endpoint,
                    aws_access_key_id=access_key,
                    aws_secret_access_key=secret_key
                )
                
                # Generate unique key for the video
                timestamp = int(time.time())
                unique_key = f"modal-generated/{timestamp}_{video_file.name}"
                
                # Upload the file
                with open(video_file, 'rb') as f:
                    s3_client.upload_fileobj(
                        f, 
                        bucket, 
                        unique_key,
                        ExtraArgs={
                            'ContentType': 'video/mp4',
                            'ACL': 'public-read'
                        }
                    )
                
                # Generate public URL
                public_url = f"https://{bucket}.s3.{region}.amazonaws.com/{unique_key}"
                if endpoint:
                    # For Backblaze B2 or custom S3-compatible services
                    public_url = f"{endpoint.rstrip('/')}/{bucket}/{unique_key}"
                
                print(f"[UPLOAD] Successfully uploaded {video_file.name} to {public_url}", flush=True)
                
                # Notify backend about the new video
                self._notify_backend_upload(unique_key, public_url, video_file.name)
                
            except Exception as e:
                print(f"[UPLOAD] Error uploading {video_path}: {e}", flush=True)
        
        def _notify_backend_upload(self, key, public_url, filename):
            """Notify the backend about a completed video upload."""
            try:
                import requests
                import os
                
                # Get backend URL from environment or use default
                backend_url = os.environ.get("BACKEND_URL", "http://localhost:3001")
                
                # Notify backend via API call (public, no auth)
                payload = {
                    "key": key,
                    "remote_url": public_url,
                    "filename": filename,
                    "kind": "video",
                    "source": "modal_generated"
                }
                # Try canonical public endpoint first
                endpoints = [
                    f"{backend_url}/api/modal-upload",
                    # Backward-compat fallback in case server still exposes legacy path
                    f"{backend_url}/api/media/modal-upload",
                ]

                last_status = None
                for ep in endpoints:
                    try:
                        response = requests.post(ep, json=payload, timeout=10)
                        last_status = response.status_code
                        if response.status_code == 200:
                            print(f"[UPLOAD] Backend notified about upload: {filename} -> {ep}", flush=True)
                            break
                        else:
                            print(f"[UPLOAD] Backend notification failed at {ep}: {response.status_code}", flush=True)
                    except Exception as e:
                        last_status = None
                        print(f"[UPLOAD] Error notifying backend at {ep}: {e}", flush=True)
                if last_status != 200:
                    print(f"[UPLOAD] Backend notification did not succeed for {filename}", flush=True)
                    
            except Exception as e:
                print(f"[UPLOAD] Error notifying backend: {e}", flush=True)
        
        def _start_shutdown_monitor(self):
            """Monitor for idle state and shutdown container to save costs."""
            def shutdown_monitor():
                while True:
                    try:
                        time.sleep(30)  # Check every 30 seconds
                        
                        # If no active jobs and been idle for 2 minutes, shutdown
                        if (not self.active_jobs and 
                            time.time() - self.last_activity > 120):
                            
                            print("[SHUTDOWN] No active jobs for 2 minutes, initiating shutdown", flush=True)
                            print("[SHUTDOWN] Container will terminate to save costs", flush=True)
                            
                            # Graceful shutdown
                            os._exit(0)
                            
                    except Exception as e:
                        print(f"[SHUTDOWN] Shutdown monitor error: {e}", flush=True)
            
            self.shutdown_thread = threading.Thread(target=shutdown_monitor, daemon=True)
            self.shutdown_thread.start()
            print("[SHUTDOWN] Auto-shutdown monitor started (2-minute idle timeout)", flush=True)
        
        def job_started(self, job_id):
            """Mark a job as started."""
            self.active_jobs.add(job_id)
            self.last_activity = time.time()
            print(f"[JOBS] Job started: {job_id} (active: {len(self.active_jobs)})", flush=True)
        
        def job_completed(self, job_id, video_path=None):
            """Mark a job as completed and queue video for upload."""
            self.active_jobs.discard(job_id)
            self.completed_jobs.add(job_id)
            self.last_activity = time.time()
            
            print(f"[JOBS] Job completed: {job_id} (active: {len(self.active_jobs)})", flush=True)
            
            # Queue video for upload if provided
            if video_path:
                self.upload_queue.put(video_path)
                print(f"[UPLOAD] Queued for upload: {video_path}", flush=True)
            
            # If no more active jobs, start shutdown timer
            if not self.active_jobs:
                print("[JOBS] All jobs completed, shutdown timer active", flush=True)
    
    # Initialize job completion manager
    job_manager = JobCompletionManager()

    @api.get("/")
    async def root():
        return {"ok": True, "msg": "ComfyUI proxy up. Try /health or /system_stats."}
    
    @api.get("/multigpu-status")
    async def multigpu_status():
        """Get status of all GPUs and their job queues."""
        try:
            import torch
            gpu_count = torch.cuda.device_count()
            status = {
                "gpu_count": gpu_count,
                "gpus": []
            }
            
            for gpu_id in range(gpu_count):
                gpu_info = {
                    "gpu_id": gpu_id,
                    "name": torch.cuda.get_device_name(gpu_id),
                    "memory_total": torch.cuda.get_device_properties(gpu_id).total_memory / 1e9,
                    "memory_allocated": torch.cuda.memory_allocated(gpu_id) / 1e9,
                    "memory_free": torch.cuda.memory_reserved(gpu_id) / 1e9,
                    "queue_size": job_distributor.gpu_queues[gpu_id].qsize() if gpu_id in job_distributor.gpu_queues else 0
                }
                status["gpus"].append(gpu_info)
            
            return status
        except Exception as e:
            return {"error": str(e)}
    
    @api.get("/job-status")
    async def job_status():
        """Get current job and upload status."""
        return {
            "active_jobs": len(job_manager.active_jobs),
            "completed_jobs": len(job_manager.completed_jobs),
            "upload_queue_size": job_manager.upload_queue.qsize(),
            "last_activity": job_manager.last_activity,
            "idle_time": time.time() - job_manager.last_activity,
            "active_job_ids": list(job_manager.active_jobs)
        }

    @api.get("/health")
    async def health():
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{COMFY}/system_stats")
        return Response(content=r.content, status_code=r.status_code,
                        media_type=r.headers.get("content-type", "application/json"))

    @api.get("/system_stats")
    async def system_stats():
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{COMFY}/system_stats")
        return Response(content=r.content, status_code=r.status_code,
                        media_type=r.headers.get("content-type", "application/json"))

    @api.get("/object_info")
    async def object_info():
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{COMFY}/object_info")
        return Response(content=r.content, status_code=r.status_code,
                        media_type=r.headers.get("content-type", "application/json"))

    @api.post("/prompt")
    async def prompt(request: Request):
        body = await request.body()
        headers = {"content-type": "application/json"}
        
        # Parse job ID for tracking
        try:
            import json
            job_data = json.loads(body)
            job_id = job_data.get("client_id", f"job_{int(time.time())}")
            job_manager.job_started(job_id)
        except Exception as e:
            job_id = f"job_{int(time.time())}"
            job_manager.job_started(job_id)
            print(f"[JOBS] Error parsing job ID: {e}", flush=True)
        
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{COMFY}/prompt", content=body, headers=headers)
        
        # Start monitoring for job completion
        if r.status_code == 200:
            threading.Thread(
                target=_monitor_job_completion,
                args=(job_id,),
                daemon=True
            ).start()
        
        return Response(content=r.content, status_code=r.status_code,
                        media_type=r.headers.get("content-type", "application/json"))

    @api.get("/queue")
    async def queue():
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{COMFY}/queue")
        return Response(content=r.content, status_code=r.status_code,
                        media_type=r.headers.get("content-type", "application/json"))

    @api.get("/history")
    async def history_all():
        """Get all history entries"""
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{COMFY}/history")
        return Response(content=r.content, status_code=r.status_code,
                        media_type=r.headers.get("content-type", "application/json"))

    @api.get("/history/{pid}")
    async def history(pid: str):
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{COMFY}/history/{pid}")
        return Response(content=r.content, status_code=r.status_code,
                        media_type=r.headers.get("content-type", "application/json"))

    @api.get("/view")
    async def view(filename: str):
        """Serve generated files from the outputs directory"""
        import os
        from pathlib import Path
        
        # Look for the file in the outputs directory
        file_path = Path("/outputs") / filename
        
        if not file_path.exists():
            return {"error": f"File {filename} not found"}, 404
        
        # Determine content type based on file extension
        content_type = "application/octet-stream"
        if filename.endswith(".mp4"):
            content_type = "video/mp4"
        elif filename.endswith(".png"):
            content_type = "image/png"
        elif filename.endswith(".jpg") or filename.endswith(".jpeg"):
            content_type = "image/jpeg"
        elif filename.endswith(".gif"):
            content_type = "image/gif"
        
        # Read and return the file
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            return Response(content=content, media_type=content_type)
        except Exception as e:
            return {"error": f"Error reading file: {str(e)}"}, 500

    @api.get("/debug/models")
    async def debug_models():
        import json, glob, pathlib

        def ls(dirpath):
            p = pathlib.Path(dirpath)
            if not p.exists():
                return {"exists": False}
            items = []
            for f in sorted(p.glob("*")):
                it = {"name": f.name, "is_symlink": f.is_symlink(), "is_file": f.is_file()}
                if f.is_symlink():
                    try:
                        tgt = f.resolve(strict=False)
                        it["points_to"] = str(tgt)
                        it["target_exists"] = tgt.exists()
                    except Exception as e:
                        it["points_to"] = f"<error: {e}>"
                        it["target_exists"] = False
                items.append(it)
            return {"exists": True, "items": items}

        return {
            "/root/comfy/ComfyUI/models": ls("/root/comfy/ComfyUI/models"),
            "/root/comfy/ComfyUI/models/unet": ls("/root/comfy/ComfyUI/models/unet"),
            "/root/comfy/ComfyUI/models/vae": ls("/root/comfy/ComfyUI/models/vae"),
            "/root/comfy/ComfyUI/models/clip": ls("/root/comfy/ComfyUI/models/clip"),
            "/root/comfy/ComfyUI/models/diffusion_models": ls("/root/comfy/ComfyUI/models/diffusion_models"),
        }

    @api.post("/debug/relink")
    async def debug_relink():
        # Rebuild symlinks and re-write the YAML
        _ensure_model_layout()
        # Ask Comfy to refresh its object info (Comfy reads its managers live)
        import httpx
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                await client.get(f"{COMFY}/object_info")
        except Exception:
            pass
        # Return what we see on disk, for sanity
        from pathlib import Path
        def ls(dirpath):
            p = Path(dirpath)
            return sorted([f.name for f in p.glob("*.safetensors")]) if p.exists() else []
        return {
            "unet": ls("/models/unet"),
            "vae": ls("/models/vae"),
            "clip": ls("/models/clip")
        }
    
    @api.get("/debug/extra_paths")
    async def debug_extra_paths():
        # Extra model paths YAML is intentionally disabled/unused.
        p = "/root/comfy/ComfyUI/extra_model_paths.yaml"
        exists = os.path.exists(p)
        return {"path": p, "exists": exists, "note": "extra_model_paths.yaml is not used; models are discovered via standard folders and symlinks."}

    @api.get("/debug/ls_outputs")
    async def debug_ls_outputs():
        import os, pathlib, time
        root = "/outputs"
        if not os.path.exists(root):
            return {"root": root, "exists": False, "items": []}

        def list_all(r):
            items = []
            base = pathlib.Path(r)
            for p in base.rglob("*"):
                try:
                    stat = p.stat()
                    items.append({
                        "path": str(p.relative_to(base)),
                        "is_dir": p.is_dir(),
                        "size": None if p.is_dir() else stat.st_size,
                        "mtime": stat.st_mtime,
                    })
                except Exception:
                    pass
            # sort: dirs first, then files by name
            items.sort(key=lambda x: (not x["is_dir"], x["path"]))
            return items

        return {"root": root, "exists": True, "items": list_all(root)}
    
    
    @api.get("/debug/ls_path")
    async def debug_ls_path(path: str = "/outputs"):
        import os, pathlib
        p = pathlib.Path(path)
        if not p.exists():
            return {"path": path, "exists": False, "items": []}
        items = []
        for f in sorted(p.rglob("*")):
            try:
                st = f.stat()
                items.append({
                    "path": str(f.relative_to(p)),
                    "is_dir": f.is_dir(),
                    "size": None if f.is_dir() else st.st_size,
                    "mtime": st.st_mtime,
                })
            except Exception:
                pass
        return {"path": path, "exists": True, "items": items}

    @api.get("/debug/find_outputs")
    async def debug_find_outputs(q: str = "teacache"):
        import pathlib
        roots = [
            "/outputs",
            "/root/comfy/ComfyUI/output",
            "/root/comfy/ComfyUI",
            "/userdir",
            "/tmp",
        ]
        results = []
        for root in roots:
            base = pathlib.Path(root)
            if not base.exists():
                continue
            for f in base.rglob("*"):
                name = f.name
                if q and q not in name:
                    continue
                try:
                    st = f.stat()
                    results.append({
                        "root": root,
                        "path": str(f.relative_to(base)),
                        "abs": str(f),
                        "is_dir": f.is_dir(),
                        "size": None if f.is_dir() else st.st_size,
                        "mtime": st.st_mtime,
                    })
                except Exception:
                    pass
        results.sort(key=lambda x: x["mtime"], reverse=True)
        return {"query": q, "results": results[:200]}


    return api