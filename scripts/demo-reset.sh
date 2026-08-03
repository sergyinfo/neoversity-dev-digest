#!/usr/bin/env bash
# L02 demo reset — run right before you hit record.
# Puts the app back into the "nothing has happened yet" state so every step
# on camera actually does something. Read-only against git; only touches the API.
set -euo pipefail

API=http://localhost:3001
REPO_FULL=sergyinfo/neoversity-dev-digest
AGENT_NAME="API Contract Reviewer"
PR_NUMBER=3

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }

# ---------- 0. guards ----------
say "0. Guards"
cd "$(git rev-parse --show-toplevel)"
BRANCH=$(git branch --show-current)
if [ "$BRANCH" = "experiment/api-contract-change" ]; then
  echo "  ✗ You are on the experiment branch. tsx watch would reload the server with"
  echo "    the broken contract and every review would fail. Run:"
  echo "      git checkout lesson-3/intent-smart-diff"
  exit 1
fi
ok "branch: $BRANCH"
curl -sf "$API/health" >/dev/null 2>&1 || curl -sf "$API/repos" >/dev/null
ok "API is up"

# ---------- 1. delete the conventions skill ----------
say "1. Delete the extracted conventions skill (so 'Create skill' has no name collision)"
IDS=$(curl -s "$API/skills" | python3 -c "
import json,sys
print(' '.join(s['id'] for s in json.load(sys.stdin) if s['name'].endswith('-conventions')))")
if [ -z "$IDS" ]; then ok "none present"; else
  for id in $IDS; do curl -s -X DELETE "$API/skills/$id" >/dev/null; ok "deleted $id"; done
fi

# ---------- 2. unlink skills from the agent ----------
say "2. Unlink all skills from '$AGENT_NAME' (run A needs a clean control)"
AGENT=$(curl -s "$API/agents" | python3 -c "
import json,sys
print(next(a['id'] for a in json.load(sys.stdin) if a['name']=='$AGENT_NAME'))")
curl -s -X POST "$API/agents/$AGENT/skills" \
  -H 'content-type: application/json' -d '{"skill_ids":[]}' >/dev/null
ok "agent $AGENT now has $(curl -s "$API/agents/$AGENT/skills" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))') linked skills"

# ---------- 3. enable the agent ----------
say "3. Enable the agent (removes the '· disabled' hint from the Run Review menu)"
curl -s -X PATCH "$API/agents/$AGENT" \
  -H 'content-type: application/json' -d '{"enabled":true}' >/dev/null
ok "enabled"

# ---------- 4. delete previous runs on the experiment PR ----------
say "4. Delete previous runs on PR #$PR_NUMBER (Agent runs tab must start empty)"
REPO=$(curl -s "$API/repos" | python3 -c "
import json,sys
print(next(r['id'] for r in json.load(sys.stdin) if r['full_name']=='$REPO_FULL'))")
PR=$(curl -s "$API/repos/$REPO/pulls" | python3 -c "
import json,sys
print(next(p['id'] for p in json.load(sys.stdin) if p['number']==$PR_NUMBER))")
# the runs list keys the id as `run_id`, not `id`
RUNS=$(curl -s "$API/pulls/$PR/runs" | python3 -c "
import json,sys;print(' '.join(r['run_id'] for r in json.load(sys.stdin)))")
if [ -z "$RUNS" ]; then ok "none present"; else
  for id in $RUNS; do curl -s -X DELETE "$API/runs/$id" >/dev/null; done
  ok "deleted $(echo "$RUNS" | wc -w | tr -d ' ') run(s)"
fi

# ---------- 5. verify ----------
say "5. Final state"
python3 - "$API" "$AGENT" "$PR" <<'PY'
import json,sys,urllib.request
api,agent,pr = sys.argv[1:4]
g = lambda p: json.load(urllib.request.urlopen(api+p))
print(f"  skills in library : {len(g('/skills'))}  ({', '.join(s['name'] for s in g('/skills'))})")
print(f"  linked to agent   : {len(g(f'/agents/{agent}/skills'))}   <- must be 0")
print(f"  runs on PR #3     : {len(g(f'/pulls/{pr}/runs'))}   <- must be 0")
PY

cat <<'EOF'

Ready. Two things this script deliberately does NOT do:
  - It does not clear conventions. The scan replaces them (delete-then-insert),
    and running the scan on camera is the point.
  - It does not touch git. Your working tree is untouched.
EOF
