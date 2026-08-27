<!-- Decision log. Append-only: supersede entries, do not rewrite history. -->

# Decision Log

Compact ADR log for the Virtual Data Room take-home. Each entry: context, decision,
consequences. Decisions 1-12 were agreed in the design session; 13-21 are the smaller
calls settled afterwards, during review. Nothing is left undecided.

Status legend: **Accepted** | **Superseded by #N** | **Proposed**

---

## 1. Scope: the required feature set, built well, and nothing beyond it

**Status:** Accepted

**Context.** The functional scope — folder CRUD, file CRUD, multi-file upload with
per-file progress, move, two sharing modes, revoke, and a deployed system — is
substantial, and the requirements name specific edge cases that are easy to skip.

**Decision.** Every listed requirement ships, with its edge cases and error states.
Nothing outside the requirements is built, and all design decisions are made before
implementation starts (this document exists for that reason).

**Consequences.** No NX, no full clean architecture, no extra-credit features
(cross-room search, file versioning). Tests cover the critical path only: access control
and the tree operations whose correctness lives in raw SQL and transaction state.
A half-built feature is worse than an absent one, so anything that cannot ship complete
does not ship.

---

## 2. Backend architecture: Nest modules + repository layer

**Status:** Accepted

**Context.** Options were flat Nest-idiomatic (service calls Prisma directly),
modular + repository, or full onion/clean with domain entities and mappers.

**Decision.** Nest modules where Prisma is hidden behind repositories, plus a
dedicated `AccessControlService`. **No** separate domain entities and **no** mappers —
types are Prisma-generated.

**Rationale.** The two genuinely hard parts of this domain are tree traversal and
authorization resolution. Both are intentionally Postgres-specific (recursive
queries, index range scans), so an abstraction whose purpose is database portability
pays nothing. Isolation is applied exactly where it is testable and valuable.

**Consequences.** ~1 extra file per module. Permission logic is unit-testable with a
mocked repository. Transactions are passed explicitly as a `tx` parameter.

---

## 3. Node modeling: single `nodes` table (single-table inheritance)

**Status:** Accepted

**Context.** Folders and files could be two tables or one table with a `type`
discriminator.

**Decision.** One `nodes` table with `type: FOLDER | FILE`. `DataRoom` stays a
separate table (it owns the owner relation and is the scoping boundary).
Root-level nodes have `parentId = NULL`.

**Rationale.**
- Listing a folder is one indexed query with trivial keyset pagination. Two tables
  would require `UNION ALL` of differing shapes, which makes "next 50 after this name"
  painful — and the brief explicitly asks about 100k files.
- `UNIQUE (parent_id, name)` lets the database enforce name conflicts, including
  cross-type ones, instead of application-level checks with race conditions.
- Sharing targets a real foreign key rather than a polymorphic `(type, id)` pair
  with no referential integrity.
- Move / rename / delete-subtree are written once instead of twice.

**Consequences.** File-only columns (`blobId`) are nullable; a `CHECK` constraint
enforces `type = 'FILE' ⟺ blob_id IS NOT NULL`.

**Prior art.** Google Drive models folders as files with a folder mime type, for the
same reasons.

---

## 4. Tree representation: `parent_id` + materialized path

**Status:** Accepted

**Context.** Adjacency list with recursive CTEs, adjacency + materialized path, or a
closure table.

**Decision.** `parent_id` is the source of truth (with FK integrity); `path` is a
denormalized index of the form `/<ancestor-uuid>/<ancestor-uuid>/<self-uuid>/`.

**Rationale.** The hottest path in the system is "does a share exist on this node or
any of its ancestors?", evaluated on essentially every API request. With a
materialized path, ancestors are obtained by splitting a string — **zero** tree
queries — and the share lookup is a single indexed `IN`. Subtree aggregation becomes
an index range scan instead of recursion. Cycle detection on move is a string prefix
comparison.

A closure table was rejected: it is a third structure to maintain (it does not remove
`parent_id`), move requires two non-trivial delete/insert statements over
`subtree × depth` rows, and we have no depth-filtered queries to justify it.

**Consequences.**
- `path` is built from **UUIDs, not names** — so rename never touches descendants,
  and LIKE metacharacters can never appear in it.
