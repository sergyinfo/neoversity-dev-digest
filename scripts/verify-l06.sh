#!/usr/bin/env bash
#
# DevDigest L06 verification — the Eval Pipeline, in one command.
#
#   ./scripts/verify-l06.sh              # everything
#   ./scripts/verify-l06.sh --no-it      # skip the Docker-backed integration tests
#
# Also reachable as `pnpm verify:l06` from server/ or client/ (there is no root
# package.json — that is why the script is registered in both).
#
# Same contract as verify-l03.sh / verify-l04.sh: EVERY check runs even after an
# earlier one fails, and the exit status is the number of failures. A verifier
# that stops at the first problem hides the rest.
#
# What it asserts, and why each one is here:
#
#   1. The two vendored contract copies are byte-identical, and neither they nor
#      server/src/db/migrations were touched BY THIS BRANCH (diffed against the
#      merge base, not against the working tree — see the check itself). L06
#      shipped its tables in 0000_init.sql and its envelope module-locally, so a
#      diff in either place means someone re-opened a settled decision.
#   2. `eval_cases` and `eval_runs` really are in 0000_init.sql (the spec's
#      "the two tables exist" condition) — no migration was needed, and none
#      may appear.
#   3. REC-4, the "no model in scoring" invariant, statically: the scorer and
#      the repository never reach an LLM, service.ts never INVOKES the provider
#      it legitimately holds, and nothing under modules/evals/ calls
#      `assemblePrompt` directly (which is what keeps the stored, attacker-
#      controlled `input_diff` behind `wrapUntrusted`).
#   4. Typecheck and test every package.
#
# The remaining spec conditions — a case creatable from an accepted AND from a
# dismissed finding, a run producing all three metrics, and >= 8 cases in the
# set — are asserted by server/test/evals.it.test.ts and
# server/test/evals-seed.it.test.ts against a real Postgres. They are NOT
# re-implemented here: bash cannot see a database, and a second, weaker copy of
# an assertion is worse than none. The integration check below is how they run.
#
# DOCKER: do not copy verify-l03.sh:41-47's shim. It substitutes the OrbStack
# socket only when /var/run/docker.sock is ABSENT — but on a machine that has
# ever run Docker Desktop that path exists as a symlink, so the condition is
# false, the shim stays silent, and testcontainers dies on a dead socket while
# `docker info` reports everything is fine (server/INSIGHTS.md, 2026-08-20).
# We probe each candidate endpoint for a LIVE DAEMON instead, and if none
# answers we FAIL the integration check rather than skipping it — a silent skip
# reading as a pass is exactly how "38 integration passing" gets claimed by a
# run that never started a container.

set -uo pipefail

# Resolve both BEFORE the cd — `pnpm verify:l06` invokes this as the relative
# path "../scripts/verify-l06.sh", which stops resolving once we leave the
# calling package's directory.
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_IT=1
case "${1:-}" in
  --no-it) RUN_IT=0 ;;
  -h|--help) sed -n '2,10p' "$SELF" | sed 's/^# \{0,1\}//'; exit 0 ;;
  "") ;;
  *) echo "unknown argument: $1 (expected --no-it)" >&2; exit 2 ;;
esac

FAILURES=0

