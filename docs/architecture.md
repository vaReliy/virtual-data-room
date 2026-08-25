# Architecture

System design for the Virtual Data Room. Decisions and their rationale are in
`decisions.md`; the schema is in `data-model.md`.

## Topology

```
                    ┌──────────────────────────┐
   browser ────────►│  app.vercel.app          │   Vite SPA (static)
                    │                          │
                    │  /api/*  ── rewrite ─────┼──► dataroom-api-*.run.app
                    └──────────────────────────┘         NestJS (Docker)
                                                            │
        presigned PUT / GET                                 ├──► Neon (PostgreSQL)
   browser ─────────────────────────────────────────────────┴──► GCS (S3-compatible)
```

The browser only ever talks to one origin. Consequences:

- Session cookie is first-party: `HttpOnly; Secure; SameSite=Lax`. Works in Safari.
- No CORS configuration, no preflight requests.
- Local development mirrors production exactly through Vite's `server.proxy`.
- File bytes never traverse the proxy or the API — they go browser ↔ storage directly.

**Local development** (`docker compose up`): `postgres:17`, `minio` (same S3 SDK,
different endpoint), the API in watch mode, and the Vite dev server.

The Postgres image is the Debian-based official one, matching Neon's major version and
libc. An Alpine image would use musl collations, which sort differently from glibc — and
listings are ordered and paginated on `lower(name)`, so a collation mismatch would make
local behaviour diverge from production at page boundaries.

## Backend layers

```
apps/api/src/
  modules/
    auth/          controller, google strategy, jwt strategy, guards, session
    data-room/     controller, service, repository
    node/          controller, service, node.repository   (tree + raw SQL lives here)
    file/          controller, service                    (upload orchestration)
    share/         controller, service, repository
    public/        public-share.controller                (anonymous /s/:token surface)
  access/
    access-control.service.ts     the only producer of AccessScope
    access-scope.ts               branded type
  storage/
    storage.service.ts            S3 SDK: presign PUT/GET, HEAD, delete
  persistence/
    prisma.service.ts             not exported from the module
  common/
    zod-validation.pipe.ts, error filters, throttler config
```

Rules:

- Services never import `@prisma/client` — enforced by ESLint and by the fact that
  `PrismaService` is not exported from `PersistenceModule`.
- Repository methods take `AccessScope` as their first argument.
- Raw SQL (path rewrites, subtree updates, recompute) lives only in `node.repository.ts`.
- Transactions are passed explicitly as a `tx` parameter, never held in ambient state.

## Access control

`AccessControlService` is the single authorization decision point for both the
authenticated and the anonymous surface. It returns a boundary, not a boolean:

```ts
type AccessScope = {
  readonly [brand]: 'AccessScope';
  dataRoomId: string;
  rootNodeId: string | null;   // null => the whole data room
  rootPath: string;            // '/' for the owner, '/f1/f2/' for a shared subtree
  role: 'OWNER' | 'VIEWER';
};
```

**Resolution for a signed-in user**

1. Owner of the Data Room → `rootPath = '/'`, `role = OWNER`.
2. Otherwise, look for a live `USER` grant whose `granteeEmail` equals the verified
   session email, on this node or any ancestor (ancestor ids come from `path`, no query).
3. The matched grant's node defines `rootNodeId` / `rootPath`; `role = VIEWER`.
4. No grant → 404 (not 403 — existence itself is information).

**Resolution for an anonymous token**

1. Hash the token, look up a `LINK` share where `revokedAt IS NULL` and
   `expiresAt` is null or in the future.
2. The share's node defines the scope; `role = VIEWER`.

**Enforcement.** Every repository query is bounded by
`path startsWith scope.rootPath`, so a node above the shared root does not exist for
that request. Breadcrumbs are computed as `node.path.slice(scope.rootPath.length)` —
ancestor names above the share root are never fetched, let alone returned. API
responses report `parentId: null` at the share root so the client stops climbing
instead of hitting an error.

This matters concretely: in an M&A context a folder name (`Project Falcon`,
`Acme Legal`) is itself confidential.

