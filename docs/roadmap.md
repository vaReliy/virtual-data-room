# Roadmap

Task-level plan. Every box is a unit of work small enough to start and finish without
re-deciding anything — the decisions live in `decisions.md`, `data-model.md` and
`architecture.md`. Each phase opens with a short "watch for" note naming the details that
are easy to get wrong there.

**Definition of done, every phase:** a checklist item is finished when it ships with
its loading, empty and error states. They are not a final-phase retrofit: built with the
screen they cost minutes, retrofitted they mean reopening every screen at the end.

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
- [x] Prisma schema per `data-model.md`; `datasource` declares both `url` and `directUrl`
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

- [ ] `scripts/gcloud-bootstrap.sh` — enable APIs, create the Secret Manager secrets,
      the deploying service account, the identity pool and its provider. The attribute
      condition pins the **numeric** `repository_id` and `repository_owner_id` plus
      `ref == 'refs/heads/main'`; the numeric ids are deliberate, since a released
      repository *name* can be claimed by someone else and this repository is public
- [ ] *(owner)* Run the bootstrap script once in Cloud Shell, where gcloud is already
      installed and already authenticated
- [ ] Multi-stage `Dockerfile` for the API using `pnpm deploy --filter`, plus an
      entrypoint that runs `prisma migrate deploy` with bounded retries and exponential
      backoff before `exec`-ing the server. A deploy is the only migration mechanism —
      there is no separate manual migration step against Neon
- [ ] Validate the image locally: `docker build` and `docker run` against the compose
      database until the container starts clean. This is what keeps the owner out of the
      loop — every failure reproducible locally is spent here, before the first push
- [ ] `.github/workflows/ci.yml` (decision #18) and `deploy.yml`. `deploy.yml` triggers on
      `workflow_dispatch` **only**, and grants `id-token: write` in the deploy job alone
- [ ] *(owner)* Push `main`. Then: trigger with `gh workflow run`, read `gh run view --log`,
      fix, repeat. A re-trigger needs no further push when the cause is configuration
- [ ] Cloud Run service configured in the same region as the database, reading its secrets
      from Secret Manager
- [ ] `vercel.json` with the `/api/*` rewrite to the Cloud Run URL
- [ ] *(owner)* Connect the repository to Vercel, building `apps/web`
- [ ] *(owner)* Add the Vercel origin and the callback redirect URI to the OAuth client,
      add the Vercel origin to bucket CORS, and publish the consent screen to
      *In production*
- [ ] Re-run the deploy so Cloud Run receives the Vercel origin in its environment — the
      session cookie and CORS settings depend on knowing it

**Done when:** sign in with Google on the deployed Vercel URL and land on an empty Data
Room served from Neon. Local `docker compose up` does the same against MinIO + Postgres.

---

## Phase 2 — Folders
**Watch for:** the 404-vs-410 distinction and its two deliberate soft-delete bypasses; the
scope-exception inventory, written down as the repository is built; the subtree delete
excluding already-deleted rows; and `23505` mapping to `409` on create and rename.

- [ ] `AccessScope` branded type + `AccessControlService.resolveForUser`
- [ ] `NodeRepository`, scope-bounded methods; `path` maintenance on create
- [ ] `findIncludingDeleted(scope, id)` + the `dataRoomId`-bounded lookup in
      `AccessControlService` — the two deliberate soft-delete bypasses
- [ ] Write the scope-exception inventory into `architecture.md` while building it
- [ ] Create folder, nested folders (`23505` → `409`)
- [ ] List folder contents — keyset pagination on `(type, lower(name))`, folders first
- [ ] Breadcrumbs derived from `path`, clipped to `scope.rootPath`
- [ ] Rename folder (`409` + inline dialog)
- [ ] Delete subtree: one `UPDATE ... WHERE path LIKE ... AND deleted_at IS NULL`,
      delta from `RETURNING type, size`
- [ ] Delete warning showing real subtree counts
- [ ] `applyAggregateDelta` helper — **three** call sites: create and delete here,
      upload-complete in Phase 3. Move lands in Phase 3; restore is out of scope
- [ ] Zero-room empty state with a **create-room affordance**. This is the whole
      of the room UI: no room list route, no rename. A switcher appears only if a user
      actually has more than one room

---

## Phase 3 — Files
**Watch for:** the per-room advisory lock and what must sit outside it; content-type pinned
on both the presigned PUT and GET; the presigned GET never served from cache; and the
auto-suffix retry re-running the whole transaction rather than the statement.

- [ ] `StorageService`: presign PUT/GET, HEAD, delete — one implementation, MinIO and GCS
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
- [ ] Move file: cycle guard, aggregate transfer, `409` on name conflict
- [ ] **Drag-and-drop move** between folders, alongside the "Move to…" dialog
- [ ] Verify `StorageService` once against the real GCS bucket via an env flip (~10 min) —
      presign PUT/GET, CORS, and the `response-*` overrides, which are exactly the
      parameters whose GCS behaviour can differ from MinIO's

---

## Phase 4 — Sharing
**Watch for:** the first-login demo share, which is what makes the recipient view gradable
with one Google account; and the `USER` token mode branch, without which a permissioned
share degrades into a public link.

- [ ] `ShareRepository` + `ShareService`: create link share (`randomBytes(32)`, stored
      hashed), create user share by email, list, revoke
- [ ] `AccessControlService.resolveForToken` — branches on `share.mode`. `LINK` is
      anonymous; `USER` requires an authenticated session whose **verified** email equals
      `granteeEmail`, else `404`
- [ ] Ancestor-grant lookup
- [ ] `PublicShareController` on `/s/:token`, read-only DTOs
- [ ] Public surface: file → preview; folder or room → browser rooted there
- [ ] "Shared with me" listing
- [ ] Revoke → `410 Gone` → dedicated client state
- [ ] Share dialog: mode toggle, link copy, grantee list, revoke
- [ ] Seed: Demo Owner user + populated room; on first login auto-create a `USER` share to
      the new user's verified email
- [ ] **Unit tests, mocked repository** — `AccessControlService`: scope boundaries,
      breadcrumb clipping, revoked and expired links, ancestor inheritance, the `USER`-token mode
      branch. Written here, where the service reaches its final shape
- [ ] **Integration smoke set, against the compose Postgres — not stretch**. Four
      tests, ~30 min. A mocked repository cannot cover any of these by construction: they
      live in raw SQL and Postgres transaction state.
      - subtree delete over a subtree containing an already-deleted row, asserting the
        `RETURNING` delta
      - `23505` on upload, asserting the retry re-runs the **whole** transaction
      - `23505` on rename, asserting `409` and no suffix
      - move cycle guard rejects a folder into its own descendant. `BRIEF.md` only requires
        moving a *file*, and no phase builds a folder-move UI — the guard lives in the
        shared repository move method, which is what this test exercises directly

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
