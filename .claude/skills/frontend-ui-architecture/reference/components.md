# Component boundaries

## Deciding the split

Four lenses on the same UI. Use whichever answers fastest:

1. **Responsibility.** Would you extract this as a function? A component should be concerned with one thing. The tell is *why* it changes: two unrelated reasons to edit it means two components.
2. **Data model.** A well-shaped API response usually maps to component structure. One component per meaningful entity in the payload.
3. **Design.** The layers a designer drew are usually real boundaries.
4. **CSS.** Roughly what you would write a class selector for — but components are less granular than classes, so this over-splits if used alone.

Line count is not a lens. A long component with one job is fine.

## Splitting by state, not by nesting

Nested ternaries in JSX are the most common reason a component becomes unreadable. Extract
the shared layout and use early returns per state:

```tsx
// ✗ every state tangled in one return
return (
  <Card>
    {loading ? <Spinner /> : error ? <Error e={error} /> : items.length === 0
      ? <Empty />
      : <List items={items} />}
  </Card>
);

// ✓ one branch per state, shared shell
if (loading) return <Shell><Spinner /></Shell>;
if (error)   return <Shell><Error e={error} /></Shell>;
if (!items.length) return <Shell><Empty /></Shell>;
return <Shell><List items={items} /></Shell>;
```

Repeating `<Shell>` is not duplication worth removing — it is what lets the branches
evolve apart. If the shell starts taking conditional props to serve every branch, it is
the wrong abstraction; split it.

## Composition over configuration

When a component grows props to cover new cases, stop adding props and let the caller
assemble it.

**Boolean props are the warning sign.** `<Modal showHeader showFooter dismissible large>`
is a component that wants to be composed.

```tsx
// ✗ configuration
<Card title="Users" showAction actionLabel="Add" onAction={add} collapsible />

// ✓ composition
<Card>
  <Card.Header action={<Button onClick={add}>Add</Button>}>Users</Card.Header>
  <Card.Body>…</Card.Body>
</Card>
```

Techniques, in rough order of reach:

- **`children` as a slot.** The default. Cheapest and most flexible.
- **Named slots as props** (`header`, `footer`) when position matters and there are few of them.
- **Compound components** sharing context (`Card.Header`) when parts must coordinate without prop drilling.
- **Explicit variants** — `<EditComposer>` and `<ReplyComposer>` as separate components — when the "variant" prop would change behaviour rather than appearance.

Prefer `children` over render props unless the child genuinely needs values the parent
owns.

## Where state lives

The algorithm from the React docs, applied literally:

1. List every component that renders based on this state.
2. Find their closest common parent.
3. Put the state there — or in a component above it, if that reads better.
4. If no existing component fits, create one whose job is holding that state.

Then: **keep it as low as it will go.** State lifted higher than necessary re-renders more
of the tree and couples unrelated components.

**Do not reach for global state** because passing props two levels felt tedious. Prop
drilling through 2–3 levels is fine. Drilling through 5 is a signal to compose differently
(pass `children`) before it is a signal to add context.

Context is for state that is genuinely ambient — theme, session, locale — or for compound
components coordinating internally. Placing a provider high in the tree is a performance
and coupling decision, so put it as low as its consumers allow.

## Do not use container/presentational

Splitting a component into `FooContainer` (logic) and `Foo` (markup) is a pre-hooks
pattern. Its author publicly retracted it: *"I don't suggest splitting your components
like this anymore."* Custom hooks do the same separation without the arbitrary wrapper.

If you find it already in a codebase, leave it — it works. Do not add it to new code.
