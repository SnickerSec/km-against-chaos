#!/usr/bin/env bash
# PostToolUse hook: lint client TS/TSX files immediately after they're edited.
# Reads tool input JSON on stdin, extracts the file path, and runs eslint
# on it via the client workspace. Exits 0 on success or non-applicable file;
# exits non-zero on lint failure so Claude sees the output.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INPUT="$(cat)"

FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')"
[ -z "$FILE_PATH" ] && exit 0

case "$FILE_PATH" in
  "$REPO_ROOT"/client/src/*.ts | "$REPO_ROOT"/client/src/*.tsx | "$REPO_ROOT"/client/src/**/*.ts | "$REPO_ROOT"/client/src/**/*.tsx) ;;
  *) exit 0 ;;
esac

REL="${FILE_PATH#"$REPO_ROOT/client/"}"
cd "$REPO_ROOT/client"

if ! OUTPUT="$(npx --no-install eslint "$REL" 2>&1)"; then
  printf 'eslint failed for %s:\n%s\n' "$REL" "$OUTPUT" >&2
  exit 2
fi
exit 0
