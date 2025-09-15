#!/usr/bin/env bash
set -e

if [ -n "$MODAL_TOKEN_ID" ] && [ -n "$MODAL_TOKEN_SECRET" ]; then
  echo "Writing Modal token to /root/.modal-token"
  printf '%s:%s\n' "$MODAL_TOKEN_ID" "$MODAL_TOKEN_SECRET" > /root/.modal-token
  chmod 600 /root/.modal-token
else
  echo "WARNING: MODAL_TOKEN_ID or MODAL_TOKEN_SECRET not set"
fi

# sanity check
if ! command -v modal >/dev/null 2>&1; then
  echo "[ensure-modal-token] ERROR: modal CLI not found in PATH" >&2
  exit 1
fi

# optional: print CLI version to logs once
modal --version || true