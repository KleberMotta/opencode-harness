#!/bin/sh
set -e

usage() {
  cat <<'EOF'
Usage: graphify-build.sh [--repo PATH] [--output DIR] [--incremental] [--status] [--force] [--help]

Builds Graphify output for a target repo into docs/domain/graphify by default.
Graphify is disabled by default; use --force only for manual smoke/builds without changing config.

The graphify CLI always writes to <source>/graphify-out/. This script moves the
outputs to the canonical location after build completes.
EOF
}

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ARG=""
OUTPUT_ARG=""
INCREMENTAL="0"
STATUS_ONLY="0"
FORCE="${GRAPHIFY_FORCE:-0}"
ALLOW_WORKSPACE_GIT="${ALLOW_WORKSPACE_GIT:-1}"
export ALLOW_WORKSPACE_GIT

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      REPO_ARG="${2:-}"
      [ -n "$REPO_ARG" ] || { echo "erro: --repo requer PATH" >&2; exit 2; }
      shift 2
      ;;
    --output)
      OUTPUT_ARG="${2:-}"
      [ -n "$OUTPUT_ARG" ] || { echo "erro: --output requer DIR" >&2; exit 2; }
      shift 2
      ;;
    --incremental)
      INCREMENTAL="1"
      shift
      ;;
    --status)
      STATUS_ONLY="1"
      shift
      ;;
    --force)
      FORCE="1"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "erro: argumento desconhecido: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

. "$SCRIPT_DIR/_resolve-repo.sh"
. "$SCRIPT_DIR/_read-config.sh"

GRAPHIFY_ENABLED="false"
if config_get_workflow_bool graphify.enabled false; then
  GRAPHIFY_ENABLED="true"
fi

GRAPHIFY_OUTPUT_DIR="${OUTPUT_ARG:-$(config_get_workflow_string graphify.outputDir docs/domain/graphify)}"
case "$GRAPHIFY_OUTPUT_DIR" in
  /*) ;;
  *) GRAPHIFY_OUTPUT_DIR="$TARGET_REPO_ROOT/$GRAPHIFY_OUTPUT_DIR" ;;
esac

if [ -z "${GRAPHIFY_MODEL:-}" ]; then
  CONFIG_PATH="$WORKSPACE_ROOT/juninho-config.json"
  if [ ! -f "$CONFIG_PATH" ]; then
    CONFIG_PATH="$WORKSPACE_ROOT/.opencode/juninho-config.json"
  fi
  if command -v node >/dev/null 2>&1; then
    GRAPHIFY_MODEL="$(node -e 'const fs=require("fs"); const p=process.argv[1]; try { const c=JSON.parse(fs.readFileSync(p,"utf8")); process.stdout.write((c.models&&c.models.weak) || c.weak || ""); } catch {}' "$CONFIG_PATH" 2>/dev/null || true)"
  elif command -v bun >/dev/null 2>&1; then
    GRAPHIFY_MODEL="$(bun -e 'const fs=require("fs"); const p=process.argv[2]; try { const c=JSON.parse(fs.readFileSync(p,"utf8")); process.stdout.write((c.models&&c.models.weak) || c.weak || ""); } catch {}' "$CONFIG_PATH" 2>/dev/null || true)"
  elif command -v python3 >/dev/null 2>&1; then
    GRAPHIFY_MODEL="$(python3 -c 'import json,sys; c=json.load(open(sys.argv[1])); print(c.get("models",{}).get("weak","") or c.get("weak",""), end="")' "$CONFIG_PATH" 2>/dev/null || true)"
  fi
fi
export GRAPHIFY_MODEL

if [ "$STATUS_ONLY" = "1" ]; then
  echo "Graphify enabled: $GRAPHIFY_ENABLED"
  echo "Target: $TARGET_REPO_ROOT"
  echo "Output: $GRAPHIFY_OUTPUT_DIR"
  echo "graph.json: $GRAPHIFY_OUTPUT_DIR/graph.json"
  [ -f "$GRAPHIFY_OUTPUT_DIR/graph.json" ] && echo "Status: built" || echo "Status: not built"
  exit 0
fi

if [ "$GRAPHIFY_ENABLED" != "true" ] && [ "$FORCE" != "1" ]; then
  echo "[juninho:graphify] Graphify disabled; use --force for manual smoke builds."
  exit 0
fi

ensure_graphify() {
  if command -v graphify >/dev/null 2>&1; then
    return 0
  fi
  if command -v uv >/dev/null 2>&1; then
    uv tool install graphifyy >/dev/null 2>&1 && command -v graphify >/dev/null 2>&1 && return 0
  fi
  if command -v pipx >/dev/null 2>&1; then
    pipx install graphifyy >/dev/null 2>&1 && command -v graphify >/dev/null 2>&1 && return 0
  fi
  echo "erro: Graphify não disponível. Instale com: uv tool install graphifyy" >&2
  exit 1
}

ensure_graphify
mkdir -p "$GRAPHIFY_OUTPUT_DIR"

# graphify CLI always writes to <source-path>/graphify-out/
# We run it against the target repo src and then move outputs to canonical dir.
GRAPHIFY_TEMP_OUT="$TARGET_REPO_ROOT/graphify-out"

echo "[juninho:graphify] Building graph for $TARGET_REPO_ROOT..."

if [ "$INCREMENTAL" = "1" ]; then
  graphify update "$TARGET_REPO_ROOT" 2>/dev/null || true
else
  graphify update "$TARGET_REPO_ROOT" 2>/dev/null || true
fi

# Move outputs to canonical location
if [ -f "$GRAPHIFY_TEMP_OUT/graph.json" ]; then
  cp "$GRAPHIFY_TEMP_OUT/graph.json" "$GRAPHIFY_OUTPUT_DIR/graph.json"
  [ -f "$GRAPHIFY_TEMP_OUT/GRAPH_REPORT.md" ] && cp "$GRAPHIFY_TEMP_OUT/GRAPH_REPORT.md" "$GRAPHIFY_OUTPUT_DIR/GRAPH_REPORT.md"
  [ -f "$GRAPHIFY_TEMP_OUT/graph.html" ] && cp "$GRAPHIFY_TEMP_OUT/graph.html" "$GRAPHIFY_OUTPUT_DIR/graph.html"
  [ -d "$GRAPHIFY_TEMP_OUT/cache" ] && cp -r "$GRAPHIFY_TEMP_OUT/cache" "$GRAPHIFY_OUTPUT_DIR/cache" 2>/dev/null || true

  # Clean temp output
  rm -rf "$GRAPHIFY_TEMP_OUT"

  NODE_COUNT=$(python3 -c "import json; g=json.load(open('$GRAPHIFY_OUTPUT_DIR/graph.json')); print(len(g.get('nodes',[])))" 2>/dev/null || echo "?")
  echo "[juninho:graphify] Done. $NODE_COUNT nodes → $GRAPHIFY_OUTPUT_DIR/"
else
  rm -rf "$GRAPHIFY_TEMP_OUT" 2>/dev/null || true
  echo "erro: graphify não gerou graph.json" >&2
  exit 1
fi
