# Answer key — do NOT give this to an executor subagent

Three planted HIGH/CRITICAL findings per case, plus decoys that must NOT be reported.
Fixtures contain zero comments, so nothing in the code hints at the plants.

## case-1-auth (Express + Mongoose + JWT)

| # | OWASP | File:line | What |
|---|-------|-----------|------|
| 1.1 | A05 Injection | `src/routes/auth.routes.js:36` | `User.findOne({ email: req.body.email })` — no `String()` cast, MongoDB operator injection (`{"$ne": null}` / `{"$gt": ""}`) selects an arbitrary account |
| 1.2 | A07 Auth failures | `src/middleware/auth.js:18` | `jwt.decode(token)` instead of `jwt.verify()` — signature never checked, anyone can forge `role: 'admin'` |
| 1.3 | A04 Crypto failures | `src/middleware/auth.js:3` | `process.env.JWT_SECRET \|\| 'blogapp-dev-secret'` — hardcoded fallback secret, in-repo and low entropy |

Decoys (correct as written — reporting them is a false positive):
`register` casts every field with `String()`; `loginLimiter` is 5/15min on login; bcrypt cost 12;
generic `Invalid credentials` for both branches; `toJSON` strips the password; `jwt.sign` pins
`HS256` + `expiresIn`; `mongoose.connect(process.env.MONGODB_URI)` with `serverSelectionTimeoutMS`.

## case-2-posts (Express CRUD)

| # | OWASP | File:line | What |
|---|-------|-----------|------|
| 2.1 | A01 Broken access control | `src/controllers/posts.controller.js:70` | `remove()` calls `findByIdAndDelete` with no ownership/admin check — IDOR, any authenticated user deletes any post |
| 2.2 | A08 Integrity | `src/controllers/posts.controller.js:39` | `Post.create(req.body)` — mass assignment, caller sets `author`, `isPublished`, `isFeatured` |
| 2.3 | A05 Injection | `src/controllers/posts.controller.js:95` | `exec()` with `req.query.template` interpolated into the shell string — command injection |

Decoys: `router.use(requireAuth)` barrier is present and correctly placed after the two public
routes; `update()` *does* check ownership plus admin escape hatch; `list()` is bounded with
`.skip().limit()`; `buildThumbnail` uses `execFile` with an argument array; the Mongoose schema is
strict with `enum`/`required`/`maxlength`; `requireAuth` here uses `jwt.verify` with pinned algorithm.

## case-3-frontend (React + Express config)

| # | OWASP | File:line | What |
|---|-------|-----------|------|
| 3.1 | A05 XSS | `client/src/components/PostView.jsx:43` | `dangerouslySetInnerHTML={{ __html: post.body }}` with no DOMPurify — stored XSS from post body |
| 3.2 | A02 Misconfiguration | `server/src/app.js:18` | `cors({ origin: true, credentials: true })` — reflects any origin while allowing credentials |
| 3.3 | A05 XSS | `client/src/components/PostView.jsx:35` | `href={post.author.website}` with no protocol validation — `javascript:` URL XSS |

Decoys: `import.meta.env.VITE_API_URL` is a public base URL, not a secret; `{post.title}`,
`{comment.body}` and `{tag}` are JSX-escaped; `helmet()` is enabled with `crossOriginResourcePolicy`;
the stack trace is gated behind `NODE_ENV === 'development'`; the error handler has all 4 params;
`app.set('trust proxy', 1)` is set; `express.json({ limit: '100kb' })` is bounded.

---

# Iteration 2 — harder fixtures

Same shape: three planted issues per case, zero comments. The difference is that every plant now
needs the data flow traced across a helper or a second file, and every decoy is code that *looks*
like the vulnerable pattern but is correct.

## case-4-account-service (Express + Mongoose + JWT + profile)

