#!/bin/sh
set -e

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FEATURE_SLUG="${1:-}"

[ -n "$FEATURE_SLUG" ] || {
  echo "Usage: $0 <feature-slug>" >&2
  exit 1
}

STATE_DIR="$ROOT_DIR/docs/specs/$FEATURE_SLUG/state"
TEMPLATE_PATH="$ROOT_DIR/.opencode/templates/spec-state-readme.md"

mkdir -p "$STATE_DIR/tasks" "$STATE_DIR/sessions"

if [ -f "$TEMPLATE_PATH" ] && [ ! -f "$STATE_DIR/README.md" ]; then
  sed "s/{feature-slug}/$FEATURE_SLUG/g" "$TEMPLATE_PATH" > "$STATE_DIR/README.md"
fi
