#!/bin/sh
set -e

INPUT_PATH="${1:-}"
[ -n "$INPUT_PATH" ] || {
  echo "[juninho:activate-plan] Usage: .opencode/scripts/activate-plan.sh <repo-path|plan-path>" >&2
  exit 1
}

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
WORKSPACE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"

# Spec artifacts now live in the workspace root: $WORKSPACE_ROOT/docs/specs/{slug}/
SPECS_ROOT="$WORKSPACE_ROOT/docs/specs"

if [ -d "$INPUT_PATH" ]; then
  # Input is a repo path — look for plans in the WORKSPACE specs root
  TARGET_REPO_ROOT="$INPUT_PATH"
  [ -d "$SPECS_ROOT" ] || {
    echo "[juninho:activate-plan] Missing docs/specs under workspace $WORKSPACE_ROOT" >&2
    exit 1
  }
  PLAN_PATHS=$(find "$SPECS_ROOT" -mindepth 2 -maxdepth 2 -name plan.md 2>/dev/null || true)
  PLAN_COUNT=$(printf '%s\n' "$PLAN_PATHS" | sed '/^$/d' | wc -l | tr -d ' ')
  if [ "$PLAN_COUNT" -eq 0 ]; then
    echo "[juninho:activate-plan] No docs/specs/*/plan.md found under workspace $WORKSPACE_ROOT" >&2
    exit 1
  fi
  if [ "$PLAN_COUNT" -gt 1 ]; then
    echo "[juninho:activate-plan] Multiple plans found. Pass the exact plan.md path:" >&2
    printf '%s\n' "$PLAN_PATHS" >&2
    exit 1
  fi
  PLAN_FILE=$(printf '%s\n' "$PLAN_PATHS" | sed '/^$/d')
else
  # Input is a direct plan.md path
  PLAN_FILE="$INPUT_PATH"
  [ -f "$PLAN_FILE" ] || {
    echo "[juninho:activate-plan] Missing plan file: $PLAN_FILE" >&2
    exit 1
  }
  # Derive target repo root — if plan is inside workspace/docs/specs/, we need it from context
  # Default to workspace root; user can pass --project to specify target repo
  TARGET_REPO_ROOT="$WORKSPACE_ROOT"
fi

[ -f "$PLAN_FILE" ] || {
  echo "[juninho:activate-plan] Missing plan file: $PLAN_FILE" >&2
  exit 1
}

FEATURE_SLUG="$(basename "$(dirname "$PLAN_FILE")")"
REL_PLAN_PATH="docs/specs/$FEATURE_SLUG/plan.md"
SPEC_FILE="$SPECS_ROOT/$FEATURE_SLUG/spec.md"
CONTEXT_FILE="$SPECS_ROOT/$FEATURE_SLUG/CONTEXT.md"
PROJECT_LABEL="$(basename "$TARGET_REPO_ROOT")"

WORKSPACE_STATE_DIR="$WORKSPACE_ROOT/.opencode/state"
mkdir -p "$WORKSPACE_STATE_DIR"

# New simplified active-plan.json: centralized spec paths relative to workspace
PAYLOAD_FILE="$WORKSPACE_STATE_DIR/.activate-plan.tmp.json"
{
  printf '{\n'
  printf '  "slug": "%s",\n' "$FEATURE_SLUG"
  printf '  "planPath": "%s"' "$REL_PLAN_PATH"
  if [ -f "$SPEC_FILE" ]; then
    printf ',\n  "specPath": "docs/specs/%s/spec.md"' "$FEATURE_SLUG"
  fi
  if [ -f "$CONTEXT_FILE" ]; then
    printf ',\n  "contextPath": "docs/specs/%s/CONTEXT.md"' "$FEATURE_SLUG"
  fi
  printf ',\n  "writeTargets": [\n'
  printf '    {\n'
  printf '      "project": "%s",\n' "$PROJECT_LABEL"
  printf '      "targetRepoRoot": "%s"\n' "$TARGET_REPO_ROOT"
  printf '    }\n'
  printf '  ],\n'
  printf '  "referenceProjects": []\n'
  printf '}\n'
} > "$PAYLOAD_FILE"

cp "$PAYLOAD_FILE" "$WORKSPACE_STATE_DIR/active-plan.json"
rm -f "$PAYLOAD_FILE"

echo "[juninho:activate-plan] Active plan set to $REL_PLAN_PATH"
echo "[juninho:activate-plan] Workspace root: $WORKSPACE_ROOT"
echo "[juninho:activate-plan] Target repo: $TARGET_REPO_ROOT"