**Reading a node by id has exactly one door.** `NodeRepository.findInScope(scope, id)` is
it, and it always returns soft-deleted rows, with `deletedAt` in the result type:

```sql
SELECT ... FROM nodes
WHERE id = $1 AND data_room_id = $2 AND path LIKE $3 || '%'
--    no `deleted_at IS NULL` — that omission is the whole of the bypass
```

Two properties follow from the shape rather than from discipline:

- The scope boundary stays in the `WHERE` clause, so the ordering the error contract
  requires — scope before deletion — is structural. The statement cannot return an
  out-of-scope row, which makes the `410` branch unreachable from outside the scope.
- There is no soft-delete-filtering twin to reach for by mistake. A second, "safe"
  `findById` is precisely how a `410` silently decays into a `404`; every caller is
  instead forced by the return type to handle `deletedAt`. Callers are the read path
  (folder browser, file preview) and every mutation — on rename in particular the race is
  likelier, since the dialog sits open for seconds.

It must be raw SQL: the extension overwrites any caller-supplied `deletedAt` (deliberately
— that is what makes it unforgettable), so there is no argument-level opt-out. Living in
`node.repository.ts` keeps it inside the file where raw SQL is already permitted.

The listing of a folder's children is unaffected and goes through the extension normally:
deleted children simply are not there.

## Upload flow

Three steps, because bytes go straight to storage (Vercel's 4.5 MB body limit and
request timeouts never apply, and egress does not run through the API).

```
1. POST /api/uploads/presign
     { parentId, files: [{ name, size, mimeType }] }
   → validate: mime is application/pdf, size ≤ 10 MB, ≤ 10 files,
               Data Room quota (200 MB) not exceeded — a single integer comparison,
               because DataRoom.totalSize is already denormalized.
               This check is advisory: it gives fast feedback, but the
               authoritative one runs inside the locked transaction in step 3.
   → `parentId` must resolve to a live FOLDER (see § Node endpoints), else 422
   → create Blob rows with status = PENDING
   → return per file: { blobId, uploadUrl }

2. browser → PUT uploadUrl  (direct to GCS / MinIO)
   → progress via XMLHttpRequest.upload.onprogress   (fetch has no upload progress)

3. POST /api/uploads/complete
     { blobId, parentId, name }
   → HEAD the object: take the REAL size and content type from storage,
     never trust the client's numbers (they feed the aggregates)
   → reject and delete the object if it violates the limits
   → Blob.status = READY
   → create the Node, resolving name conflicts (see below)
   → applyAggregateDelta(ancestorIds, { size: +n, files: +1 })
```

GCS's S3-compatible XML API supports presigned **PUT** but not S3's POST policy
documents, so limits are enforced at steps 1 and 3 rather than by the storage service.
Compensating controls: the quota check, a rate limit of 20 presign requests per minute
per user, and the `HEAD` verification.

**Orphaned blobs.** A client that never reaches step 3 leaves a `PENDING` blob. Sweeping
`PENDING` rows older than an hour is a scheduled job; for this project it is described
in the README rather than implemented.

**Downloads and previews** use short-lived presigned GET URLs (`expiresIn: 300`), so a
leaked URL dies in five minutes and cannot be hot-linked from another site.

## Name conflicts

The database enforces uniqueness per folder, case-insensitively, ignoring soft-deleted
rows. The UX differs by operation:

- **Upload** — silent auto-suffix, `contract.pdf` → `contract (1).pdf`, as Drive and
  Windows do. Dragging twenty files must not open twenty dialogs.
- **Rename / move** — `409 Conflict` with an explicit dialog (rename / cancel).

## Error contract

Deliberate status codes, because the frontend renders a different state for each:

| Situation | Status | Client behaviour |
|---|---|---|
| Node does not exist, or is outside the caller's scope | `404` | "Not found" state |
| Node was deleted while being viewed | `410 Gone` | "This item was deleted by the owner" |
| Share link revoked or expired | `410 Gone` | "This link is no longer available" |
| Name already taken on rename/move | `409 Conflict` | Inline conflict dialog |
| Quota exceeded, file too large, wrong type | `422` | Per-file error in the upload queue |
| Signed in but lacking a grant | `404`, not `403` | Existence is information |

