# api/Dockerfile
FROM node:20-slim

# OS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates python3 python3-venv git curl \
 && rm -rf /var/lib/apt/lists/*

# Modal CLI in a venv (keeps base Python clean)
RUN python3 -m venv /opt/py \
 && /opt/py/bin/pip install --no-cache-dir --upgrade pip modal \
 && ln -s /opt/py/bin/modal /usr/local/bin/modal

WORKDIR /app

COPY comfy-modal /app/comfy-modal

# 1) Install Node deps first for better cache
COPY package*.json ./
# Prefer reproducible installs; fall back if lock is out-of-sync
RUN (npm ci --omit=dev) || (npm install --omit=dev)

# 2) Copy the rest of the backend (includes comfy-modal/)
COPY . .

# 3) Ensure the modal token helper is executable and reachable
RUN chmod +x /app/ensure-modal-token.sh \
 && cp /app/ensure-modal-token.sh /usr/local/bin/ensure-modal-token.sh

EXPOSE 3001

# Single CMD: run the token setup then start server
CMD ["sh","-lc","/usr/local/bin/ensure-modal-token.sh && node server.js"]