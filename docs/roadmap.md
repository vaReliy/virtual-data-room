# Roadmap

Task-level plan. Every box is a unit of work small enough to start and finish without
re-deciding anything — the decisions live in `decisions.md`, `data-model.md` and
`architecture.md`. Each phase opens with a short "watch for" note naming the details that
are easy to get wrong there.

**Definition of done, every phase:** a checklist item is finished when it ships with
its loading, empty and error states. They are not a final-phase retrofit: built with the
screen they cost minutes, retrofitted they mean reopening every screen at the end.

A **phase** is finished when, on top of that, `pnpm typecheck && lint && test` pass and
`CHANGELOG.md` carries the phase's entry. The entry is written as the phase closes, not
swept up at the end — `notes/` is gitignored, so anything that must outlive the session
has nowhere else to go.

**Prerequisite, already done:** cloud accounts, storage bucket, database and OAuth client
are provisioned, `.env` is populated, and the GitHub repository exists.

**Prerequisite, not yet done:** the toolchain must be on Node 22 — the pinned pnpm refuses
to run on anything below 22.13. Nothing in Phase 1 starts before this.

---

## Phase 1 — Deployed skeleton

Goal: a signed-in user sees their own empty Data Room **on the production URL**, served by
the real API from Neon.

Deploy is here, not at the end. Everything most likely to fail in this design is
environment-shaped — OAuth on the production origin, the session cookie through the Vercel
rewrite, GCS CORS — and running it now converts the scariest failure mode into a Phase 1
debugging session instead of a last-minute emergency.

**Write the schema from `data-model.md`, not from memory.** Four details there are easy to
get wrong from habit and expensive to change later: there is no `depth` column; listing is
ordered and paginated on `lower(name)` via an expression index; the subtree index leads
with `data_room_id`; and sizes cross the wire as `number`, not `BigInt`.

**Run this phase as three sessions, in order.** The boundaries are drawn where the *kind*
of work changes, not where the checkbox count reaches some number — `shadcn init`, `prisma
migrate` and `docker build` produce three unrelated kinds of noise, and the most delicate
work here (the OAuth cookie, the UI states) must not land in the most cluttered context.

| Session | Sections | Gate |
|---|---|---|
| **S1 Backend** | Workspace, Contracts, API, Auth, plus `docker-compose.yml` | `typecheck && lint && test` green, and a real Google login against localhost |
| **S2 Web** | Web | `typecheck && lint` green, and the login flow walked in a browser |
| **S3 Ship** | Ship | Google login on the Vercel URL lands on an empty room served from Neon |

Each session starts from its brief in gitignored `notes/issues/phase-1/issues/` and hands
over through the code, the ticked boxes here, and `deviations.md` in that same directory —
which holds **only deviations and open questions**, never a summary of what the code
already shows.

### Workspace
- [x] `pnpm init`, `pnpm-workspace.yaml` (`apps/*`, `packages/*`)
- [x] `.npmrc`: `save-exact=true`, `minimum-release-age=10080`
- [x] Root scripts: `dev`, `build`, `lint`, `typecheck`, `test`
- [x] ESLint flat config + Prettier, shared. Includes the two boundary rules:
      `@prisma/client` only in `*.repository.ts`, raw SQL only in `node.repository.ts`

### Contracts
- [x] `packages/contracts`: Zod schemas consumed as TypeScript source by both apps
- [x] Size fields typed as `number` with the bound documented
- [x] Cursor codec: opaque base64 of `(type, lower(name))`

### API
- [x] Nest scaffold; `PersistenceModule` with `PrismaService` **not** exported
- [x] Prisma schema per `data-model.md`. Prisma 7 dropped `url` / `directUrl` from the
      `datasource` block: the pooled connection goes to the driver adapter in
      `prisma.service.ts`, the direct one into `prisma.config.ts`
- [x] First migration + the five raw SQL statements (partial unique index, composite
      `text_pattern_ops` index, two CHECKs, listing expression index)
- [x] Prisma Client Extension applying the global `deletedAt: null` read filter
- [x] `GET /api/health`

### Auth
- [x] Google OAuth end to end: login → `User` + `Account` upsert → httpOnly session cookie
- [x] `GET /api/me`
- [x] Auto-provision a Data Room on first login

### Web
- [x] Vite + React + TS + Tailwind + shadcn init; `server.proxy` → `/api`
- [x] Login screen, authenticated shell, empty-room state

