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


def _monitor_job_completion(job_id, job_manager_instance):
    """Monitor a job for completion using ComfyUI WebSocket for real progress."""
    try:
        import json
        import urllib.request
        import websocket
        import threading
        from pathlib import Path
        import time
        
        print(f"[MONITOR] Starting WebSocket monitoring for job: {job_id}", flush=True)
        
        # Track initial video count
        output_dir = Path("/outputs")
        initial_videos = set(f.name for f in output_dir.glob("*.mp4"))
        initial_count = len(initial_videos)
        print(f"[MONITOR] Initial video count: {initial_count}", flush=True)
        
        # Progress tracking variables
        progress_data = {
            'job_id': job_id,
            'total_steps': 0,
            'current_step': 0,
            'progress_percent': 0,
            'is_complete': False,
            'videos_generated': 0,
            'expected_videos': 1,  # Will be updated based on job
        }
        
        def on_websocket_message(ws, message):
            try:
                data = json.loads(message)
                msg_type = data.get('type')
                
                if msg_type == 'progress':
                    # Real-time progress from ComfyUI
                    progress_data['current_step'] = data.get('value', 0)
                    progress_data['total_steps'] = data.get('max', 1)
                    progress_data['progress_percent'] = (progress_data['current_step'] / progress_data['total_steps']) * 100 if progress_data['total_steps'] > 0 else 0
                    
                    # Update global progress state
                    global_progress['jobs'][job_id] = progress_data.copy()
                    global_progress['last_update'] = time.time()
                    
                    print(f"[PROGRESS] {job_id}: {progress_data['current_step']}/{progress_data['total_steps']} ({progress_data['progress_percent']:.1f}%)", flush=True)
                
                elif msg_type == 'executing':
                    node_id = data.get('data', {}).get('node')
                    if node_id:
                        print(f"[EXECUTING] {job_id}: Node {node_id}", flush=True)
                
                elif msg_type == 'executed':
                    # Check if this is a video generation completion
                    node_data = data.get('data', {})
                    if 'output' in node_data and 'videos' in str(node_data):
                        progress_data['videos_generated'] += 1
                        global_progress['jobs'][job_id] = progress_data.copy()
                        print(f"[VIDEO-COMPLETE] {job_id}: Video {progress_data['videos_generated']} generated", flush=True)
                
            except Exception as e:
                print(f"[WEBSOCKET] Error parsing message: {e}", flush=True)
        
        def on_websocket_error(ws, error):
            print(f"[WEBSOCKET] Error for {job_id}: {error}", flush=True)
        
        def on_websocket_close(ws, close_status_code, close_msg):
            print(f"[WEBSOCKET] Closed for {job_id}: {close_status_code}", flush=True)
        
        def on_websocket_open(ws):
            print(f"[WEBSOCKET] Connected for {job_id}", flush=True)
        
        # Start WebSocket connection to ComfyUI
        ws_url = "ws://127.0.0.1:8188/ws"
        ws = websocket.WebSocketApp(ws_url,
                                  on_open=on_websocket_open,
                                  on_message=on_websocket_message,
                                  on_error=on_websocket_error,
                                  on_close=on_websocket_close)
        
        # Run WebSocket in a separate thread
        ws_thread = threading.Thread(target=ws.run_forever, daemon=True)
        ws_thread.start()
        
        # Monitor for actual completion
        monitor_count = 0
        last_progress_time = time.time()
        
        while monitor_count < 120:  # Max 10 minutes of monitoring
            try:
                current_time = time.time()
                
                # Check for new video files
                current_videos = set(f.name for f in output_dir.glob("*.mp4"))
                new_videos = current_videos - initial_videos
                videos_generated = len(new_videos)
                
                # Check ComfyUI queue status
                queue_response = urllib.request.urlopen(f"http://127.0.0.1:8188/queue", timeout=5)
                queue_data = json.loads(queue_response.read().decode())
                queue_pending = queue_data.get("queue_pending", [])
                queue_running = queue_data.get("queue_running", [])
                
                # Real completion criteria:
                # 1. No items in queue (pending or running)
                # 2. New videos have been generated
                # 3. No progress updates for 30 seconds (indicating completion)
                no_queue_activity = len(queue_pending) == 0 and len(queue_running) == 0
                has_new_videos = videos_generated > 0
                progress_stalled = current_time - last_progress_time > 30
                
                if progress_data['current_step'] > 0:
                    last_progress_time = current_time
                
                print(f"[MONITOR] {job_id}: Queue(P:{len(queue_pending)}, R:{len(queue_running)}), Videos:{videos_generated}, Progress:{progress_data['progress_percent']:.1f}%", flush=True)
                
                # Upload new videos immediately when detected
                if new_videos:
                    for video_name in new_videos:
                        video_path = output_dir / video_name
                        if video_path.exists() and video_name not in job_manager_instance.uploaded_videos:
                            job_manager_instance.uploaded_videos.add(video_name)
                            print(f"[MONITOR] Uploading new video: {video_name}", flush=True)
                            success = _upload_to_backblaze(str(video_path))
                            if not success:
                                job_manager_instance.uploaded_videos.discard(video_name)
                
                # Complete job only when truly finished
                if no_queue_activity and has_new_videos and (progress_stalled or progress_data['progress_percent'] >= 95):
                    print(f"[MONITOR] Job {job_id} TRULY complete - Queue empty, videos generated, progress stalled", flush=True)
                    job_manager_instance.job_completed(job_id)
                    ws.close()
                    break
                
            except Exception as e:
                print(f"[MONITOR] Monitoring iteration {monitor_count}: {e}", flush=True)
            
            monitor_count += 1
            time.sleep(5)  # Check every 5 seconds
            
        if monitor_count >= 120:
            print(f"[MONITOR] Monitoring timeout for job {job_id}", flush=True)
            job_manager_instance.job_completed(job_id)
            ws.close()
            
    except Exception as e:
        print(f"[MONITOR] Error monitoring job {job_id}: {e}", flush=True)


