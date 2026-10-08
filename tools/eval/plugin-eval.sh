#!/usr/bin/env bash
# Runs the official plugin eval suite (evals/) against plugin/ — usage: tools/eval/plugin-eval.sh [plugin dir] [extra args]
# The runner reads cases only from below the plugin, and evals must not ship, so plugin/ and evals/ are assembled in a
# temp dir (like the unit tests). Each case runs with the plugin and as a no-plugin baseline (claude plugin eval --help).
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
plugin=${1:-$root/plugin}
shift || true
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
cp -R "$plugin/." "$dir/"
rm -rf "$dir/.claude-plugin/types"
cp -R "$root/evals" "$dir/evals"
# --scaffold runs evals/*/scaffold.sh (this repo's own files); --trust-plugin answers the first-run prompt for it.
claude plugin eval "$dir" --scaffold --trust-plugin --no-publish "$@"
