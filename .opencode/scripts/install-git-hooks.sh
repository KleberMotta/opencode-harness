#!/bin/sh
set -e

# Install pre-commit hook into one or more target git repos.
#
# Modes:
#   single (default):  uses TARGET_REPO_ROOT or $1 — installs into one repo.
#   --all-targets:     reads .opencode/state/active-plan.json and installs into
#                      every writeTarget[].targetRepoRoot.
#
# Refuses to install into the workspace git itself unless ALLOW_WORKSPACE_GIT=1.

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
WORKSPACE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
SOURCE_HOOK="$WORKSPACE_ROOT/.opencode/hooks/pre-commit"
ACTIVE_PLAN_JSON="$WORKSPACE_ROOT/.opencode/state/active-plan.json"

if [ ! -f "$SOURCE_HOOK" ]; then
  echo "[juninho:install-hooks] Missing source hook: $SOURCE_HOOK" >&2
  exit 1
fi
chmod +x "$SOURCE_HOOK"

install_into() {
  __target="$1"
  __target_abs="$(CDPATH= cd -- "$__target" 2>/dev/null && pwd || printf '%s' "$__target")"

  if [ "$__target_abs" = "$WORKSPACE_ROOT" ] && [ "${ALLOW_WORKSPACE_GIT:-}" != "1" ]; then
    echo "[juninho:install-hooks] Refusing to install into workspace git: $__target_abs" >&2
    echo "  (set ALLOW_WORKSPACE_GIT=1 to override)" >&2
    return 2
  fi

  if [ ! -d "$__target_abs/.git" ]; then
    echo "[juninho:install-hooks] No .git directory at $__target_abs — skipping" >&2
    return 1
  fi

  __hooks_dir="$__target_abs/.git/hooks"
  __target_hook="$__hooks_dir/pre-commit"
  mkdir -p "$__hooks_dir"
  ln -sf "$SOURCE_HOOK" "$__target_hook"
  chmod +x "$__target_hook"
  echo "[juninho:install-hooks] Installed pre-commit hook at $__target_hook"
  echo "[juninho:install-hooks] -> $SOURCE_HOOK"
}

if [ "${1:-}" = "--all-targets" ]; then
  if [ ! -f "$ACTIVE_PLAN_JSON" ]; then
    echo "[juninho:install-hooks] No active-plan.json at $ACTIVE_PLAN_JSON" >&2
    exit 1
  fi

  # Extract writeTargets[].targetRepoRoot via bun (already in repo) — fallback to python3.
  __targets="$(
    if command -v bun >/dev/null 2>&1; then
      bun -e '
        const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8"));
        const t = (j.writeTargets || []).map(w => w.targetRepoRoot).filter(Boolean);
        process.stdout.write(t.join("\n"));
      ' "$ACTIVE_PLAN_JSON"
    elif command -v python3 >/dev/null 2>&1; then
      python3 -c '
import json, sys
j = json.load(open(sys.argv[1]))
print("\n".join(w.get("targetRepoRoot","") for w in j.get("writeTargets",[]) if w.get("targetRepoRoot")))
' "$ACTIVE_PLAN_JSON"
    else
      echo "" 
    fi
  )"

  if [ -z "$__targets" ]; then
    echo "[juninho:install-hooks] No writeTargets[].targetRepoRoot found in $ACTIVE_PLAN_JSON" >&2
    exit 1
  fi

  __failures=0
  echo "$__targets" | while IFS= read -r __t; do
    [ -z "$__t" ] && continue
    install_into "$__t" || __failures=$((__failures+1))
  done
  exit 0
fi

# Single-target mode (backward compatible).
REPO_ARG="${1:-${REPO_ARG:-}}"
. "$SCRIPT_DIR/_resolve-repo.sh"
install_into "$TARGET_REPO_ROOT"
