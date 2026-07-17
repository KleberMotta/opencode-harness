#!/bin/sh
# analyze-conventions.sh — measure a repository's conventions as deterministic JSON facts.
#
# Usage:
#   analyze-conventions.sh <repo-root> [--json]
#
# Emits a single JSON document on stdout. `--json` is accepted for explicitness;
# JSON is the only output format. Every number is computed with find/grep/awk/git
# (plus baseline sort/head/wc) — zero new dependencies — and is accompanied by
# "samples": up to 3 real file paths / names / lines from the repo. A field with
# no underlying data is OMITTED, never guessed: downstream synthesis
# (/j.finish-setup) must treat absence as "no evidence".
#
# Sections:
#   measure — dominant indentation in src/ (<=200 sampled files), p95 line length, % blank lines
#   symbols — most common trailing CamelCase words of file names under src/main, avg package depth
#   git     — last 200 commits: subject prefix distribution, % merge commits, remote branch prefixes
#   tests   — test vs source file counts, test-name suffixes, frameworks seen in imports
#   config  — formatter/linter detected (spotless/ktlint/detekt/checkstyle/prettier/eslint/editorconfig)
#             with the relevant config snippet
#
# This script only reads the filesystem and git metadata; it never mutates state.

set -u
LC_ALL=C
export LC_ALL

usage() {
  echo "usage: analyze-conventions.sh <repo-root> [--json]" >&2
  exit 2
}

[ "$#" -ge 1 ] || usage
ROOT="$1"
shift
for _arg in "$@"; do
  case "$_arg" in
    --json) : ;; # JSON is the default (and only) output format
    *) usage ;;
  esac
done

[ -d "$ROOT" ] || { echo "analyze-conventions: not a directory: $ROOT" >&2; exit 1; }
[ -e "$ROOT/.git" ] || { echo "analyze-conventions: not a git repo (no .git): $ROOT" >&2; exit 1; }

cd "$ROOT" || exit 1
ROOT_ABS="$(pwd)"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/analyze-conventions.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT INT TERM

# ---------------------------------------------------------------- json helpers

# json_str: JSON-escape stdin as one string body (no surrounding quotes).
json_str() {
  awk 'BEGIN { ORS = "" }
    { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, "")
      if (NR > 1) printf "\\n"
      print }'
}

# json_arr: turn stdin lines into a JSON array of strings.
json_arr() {
  awk 'BEGIN { ORS = ""; printf "[" }
    { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t")
      if (n++) printf ","
      printf "\"%s\"", $0 }
    END { printf "]" }'
}

# ---------------------------------------------------------------- file listing

# list_code_files <dir>: source-like TRACKED files, sorted for deterministic
# sampling. `git ls-files` respects the repo boundary (nested repos show up as
# gitlinks, not files) and never sees uncommitted build/vendor output. Falls
# back to `find` when the repo has no usable index (e.g. fresh clone tooling).
list_code_files() {
  { git -c core.quotepath=false ls-files -- "$1" 2>/dev/null \
      || find "$1" -type f ! -path '*/.git/*' 2>/dev/null | awk '{ sub(/^\.\//, ""); print }' ; } \
    | grep -E '\.(kt|kts|java|scala|groovy|ts|tsx|js|jsx|mjs|py|go|rb|cs|php|tf|sh)$' \
    | grep -vE '(^|/)(node_modules|target|build|dist|out|vendor|coverage|generated|\.gradle)/' \
    | sort
}

# ---------------------------------------------------------------- measure

SRC_DIR="src"
[ -d "$SRC_DIR" ] || SRC_DIR="."

MEASURE_JSON=""
list_code_files "$SRC_DIR" | head -200 > "$TMP/measure_files"
MEASURE_N=$(grep -c . "$TMP/measure_files")

