#!/bin/sh
# PreToolUse guard for Write/Edit/NotebookEdit.
#
# Scope: paths under a `specs/` directory ONLY. Everything outside specs/ is untouched,
# so this cannot get in the way of implementer, test-writer, or doc-writer.
#
# Inside specs/ we allow:
#   *.md                              — specifications (what /spec writes)
#   e2e/specs/*.flow.json             — the executable e2e flow specs that predate this
#   */specs/*/assets/*.(png|jpg|jpeg|gif|webp|svg)  — design evidence
# Anything else is denied: exit 2 blocks the call and returns stderr to the model.

input=$(cat)

if command -v jq >/dev/null 2>&1; then
  path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
else
  path=$(printf '%s' "$input" | sed -n 's/.*"\(file_path\|notebook_path\)"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\2/p' | head -n 1)
fi

[ -z "$path" ] && exit 0

case "$path" in
  */specs/*|specs/*) ;;
  *) exit 0 ;;
esac

case "$path" in
  *.md) exit 0 ;;
  */e2e/specs/*.flow.json|e2e/specs/*.flow.json) exit 0 ;;
  */assets/*.png|*/assets/*.jpg|*/assets/*.jpeg|*/assets/*.gif|*/assets/*.webp|*/assets/*.svg) exit 0 ;;
esac

echo "Blocked by .claude/hooks/specs-write-guard.sh: '$path' is under specs/, where only .md specifications, e2e *.flow.json flows, and assets/ images may be written. Specifications are created with /spec; code and docs belong outside specs/." >&2
exit 2
