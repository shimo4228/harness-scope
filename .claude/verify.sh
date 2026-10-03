#!/usr/bin/env bash
# Repo gate (contract: skill verify-bootstrap). --staged = fast per-file checks; no args = full.
# exit 0 PASS / 1 FAIL / 2 a gate could not run (reported, never silent). Choices: .claude/verify.md
set -uo pipefail

if [[ -n "${VERIFY_REPO_ROOT:-}" ]]; then
  ROOT="$VERIFY_REPO_ROOT"
else
  ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P) || exit 2
fi
cd "$ROOT" || exit 2

fail=0
sleeping=()

BIOME="$ROOT/node_modules/.bin/biome"
TSC="$ROOT/node_modules/.bin/tsc"

if [[ ! -x "$BIOME" || ! -x "$TSC" ]]; then
  echo "verify: node_modules is missing — run 'npm ci' (format / lint / type check are sleeping)"
  exit 2
fi

if [[ "${1:-}" == "--staged" ]]; then
  files=()  # bash 3.2 on macOS has no mapfile
  while IFS= read -r f; do files+=("$f"); done < <(git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' '*.js' '*.json' | grep -v '^probe/')
  if (( ${#files[@]} > 0 )); then
    out=$("$BIOME" check --error-on-warnings --no-errors-on-unmatched "${files[@]}" 2>&1) || { echo "$out"; fail=1; }
  fi
  exit "$fail"
fi

# format + lint (+ import order)
out=$("$BIOME" check --error-on-warnings . 2>&1) || { echo "$out"; fail=1; }

# type check — declarations are written by Claude Code when it loads a mod (claude --plugin-dir <dir>)
PLUGINS=(. tools/probe)  # the mod and the measurement probe
for dir in "${PLUGINS[@]}"; do
  if [[ -f "$dir/.claude-plugin/types/claude-code/index.d.ts" ]]; then
    "$TSC" -p "$dir" || fail=1
  else
    sleeping+=("type check ($dir): .claude-plugin/types/ is missing — load it once with 'claude --plugin-dir $dir'")
  fi
done

# manifest + hooks module (events, mods API calls)
if command -v claude >/dev/null 2>&1; then
  # Name each manifest: given a directory that holds marketplace.json, validate checks only the marketplace.
  manifests=()
  for dir in "${PLUGINS[@]}"; do manifests+=("$dir/.claude-plugin/plugin.json"); done
  [[ -f .claude-plugin/marketplace.json ]] && manifests+=(.claude-plugin/marketplace.json)
  for m in "${manifests[@]}"; do
    claude plugin validate --strict "$m" >/dev/null || { claude plugin validate --strict "$m"; fail=1; }
  done

  test_out=$(claude plugin test . 2>&1)
  test_rc=$?
  if grep -q "hooks modules are turned off in this process" <<<"$test_out"; then
    sleeping+=("plugin test: the runner reports mods turned off (known 2.1.287 bug, fixed in 2.1.288)")
  elif grep -q "no \*.test.ts or \*.test.tsx" <<<"$test_out"; then
    sleeping+=("plugin test: no *.test.ts yet")
  elif (( test_rc != 0 )); then
    echo "$test_out"
    fail=1
  fi
else
  sleeping+=("plugin validate / plugin test: 'claude' is not on PATH")
fi

# dependencies (dev only; the mod has no runtime dependencies)
npm audit --audit-level=low >/dev/null 2>&1 || { npm audit --audit-level=low; fail=1; }

for s in ${sleeping[@]+"${sleeping[@]}"}; do echo "verify: sleeping gate — $s"; done  # bash 3.2: empty array + set -u
if (( fail )); then exit 1; fi
if (( ${#sleeping[@]} > 0 )); then exit 2; fi
exit 0
