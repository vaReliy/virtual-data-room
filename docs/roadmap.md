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
- [ ] Restore `cursor: pointer` on `button` and `[role="button"]` in `index.css`
      `@layer base`. Tailwind v4's Preflight sets `cursor: default` to match the browser,
      which reads as a dead control. Global on purpose — it also covers the Radix
      triggers this phase introduces. Rides along with the first UI task below
- [ ] `nodeNameSchema` in `packages/contracts` — trim, 1–255, rejected characters — wired
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
- [ ] List folder contents — keyset pagination on `(type, lower(name))`, folders first.
      **Raw SQL in `node.repository.ts`, not Prisma**: `nodes_listing` is keyed on
      `COALESCE(parent_id, data_room_id)`, which a Prisma `where: { parentId }` does not
      match, and Prisma can express neither `ORDER BY lower(name)` nor the row-wise keyset
      comparison. Being raw, it bypasses the soft-delete extension and must filter
      `deleted_at IS NULL` itself. Fix the page size here and state what `nextCursor` is
      when the last page is reached. Each folder row shows its own subtree totals — the
      README's scaling answer, on screen rather than only asserted
- [ ] The deleted-**folder** `410` screen (`architecture.md` § Error contract): back to
      the Data Room root. Its file twin waits for Phase 3 — no file can exist yet, so it
      would be neither demoable nor testable here
- [ ] Route `rooms.$roomId.n.$nodeId.tsx` + the browser shell it renders into. Navigation
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
- [ ] Rename folder (`409` + inline dialog)
- [x] Delete subtree: one `UPDATE ... WHERE path LIKE ... AND deleted_at IS NULL`,
      delta from `RETURNING type, size`. The `UPDATE` and the ancestor delta are **one
      transaction** — a delta applied outside it can be lost against a stamp that was not
- [ ] Delete warning showing real subtree counts
- [x] `applyAggregateDelta` helper — **four** call sites: create and delete here,
      upload-complete and move in Phase 3. Restore is out of scope (decision #6 ships no
      trash UI), so it is not one of them and never will be
- [x] **Integration harness** against the compose Postgres — migrations, per-test cleanup,
      Vitest config. Paid once here; it makes the two Phase 3 tests nearly free
- [x] **Two integration tests, here rather than in Phase 4** (decision #26), because they
      exercise this phase's raw SQL and a mocked repository cannot reach it:
      - subtree delete over a subtree already containing a deleted row, asserting the
        `RETURNING` delta. This is the quiet one: without the `deleted_at IS NULL` filter
        a second delete decrements ancestors twice, and the wrong number surfaces in the
        delete warning — a graded requirement of `BRIEF.md`
      - `23505` on folder rename, asserting `409` and that no suffix is invented
- [ ] `dataRooms: []` renders the shell's **error** state, not an empty one (decision #23).
      A user always owns exactly one room, so an empty list means provisioning failed —
      there is no create-room route, no room list and no switcher to offer instead

---

## Phase 3 — Files
**Watch for:** the per-room advisory lock and what must sit outside it; content-type pinned
on both the presigned PUT and GET; the presigned GET never served from cache; and the
auto-suffix retry re-running the whole transaction rather than the statement.

- [ ] `StorageService`: presign PUT/GET, HEAD, delete — one implementation, MinIO and GCS
- [ ] Add `@nestjs/throttler` — the one new runtime dependency this phase needs, and the
      only way the presign rate limit below gets enforced. Raise it **before** the phase
      starts: `minimum-release-age=10080` refuses any release younger than 7 days, so a
      recent version cannot be installed on the day it turns out to be needed
- [ ] `POST /uploads/presign`: validation, advisory quota check, `PENDING` blobs, rate
      limit. `Content-Type: application/pdf` signed into the PUT
- [ ] `POST /uploads/complete`: `HEAD` **before** the transaction opens; then
      `pg_advisory_xact_lock(hashtextextended(dataRoomId, 0))`, authoritative quota check,
      node insert, aggregate delta — all inside one interactive transaction
- [ ] Auto-suffix on name conflict: optimistic insert, catch `23505`, retry the **whole**
      transaction, bound 3, then `409`
- [ ] Presigned GET with `response-content-type` + `response-content-disposition`
- [ ] Dropzone: multiple files, **drag-and-drop**, per-file progress via `XMLHttpRequest`,
      per-file error rows, cancel
- [ ] PDF preview via `<iframe>`, presigned URL fetched with `staleTime: 0`
- [ ] Rename file (`409` + dialog), delete file
- [ ] Move file via the **"Move to…" dialog** with a folder picker — the primary
      affordance per decision #19, and the one that satisfies the brief on its own.
      `POST /:nodeId/move` per `architecture.md` § Node endpoints → Move: cycle guard
      (`422`, not `409`), aggregate transfer over the whole subtree, `409` on name
      conflict, live-`FOLDER` destination, all in one transaction
- [ ] **Drag-and-drop move** between folders, alongside the "Move to…" dialog
- [ ] **Two integration tests** (decision #26), on the harness Phase 2 built:
      - `23505` on upload, asserting the retry re-runs the **whole** transaction
      - move cycle guard rejects a folder into its own descendant. `BRIEF.md` only
        requires moving a *file*, and no phase builds a folder-move UI — the guard lives
        in the shared repository move method, which this test exercises directly
- [ ] Verify `StorageService` once against the real GCS bucket via an env flip (~10 min) —
      presign PUT/GET, CORS, and the `response-*` overrides, which are exactly the
      parameters whose GCS behaviour can differ from MinIO's

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
- [ ] Final pass over loading / empty / error states — a sweep, not the first pass
- [ ] `pnpm db:recompute` **if time remains** (stretch)

---

## Explicitly out of scope

Cross-room search and filtering, file versioning on name conflict (both extra credit,
decision #1). Also out: trash/restore UI, editor role, audit log, orphan-blob sweeper
(described in the README, not implemented).