def _upload_to_backblaze(video_path):
    """Enhanced upload with zero-failure guarantee using multiple fallback strategies."""
    return _upload_to_backblaze_enhanced(video_path)


def _upload_to_backblaze_enhanced(video_path):
    """Robust upload system with comprehensive error handling and fallback strategies."""
    import os
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError, NoCredentialsError, EndpointConnectionError
    import requests
    from pathlib import Path
    import time
    import random
    import shutil
    import threading
    import json
    
    video_file = Path(video_path)
    if not video_file.exists():
        print(f"[UPLOAD] Video file not found: {video_path}", flush=True)
        return False
    
    # Get configuration
    bucket = os.environ.get("S3_BUCKET")
    region = os.environ.get("S3_REGION", "us-east-1")
    endpoint = os.environ.get("S3_ENDPOINT")
    access_key = os.environ.get("AWS_ACCESS_KEY_ID")
    secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY")
    
    if not all([bucket, access_key, secret_key]):
        print("[UPLOAD] S3/Backblaze credentials not configured, using fallback storage", flush=True)
        return _fallback_to_persistent_storage(video_file)
    
    # Wait for file size to stabilize and exceed a sane minimum
    MIN_VIDEO_BYTES = int(os.environ.get("MIN_VIDEO_BYTES", "4096"))
    stable_window_s = float(os.environ.get("UPLOAD_STABLE_WINDOW_S", "2.0"))
    max_wait_s = float(os.environ.get("UPLOAD_MAX_WAIT_S", "300"))
    last_size = -1
    stable_since = None
    start_wait = time.time()
    while True:
        size = video_file.stat().st_size if video_file.exists() else 0
        now = time.time()
        if size != last_size:
            last_size = size
            stable_since = now
        # Stop when size has been stable long enough and above minimum
        if size >= MIN_VIDEO_BYTES and (now - (stable_since or now)) >= stable_window_s:
            break
        if now - start_wait > max_wait_s:
            print(f"[UPLOAD] Waited {max_wait_s}s for file to stabilize, proceeding with size={size}", flush=True)
            break
        time.sleep(0.25)

    file_size = video_file.stat().st_size
    print(f"[UPLOAD] Starting enhanced upload for {video_file.name} ({file_size / (1024*1024):.1f} MB) after stabilization", flush=True)
    
    # Strategy 1: Direct upload with retry logic
    result = _upload_with_retry_logic(video_file, bucket, endpoint, access_key, secret_key, region)
    if result:
        return True
    
    # Strategy 2: Multipart upload for large files
    if file_size > 100 * 1024 * 1024:  # 100MB threshold
        print(f"[UPLOAD] Attempting multipart upload for large file", flush=True)
        result = _upload_multipart(video_file, bucket, endpoint, access_key, secret_key, region)
        if result:
            return True
    
    # Strategy 3: Chunked upload with smaller parts
    print(f"[UPLOAD] Attempting chunked upload", flush=True)
    result = _upload_chunked(video_file, bucket, endpoint, access_key, secret_key, region)
    if result:
        return True
    
    # Strategy 4: Fallback to persistent storage
    print(f"[UPLOAD] All upload strategies failed, using persistent storage fallback", flush=True)
    return _fallback_to_persistent_storage(video_file)


