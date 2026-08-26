# Virtual Data Room

A secure repository for storing and sharing documents during due diligence.

> **Status: Phase 1.** This README covers setup and configuration only. The project
> overview, design decisions, ERD, scaling notes and hosted demo links are written in
> Phase 6, where this file is validated and completed.

## Requirements

| Tool    | Version      | Notes                                                                                                                            |
| ------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Node.js | **>= 22.13** | Pinned to `22` in `mise.toml`. Required for `process.loadEnvFile`, which `prisma.config.ts` uses instead of a dotenv dependency. |
| pnpm    | **11.9.0**   | Do not install it separately — run `corepack enable` and the version in `packageManager` is used automatically.                  |
| Docker  | any current  | Runs Postgres and MinIO locally, and builds the API image.                                                                       |

## Setup

```bash
corepack enable                 # pnpm, at the version this repository pins
pnpm install --frozen-lockfile  # never plain `pnpm install` in CI or a container
cp .env.example .env            # then fill it in — see Configuration below
```

`pnpm install` runs `prisma generate` as a postinstall step, so the Prisma client exists
before the first typecheck.

To run a one-off script or command with the values from `.env` in its environment — the
storage checks below, a migration against a different database — load the file into the
shell rather than passing variables one by one:

```bash
set -a && source .env && set +a
```

`set -a` marks every subsequent assignment for export, so `source` exports the whole file;
`set +a` stops that again, so nothing later in the session is exported by accident. The
application itself does not need this — `@nestjs/config` reads `.env` directly.

Two supply-chain rules apply to every dependency change, and both live in
`pnpm-workspace.yaml` rather than `.npmrc` — pnpm 10+ does not read them from `.npmrc`:

- `saveExact` — versions are pinned exactly, never with a range.
- `minimumReleaseAge` — nothing published in the last 7 days is installed.

## Running locally

The whole stack, including Postgres and MinIO:

```bash
docker compose up
```

- SPA — http://localhost:5173
- API — http://localhost:3000/api/health
- MinIO console — http://localhost:9001

Or on bare metal, against the compose databases only:

```bash
docker compose up -d postgres minio
pnpm --filter @dr/contracts build   # the API type-checks against its declarations
pnpm dev
```

`pnpm dev` runs both apps in parallel. To run one of them alone:

```bash
pnpm --filter @dr/api dev     # Nest, watch mode, port 3000
pnpm --filter @dr/web dev     # Vite, port 5173 (override with VITE_PORT)
```

The contracts build above is for **`apps/api`** only. The web app resolves `@dr/contracts`
to `packages/contracts/src` through an alias in `vite.config.ts` and a matching `paths`
entry in its `tsconfig.json`, so a schema edit reaches the browser through HMR with no
build step. The API still consumes `dist`, so after editing a contract its type-check fails
with "has no exported member" until that build runs.

The browser always talks to **one origin**. In development that is Vite's `server.proxy`
forwarding `/api` to the API; in production it is the Vercel rewrite to Cloud Run. This is
not a convenience — it is what makes the session cookie first-party, and it means an
authentication bug cannot exist only on a laptop. See `docs/decisions.md` #10.

### Checks

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All three must pass before any task is considered done. CI runs exactly these. Each one is
also available per workspace, which is what to reach for while iterating:

```bash
pnpm --filter @dr/web typecheck     # tsc --noEmit, browser project
pnpm --filter @dr/api test          # Vitest; the integration tests need compose Postgres up
pnpm --filter @dr/contracts test    # Vitest, no services needed
pnpm eslint apps/web/src            # lint one directory instead of the repository
```

### Build and format

```bash
pnpm build                          # every workspace: contracts tsc, api nest, web vite
pnpm --filter @dr/web build         # type-check then bundle the SPA into apps/web/dist
pnpm --filter @dr/web preview       # serve that bundle on 4173, with the same /api proxy
pnpm format                         # Prettier, write mode, whole repository
npx prettier --check .              # what to run before committing
```

### When the app looks wrong but the code looks right

Two failure modes here are stale processes rather than bugs, and both have cost a debugging
session:

- **A dev server that has been running for a day.** A Nest watcher can stop restarting its
  child, leaving the API executing code from before the last edits — it answers `500` for a
  bug that is already fixed, and the source line in the stack trace does not match the file.
  Check when the process actually started (`ps -o lstart -p <pid>`) before believing it.
- **Vite's dependency pre-bundle.** Its cache is keyed on the lockfile and the config, not
  on the contents of a linked workspace package, so it can serve a stale build of one. That
  is now avoided for `@dr/contracts` by the source alias above; if a _different_ linked
  package is ever added, restart with `pnpm --filter @dr/web dev --force`.

### Database

```bash
pnpm --filter @dr/api db:migrate    # create a migration during development
pnpm --filter @dr/api db:deploy     # apply pending migrations (what the container does)
pnpm --filter @dr/api db:reset      # drop and rebuild the local database
```

`DATABASE_URL` is the pooled connection used at runtime; `DIRECT_URL` is the direct one
used by migrations. They are different on Neon and must not be swapped — PgBouncer in
transaction mode cannot carry the session-level statements a migration issues.

## Configuration

Every variable is listed and described in **`.env.example`**, which is the authoritative
list. Nothing below repeats a value — only where each one has to be set.

`.env` is gitignored and must never be committed. Neither must any of these values appear
in a workflow file, a Dockerfile, or this README.

### Local — `.env` at the repository root

