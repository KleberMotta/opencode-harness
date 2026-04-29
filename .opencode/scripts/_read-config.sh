#!/bin/sh
# _read-config.sh — shared helper to read .opencode/juninho-config.json values.
#
# Usage (source this file, then call functions):
#   . "$(dirname "$0")/_read-config.sh"
#   if config_get_workflow_bool implement.skipLintOnPrecommit false; then ...
#   value="$(config_get_workflow_string implement.preCommitScope related)"
#
# Resolution order:
#   1. $JUNINHO_CONFIG_PATH if set
#   2. $WORKSPACE_ROOT/.opencode/juninho-config.json (preferred)
#   3. $TARGET_REPO_ROOT/.opencode/juninho-config.json (project override, fallback)
#
# Requires WORKSPACE_ROOT and/or TARGET_REPO_ROOT exported (by _resolve-repo.sh).
#
# Missing config or missing key → returns the provided default.
# Functions are POSIX-safe and use node/bun/python3 fallback for JSON parsing.

__config_resolve_path() {
  if [ -n "${JUNINHO_CONFIG_PATH:-}" ] && [ -f "$JUNINHO_CONFIG_PATH" ]; then
    printf '%s' "$JUNINHO_CONFIG_PATH"
    return 0
  fi
  if [ -n "${WORKSPACE_ROOT:-}" ] && [ -f "$WORKSPACE_ROOT/.opencode/juninho-config.json" ]; then
    printf '%s' "$WORKSPACE_ROOT/.opencode/juninho-config.json"
    return 0
  fi
  if [ -n "${TARGET_REPO_ROOT:-}" ] && [ -f "$TARGET_REPO_ROOT/.opencode/juninho-config.json" ]; then
    printf '%s' "$TARGET_REPO_ROOT/.opencode/juninho-config.json"
    return 0
  fi
  return 1
}

__config_read_path() {
  # Args: <config-path> <dotted.workflow.path> <default-value>
  __cfg_path="$1"
  __cfg_key="$2"
  __cfg_default="$3"

  if command -v node >/dev/null 2>&1; then
    node -e '
      const [path, key, def] = process.argv.slice(1);
      try {
        const cfg = JSON.parse(require("fs").readFileSync(path, "utf-8"));
        const parts = ("workflow." + key).split(".");
        let cur = cfg;
        for (const p of parts) {
          if (cur == null || typeof cur !== "object") { process.stdout.write(def); process.exit(0); }
          cur = cur[p];
        }
        if (cur === undefined || cur === null) { process.stdout.write(def); process.exit(0); }
        process.stdout.write(String(cur));
      } catch { process.stdout.write(def); }
    ' "$__cfg_path" "$__cfg_key" "$__cfg_default"
  elif command -v bun >/dev/null 2>&1; then
    bun -e '
      const [path, key, def] = process.argv.slice(2);
      try {
        const cfg = JSON.parse(require("fs").readFileSync(path, "utf-8"));
        const parts = ("workflow." + key).split(".");
        let cur = cfg;
        for (const p of parts) {
          if (cur == null || typeof cur !== "object") { process.stdout.write(def); process.exit(0); }
          cur = cur[p];
        }
        if (cur === undefined || cur === null) { process.stdout.write(def); process.exit(0); }
        process.stdout.write(String(cur));
      } catch { process.stdout.write(def); }
    ' "$__cfg_path" "$__cfg_key" "$__cfg_default"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json, sys
path, key, default = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    cfg = json.load(open(path))
    cur = cfg
    for p in ("workflow." + key).split("."):
        if not isinstance(cur, dict):
            sys.stdout.write(default); sys.exit(0)
        cur = cur.get(p)
        if cur is None:
            sys.stdout.write(default); sys.exit(0)
    sys.stdout.write(str(cur))
except Exception:
    sys.stdout.write(default)
' "$__cfg_path" "$__cfg_key" "$__cfg_default"
  else
    printf '%s' "$__cfg_default"
  fi
}

# config_get_workflow_string <dotted.path-under-workflow> <default>
# Echoes the string value (or default).
config_get_workflow_string() {
  __cfg_p="$(__config_resolve_path)" || { printf '%s' "$2"; return 0; }
  __config_read_path "$__cfg_p" "$1" "$2"
}

# config_get_workflow_bool <dotted.path-under-workflow> <default-bool>
# Returns exit 0 if value is truthy ("true"), exit 1 if falsy. <default-bool>
# must be "true" or "false".
config_get_workflow_bool() {
  __val="$(config_get_workflow_string "$1" "$2")"
  case "$__val" in
    true|True|TRUE|1|yes) return 0 ;;
    *) return 1 ;;
  esac
}
