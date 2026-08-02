# Logic, constants and utilities

## The three homes

```
pure function   business logic, no React      → testable in plain Node
custom hook     React wiring around it        → state, effects, subscriptions
component       rendering                     → reads hooks, returns JSX
```

Worked example:

```ts
// utils/exponent.ts — pure. No React import. Test with any runner.
export function calculateExponent(base: number, exp: number) { … }
```
```ts
// hooks/use-exponent.ts — React wiring only.
export function useExponent() {
  const [base, setBase] = useState(0);
  const [exp, setExp] = useState(0);
  return { base, exp, setBase, setExp, result: calculateExponent(base, exp) };
}
```
```tsx
// ExponentForm.tsx — rendering only.
export function ExponentForm() {
  const { base, exp, setBase, setExp, result } = useExponent();
  return …;
}
```

**The test:** could this run in a Node script with no DOM? If yes it is a pure function,
and putting it in a hook makes it harder to test for no benefit.

**The guard:** a component with a few lines of logic does not need three files. Extract on
the second reason to, not the first. Splitting a 20-line component across three files is
over-engineering, and it is the more common failure in practice than the reverse.

## What belongs in a hook

Yes — state, effects, subscriptions, refs, context reads, event handler wiring, data
fetching, anything calling a React API.

No — pure calculation, formatting, validation, mapping, sorting. These take inputs and
return outputs; a hook adds a React dependency and a renderer requirement to test them.

A hook that never calls a React API is a function with extra steps. Rename it.

## Domain logic must not import React

The strongest available signal that a layer boundary is intact: if the module that knows
your business rules imports React, the boundary has leaked.

This matters beyond purity — it is what lets rules be reused by a different renderer, a
server route or a script, and what makes them testable without a DOM. Keep the dependency
arrow pointing inward: UI depends on domain, never the reverse.

The full clean-architecture apparatus (entities, use cases, ports, injected adapters) is
usually more ceremony than a UI needs. Take the direction rule and the no-React test;
adopt the rest only if the app genuinely warrants it.

## Constants

| Scope | Home |
|---|---|
| One file | `const` at module top |
| One feature | that feature's `constants.ts` |
| App-wide, fixed | shared `constants.ts` |
| From the environment | `config/` |

`config/` holds environment-derived values and nothing else. It is not the folder for
values that lack an obvious owner — those belong with their consumer.

Two failure modes, in order of frequency:

1. **The global constants dump.** Every module imports it, so it can never be split and it couples everything to everything. It grows because "shared" is easier than deciding on an owner.
2. **Extracting too eagerly.** `const ZERO = 0` and `const API_PATH = '/api'` used once add indirection without removing a magic value. A literal used once, in context, next to its use, is clear.

Extract a constant when the value is *repeated*, *tuned*, or *not self-explanatory at the
call site* — not merely because it is a literal.

## Utils vs helpers vs lib

- **`utils/`** — generic, portable, domain-free. Would work unchanged in an unrelated project.
- **`helpers/`** — project-specific. Knows your vocabulary but is not tied to one feature.
- **`lib/`** — configured third-party instances: the API client, the query client.

If it knows what a "checkout" is, it is not a util. If it is only used by checkout, it is
not shared at all — it lives in the feature.

## Promotion and demotion

**Promote on the second consumer.** Not the first, not in anticipation.

```
component-local helper  →  feature utils/  →  shared utils/
```

The move is mechanical and safe. Guessing wrong up front is what produces a shared folder
where most entries have one caller and nobody knows which are safe to delete.

**Demote too.** When code lands in a shared folder and turns out to have one consumer,
move it back. Shared folders only stay useful if things can leave them.

## Data access

Keep data access out of components. A component that renders should not also know the
shape of a request.

- Requests live in a feature's `api/` module, or a shared data-access module.
- On a server runtime, mark it `server-only` and perform authorization inside it — see [nextjs.md](nextjs.md).
- Return narrow objects shaped for the UI, not raw ORM rows or full API payloads. A wide return type encourages passing everything down and leaking fields.