Everything, including the Google OAuth client id and secret and the MinIO credentials.
Keep it **local-first**: the compose Postgres and MinIO values uncommented, and the Neon
and GCS values commented out beside them. Two uncommented `DATABASE_URL=` lines make the
winner depend on parse order, which is how a local run silently ends up against the
production database. The API logs the host and database name it resolved on boot for
exactly this reason.

### Production secrets — Google Secret Manager

Read by the Cloud Run service at start-up. They never pass through a workflow file, a CI
runner or a log. Created (empty) by `scripts/gcloud-bootstrap.sh`, which then prompts for
each value with the input hidden.

| Secret                               | Holds                                             |
| ------------------------------------ | ------------------------------------------------- |
| `dataroom-database-url`              | Pooled Neon connection string                     |
| `dataroom-direct-url`                | Direct Neon connection string, for migrations     |
| `dataroom-google-client-secret`      | Google OAuth client secret                        |
| `dataroom-session-secret`            | Signing key for the session JWT, 32 bytes minimum |
| `dataroom-storage-access-key-id`     | GCS HMAC key id                                   |
| `dataroom-storage-secret-access-key` | GCS HMAC secret                                   |

### Production configuration — GitHub Actions repository variables

Not secrets: identifiers and public origins. Set them with
`gh variable set <NAME> --body '<value>'`. `deploy.yml` fails by name if one is missing.

| Variable                                               | Holds                                                |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `GCP_PROJECT_ID`                                       | Google Cloud project id                              |
| `GCP_WIF_PROVIDER`                                     | Full resource name of the Workload Identity provider |
| `GCP_SERVICE_ACCOUNT`                                  | Email of the deploying service account               |
| `APP_URL`                                              | Public SPA origin, e.g. `https://<app>.vercel.app`   |
| `GOOGLE_CLIENT_ID`                                     | Google OAuth client id                               |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET` | GCS S3-compatible endpoint and bucket                |

`GOOGLE_CALLBACK_URL` is deliberately **not** configurable: `deploy.yml` derives it as
`${APP_URL}/api/auth/google/callback`. It has to match the redirect URI registered on the
OAuth client exactly, and deriving it removes one of the places it can disagree.

There are **no GitHub secrets**. Deployment authenticates through Workload Identity
Federation, so no service-account key exists anywhere — see `docs/decisions.md` #22.

## Deployment

The SPA is on Vercel and the API on Cloud Run, with Vercel rewriting `/api/*` to Cloud Run
so the browser sees one origin.

One-time, run by the project owner in Cloud Shell — never on a development machine, which
is where no cloud credential belongs:

```bash
PROJECT_ID=<your-project> bash scripts/gcloud-bootstrap.sh
```

It enables the APIs, creates the Artifact Registry repository, the secrets, the runtime
and deploying service accounts, and the Workload Identity pool and provider. It is
idempotent, so re-running after a partial failure is safe. It prints the three
`GCP_*` repository variables to set afterwards.

Deploying the API, from the Actions tab or the CLI:

```bash
gh workflow run deploy.yml
gh run watch
```

`deploy.yml` triggers on `workflow_dispatch` **only**. There is no deploy on push: this
repository is public, and a push trigger would widen the set of events that can reach the
identity pool for no gain. The image is tagged with the commit SHA, never `latest`, so a
Cloud Run revision names the exact commit it runs and a rollback is a redeploy of a known
tag.

The SPA deploys itself when Vercel receives a push, using the `buildCommand` in
`vercel.json`.

### Building the API image locally

The image is validated on a developer machine before it ever reaches CI. The build context
is the repository root, because the workspace lockfile has to be in it:

```bash
docker build -f apps/api/Dockerfile -t dataroom-api:local .
```

## Known limitations

Deliberate, and named here rather than discovered. This is a take-home MVP; each of these is
a state the system tolerates and reports honestly, not a defect waiting to be found.

**Unreferenced bytes accumulate, and nothing collects them.** A transfer abandoned before
the completion call leaves a `PENDING` blob; deleting a file leaves a `READY` one, because
soft delete never touches storage. One scheduled sweeper would collect both — `PENDING`
older than an hour, and `READY` whose nodes are all soft-deleted. The visible consequence is
that the quota, which counts node aggregates, can read lower than what the bucket holds.

**A presigned upload URL is not single-use.** Verified against the real bucket: a second
`PUT` to the same URL returns `200` and replaces the object. For the lifetime of that URL
(15 minutes from the moment it is issued) the uploader can therefore change the bytes behind
a file that has already been recorded, while `size` and the folder aggregates keep the
values read when the upload completed.

The holder of that URL is the person who requested it — the room's owner, uploading their
own file. So this grants nobody any access they did not already have; what it allows is
recording one size and storing another, which makes the 200 MB quota evadable by someone
willing to do it on purpose. Closing it properly means making the key stop accepting writes
once the upload is recorded, which is a design change rather than a smaller number. Left as
is, on purpose.

## Repository layout

```
apps/api/           NestJS API — modules + repository layer
apps/web/           Vite + React SPA
packages/contracts/ Zod schemas shared by both: validation, types and form resolvers
scripts/            One-time cloud bootstrap
docs/               Decisions, data model, architecture, roadmap
```

`CONTEXT.md` defines the domain vocabulary used in code, tests and UI. `docs/decisions.md`
carries the accepted decisions and their rationale; `docs/architecture.md` describes the
layers and the constraints that are load-bearing rather than stylistic.