- `path` is internal: never accepted from a request, never returned to the client.
- Moving a folder rewrites descendant paths in one `UPDATE ... substr(...)`.
- `path` and `parent_id` can drift → mitigated by a recompute script (see #5).

---

## 5. Subtree aggregates: incremental counters

**Status:** Accepted

**Context.** The README must answer "how do you compute the total size and item count
of a folder including its whole subtree?".

**Decision.** Maintain `total_size`, `file_count`, `folder_count` on folder rows (and
on `DataRoom`), updated inside the same transaction as the mutation, via a single
`updateMany` over the ancestor ids taken from `path`.

**Rationale.** Computing on the fly is fine for one opened folder, but a listing of 50
folders becomes 50 subtree scans — an N+1 that shows up precisely at the 100k scale the
brief asks about.

**Consequences.**
- Write amplification is one `UPDATE` over ~depth rows (typically < 10).
- A new invariant to maintain at four call sites: create, delete, move, restore.
- **Mitigation:** a `recompute` script that rebuilds both `path` and all aggregates
  from `parent_id` + blob sizes. This converts a scary invariant into a repair button,
  and is worth describing in the README.
- Bonus: per-user storage quota checks become a single integer comparison.

---

## 6. Deletion: soft delete, no trash UI

**Status:** Accepted

**Context.** The brief requires warning the user what will be deleted, and mentions the
edge case of deleting a folder someone else is currently viewing.

**Decision.** `deleted_at` timestamp. Subtree delete is one `UPDATE ... WHERE path LIKE`.
No Trash/Restore screen — from the user's point of view deletion is permanent.

**Rationale.** The brief says not to ship unimplemented features, so a half-built trash
screen would be worse than none. Soft delete still buys recoverability during
development and demo, and a cheaper subtree delete.

**Consequences.**
- Every read must filter `deleted_at IS NULL`. Forgetting it once leaks a deleted
  document to a counterparty — the worst failure this system can have.
  **Mitigation:** a Prisma Client Extension applies the filter globally, so it cannot
  be forgotten.
- Unique constraints must be **partial** (`WHERE deleted_at IS NULL`), which Prisma
  cannot express declaratively — written as raw SQL in the migration.
- Blobs are marked for cleanup rather than deleted inline.

---

## 7. Sharing: a grant on a node, resolved by ancestry

**Status:** Accepted

**Context.** Sharing a folder must grant read access to everything nested inside it,
for both a public link and a per-user grant, with revocation.

**Decision.** One `Share` row per grant, attached to a node (or to the whole Data Room
when `nodeId IS NULL`). Permissions on descendants are **derived**, never materialized.

```
Share { dataRoomId, nodeId?, mode: LINK | USER, role: VIEWER,
        tokenHash?, granteeEmail?, expiresAt?, revokedAt? }
```

**Rationale.** Materializing permissions onto every descendant means 20k writes to
share a folder, 20k more to revoke, recomputation on move, and inheritance logic on
every upload — permissions become a cache that must be invalidated. Deriving them
makes revoke a single-row operation that applies instantly to the whole subtree, and
new uploads inherit access with no code at all.

**Consequences.**
- Requires cheap ancestor lookup → this is *why* decision #4 exists.
- `ShareRecipient` as a separate table is unnecessary: one row per principal.
- Sharing with someone who has no account yet works, because the grant stores
  `granteeEmail`, not a user foreign key.
- **Per-user roles without remodeling** (a README question) is answered by adding
  `EDITOR` to the `ShareRole` enum and checking `role` in write guards. No schema change.

**Security requirements.**
- `granteeEmail` is matched only against a **verified** session email, otherwise
  registering an account on someone else's address would steal their access.
- Link tokens are generated with `randomBytes(32).toString('base64url')` (not UUIDv4 —
  insufficient entropy) and stored **hashed**, so a database dump does not yield
  working links.

---

## 8. Authentication: Google SSO only

**Status:** Accepted

**Context.** The brief allows social auth or email/password. Email/password would add
registration, forgotten-password, reset and verification flows, plus an SMTP vendor.

**Decision.** Google OAuth only, via `@nestjs/passport` + `passport-google-oauth20`.
`User` and `Account` are separate tables (one person, many login methods) so adding a
second provider later does not create duplicate users.

**Consequences.**
- `email_verified` comes from Google, so the email-based grant matching in #7 is sound
  with no extra work.
- **Known limitation:** a reviewer needs two Google accounts to exercise permissioned
  sharing. Public links are testable anonymously in a private window.
- **Must not forget:** set the OAuth consent screen to *In production*. In *Testing*
  mode only explicitly listed test users can sign in, and a reviewer would just see
  `Error 403: access_denied`.
- **Demo strategy:** auto-provision a populated sample Data Room on first login, and
  publish public share links (populated / empty / revoked) in the README so the
  reviewer sees a real product instead of an empty state.

---

## 9. Access enforcement: `AccessScope` + scope-bounded repository

**Status:** Accepted

**Context.** Anonymous link access and authenticated access must not diverge into two
authorization paths, but public and private responses need different shapes. The main
risk is accidentally serving a node above the shared root (including via breadcrumbs).

**Decision.** Separate controllers with separate DTOs, a single `AccessControlService`,
and repositories that take an `AccessScope` as their first argument.

```ts
declare const brand: unique symbol;
type AccessScope = {
  readonly [brand]: 'AccessScope';
  dataRoomId: string;
  rootNodeId: string | null;   // null => whole data room
  rootPath: string;            // '/' for owner, '/f1/f2/' for a shared subtree
  role: 'OWNER' | 'VIEWER';
};
```

Every query is bounded in SQL by `path startsWith scope.rootPath`.

**Rationale.** Authorization expressed as a *boundary* rather than a *boolean* makes
over-reach structurally impossible: a node above the share root simply does not exist
for that query and returns 404. Breadcrumbs are derived by
`node.path.slice(scope.rootPath.length)`, so clipping is arithmetic rather than
vigilance — which matters because folder names themselves leak information in an M&A
context.

**Enforcement mechanisms** (chosen over a runtime "ORM for the ORM", which would mean
reimplementing Prisma's API and losing its type inference):
1. `AccessScope` is a branded type — only `AccessControlService` can produce one.
   A service cannot fabricate one with an object literal; TypeScript rejects it.
2. `PrismaService` is not exported from the persistence module — the DI container
   fails at startup if a service tries to inject it.
3. ESLint `no-restricted-imports` forbids `@prisma/client` outside `*.repository.ts`.

**Consequences.** No auth interceptors or middleware; one ordinary `JwtAuthGuard` on
the private controller only. API responses for a recipient report `parentId: null` at
the share root, so the client stops climbing instead of hitting a 403.

---

## 10. Deploy topology: Vercel proxy → Cloud Run

**Status:** Accepted

**Context.** No custom domain is available. Frontend on `*.vercel.app` and backend on
`*.run.app` are different sites (both are on the Public Suffix List), so a shared
cookie is impossible; `SameSite=None` third-party cookies are blocked by Safari.

**Decision.**

```
browser → app.vercel.app
             │  /api/*   (vercel.json rewrite)
             ▼
          dataroom-api-*.run.app   (Docker)
             ├── Neon      (new database inside the existing project)
             └── GCS       (presigned PUT/GET, direct from the browser)
```

**Rationale.** Proxying through Vercel makes the browser see a single origin. The
session cookie becomes first-party (`HttpOnly; Secure; SameSite=Lax`) and works in
every browser; CORS disappears entirely; and local development mirrors production
exactly via Vite's `server.proxy`. Cloud Run was chosen over Render because a free
Render service sleeps and cold-starts in ~50s — the first thing a reviewer would
experience of the product.

**Consequences.**
- +50-100ms latency on API calls; uploads and PDF downloads bypass the proxy entirely
  (presigned URLs straight to GCS), so only JSON flows through it.
- OAuth redirect URI must be `https://<app>.vercel.app/api/auth/google/callback`.
- The Cloud Run URL stays publicly reachable, satisfying "backend deployed and
  publicly accessible"; both URLs go in the README.
- A custom domain remains an optional cosmetic upgrade, no longer an architectural need.

---

## 11. Frontend: Vite SPA

**Status:** Accepted

**Context.** Any React framework is allowed; Vercel is recommended for hosting.

**Decision.** Vite + React + TypeScript, React Router, TanStack Query, Tailwind +
shadcn/ui, react-hook-form. Zustand only if the upload queue needs global state.

**Rationale.** We already have a full backend. Next.js would add a second server and a
permanent question of "does this belong in Next or in Nest?" — two places that read the
session, two validation sites, two deploy artifacts. Its real benefits here (SSR, SEO)
do not apply behind a login.

**Consequences.**
- Uploads use `XMLHttpRequest`, not `fetch` — `fetch` still has no upload progress event.
  This is a platform limitation worth knowing before writing the progress bar.
- TanStack Query directly addresses the "folder deleted while someone is viewing it"
  edge case: cache invalidation plus `refetchOnWindowFocus` surfaces the change, and a
  `410 Gone` becomes a proper error state.

---

## 12. Tooling: pnpm workspaces, no Turbo; Zod contracts

**Status:** Accepted

**Decision.**
- **pnpm workspaces**, three packages: `apps/api`, `apps/web`, `packages/contracts`.
  No NX (its dependency graph, affected-commands and generators pay off from ~10-20
  packages, and it complicates the Dockerfile). No Turborepo either — build ordering
  here is one line of npm scripts, and adding it would repeat the mistake NX was
  rejected for.
- **Supply chain:** `save-exact=true` and `minimum-release-age=10080` (7 days) in
  `.npmrc`, `--frozen-lockfile` in Docker and CI. Most compromised npm releases are
  detected and pulled within hours, so a week's delay removes nearly the whole class.
- **Zod in `packages/contracts`** as the single source of truth for request/response
  shapes: one schema serves the Nest validation pipe, the service types, the
  react-hook-form resolver, and the TanStack Query types. A contract change becomes a
  compile error rather than a runtime surprise on demo day.

**Rejected: LIVR.** Its strength is language-independent rules shared across services in
different languages. We have one language on both ends, and it gives no TypeScript
inference — types would be hand-maintained alongside the rules, which is exactly the
drift `packages/contracts` exists to prevent.

**Consequences.** `pnpm deploy --filter=@dr/api --prod out` keeps the API Docker image
free of the rest of the workspace. Zod normalization (`.trim()`, `.toLowerCase()`) is
applied at the edge so name uniqueness and email matching behave predictably.

---

## 13. API shape: one call, bare object, opaque cursor

**Status:** Accepted. Response shape refined by #24 — read that one for what the endpoint
actually returns.

**Decision.** `GET /api/rooms/:roomId/nodes/:nodeId?cursor=` returns
`{ node, breadcrumbs, children, nextCursor }`. Omitting `nodeId` means the room root.

**Rationale.** The browser view always renders all three pieces, so three endpoints would
produce waterfall loading on every navigation, which is visible on every click. The cost,
coarser cache keys, is paid once in a single TanStack Query key.

No `{ data, meta }` envelope: it earns its place when responses are heterogeneous or
metadata is cross-cutting, and here it would be ceremony around one shape that Zod already
types on both ends. Errors are the exception and do carry a shape — Nest's default
`{ statusCode, message, error }` — so the client can switch on status per the error
contract.

**Consequences.** The cursor is **opaque**, base64 of `(type, lower(name))`. Opaque
because a keyset position is not public API: encoding it stops clients from constructing
one and lets the sort key change without breaking the contract.

---

## 14. Session: a short JWT in the cookie, no refresh token

**Status:** Accepted

**Context.** A stateless JWT cannot be revoked, which looks uncomfortable in a product
about revocation.

**Decision.** A 2-hour JWT in the httpOnly cookie, re-issued silently on any authenticated
request past half its life. Logout clears the cookie.

**Rationale.** The discomfort dissolves on inspection: the revocation the brief requires is
revocation of **shares**, which is a database row consulted on every access resolution and
therefore instant. Session revocation is a different feature that nothing in `BRIEF.md`
asks for. A database-backed session would add a write per request and a migration to buy a
property nothing asks for. With silent re-issue, a refresh token would only matter for
sessions longer than the demo will ever run.

---

## 15. PDF viewing: `<iframe>` first

**Status:** Accepted

**Decision.** `<iframe>` pointed at a short-lived presigned GET URL. `react-pdf` is on the
stretch list.

**Consequences.** Two constraints travel with this choice:

- The presigned URL is fetched with `staleTime: 0` / `gcTime: 0` and never served from
  cache — a 300-second URL outlives its validity inside a normal query cache, and the
  failure renders as a storage-provider XML error inside the app.
- The presigned GET sets `response-content-type=application/pdf` and
  `response-content-disposition: inline`. Without `inline` the browser downloads the file
  instead of rendering it in the frame.

---

## 16. Test scope: Vitest, two layers, written where the code is

**Status:** Accepted, with two amendments. Timing superseded by #26 — the integration
tests ship with the code they exercise, not as an end-of-Phase-4 block. The
"`USER`-token mode branch" named below does not exist; see #27.

**Decision.** Vitest in both apps — one runner, one config idiom.

- **Unit, mocked repository:** `AccessControlService` — scope boundaries, breadcrumb
  clipping, revoked and expired links, ancestor inheritance, the `USER`-token mode branch.
- **Integration smoke set, against the compose Postgres:** four tests — subtree delete over
  an already-deleted row, `23505` retry on upload, `23505` → `409` on rename, move cycle
  guard.

**Rationale.** The smoke set is not optional and the unit tests cannot replace it: a mocked
repository never executes raw SQL, never enters an aborted transaction, never takes an
advisory lock. Those four behaviours are exactly where the design is load-bearing, so
"test only the critical path" means these, not fewer.

**Consequences.** Both sets are written at the end of Phase 4, where
`AccessControlService` reaches its final shape — not retrofitted at the end of the
project, where they become the implicit cut. The *broad* integration suite stays stretch.

---

## 17. Lint and format: flat config, type-checked, no hooks

**Status:** Accepted

**Decision.** `typescript-eslint` recommended-type-checked plus the project's boundary
rules — `no-restricted-imports` banning `@prisma/client` outside `*.repository.ts`, and
raw SQL confined to `node.repository.ts`. Prettier for formatting.

**Rationale.** The boundary rule is not style: it is the enforcement mechanism decision #9
depends on, so it is the one rule that must exist. No Husky, lint-staged or commitlint — a
pre-commit hook that fails mid-demo costs more than it saves at this scale, and CI runs the
same checks anyway.

**Rejected: Google's config.** A style guide for a different era of the language; it would
fight the type-checked ruleset.

---

## 18. CI: one workflow, checks only

**Status:** Superseded in part by #22 — the checks workflow stands, the "no deploy"
half does not. Its stated cost (service-account keys in GitHub secrets) turned out to
be avoidable.

**Decision.** One GitHub Actions workflow on PRs and pushes to `main`: typecheck, lint,
test. No build, no deploy.

**Rationale.** Vercel deploys itself on push, and Cloud Run is deployed manually in the
first pass. A deploy workflow means service-account keys in GitHub secrets and a debug loop
inside CI — infrastructure budget spent instead of product budget.

---

## 19. Move UX: a "Move to…" dialog, plus drag-and-drop

**Status:** Accepted

**Decision.** A dialog with a folder picker is the primary affordance; drag-and-drop
between folders ships alongside it.

**Rationale.** The dialog is predictable, accessible and testable, and it satisfies the
brief on its own. Drag-and-drop was originally stretch and was pulled into the plan by
owner decision — it is what makes the browser feel like a file manager rather than a form.

**Consequences.** Name conflict on move is `409` with a rename/cancel dialog, not a silent
auto-suffix. See decision #20 for why the conflict paths split the way they do.

---

## 20. Name conflicts: suffix only where the user did not choose the name

**Status:** Accepted

**Context.** The database enforces uniqueness per folder, case-insensitively, ignoring
soft-deleted rows. Four call sites can hit it.

**Decision.**

> Auto-suffix where the name is **not chosen by the user in that moment**. Raise `409`
> with a dialog where it is.

- **Upload** → `contract.pdf` becomes `contract (1).pdf`, silently. The name came from the
  file, and dragging twenty files must not open twenty dialogs.
- **Create folder, rename, move** → `409`, no suffix. The user typed the name, or chose a
  destination knowing its contents.

**Consequences.** The suffix path is an **optimistic insert**: attempt it, catch `23505` /
`P2002`, recompute the suffix, retry, bound at 3 attempts then `409`. Read-then-insert is a
check-then-act race that fails under a multi-file drop. The retry re-runs the **whole**
interactive transaction, because `23505` aborts it and Prisma exposes no savepoints —
retrying just the `INSERT` fails with "current transaction is aborted", which is worse than
the race it was meant to fix.

---

## 21. Data Rooms: multi-room model, minimal UI

**Status:** Superseded in part by #23. The multi-room *schema* below stands; the
create-room affordance and the switcher do **not** — do not build them.

**Decision.** The schema stays multi-room. The UI ships a create-room affordance in the
zero-room empty state and a switcher only when a user actually has more than one room. No
room list route, no room rename.

**Rationale.** The affordance is required: without it, cutting both the multi-room UI and
the auto-provisioned sample room would strand a fresh account with no room and no way to
create one, making every owner-side flow ungradable. Everything beyond that affordance is
unrequired surface — `BRIEF.md` never asks to manage rooms, and sharing a whole Data Room is
served by the share dialog offering "this Data Room" as a scope.

---

## 22. Deploy mechanism: GitHub Actions with Workload Identity Federation

**Status:** Accepted. Supersedes the "no deploy" half of #18; the topology of #10 is
unchanged.

**Context.** Decision #10 fixes the deploy *topology* (Vercel rewrite → Cloud Run) but
never says how a build reaches Cloud Run. Two constraints settle it. First, `BRIEF.md`
requires a GitHub repository as a deliverable, so a remote exists whether or not CI uses
it. Second, the assistant must not hold cloud credentials: an authenticated `gcloud` on
the development machine is reachable by any process running there, and the blast radius
of a mistake is the whole project.

Deploying by hand from a local `gcloud` fails the second constraint. Deploying by hand
from Cloud Shell satisfies it but puts a human inside every iteration of a loop that
typically runs five to ten times — wrong port, missing env var, failed startup probe,
database unreachable from the chosen region.

**Decision.**

> Cloud Run is deployed by a GitHub Actions workflow that authenticates through Workload
> Identity Federation. No service-account key exists anywhere.

- The workflow exchanges GitHub's short-lived OIDC token for temporary Google Cloud
  credentials. Nothing long-lived is stored in GitHub secrets, and nothing at all is
  stored on the development machine.
- The identity-pool provider carries an attribute condition on the **numeric**
  `repository_id` and `repository_owner_id`, plus `ref == 'refs/heads/main'`. Numeric ids
  are used because a repository *name* is released when the repository is deleted and can
  be claimed by someone else; the repository is public, so this matters.
- `deploy.yml` triggers on `workflow_dispatch` only. There is no deploy on push: a
  push-triggered deploy on a public repository widens the set of events that can reach
  the pool for no gain here.
- Application secrets (`DATABASE_URL`, the Google OAuth client secret, the session
  secret) live in Secret Manager and are referenced by the Cloud Run service, never
  passed through the workflow file.
- Database migrations run from the container entrypoint — `prisma migrate deploy` with
  bounded retries and exponential backoff, then `exec` into the server. A deploy is
  therefore the only migration mechanism; there is no separate manual step against Neon.

**Rationale.** This is the only arrangement that keeps both properties at once. The
assistant gets an autonomous debug loop — it edits the Dockerfile and workflow, triggers
`gh workflow run`, and reads `gh run view --log` — while every credential that could
damage the project stays inside GCP and GitHub. The one-time GCP bootstrap (enable APIs,
create secrets, service account, pool, provider, IAM bindings) is scripted and run by the
owner in Cloud Shell, where gcloud is already installed and already authenticated.

**Consequences.**
- One-time setup is heavier than creating a key: pool, provider, attribute mapping,
  attribute condition, and a `roles/iam.workloadIdentityUser` binding. It is a script,
  run once, and its cost does not recur.
- The assistant cannot deploy new *code* on its own, because it does not push (see
  `CLAUDE.md`). It can re-run a deploy of an already-pushed ref, which covers every
  failure whose cause is configuration rather than code. To keep the owner out of the
  loop as much as possible, the image is validated locally with `docker build` and
  `docker run` against the compose database before the first push.
- The workflow needs `permissions: id-token: write`, and that permission is granted in
  the deploy job only.
- The `ci.yml` checks workflow from #18 is unaffected and still runs on PRs and pushes.

---

## 23. One Data Room per owner: no create-room affordance, no switcher

**Status:** Accepted. Supersedes the UI half of #21; the multi-room *schema* of #21 is
unchanged.

**Context.** #21 justified a create-room affordance by a condition that no longer holds:
it assumed the auto-provisioned room might be cut, which would strand a fresh account
with no room and no way to make one. Phase 1 shipped `DataRoomService.ensureProvisioned`
instead — idempotent, and run on every sign-in — so a signed-in user always owns exactly
one room.

That makes three planned pieces unreachable by construction:

- the zero-room empty state — `dataRooms` is never empty,
- the room switcher — `GET /api/me` returns `listOwnedBy` only, and a room reached
  through a Share is never one the caller owns, so the count never exceeds one,
- `POST /api/rooms` — nothing would call it.

**Decision.**

> A user owns exactly one Data Room, provisioned on first sign-in. No create-room route,
> no room list, no switcher, no room rename.

The schema stays multi-room and `dataRooms` stays an array — both cost nothing and both
are what makes the limitation a UI choice rather than a remodelling job.

**Rationale.** `BRIEF.md` never asks to manage rooms, and #1 forbids building outside the
requirements. An unreachable screen still carries the full definition of done — loading,
empty and error states — so it is not free; it is roughly half a session spent on a branch
no reviewer can enter.

**Consequences.**

- The last Phase 2 checkbox is removed from `roadmap.md`. The rest of Phase 2 is untouched.
- `dataRooms: []` becomes an *error* state, not an empty state: it means provisioning
  failed or a row was removed by hand, and the shell says so rather than offering a
  create button it does not have.
- Sharing a whole Data Room is unaffected — the share dialog offers "this Data Room" as a
  scope (#21), which targets `Share.nodeId IS NULL`.
- Reversing this is cheap: the repository already has `create`, so the affordance is a
  controller method and a dialog if it is ever wanted.

**Amendment (Phase 4, issue 08.4): the "no switcher" clause narrows, nothing else does.**
This decision was written when a signed-in user could see at most one thing —
`GET /api/me`'s `dataRooms` never held more than one entry, and nothing else was
reachable. Phase 4 sharing broke that premise: a grantee's live grants are a second,
legitimate destination (`/shared`, "Shared with me"), so a signed-in user can now be in two
places. This does not reopen the rest of #23 — still exactly one owned room, still no
create-room route, still no room list, still no room rename — it only means `/` can no
longer be the only reachable screen: `/` unconditionally redirects to the caller's own room
(it no longer branches on shares), and `AppShell` carries a permanent nav link to `/shared`,
always visible regardless of count. The rejected alternative was hiding that nav link when
the count is zero — cheaper, since it needed no empty state — but it reproduces the exact
problem this amendment exists to fix: a nav item that silently appears the moment someone
shares something with the caller, with no other notification surface in this phase (no
Activity feed exists yet). It also contradicts both reference products consulted (Google
Drive, Dropbox), which keep "shared with you" permanently in nav with its own empty state,
never hidden at zero.

---

## 24. Browser response: aggregates travel with what you are looking at

**Status:** Accepted. Refines #13, which fixed the response shape before there was
anything to put in it.

**Context.** Phase 1 served the room's `totalSize / fileCount / folderCount` from
`GET /api/me`, where they were free — nothing could change them. From Phase 2 every
folder create and delete does, so the shell's *identity* query would have to be
invalidated by content mutations, and the same three numbers would live in two caches.

Separately, #13 says omitting `nodeId` means the room root — but the room root has no row
in `nodes`, and the shape never said what fills `node` there.

**Decision.**

```
GET /api/rooms/:roomId/nodes/:nodeId?
  →  { room?, node, breadcrumbs, children, nextCursor, role }

  node: null        this is the root — there is nowhere further up
  breadcrumbs: []   at the root
  room              present only when `scope.rootNodeId === null`
  role              'OWNER' | 'VIEWER', straight off the AccessScope
```

`role` travels with every response because the same route serves the owner and the
recipient of a `USER` share, and the client has nothing else to hide "New folder",
"Rename" and "Delete" behind. It is already resolved; returning it costs nothing.

**One private route serves both.** A `USER` share has no token — a CHECK constraint
forbids one — so `/s/:token` cannot serve its recipient, and they browse
`/rooms/:roomId/n/:nodeId` like the owner. That is exactly what `AccessScope` is for: the
same query path, a different boundary. A third controller would add no property that the
scope does not already provide; the separate DTOs of #9 divide the *anonymous* surface
from the authenticated one, not the owner from the grantee.

**Therefore the route never decides whether a room exists.** It asks this endpoint and
renders what the API answers, including its `404`. Deriving existence from `/api/me`
— as `rooms.$roomId.tsx` does today — locks a recipient out of a room they have a valid
grant on, because `/api/me` lists rooms the caller *owns*, not rooms they can *reach*.
Phase 2 replaces that component, so the rule has to be in place before it is rewritten,
not after.

- `GET /api/me` narrows to `{ user, dataRooms: [{ id, name }] }` — identity and what
  exists, nothing about content.
- Aggregates arrive with the thing being viewed: from `room` at the root, from the `Node`
  row inside a folder. One mutation invalidates one key, and the header and the table
  refetch together instead of drifting.
- `node: null` rather than a synthetic root node: a fake row with a fabricated id
  eventually gets treated as a real one.

**`room` is conditional, and that is a security property, not a convenience.** A signed-in
recipient of a `USER` share browses the *private* route — a `USER` share has no token, so
`/s/:token` cannot serve them — and `room.name` (`Project Falcon`) sits above their scope
root. Making `room` unconditional now would mean removing it again in Phase 4.

**Consequences.**

- A folder's own subtree totals are on screen wherever a folder is, which is the README
  question the brief grades, demonstrated rather than asserted.
- Room and node URLs stay ordinary UUID paths: they are guarded by the session and
  `AccessScope`, never by secrecy. Only `/s/:token` is a capability, which is why it alone
  is `randomBytes(32)` stored hashed (#7).

---

## 25. Writes are guarded in the service, and refused with `404`

**Status:** Accepted.

**Context.** #9 makes `AccessScope` a boundary that every query is confined to, which
answers *what a caller can see*. It never answers *what a caller may change* — until now
nothing else could, because the only principal was the owner. Decision #24 changed that:
the recipient of a `USER` share browses the same private route, holding a valid
`AccessScope` with `role: VIEWER`, inside someone else's Data Room. #24 also returns
`role` so the client can hide "New folder", "Rename" and "Delete".

Hiding a button is not access control. Without a server-side check, a `VIEWER` could
create, rename and delete inside the owner's subtree with a shell one-liner, and the
share the brief calls **read-only** would be read-write.

**Decision.**

> Every node mutation asserts `scope.role === 'OWNER'` as its first statement, in the
> service, and refuses with `404`.

- **In the service, not a Nest guard.** A decorator-based guard would have to read the
  `AccessScope` off the request, and `architecture.md` refuses to put it in ambient state
  — scopes are passed explicitly, which is what makes them impossible to forget or fake.
- **`404`, not `403`,** consistently with the rest of the design: a `403` on a node a
  caller can see but not change is harmless here, but two codes for one boundary is how
  the one case that *does* leak gets written by analogy later.

**Consequences.**

- The check is per-mutation and mechanical, which makes its absence visible in review.
- `EDITOR` (#7, #5's README answer) slots in as a role comparison in the same line; no
  structural change.
- The public `/s/:token` surface is unaffected — it is read-only by construction, having
  no mutation controller at all.

---

## 26. Integration tests ship with the code they exercise

**Status:** Accepted. Amends the *timing* half of #16; its content and scope are unchanged.

**Context.** #16 placed both test sets at the end of Phase 4, on one rationale: that is
where `AccessControlService` reaches its final shape. That is true of the **unit** set,
which tests exactly that service. It was never true of the **integration** set — of its
four tests, two exercise Phase 2 code (subtree delete, `23505` on rename) and two exercise
Phase 3 code (`23505` on upload, move cycle guard). None touches the shape of
`AccessControlService`; they were batched along for the ride.

The cost of that ride is concrete. The subtree delete's failure mode — a second delete
decrementing ancestor aggregates twice, because the raw statement bypasses the soft-delete
extension — is silent, and it surfaces as wrong numbers in the delete warning, which
`BRIEF.md` grades. Batching leaves that code unverified for two phases.

**Decision.**

> Each integration test lands in the phase that writes the code it covers. The unit set
> stays in Phase 4, where #16 correctly puts it.

**Consequences.**

- Phase 2 builds the harness (compose Postgres, migrations, per-test cleanup) and pays
  roughly 40 minutes it would otherwise not spend. The harness is paid for once either
  way, so Phase 3's two tests then cost almost nothing.
- The tests stop being a single end-of-Phase-4 block, which is the shape work takes when
  it becomes the implicit cut — the outcome #16 was written to avoid, arrived at by a
  different route.

---

## 27. A `USER` share carries no token; the two resolution paths stay separate

**Status:** Accepted. Resolves a contradiction between #7 and #16 in favour of #7's
schema; supersedes the "`USER` token mode branch" wording in #16.

**Context.** #7's schema and the shipped `shares_mode_check` constraint keep `token_hash`
null on every `USER` row. #16 and the Phase 4 plan, meanwhile, described a
`resolveForToken` that *branches on `share.mode`*, with `USER` requiring a session whose
verified email matches `granteeEmail` — the "invite link" pattern, where the owner sends a
URL that only the named person can open.

Both cannot be true. A token can never find a `USER` share, because no `USER` share has a
token hash to find it by. The branch is unreachable, and an agent implementing the plan
literally would either build dead code or relax the constraint to make it live.

**Decision.**

> A `USER` share has no token. `resolveForToken` serves `LINK` shares only and has no
> `mode` branch. A `USER` grant is resolved solely by `resolveForUser`, through the
> ancestor-grant lookup, against a verified session email.

Discovery is the "Shared with me" listing, which reads the grantee's rows by
`(granteeEmail, revokedAt)` and already holds both `dataRoomId` and `nodeId` — enough to
link straight to `/rooms/:roomId/n/:nodeId`, or to `/rooms/:roomId` with no `/n/` segment
when `nodeId` is null, which is how a whole-room grant is stored.

**Rationale.** The invite-link pattern is the nicer product, and it was rejected only on
cost and scope: it needs a migration relaxing a CHECK constraint that `data-model.md` does
not describe, which is a schema change this project treats as a stop-and-ask. It buys
convenience of *delivery*, while `BRIEF.md` asks only that a permissioned share be
viewable by the specific users granted access — which this satisfies without it.

**Consequences.**

- Only `LINK` tokens exist, so `randomBytes(32)` and the stored hash (#7) protect the one
  thing that is genuinely a capability.
- The permissioned share stays gradable on one Google account: the Phase 4 seed creates a
  `USER` share to the reviewer's verified email on first login, so "Shared with me" is
  populated the moment they arrive.
- `Share.tokenHash` remains nullable and the CHECK constraint unchanged, so reversing this
  later is a migration plus one branch, not a remodelling.

---

## 28. Upload is a protocol, not a request: URL space, blob tenancy, and bytes that outlive their node

**Status:** Accepted. Fills in `architecture.md` § Upload flow, which was written before the
`/rooms/:roomId/…` URL space existed (`4cf5e7c`, two doc iterations before `9152e06`
introduced it) and therefore names no room in either endpoint.

**Context.** `CONTEXT.md` is unambiguous that a Node is one entity with two types, so the
obvious reading is that a `FILE` should be created by the same `POST /nodes` that creates a
`FOLDER`, with a `blobId` attached. Phase 3 grooming considered exactly that and rejected
it.

**Decision.**

> A `FILE` is not created by a request; it is created by a **protocol**, and the protocol
> gets a URL space of its own under the room:
> `POST /api/rooms/:roomId/uploads/presign` and `POST /api/rooms/:roomId/uploads/complete`.

- **Presign takes a batch, complete takes one file.** This asymmetry is not an oversight.
  Every presign check is *set-level* — `≤ 10 files` is a constraint on the set, and the
  quota is `sum(sizes) + room.totalSize ≤ 200 MB`, which ten 30 MB files pass individually
  and fail together. Complete has no set-level check at all: each file has its own `HEAD`,
  its own blob, its own name conflict. A batched complete would also force per-file `422`
  out of the HTTP status and into an envelope, and would inflate the auto-suffix retry unit
  from one row to the whole batch — a `23505` on item 17 of 20 aborts and re-runs all 20,
  with #20's bound of 3 now protecting twenty files instead of one.
- **Complete is idempotent.** The `PENDING → READY` flip is a conditional
  `UPDATE … WHERE id = $1 AND status = 'PENDING' RETURNING …` inside the transaction — not
  a read followed by a write, which is the check-then-act shape F11 already rejected for the
  suffix. Zero rows means the blob was completed before: look the existing node up by
  `blobId` and return it with `200`. Without this, a lost response over a committed
  transaction produces two nodes on one blob and charges the aggregates twice for bytes
  that exist once.
- **`storageKey` is `${dataRoomId}/${blobId}`** — no name, no extension. The id comes from
  `randomUUID()` in application code before the insert, for exactly the reason
  `createFolder` does it: a `NOT NULL` column containing the row's own id cannot wait for a
  database-side default.
- **That key is also the blob's tenancy.** `Blob` has no `dataRoomId` column, so a blob
  belongs to no room until a node points at it — and nothing would otherwise stop a caller
  from attaching another room's `blobId` to their own node. `blob.repository.ts` therefore
  takes `scope.dataRoomId` (not a full `AccessScope`; a blob has no ancestry to clip) and
  adds `storageKey: { startsWith: dataRoomId + '/' }` alongside the id lookup. No schema
  change, and the boundary stays in the `WHERE` clause rather than in a TypeScript
  comparison someone can forget. It needs **no raw SQL**: Prisma's `startsWith` compiles to
  `LIKE`, so `node.repository.ts` stays the only file the ESLint rule permits raw statements
  in, and `Blob` is absent from `SOFT_DELETABLE_MODELS`, so the extension does not touch it.
- **Deleting a file never touches storage.** The alternative is not merely undesirable, it
  is structurally impossible: `nodes_type_blob_check` requires `FILE → blob_id NOT NULL`, so
  a soft-deleted file's blob row can be neither deleted (foreign key) nor detached (check).
  Removing only the bytes would make a reversible operation irreversible in fact while
  still looking reversible in the database — the failure #6 rates worst.

**Rationale.** Create-folder is one `INSERT` and one aggregate delta. Upload-complete is
`HEAD` → advisory lock → authoritative quota check → `status = READY` → node insert →
aggregate delta → retry of the whole transaction up to three times. Folding them into one
endpoint would put two failure surfaces under one `422`, which would then mean both "the
parent is a file" and "the bytes in storage are not what you promised".

The single-entity principle is not weakened by this: it is already honoured everywhere it
costs nothing. Browse, rename, move and delete all operate on both node types with no
branch on `type` at all. The asymmetry is in the *precondition* — a `FILE` cannot exist
without a `READY` blob — not in the entity.

**Consequences.**

- `Upload` enters `CONTEXT.md` as a first-class term. It was the only URL space in the
  system named after a process rather than a domain noun, and naming it fixes that in the
  glossary rather than in the route.
- **The name is not the type, anywhere.** Object keys are UUIDs, the stored content type is
  set at `PUT`, and the presigned GET pins `response-content-type`. A file's extension takes
  part in no decision the system makes, so rename does not police it: `contract.pdf` may
  become `contract.txt` and will still render as a PDF. Enforcing the extension would
  require `nodeNameSchema` to branch on node type, and it is deliberately one schema that
  does not know types. `response-content-disposition` carries `node.name`, RFC 5987 encoded.
- **The quota is computed from node aggregates, not from the bucket**, and after this
  decision the two are allowed to disagree: a room can report 0 bytes used while holding
  real objects in GCS. Nothing breaks — the authoritative check reads the same aggregates —
  but two categories of unreferenced bytes now accumulate, `PENDING` blobs from abandoned
  transfers and `READY` blobs under soft-deleted nodes. One scheduled sweeper collects both;
  it is described in the README and not built (Phase 6).
- A new row is owed to the scope-exception inventory for `blob.repository.ts`, and the
  layer diagram gains a repository under `file/` — the only module that writes to the
  database without one.

---

## 29. The broadest live grant defines a grantee's scope

**Status:** Accepted, Phase 4 issue 06. Refines #7's grant resolution; contradicts nothing.

**Context.** `AccessControlService.resolveForUser(userId, dataRoomId)` is called with a
room id and **no node id** — every node endpoint resolves the scope before it looks at what
was asked for. It must therefore choose *one* boundary per room before it knows what the
caller is about to read. Nothing stops an owner holding two live `USER` grants for the same
person in one room: `/Legal/` today, `/Legal/NDA.pdf` last week.

**Decision.**

> When a grantee holds several live grants in one Data Room, the **broadest** wins: a
> whole-room grant (`node_id IS NULL`) outright, otherwise the shortest node `path`,
> tie-broken by `created_at` ascending and then by `id`.

**Rationale.** Access is derived from ancestry, so a grant on `/Legal/` already subsumes
one on `/Legal/NDA.pdf`. Picking the narrower would *hide* content the grantee has
legitimately been given, and hide it invisibly — the folder simply would not be there, with
no error and nothing to report. The tie-breaks are not decoration: without a total order the
same request can resolve to two different scopes on two page loads, which is the class of
bug that reproduces for nobody.

**The alternative, and why it lost.** "Newest grant wins" is one line cheaper and reads as
the more recent intent. It lets a scope *shrink silently* the moment an owner adds a
narrower share on top of a broader one — the owner sharing one more file would take the
whole folder away, and neither party would see why.

**Consequences.**

- A grant whose node has been soft-deleted still produces a scope — **when no live grant is
  on offer.** Filtering dead grants out would collapse `410` ("the owner deleted this") into
  `404` ("you were never given this"); the `410` is raised on the node, where every other
  one is. So liveness is the *first sort key* rather than a filter: dead grants sort last
  and still win when they are all there is.
- **`path` length orders ancestors against descendants and nothing else.** A path is a
  sequence of fixed-width UUID segments, so two folders at the same depth compare equal and
  the order falls through to `created_at` — the older grant. That is why liveness had to
  become a key of its own: without it, a grantee holding grants on two sibling folders lost
  the survivor outright when the older one was deleted (`410` at the room root, `404` on the
  folder that was still live), while "Shared with me" went on listing it.
- Because a grantee's scope root is a real node, `NodeService.browse` resolves it for
  liveness when no `nodeId` is given. An owner has `rootNodeId === null` and never pays the
  extra query.
- Nothing in the model needs a "primary" or "effective" grant column: the rule is a total
  order over rows that already exist, evaluated per request.

---

## 30. What the anonymous share limit protects, and what it does not

**Status:** Accepted, Phase 4 issue 07. Extends #26's presign limit to the one surface that
has no session; contradicts nothing.

**Context.** `/api/s/:token` is the only endpoint in the system with no session. There is no
`userId` to key a limit on, and `SessionThrottlerGuard` cannot be reused: it throws
deliberately when there is no session, because on the presign route a missing session means
a broken guard chain. Here a missing session is the normal case. So the question was not
"which key" but whether a limit belongs here at all, and if so what it is for — a limit
whose purpose is stated wrongly gets tuned wrongly, and later gets removed by someone who
noticed it did not do what its comment claimed.

**Decision.**

> Thirty requests per minute per **client IP**, in its own named bucket, registered on the
> controller. Its stated purpose is bounding **unauthenticated database load** — and
> nothing else. Express `trust proxy` is set from `TRUST_PROXY_HOPS`, because `req.ip` is
> otherwise the proxy's address for every caller.

**Rationale.** Every hit on `/s/:token` costs a SHA-256 plus at least two Neon queries, from
a caller with no account and no other ceiling anywhere in the system. Without a limit, one
script scraping one leaked link — or hammering with varied tokens — runs unbounded, and the
first signal is the bill.

**What it explicitly is not.** Both of these were considered and rejected as descriptions,
not as features:

- **Not protection against token guessing.** `randomBytes(32)` is 256 bits; guessing is
  infeasible with or without a limit, and claiming otherwise would misrepresent what the
  control does.
- **Not DDoS protection.** A real flood is absorbed upstream, and `@nestjs/throttler`'s
  default storage is in-process — on an autoscaling Cloud Run service the limit is
  per-instance and approximate. Making it distributed would mean a shared store, which is
  infrastructure this project does not have and does not need for the stated purpose.

**Consequences.**

- `TRUST_PROXY_HOPS` is a deployment fact, not a preference, and it fails silently in both
  directions: too low collapses every caller into one bucket, too high makes
  `X-Forwarded-For` spoofable and the limit vacuous. It ships at `0` — the safe direction —
  and `ClientIpThrottlerGuard` logs the first anonymous request's `req.ip` and raw header
  once per process so the deployed value is observed rather than guessed. Nothing else in
  the codebase reads `req.ip`, so the blast radius of a wrong value is this limit alone.
- One options array now holds every named bucket in the application. `ThrottlerModule` is
  `@Global()`, so two arrays would be two providers racing for one token; the cost of one
  array is that each controller must `@SkipThrottle` the bucket that is not its own, and
  neither of those two lines is decoration.

---

## 31. Cascade revoke is a prompt, not a rule

**Status:** Accepted, Phase 4 issue 09. Not a roadmap checkbox — the roadmap only says
"Revoke" — and descopable on its own without touching anything else.

**Context.** Access is derived from ancestry, so a `USER` grant on a folder already gives
its grantee everything below it. A second grant to the same person on a file inside that
folder is therefore redundant while the folder grant lives, and becomes load-bearing at the
exact moment the folder grant is revoked: the nested row survives and keeps serving that one
file. Two readings of "revoke" are both defensible — cascading matches deleting a folder in
an operating system (what's inside goes with it); not cascading matches what the rows
literally say (two independent grants, one revoked) — and guessing either way surprises
somebody.

**Decision.** Revoking a `USER` grant on a folder or the whole room, when the same grantee
holds other live grants strictly beneath it, opens a confirmation naming the count and
offering "Revoke all N" or "Revoke only this one" — neither styled as the default, because
"Revoke all" destroys more than the one click asked for. Revoking a plain grant with nothing
nested under it, or a `LINK` share, never prompts: a `LINK` has no grantee to group by and
nothing nests under it.

**Rationale.** A rule picked either way would be right for some rooms and wrong for others,
silently. Asking costs one dialog and is asked only in the case that is actually ambiguous —
most revokes have nothing nested beneath them and stay a single click.

**Consequences.**

- The nested count is computed once, in `ShareService.nestedLiveGrantShareIds`, and read
  both by the share list (`ShareSummary.nestedLiveGrantCount`, for the dialog's wording) and
  by the revoke itself (`ShareService.cascadeTargets`, for what actually gets revoked) — one
  definition of "nested", so the number a caller was shown and what a cascade touches cannot
  disagree.
- A resolved node with `deletedAt` set is dropped before counting: `findGrantNodeInRoom` is
  raw SQL and deliberately bypasses the soft-delete extension (that is what lets a grantee
  see `410` rather than `404` on a deleted folder), so an unfiltered count would offer to
  revoke a grant that already serves nothing.
- A cascade revoke is one `UPDATE ... WHERE id IN (...)` (`ShareRepository.revokeMany`), not
  a `$transaction` — a single statement is already all-or-nothing in Postgres, and a second
  query would need one for a reason this cascade does not have.
- `DELETE /api/rooms/:roomId/shares/:shareId` takes `?cascade=` rather than a second
  endpoint, defaulting to `false`: a caller assembled before this issue landed does not
  cascade by accident.

---

## 32. The demo is one removable module: reset on every seed, and one meaning for "off"

**Context.** A reviewer has one Google account. Signing in gives them their own empty Data
Room and nothing to look at, so the permissioned share — an explicit `BRIEF.md` requirement
— could only be demonstrated by creating a second account. The demo removes that: Acme Corp.
already holds a populated room, and a sign-in is granted one folder of it.

Everything below was groomed in a session **after** `notes/issues/phase-4/issues/10` was
written, and supersedes that brief where the two disagree — notably its "Configuration"
section, which asked for the demo's identity in the environment.

**Decision.**

- **`pnpm db:seed` resets rather than accumulates.** Every run first hard-deletes every Data
  Room the demo owner holds — nodes, shares, blob rows and stored objects — and rebuilds the
  tree. The demo account is therefore always in one known state, and N runs leave exactly one
  room.
- **The room and the shared folder have fixed ids** (`DEMO_ROOM_ID`,
  `DEMO_SHARE_FOLDER_ID`). Everything else the seed creates gets a fresh `randomUUID()`.
- **The demo is not configured.** No `DEMO_*` environment variables: identity, names, ids and
  the off switch are constants in `apps/api/src/modules/demo/demo.constants.ts`.
- **"Off" means one thing.** `AUTO_GRANT_ENABLED` stops the grant being *issued*;
  `pnpm demo:revoke` takes back what was already issued. They are two steps of one
  procedure, in that order, not two alternatives.

**Rationale.**

- **Reset over accumulate**: without it, a changed room name seeded a second room, and the
  first sat there forever — invisible to the script and still served to anyone holding a
  grant on it. "Put this account back to what a fresh seed produces" has no such edge.
- **Fixed ids over lookup by name**: the seed and the grant have to agree on which folder is
  shared. By name, changing the name silently stopped the grant from finding anything — a
  failure with no error. By id they cannot disagree, and a `/rooms/:roomId` link survives a
  re-seed as a side benefit.
- **Constants over environment**: the demo exists to be identical everywhere. Two
  environments disagreeing about it was the same silent-miss failure as the name lookup, one
  layer up. On Cloud Run a changed environment variable is a new revision anyway, so the
  variable bought no operational speed either.
- **Two-step off**: a `Share` is a capability that was **issued**, not a rule re-evaluated
  per request, so a flag cannot revoke. An earlier `DEMO_AUTO_SHARE` variable was removed for
  giving the word "off" two meanings with different results — the configuration in which
  somebody confidently does the wrong one.

**Consequences.**

- **Order is load-bearing when switching the demo off.** Set `AUTO_GRANT_ENABLED = false`,
  deploy, *then* run `pnpm demo:revoke`. Revoking first re-grants anyone who signs in during
  the gap; `demo:revoke` warns when it sees the flag still on.
- **While the flag is on, everyone who signs in is granted.** Accepted: the reviewer's
  address is not known in advance, and that is the only reason the auto-grant exists.
- **`demo:revoke` revokes `USER` grants on the demo folder only.** A `LINK` share into the
  demo room is a deliberate artefact somebody made by hand — a public demo link for the
  README — and killing it as a side effect would be a surprise. Revoking everything is what a
  re-seed does. A dedicated mechanism for demo `LINK` shares is not designed yet.
- **The demo owner cannot be signed in as.** Their `provider_account_id` is synthetic and
  their address is on `.example`, which RFC 2606 reserves. That is deliberate — but it means
  demo grants have no UI: they cannot be listed or revoked from the app, only by the script.
- **Removing the demo** is `apps/api/src/modules/demo/`, one import and one call in
  `AuthModule`/`AuthService`, and then the repository capabilities that exist only for it,
  which cannot live in that directory because `PrismaService` is injectable only in
  `PersistenceModule`: `DataRoomRepository.deleteOwned`, the optional `id` on
  `DataRoomRepository.create` and `NodeRepository.createFolder`, `BlobRepository.listInRoom`
  and `deleteAllInRoom`, `StorageService.putObject`, and `UserRepository.findByEmail`.
- **`nest-cli.json` now exists** solely to copy `modules/demo/fixtures/*.pdf` into `dist`, so
  the seed can run from the production image. Deleting the demo makes that file's `assets`
  entry dead.

---

## 33. Download is available to a `VIEWER`

**Status:** Accepted, Phase 4 issue 05 (commit `4049d89`); recorded here in issue 11 to
close the documentation debt that shipping left behind.

**Context.** `ContentController` is not role-guarded
(`content.controller.ts:34-38`): every mutation asserts `scope.role === 'OWNER'`, but
producing a content URL is a read, gated only by the `AccessScope` boundary that already
answers who may open the node at all.

**Decision.** A `VIEWER` — including a Phase 4 share recipient — can request
`?disposition=attachment` and download the file, not only preview it. No role check is
added to the content endpoint.

**Rationale.** A reader who can already open the document in the preview can already keep
the bytes — screenshot, print-to-PDF, or simply the rendered page — so a block on the
explicit download button would be theatre: it would inconvenience the legitimate `VIEWER`
without stopping anyone determined to keep a copy. The `AccessScope` boundary is the actual
control; `role` governs writes, not reads.

**Consequences.**

- The row-actions menu is no longer hidden behind `canWrite`. It renders whenever it would
  hold at least one item, with each mutation item individually gated behind the caller's
  role. Re-gating the whole menu would leave a `VIEWER` with a permitted download and no
  control to ask for it.
- Anywhere a future reviewer expects "read" and "write" to share one guard, this is the
  documented exception: reads are bounded by scope alone.
