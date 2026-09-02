# onion-architecture v1 — frozen baseline

The version of `.claude/skills/onion-architecture` as it stood before the module-boundary
rules were added. Kept here, in git, because the A/B compares v2 against *this* — a
baseline that lives only in a gitignored results directory cannot be re-run.

v2 adds one section, "Module boundaries", encoding three DevDigest conventions that no
general Onion knowledge implies: modules do not import each other's internals, repo-intel
is reached only through `container.repoIntel.*`, and registration is one static line in
`modules/index.ts`. Everything else is byte-identical.

Do not edit. To change the baseline, take a new snapshot and start a new iteration.
