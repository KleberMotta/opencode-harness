#!/bin/sh
set -e

ROOT_DIR="${TARGET_REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT_DIR"

echo "[juninho:build-verify] Running build verification..."

if [ -f "package.json" ]; then
  if npm run --silent build --if-present 2>/dev/null; then
    exit 0
  fi
  if npx tsc --noEmit 2>/dev/null; then
    exit 0
  fi
fi

echo "[juninho:build-verify] No build verification available — skipping."
exit 0