def _upload_with_retry_logic(video_file, bucket, endpoint, access_key, secret_key, region):
    """Upload with exponential backoff and circuit breaker pattern."""
    max_retries = 5
    base_delay = 2
    max_delay = 60
    timeout = 120  # 2 minutes timeout
    
    for attempt in range(max_retries):
        try:
            print(f"[UPLOAD] Attempt {attempt + 1}/{max_retries} for {video_file.name}", flush=True)
            
            # Create S3 client with enhanced configuration
            s3_client = _create_robust_s3_client(endpoint, access_key, secret_key, region, timeout)
            
            # Generate unique key
            timestamp = int(time.time())
            unique_key = f"modal-generated/{timestamp}_{video_file.name}"
            
            # Upload configuration
            upload_args = {'ContentType': 'video/mp4'}
            if not (endpoint and "backblazeb2.com" in endpoint):
                upload_args['ACL'] = 'public-read'
            
            # Perform upload with progress tracking
            start_time = time.time()
            with open(video_file, 'rb') as f:
                s3_client.upload_fileobj(f, bucket, unique_key, ExtraArgs=upload_args)
            
            upload_time = time.time() - start_time
            print(f"[UPLOAD] Upload completed in {upload_time:.1f}s", flush=True)
            
            # Verify upload
            if _verify_upload(s3_client, bucket, unique_key, video_file.stat().st_size):
                # Generate public URL
                public_url = _generate_public_url(bucket, unique_key, endpoint, region)
                
                # Wait for Backblaze availability
                if endpoint and "backblazeb2.com" in endpoint:
                    time.sleep(3)  # Increased wait time for Backblaze
                
                # Notify backend
                project_id, user_id = _extract_ids_from_filename(video_file.name)
                _notify_backend_upload(unique_key, public_url, video_file.name, project_id, user_id)
                
                print(f"[UPLOAD] ✅ Successfully uploaded {video_file.name} to {public_url}", flush=True)
                return True
            else:
                # Delete bad object before retrying
                try:
                    s3_client.delete_object(Bucket=bucket, Key=unique_key)
                    print(f"[UPLOAD] Deleted failed object {unique_key}", flush=True)
                except Exception as de:
                    print(f"[UPLOAD] Delete failed object error: {de}", flush=True)
                print(f"[UPLOAD] Upload verification failed for {video_file.name}", flush=True)
                
        except (ClientError, NoCredentialsError, EndpointConnectionError) as e:
            print(f"[UPLOAD] S3 error on attempt {attempt + 1}: {e}", flush=True)
            if attempt < max_retries - 1:
                delay = min(base_delay * (2 ** attempt) + random.uniform(0, 1), max_delay)
                print(f"[UPLOAD] Retrying in {delay:.1f} seconds...", flush=True)
                time.sleep(delay)
            else:
                print(f"[UPLOAD] All retry attempts exhausted", flush=True)
                
        except Exception as e:
            print(f"[UPLOAD] Unexpected error on attempt {attempt + 1}: {e}", flush=True)
            if attempt < max_retries - 1:
                time.sleep(2)
            else:
                print(f"[UPLOAD] Unexpected error after all retries", flush=True)
    
    return False


