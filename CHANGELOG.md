# Changelog

Notable changes to the Virtual Data Room, newest first. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Entries record what changed **and** what is easy to get wrong about it. Design rationale
lives in `docs/decisions.md`; this file is for what a reader of the diff would not
otherwise see.

## [Unreleased]

### Added — Phase 1, backend skeleton

- **Workspace.** pnpm workspaces with `apps/api` and `packages/contracts`. Every
  dependency is pinned exactly and nothing younger than seven days is installed.
- **Lint boundaries.** Shared ESLint flat config carrying the two rules decision #9
  depends on: the Prisma client is importable only from `*.repository.ts` and the
  persistence layer, and raw SQL only from `node.repository.ts`.
- **`@dr/contracts`.** Zod schemas shared by both apps, including the opaque keyset
  cursor codec. Sizes cross the wire as `number`, never `BigInt`.
- **Database.** Prisma schema per `docs/data-model.md`, first migration, and a soft-delete
  read filter applied as a Prisma client extension.
- **API.** `GET /api/health`, Google OAuth sign-in, an httpOnly session cookie, `GET
/api/me`, and a Data Room provisioned automatically on first sign-in.
- **Local stack.** `docker-compose.yml` running `postgres:17` and MinIO.

### Added — Phase 1, web skeleton

- **`apps/web`.** Vite + React + TypeScript SPA with Tailwind v4 and shadcn/ui
  (`radix-nova`, self-hosted Geist). The dev server proxies `/api` so the browser sees a
  single origin locally exactly as it will through the Vercel rewrite.
- **Screens.** Login, the authenticated shell, and the empty Data Room — each with its
  loading, empty and error states. Room aggregates are read from `GET /api/me`.
- **Session.** TanStack Query owns the session; a 401 routes to the login screen rather
  than rendering an error, and is never retried.
- **Lint.** `apps/web` is no longer excluded from ESLint; `eslint-plugin-react-hooks`
  covers the rules TypeScript cannot see.
- **Local stack.** The compose `web` service is enabled (its `profiles` gate is gone).
- **Boot skeleton.** `index.html` paints an inline app-shell skeleton before the bundle
  arrives, cutting first-contentful-paint from 2304 ms to 1268 ms on a throttled Slow 4G
  connection against the production build.

### Added — Phase 1, ship (deployed)

- **`scripts/gcloud-bootstrap.sh`.** One-time, idempotent Google Cloud setup, run by the
  owner in Cloud Shell: APIs, an Artifact Registry repository, six Secret Manager secrets,
  a runtime and a deploying service account, and a Workload Identity pool and provider.
- **`apps/api/Dockerfile` and `docker-entrypoint.sh`.** Multi-stage build ending in
  `pnpm deploy --prod`, with an entrypoint that applies migrations with bounded
  exponential backoff before `exec`-ing the server. Validated locally against the compose
  database before any push.
