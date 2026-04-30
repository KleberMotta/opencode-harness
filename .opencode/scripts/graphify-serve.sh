#!/bin/sh
set -e

# graphify-serve.sh — LEGACY MCP stdio wrapper for Graphify.
#
# NOTE: Graphify does not have a native MCP server. The official integration
# uses the CLI (`graphify query/path/explain`) via the opencode skill/plugin.
# This script is kept DISABLED (enabled: false in opencode.json) for backward
# compatibility with harness scripts that reference it. Do not enable.

usage() {
  cat <<'EOF'
Usage: graphify-serve.sh [--help]

Starts the Graphify MCP server for the active write target's graph.json.
Registered in opencode.json with enabled: false; /j.finish-setup enables it.
If graph.json is missing, runs a no-op MCP stub (stays alive, zero tools).
EOF
}

case "${1:-}" in
  --help|-h)
    usage
    exit 0
    ;;
esac

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
WORKSPACE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
ACTIVE_PLAN_PATH="$WORKSPACE_ROOT/.opencode/state/active-plan.json"
export WORKSPACE_ROOT

# Resolve graph.json path
GRAPH_JSON=""

if [ -f "$ACTIVE_PLAN_PATH" ]; then
  if command -v node >/dev/null 2>&1; then
    TARGET_REPO_ROOT="$(node -e '
const fs = require("fs");
const p = process.argv[1];
try {
  const plan = JSON.parse(fs.readFileSync(p, "utf8"));
  const target = (plan.writeTargets || plan.targets || [])[0];
  process.stdout.write((target && target.targetRepoRoot) || "");
} catch {}
' "$ACTIVE_PLAN_PATH" 2>/dev/null || true)"
  elif command -v python3 >/dev/null 2>&1; then
    TARGET_REPO_ROOT="$(python3 -c '
import json, sys
try:
    plan = json.load(open(sys.argv[1]))
    targets = plan.get("writeTargets") or plan.get("targets") or []
    print((targets[0] or {}).get("targetRepoRoot", "") if targets else "", end="")
except Exception:
    pass
' "$ACTIVE_PLAN_PATH" 2>/dev/null || true)"
  else
    TARGET_REPO_ROOT=""
  fi

  if [ -n "$TARGET_REPO_ROOT" ]; then
    export TARGET_REPO_ROOT
    . "$SCRIPT_DIR/_read-config.sh"
    if config_get_workflow_bool graphify.enabled false; then
      GRAPHIFY_OUTPUT_DIR="$(config_get_workflow_string graphify.outputDir docs/domain/graphify)"
      case "$GRAPHIFY_OUTPUT_DIR" in
        /*) ;;
        *) GRAPHIFY_OUTPUT_DIR="$TARGET_REPO_ROOT/$GRAPHIFY_OUTPUT_DIR" ;;
      esac
      CANDIDATE="$GRAPHIFY_OUTPUT_DIR/graph.json"
      [ -f "$CANDIDATE" ] && GRAPH_JSON="$CANDIDATE"
    fi
  fi
fi

# If graph.json resolved, exec the real MCP server
if [ -n "$GRAPH_JSON" ]; then
  exec python3 -m graphify.serve "$GRAPH_JSON"
fi

# No graph available — run a minimal MCP no-op stub that stays alive.
# This prevents opencode from reporting a process crash.
# The stub responds to initialize and returns empty tools list.
exec python3 -c '
import sys, json

def respond(id, result):
    msg = json.dumps({"jsonrpc": "2.0", "id": id, "result": result})
    sys.stdout.write(f"Content-Length: {len(msg)}\r\n\r\n{msg}")
    sys.stdout.flush()

def read_message():
    headers = {}
    while True:
        line = sys.stdin.readline()
        if not line or line.strip() == "":
            break
        if ":" in line:
            key, val = line.split(":", 1)
            headers[key.strip().lower()] = val.strip()
    length = int(headers.get("content-length", 0))
    if length == 0:
        return None
    body = sys.stdin.read(length)
    return json.loads(body)

while True:
    msg = read_message()
    if msg is None:
        break
    method = msg.get("method", "")
    msg_id = msg.get("id")
    if method == "initialize":
        respond(msg_id, {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "graphify-noop", "version": "0.0.0"}
        })
    elif method == "notifications/initialized":
        pass  # notification, no response
    elif method == "tools/list":
        respond(msg_id, {"tools": []})
    elif method == "shutdown" or method == "exit":
        if msg_id is not None:
            respond(msg_id, None)
        break
    elif msg_id is not None:
        sys.stdout.write("Content-Length: {}\r\n\r\n{}".format(
            len(json.dumps({"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": "Graphify not available"}})),
            json.dumps({"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": "Graphify not available"}})
        ))
        sys.stdout.flush()
'
