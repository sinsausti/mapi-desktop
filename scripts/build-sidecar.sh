#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TARGET_TRIPLE=${1:-aarch64-apple-darwin}
VENV_DIR="$ROOT_DIR/backend/.venv-desktop"
export PYINSTALLER_CONFIG_DIR="$ROOT_DIR/.pyinstaller-cache"
BACKEND_NAME="mapi-backend-$TARGET_TRIPLE"
RESOURCE_DIR="$ROOT_DIR/frontend/src-tauri/resources/mapi-backend"

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install -r "$ROOT_DIR/backend/requirements-desktop.txt" pyinstaller
(
  cd "$ROOT_DIR/backend"
  "$VENV_DIR/bin/pyinstaller" --clean --noconfirm --onedir --name "$BACKEND_NAME" run_desktop.py
)
mkdir -p "$RESOURCE_DIR"
find "$RESOURCE_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
# Tauri's resource bundler walks every entry. Dereference the framework
# symlinks created by PyInstaller so it sees a regular, self-contained tree.
cp -RL "$ROOT_DIR/backend/dist/$BACKEND_NAME/." "$RESOURCE_DIR/"