# A check that passes when its command EXITS ZERO.
check() {
  local name="$1"; shift
  printf '  %-56s' "$name"
  if out=$("$@" 2>&1); then
    echo "ok"
  else
    echo "FAIL"
    echo "$out" | tail -25 | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# A check that passes when its command prints NOTHING.
empty() {
  local name="$1"; shift
  printf '  %-56s' "$name"
  out=$("$@" 2>&1)
  if [ -z "$out" ]; then
    echo "ok"
  else
    echo "FAIL"
    echo "$out" | head -12 | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# Record a failure that has no command behind it (an unmet precondition).
fail() {
  printf '  %-56s' "$1"
  echo "FAIL"
  shift
  for line in "$@"; do echo "      $line"; done
  FAILURES=$((FAILURES + 1))
}

# Strip comments before grepping for code. Without this, a comment that NAMES
# the forbidden thing fails the check that exists to document it — which is how
# the first version of verify-l04.sh failed, and modules/evals/scoring.ts:10-11
# and service.ts:53 both name `container.llm` / `assemblePrompt` in prose.
code_only() {
  sed -e 's://.*::' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' "$1"
}

# ---------------------------------------------------------------------------
# Docker: probe for a live daemon, never for a file's absence.
# ---------------------------------------------------------------------------
DOCKER_ENDPOINT=""

endpoint_live() { # endpoint_live <docker-host-url>
  DOCKER_HOST="$1" docker version --format '{{.Server.Version}}' >/dev/null 2>&1
}

resolve_docker() {
  command -v docker >/dev/null 2>&1 || return 1
  if [[ -n "${DOCKER_HOST:-}" ]]; then
    # The caller pinned one; honour it, but only if something answers on it.
    endpoint_live "$DOCKER_HOST" && DOCKER_ENDPOINT="$DOCKER_HOST" && return 0
    return 1
  fi
  local cand
  for cand in \
    "unix:///var/run/docker.sock" \
    "unix://$HOME/.orbstack/run/docker.sock" \
    "unix://$HOME/.docker/run/docker.sock" \
    "unix://$HOME/.colima/default/docker.sock"; do
    if endpoint_live "$cand"; then
      DOCKER_ENDPOINT="$cand"
      export DOCKER_HOST="$cand"
      return 0
    fi
  done
  return 1
}

# ---------------------------------------------------------------------------
echo "L06 — protected zones"
# The two vendored copies are hand-maintained; this is the only mechanical check
# that they have not drifted (server/INSIGHTS.md, 2026-08-17).
empty "vendored shared copies are identical" \
  diff -rq server/src/vendor/shared client/src/vendor/shared

# L06 adds no contract and no migration: both eval tables already ship in
# 0000_init.sql and the HTTP envelope is module-local.
#
# The invariant is about what the BRANCH DID, so it is checked against the merge
# base — not with `git status --porcelain`, which reports only the working tree.
# On any committed branch (i.e. every branch a reviewer or CI checks out) the
# tree is clean, so the porcelain form printed nothing and passed regardless of
# what the branch had committed into the protected zones: a green result that
# cost nothing. The working tree is still checked as well, so an edit is caught
# before it is committed too, but the branch diff is the invariant.
PROTECTED=(server/src/vendor/shared client/src/vendor/shared server/src/db/migrations)

protected_zones_untouched() {
  local base=""
  local ref
  for ref in main origin/main; do
    if base="$(git merge-base "$ref" HEAD 2>/dev/null)"; then break; fi
    base=""
  done
  if [[ -z "$base" ]]; then
    # Loud, not silent: without a base there is no branch-level check at all,
    # and a check that cannot run must not report "ok".
    echo "cannot resolve 'main' or 'origin/main' — the branch-level protected-zone check DID NOT RUN"
    return 1
  fi
  git diff --name-only "$base" HEAD -- "${PROTECTED[@]}"
  git status --porcelain -- "${PROTECTED[@]}"
}
empty "no contract edit, no migration (branch vs main)" protected_zones_untouched

echo "L06 — schema"
eval_tables_present() {
  local sql="server/src/db/migrations/0000_init.sql"
  local missing=()
  grep -q 'CREATE TABLE "eval_cases"' "$sql" || missing+=("eval_cases not created in $sql")
  grep -q 'CREATE TABLE "eval_runs"' "$sql" || missing+=("eval_runs not created in $sql")
  if [ ${#missing[@]} -gt 0 ]; then printf '%s\n' "${missing[@]}"; return 1; fi
}
check "eval_cases + eval_runs exist in 0000_init.sql" eval_tables_present

echo "L06 — no model in scoring (REC-4)"
no_llm_in() { # no_llm_in <file>
  code_only "$1" | grep -nE 'container\.llm|\.complete\(|completeStructured' | sed "s|^|$1:|"
}
# service.ts is the ONE file in the module that legitimately holds a provider:
# it calls `container.llm(...)` to obtain the LLMProvider it hands to
# `reviewPullRequest`. So `no_llm_in` cannot be applied to it — which is why it
# was not, and why appending a direct `completeStructured` call to service.ts
# left every check in this script green while the module's own docstring
# (service.ts, "Nothing in this module assembles a prompt by hand") claimed
# otherwise. What is forbidden here is INVOKING the provider directly; obtaining
# it is not.
no_direct_model_call() { # no_direct_model_call <file>
  code_only "$1" | grep -nE '\.complete\(|completeStructured' | sed "s|^|$1:|"
}
# Recursive, not `evals/*.ts`: a glob only ever sees today's flat file list, so
# a future subdirectory would be exempt from the check by accident.
no_assemble_prompt() {
  local f
  while IFS= read -r f; do
    code_only "$f" | grep -n 'assemblePrompt' | sed "s|^|$f:|"
  done < <(find server/src/modules/evals -name '*.ts' -type f | sort)
}
empty "scoring.ts reaches no LLM"           no_llm_in server/src/modules/evals/scoring.ts
empty "repository.ts reaches no LLM"        no_llm_in server/src/modules/evals/repository.ts
empty "service.ts invokes no model directly" no_direct_model_call server/src/modules/evals/service.ts
# The stored input_diff is attacker-controlled content replayed on every future
# run; it may reach a model only via reviewPullRequest, whose assemblePrompt
# wraps it in wrapUntrusted() unconditionally. A hand-rolled prompt would skip that.
empty "evals/ never calls assemblePrompt directly" no_assemble_prompt

echo "L06 — typecheck"
for pkg in server client reviewer-core e2e; do
  check "$pkg typecheck" bash -c "cd '$ROOT/$pkg' && npm run -s typecheck"
done

echo "L06 — tests"
check "reviewer-core" bash -c "cd '$ROOT/reviewer-core' && npm run -s test"
check "client"        bash -c "cd '$ROOT/client' && npm run -s test"
# Server test files split by name: *.it.test.ts are the DB-backed ones.
check "server (unit)" bash -c "cd '$ROOT/server' && ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'"

if [[ $RUN_IT -eq 0 ]]; then
  echo "  ..   server integration SKIPPED (--no-it) — the spec conditions it carries were NOT checked"
elif resolve_docker; then
  echo "  ..   DOCKER_HOST -> $DOCKER_ENDPOINT (probed live)"
  # evals.it.test.ts and evals-seed.it.test.ts live in here: a case from an
  # accepted AND from a dismissed finding, a run producing all three metrics,
  # and >= 8 seeded cases. That is where the spec's remaining conditions are.
  check "server (integration — delegated spec conditions)" \
    bash -c "cd '$ROOT/server' && ./node_modules/.bin/vitest run .it.test"
else
  fail "server (integration) — NO LIVE DOCKER DAEMON" \
    "Probed DOCKER_HOST=${DOCKER_HOST:-<unset>}, /var/run/docker.sock, ~/.orbstack/run/docker.sock," \
    "~/.docker/run/docker.sock and ~/.colima/default/docker.sock — none answered." \
    "The delegated spec conditions (case from each decision type, all three" \
    "metrics on a run, >= 8 cases) were NOT checked. This is a FAILURE, not a" \
    "skip: start Docker/OrbStack, or re-run with --no-it and say so out loud."
fi

echo
echo "  ..   e2e is not run here — it needs a live, freshly-seeded stack."
echo "  ..   Run it with: ./scripts/e2e.sh   (hermetic; includes 10-evals.flow.json)"
echo
if [ "$FAILURES" -eq 0 ]; then
  echo "L06 verification passed."
else
  echo "L06 verification FAILED — $FAILURES check(s) above."
fi
exit "$FAILURES"
