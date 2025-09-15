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
    min_containers=1,
    max_containers=1,
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

    api = FastAPI()
    from fastapi.staticfiles import StaticFiles
    api.mount("/files", StaticFiles(directory="/outputs"), name="files")
    COMFY = "http://127.0.0.1:8188"

    @api.get("/")
    async def root():
        return {"ok": True, "msg": "ComfyUI proxy up. Try /health or /system_stats."}

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
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{COMFY}/prompt", content=body, headers=headers)
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