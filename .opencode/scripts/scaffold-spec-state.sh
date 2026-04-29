#!/bin/sh
set -e

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/_resolve-repo.sh"
ROOT_DIR="$TARGET_REPO_ROOT"

FEATURE_SLUG="${1:-}"

[ -n "$FEATURE_SLUG" ] || {
  echo "Usage: $0 <feature-slug>" >&2
  exit 1
}

STATE_DIR="$ROOT_DIR/docs/specs/$FEATURE_SLUG/state"
# Templates always live in the workspace harness, never inside the target repo.
TEMPLATE_PATH="$WORKSPACE_ROOT/.opencode/templates/spec-state-readme.md"

mkdir -p "$STATE_DIR/tasks" "$STATE_DIR/sessions"

if [ -f "$TEMPLATE_PATH" ] && [ ! -f "$STATE_DIR/README.md" ]; then
  sed "s/{feature-slug}/$FEATURE_SLUG/g" "$TEMPLATE_PATH" > "$STATE_DIR/README.md"
fi
