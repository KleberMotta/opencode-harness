#!/bin/sh
set -e

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

JUNINHO_STAGED_FILES="$(git diff --cached --name-only --diff-filter=ACMR)"
export JUNINHO_STAGED_FILES

if [ -z "$JUNINHO_STAGED_FILES" ]; then
  echo "[juninho:pre-commit] No staged files. Skipping."
  exit 0
fi

echo "[juninho:pre-commit] Running structure lint..."
"$ROOT_DIR/.opencode/scripts/lint-structure.sh"

echo "[juninho:pre-commit] Running related tests..."
"$ROOT_DIR/.opencode/scripts/test-related.sh"

echo "[juninho:pre-commit] Local checks passed"
