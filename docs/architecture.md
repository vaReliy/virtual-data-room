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