- **`.github/workflows/ci.yml`.** Typecheck, lint and test on pull requests and pushes to
  `main` (decision #18).
- **`.github/workflows/deploy.yml`.** Builds, pushes and deploys to Cloud Run,
  authenticating through Workload Identity Federation. `workflow_dispatch` only, with
  `id-token: write` granted in the deploy job alone (decision #22).
- **`vercel.json`.** The `/api/*` rewrite to Cloud Run and the SPA fallback (decision #10).
- **`README.md`.** Setup, local development and where each credential belongs. The project
  overview, ERD and hosted links are Phase 6's.

**Deployed and reachable.** Signing in with Google on the Vercel URL lands on an empty
Data Room served from Neon.

- SPA — https://virtual-data-room-gamma.vercel.app
- API — https://dataroom-api-naortdwt2q-ey.a.run.app

### Added — Phase 1, consent screen prerequisites

- **`/privacy` and `/terms`.** Two public routes and a `features/legal` layout, registered
  on the Google Auth Platform Branding page as the app's privacy policy and terms of
  service links. They sit outside `SessionGate`: Google requires them to resolve for a
  signed-out visitor, and a redirect to `/login` would not qualify.
- **Legal links on the login screen.** `/` is behind `SessionGate`, so an anonymous
  visitor — the Google reviewer included — lands on `/login`. That screen is therefore the
  app's home page as far as the OAuth configuration is concerned, and Google requires the
  home page to link to the privacy policy.

Why this was needed: the `Publish app` button on **Audience** stays disabled while the
**Branding** page's *App domain* section is empty. Those three links are documented as
required for every External app in production, and the console names none of them — the
banner only says the configuration is incomplete. The earlier suspicion that `vercel.app`
was the blocker is wrong: `vercel.app` is on the Public Suffix List, so
`virtual-data-room-gamma.vercel.app` *is* a top private domain and the console accepts it
as an Authorized domain.

Carry this forward by hand: **do not upload an app logo and do not start brand
verification.** The app uses only non-sensitive scopes (`openid`, `userinfo.email`,
`userinfo.profile`), so verification is not required — but a logo on an External
production app triggers it, and verification demands a Search Console *Domain property*
(DNS-level) proof, which is impossible for a `vercel.app` subdomain. That path ends in a
state no amount of console work can leave.

The privacy policy describes exactly what `User`, `Account` and `Node` persist, and states
that no Google access or refresh tokens are stored. That is a property of the auth module,
not a marketing line — if it changes, the page changes with it.

### Notes that the diff does not make obvious — ship

- **`prisma` is a runtime dependency now, not a dev one.** The entrypoint runs
  `prisma migrate deploy`, and `pnpm deploy --prod` strips devDependencies — so leaving it
  in `devDependencies` produces an image that builds cleanly and then fails to start.
- **The Docker build stage and `ci.yml` both set a fake `DIRECT_URL`.**
  `prisma.config.ts` resolves it when the config file is _loaded_, so even
  `prisma generate` — which never opens a connection — fails without it. Since that
  command is @dr/api's postinstall, the failure lands inside `pnpm install` before any
  check runs. Every context that runs the Prisma CLI without a database needs this;
  locally it is invisible because `.env` supplies the real value.
- **`openssl` is installed in both stages.** The slim Node image ships libssl3 but not the
  binary Prisma probes for, so Prisma silently selects its openssl-1.1.x engine. The
  failure surfaces at the first migration as an engine error, not as a missing package.
- **`pnpm deploy` needs `--legacy`.** Since pnpm 10 the default implementation refuses a
  workspace that is not `injectWorkspacePackages=true`; opting into that would change how
  every workspace dependency resolves, dev included, to satisfy one build step.
- **`tini` is PID 1 on purpose.** The kernel delivers no signal to PID 1 unless the
  process installed a handler, and Node installs none for SIGTERM — without tini every
  Cloud Run revision would wait out the full 10s grace period before SIGKILL.
- **The image tag is the commit SHA, never `latest`.** A Cloud Run revision then names the
  exact commit it runs, and a rollback is a redeploy of a known tag.
- **There are no GitHub secrets.** `deploy.yml` reads repository _variables_ only; every
  secret is a Secret Manager reference resolved by Cloud Run at start-up, so no secret
  value passes through the workflow, the runner or a log.
- **`GOOGLE_CALLBACK_URL` is derived, not configured.** The workflow builds it from
  `APP_URL`. It must match the OAuth client's redirect URI exactly, and three places that
  can disagree is worse than two.
- **The Workload Identity condition pins NUMERIC ids.** `repository_id` and
  `repository_owner_id`, plus `ref == 'refs/heads/main'`. A repository _name_ is released
  when the repository is deleted and can be claimed by someone else; this repository is
  public.
- **`vercel.json` hard-codes the Cloud Run hostname.** It could not be written before the
  first deploy — the URL does not exist until then, which is the dependency cycle the
  roadmap's Ship order exists to walk. Recreating the Cloud Run service from scratch
  changes the hostname and this file has to follow; ordinary redeploys keep it.
- **Vercel installs only the web half of the workspace**
  (`--filter @dr/web...`). A plain install runs @dr/api's `prisma generate` postinstall,
  which fails there for want of `DIRECT_URL`, and installs NestJS and Prisma engines that
  the SPA build never imports — 865 packages instead of 531. The trailing `...` is
  load-bearing: without it `@dr/contracts` is excluded and the build's first command
  compiles it.
- **The Vercel origin carries a `-gamma` suffix.** `virtual-data-room.vercel.app` was
  taken. The suffix is part of `APP_URL`, the OAuth authorized origin and the redirect
  URI, and Google compares redirect URIs as exact strings.

### Notes that the diff does not make obvious

- **The five raw SQL statements live in the migration, not in `schema.prisma`.** Prisma
  cannot express them: the partial unique index on `lower(name)`, the
  `text_pattern_ops` subtree index, two CHECK constraints, and the listing expression
  index. Changing the schema without carrying them forward silently drops
  case-insensitive name uniqueness and the keyset pagination index.
- **Raw SQL bypasses the soft-delete extension.** The extension rewrites Prisma query
  arguments, which a raw statement never passes through, so every raw statement must
  filter `deleted_at IS NULL` itself.
- **Postgres is the Debian image, not Alpine.** musl and glibc sort differently, and
  listings are ordered and paginated on `lower(name)`; an Alpine image would make local
  behaviour diverge from Neon at page boundaries.
- **`PrismaService` is not exported from `PersistenceModule`.** Repositories are
  registered there and exported individually, so what may reach the database is an
  explicit list rather than a convention.
- **The web dev server needs `optimizeDeps.include: ['@dr/contracts']`.** That package
  emits CommonJS and a linked workspace dependency is not pre-bundled, so without this
  the dev server serves it as raw ESM and every named import from it fails. `vite build`
  is unaffected — a green build is not evidence the dev server starts.
- **`shadcn` is a runtime dependency on purpose.** `src/index.css` imports
  `shadcn/tailwind.css`, so moving it to `devDependencies` breaks the production build,
  where dev dependencies are stripped, while the local build keeps working.
- **502/503/504 are not part of the error contract.** They come from the proxy in front
  of the API — Vite locally, the Vercel rewrite in production — and are rendered as
  "cannot reach the server" rather than as the literal gateway status.
- **The compose `web` service proxies to `http://api:3000`, not to localhost.** Inside a
  container localhost is that container. `API_PROXY_TARGET` carries this; a bare-metal
  `pnpm dev` falls back to `localhost:3000`.
- **The boot skeleton in `index.html` duplicates `AppShellSkeleton`'s geometry on
  purpose.** It must paint from the HTML response alone, so it is styled inline and never
  with a Tailwind class — a class would arrive with the stylesheet it exists to precede.
  Change the shell's header height or content width in both files, or it visibly jumps
  when React mounts.
- **Measure front-end performance against `vite preview`, never the dev server.** The dev
  server serves unbundled modules — 100+ requests in a waterfall — so a throttled
  measurement there reflects Vite, not the product.

### Toolchain constraints worth knowing before changing them

- **TypeScript is pinned to 6.0.3.** `typescript-eslint@8` requires `typescript <6.1.0`,
  so TypeScript 7 cannot be used while lint is a required gate.
- **pnpm ignores `.npmrc` for the supply-chain settings.** `saveExact` and
  `minimumReleaseAge` are read from `pnpm-workspace.yaml`; the `.npmrc` keys are kept for
  other tooling only. Setting them solely in `.npmrc` leaves the rules silently inert.
- **Dependency install scripts need `allowBuilds`.** While any are unapproved,
  `pnpm install --frozen-lockfile` exits 1, which fails CI and the Docker build rather
  than merely warning locally.
- **Prisma 7 has no `datasource` block.** The pooled connection goes to the driver
  adapter at runtime and the direct one to `prisma.config.ts` for migrations. The
  generator needs `importFileExtension = ""`, or emitted imports keep a literal `.ts`
  suffix that resolves to nothing at runtime.
- **`.env` is local-first.** It holds the compose Postgres and MinIO values, with Neon and
  GCS commented out beside them. Two uncommented `DATABASE_URL=` lines make the winner
  depend on parse order. `PrismaService` logs the resolved host on boot for this reason.