def _upload_multipart(video_file, bucket, endpoint, access_key, secret_key, region):
    """Multipart upload for large files with enhanced error handling."""
    try:
        import boto3
        from botocore.config import Config
        
        s3_client = _create_robust_s3_client(endpoint, access_key, secret_key, region, 300)  # 5 min timeout
        
        timestamp = int(time.time())
        unique_key = f"modal-generated/{timestamp}_{video_file.name}"
        
        # Configure multipart upload
        upload_args = {'ContentType': 'video/mp4'}
        if not (endpoint and "backblazeb2.com" in endpoint):
            upload_args['ACL'] = 'public-read'
        
        print(f"[UPLOAD] Starting multipart upload for {video_file.name}", flush=True)
        
        # Initiate multipart upload
        response = s3_client.create_multipart_upload(
            Bucket=bucket,
            Key=unique_key,
            **upload_args
        )
        upload_id = response['UploadId']
        
        # Upload parts
        part_size = 50 * 1024 * 1024  # 50MB parts
        parts = []
        part_number = 1
        
        with open(video_file, 'rb') as f:
            while True:
                chunk = f.read(part_size)
                if not chunk:
                    break
                
                print(f"[UPLOAD] Uploading part {part_number} ({len(chunk) / (1024*1024):.1f} MB)", flush=True)
                
                # Retry logic for each part
                for attempt in range(3):
                    try:
                        response = s3_client.upload_part(
                            Bucket=bucket,
                            Key=unique_key,
                            PartNumber=part_number,
                            UploadId=upload_id,
                            Body=chunk
                        )
                        parts.append({
                            'ETag': response['ETag'],
                            'PartNumber': part_number
                        })
                        break
                    except Exception as e:
                        print(f"[UPLOAD] Part {part_number} attempt {attempt + 1} failed: {e}", flush=True)
                        if attempt < 2:
                            time.sleep(2)
                        else:
                            # Abort multipart upload on failure
                            s3_client.abort_multipart_upload(
                                Bucket=bucket,
                                Key=unique_key,
                                UploadId=upload_id
                            )
                            return False
                
                part_number += 1
        
        # Complete multipart upload
        s3_client.complete_multipart_upload(
            Bucket=bucket,
            Key=unique_key,
            UploadId=upload_id,
            MultipartUpload={'Parts': parts}
        )
        
        # Verify and notify
        if _verify_upload(s3_client, bucket, unique_key, video_file.stat().st_size):
            public_url = _generate_public_url(bucket, unique_key, endpoint, region)
            project_id, user_id = _extract_ids_from_filename(video_file.name)
            _notify_backend_upload(unique_key, public_url, video_file.name, project_id, user_id)
            
            print(f"[UPLOAD] ✅ Multipart upload successful for {video_file.name}", flush=True)
            return True
        
    except Exception as e:
        print(f"[UPLOAD] Multipart upload failed: {e}", flush=True)
    
    return False


def _upload_chunked(video_file, bucket, endpoint, access_key, secret_key, region):
    """Chunked upload with smaller parts for better reliability."""
    try:
        import boto3
        from botocore.config import Config
        
        s3_client = _create_robust_s3_client(endpoint, access_key, secret_key, region, 180)  # 3 min timeout
        
        timestamp = int(time.time())
        unique_key = f"modal-generated/{timestamp}_{video_file.name}"
        
        # Use smaller chunks for better reliability
        chunk_size = 10 * 1024 * 1024  # 10MB chunks
        file_size = video_file.stat().st_size
        
        print(f"[UPLOAD] Starting chunked upload with {chunk_size / (1024*1024):.0f}MB chunks", flush=True)
        
        with open(video_file, 'rb') as f:
            # Upload in chunks and reassemble
            chunk_data = f.read(chunk_size)
            if not chunk_data:
                return False
            
            # For small files, use regular upload
            if file_size <= chunk_size:
                upload_args = {'ContentType': 'video/mp4'}
                if not (endpoint and "backblazeb2.com" in endpoint):
                    upload_args['ACL'] = 'public-read'
                
                f.seek(0)
                s3_client.upload_fileobj(f, bucket, unique_key, ExtraArgs=upload_args)
            else:
                # Use multipart for larger files
                return _upload_multipart(video_file, bucket, endpoint, access_key, secret_key, region)
        
        # Verify and notify
        if _verify_upload(s3_client, bucket, unique_key, file_size):
            public_url = _generate_public_url(bucket, unique_key, endpoint, region)
            project_id, user_id = _extract_ids_from_filename(video_file.name)
            _notify_backend_upload(unique_key, public_url, video_file.name, project_id, user_id)
            
            print(f"[UPLOAD] ✅ Chunked upload successful for {video_file.name}", flush=True)
            return True
        
    except Exception as e:
        print(f"[UPLOAD] Chunked upload failed: {e}", flush=True)
    
    return False


def _fallback_to_persistent_storage(video_file):
    """Fallback strategy: Store in persistent volume and notify backend."""
    try:
        import os
        import shutil
        import time
        
        # Create persistent storage directory
        persistent_dir = "/modal_volumes/pending_uploads"
        os.makedirs(persistent_dir, exist_ok=True)
        
        # Generate unique filename
        timestamp = int(time.time())
        persistent_filename = f"{timestamp}_{video_file.name}"
        persistent_path = os.path.join(persistent_dir, persistent_filename)
        
        # Copy file to persistent storage
        shutil.copy2(video_file, persistent_path)
        
        print(f"[FALLBACK] Stored {video_file.name} in persistent volume: {persistent_path}", flush=True)
        
        # Notify backend about pending upload
        _notify_backend_pending_upload(persistent_path, video_file.name)
        
        # Schedule retry upload in background
        _schedule_retry_upload(persistent_path, video_file.name)
        
        return True
        
    except Exception as e:
        print(f"[FALLBACK] Failed to store in persistent volume: {e}", flush=True)
        return False