Note that 404 rather than 403 is intentional for missing grants: a 403 would confirm
that a given document exists.

**Revocation is `410` for a `LINK` share and `404` for a `USER` share**, and the asymmetry
is deliberate rather than an oversight. The two modes differ in what the capability *is*.
For `LINK` the capability is the token, so `410` says "this address is dead" while naming
no node — its holder already knew the address once worked. For `USER` the capability is
the grant row, and revoking it must return the grantee to the state the table above
already defines as `404`, "signed in but lacking a grant". A `410` there would tell a
revoked grantee, permanently, that the document still exists — which is the one thing
revocation is supposed to stop.

### Order of checks

Two rows above can match the same request, so the order in which they are evaluated is
part of the contract, not an implementation detail. Resolving a node runs:

1. `findInScope(scope, id)` — one statement, scope-bounded in its `WHERE`, returning
   soft-deleted rows.
2. No row → `404`. This covers both "no such node" and "outside your scope": the
   statement cannot tell them apart, which is the point.
3. A row with `deletedAt` set → `410`.

There is deliberately no application-level path check here. An earlier draft of this list
described an unscoped load followed by comparing `node.path` against `scope.rootPath` in
TypeScript — do not implement that. It rebuilds the `findById` that must not exist, and it
moves the boundary out of SQL and into a line someone can forget.

**Scope is checked before deletion, and that ordering is load-bearing.** Reversed, a
caller who guesses a UUID outside their scope gets `410` for a node that was deleted and
`404` for one that never existed — which tells them the node existed. Beyond the caller's
scope the two states must stay indistinguishable, exactly as with 404-not-403 above.

`410` is therefore only ever seen by someone who was entitled to see the node alive.

### `410` on both node types, two different screens

The status does not vary by node type; the screen does. Both are dead ends with a way
back, so nothing moves under the reader:

- **File preview** → "This file was deleted by the owner", with a link to its folder.
- **Folder browser** → "This folder was deleted by the owner", with a link to the Data
  Room root. No auto-redirect: the nearest live ancestor cannot be derived, since the
  subtree delete stamps every ancestor in the same statement, so any bounce would land at
  the room root anyway.

This is the edge case `BRIEF.md` names — a folder deleted while someone else is viewing
it. Returning `404` for it would be indistinguishable from a mistyped id, leaving the
viewer to conclude the application is broken. Note it fires only for a caller standing
*inside* the folder: a deleted child simply disappears from its parent's next listing.

## Node endpoints

The browser read is decision #24. The three mutations are spelled out here because
everything about them is a guess otherwise — and a guess about a status code becomes a
screen that never renders.

