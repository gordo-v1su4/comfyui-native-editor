import json
import subprocess
import uuid
from pathlib import Path
from typing import Dict

import modal
import modal.experimental

image = (  # build up a Modal Image to run ComfyUI, step by step
    modal.Image.debian_slim(  # start from basic Linux with Python
        python_version="3.11"
    )
    .apt_install("git", "ffmpeg", "libgl1", "libglib2.0-0", "libgomp1", "libglib2.0-dev", "pkg-config")  # add extra video/system deps
    .pip_install("fastapi[standard]==0.115.4")  # install web dependencies
    .pip_install("comfy-cli")  # install latest comfy-cli
    .run_commands(  # use comfy-cli to install ComfyUI and its dependencies
        "comfy --skip-prompt install --fast-deps --nvidia"
    )
)

image = (
    image.run_commands(  # download a custom node
        "comfy node install --fast-deps was-node-suite-comfyui"
    )
    .run_commands(
        # KJNodes provides math and attention nodes used by many T2V graphs
        "comfy node install --fast-deps ComfyUI-KJNodes"
    )
    .run_commands(
        # Install cg-use-everywhere for Anything Everywhere and Prompts Everywhere nodes
        "comfy node install --fast-deps cg-use-everywhere"
    )
    .run_commands(
        # Install SD3 nodes for ModelSamplingSD3
        "comfy node install --fast-deps ComfyUI-SD3-nodes"
    )
    .run_commands(
        # Install VideoHelperSuite for VHS_VideoCombine
        "comfy node install --fast-deps https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite"
    )
    # Add .run_commands(...) calls for any other custom nodes you want to download
)


def hf_download():
    from huggingface_hub import hf_hub_download

    # Download models required by workflows
    paths = []
    # Flux Schnell (for image example)
    paths.append(
        (
            hf_hub_download(
                repo_id="Comfy-Org/flux1-schnell",
                filename="flux1-schnell-fp8.safetensors",
                cache_dir="/cache",
            ),
            "/root/comfy/ComfyUI/models/checkpoints/flux1-schnell-fp8.safetensors",
        )
    )
    # WAN 2.x VAE and text encoder (names from workflow JSON)
    # NOTE: If these filenames differ in your environment, update below accordingly.
    # We'll attempt common repos; if not present, the workflow may still fail until you provide the correct weights.
    try:
        vae = hf_hub_download(
            repo_id="Wan-Video/Wan2.1-VAE",
            filename="wan_2.1_vae.safetensors",
            cache_dir="/cache",
        )
        paths.append((vae, "/root/comfy/ComfyUI/models/vae/wan_2.1_vae.safetensors"))
    except Exception:
        pass
    try:
        clip = hf_hub_download(
            repo_id="Wan-Video/UMT5-XXL-FP8",
            filename="umt5_xxl_fp8_e4m3fn_scaled.safetensors",
            cache_dir="/cache",
        )
        paths.append((clip, "/root/comfy/ComfyUI/models/clip/umt5_xxl_fp8_e4m3fn_scaled.safetensors"))
    except Exception:
        pass
    # WAN 2.2 UNETs (high and low noise) — placeholder repo ids, adjust if needed
    for fn in [
        "wan2.2_t2v_high_noise_14B_fp16.safetensors",
        "wan2.2_t2v_low_noise_14B_fp16.safetensors",
    ]:
        try:
            unet = hf_hub_download(
                repo_id="Wan-Video/Wan2.2-T2V",
                filename=fn,
                cache_dir="/cache",
            )
            paths.append((unet, f"/root/comfy/ComfyUI/models/unet/{fn}"))
        except Exception:
            pass

    for src, dst in paths:
        subprocess.run(f"mkdir -p $(dirname {dst}) && ln -s {src} {dst}", shell=True, check=True)