### Local

- [x] `docker-compose.yml`: `postgres:17` (Debian-based, not Alpine — collation parity
      with Neon), `minio`, api (watch), web (vite). Belongs to S1 — the API needs a
      database before anything else in this phase can run

### Ship

Per decision #22: Cloud Run is deployed by a GitHub Actions workflow authenticating
through Workload Identity Federation, so no service-account key exists and no cloud
credential is ever stored on the development machine.

**The order below is forced by a dependency cycle** and cannot be rearranged: the Vercel
URL does not exist until the frontend is deployed, the frontend cannot be deployed without
the Cloud Run URL to rewrite to, and both the OAuth origin and the bucket CORS entry need
the Vercel URL. Steps marked *(owner)* are run by a human in a browser; everything else is
assistant work.

- [x] `scripts/gcloud-bootstrap.sh` — enable APIs, create the Secret Manager secrets,
      the deploying service account, the identity pool and its provider. The attribute
      condition pins the **numeric** `repository_id` and `repository_owner_id` plus
      `ref == 'refs/heads/main'`; the numeric ids are deliberate, since a released
      repository *name* can be claimed by someone else and this repository is public
- [x] *(owner)* Run the bootstrap script once in Cloud Shell, where gcloud is already
      installed and already authenticated
- [x] Multi-stage `Dockerfile` for the API using `pnpm deploy --filter`, plus an
      entrypoint that runs `prisma migrate deploy` with bounded retries and exponential
      backoff before `exec`-ing the server. A deploy is the only migration mechanism —
      there is no separate manual migration step against Neon
- [x] Validate the image locally: `docker build` and `docker run` against the compose
      database until the container starts clean. This is what keeps the owner out of the
      loop — every failure reproducible locally is spent here, before the first push
