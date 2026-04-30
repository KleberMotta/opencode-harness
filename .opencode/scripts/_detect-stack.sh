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

# maven_check_java_version: validates that the running JVM major version matches
# <java.version> declared in pom.xml. Fails loudly so agents never bypass with --no-verify.
maven_check_java_version() {
  [ -f pom.xml ] || return 0
  _required="$(grep -m1 '<java.version>' pom.xml 2>/dev/null | sed 's/[^0-9]//g')"
  [ -n "$_required" ] || return 0
  _actual="$(java -version 2>&1 | head -1 | sed 's/.*version "\([0-9]*\).*/\1/')"
  if [ "$_actual" != "$_required" ]; then
    echo ""
    echo "┌─────────────────────────────────────────────────────────────────┐"
    echo "│ JAVA VERSION MISMATCH                                           │"
    echo "│ pom.xml requires Java $_required but runtime is Java $_actual                  │"
    echo "│                                                                 │"
    echo "│ Fix: switch to Java $_required before committing.                          │"
    echo "│   sdk use java <21.x.y-vendor>                                  │"
    echo "│   export JAVA_HOME=\$HOME/.sdkman/candidates/java/<21.x.y-vendor>│"
    echo "└─────────────────────────────────────────────────────────────────┘"
    echo ""
    return 1
  fi
  return 0
}

# pom_has_plugin: returns 0 if pom.xml mentions the given Maven plugin artifactId.
# Cheap grep — good enough to gate optional steps.
pom_has_plugin() {
  [ -f pom.xml ] || return 1
  grep -q "<artifactId>$1</artifactId>" pom.xml
}
