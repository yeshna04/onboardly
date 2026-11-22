#!/usr/bin/env bash
# Render build step: install Python deps, then build the React app into frontend/dist
# (Flask serves it from there). Run from the repository root.
set -euo pipefail

echo "==> Python $(python --version 2>&1 | cut -d' ' -f2)"
pip install --upgrade pip
pip install -r backend/requirements.txt

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not available in this build image – the React app cannot be built." >&2
  exit 1
fi
echo "==> Node $(node --version)"
cd frontend
npm ci --include=dev
npm run build
echo "==> Build finished: frontend/dist ready"
