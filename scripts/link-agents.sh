#!/usr/bin/env bash
#
# Agent instructions live in AGENTS.md (the cross-tool convention). Claude Code
# reads CLAUDE.md, so point one at the other with a symlink rather than keeping
# two copies in sync by hand.
#
# The symlinks are gitignored: committing them would hand a Windows clone
# without Developer Mode a one-line text file reading "AGENTS.md" instead of a
# link. So each checkout re-creates them — this script is idempotent and
# scripts/dev.sh calls it on boot.
#
#   ./scripts/link-agents.sh            # create/refresh the links
#   ./scripts/link-agents.sh --check    # report only, exit 1 if any are missing

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

missing=0
linked=0

# Every directory that has agent instructions. Add new packages here.
for dir in . server client reviewer-core e2e; do
  src="$dir/AGENTS.md"
  dest="$dir/CLAUDE.md"
  [ -f "$src" ] || continue

  # Already the right symlink? Nothing to do. `-ef` compares by inode, so this
  # is true whether dest is the link or (on a Windows checkout) a real copy.
  if [ -L "$dest" ] && [ "$dest" -ef "$src" ]; then
    continue
  fi

  if [ "$CHECK" -eq 1 ]; then
    echo "missing or stale: $dest -> AGENTS.md"
    missing=$((missing + 1))
    continue
  fi

  # Refuse to clobber a real file — that would be somebody's un-migrated notes.
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    echo "! $dest is a regular file, not a symlink — leaving it alone" >&2
    missing=$((missing + 1))
    continue
  fi

  ln -sfn AGENTS.md "$dest"
  linked=$((linked + 1))
done

if [ "$CHECK" -eq 1 ]; then
  [ "$missing" -eq 0 ] && echo "all CLAUDE.md -> AGENTS.md links present"
  exit $([ "$missing" -eq 0 ] && echo 0 || echo 1)
fi

echo "linked $linked CLAUDE.md -> AGENTS.md symlink(s)"
exit $([ "$missing" -eq 0 ] && echo 0 || echo 1)
