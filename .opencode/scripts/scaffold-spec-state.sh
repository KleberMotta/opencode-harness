#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
WORKSPACE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"

FEATURE_SLUG="${1:-}"

[ -n "$FEATURE_SLUG" ] || {
  echo "Usage: $0 <feature-slug>" >&2
  exit 1
}

# State directories live in the workspace root, not in target repos
STATE_DIR="$WORKSPACE_ROOT/docs/specs/$FEATURE_SLUG/state"
# Templates always live in the workspace harness
TEMPLATE_PATH="$WORKSPACE_ROOT/.opencode/templates/spec-state-readme.md"

mkdir -p "$STATE_DIR/tasks" "$STATE_DIR/sessions"

if [ -f "$TEMPLATE_PATH" ] && [ ! -f "$STATE_DIR/README.md" ]; then
  sed "s/{feature-slug}/$FEATURE_SLUG/g" "$TEMPLATE_PATH" > "$STATE_DIR/README.md"
fi