# Mount the comfyui-models volume and symlink WAN 2.2 files to ComfyUI directories
def setup_wan_models():
    import subprocess
    from pathlib import Path
    
    # Create model directories if they don't exist
    for dir_path in [
        "/root/comfy/ComfyUI/models/checkpoints",
        "/root/comfy/ComfyUI/models/vae", 
        "/root/comfy/ComfyUI/models/clip",
        "/root/comfy/ComfyUI/models/unet",
        "/root/comfy/ComfyUI/models/upscale_models",
    ]:
        Path(dir_path).mkdir(parents=True, exist_ok=True)
    
    # Map files from comfyui-models volume to ComfyUI directories
    # Based on the workflow JSON node inputs
    mappings = [
        # VAE
        ("wan_2.1_vae.safetensors", "/root/comfy/ComfyUI/models/vae/"),
        # CLIP  
        ("umt5_xxl_fp8_e4m3fn_scaled.safetensors", "/root/comfy/ComfyUI/models/clip/"),
        # UNETs - use fp8 versions that are available
        ("wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors", "/root/comfy/ComfyUI/models/unet/"),
        ("wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors", "/root/comfy/ComfyUI/models/unet/"),
        # Also try the ti2v version
        ("wan2.2_ti2v_5B_fp16.safetensors", "/root/comfy/ComfyUI/models/unet/"),
        # Upscaler model(s)
        ("upscale_models/4xLSDIR.pth", "/root/comfy/ComfyUI/models/"),
    ]
    
    for filename, target_dir in mappings:
        source = f"/models/{filename}"
        target = f"{target_dir}{filename}"
        if Path(source).exists():
            subprocess.run(f"ln -sf {source} {target}", shell=True, check=True)
            print(f"Linked {source} -> {target}")
        else:
            print(f"Warning: {source} not found in comfyui-models volume")

models_vol = modal.Volume.from_name("comfyui-models", create_if_missing=True)
custom_nodes_vol = modal.Volume.from_name("comfyui-custom-nodes", create_if_missing=True)

image = image.run_function(
    setup_wan_models,
    volumes={"/models": models_vol},
)


vol = modal.Volume.from_name("hf-hub-cache", create_if_missing=True)

image = (
    # install huggingface_hub with hf_transfer support to speed up downloads
    image.pip_install("huggingface_hub[hf_transfer]==0.34.4")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .run_function(
        hf_download,
        # persist the HF cache to a Modal Volume so future runs don't re-download models
        volumes={"/cache": vol},
    )
)

image = (
    image.apt_install("curl")
    .run_commands(
        "curl -L -o /root/workflow_api.json https://raw.githubusercontent.com/modal-labs/modal-examples/main/06_gpu_and_ml/comfyui/workflow_api.json"
    )
)

# include any local workflows you want to run headlessly
try:
    image = image.add_local_file(
        Path(__file__).parent / "wan22_t2v_flexible.json", 
        "/root/wan22_t2v_flexible.json",
    )
    image = image.add_local_file(
        Path(__file__).parent / "test_workflow.json", 
        "/root/test_workflow.json",
    )
    image = image.add_local_file(
        Path(__file__).parent / "simplified_workflow.json", 
        "/root/simplified_workflow.json",
    )
except Exception:
    # If file is not present locally, skip; users can POST workflows instead
    pass


app = modal.App(name="example-comfyapp", image=image)


@app.function(
    max_containers=1,  # limit interactive session to 1 container
    gpu="L40S",  # good starter GPU for inference
    volumes={"/cache": vol, "/models": models_vol, "/cn": custom_nodes_vol},  # mounts our cached models, WAN weights, and custom nodes
)
@modal.concurrent(
    max_inputs=10
)  # required for UI startup process which runs several API calls concurrently
@modal.web_server(8000, startup_timeout=60)
def ui():
    subprocess.Popen("comfy launch -- --listen 0.0.0.0 --port 8000", shell=True)


