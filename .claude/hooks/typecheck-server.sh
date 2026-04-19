#!/usr/bin/env bash
# PostToolUse hook: run the server's tsc --noEmit after any edit under server/src/.
# Surfaces type errors locally in the same feedback loop CI uses, so Claude
# doesn't have to wait for GitHub Actions to notice.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INPUT="$(cat)"

FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')"
[ -z "$FILE_PATH" ] && exit 0

case "$FILE_PATH" in
  "$REPO_ROOT"/server/src/*.ts | "$REPO_ROOT"/server/src/**/*.ts) ;;
  *) exit 0 ;;
esac

cd "$REPO_ROOT/server"

if ! OUTPUT="$(./node_modules/.bin/tsc --noEmit 2>&1)"; then
  printf 'server tsc --noEmit failed after editing %s:\n%s\n' "$FILE_PATH" "$OUTPUT" >&2
  exit 2
fi
exit 0
