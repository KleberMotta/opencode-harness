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

# maven_has_dependencies_target: returns 0 if a Makefile target named
# "dependencies" exists (the OLX/Spring Boot convention to spin up Docker
# Compose with Postgres/Localstack/Unleash before running integration tests).
maven_has_dependencies_target() {
  [ -f Makefile ] || return 1
  # Match a top-of-line target named "dependencies:" (allow ":" or ": dep1 dep2").
  grep -qE '^dependencies[[:space:]]*:' Makefile
}

# maven_has_integration_tests: heuristic — returns 0 when Spring integration
# tests appear to exist (any test annotated @SpringBootTest under src/test).
# Cheap grep, false negatives are acceptable.
maven_has_integration_tests() {
  [ -d src/test ] || return 1
  # `grep -r` swallows the rare case where src/test has only resources.
  grep -rqlE '@SpringBootTest|@DataJpaTest|@WebMvcTest' src/test 2>/dev/null
}

# maven_compose_running: returns 0 if any container of the project's
# docker-compose.yml is currently running. Best-effort: silently returns
# non-zero on any error (no docker, no compose, etc.).
maven_compose_running() {
  [ -f docker-compose.yml ] || return 1
  command -v docker >/dev/null 2>&1 || return 1
  # `docker compose ps -q` lists IDs of containers belonging to the project.
  # Empty output (or any failure) means nothing is up.
  _ids="$(docker compose ps -q 2>/dev/null)" || return 1
  [ -n "$_ids" ]
}

# maven_dependencies_required: prints a one-liner reason and returns 0 when the
# repo declares both a docker-compose.yml AND a Makefile `dependencies:` target
# AND has Spring integration tests AND the compose is currently down.
# Returns 1 (skip warning) in any other case.
maven_dependencies_required() {
  maven_has_dependencies_target || return 1
  [ -f docker-compose.yml ] || return 1
  maven_has_integration_tests || return 1
  if maven_compose_running; then
    return 1
  fi
  return 0
}
