#!/usr/bin/env bash
#
# DevDigest L03 verification — Intent Layer + Smart Diff, in one command.
#
#   ./scripts/verify-l03.sh              # everything
#   ./scripts/verify-l03.sh --no-it      # skip the Docker-backed integration tests
#
# Also reachable as `pnpm verify:l03` from server/ or client/.
#
# Runs, in order: vendor-copy parity, typecheck across all four packages, then
# every suite. Integration tests need Docker; see DOCKER_HOST below.
#
# Exit status is the number of failed checks, so CI can gate on it. Every check
# runs even when an earlier one fails — a green typecheck telling you nothing
# about the suites is exactly the trap this script exists to close.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_IT=1
[[ "${1:-}" == "--no-it" ]] && RUN_IT=0

FAILED=0
PASS="  ok  "
FAIL="  FAIL"

check() { # check <label> <command...>
  local label="$1"; shift
  local out
  if out=$("$@" 2>&1); then
    echo "$PASS $label"
  else
    echo "$FAIL $label"
    echo "$out" | tail -25 | sed 's/^/        /'
    FAILED=$((FAILED + 1))
  fi
}

# Testcontainers does its own socket discovery and ignores the docker CLI's
# active context, so on macOS + OrbStack `docker info` succeeds while the
# integration suites fail to start. Point it at the active endpoint if the
# caller has not already. See server/INSIGHTS.md (2026-08-20).
if [[ -z "${DOCKER_HOST:-}" && -S "$HOME/.orbstack/run/docker.sock" && ! -S /var/run/docker.sock ]]; then
  export DOCKER_HOST="unix://$HOME/.orbstack/run/docker.sock"
  echo "  ..   DOCKER_HOST -> $DOCKER_HOST (OrbStack)"
fi

echo "== contracts =="
# The two vendored copies are hand-maintained; this is the only mechanical check
# that they have not drifted.
check "vendor/shared parity" diff -rq server/src/vendor/shared client/src/vendor/shared

echo "== typecheck =="
for pkg in server client reviewer-core e2e; do
  check "$pkg" bash -c "cd '$ROOT/$pkg' && npm run -s typecheck"
done

echo "== tests =="
check "reviewer-core" bash -c "cd '$ROOT/reviewer-core' && npm run -s test"
check "client" bash -c "cd '$ROOT/client' && npm run -s test"

if [[ $RUN_IT -eq 1 ]]; then
  check "server (unit + integration)" bash -c "cd '$ROOT/server' && npm run -s test"
else
  # Server test files split by name: *.it.test.ts are the DB-backed ones.
  check "server (unit only)" bash -c "cd '$ROOT/server' && npx vitest run --exclude '**/*.it.test.ts'"
  echo "  ..   integration tests SKIPPED (--no-it)"
fi

echo
if [[ $FAILED -eq 0 ]]; then
  echo "L03 verification passed."
else
  echo "L03 verification FAILED — $FAILED check(s) above."
fi
exit "$FAILED"
