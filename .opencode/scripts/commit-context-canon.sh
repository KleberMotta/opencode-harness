#!/bin/sh
set -e

WORKSPACE_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
CONTEXT_ROOT="${1:-}"
MESSAGE="${2:-}"
BASELINE_PATH=""

[ -n "$CONTEXT_ROOT" ] || {
  echo "[juninho:canon] Missing context root." >&2
  exit 1
}
[ -n "$MESSAGE" ] || {
  echo "[juninho:canon] Missing context commit message." >&2
  exit 1
}

# --baseline is OPTIONAL. The independent canon reviewer commits without one; when
# a baseline IS supplied, the pre-commit state (context repo HEAD/status and that
# only files under the context root are dirty) is still validated.
if [ "${3:-}" = "--baseline" ]; then
  BASELINE_PATH="${4:-}"
  [ -n "$BASELINE_PATH" ] && [ -f "$BASELINE_PATH" ] || {
    echo "[juninho:canon] --baseline was given but the file is missing: $BASELINE_PATH" >&2
    exit 1
  }
  if command -v node >/dev/null 2>&1; then
    JS_RUNTIME="node"
  elif command -v bun >/dev/null 2>&1; then
    JS_RUNTIME="bun"
  else
    echo "[juninho:canon] Missing node or bun runtime for --baseline validation." >&2
    exit 1
  fi
fi

case "$CONTEXT_ROOT" in
  "$WORKSPACE_ROOT"/contexts/*) ;;
  *)
    echo "[juninho:canon] Context root must be a .context directory under $WORKSPACE_ROOT/contexts/." >&2
    exit 1
    ;;
esac

[ "$(basename "$CONTEXT_ROOT")" = ".context" ] || {
  echo "[juninho:canon] Context root must end in .context: $CONTEXT_ROOT" >&2
  exit 1
}

CONTEXT_GIT_ROOT="$(git -C "$CONTEXT_ROOT" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "[juninho:canon] Context root is not inside a Git repository: $CONTEXT_ROOT" >&2
  exit 1
}

case "$CONTEXT_GIT_ROOT" in
  "$WORKSPACE_ROOT"/contexts) ;;
  *)
    echo "[juninho:canon] Context Git root must be $WORKSPACE_ROOT/contexts." >&2
    exit 1
    ;;
esac

if [ -n "$BASELINE_PATH" ]; then
  BASELINE_PATH="$BASELINE_PATH" CONTEXT_ROOT="$CONTEXT_ROOT" CONTEXT_GIT_ROOT="$CONTEXT_GIT_ROOT" "$JS_RUNTIME" - <<'NODE'
const fs = require("fs")
const path = require("path")
const cp = require("child_process")
const baseline = JSON.parse(fs.readFileSync(process.env.BASELINE_PATH, "utf8"))
const realContext = fs.realpathSync(process.env.CONTEXT_ROOT)
const realGit = fs.realpathSync(process.env.CONTEXT_GIT_ROOT)
if (baseline.schemaVersion !== 1 || baseline.contextRoot !== realContext || baseline.gitRoot !== realGit) process.exit(1)
const head = cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: realGit, encoding: "utf8" }).trim()
if (head !== baseline.head || baseline.status !== "") process.exit(1)
const changed = cp.execFileSync("git", ["status", "--porcelain=v1", "-z"], { cwd: realGit, encoding: "utf8" })
  .split("\0").filter(Boolean).map((entry) => entry.slice(3))
for (const file of changed) {
  const absolute = path.resolve(realGit, file)
  if (!(absolute === realContext || absolute.startsWith(realContext + path.sep))) process.exit(1)
}
NODE
fi

if git -C "$CONTEXT_GIT_ROOT" diff --quiet -- "$CONTEXT_ROOT" && git -C "$CONTEXT_GIT_ROOT" diff --cached --quiet -- "$CONTEXT_ROOT"; then
  echo "[juninho:canon] No context changes to commit." >&2
  exit 1
fi

git -C "$CONTEXT_GIT_ROOT" add -- "$CONTEXT_ROOT"
git -C "$CONTEXT_GIT_ROOT" commit -m "$MESSAGE"
git -C "$CONTEXT_GIT_ROOT" rev-parse HEAD