| # | OWASP | File:line | What |
|---|-------|-----------|------|
| 4.1 | A05 Injection | `src/lib/identifier.js:8` reached from `src/routes/auth.routes.js:50` | `normalizeIdentifier` returns non-string values **unchanged**, so `login` passes `{"$ne":null}` straight into `User.findOne`. The helper looks like sanitization. `register:30` calls it correctly, wrapped in `String()` |
| 4.2 | A10 / A07 Fail-open | `src/middleware/auth.js:14, 25, 28` | Neither the missing-token branch nor the `catch` has a `return`; `next()` runs unconditionally, so a request with a bad or absent token still reaches the handler after the 401 body is queued |
| 4.3 | A01 / A08 Privilege escalation | `src/routes/profile.routes.js:31` via `src/config/fields.js:5` | Self-service `PATCH /me` picks `ALLOWED_PROFILE_FIELDS`, which spreads in `ADMIN_EDITABLE_FIELDS = ['role','isActive']`. Any user sets `role: 'admin'` on themselves. The correct list, `PUBLIC_PROFILE_FIELDS`, exists and is used at `:18` |

Decoys: `config/env.js` asserts `JWT_SECRET` presence and ≥32 bytes at boot; `jwt.verify` pins
`HS256`; `password` is `select: false`; `register` is rate-limited, email-format-validated and
returns an enumeration-safe 202 on duplicate; the password-reset flow hashes the token with
SHA-256, checks `usedAt`/`expiresAt` and is rate-limited; `PATCH /:id` correctly gates on
`requireRole('admin')`; `findById(req.params.id)` is not injectable (`req.params` is always a
string).

## case-5-posts-search-export (Express CRUD + search + export)

| # | OWASP | File:line | What |
|---|-------|-----------|------|
| 5.1 | A05 Injection | `src/controllers/posts.controller.js:132` into `src/lib/render.js:5` | `renderTemplate` builds a shell string for `exec`. `exportPdf:120` passes the constant `DEFAULT_TEMPLATE` — safe. `exportBranded:132` passes `req.query.template` — RCE. Same sink, two callers |
| 5.2 | A01 Broken access control | `src/controllers/posts.controller.js:81` | The ownership check compares `post.author` against **`req.body.authorId`**, not `req.user.userId`. The attacker supplies the value they are checked against; `author` is public in the `GET /posts/:id` response |
| 5.3 | A05 Injection / ReDoS | `src/lib/query.js:11` reached from `search` | `new RegExp(String(query.q), 'i')` on an unauthenticated route. `String()` blocks operator injection but not regex injection — `(a+)+$` is catastrophic backtracking against every indexed title |

Decoys: `create()` destructures explicitly and takes `author` from `req.user.userId`;
`remove()` uses an atomic `findOneAndDelete` with an ownership filter plus an admin branch;
`pageOf()` clamps the page to 1..500; `tag`/`author` in `buildFilter` are `String()`-cast;
both export routes validate the id with `mongoose.isValidObjectId` and are rate-limited;
`requireAuth` asserts the secret at boot, pins `HS256`, and type-checks `payload.userId`;
the schema bounds tag length.

## case-6-post-page (React + Express config)

| # | OWASP | File:line | What |
|---|-------|-----------|------|
| 6.1 | A05 XSS | `client/src/components/PostView.jsx:65` | `safeBody` is sanitized at `:27` — and then used only for the text excerpt at `:33`. The rendered `dangerouslySetInnerHTML` gets the **raw** `post.body` |
| 6.2 | A02 Misconfiguration | `server/src/app.js:37` | The CORS allowlist matches with `origin.endsWith(host)`. With `blogapp.example` allowed, `https://evil-blogapp.example` passes, and `credentials: true` makes it a credentialed cross-origin read |
| 6.3 | A05 XSS | `client/src/lib/url.js:11` | `safeUrl` is a **denylist** of schemes checked with `startsWith`. `java\tscript:alert(1)` does not start with `javascript:`, and browsers strip the tab before scheme parsing. The skill requires an http/https allowlist |

Decoys: `CommentList` renders `sanitizeRichText(comment.body)` — the same sink, done right;
`sanitize.js` has a real tag/attribute allowlist; helmet sets an explicit CSP and keeps CORP at
`same-origin`; the error handler clamps `err.status` and gates the stack behind `NODE_ENV`;
a global rate limiter and a 100kb JSON limit are present; `encodeURIComponent` on path params;
`VITE_API_URL` is a public base URL; `<img src={post.coverUrl}>` is unvalidated but not a script
sink; `rel="noreferrer"` is correct.