@app.cls(
    scaledown_window=300,
    gpu="L40S",
    volumes={"/cache": vol, "/models": models_vol, "/cn": custom_nodes_vol},
)
@modal.concurrent(max_inputs=5)
class ComfyUI:
    port: int = 8188

    @modal.enter()
    def launch_comfy_background(self):
        import time
        print(f"=== CONTAINER STARTUP TIMESTAMP: {time.time()} ===")
        
        # Set up WAN models symlinks
        setup_wan_models()
        
        # Update node registry
        subprocess.run(["comfy", "node", "update-registry"], check=False)
        
        # Try to install missing nodes directly
        print("=== INSTALLING MISSING NODES ===")
        
        # Install cg-use-everywhere (Anything Everywhere, Prompts Everywhere)
        try:
            print("Installing cg-use-everywhere...")
            subprocess.run(["comfy", "node", "install", "cg-use-everywhere"], check=False)
        except Exception as e:
            print(f"Failed to install cg-use-everywhere: {e}")
            try:
                print("Trying alternative everywhere URL...")
                subprocess.run(["comfy", "node", "install", "https://github.com/cguse/ComfyUI-AnyWhere-EveryWhere"], check=False)
            except Exception as e2:
                print(f"Failed to install everywhere from URL: {e2}")
        
        # Install KJNodes
        try:
            print("Installing ComfyUI-KJNodes...")
            subprocess.run(["comfy", "node", "install", "ComfyUI-KJNodes"], check=False)
        except Exception as e:
            print(f"Failed to install ComfyUI-KJNodes: {e}")
        
        # Install SD3 nodes
        try:
            print("Installing ComfyUI-SD3-nodes...")
            subprocess.run(["comfy", "node", "install", "ComfyUI-SD3-nodes"], check=False)
        except Exception as e:
            print(f"Failed to install ComfyUI-SD3-nodes: {e}")
        
        # Try to install VideoHelperSuite specifically
        try:
            print("Installing ComfyUI-VideoHelperSuite...")
            subprocess.run(["comfy", "node", "install", "ComfyUI-VideoHelperSuite"], check=False)
        except Exception as e:
            print(f"Failed to install ComfyUI-VideoHelperSuite: {e}")
            try:
                print("Trying VideoHelperSuite from GitHub URL...")
                subprocess.run(["comfy", "node", "install", "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite"], check=False)
            except Exception as e2:
                print(f"Failed to install VideoHelperSuite from URL: {e2}")
        
        print("=== END INSTALLING MISSING NODES ===")
        
        # Also try symlinking as backup
        print("=== SYMLINKING CUSTOM NODES AS BACKUP ===")
        print("Contents of /cn directory:")
        for item in Path("/cn").iterdir():
            print(f"  {item.name} ({'dir' if item.is_dir() else 'file'})")
        
        for d in Path("/cn").iterdir():
            if d.is_dir():
                target = Path(f"/root/comfy/ComfyUI/custom_nodes/{d.name}")
                if target.exists():
                    print(f"Removing existing: {target}")
                    if target.is_symlink():
                        target.unlink()
                    else:
                        import shutil
                        shutil.rmtree(target)
                print(f"Creating symlink: {d} -> {target}")
                target.symlink_to(d)
                
                # Special handling for VideoHelperSuite
                if d.name == "ComfyUI-VideoHelperSuite":
                    print(f"VideoHelperSuite symlinked. Checking for VHS_VideoCombine...")
                    vhs_file = d / "VHS_VideoCombine.py"
                    if vhs_file.exists():
                        print(f"VHS_VideoCombine.py found at {vhs_file}")
                    else:
                        print(f"VHS_VideoCombine.py NOT found at {vhs_file}")
                        print(f"Contents of {d}:")
                        for item in d.iterdir():
                            print(f"  {item.name}")
        
        print("=== END SYMLINKING ===")
        
        # Check what's actually in custom_nodes after symlinking
        print("=== CHECKING CUSTOM_NODES DIRECTORY ===")
        custom_nodes_dir = Path("/root/comfy/ComfyUI/custom_nodes")
        for item in custom_nodes_dir.iterdir():
            print(f"  {item.name} ({'dir' if item.is_dir() else 'file'})")
        print("=== END CHECKING ===")
        
        # Launch ComfyUI in the background with better error handling
        print("=== LAUNCHING COMFYUI ===")
        try:
            process = subprocess.Popen(
                ["comfy", "launch", "--", "--listen", "0.0.0.0", "--port", str(self.port)],
                stdout=None,  # inherit container stdout for streaming logs
                stderr=None,
                text=False
            )
            
            # Wait a bit and check if process is still running
            time.sleep(5)
            if process.poll() is not None:
                print("ComfyUI process died immediately!")
                raise RuntimeError("ComfyUI failed to start")
            else:
                print("ComfyUI process is running")
            
            # Wait for server to be ready
            self.poll_server_health()
            
        except Exception as e:
            print(f"Failed to launch ComfyUI: {e}")
            raise

    @modal.method()
    def infer(self, workflow_path: str = "/root/workflow_api.json"):
        self.poll_server_health()
        cmd = f"comfy run --workflow {workflow_path} --wait --timeout 1200 --verbose"
        proc = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if proc.stdout:
            print(proc.stdout)
        if proc.stderr:
            print(proc.stderr)
        if proc.returncode != 0:
            raise RuntimeError(
                f"Comfy run failed (exit {proc.returncode}).\n\nSTDOUT:\n{proc.stdout}\n\nSTDERR:\n{proc.stderr}"
            )

        output_dir = "/root/comfy/ComfyUI/output"

        workflow = json.loads(Path(workflow_path).read_text())
        file_prefix = None
        for node in workflow.values():
            if node.get("class_type") == "SaveImage":
                file_prefix = node.get("inputs", {}).get("filename_prefix")
                break
        if file_prefix is None:
            for node in workflow.values():
                if node.get("class_type") == "VHS_VideoCombine":
                    file_prefix = node.get("inputs", {}).get("filename_prefix")
                    break

        # return first file matching prefix; otherwise newest file
        outputs = sorted(Path(output_dir).glob(f"{file_prefix}*")) if file_prefix else []
        if outputs:
            return outputs[0].read_bytes()
        newest = max(Path(output_dir).glob("*"), key=lambda p: p.stat().st_mtime, default=None)
        if newest:
            return newest.read_bytes()
        raise FileNotFoundError("No outputs produced by workflow")

    @modal.fastapi_endpoint(method="POST")
    def api(self, item: Dict):
        from fastapi import Response
        try:
            # If a workflow is provided, run it (supports video workflows). Otherwise, run the default image workflow.
            workflow_path = item.get("workflow_path")
            workflow_json = item.get("workflow_json")

            if workflow_path is not None or workflow_json is not None:
                if workflow_path is None:
                    client_id = uuid.uuid4().hex
                    workflow_path = f"{client_id}.json"
                    json.dump(workflow_json, Path(workflow_path).open("w"))

                data = json.loads(Path(workflow_path).read_text())

                # Optional substitutions and speed settings
                prompt = item.get("prompt", "")
                negative = item.get("negative", "")
                width = int(item.get("width", 384))
                height = int(item.get("height", 216))
                length = int(item.get("length", 16))
                seed = int(item.get("seed", 0))
                fast_mode = bool(item.get("fast_mode", True))

                for node_id, node in data.items():
                    cls = node.get("class_type")
                    inputs = node.get("inputs", {})

                    if cls in ("CLIPTextEncode",) and "text" in inputs:
                        if inputs["text"] == "{PROMPT}":
                            inputs["text"] = prompt
                        if inputs["text"] == "{NEGATIVE}":
                            inputs["text"] = negative

                    if cls == "EmptyHunyuanLatentVideo":
                        if inputs.get("width") == "{WIDTH}":
                            inputs["width"] = width
                        if inputs.get("height") == "{HEIGHT}":
                            inputs["height"] = height
                        if inputs.get("length") == "{LENGTH}":
                            inputs["length"] = length

                    if cls == "KSamplerAdvanced" and fast_mode:
                        if "sampler_name" in inputs:
                            inputs["sampler_name"] = "euler"
                        if "scheduler" in inputs:
                            inputs["scheduler"] = "simple"

                    if cls == "PrimitiveInt" and node.get("_meta", {}).get("title", "").lower().startswith("steps") and fast_mode:
                        inputs["value"] = 12

                    if cls == "VHS_VideoCombine" and fast_mode:
                        inputs["frame_rate"] = 12
                        inputs["crf"] = 28

                    if cls == "ImageScaleBy" and fast_mode:
                        inputs["scale_by"] = 1.0

                client_id = uuid.uuid4().hex
                for node in data.values():
                    if node.get("class_type") in ("SaveImage", "VHS_VideoCombine"):
                        if "inputs" in node and "filename_prefix" in node["inputs"]:
                            node["inputs"]["filename_prefix"] = client_id

                tmp_path = f"{client_id}.json"
                json.dump(data, Path(tmp_path).open("w"))

                try:
                    result_bytes = self.infer.local(tmp_path)
                except Exception as e:
                    return Response(str(e), media_type="text/plain", status_code=500)

                media_type = "application/octet-stream"
                output_dir = Path("/root/comfy/ComfyUI/output")
                produced = sorted(output_dir.glob(f"{client_id}*"))
                if produced:
                    name = produced[0].name
                    if name.endswith(".mp4"):
                        media_type = "video/mp4"
                    elif name.endswith(".png") or name.endswith(".jpg") or name.endswith(".jpeg"):
                        media_type = "image/png"

                return Response(result_bytes, media_type=media_type)

            # Default: simple image workflow with prompt
            workflow_file = Path(__file__).parent / "workflow_api.json"
            if not workflow_file.exists():
                return Response(
                    "workflow_api.json not found. Export one via ComfyUI (Export API) and place next to image.py",
                    media_type="text/plain",
                    status_code=500,
                )

            workflow_data = json.loads(workflow_file.read_text())
            workflow_data["6"]["inputs"]["text"] = item["prompt"]
            client_id = uuid.uuid4().hex
            workflow_data["9"]["inputs"]["filename_prefix"] = client_id
            new_workflow_file = f"{client_id}.json"
            json.dump(workflow_data, Path(new_workflow_file).open("w"))
            try:
                img_bytes = self.infer.local(new_workflow_file)
            except Exception as e:
                return Response(str(e), media_type="text/plain", status_code=500)
            return Response(img_bytes, media_type="image/jpeg")
        except Exception as e:
            import traceback
            return Response(
                f"Unhandled server error:\n{e}\n\n{traceback.format_exc()}",
                media_type="text/plain",
                status_code=500,
            )

    def diagnose(self, item: Dict):
        from fastapi import Response
        import json as pyjson
        import urllib.request
        try:
            # Load workflow
            workflow_path = item.get("workflow_path")
            workflow_json = item.get("workflow_json")
            if not workflow_path and not workflow_json:
                return Response(pyjson.dumps({"error": "Provide workflow_path or workflow_json"}), media_type="application/json", status_code=400)
            if workflow_path:
                data = pyjson.loads(Path(workflow_path).read_text())
            else:
                data = workflow_json

            # Collect class types used in workflow
            used_classes = sorted({node.get("class_type") for node in data.values() if isinstance(node, dict)})

            # Query ComfyUI server for available nodes
            self.poll_server_health()
            req = urllib.request.Request(f"http://127.0.0.1:{self.port}/object_info")
            with urllib.request.urlopen(req, timeout=10) as resp:
                info = pyjson.loads(resp.read().decode("utf-8"))

            available = set(info.get("nodes", {}).keys()) if isinstance(info, dict) else set()
            missing = sorted([c for c in used_classes if c not in available])

            report = {
                "used_classes": used_classes,
                "missing_classes": missing,
                "available_count": len(available),
            }
            return Response(pyjson.dumps(report, ensure_ascii=False, indent=2), media_type="application/json")
        except Exception as e:
            import traceback
            return Response(
                pyjson.dumps({"error": str(e), "trace": traceback.format_exc()}),
                media_type="application/json",
                status_code=500,
            )

    def poll_server_health(self) -> Dict:
        import socket
        import time
        from urllib import request, error

        deadline = time.time() + 60
        last_err = None
        while time.time() < deadline:
            try:
                req = request.Request(f"http://127.0.0.1:{self.port}/system_stats")
                request.urlopen(req, timeout=5)
                print("ComfyUI server is healthy")
                return {}
            except (socket.timeout, error.URLError, ConnectionRefusedError) as e:
                last_err = e
                print(f"Health check retry in 2s: {e}")
                time.sleep(2)
        modal.experimental.stop_fetching_inputs()
        raise Exception(f"ComfyUI server is not healthy after retries: {last_err}")
