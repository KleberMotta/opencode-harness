#!/bin/sh
# .opencode/scripts/_resolve-repo.sh
# Shared helper: resolve target repo root and refuse to operate on workspace git.
#
# Contract:
#   - Reads $TARGET_REPO_ROOT (env) or $REPO_ARG (positional, if caller sets it).
#   - Falls back to git rev-parse on CWD only when CWD is NOT the workspace root.
#   - Refuses (exit 2) to operate on workspace git unless $ALLOW_WORKSPACE_GIT=1.
#   - Exports $TARGET_REPO_ROOT and cd's to it.
#
# Usage in a script:
#   . "$(dirname "$0")/_resolve-repo.sh"
#   # after this point, $TARGET_REPO_ROOT is set and CWD is the target repo.

# Workspace root = parent dir of .opencode/scripts/ (this file lives in scripts/)
__resolve_repo_self="${BASH_SOURCE:-$0}"
__resolve_repo_dir="$(CDPATH= cd -- "$(dirname -- "$__resolve_repo_self")" && pwd)"
WORKSPACE_ROOT="$(CDPATH= cd -- "$__resolve_repo_dir/../.." && pwd)"
export WORKSPACE_ROOT

# Resolution priority:
#   1. $TARGET_REPO_ROOT (explicit env)
#   2. $REPO_ARG (positional from caller)
#   3. git rev-parse from CWD
#   4. CWD itself
__candidate="${TARGET_REPO_ROOT:-${REPO_ARG:-}}"
if [ -z "$__candidate" ]; then
  __candidate="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

# Normalize
TARGET_REPO_ROOT="$(CDPATH= cd -- "$__candidate" 2>/dev/null && pwd || printf '%s' "$__candidate")"

# Guard: refuse to run on workspace git unless explicitly allowed.
if [ "$TARGET_REPO_ROOT" = "$WORKSPACE_ROOT" ] && [ "${ALLOW_WORKSPACE_GIT:-}" != "1" ]; then
  cat >&2 <<EOF
[juninho:resolve-repo] Refusing to operate on workspace git ($WORKSPACE_ROOT).
  Set TARGET_REPO_ROOT=/path/to/project (or pass --repo / cd into the project)
  before invoking this script. To intentionally target the workspace itself,
  set ALLOW_WORKSPACE_GIT=1.
EOF
  exit 2
fi

if [ ! -d "$TARGET_REPO_ROOT" ]; then
  echo "[juninho:resolve-repo] Resolved target does not exist: $TARGET_REPO_ROOT" >&2
  exit 2
fi

export TARGET_REPO_ROOT
cd "$TARGET_REPO_ROOT"

unset __candidate __resolve_repo_self __resolve_repo_dir
