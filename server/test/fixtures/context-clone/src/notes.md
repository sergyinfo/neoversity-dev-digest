# Scratch notes (fixture)

Another **committable negative** (S18): `src` is source code, not one of
`CONTEXT_DOC_DIR_SEGMENTS` (`docs`, `doc`, `specs`, `spec`, `plans`, `plan`,
`rfcs`), so a markdown file living under it must not be discovered as project
context even though its extension matches.
