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
