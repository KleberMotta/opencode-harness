#!/bin/sh
set -e

INPUT_PATH="${1:-}"
[ -n "$INPUT_PATH" ] || {
  echo "[juninho:activate-plan] Usage: .opencode/scripts/activate-plan.sh <repo-path|plan-path>" >&2
  exit 1
}

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
WORKSPACE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"

if [ -d "$INPUT_PATH" ]; then
  TARGET_REPO_ROOT="$INPUT_PATH"
  PLAN_DIR="$TARGET_REPO_ROOT/docs/specs"
  [ -d "$PLAN_DIR" ] || {
    echo "[juninho:activate-plan] Missing docs/specs under $TARGET_REPO_ROOT" >&2
    exit 1
  }
  PLAN_PATHS=$(find "$PLAN_DIR" -mindepth 2 -maxdepth 2 -name plan.md 2>/dev/null || true)
  PLAN_COUNT=$(printf '%s
' "$PLAN_PATHS" | sed '/^$/d' | wc -l | tr -d ' ')
  if [ "$PLAN_COUNT" -eq 0 ]; then
    echo "[juninho:activate-plan] No docs/specs/*/plan.md found under $TARGET_REPO_ROOT" >&2
    exit 1
  fi
  if [ "$PLAN_COUNT" -gt 1 ]; then
    echo "[juninho:activate-plan] Multiple plans found. Pass the exact plan.md path:" >&2
    printf '%s
' "$PLAN_PATHS" >&2
    exit 1
  fi
  PLAN_FILE=$(printf '%s
' "$PLAN_PATHS" | sed '/^$/d')
else
  PLAN_FILE="$INPUT_PATH"
  [ -f "$PLAN_FILE" ] || {
    echo "[juninho:activate-plan] Missing plan file: $PLAN_FILE" >&2
    exit 1
  }
  TARGET_REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$PLAN_FILE")/../../.." && pwd)"
fi

[ -f "$PLAN_FILE" ] || {
  echo "[juninho:activate-plan] Missing plan file: $PLAN_FILE" >&2
  exit 1
}

FEATURE_SLUG="$(basename "$(dirname "$PLAN_FILE")")"
REL_PLAN_PATH="docs/specs/$FEATURE_SLUG/plan.md"
SPEC_FILE="$TARGET_REPO_ROOT/docs/specs/$FEATURE_SLUG/spec.md"
CONTEXT_FILE="$TARGET_REPO_ROOT/docs/specs/$FEATURE_SLUG/CONTEXT.md"
PROJECT_LABEL="$(basename "$TARGET_REPO_ROOT")"

REPO_STATE_DIR="$TARGET_REPO_ROOT/.opencode/state"
WORKSPACE_STATE_DIR="$WORKSPACE_ROOT/.opencode/state"
mkdir -p "$REPO_STATE_DIR" "$WORKSPACE_STATE_DIR"

PAYLOAD_FILE="$WORKSPACE_STATE_DIR/.activate-plan.tmp.json"
{
  printf '{
'
  printf '  "slug": "%s",
' "$FEATURE_SLUG"
  printf '  "writeTargets": [
'
  printf '    {
'
  printf '      "project": "%s",
' "$PROJECT_LABEL"
  printf '      "targetRepoRoot": "%s",
' "$TARGET_REPO_ROOT"
  printf '      "planPath": "%s"' "$REL_PLAN_PATH"
  if [ -f "$SPEC_FILE" ]; then
    printf ',
      "specPath": "docs/specs/%s/spec.md"' "$FEATURE_SLUG"
  fi
  if [ -f "$CONTEXT_FILE" ]; then
    printf ',
      "contextPath": "docs/specs/%s/CONTEXT.md"' "$FEATURE_SLUG"
  fi
  printf '
    }
'
  printf '  ],
'
  printf '  "referenceProjects": []
'
  printf '}
'
} > "$PAYLOAD_FILE"

cp "$PAYLOAD_FILE" "$REPO_STATE_DIR/active-plan.json"
cp "$PAYLOAD_FILE" "$WORKSPACE_STATE_DIR/active-plan.json"
rm -f "$PAYLOAD_FILE"

echo "[juninho:activate-plan] Active plan set to $REL_PLAN_PATH"
echo "[juninho:activate-plan] Repo root: $TARGET_REPO_ROOT"
