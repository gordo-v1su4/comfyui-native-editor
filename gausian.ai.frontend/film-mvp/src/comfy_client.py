# src/comfy_client.py
import os, time, json, pathlib, requests
from typing import Any, Dict, Optional

# Try to load dotenv, but don't fail if it's not available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # If dotenv is not available, just continue without it
    pass
COMFY_HOST = os.getenv("COMFY_HOST", "127.0.0.1")
COMFY_PORT = int(os.getenv("COMFY_PORT", "8188"))
BASE = f"http://{COMFY_HOST}:{COMFY_PORT}"

def _url(path: str) -> str:
    return f"{BASE}{path}"

def queue_prompt(workflow: Dict[str, Any]) -> str:
    """POST a workflow JSON to /prompt. Returns prompt_id."""
    r = requests.post(_url("/prompt"), json={"prompt": workflow})
    r.raise_for_status()
    d = r.json()
    # new Comfy returns {"prompt_id": "..."}; old may return {'node_errors':..., 'number':...}
    return d.get("prompt_id") or d.get("number") or d.get("prompt_id", "")

def get_history(prompt_id: str) -> Dict[str, Any]:
    r = requests.get(_url(f"/history/{prompt_id}"))
    if r.status_code == 404:
        return {}
    r.raise_for_status()
    return r.json()

def wait_for_result(prompt_id: str, poll=1.0, timeout=300) -> Dict[str, Any]:
    """Poll /history until outputs available or timeout."""
    t0 = time.time()
    while True:
        hist = get_history(prompt_id)
        if hist and prompt_id in hist and hist[prompt_id].get("outputs"):
            return hist[prompt_id]
        if time.time() - t0 > timeout:
            raise TimeoutError(f"ComfyUI job {prompt_id} timed out")
        time.sleep(poll)

def download_output(filename: str, dest: pathlib.Path) -> pathlib.Path:
    """GET /view?filename=... and save to dest file (keeps extension)."""
    url = _url(f"/view?filename={filename}")
    r = requests.get(url, stream=True)
    r.raise_for_status()
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as f:
        for chunk in r.iter_content(chunk_size=1<<20):
            if chunk: f.write(chunk)
    return dest

def substitute_placeholders(workflow: Dict[str, Any],
                            prompt: str,
                            negative: Optional[str]=None,
                            seed: Optional[int]=None,
                            ref_image: Optional[str]=None) -> Dict[str, Any]:
    """
    Replace any string fields equal to placeholders: {PROMPT}, {NEGATIVE}, {SEED}, {REF_IMAGE}.
    """
    def _rec(v):
        if isinstance(v, dict):
            return {k: _rec(val) for k, val in v.items()}
        if isinstance(v, list):
            return [_rec(x) for x in v]
        if isinstance(v, str):
            if v == "{PROMPT}": return prompt
            if v == "{NEGATIVE}": return negative or ""
            if v == "{REF_IMAGE}": return ref_image or ""
            if v == "{SEED}" and seed is not None: return seed
            return v
        if isinstance(v, (int, float)) and seed is not None:
            # If you want to force all "seed" numeric fields, uncomment next 2 lines:
            # return seed
            return v
        return v
    return _rec(workflow)
