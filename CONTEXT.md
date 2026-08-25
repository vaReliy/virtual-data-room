# Context

Virtual Data Room — a secure repository for storing and distributing documents during
due diligence. Take-home project. See `docs/` for design detail.

## Domain language

Use these words in code, tests, commits and UI. They come from the brief; keeping the
same vocabulary end to end is deliberate.

**Data Room** — the top-level container, owned by exactly one user. The scoping
boundary for everything below it. Not called a workspace, drive, or project.

**Node** — an entry in a Data Room's tree. Exactly two kinds, distinguished by `type`:
`FOLDER` or `FILE`. Both live in the same table; "folder" and "file" are node *types*,
never separate entities.

**Blob** — the stored bytes of a file: an object key, size, mime type, checksum. A Node
is a name and a position in a tree; a Blob is content. Separating them is what makes
copies and future versioning possible.

**Share** — a grant of access, attached to a Node (or to a whole Data Room). Two
`mode`s: `LINK` (anyone holding the URL) and `USER` (a specific email address). Carries
a `role`. A share is never copied onto descendants — access to nested content is
*derived* from an ancestor's share.

**Grantee** — the recipient of a `USER` share, identified by email address so that
someone without an account yet can still be granted access.

**Access Scope** — the resolved result of an authorization check. Not a boolean: a
boundary (`rootPath`, `role`) that every database query is confined to. Produced only
by `AccessControlService`.

**Path** — the materialized ancestry of a node, `/<uuid>/<uuid>/`, built from ids and
never from names. Internal: never accepted from a request, never sent to a client.

**Owner** — the user who owns a Data Room. Distinct from a grantee; owners hold role
`OWNER`, grantees currently hold `VIEWER`.

## Terms we deliberately avoid

- *Workspace*, *drive*, *project* — say **Data Room**.
- *Permission* as an entity — the entity is **Share**; `role` is a field on it.
- *Directory* — say **folder**.
- *Document* — say **file** (a node) or **blob** (its bytes), whichever is meant.

## Non-negotiables

- Secrets live only in `.env`; nothing is committed.
- All code, comments, documentation and commit messages are in English.
- A node above the caller's Access Scope must be indistinguishable from a node that
  does not exist — including in breadcrumbs, error messages and status codes.
