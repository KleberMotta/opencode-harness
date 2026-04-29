#!/bin/sh
set -e

# harness-feature-integration.sh
#
# Dual-mode invocation:
#   single-target (default): operates on $TARGET_REPO_ROOT (env) or the repo
#     resolved from CWD via _resolve-repo.sh. All 11 subcommands supported.
#   --all-targets: iterates every writeTargets[].targetRepoRoot from the
#     workspace's .opencode/state/active-plan.json, re-invoking the script
#     with TARGET_REPO_ROOT set per target. Whitelisted subcommands only:
#     ensure, switch, cleanup. Logs "[ok|fail] <project>" per target,
#     continues on partial failure, exits non-zero if any target failed.
#
# Refuses to operate on workspace git unless ALLOW_WORKSPACE_GIT=1
# (enforced by _resolve-repo.sh in single-target mode).

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
WORKSPACE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
ACTIVE_PLAN_JSON="$WORKSPACE_ROOT/.opencode/state/active-plan.json"

if [ "${1:-}" = "--all-targets" ]; then
  shift
  __subcmd="${1:-}"
  case "$__subcmd" in
    ensure|switch|cleanup) ;;
    "")
      echo "[juninho:feature-integration] --all-targets requires a subcommand (ensure|switch|cleanup)" >&2
      exit 1
      ;;
    *)
      echo "[juninho:feature-integration] --all-targets only supports: ensure, switch, cleanup (got: $__subcmd)" >&2
      exit 1
      ;;
  esac

  if [ ! -f "$ACTIVE_PLAN_JSON" ]; then
    echo "[juninho:feature-integration] No active-plan.json at $ACTIVE_PLAN_JSON" >&2
    exit 1
  fi

  # Extract writeTargets[].{project,targetRepoRoot} as TAB-separated rows.
  __rows="$(
    if command -v node >/dev/null 2>&1; then
      node -e '
        const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8"));
        const rows = (j.writeTargets || [])
          .filter(w => w && w.targetRepoRoot)
          .map(w => (w.project || w.targetRepoRoot) + "\t" + w.targetRepoRoot);
        process.stdout.write(rows.join("\n"));
      ' "$ACTIVE_PLAN_JSON"
    elif command -v bun >/dev/null 2>&1; then
      bun -e '
        const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8"));
        const rows = (j.writeTargets || [])
          .filter(w => w && w.targetRepoRoot)
          .map(w => (w.project || w.targetRepoRoot) + "\t" + w.targetRepoRoot);
        process.stdout.write(rows.join("\n"));
      ' "$ACTIVE_PLAN_JSON"
    elif command -v python3 >/dev/null 2>&1; then
      python3 -c '
import json, sys
j = json.load(open(sys.argv[1]))
rows = []
for w in j.get("writeTargets", []) or []:
    root = (w or {}).get("targetRepoRoot")
    if not root: continue
    project = (w or {}).get("project") or root
    rows.append(project + "\t" + root)
sys.stdout.write("\n".join(rows))
' "$ACTIVE_PLAN_JSON"
    fi
  )"

  if [ -z "$__rows" ]; then
    echo "[juninho:feature-integration] No writeTargets[].targetRepoRoot found in $ACTIVE_PLAN_JSON" >&2
    exit 1
  fi

  # Use a tempfile counter so failures inside the subshell `while` survive.
  __failure_counter="$(mktemp)"
  printf '0' >"$__failure_counter"
  trap 'rm -f "$__failure_counter"' EXIT

  __tab="$(printf '\t')"
  printf '%s\n' "$__rows" | while IFS="$__tab" read -r __project __target_root; do
    [ -z "$__target_root" ] && continue
    if TARGET_REPO_ROOT="$__target_root" sh "$0" "$@" >/dev/null 2>&1; then
      echo "[ok]   $__project"
    else
      __status=$?
      echo "[fail] $__project (exit $__status)" >&2
      __cur="$(cat "$__failure_counter")"
      printf '%s' "$((__cur + 1))" >"$__failure_counter"
    fi
  done

  __failures="$(cat "$__failure_counter")"
  rm -f "$__failure_counter"
  trap - EXIT
  if [ "${__failures:-0}" != "0" ]; then
    echo "[juninho:feature-integration] $__failures target(s) failed" >&2
    exit 1
  fi
  exit 0
fi

# Single-target mode: source resolver helper, then proceed unchanged.
. "$SCRIPT_DIR/_resolve-repo.sh"
ROOT_DIR="$TARGET_REPO_ROOT"
TAB="$(printf '	')"

