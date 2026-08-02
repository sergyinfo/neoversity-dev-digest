# Next.js App Router architecture

Architecture only. For file conventions, RSC validity rules, caching and data-fetching
mechanics, see the `next-best-practices` skill.

## The core tension

`app/` is shaped by **routing**. Your architecture is shaped by **domains**. Putting
components, hooks and logic directly into route folders is how App Router projects become
unmaintainable — the structure ends up describing URLs instead of the product.

Resolution used by every serious source: **`app/` holds routing and composition only.**

```
src/
├── app/                    routing + composition
│   ├── layout.tsx
│   ├── (marketing)/        route group — organizes, no URL segment
│   └── checkout/
│       ├── page.tsx        composes the screen
│       ├── actions.ts      server actions for this domain
│       └── _components/    genuinely route-local UI (underscore = not routable)
├── features/checkout/      the actual feature code
└── data/                   server-only data access
```

Three mechanics make this work:

- **Colocation is safe.** A folder is not routable without `page` or `route`, so support files can sit beside a route without becoming URLs.
- **`_folder`** opts an entire subtree out of routing — the explicit escape hatch.
- **`(group)`** organizes routes by section or team without touching the URL, and lets a subset share a layout.

## Pages are compositors

A page should read like an assembly list, not an implementation.

- Pages stay **synchronous**. They place components and arrange `Suspense` boundaries.
- **Suspense belongs at the page level**, where the loading sequence is a deliberate design decision — not scattered through the tree where nobody can see the resulting waterfall.
- Colocate a component's skeleton with the component, exported from the same file, so the two cannot drift.

## Async components fetch their own data

```tsx
// ✓ self-contained: composable into any page
export async function WhoToFollow() {
  const handle = await getCurrentUserHandle();
  const users = await getWhoToFollow(handle);
  return <UserList users={users} />;
}
```

Threading props down from a page-level loader couples the component to that page. A
component that resolves its own dependencies can be dropped into any route.

The trade-off is real and worth stating: self-fetching components move waterfall risk into
the tree, which is exactly why the page must own the `Suspense` layout deliberately.

## The `'use client'` boundary

`'use client'` marks the seam between two module graphs. Everything a client module
**imports** joins the client bundle. Components passed as `children` or props do **not** —
they render on the server and arrive as output.

That asymmetry is the whole technique:

```tsx
// ✓ server content stays on the server
<ClientAccordion>
  <ExpensiveServerRenderedContent />
</ClientAccordion>
```

Rules:

- Push `'use client'` to the **smallest leaf** that needs state, handlers or browser APIs.
- Keep server components at the top of the tree; pass data down as narrow props.
- Never put `'use client'` in a root layout. It turns the entire app back into a client-rendered SPA — the single most common migration mistake.

Boundary decision, in order: does it use state or effects? event handlers? browser APIs?
If none, it stays a server component.

## Server Actions

- **Colocate with the domain they mutate** — `checkout/actions.ts`. A global `actions/` folder recreates exactly the layer-packaging problem features were meant to solve.
- Keep them **thin**: validate input, delegate to data access, revalidate. Business logic lives elsewhere.
- Client components can only call actions from a separate file with a module-level `'use server'` — a useful forcing function for a clean file-level seam.

**The trap worth memorising:** a page-level auth check does **not** protect a Server Action
defined in that page. The action is a separate entry point reachable by direct POST. It
must re-verify.

```ts
export async function deletePost(postId: string) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const post = await db.post.findUnique({ where: { id: postId } });
  if (post.authorId !== session.user.id) throw new Error('Forbidden'); // authz, not just authn

  await db.post.delete({ where: { id: postId } });
}
```

Check **authorization** (may this user act on this resource?), not just authentication
(is anyone logged in?). The second without the first is an IDOR.

## Data Access Layer

For new projects, centralize data access in a dedicated module. It should:

- Run **only on the server** — `import 'server-only'`.
- Perform its **own authorization checks**, so no call site can bypass them.
- Return **narrow DTOs**, not ORM instances or full rows.
- Be the **only** place that reads `process.env` secrets.

Pick one data-access approach for the project and do not mix them: external HTTP APIs
(existing backends), a DAL (new projects), or queries straight in components (prototypes
only — it makes leaking private fields to the client easy).

Return values from Server Actions are serialized to the client. Return what the UI needs,
never the raw record.

## Structural review checklist

- [ ] Is there logic in `app/` that is not routing or composition?
- [ ] `'use client'` above the leaf that needs it — or in a layout?
- [ ] Do client component props accept more data than they render?
- [ ] Does each Server Action re-verify auth **and** resource ownership?
- [ ] Are database packages and secrets imported outside the data-access module?
- [ ] Are `[param]` values validated? They are user input.