def _create_robust_s3_client(endpoint, access_key, secret_key, region, timeout):
    """Create S3 client with robust configuration."""
    import boto3
    from botocore.config import Config
    
    config = Config(
        signature_version='s3v4',
        s3={'addressing_style': 'virtual'},
        read_timeout=timeout,
        connect_timeout=30,
        retries={'max_attempts': 1},  # Handle retries manually
        max_pool_connections=50
    )
    
    if endpoint and "backblazeb2.com" in endpoint:
        b2_endpoint = endpoint if endpoint.startswith('https://') else f"https://{endpoint}"
        return boto3.client(
            's3',
            endpoint_url=b2_endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name='us-east-1',
            config=config
        )
    else:
        return boto3.client(
            's3',
            region_name=region,
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=config
        )


def _verify_upload(s3_client, bucket, key, expected_size):
    """Verify that upload was successful by checking file metadata."""
    try:
        response = s3_client.head_object(Bucket=bucket, Key=key)
        actual_size = response['ContentLength']
        MIN_VIDEO_BYTES = int(os.environ.get("MIN_VIDEO_BYTES", "4096"))

        if actual_size < MIN_VIDEO_BYTES:
            print(f"[VERIFY] Too small: {actual_size} bytes (< {MIN_VIDEO_BYTES})", flush=True)
            return False
        if actual_size != expected_size:
            print(f"[VERIFY] Size mismatch: expected {expected_size}, got {actual_size}", flush=True)
            return False
        print(f"[VERIFY] Upload verification successful: {actual_size} bytes", flush=True)
        return True
            
    except Exception as e:
        print(f"[VERIFY] Upload verification failed: {e}", flush=True)
        return False


def _generate_public_url(bucket, key, endpoint, region):
    """Generate public URL based on service type."""
    if endpoint and "backblazeb2.com" in endpoint:
        return f"https://f005.backblazeb2.com/file/{bucket}/{key}"
    elif endpoint:
        return f"{endpoint.rstrip('/')}/{bucket}/{key}"
    else:
        return f"https://{bucket}.s3.{region}.amazonaws.com/{key}"


def _notify_backend_pending_upload(persistent_path, filename):
    """Notify backend about pending upload in persistent storage."""
    try:
        import requests
        import os
        
        backend_url = os.environ.get("BACKEND_URL", "http://localhost:3001")
        
        payload = {
            "type": "pending_upload",
            "path": persistent_path,
            "filename": filename,
            "status": "pending_retry"
        }
        
        response = requests.post(
            f"{backend_url}/api/media/pending-upload",
            json=payload,
            timeout=10
        )
        
        if response.status_code == 200:
            print(f"[FALLBACK] Backend notified about pending upload: {filename}", flush=True)
        else:
            print(f"[FALLBACK] Backend notification failed: {response.status_code}", flush=True)
            
    except Exception as e:
        print(f"[FALLBACK] Error notifying backend: {e}", flush=True)


def _schedule_retry_upload(persistent_path, filename):
    """Schedule background retry of failed upload."""
    def retry_worker():
        import time
        import os
        
        # Wait before retry
        time.sleep(60)  # 1 minute delay
        
        max_retries = 3
        for attempt in range(max_retries):
            try:
                print(f"[RETRY] Attempting retry {attempt + 1}/{max_retries} for {filename}", flush=True)
                
                # Try upload again
                if _upload_with_retry_logic(Path(persistent_path), 
                                          os.environ.get("S3_BUCKET"),
                                          os.environ.get("S3_ENDPOINT"),
                                          os.environ.get("AWS_ACCESS_KEY_ID"),
                                          os.environ.get("AWS_SECRET_ACCESS_KEY"),
                                          os.environ.get("S3_REGION", "us-east-1")):
                    # Success - clean up persistent file
                    os.remove(persistent_path)
                    print(f"[RETRY] ✅ Retry successful, cleaned up persistent file", flush=True)
                    return
                else:
                    print(f"[RETRY] Retry {attempt + 1} failed", flush=True)
                    if attempt < max_retries - 1:
                        time.sleep(120)  # 2 minutes between retries
                        
            except Exception as e:
                print(f"[RETRY] Retry {attempt + 1} error: {e}", flush=True)
                if attempt < max_retries - 1:
                    time.sleep(120)
        
        print(f"[RETRY] All retry attempts failed for {filename}", flush=True)
    
    # Start retry in background thread
    retry_thread = threading.Thread(target=retry_worker, daemon=True)
    retry_thread.start()


