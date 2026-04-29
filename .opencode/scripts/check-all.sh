#!/bin/sh
set -e

ROOT_DIR="${TARGET_REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT_DIR"

sh "$ROOT_DIR/.opencode/scripts/harness-feature-integration.sh" switch-active >/dev/null 2>&1 || true

CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [ -n "$CURRENT_BRANCH" ]; then
  echo "[juninho:check-all] Running on branch: $CURRENT_BRANCH"
fi
has_package_script() {
  [ -f package.json ] || return 1
  node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); process.exit(pkg.scripts && pkg.scripts[process.argv[1]] ? 0 : 1)" "$1" >/dev/null 2>&1
}

echo "[juninho:check-all] Running formatting checks..."
if has_package_script "lint"; then
  npm run lint
elif has_package_script "check:all"; then
  npm run check:all
fi

echo "[juninho:check-all] Running repo-wide tests..."
if has_package_script "check:all"; then
  npm run check:all
  exit 0
fi

if has_package_script "typecheck"; then
  npm run typecheck
fi

if has_package_script "test"; then
  npm test
  exit 0
fi

echo "[juninho:check-all] No full verification command configured."
echo "[juninho:check-all] Customize .opencode/scripts/check-all.sh or run /j.finish-setup."
