#!/usr/bin/env bash
# Stop hook: run the server's tsc --noEmit once, at the end of a turn.
# Previously this lived on PostToolUse:Edit but fired on every intermediate
# edit — blocking mid-refactor work where types reconcile across several
# files. Running on Stop keeps the safety net without the per-edit churn.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT/server"

if ! OUTPUT="$(./node_modules/.bin/tsc --noEmit 2>&1)"; then
  printf 'server tsc --noEmit failed:\n%s\n' "$OUTPUT" >&2
  exit 2
fi
exit 0
