#!/usr/bin/env bash
# PreToolUse hook: block Edit/Write/MultiEdit against secret-bearing files.
# Reads tool input JSON on stdin; exits 2 (blocking) when the target is a .env
# file or railway.json, so Claude cannot overwrite secrets or alter deploy config
# without the user explicitly bypassing this hook.

set -euo pipefail

INPUT="$(cat)"
FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')"
[ -z "$FILE_PATH" ] && exit 0

BASENAME="$(basename "$FILE_PATH")"

case "$BASENAME" in
  .env | .env.* | railway.json)
    printf 'Refusing to edit %s via Claude. This file is guarded by block-sensitive-edits.sh\n' "$FILE_PATH" >&2
    printf 'Reason: contains secrets or controls Railway deploy config. Edit it yourself if intentional.\n' >&2
    exit 2
    ;;
esac

exit 0