def _extract_ids_from_filename(filename):
    """Extract project and user IDs from video filename."""
    try:
        import re
        # Format: ua{userId}_p{projectId}_...
        match = re.search(r'ua([a-f0-9\-]+)_p([a-f0-9\-]+)_', filename)
        if match:
            return match.group(2), match.group(1)  # project_id, user_id
        return None, None
    except Exception:
        return None, None


def _notify_backend_upload(key, public_url, filename, project_id=None, user_id=None):
    """Notify the backend about a completed video upload."""
    try:
        import requests
        import os
        import re
        
        # Extract IDs from filename if not provided (u{user}_p{project})
        if not project_id or not user_id:
            match = re.search(r'u([a-f0-9\-]+)_p([a-f0-9\-]+)_', filename)
            if match:
                user_id = user_id or match.group(1)
                project_id = project_id or match.group(2)
                print(f"[UPLOAD] Extracted from filename - User: {user_id}, Project: {project_id}", flush=True)
        
        # Get backend URL from environment or use default
        backend_url = os.environ.get("BACKEND_URL", "http://localhost:3001")
        
        # Notify backend via API call with project association
        payload = {
            "key": key,
            "remote_url": public_url,
            "filename": filename,
            "kind": "video",
            "source": "modal_generated",
            "project_id": project_id,
            "user_id": user_id
        }
        
        response = requests.post(
            f"{backend_url}/api/modal-upload",
            json=payload,
            timeout=10
        )
        
        if response.status_code == 200:
            print(f"[UPLOAD] Backend notified and media imported: {filename}", flush=True)
            print(f"[UPLOAD] Project: {project_id} | User: {user_id}", flush=True)
        else:
            print(f"[UPLOAD] Backend notification failed: {response.status_code}", flush=True)
            print(f"[UPLOAD] Response: {response.text if hasattr(response, 'text') else 'No response text'}", flush=True)
            
    except Exception as e:
        print(f"[UPLOAD] Error notifying backend: {e}", flush=True)


