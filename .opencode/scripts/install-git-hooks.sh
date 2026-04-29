#!/bin/sh
set -e

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HOOKS_DIR="$ROOT_DIR/.git/hooks"
SOURCE_HOOK="$ROOT_DIR/.opencode/hooks/pre-commit"
TARGET_HOOK="$HOOKS_DIR/pre-commit"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "[juninho:install-hooks] Missing git hooks directory: $HOOKS_DIR" >&2
  exit 1
fi

if [ ! -f "$SOURCE_HOOK" ]; then
  echo "[juninho:install-hooks] Missing source hook: $SOURCE_HOOK" >&2
  exit 1
fi

chmod +x "$SOURCE_HOOK"
ln -sf ../../.opencode/hooks/pre-commit "$TARGET_HOOK"
chmod +x "$TARGET_HOOK"

echo "[juninho:install-hooks] Installed pre-commit hook at $TARGET_HOOK"
