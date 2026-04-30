#!/bin/sh
# pre-commit.sh — Workspace-level pre-commit hook for the harness repo itself.
# Runs structure lint + related tests on staged files.
# The workspace is allowed (ALLOW_WORKSPACE_GIT=1) since this IS the workspace.
set -e

export ALLOW_WORKSPACE_GIT=1

__SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$__SCRIPT_DIR/_resolve-repo.sh"
. "$__SCRIPT_DIR/_read-config.sh"
ROOT_DIR="$TARGET_REPO_ROOT"

JUNINHO_STAGED_FILES="$(git diff --cached --name-only --diff-filter=ACMR)"
export JUNINHO_STAGED_FILES

if [ -z "$JUNINHO_STAGED_FILES" ]; then
  echo "[juninho:pre-commit] No staged files. Skipping."
  exit 0
fi

if config_get_workflow_bool implement.skipLintOnPrecommit false; then
  echo "[juninho:pre-commit] Skipping structure lint (workflow.implement.skipLintOnPrecommit=true)"
else
  echo "[juninho:pre-commit] Running structure lint..."
  TARGET_REPO_ROOT="$ROOT_DIR" "$WORKSPACE_ROOT/.opencode/scripts/lint-structure.sh"
fi

if config_get_workflow_bool implement.skipTestOnPrecommit false; then
  echo "[juninho:pre-commit] Skipping related tests (workflow.implement.skipTestOnPrecommit=true)"
else
  echo "[juninho:pre-commit] Running related tests..."
  TARGET_REPO_ROOT="$ROOT_DIR" "$WORKSPACE_ROOT/.opencode/scripts/test-related.sh"
fi

echo "[juninho:pre-commit] Local checks passed"
