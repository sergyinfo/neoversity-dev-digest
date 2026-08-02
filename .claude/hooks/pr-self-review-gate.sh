#!/usr/bin/env bash
#
# PreToolUse gate for `gh pr create` / `gh pr merge`.
#
# Reads the verdict written by the pr-self-review skill and denies the call when it
# is BLOCKED, missing, or stale. Emits the JSON contract on stdout and always exits 0 —
# a non-zero exit here would be reported as a hook failure rather than a decision.
#
# Scope, stated plainly: this only blocks the AGENT. A human typing the same command in
# their own terminal is unaffected, as is the GitHub merge button. Real merge-blocking is
# branch protection plus a required check.
set -uo pipefail

allow() { printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n'; exit 0; }

# Self-filter on the command rather than relying on the settings `if` matcher.
# Learned the hard way: when the matcher does not narrow as expected, a gate wired to
# `matcher: "Bash"` denies EVERY shell call and the repo becomes unusable. Deciding here
# is version-independent and fails open for anything that is not a PR-opening command.
INPUT="$(cat 2>/dev/null || true)"
if [ -n "$INPUT" ]; then
  CMD="$(printf '%s' "$INPUT" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except Exception: print("")' 2>/dev/null || true)"
  case "$CMD" in
    *"gh pr create"*|*"gh pr merge"*) : ;;   # gate these
    *) allow ;;                              # everything else passes straight through
  esac
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
VERDICT="$ROOT/.claude/.pr-review-verdict.json"

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' \
    "$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
  exit 0
}

# Not a git repo, or no verdict file → nothing reviewed yet.
HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
[ -z "$HEAD_SHA" ] && deny "Not a git repository — cannot verify a pre-PR review."

[ -f "$VERDICT" ] && [ -r "$VERDICT" ] || \
  deny "No pre-PR review found. Run /pr-self-review first (or /pr-self-review --skip-review to record an explicit skip)."

read -r STATE SHA REASON < <(
  python3 - "$VERDICT" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print(f"UNREADABLE - {e}"); raise SystemExit
print(d.get("verdict", "MISSING"), d.get("sha", "none"), (d.get("skipReason") or "-").replace("\n", " "))
PY
)

case "$STATE" in
  UNREADABLE)
    deny "The pre-PR verdict file is unreadable ($REASON). Re-run /pr-self-review." ;;
  SKIPPED)
    [ "$SHA" = "$HEAD_SHA" ] || deny "A review was skipped for a different commit ($SHA). Re-run /pr-self-review for $HEAD_SHA."
    allow ;;
  PASS|PASS_WITH_ADVISORIES)
    [ "$SHA" = "$HEAD_SHA" ] || \
      deny "The pre-PR review passed for $SHA but HEAD is now $HEAD_SHA. A stale verdict is worse than none — re-run /pr-self-review."
    allow ;;
  BLOCKED)
    deny "Pre-PR review BLOCKED this change: at least one verified CRITICAL finding or a failed gate. See .claude/.pr-review-verdict.json for the file:line list. Fix them, or record an explicit override with /pr-self-review --skip-review." ;;
  *)
    deny "Unrecognised verdict '$STATE'. Re-run /pr-self-review." ;;
esac
