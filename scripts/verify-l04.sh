#!/usr/bin/env bash
# verify-l04.sh — one command that checks everything L04 promised.
#
# Same contract as verify-l03.sh: every check RUNS even after an earlier one
# fails, and the exit status is the number of failures. A verifier that stops at
# the first problem hides the other three.
set -uo pipefail
cd "$(dirname "$0")/.."

FAILURES=0
check() {
  local name="$1"; shift
  printf '  %-52s' "$name"
  if out=$("$@" 2>&1); then
    echo "ok"
  else
    echo "FAIL"
    echo "$out" | sed 's/^/      /' | tail -12
    FAILURES=$((FAILURES + 1))
  fi
}

# Strip comments before grepping for code. Without this, a comment that NAMES the
# forbidden thing ("Nothing here touches `container.llm`") fails the check that
# it exists to document — which is how the first version of this script failed.
code_only() {
  sed -e 's://.*::' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' "$1"
}

# A check that passes when its command prints NOTHING.
empty() {
  local name="$1"; shift
  printf '  %-52s' "$name"
  out=$("$@" 2>&1)
  if [ -z "$out" ]; then
    echo "ok"
  else
    echo "FAIL"
    echo "$out" | sed 's/^/      /' | head -12
    FAILURES=$((FAILURES + 1))
  fi
}

echo "L04 — invariants"
# The vendored contracts are a do-not-touch zone AND must stay byte-identical.
# L04 deliberately declares its HTTP envelope module-locally so neither is
# disturbed (see docs/research/l04-blast-radius-plan.md, R1).
empty "vendored shared copies are identical"  diff -rq server/src/vendor/shared client/src/vendor/shared
empty "no writes under vendor/shared"          git status --porcelain server/src/vendor/shared client/src/vendor/shared
empty "no DB migration"                        git status --porcelain server/src/db
empty "run-executor.ts unmodified"             git diff --stat server/src/modules/reviews/run-executor.ts
empty "no committed .mcp.json"                 git ls-files .mcp.json
empty "dev.sh stays decoupled from mcp/"       grep -n "mcp" scripts/dev.sh

echo "L04 — blast rules"
# The GET path must never reach a model; the summary route is the only one that may.
empty "no LLM call on the blast GET path" \
  bash -c 'code_only() { sed -e "s://.*::" -e "/^[[:space:]]*\*/d" "$1"; }; code_only server/src/modules/blast/service.ts | grep -nE "container\.llm|\.complete\("'
# The CLI must reuse the server's reviewer, never import the engine directly.
empty "mcp/ does not import reviewer-core"     grep -rlE "^\s*import .*reviewer-core" mcp/src

echo "L04 — typecheck"
check "server typecheck"        bash -c 'cd server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json'
check "client typecheck"        bash -c 'cd client && ./node_modules/.bin/tsc --noEmit -p tsconfig.json'
check "mcp typecheck (+tests)"  bash -c 'cd mcp && ./node_modules/.bin/tsc --noEmit -p tsconfig.json'

echo "L04 — tests"
check "server unit"  bash -c "cd server && ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'"
check "client"       bash -c 'cd client && ./node_modules/.bin/vitest run'
check "mcp"          bash -c 'cd mcp && ./node_modules/.bin/vitest run'

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "L04: all checks passed."
else
  echo "L04: $FAILURES check(s) failed."
fi
exit "$FAILURES"