if [ "$MEASURE_N" -gt 0 ]; then
  while IFS= read -r _f; do cat "$_f" 2>/dev/null; done < "$TMP/measure_files" > "$TMP/measure_lines"

  # Indent unit detection. Raw "lines starting with N spaces" misleads (depth-2
  # lines of 2-space code start with exactly 4 spaces), so classify by residue:
  # a leading width == 2 (mod 4) — widths 2, 6, 10, ... — CANNOT occur in pure
  # 4-space indentation. 2-space code (even ktfmt-style with 4-space
  # continuations) produces those widths at every odd depth.
  INDENT_COUNTS=$(awk '
    {
      if ($0 ~ /^[ \t]*$/) next
      match($0, /^[ \t]*/)
      ws = substr($0, 1, RLENGTH)
      t = gsub(/\t/, "", ws)
      s = length(ws)
      if (t > 0 && s == 0) tab++
      else if (t == 0 && s > 0) {
        if (s % 4 == 2) m2++
        else if (s % 4 == 0) m4++
      }
    }
    END { printf "%d %d %d", tab + 0, m2 + 0, m4 + 0 }
  ' "$TMP/measure_lines")
  IND_TAB=${INDENT_COUNTS%% *}
  _rest=${INDENT_COUNTS#* }
  IND_S2=${_rest%% *}
  IND_S4=${_rest##* }

  INDENT_FIELD=""
  if [ "$IND_TAB" -gt 0 ] || [ "$IND_S2" -gt 0 ] || [ "$IND_S4" -gt 0 ]; then
    if [ "$IND_TAB" -gt "$((IND_S2 + IND_S4))" ]; then DOMINANT="tabs"
    elif [ "$((4 * IND_S2))" -ge "$((IND_S2 + IND_S4))" ]; then DOMINANT="2-spaces"
    else DOMINANT="4-spaces"
    fi
    INDENT_SAMPLES=$(head -3 "$TMP/measure_files" | json_arr)
    INDENT_FIELD=$(printf '"indent":{"dominant":"%s","tab_lines":%s,"two_space_signal_lines":%s,"four_space_signal_lines":%s,"samples":%s}' \
      "$DOMINANT" "$IND_TAB" "$IND_S2" "$IND_S4" "$INDENT_SAMPLES")
  fi

  TOTAL_LINES=$(awk 'END { print NR }' "$TMP/measure_lines")
  P95=""
  BLANK_PCT=""
  if [ "$TOTAL_LINES" -gt 0 ]; then
    P95_IDX=$(awk -v t="$TOTAL_LINES" 'BEGIN { i = int(t * 0.95); if (i < 1) i = 1; print i }')
    P95=$(awk '{ print length($0) }' "$TMP/measure_lines" | sort -n | awk -v k="$P95_IDX" 'NR == k { print; exit }')
    BLANK_PCT=$(awk '/^[ \t]*$/ { b++ } END { printf "%.1f", 100 * b / NR }' "$TMP/measure_lines")
  fi

  _fields=$(printf '"files_sampled":%s,"source_dir":"%s"' "$MEASURE_N" "$SRC_DIR")
  [ -n "$INDENT_FIELD" ] && _fields="$_fields,$INDENT_FIELD"
  [ -n "$P95" ] && _fields="$_fields,\"line_length_p95\":$P95"
  [ -n "$BLANK_PCT" ] && _fields="$_fields,\"blank_line_pct\":$BLANK_PCT"
  MEASURE_JSON="\"measure\":{$_fields}"
fi

# ---------------------------------------------------------------- symbols

MAIN_DIR="."
if [ -d src/main ]; then MAIN_DIR="src/main"
elif [ "$SRC_DIR" != "." ]; then MAIN_DIR="$SRC_DIR"
fi

list_code_files "$MAIN_DIR" \
  | grep -vE '(/(test|tests|__tests__)/|\.(test|spec)\.[A-Za-z0-9]+$|_test\.[A-Za-z0-9]+$)' \
  > "$TMP/main_files"

SUFFIX_ENTRIES=""
awk -F/ '{ f = $NF; sub(/\.[A-Za-z0-9]+$/, "", f); print f }' "$TMP/main_files" > "$TMP/main_basenames"
grep -o '[A-Z][a-z0-9][a-z0-9]*$' "$TMP/main_basenames" 2>/dev/null | sort | uniq -c | sort -rn | head -8 > "$TMP/suffix_counts"
while read -r _count _sfx; do
  [ -n "${_sfx:-}" ] || continue
  [ "$_count" -ge 2 ] || continue
  _samples=$(awk -v s="$_sfx" -F/ '{
      f = $NF; sub(/\.[A-Za-z0-9]+$/, "", f)
      if (length(f) >= length(s) && substr(f, length(f) - length(s) + 1) == s) print $0
    }' "$TMP/main_files" | head -3 | json_arr)
  _entry=$(printf '{"suffix":"%s","count":%s,"samples":%s}' "$_sfx" "$_count" "$_samples")
  if [ -n "$SUFFIX_ENTRIES" ]; then SUFFIX_ENTRIES="$SUFFIX_ENTRIES,$_entry"; else SUFFIX_ENTRIES="$_entry"; fi
done < "$TMP/suffix_counts"

PKG_BASE=""
for _cand in src/main/kotlin src/main/java src/main/scala src/main/groovy; do
  if [ -d "$_cand" ]; then PKG_BASE="$_cand"; break; fi
done

PKG_FIELDS=""
if [ -n "$PKG_BASE" ]; then
  AVG_DEPTH=$(list_code_files "$PKG_BASE" | awk -v b="$PKG_BASE" '
    { rel = substr($0, length(b) + 2); d = split(rel, parts, "/") - 1; total += d; c++ }
    END { if (c > 0) printf "%.1f", total / c }')
  if [ -n "$AVG_DEPTH" ]; then
    PKG_SAMPLES=$(list_code_files "$PKG_BASE" | awk '{ sub(/\/[^\/]*$/, ""); print }' | sort -u | head -3 | json_arr)
    PKG_FIELDS=$(printf '"package_base":"%s","avg_package_depth":%s,"package_samples":%s' \
      "$PKG_BASE" "$AVG_DEPTH" "$PKG_SAMPLES")
  fi
fi

SYMBOLS_JSON=""
_sym_fields=""
[ -n "$SUFFIX_ENTRIES" ] && _sym_fields="\"class_suffixes\":[$SUFFIX_ENTRIES]"
if [ -n "$PKG_FIELDS" ]; then
  if [ -n "$_sym_fields" ]; then _sym_fields="$_sym_fields,$PKG_FIELDS"; else _sym_fields="$PKG_FIELDS"; fi
fi
[ -n "$_sym_fields" ] && SYMBOLS_JSON="\"symbols\":{$_sym_fields}"

# ---------------------------------------------------------------- git

GIT_JSON=""
git log -n 200 --pretty='%s' > "$TMP/subjects" 2>/dev/null || : > "$TMP/subjects"
COMMITS=$(grep -c . "$TMP/subjects")

if [ "$COMMITS" -gt 0 ]; then
  MERGES=$(git log -n 200 --pretty='%P' 2>/dev/null | awk 'NF > 1 { m++ } END { print m + 0 }')
  MERGE_PCT=$(awk -v m="$MERGES" -v c="$COMMITS" 'BEGIN { printf "%.1f", 100 * m / c }')

  awk 'match($0, /^[a-z]+(\([^)]*\))?!?: /) { t = $0; sub(/[(!:].*/, "", t); print t }' \
    "$TMP/subjects" | sort | uniq -c | sort -rn | head -10 > "$TMP/prefix_counts"

  PREFIX_ENTRIES=""
  while read -r _count _pfx; do
    [ -n "${_pfx:-}" ] || continue
    _samples=$(grep -E "^${_pfx}(\(|!|:)" "$TMP/subjects" | head -3 | json_arr)
    _entry=$(printf '{"prefix":"%s","count":%s,"samples":%s}' "$_pfx" "$_count" "$_samples")
    if [ -n "$PREFIX_ENTRIES" ]; then PREFIX_ENTRIES="$PREFIX_ENTRIES,$_entry"; else PREFIX_ENTRIES="$_entry"; fi
  done < "$TMP/prefix_counts"

  CONVENTIONAL=$(grep -cE '^[a-z]+(\([^)]*\))?!?: ' "$TMP/subjects")
  UNCONV=$((COMMITS - CONVENTIONAL))
  UNCONV_FIELD=""
  if [ "$UNCONV" -gt 0 ]; then
    _usamples=$(grep -vE '^[a-z]+(\([^)]*\))?!?: ' "$TMP/subjects" | head -3 | json_arr)
    UNCONV_FIELD=$(printf '"unconventional_subjects":{"count":%s,"samples":%s}' "$UNCONV" "$_usamples")
  fi

  git branch -r 2>/dev/null | awk '!/ -> / { b = $1; sub(/^[^\/]*\//, "", b); if (b != "") print b }' \
    | sort -u > "$TMP/branches"
  BRANCH_TOTAL=$(grep -c . "$TMP/branches")
  BRANCH_FIELD=""
  if [ "$BRANCH_TOTAL" -gt 0 ]; then
    awk -F/ 'NF > 1 { print $1 }' "$TMP/branches" | sort | uniq -c | sort -rn | head -8 > "$TMP/branch_prefix_counts"
    BRANCH_ENTRIES=""
    while read -r _count _pfx; do
      [ -n "${_pfx:-}" ] || continue
      _samples=$(awk -v p="$_pfx/" 'index($0, p) == 1' "$TMP/branches" | head -3 | json_arr)
      _entry=$(printf '{"prefix":"%s","count":%s,"samples":%s}' "$_pfx" "$_count" "$_samples")
      if [ -n "$BRANCH_ENTRIES" ]; then BRANCH_ENTRIES="$BRANCH_ENTRIES,$_entry"; else BRANCH_ENTRIES="$_entry"; fi
    done < "$TMP/branch_prefix_counts"
    BRANCH_FIELD=$(printf '"remote_branches":%s' "$BRANCH_TOTAL")
    [ -n "$BRANCH_ENTRIES" ] && BRANCH_FIELD="$BRANCH_FIELD,\"branch_prefixes\":[$BRANCH_ENTRIES]"
  fi

  _git_fields=$(printf '"commits_analyzed":%s,"merge_commit_pct":%s' "$COMMITS" "$MERGE_PCT")
  [ -n "$PREFIX_ENTRIES" ] && _git_fields="$_git_fields,\"subject_prefixes\":[$PREFIX_ENTRIES]"
  [ -n "$UNCONV_FIELD" ] && _git_fields="$_git_fields,$UNCONV_FIELD"
  [ -n "$BRANCH_FIELD" ] && _git_fields="$_git_fields,$BRANCH_FIELD"
  GIT_JSON="\"git\":{$_git_fields}"
fi

# ---------------------------------------------------------------- tests

TESTS_JSON=""
list_code_files . > "$TMP/all_code"
TOTAL_CODE=$(grep -c . "$TMP/all_code")

grep -E '(/(test|tests|__tests__|testFixtures)/|Test\.[A-Za-z0-9]+$|Tests\.[A-Za-z0-9]+$|IT\.[A-Za-z0-9]+$|Spec\.[A-Za-z0-9]+$|\.(test|spec)\.[A-Za-z0-9]+$|_test\.[A-Za-z0-9]+$)' \
  "$TMP/all_code" > "$TMP/test_files"
TEST_N=$(grep -c . "$TMP/test_files")
SOURCE_N=$((TOTAL_CODE - TEST_N))

if [ "$TOTAL_CODE" -gt 0 ]; then
  awk -F/ '{
    f = $NF
    sub(/\.[A-Za-z0-9]+$/, "", f)
    if (f ~ /Tests$/) print "Tests"
    else if (f ~ /Test$/) print "Test"
    else if (f ~ /IT$/) print "IT"
    else if (f ~ /Spec$/) print "Spec"
    else if (f ~ /\.test$/) print ".test"
    else if (f ~ /\.spec$/) print ".spec"
    else if (f ~ /_test$/) print "_test"
  }' "$TMP/test_files" | sort | uniq -c | sort -rn > "$TMP/test_suffix_counts"

  TEST_SUFFIX_ENTRIES=""
  while read -r _count _sfx; do
    [ -n "${_sfx:-}" ] || continue
    _samples=$(awk -v s="$_sfx" -F/ '{
        f = $NF; sub(/\.[A-Za-z0-9]+$/, "", f)
        if (length(f) >= length(s) && substr(f, length(f) - length(s) + 1) == s) print $0
      }' "$TMP/test_files" | head -3 | json_arr)
    _entry=$(printf '{"suffix":"%s","count":%s,"samples":%s}' "$_sfx" "$_count" "$_samples")
    if [ -n "$TEST_SUFFIX_ENTRIES" ]; then TEST_SUFFIX_ENTRIES="$TEST_SUFFIX_ENTRIES,$_entry"; else TEST_SUFFIX_ENTRIES="$_entry"; fi
  done < "$TMP/test_suffix_counts"

  head -60 "$TMP/test_files" > "$TMP/test_sample"
  FRAMEWORK_ENTRIES=""
  for _spec in \
    'junit5~org\.junit\.jupiter' \
    'junit4~org\.junit\.(Test|Assert|Before|After|Rule)' \
    'testng~org\.testng' \
    'kotest~io\.kotest' \
    'spock~spock\.lang' \
    'mockk~io\.mockk' \
    'mockito~org\.mockito' \
    'assertj~org\.assertj' \
    'vitest~from ["'\'']vitest["'\'']' \
    'jest~@jest/globals|from ["'\'']@?jest' \
    'mocha~from ["'\'']mocha["'\'']|require\(["'\'']mocha["'\'']\)' \
    'pytest~import pytest|from pytest'; do
    _name=${_spec%%~*}
    _re=${_spec#*~}
    _count=0
    _hit_line=""
    : > "$TMP/fw_samples"
    while IFS= read -r _tf; do
      _line=$(grep -E "$_re" "$_tf" 2>/dev/null | head -1)
      if [ -n "$_line" ]; then
        _count=$((_count + 1))
        [ -n "$_hit_line" ] || _hit_line="$_line"
        if [ "$(grep -c . "$TMP/fw_samples")" -lt 3 ]; then printf '%s\n' "$_tf" >> "$TMP/fw_samples"; fi
      fi
    done < "$TMP/test_sample"
    if [ "$_count" -gt 0 ]; then
      _ev=$(printf '%s\n' "$_hit_line" | awk '{ $1 = $1; print }' | json_str)
      _sm=$(json_arr < "$TMP/fw_samples")
      _entry=$(printf '{"name":"%s","files_matched":%s,"evidence":"%s","samples":%s}' "$_name" "$_count" "$_ev" "$_sm")
      if [ -n "$FRAMEWORK_ENTRIES" ]; then FRAMEWORK_ENTRIES="$FRAMEWORK_ENTRIES,$_entry"; else FRAMEWORK_ENTRIES="$_entry"; fi
    fi
  done

  TEST_FILE_SAMPLES=$(head -3 "$TMP/test_files" | json_arr)
  _test_fields=$(printf '"test_files":%s,"source_files":%s' "$TEST_N" "$SOURCE_N")
  if [ "$SOURCE_N" -gt 0 ]; then
    _ratio=$(awk -v t="$TEST_N" -v s="$SOURCE_N" 'BEGIN { printf "%.2f", t / s }')
    _test_fields="$_test_fields,\"test_to_source_ratio\":$_ratio"
  fi
  [ "$TEST_N" -gt 0 ] && _test_fields="$_test_fields,\"samples\":$TEST_FILE_SAMPLES"
  [ -n "$TEST_SUFFIX_ENTRIES" ] && _test_fields="$_test_fields,\"test_suffixes\":[$TEST_SUFFIX_ENTRIES]"
  [ -n "$FRAMEWORK_ENTRIES" ] && _test_fields="$_test_fields,\"frameworks\":[$FRAMEWORK_ENTRIES]"
  TESTS_JSON="\"tests\":{$_test_fields}"
fi

# ---------------------------------------------------------------- config

CONFIG_ENTRIES=""

# add_tool <name> <source-file>: snippet on stdin; appends one config entry.
add_tool() {
  _at_snippet=$(json_str)
  _at_entry=$(printf '{"name":"%s","source":"%s","snippet":"%s"}' "$1" "$2" "$_at_snippet")
  if [ -n "$CONFIG_ENTRIES" ]; then CONFIG_ENTRIES="$CONFIG_ENTRIES,$_at_entry"; else CONFIG_ENTRIES="$_at_entry"; fi
}

# snippet_ctx <file> <fixed-string> <n-lines>: print first match + following lines.
snippet_ctx() {
  awk -v pat="$2" -v n="$3" '
    !found && index($0, pat) { found = 1; left = n }
    found && left > 0 { print; left--; if (left == 0) exit }
  ' "$1" 2>/dev/null
}

# Maven: anchor on the plugin artifactId so the snippet shows the plugin's
# <configuration> block (the actual style: ktfmt/ktlint/googleJavaFormat/...).
if [ -f pom.xml ]; then
  for _pair in 'spotless~spotless-maven-plugin' 'ktlint~ktlint-maven-plugin' 'detekt~detekt-maven-plugin' 'checkstyle~maven-checkstyle-plugin'; do
    _name=${_pair%%~*}
    _anchor=${_pair#*~}
    snippet_ctx pom.xml "$_anchor" 18 > "$TMP/snip"
    [ -s "$TMP/snip" ] && add_tool "$_name" "pom.xml" < "$TMP/snip"
  done
fi
for _gradle in build.gradle build.gradle.kts; do
  [ -f "$_gradle" ] || continue
  for _tool in spotless ktlint detekt checkstyle; do
    snippet_ctx "$_gradle" "$_tool" 12 > "$TMP/snip"
    [ -s "$TMP/snip" ] && add_tool "$_tool" "$_gradle" < "$TMP/snip"
  done
done

if [ -f .editorconfig ]; then
  awk 'NR <= 12' .editorconfig > "$TMP/snip"
  [ -s "$TMP/snip" ] && add_tool "editorconfig" ".editorconfig" < "$TMP/snip"
fi

for _f in .prettierrc .prettierrc.json .prettierrc.yml .prettierrc.yaml .prettierrc.js prettier.config.js prettier.config.mjs; do
  if [ -f "$_f" ]; then
    awk 'NR <= 12' "$_f" > "$TMP/snip"
    add_tool "prettier" "$_f" < "$TMP/snip"
    break
  fi
done
if [ -f package.json ] && ! printf '%s' "$CONFIG_ENTRIES" | grep -q '"name":"prettier"'; then
  snippet_ctx package.json '"prettier"' 6 > "$TMP/snip"
  [ -s "$TMP/snip" ] && add_tool "prettier" "package.json" < "$TMP/snip"
fi

for _f in .eslintrc .eslintrc.json .eslintrc.js .eslintrc.cjs .eslintrc.yml eslint.config.js eslint.config.mjs eslint.config.cjs; do
  if [ -f "$_f" ]; then
    awk 'NR <= 12' "$_f" > "$TMP/snip"
    add_tool "eslint" "$_f" < "$TMP/snip"
    break
  fi
done

CONFIG_JSON=""
[ -n "$CONFIG_ENTRIES" ] && CONFIG_JSON="\"config\":{\"tools\":[$CONFIG_ENTRIES]}"

# ---------------------------------------------------------------- assemble

REPO_ESCAPED=$(printf '%s\n' "$ROOT_ABS" | json_str)
OUT=$(printf '"repo":"%s","analyzer":"analyze-conventions.sh"' "$REPO_ESCAPED")
[ -n "$MEASURE_JSON" ] && OUT="$OUT,
$MEASURE_JSON"
[ -n "$SYMBOLS_JSON" ] && OUT="$OUT,
$SYMBOLS_JSON"
[ -n "$GIT_JSON" ] && OUT="$OUT,
$GIT_JSON"
[ -n "$TESTS_JSON" ] && OUT="$OUT,
$TESTS_JSON"
[ -n "$CONFIG_JSON" ] && OUT="$OUT,
$CONFIG_JSON"
printf '{%s}\n' "$OUT"
