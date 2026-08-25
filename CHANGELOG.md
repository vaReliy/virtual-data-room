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