- [x] `.github/workflows/ci.yml` (decision #18) and `deploy.yml`. `deploy.yml` triggers on
      `workflow_dispatch` **only**, and grants `id-token: write` in the deploy job alone
- [x] *(owner)* Push `main`. Then: trigger with `gh workflow run`, read `gh run view --log`,
      fix, repeat. A re-trigger needs no further push when the cause is configuration
- [x] Cloud Run service configured in the same region as the database, reading its secrets
      from Secret Manager
- [x] `vercel.json` with the `/api/*` rewrite to the Cloud Run URL
- [x] *(owner)* Connect the repository to Vercel, building `apps/web`
- [x] *(owner)* Add the Vercel origin and the callback redirect URI to the OAuth client,
      add the Vercel origin to bucket CORS, and publish the consent screen to
      *In production*
- [x] Re-run the deploy so Cloud Run receives the Vercel origin in its environment — the
      session cookie and CORS settings depend on knowing it

**Done when:** sign in with Google on the deployed Vercel URL and land on an empty Data
Room served from Neon. Local `docker compose up` does the same against MinIO + Postgres.

---

## Phase 2 — Folders

**Run this phase as two sessions**, on the same principle as Phase 1: the boundary sits
where the *kind* of work changes. The phase carries the access machinery, a raw-SQL
repository, the contract reshape, four UI flows, two rewritten routes and a test harness —
no smaller than Phase 1, which was split for exactly that reason.

| Session | Sections | Gate |
|---|---|---|
| **S1 Backend** | `AccessScope`, write guard, `NodeRepository` (incl. `findAncestorsInScope`), endpoints, listing SQL, subtree delete, aggregates, the contract reshape, harness + two integration tests | `typecheck && lint && test` green, the two tests passing against the compose Postgres |
| **S2 Web** | Route and shell, folder table, breadcrumb *rendering*, create / rename / delete dialogs, the `410` screen, `dataRooms: []` error state, the `cursor` fix | The four folder flows walked in a browser, each with its loading, empty and error states |

The contract reshape belongs to S1 even though it is felt in S2 — S2 cannot start against
a shape that is still moving. Breadcrumbs split across the two: the repository method is
S1, the component is S2.

Each session starts from its brief in gitignored `notes/issues/phase-2/issues/` and hands
over through the code, the ticked boxes here, and `deviations.md` in that same directory —
which holds **only** deviations and open questions, never a summary of what the code
already shows.

**Watch for:** the 404-vs-410 distinction and its one deliberate soft-delete bypass; the
scope-exception inventory, written down as the repository is built; the subtree delete
excluding already-deleted rows; and `23505` mapping to `409` on create and rename.

- [x] `AccessScope` branded type + `AccessControlService.resolveForUser`
- [x] **Write guard: every node mutation asserts `scope.role === 'OWNER'` first**, and
      fails with `404`, not `403`, like everything else here. In the service, as the
      first line — not a Nest guard, which would need `AccessScope` in ambient request
      state that `architecture.md` deliberately refuses. Hiding buttons behind `role` is
      not access control; `curl` does not read the UI (decision #25)
- [x] `NodeRepository`, scope-bounded methods; `path` maintenance on create. **The node's
      UUID is generated in application code** (`crypto.randomUUID()`) before the insert:
      `path` contains the node's own id and is `NOT NULL`, so a database-generated
      `@default(uuid())` would not be known in time to build it
- [x] `findInScope(scope, id)` — the **only** way to read a node by id, and it always
      returns soft-deleted rows. No safe twin exists, so no call site can pick the wrong
      door and turn a `410` into a `404`
- [x] `resolveLiveNode(scope, id)` in the service — the single place that runs the order
      of checks: no row → `NotFoundException`, `deletedAt` set → `GoneException`, else a
      narrowed type **without** `deletedAt`. A nullable field in a return type forces
      nobody: a caller writing `if (!node) throw 404` compiles and then serves a deleted
      node with a `200`, which decision #6 calls the worst failure this system has. Every
      caller goes through this helper, so no call site ever sees `deletedAt` at all
- [x] Write the scope-exception inventory into `architecture.md` while building it
- [x] Restore `cursor: pointer` on `button` and `[role="button"]` in `index.css`
      `@layer base`. Tailwind v4's Preflight sets `cursor: default` to match the browser,
      which reads as a dead control. Global on purpose — it also covers the Radix
      triggers this phase introduces. Rides along with the first UI task below
- [x] `nodeNameSchema` in `packages/contracts` — trim, 1–255, rejected characters — wired
      into both request bodies and both dialog resolvers (`architecture.md` § Node
      endpoints)
- [x] Create folder, nested folders, per `architecture.md` § Node endpoints: `POST`,
      `201`, `{ parentId, name }`, `23505` → `409` with no suffix. Catch the raw `23505`
      as well as `P2002` — the index is raw SQL, not declared in the Prisma schema
- [x] Reshape the browser contract per decision #24: `{ room?, node, breadcrumbs,
      children, nextCursor }`, `node: null` at the root, `room` only when
      `scope.rootNodeId === null`, plus `role` off the `AccessScope`. Narrow
      `meResponseSchema` to `{ id, name }` per room and drop the aggregates the shell
      reads today from `/api/me`
- [x] List folder contents — keyset pagination on `(type, lower(name))`, folders first.
      **Raw SQL in `node.repository.ts`, not Prisma**: `nodes_listing` is keyed on
      `COALESCE(parent_id, data_room_id)`, which a Prisma `where: { parentId }` does not
      match, and Prisma can express neither `ORDER BY lower(name)` nor the row-wise keyset
      comparison. Being raw, it bypasses the soft-delete extension and must filter
      `deleted_at IS NULL` itself. Fix the page size here and state what `nextCursor` is
      when the last page is reached. Each folder row shows its own subtree totals — the
      README's scaling answer, on screen rather than only asserted
- [x] The deleted-**folder** `410` screen (`architecture.md` § Error contract): back to
      the Data Room root. Its file twin waits for Phase 3 — no file can exist yet, so it
      would be neither demoable nor testable here
- [x] Route `rooms.$roomId.n.$nodeId.tsx` + the browser shell it renders into. Navigation
      lives here, so breadcrumbs and the folder table both depend on it landing first.
      **The route must not check ownership** — no `dataRooms.find(...)` gate as
      `rooms.$roomId.tsx:26` does today. It asks the browser endpoint and renders the
      API's answer, `404` included, so that a `USER`-share recipient reaching the same
      route in Phase 4 is not locked out by the shell before the API is consulted
      (decision #24). Write-affordances hide behind `role`, not behind ownership.
      **The same gate comes out of `rooms.$roomId.tsx` too** — a whole-room `USER` share
      (`rootNodeId === null`) lands on that route, so leaving it locks the recipient out
      one door over. While there: `home.tsx:19` and the `me.ts` docstring still promise
      the create-room affordance of #21, superseded by #23
- [x] Breadcrumbs: `findAncestorsInScope(scope, ids)` — `path` carries UUIDs only, so the
      names need a second, multi-id read. Scope-bounded and live-only, and it goes in the
      scope-exception inventory alongside `findInScope`. The result is ordered by `path`,
      not by whatever order the rows come back in
- [x] Rename folder (`409` + inline dialog)
- [x] Delete subtree: one `UPDATE ... WHERE path LIKE ... AND deleted_at IS NULL`,
      delta from `RETURNING type, size`. The `UPDATE` and the ancestor delta are **one
      transaction** — a delta applied outside it can be lost against a stamp that was not
- [x] Delete warning showing real subtree counts
- [x] `applyAggregateDelta` helper — **four** call sites, five calls: create and delete
      here, upload-complete and move in Phase 3, move calling it twice (negative off the
      old ancestor chain, positive onto the new). Restore is out of scope (decision #6
      ships no trash UI), so it is not one of them and never will be
- [x] **Integration harness** against the compose Postgres — migrations, per-test cleanup,
      Vitest config. Paid once here; it makes the two Phase 3 tests nearly free
- [x] **Two integration tests, here rather than in Phase 4** (decision #26), because they
      exercise this phase's raw SQL and a mocked repository cannot reach it:
      - subtree delete over a subtree already containing a deleted row, asserting the
        `RETURNING` delta. This is the quiet one: without the `deleted_at IS NULL` filter
        a second delete decrements ancestors twice, and the wrong number surfaces in the
        delete warning — a graded requirement of `BRIEF.md`
      - `23505` on folder rename, asserting `409` and that no suffix is invented
- [x] `dataRooms: []` renders the shell's **error** state, not an empty one (decision #23).
      A user always owns exactly one room, so an empty list means provisioning failed —
      there is no create-room route, no room list and no switcher to offer instead

---

## Phase 3 — Files
**Watch for:** the per-room advisory lock and what must sit outside it; content-type pinned
on both the presigned PUT and GET; the presigned GET never served from cache; and the
auto-suffix retry re-running the whole transaction rather than the statement.

**Run this phase as two sessions**, on the same principle as the last two: the boundary sits
where the *kind* of work changes.

| Session | Sections | Gate |
|---|---|---|
| **S1 Backend** | `StorageService`, throttler, `blob.repository.ts`, presign, complete, auto-suffix, content URL, `NodeRepository.createFile`, the move **endpoint**, **the whole contract reshape** (limits, upload schemas, content response), all three integration tests, mixed-data listing | `typecheck && lint && test` green, **and `StorageService` verified against the real GCS bucket** |
| **S2 Web** | dropzone + file drag-and-drop, per-file progress and cancel, PDF preview, `NodeRoute` dispatch on `node.type`, the file `410` screen, rename / delete file, "Move to…" dialog, drag-and-drop move | the four file flows walked in a browser, each with its loading, empty and error states |

The contract reshape is in S1 for the Phase 2 reason: S2 cannot start against a shape that
is still moving.

**The GCS verification moved into S1's gate, out of last place.** `response-content-type`
and `response-content-disposition` are exactly the parameters whose GCS behaviour can differ
from MinIO's, and the PDF preview is built on them. Verified last, a divergence surfaces
after the preview is already written against MinIO; verified at the S1 gate, S2 builds
against storage that is known good.

Each session starts from its brief in gitignored `notes/issues/phase-3/issues/` and hands
over through the code, the ticked boxes here, and `deviations.md` in that same directory.

**Decision #28 settles what this phase's grooming opened**: the upload URL space, the
batched-presign / per-file-complete asymmetry, complete's idempotency, `storageKey` as a
blob's tenancy, and bytes that outlive their node. Read it before starting S1.

**Carried in from the Phase 2 → 3 forward-compat pass.** Four things Phase 2 satisfies by
accident, because it has only one node type and nothing that reads the quota:

- **A file's `path` is built exactly as a folder's**: `` `${parentPath}${id}/` `` with the
  id from `randomUUID()` in application code before the insert (`node.repository.ts`
  `createFolder`), **trailing slash included**. The slash is the whole reason
  `LIKE path || '%'` matches a subtree and nothing else — without it `/a/b/` would
  prefix-match a sibling `/a/bc/`, and a single-file delete would take an unrelated node
  with it. A database-side `@default(uuid())` cannot be used: `path` contains the node's
  own id and is `NOT NULL`.
- **`deleteSubtree` needs no file-specific path.** For a `FILE` the subtree `UPDATE` stamps
  exactly one row and `RETURNING type, size` yields `{ size: -n, files: -1, folders: 0 }`
  over strict ancestors. Reuse it; do not write a second writer of `deleted_at`.
- **`deleteSubtree` takes no advisory lock, and upload-complete does.** A delete running
  concurrently frees space that the authoritative quota check inside the locked transaction
  cannot see, so an upload can be refused `422` and then succeed on retry. Never the other
  way round — the room cannot go over quota — so this is accepted, not fixed. Making the
  delete take the same lock would serialize every mutation in the room. Decide it here
  rather than rediscovering it as a flaky test.
- **The listing's folders-before-files order has never run against mixed data.** It rests
  on `CREATE TYPE "NodeType" AS ENUM ('FOLDER', 'FILE')` fixing the enum's sort order, and
  on the keyset casting to `"NodeType"` rather than to text so a page boundary compares on
  that same order. Both are right by inspection; the test below is what executes them.

**Route structure needs nothing new**: `GET /nodes/:fileId` already resolves today —
`resolveLiveNode` succeeds, `children` comes back empty, breadcrumbs are correct — so
`/rooms/:roomId/n/:nodeId` serves both node types and `NodeRoute` dispatches on `node.type`.
`node-table.tsx` already renders file rows and deliberately leaves the name unlinked;
Phase 3 turns that `<span>` into a `Link`.

- [x] `StorageService`: presign PUT/GET, HEAD, delete — one implementation, MinIO and GCS
- [x] Add the **three** new runtime dependencies this phase needs. An earlier draft of this
      line said `@nestjs/throttler` was the only one; that was wrong, and the stop-and-ask
      below is what caught it:
      - `@nestjs/throttler` `6.5.0` — the only way the presign rate limit below gets
        enforced. **The age gate does not bite** (checked at the Phase 2 → 3 boundary): the
        newest release is `6.5.0`, published 2025-12-02, so `minimum-release-age=10080` will
        not refuse it and there is nothing to raise early. Peer range covers
        `@nestjs/common ^11`
      - `@aws-sdk/client-s3` `3.1113.0` — the S3 SDK `architecture.md:49` and `CLAUDE.md`
        § Stack already name
      - `@aws-sdk/s3-request-presigner` `3.1113.0` — **named by no design document**, and the
        reason the count was wrong. `getSignedUrl` is not exported from `client-s3`; it is a
        separate package in the same monorepo. Verified against its own README, not assumed
      The rule still applies to anything else this phase reaches for on the day it needs it
- [x] The four limits as constants in `packages/contracts`, beside the schemas:
      `application/pdf`, 10 MB per file, 10 files per presign, a 200 MB room quota. They
      exist only as prose in `architecture.md` today. Shared for the same reason
      `nodeNameSchema` is — the dropzone must reject an oversized file *before* presign, and
      a second hand-written copy of the numbers in the web app is how the two drift. The
      quota stays a constant rather than an env var: it never differs by environment here,
      and the README states it as an answer
- [x] `blob.repository.ts` under `modules/file/` — the only module that writes to the
      database without a repository today. Takes `scope.dataRoomId` and adds
      `storageKey: { startsWith: dataRoomId + '/' }` — **Prisma, not raw SQL**: `startsWith`
      compiles to `LIKE`, so the boundary is in the `WHERE` clause and `node.repository.ts`
      stays the only file the ESLint rule allows raw statements in. The
      `randomUUID()`-before-insert pattern
      arrives here for its second carrier: `storageKey` contains the blob's own id and is
      `NOT NULL`, exactly as `path` does for a node (decision #28)
- [x] `POST /rooms/:roomId/uploads/presign`: validation, advisory quota check over the
      **batch's summed size**, `PENDING` blobs, rate limit keyed on the session `userId` —
      not `req.ip`, which behind the Vercel rewrite is the proxy for every caller.
      `Content-Type: application/pdf` signed into the PUT. Two details that fail *silently*
      if missed, both verified against the libraries rather than assumed:
      - **`ThrottlerGuard` is registered on the controller, not as an `APP_GUARD`** —
        `@UseGuards(JwtAuthGuard, ThrottlerGuard)`, in that order. NestJS runs guards
        global → controller → route, so a global throttler executes *before* the
        controller's `JwtAuthGuard` and `req.user` is still undefined. `getTracker` reads
        `req.user.userId` (`SessionContext` has `userId`, not `id`) and **throws rather
        than falling back to `req.ip`**: this route sits behind the session guard, so a
        missing user means a broken guard chain, and an IP fallback would hide it behind a
        working-looking limit shared by every caller
      - **`signableHeaders: new Set(['content-type'])` must be passed to `getSignedUrl`** —
        non-`x-amz-*` headers are not signed by default, so without it the URL accepts any
        content type and "`Content-Type` signed into the PUT" is not true. Nothing catches
        this: the type is checked again by `HEAD` at complete, so the tests still pass.
        Set `expiresIn` explicitly while there — it defaults to 900 s in the SDK, and an
        inherited default is not a chosen one
- [x] `POST /rooms/:roomId/uploads/complete`, **one file per call**: `HEAD` **before** the
      transaction opens; then `pg_advisory_xact_lock(hashtextextended(dataRoomId, 0))`,
      authoritative quota check, the conditional `PENDING → READY` flip, node insert via
      `NodeRepository.createFile`, aggregate delta — all inside one interactive transaction.
      Zero rows from the flip means complete already ran: return the existing node by
      `blobId` with `200`, rather than creating a second node on one blob and charging the
      aggregates twice
- [x] Auto-suffix on name conflict: optimistic insert, catch `23505`, retry the **whole**
      transaction, bound 3, then `409`. The bound is not infinite and it is visible — a
      folder already holding `contract.pdf`, `contract (1).pdf` and `contract (2).pdf`
      answers `409` on the fourth drop of that name. Correct per #20, worth a `CHANGELOG.md`
      line because no diff shows it
- [x] `GET /rooms/:roomId/nodes/:nodeId/content` → `{ url, expiresAt }`, with
      `response-content-type` + `response-content-disposition: inline` and `filename` set
      from `node.name`, RFC 5987 encoded. It resolves through `resolveLiveNode`, so `404`
      and `410` come for free. **Not guarded by `role`** — a `VIEWER` must be able to open a
      file shared with them
- [x] `NodeRepository.createFile` — the `FILE` sibling of `createFolder`, same shape:
      `randomUUID()` before the insert, `` path = `${parentPath}${id}/` `` with the trailing
      slash, `blobId` and `size` set, aggregate delta of `{ size: +n, files: +1 }`. It takes
      the caller's `tx`, because upload-complete owns the transaction. In the same commit,
      fix the two stale doc comments that still name the pre-#28 URL and will be read as
      authoritative: `packages/contracts/src/node.ts:114` and
      `apps/api/src/modules/node/node.service.ts:96` both say a `FILE` is born in
      `POST /api/uploads/complete`. The sentence stays true — only the path changes
- [x] Upload and content **schemas** in `packages/contracts`, beside the limits above:
      presign body and response, complete body, and the content response. S2 cannot begin
      against a shape that is still moving, which is why the whole contract reshape lands
      in S1 — the limits, these schemas, and nothing left for later
- [ ] Dropzone: multiple files, **drag-and-drop**, per-file progress via `XMLHttpRequest`,
      per-file error rows, cancel. **Native HTML5 DnD, no new dependency** — `DataTransfer`
      is the only way to read dropped files anyway, and `dnd-kit` handles pointer drags but
      not file drops, so a library would add a second mechanism rather than replace the
      first. Keyboard users are served by the "Move to…" dialog (decision #19), not by DnD.
      A cancelled transfer leaves a `PENDING` blob, which nothing collects — see Phase 6
- [ ] PDF preview via `<iframe>`, content URL fetched with `staleTime: 0` / `gcTime: 0`
- [ ] `NodeRoute` dispatches on `node.type` — `FILE` renders the preview, `FOLDER` the
      browser. Same route, no new one: the browse endpoint already answers for a file id
- [ ] The deleted-**file** `410` screen, owed by Phase 2 and unscheduled until now
      (`architecture.md` § `410` on both node types). It is a **second component, not a
      second destination**: the copy names a file, the link goes back to the Data Room
      root exactly as the folder screen's does. The `410` body carries a message but **not
      the node type**, so on a direct load the client cannot know which wording applies —
      the file wording is reachable only when the
      reader arrived from the preview route with the type already in hand, and the folder
      screen is the fallback everywhere else
- [ ] Rename file (`409` + dialog), delete file
- [x] **`POST /:nodeId/move` — the endpoint, in S1.** Split out from the dialog below
      because it is the heaviest transaction in the phase and it belongs to the other
      session: `architecture.md` § Move covers the parent change, the descendant `path`
      rewrite and **both halves** of the aggregate transfer in one transaction, with cycle
      guard (`422`, not `409`), `409` on name conflict, and a live-`FOLDER` destination.
      Type-agnostic, so it serves files and folders from one repository method
- [ ] The **"Move to…" dialog** with a folder picker, in S2 — the primary affordance per
      decision #19, and the one that satisfies the brief on its own. UI only: the endpoint
      above is already done and tested when this starts
- [ ] **Drag-and-drop move** between folders, alongside the "Move to…" dialog
- [x] **Three integration tests** (decision #26), on the harness Phase 2 built:
      - `23505` on upload, asserting the retry re-runs the **whole** transaction
      - move cycle guard rejects a folder into its own descendant. `BRIEF.md` only
        requires moving a *file*, and no phase builds a folder-move UI — the guard lives
        in the shared repository move method, which this test exercises directly
      - the presign rate limit is **per user, not per IP**: two sessions with different
        `userId` hit the limit independently, and exhausting one leaves the other passing.
        Without this the `getTracker` override is asserted nowhere and an IP fallback
        looks identical in a single-user test
- [x] Extend the Phase 2 listing coverage to **mixed data** — a folder holding both
      folders and files, paged across a boundary. Nearly free on the existing harness, and
      it is the only thing that actually executes the enum sort order and the keyset's
      `::"NodeType"` cast. Not a third integration test so much as the first real input to
      the second one
- [x] Verify `StorageService` once against the real GCS bucket via an env flip (~10 min) —
      presign PUT/GET, CORS, and the `response-*` overrides, which are exactly the
      parameters whose GCS behaviour can differ from MinIO's. **Part of the S1 gate, not the
      end of the phase**: the preview is built on the `response-*` overrides, so a GCS
      divergence found after S2 means rewriting UI that was correct against MinIO

### Scope gates — where this phase stops

Phase 3 sits between a finished folder browser and an unbuilt sharing model, which is the
easiest place in this project to drift. Each line below is something a reasonable
implementer might start unprompted. **None of them belong to this phase.** Anything here
that turns out to be genuinely required is a stop-and-ask, not a judgement call.

| Do not build | Why it looks tempting | Where it actually lives |
|---|---|---|
| Anything in `share/` or `public/` — the dialog, `resolveForToken`, "Shared with me", `/s/:token` | The content URL endpoint is deliberately not role-guarded "for viewers" | Phase 4 |
| A trash or restore UI, or a restore call site for `applyAggregateDelta` | Soft delete keeps every row, so restoring looks like a missing feature | Nowhere. Decision #6 ships no trash, and #5 names four call sites, not five |
| The storage sweeper, as code | This phase creates both categories of orphan and names them | Phase 6, as README prose only |
| `pnpm db:recompute` | The aggregates this phase writes are what it repairs | Phase 6, stretch |
| `react-pdf`, or any PDF library | `<iframe>` will look primitive next to it | Nowhere. Decision #15 puts it on the stretch list |
| A folder-move **UI** | The move endpoint and the cycle guard are type-agnostic and will work | Nowhere. `BRIEF.md` requires moving a *file*; the guard is covered by a test, not a screen |
| Search, filtering, or versioning on conflict | Both are named in the brief | Nowhere — extra credit, decision #1 |
| A `dataRoomId` column on `Blob`, or any other schema change | The blob's tenancy is carried by a string prefix, which feels weaker | Stop and ask. Decision #28 chose the prefix on purpose |
| Raw SQL outside `node.repository.ts` | `blob.repository.ts` needs a prefix match | Nowhere. Prisma's `startsWith` compiles to `LIKE`; the ESLint rule stands |
| Any new runtime dependency beyond the three listed above | DnD and the upload queue both feel library-shaped | Stop and ask. Native DnD and a plain store were chosen deliberately — and the ask is what corrected the count above |

Two positive gates, so the phase can be called finished rather than argued about:

- **Every UI task ships its loading, empty and error states in the same commit as the
  screen.** The upload queue has more of them than anything built so far — pending,
  uploading, error, cancelled, complete — and the file `410` screen is one of them.
- **The phase is done when `pnpm typecheck && lint && test` pass, `CHANGELOG.md` carries
  the entry, and the four file flows have been walked in a browser.** Report a failing gate
  by name; do not tick a box around it.

---

## Phase 4 — Sharing
**Watch for:** the first-login demo share, which is what makes the recipient view gradable
with one Google account; and the two resolution paths staying separate — a `USER` share
carries no token and is never reached through `/s/:token` (decision #27).

- [ ] `ShareRepository` + `ShareService`: create link share (`randomBytes(32)`, stored
      hashed), create user share by email, list, revoke
- [ ] `AccessControlService.resolveForToken` — **`LINK` only, no `mode` branch.** A token
      can only ever find a `LINK` share, because `shares_mode_check` keeps `token_hash`
      null on `USER` rows. Anonymous; live, unrevoked and unexpired, else `410`
      (decision #27)
- [ ] Ancestor-grant lookup, and with it the second soft-delete bypass: the
      `dataRoomId`-bounded node lookup that takes **no** `AccessScope`. It belongs here,
      not in Phase 2 — owner resolution never reads a node, so before grants exist this
      method would have no caller
- [ ] `PublicShareController` on `/s/:token`, read-only DTOs
- [ ] Public surface: file → preview; folder or room → browser rooted there
- [ ] "Shared with me" listing
- [ ] Revoke. A revoked **`LINK`** gives `410 Gone` and its own client state; a revoked
      **`USER`** grant gives `404`, because the grantee must land back in "no grant"
      rather than keep a standing confirmation that the document exists
      (`architecture.md` § Error contract)
- [ ] Share dialog: mode toggle, link copy, grantee list, revoke
- [ ] Seed: Demo Owner user + populated room; on first login auto-create a `USER` share to
      the new user's verified email
- [ ] **Unit tests, mocked repository** — `AccessControlService`: scope boundaries,
      breadcrumb clipping, revoked and expired links, ancestor inheritance, and a `USER`
      grant matching only a **verified** session email — not a token branch, which
      decision #27 removed. Written here, where the service reaches its final shape
The integration smoke set is **not** here: decision #26 moved each test next to the code
it exercises — two into Phase 2, two into Phase 3 — since none of them depends on the
final shape of `AccessControlService`, which was the reason #16 batched them all here.

--

## Phase 5 — Production data and demo
Deploy already happened in Phase 1; this is what is left.

- [ ] Re-deploy current code to Cloud Run and Vercel
- [ ] Run the seed against Neon: sample room with **real multi-page PDFs** (single-byte
      placeholders make the preview look broken)
- [ ] Create the public demo links for the README: populated, empty, revoked
- [ ] Smoke-test both surfaces on the production URL, signed in and in a private window

---

## Phase 6 — README and sweep
- [ ] `README.md`: setup, design decisions, ERD, the "How it scales" answers, the AI-usage
      note, hosted URLs, demo links, and the known limitations (orphan-blob sweeper and
      recompute described but not shipped)
- [ ] Describe the **storage sweeper** in the README — considered in Phase 3 grooming and
      deliberately not built. Two categories of unreferenced bytes accumulate, from one
      cause each, and a single scheduled job (daily or weekly; Cloud Run Jobs + Cloud
      Scheduler) collects both:
      - `PENDING` blobs whose upload never reached `complete` — a cancelled or abandoned
        transfer. Older than an hour is safe to sweep.
      - `READY` blobs whose only nodes are soft-deleted. Deleting a file never touches
        storage: `nodes_type_blob_check` requires `FILE → blob_id NOT NULL`, so the row
        cannot be detached, and removing the bytes would make a reversible operation
        irreversible in fact while still looking reversible (decision #6).
      **The visible consequence to state plainly:** the quota is computed from node
      aggregates, not from the bucket, so a room can report 0 bytes used while holding
      real objects in GCS. Nothing breaks — the authoritative quota check reads the same
      aggregates — but the two numbers are not the same number.
- [ ] Final pass over loading / empty / error states — a sweep, not the first pass
- [ ] `pnpm db:recompute` **if time remains** (stretch)

---

## Explicitly out of scope

Cross-room search and filtering, file versioning on name conflict (both extra credit,
decision #1). Also out: trash/restore UI, editor role, audit log, orphan-blob sweeper
(described in the README, not implemented).