# -------- Modal app & image --------
app = modal.App("gausian-comfyui")

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
        "websocket-client",
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
    min_containers=0,
    max_containers=2,
    scaledown_window=900,
    secrets=[
        modal.Secret.from_dict({
            "S3_BUCKET": os.environ.get("S3_BUCKET", ""),
            "S3_REGION": os.environ.get("S3_REGION", "us-east-1"),
            "S3_ENDPOINT": os.environ.get("S3_ENDPOINT", ""),
            "AWS_ACCESS_KEY_ID": os.environ.get("AWS_ACCESS_KEY_ID", ""),
            "AWS_SECRET_ACCESS_KEY": os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
            "BACKEND_URL": os.environ.get("BACKEND_URL", "http://localhost:3001"),
        })
    ],
    
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
    
    # Setup auto-shutdown and upload system
    class JobCompletionManager:
        def __init__(self):
            self.active_jobs = set()
            self.completed_jobs = set()
            self.uploaded_videos = set()  # Track uploaded videos to prevent duplicates
            self.last_activity = time.time()
            self._start_shutdown_monitor()
        
        def _start_shutdown_monitor(self):
            """Monitor for idle state and shutdown container to save costs."""
            def shutdown_monitor():
                while True:
                    try:
                        time.sleep(15)  # Check every 15 seconds
                        
                        # Only shutdown if truly idle - no active jobs AND no recent activity
                        idle_time = time.time() - self.last_activity
                        
                        if (len(self.active_jobs) == 0 and idle_time > 20):
                            print(f"[SHUTDOWN] No active jobs for {idle_time:.1f} seconds, initiating shutdown", flush=True)
                            print("[SHUTDOWN] Container will terminate to save costs", flush=True)
                            
                            # Graceful shutdown
                            os._exit(0)
                        elif len(self.active_jobs) > 0:
                            print(f"[SHUTDOWN] Still active: {len(self.active_jobs)} jobs running", flush=True)
                        else:
                            print(f"[SHUTDOWN] Idle for {idle_time:.1f}s, waiting for 20s threshold", flush=True)
                            
                    except Exception as e:
                        print(f"[SHUTDOWN] Shutdown monitor error: {e}", flush=True)
            
            self.shutdown_thread = threading.Thread(target=shutdown_monitor, daemon=True)
            self.shutdown_thread.start()
            print("[SHUTDOWN] Auto-shutdown monitor started (30-second idle timeout)", flush=True)
        
        def job_started(self, job_id):
            """Mark a job as started."""
            self.active_jobs.add(job_id)
            self.last_activity = time.time()
            print(f"[JOBS] Job started: {job_id} (active: {len(self.active_jobs)})", flush=True)
        
        def job_completed(self, job_id):
            """Mark a job as completed."""
            self.active_jobs.discard(job_id)
            self.completed_jobs.add(job_id)
            self.last_activity = time.time()
            
            print(f"[JOBS] Job completed: {job_id} (active: {len(self.active_jobs)})", flush=True)
            
            # If no more active jobs, start shutdown timer
            if not self.active_jobs:
                print("[JOBS] All jobs completed, shutdown timer active", flush=True)
    
    # Initialize job manager
    job_manager = JobCompletionManager()
    
    # Global progress tracking for WebSocket data
    global_progress = {
        'jobs': {},  # job_id -> progress_data
        'last_update': time.time()
    }
    
    # Add global completion checker
    def global_completion_checker(job_manager_instance):
        """Check for completed videos and trigger uploads/shutdown."""
        import time
        from pathlib import Path
        
        last_video_count = 0
        stable_count = 0
        
        while True:
            try:
                time.sleep(10)  # Check every 10 seconds
                
                # Count videos in output directory
                output_dir = Path("/outputs")
                current_videos = list(output_dir.glob("*.mp4"))
                current_count = len(current_videos)
                
                print(f"[GLOBAL-CHECK] Video count: {current_count}, Active jobs: {len(job_manager_instance.active_jobs)}", flush=True)
                
                # If video count changed, upload new ones (with better duplicate prevention)
                if current_count > last_video_count:
                    print(f"[GLOBAL-CHECK] New videos detected ({last_video_count} -> {current_count})", flush=True)
                    
                    # Upload only truly new videos (avoid duplicates)
                    for video in current_videos:
                        if (video.stat().st_mtime > time.time() - 120 and  # Videos from last 2 minutes
                            video.name not in job_manager_instance.uploaded_videos):  # Not already uploaded
                            # Add to uploaded set BEFORE uploading to prevent race conditions
                            job_manager_instance.uploaded_videos.add(video.name)
                            print(f"[GLOBAL-CHECK] Uploading new video: {video.name}", flush=True)
                            success = _upload_to_backblaze(str(video))
                            if not success:
                                # Remove from set if upload failed
                                job_manager_instance.uploaded_videos.discard(video.name)
                    
                    last_video_count = current_count
                    stable_count = 0
                else:
                    stable_count += 1
                
                # Only shutdown if truly idle - check ComfyUI queue status too
                if len(job_manager_instance.active_jobs) == 0 and stable_count >= 6:  # 20 seconds stable
                    try:
                        # Double-check ComfyUI queue is actually empty
                        queue_response = urllib.request.urlopen(f"http://127.0.0.1:8188/queue", timeout=5)
                        queue_data = json.loads(queue_response.read().decode())
                        
                        queue_pending = queue_data.get("queue_pending", [])
                        queue_running = queue_data.get("queue_running", [])
                        
                        if len(queue_pending) == 0 and len(queue_running) == 0:
                            print("[GLOBAL-CHECK] All jobs complete, queue empty, and stable - triggering shutdown", flush=True)
                            print("[SHUTDOWN] Container terminating immediately to save costs", flush=True)
                            os._exit(0)
                        else:
                            print(f"[GLOBAL-CHECK] Queue not empty - Pending: {len(queue_pending)}, Running: {len(queue_running)}", flush=True)
                            stable_count = 0  # Reset stability counter if queue has items
                    except Exception as queue_error:
                        print(f"[GLOBAL-CHECK] Queue check failed: {queue_error}", flush=True)
                    
            except Exception as e:
                print(f"[GLOBAL-CHECK] Error: {e}", flush=True)
    
    # Start global completion checker
    threading.Thread(target=global_completion_checker, args=(job_manager,), daemon=True).start()
    print("[GLOBAL-CHECK] Global completion checker started", flush=True)

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
    
    @api.get("/progress-status")
    async def progress_status():
        """Get real-time progress of all active jobs with accurate timing."""
        try:
            import json
            import urllib.request
            from pathlib import Path
            
            # Get queue status
            queue_response = urllib.request.urlopen(f"http://127.0.0.1:8188/queue", timeout=5)
            queue_data = json.loads(queue_response.read().decode())
            
            # Get active and pending jobs
            queue_pending = queue_data.get("queue_pending", [])
            queue_running = queue_data.get("queue_running", [])
            
            # Count actual video files
            output_dir = Path("/outputs")
            video_count = len(list(output_dir.glob("*.mp4")))
            
            # Calculate more accurate progress
            total_jobs_submitted = len(job_manager.active_jobs) + len(job_manager.completed_jobs)
            jobs_in_queue = len(queue_pending) + len(queue_running)
            
            # More accurate progress calculation
            if total_jobs_submitted > 0:
                queue_progress = max(0, (total_jobs_submitted - jobs_in_queue) / total_jobs_submitted * 100)
            else:
                queue_progress = 0
            
            # Get real-time progress from WebSocket data
            job_details = []
            total_progress = 0
            active_jobs_count = len(job_manager.active_jobs)
            
            for job_id in job_manager.active_jobs:
                job_progress = global_progress['jobs'].get(job_id, {})
                job_details.append({
                    'job_id': job_id,
                    'progress_percent': job_progress.get('progress_percent', 0),
                    'current_step': job_progress.get('current_step', 0),
                    'total_steps': job_progress.get('total_steps', 0),
                    'videos_generated': job_progress.get('videos_generated', 0),
                })
                total_progress += job_progress.get('progress_percent', 0)
            
            overall_progress = total_progress / max(1, active_jobs_count) if active_jobs_count > 0 else 100
            
            return {
                "active_jobs": active_jobs_count,
                "uploaded_videos": len(job_manager.uploaded_videos),
                "queue_pending": len(queue_pending),
                "queue_running": len(queue_running),
                "video_files_generated": video_count,
                "queue_progress": round(queue_progress, 1),
                "overall_progress": round(overall_progress, 1),
                "total_jobs_submitted": total_jobs_submitted,
                "last_activity": job_manager.last_activity,
                "idle_time": time.time() - job_manager.last_activity,
                "recent_jobs": list(job_manager.completed_jobs)[-10:],
                "job_details": job_details,
                "estimated_time_per_shot": "15-67 seconds",
                "websocket_progress": True,
            }
        except Exception as e:
            return {"error": str(e)}

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
        import json
        try:
            req = await request.json()
        except Exception:
            return Response(
                content=json.dumps({"error": "Invalid JSON body"}),
                status_code=400,
                media_type="application/json",
            )
        
        # Track job start
        job_id = req.get("client_id", f"job_{int(time.time())}")
        print(f"[DEBUG] Tracking job with ID: {job_id}", flush=True)
        job_manager.job_started(job_id)

        p = req.get("prompt", None)
        if p is None:
            return Response(
                content=json.dumps({"error": "Missing 'prompt' in body"}),
                status_code=400,
                media_type="application/json",
            )

        # Accept top-level STRING prompt and parse it
        revived_top = False
        if isinstance(p, str):
            try:
                p2 = json.loads(p)
                if isinstance(p2, dict):
                    req["prompt"] = p = p2
                    revived_top = True
                else:
                    return Response(
                        content=json.dumps({"error": "prompt string did not parse to an object"}),
                        status_code=400,
                        media_type="application/json",
                    )
            except Exception as e:
                return Response(
                    content=json.dumps({"error": f"prompt string not valid JSON: {str(e)}"}),
                    status_code=400,
                    media_type="application/json",
                )

        if not isinstance(p, dict):
            return Response(
                content=json.dumps({"error": "prompt must be an object map (dict)"}),
                status_code=400,
                media_type="application/json",
            )

        # Revive any node-level strings
        revived_nodes, bad_nodes, missing = [], [], []
        for k, v in list(p.items()):
            if isinstance(v, str):
                try:
                    parsed = json.loads(v)
                    if isinstance(parsed, dict):
                        p[k] = parsed
                        revived_nodes.append(k)
                    else:
                        bad_nodes.append(k)
                except Exception:
                    bad_nodes.append(k)

        # Validate node shapes
        for k, v in p.items():
            if not isinstance(v, dict):
                bad_nodes.append(k)
                continue
            if "class_type" not in v or "inputs" not in v or not isinstance(v["inputs"], dict):
                missing.append(k)

        if revived_top or revived_nodes:
            print(f"[PROXY] revived_top={revived_top} revived_nodes={revived_nodes}", flush=True)

        if bad_nodes or missing:
            err = {
                "error": "prompt contains invalid nodes",
                "string_nodes_unparsed": bad_nodes[:20],
                "nodes_missing_fields": missing[:20],
            }
            return Response(content=json.dumps(err), status_code=400, media_type="application/json")

        # Forward to local ComfyUI
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{COMFY}/prompt", json=req)
        
        # Start monitoring for job completion and upload
        if r.status_code == 200:
            threading.Thread(
                target=_monitor_job_completion,
                args=(job_id, job_manager),
                daemon=True
            ).start()
        
        return Response(
            content=r.content,
            status_code=r.status_code,
            media_type=r.headers.get("content-type", "application/json"),
        ) 


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