All four sit under `/api/rooms/:roomId/nodes`, behind `JwtAuthGuard`. Each resolves an
`AccessScope` first; each mutation then asserts `scope.role === 'OWNER'` and refuses with
`404` (decision #25).

| | Method | Body | Success |
|---|---|---|---|
| Browse | `GET /:nodeId?` | — | `200` `{ room?, node, breadcrumbs, children, nextCursor, role }` |
| Create folder | `POST` | `{ parentId: uuid \| null, name }` | `201` the created node |
| Rename | `PATCH /:nodeId` | `{ name }` | `200` the updated node |
| Delete subtree | `DELETE /:nodeId` | — | `204` |
| Move | `POST /:nodeId/move` | `{ parentId: uuid \| null }` | `200` the updated node |

- **Create takes no `type`.** Phase 2 creates folders only; a `FILE` node is born in
  `POST /uploads/complete`, never here, because it cannot exist without a `READY` blob.
- `parentId: null` means the room root. A `parentId` that is soft-deleted or outside the
  scope follows the ordinary resolution above — `410` and `404` respectively.
- **`parentId` must resolve to a live `FOLDER`, or `422`.** Nothing in the database
  prevents a child under a `FILE`: `nodes_type_blob_check` ties `type` to `blob_id`, and
  the parent foreign key does not look at the parent's type at all. Unreachable in Phase 2,
  where no `FILE` row exists yet — but the same check is owed by every later caller that
  accepts a `parentId`, namely `POST /uploads/complete` and the move destination. A child
  under a file breaks the tree quietly: breadcrumbs would route through a file, and a file
  would have "contents".
- **`23505` → `409` on both create and rename**, with no auto-suffix: the user typed the
  name (decision #20). Prisma surfaces the partial unique index as `P2002`; catch the
  raw `23505` as well, since the index is created in raw SQL rather than declared in the
  schema.
- **Delete replies `204`.** The warning dialog is rendered *before* the call, from the
  folder's denormalized aggregates, so the response has nothing left to tell the client
  that an invalidation does not.

### Move

Phase 3, specified here so that create, rename, delete and move share one description
rather than three plus a guess.

**A dedicated sub-resource, not a field on `PATCH`.** Folding `parentId` into the rename
body makes `{ "parentId": null }` — move to the room root — indistinguishable from a
`parentId` the client simply did not send, which is the difference between relocating a
node and leaving it alone. The operation is also not a field write: it rewrites every
descendant's `path` and transfers aggregates between two ancestor chains.

| Situation | Status |
|---|---|
| Node or destination missing, or outside the scope | `404` |
| Node or destination soft-deleted | `410` |
| Destination is a `FILE`, or is the node itself or one of its descendants | `422` |
| A live node of the same `lower(name)` already sits in the destination | `409` |
| Destination is the node's current parent | `200`, a no-op |

- **The cycle guard is `422`, not `409`.** A conflict is a name the user can change; a
  cycle is a request that cannot be satisfied at all, and the dialog says so differently.
  The guard is `newParent.path.startsWith(node.path)`, which also catches moving a node
  into itself, with no query.
- **No auto-suffix on conflict** — the user chose the destination knowing its contents
  (decision #20), so this is `409` with the rename/cancel dialog, exactly as rename is.
- **One transaction** covers the parent change, the descendant `path` rewrite, and both
  halves of the aggregate transfer.
- **The transferred delta is the whole subtree**, not one node: a moved folder carries its
  `totalSize`, `fileCount` and `folderCount` off the old ancestor chain and onto the new
  one, plus itself as one folder. Reading those figures off the moved row is what keeps
  this a single statement per chain rather than a subtree scan.
- `BRIEF.md` only requires moving a **file**, and no phase builds a folder-move UI. The
  endpoint and the guard are type-agnostic regardless, because the repository method is
  shared — which is what the Phase 3 cycle-guard test exercises directly.

### `nodeNameSchema`

One schema in `packages/contracts`, used by the create and rename bodies, and by the
`react-hook-form` resolver on both dialogs, so the client and the server reject the same
strings for the same reasons.

- `.trim()` first — normalization at the edge (decision #12), so `"Legal "` and `"Legal"`
  cannot both exist and confuse the uniqueness index.
- 1–255 characters after trimming; empty is `422`, not a silent no-op.
- Rejects `/`, NUL and C0 control characters, and the names `.` and `..` — none of them
  reach storage (object keys are UUIDs), but all of them make a breadcrumb or a download
  filename behave strangely.
- Case is preserved for display, while uniqueness is on `lower(name)`. Renaming `Legal`
  to `legal` therefore succeeds and is not a `409`: the only row holding that index key is
  the row being updated, so it does not collide with itself.

## Frontend structure

```
apps/web/src/
  routes/
    login.tsx
    rooms.$roomId.tsx              browser shell: breadcrumbs, toolbar, upload zone
    rooms.$roomId.n.$nodeId.tsx    folder contents / file preview
    shared-with-me.tsx
    s.$token.tsx                   public share surface (read-only)
  features/
    node-browser/   table, breadcrumbs, context menu, move dialog, delete warning
    upload/         dropzone, queue store, per-file progress
    share/          share dialog, link list, revoke
    viewer/         PDF preview
  lib/              api-client, query-keys, formatters
  components/ui/    shadcn
```

State: TanStack Query owns all server state; the upload queue is the only genuinely
client-side state. Every list view implements four states — loading, empty, error, and
content — edge cases and error states are part of the feature, not an afterthought.
