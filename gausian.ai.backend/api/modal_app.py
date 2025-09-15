# modal_app.py
import os, time, uuid
import modal
from fastapi import FastAPI, Request, HTTPException

SHARED_SECRET = os.environ.get("MODAL_SHARED_SECRET") or "change-me"

image = modal.Image.debian_slim().pip_install("fastapi", "uvicorn", "pydantic")

app = modal.App(os.environ.get("MODAL_APP_NAME", "gausian-render-mvp"))
fastapi_app = FastAPI(title="Gausian Modal Service")

@fastapi_app.get("/health")
def health():
    return {"ok": True}

@fastapi_app.post("/prompt")
async def submit_prompt(req: Request):
    if req.headers.get("x-shared-secret") != SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")
    body = await req.json()
    # expected: { "workflow": {...}, "metadata": {...} }
    prompt_id = str(uuid.uuid4())
    # TODO: call your ComfyUI graph here; for MVP we simulate
    return {"ok": True, "promptId": prompt_id}

@fastapi_app.get("/history/{prompt_id}")
def history(prompt_id: str):
    # TODO: return real status; MVP simulates "done"
    return {"status": "done", "promptId": prompt_id, "outputs": [{"filename": f"{prompt_id}.mp4"}]}

@fastapi_app.get("/view")
def view():
    # TODO: stream file(s) from storage; MVP is placeholder
    return {"ok": True}

@app.function(image=image)
@modal.asgi_app()
def fastapi_app_container():
    return fastapi_app