#!/bin/sh
# _detect-stack.sh — shared helper to detect the project stack of the target repo.
#
# Usage (source this file, then call functions):
#   . "$(dirname "$0")/_detect-stack.sh"
#   STACK="$(detect_stack)"   # echoes: maven|terraform|node|unknown
#
# Detection (run from CWD == $TARGET_REPO_ROOT after _resolve-repo.sh):
#   1. pom.xml OR mvnw present  -> maven   (Java/Kotlin)
#   2. any *.tf in repo root    -> terraform
#   3. package.json present     -> node
#   4. otherwise                -> unknown
#
# Precedence: maven > terraform > node. A monorepo carrying both pom.xml and
# package.json is treated as primarily maven; callers can opt out by setting
# JUNINHO_FORCE_STACK=node|maven|terraform|unknown.
#
# This helper does NOT chdir or mutate state. It only reads the filesystem.

detect_stack() {
  if [ -n "${JUNINHO_FORCE_STACK:-}" ]; then
    printf '%s' "$JUNINHO_FORCE_STACK"
    return 0
  fi
  if [ -f pom.xml ] || [ -f mvnw ]; then
    printf '%s' "maven"
    return 0
  fi
  # Match any *.tf file in repo root without invoking ls (avoid noisy stderr).
  for __ds_f in *.tf; do
    if [ -f "$__ds_f" ]; then
      printf '%s' "terraform"
      unset __ds_f
      return 0
    fi
    break
  done
  unset __ds_f
  if [ -f package.json ]; then
    printf '%s' "node"
    return 0
  fi
  printf '%s' "unknown"
}

# maven_runner: echo the path/command to invoke Maven (./mvnw or mvn).
# Returns non-zero (and echoes nothing) when no Maven is available.
maven_runner() {
  if [ -x ./mvnw ]; then
    printf '%s' "./mvnw"
    return 0
  fi
  if command -v mvn >/dev/null 2>&1; then
    printf '%s' "mvn"
    return 0
  fi
  return 1
}

# pom_has_plugin: returns 0 if pom.xml mentions the given Maven plugin artifactId.
# Cheap grep — good enough to gate optional steps.
pom_has_plugin() {
  [ -f pom.xml ] || return 1
  grep -q "<artifactId>$1</artifactId>" pom.xml
}
