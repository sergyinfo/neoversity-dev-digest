# specs — client

Specs / acceptance criteria for the `client` package.

## Design source

`DevDigest Design (standalone) (3).html` is the canonical UI reference.

New design drops arrive as a **new numbered file**, not an edit — so the highest
suffix wins. Check `ls` here before reading one; a stale drop looks exactly like
the current one. Earlier drops are deleted once an audit confirms they are fully
superseded.

**`grep` finds nothing in it.** The UI code is gzip+base64 inside a JSON resource
map on a single ~1.7 MB line. To read a component's reference implementation,
JSON-parse that line, then per entry `base64.b64decode` → `gzip.decompress`; the
`text/javascript` resources come out as plain readable source. `file://` URLs are
blocked in the browser tool, so decoding beats opening it.

To diff two drops, compare decoded resources by **content hash** — the bundler's
resource keys are UUIDs that change between exports, and module contents get
re-bundled, so filenames and ordering are both unreliable.

See `client/INSIGHTS.md` → *Tool & Library Notes* for the full recipe.