if command -v node >/dev/null 2>&1; then
  JS_RUNTIME="node"
elif command -v bun >/dev/null 2>&1; then
  JS_RUNTIME="bun"
else
  echo "[juninho:feature-integration] Missing JavaScript runtime (node or bun)" >&2
  exit 1
fi

fail() {
  echo "[juninho:feature-integration] $*" >&2
  exit 1
}

current_branch() {
  git symbolic-ref --quiet --short HEAD 2>/dev/null || true
}

state_file_path() {
  local_name="$1"
  printf '%s/.opencode/state/%s
' "$ROOT_DIR" "$local_name"
}

default_base_ref() {
  if git show-ref --verify --quiet "refs/remotes/origin/main"; then
    printf '%s
' "refs/remotes/origin/main"
    return
  fi
  if git show-ref --verify --quiet "refs/remotes/origin/master"; then
    printf '%s
' "refs/remotes/origin/master"
    return
  fi

  branch="$(current_branch)"
  [ -n "$branch" ] || fail "Detached HEAD. Provide an explicit base branch."
  printf '%s
' "$branch"
}

normalize_base_branch() {
  input="$1"
  case "$input" in
    refs/remotes/origin/*)
      printf '%s
' "${input#refs/remotes/origin/}"
      ;;
    origin/*)
      printf '%s
' "${input#origin/}"
      ;;
    refs/heads/*)
      printf '%s
' "${input#refs/heads/}"
      ;;
    *)
      printf '%s
' "$input"
      ;;
  esac
}

resolve_base_ref() {
  input="$1"
  if [ -z "$input" ]; then
    default_base_ref
    return
  fi

  case "$input" in
    refs/remotes/*|refs/heads/*)
      printf '%s
' "$input"
      ;;
    origin/*)
      printf '%s
' "refs/remotes/$input"
      ;;
    *)
      if git show-ref --verify --quiet "refs/remotes/origin/$input"; then
        printf '%s
' "refs/remotes/origin/$input"
      else
        printf '%s
' "$input"
      fi
      ;;
  esac
}

task_branch_name() {
  printf 'feature/%s-task-%s' "$1" "$2"
}

find_existing_feature_commit() {
  feature_branch="$1"
  validated_commit="$2"
  git log "$feature_branch" --format='%H' --grep="cherry picked from commit $validated_commit" -n 1 2>/dev/null || true
}

feature_branch_name() {
  printf 'feature/%s' "$1"
}

manifest_path() {
  printf '%s/docs/specs/%s/state/integration-state.json' "$ROOT_DIR" "$1"
}

ensure_manifest_dir() {
  TARGET_REPO_ROOT="$ROOT_DIR" sh "$WORKSPACE_ROOT/.opencode/scripts/scaffold-spec-state.sh" "$1"
}

json_read_field() {
  MANIFEST_PATH="$1" FIELD_PATH="$2" "$JS_RUNTIME" - <<'NODE'
const fs = require("fs")

const manifestPath = process.env.MANIFEST_PATH
const fieldPath = process.env.FIELD_PATH || ""

if (!manifestPath || !fs.existsSync(manifestPath)) process.exit(1)

const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
let value = data
for (const key of fieldPath.split(".").filter(Boolean)) {
  if (value == null || !(key in value)) process.exit(1)
  value = value[key]
}

if (value == null) process.exit(1)
if (typeof value === "string") {
  process.stdout.write(value)
  process.exit(0)
}

process.stdout.write(JSON.stringify(value))
NODE
}

parse_active_feature_slug() {
  execution_state="$(state_file_path execution-state.md)"
  [ -f "$execution_state" ] || return 0
  grep "Feature slug" "$execution_state" 2>/dev/null | head -n 1 | cut -d':' -f2 | tr -d ' '
}

cmd="${1:-}"

case "$cmd" in
  ensure)
    feature_slug="${2:-}"
    [ -n "$feature_slug" ] || fail "Usage: ensure <feature-slug> [base-branch]"

    base_ref="$(resolve_base_ref "${3:-}")"
    base_branch="$(normalize_base_branch "$base_ref")"

    ensure_manifest_dir "$feature_slug"
    feature_branch="$(feature_branch_name "$feature_slug")"
    base_sha="$(git rev-parse "$base_ref" 2>/dev/null)" || fail "Unknown base branch/ref: $base_ref"

    if ! git show-ref --verify --quiet "refs/heads/$feature_branch"; then
      git branch "$feature_branch" "$base_sha" >/dev/null
    fi

    manifest="$(manifest_path "$feature_slug")"
    FEATURE_SLUG="$feature_slug" FEATURE_BRANCH="$feature_branch" BASE_BRANCH="$base_branch" BASE_REF="$base_ref" BASE_SHA="$base_sha" MANIFEST_PATH="$manifest" "$JS_RUNTIME" - <<'NODE'
const fs = require("fs")
const path = require("path")

const manifestPath = process.env.MANIFEST_PATH
const featureSlug = process.env.FEATURE_SLUG
const featureBranch = process.env.FEATURE_BRANCH
const baseBranch = process.env.BASE_BRANCH
const baseRef = process.env.BASE_REF
const baseSha = process.env.BASE_SHA

const now = new Date().toISOString()
const next = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : {}

const manifest = {
  featureSlug,
  featureBranch,
  baseBranch,
  baseRef,
  baseStartPoint: next.baseStartPoint || baseSha,
  createdAt: next.createdAt || now,
  lastUpdatedAt: now,
  tasks: next.tasks || {},
}

fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8")
NODE

    printf '%s
' "$feature_branch"
    ;;

  print-task-base)
    feature_slug="${2:-}"
    depends_csv="${3:-}"
    [ -n "$feature_slug" ] || fail "Usage: print-task-base <feature-slug> [depends-csv]"

    manifest="$(manifest_path "$feature_slug")"
    [ -f "$manifest" ] || fail "Missing integration manifest: $manifest"

    feature_branch="$(json_read_field "$manifest" "featureBranch")" || fail "Unable to read feature branch"
    base_start_point="$(json_read_field "$manifest" "baseStartPoint")" || fail "Unable to read base start point"

    if [ -n "$depends_csv" ]; then
      DEPENDS_CSV="$depends_csv" MANIFEST_PATH="$manifest" "$JS_RUNTIME" - <<'NODE'
const fs = require("fs")

const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"))
for (const dep of (process.env.DEPENDS_CSV || "").split(",").map((value) => value.trim()).filter(Boolean)) {
  const entry = manifest.tasks?.[dep]
  const status = entry?.integration?.status
  if (entry && (!status || status === "pending")) {
    throw new Error("Dependency " + dep + " is not integrated yet")
  }
}
NODE
      printf '%s
' "$feature_branch"
      exit 0
    fi

    printf '%s
' "$base_start_point"
    ;;

  prepare-task-branch)
    feature_slug="${2:-}"
    task_id="${3:-}"
    depends_csv="${4:-}"
    worktree_directory="${5:-}"

    [ -n "$feature_slug" ] || fail "Usage: prepare-task-branch <feature-slug> <task-id> [depends-csv] [worktree-directory]"
    [ -n "$task_id" ] || fail "Missing task id"

    manifest="$(manifest_path "$feature_slug")"
    [ -f "$manifest" ] || fail "Missing integration manifest: $manifest"

    task_branch="$(task_branch_name "$feature_slug" "$task_id")"
    task_base="$(TARGET_REPO_ROOT="$ROOT_DIR" sh "$0" print-task-base "$feature_slug" "$depends_csv")"

    if [ -n "$worktree_directory" ]; then
      if [ -d "$worktree_directory" ]; then
        printf '%s
' "$task_branch"
        exit 0
      fi

      parent_dir=$(dirname "$worktree_directory")
      [ -d "$parent_dir" ] || fail "Missing worktree parent directory: $parent_dir"

      if git show-ref --verify --quiet "refs/heads/$task_branch"; then
        git worktree add "$worktree_directory" "$task_branch" >/dev/null
      else
        git worktree add -b "$task_branch" "$worktree_directory" "$task_base" >/dev/null
      fi
      printf '%s
' "$task_branch"
      exit 0
    fi

    if git show-ref --verify --quiet "refs/heads/$task_branch"; then
      git switch "$task_branch" >/dev/null
    else
      git switch -c "$task_branch" "$task_base" >/dev/null
    fi
    printf '%s
' "$task_branch"
    ;;

  switch)
    feature_slug="${2:-}"
    [ -n "$feature_slug" ] || fail "Usage: switch <feature-slug>"

    manifest="$(manifest_path "$feature_slug")"
    if [ -f "$manifest" ]; then
      feature_branch="$(json_read_field "$manifest" "featureBranch")" || fail "Unable to read feature branch from $manifest"
    else
      feature_branch="$(feature_branch_name "$feature_slug")"
    fi

    git switch "$feature_branch" >/dev/null
    printf '%s
' "$feature_branch"
    ;;

  switch-active)
    feature_slug="$(parse_active_feature_slug)"
    [ -n "$feature_slug" ] || exit 0
    TARGET_REPO_ROOT="$ROOT_DIR" sh "$0" switch "$feature_slug"
    ;;

  record-task)
    feature_slug="${2:-}"
    task_id="${3:-}"
    task_branch="${4:-}"
    validated_commit="${5:-}"
    attempt="${6:-}"
    worktree_directory="${7:-}"
    task_label="${8:-}"

    [ -n "$feature_slug" ] || fail "Usage: record-task <feature-slug> <task-id> <task-branch> <validated-commit> <attempt> [worktree] [label]"
    [ -n "$task_id" ] || fail "Missing task id"
    [ -n "$task_branch" ] || fail "Missing task branch"
    [ -n "$validated_commit" ] || fail "Missing validated commit"
    [ -n "$attempt" ] || fail "Missing attempt"

    manifest="$(manifest_path "$feature_slug")"
    [ -f "$manifest" ] || fail "Missing integration manifest: $manifest"

    task_tip="$(git rev-parse "refs/heads/$task_branch" 2>/dev/null || printf '%s' "$validated_commit")"

    FEATURE_SLUG="$feature_slug" TASK_ID="$task_id" TASK_BRANCH="$task_branch" VALIDATED_COMMIT="$validated_commit" TASK_TIP="$task_tip" TASK_ATTEMPT="$attempt" WORKTREE_DIRECTORY="$worktree_directory" TASK_LABEL="$task_label" MANIFEST_PATH="$manifest" "$JS_RUNTIME" - <<'NODE'
const fs = require("fs")

const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"))
const existing = manifest.tasks?.[process.env.TASK_ID]

manifest.tasks = manifest.tasks || {}
manifest.tasks[process.env.TASK_ID] = {
  ...(existing || {}),
  taskID: process.env.TASK_ID,
  taskBranch: process.env.TASK_BRANCH,
  validatedCommit: process.env.VALIDATED_COMMIT,
  taskTip: process.env.TASK_TIP,
  attempt: Number(process.env.TASK_ATTEMPT),
  worktreeDirectory: process.env.WORKTREE_DIRECTORY || "",
  taskLabel: process.env.TASK_LABEL || "",
  recordedAt: new Date().toISOString(),
  integration: existing?.integration || { status: "pending" },
}
manifest.lastUpdatedAt = new Date().toISOString()
fs.writeFileSync(process.env.MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8")
NODE

    printf '%s
' "$validated_commit"
    ;;

  integrate-task)
    feature_slug="${2:-}"
    task_id="${3:-}"

    [ -n "$feature_slug" ] || fail "Usage: integrate-task <feature-slug> <task-id>"
    [ -n "$task_id" ] || fail "Missing task id"

    manifest="$(manifest_path "$feature_slug")"
    [ -f "$manifest" ] || fail "Missing integration manifest: $manifest"

    feature_branch="$(json_read_field "$manifest" "featureBranch")" || fail "Unable to read feature branch"
    validated_commit="$(json_read_field "$manifest" "tasks.$task_id.validatedCommit")" || fail "Task $task_id has no validated commit"
    task_branch="$(json_read_field "$manifest" "tasks.$task_id.taskBranch")" || fail "Task $task_id has no task branch"

    git switch "$feature_branch" >/dev/null

    integration_status="already-contained"
    integration_method="ancestor"
    if git merge-base --is-ancestor "$validated_commit" HEAD; then
      integrated_commit="$validated_commit"
    elif git cherry "$feature_branch" "$validated_commit" 2>/dev/null | grep -q "^- $validated_commit$"; then
      integration_method="patch-equivalent"
      integrated_commit="$(find_existing_feature_commit "$feature_branch" "$validated_commit")"
      if [ -z "$integrated_commit" ]; then
        integrated_commit="$(git rev-parse HEAD)"
      fi
    elif git merge-base --is-ancestor HEAD "$validated_commit"; then
      git merge --ff-only "$validated_commit" >/dev/null
      integration_status="ff-only"
      integration_method="ff-only"
      integrated_commit="$(git rev-parse HEAD)"
    else
      git cherry-pick -x "$validated_commit" >/dev/null
      integration_status="cherry-picked"
      integration_method="cherry-pick"
      integrated_commit="$(git rev-parse HEAD)"
    fi

    TASK_ID="$task_id" INTEGRATED_STATUS="$integration_status" INTEGRATION_METHOD="$integration_method" INTEGRATED_COMMIT="$integrated_commit" FEATURE_BRANCH="$feature_branch" TASK_BRANCH="$task_branch" MANIFEST_PATH="$manifest" "$JS_RUNTIME" - <<'NODE'
const fs = require("fs")

const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"))
const task = manifest.tasks?.[process.env.TASK_ID]

if (!task) throw new Error("Task " + process.env.TASK_ID + " is missing from manifest")

task.integration = {
  status: process.env.INTEGRATED_STATUS,
  method: process.env.INTEGRATION_METHOD,
  featureBranch: process.env.FEATURE_BRANCH,
  taskBranch: process.env.TASK_BRANCH,
  integratedAt: new Date().toISOString(),
  integratedCommit: process.env.INTEGRATED_COMMIT,
}
manifest.lastUpdatedAt = new Date().toISOString()
fs.writeFileSync(process.env.MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8")
NODE

    printf '%s
' "$integrated_commit"
    ;;

  cleanup)
    feature_slug="${2:-}"
    [ -n "$feature_slug" ] || fail "Usage: cleanup <feature-slug>"

    manifest="$(manifest_path "$feature_slug")"
    [ -f "$manifest" ] || fail "Missing integration manifest: $manifest"

    feature_branch="$(json_read_field "$manifest" "featureBranch")" || fail "Unable to read feature branch"
    git switch "$feature_branch" >/dev/null

    cleanup_rows="$(MANIFEST_PATH="$manifest" "$JS_RUNTIME" - <<'NODE'
const fs = require("fs")

const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"))
for (const [taskId, task] of Object.entries(manifest.tasks || {})) {
  if (!task?.integration?.status || task.integration.status === "pending") continue
  process.stdout.write(taskId + "\t" + (task.taskBranch || "") + "\t" + (task.worktreeDirectory || "") + "\n")
}
NODE
    )"

    if [ -n "$cleanup_rows" ]; then
      printf '%s
' "$cleanup_rows" | while IFS="$TAB" read -r task_id task_branch worktree_directory; do
        if [ -n "$worktree_directory" ] && [ -d "$worktree_directory" ]; then
          git worktree remove "$worktree_directory" >/dev/null
        fi

        if [ -n "$task_branch" ] && [ "$task_branch" != "$feature_branch" ] && git show-ref --verify --quiet "refs/heads/$task_branch"; then
          git branch -d "$task_branch" >/dev/null
        fi
      done
    fi

    MANIFEST_PATH="$manifest" "$JS_RUNTIME" - <<'NODE'
const fs = require("fs")

const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"))
for (const task of Object.values(manifest.tasks || {})) {
  if (!task.integration?.status || task.integration.status === "pending") continue
  task.cleanup = {
    status: "done",
    cleanedAt: new Date().toISOString(),
  }
}
manifest.lastUpdatedAt = new Date().toISOString()
fs.writeFileSync(process.env.MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8")
NODE

    printf '%s
' "$feature_branch"
    ;;

  print-feature-branch)
    feature_slug="${2:-}"
    [ -n "$feature_slug" ] || fail "Usage: print-feature-branch <feature-slug>"
    manifest="$(manifest_path "$feature_slug")"
    if [ -f "$manifest" ]; then
      json_read_field "$manifest" "featureBranch"
    else
      feature_branch_name "$feature_slug"
    fi
    printf '
'
    ;;

  print-base-branch)
    feature_slug="${2:-}"
    [ -n "$feature_slug" ] || fail "Usage: print-base-branch <feature-slug>"
    manifest="$(manifest_path "$feature_slug")"
    [ -f "$manifest" ] || fail "Missing integration manifest: $manifest"
    json_read_field "$manifest" "baseBranch"
    printf '
'
    ;;

  print-base-ref)
    feature_slug="${2:-}"
    [ -n "$feature_slug" ] || fail "Usage: print-base-ref <feature-slug>"
    manifest="$(manifest_path "$feature_slug")"
    [ -f "$manifest" ] || fail "Missing integration manifest: $manifest"
    if json_read_field "$manifest" "baseRef" >/dev/null 2>&1; then
      json_read_field "$manifest" "baseRef"
    else
      json_read_field "$manifest" "baseBranch"
    fi
    printf '
'
    ;;

  *)
    fail "Unknown command: ${cmd:-<empty>}"
    ;;
esac
