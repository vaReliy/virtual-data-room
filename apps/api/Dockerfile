# syntax=docker/dockerfile:1
#
# Production image for the API (decision #10: Cloud Run behind the Vercel rewrite).
#
# Built from the repository ROOT, not from this directory — the workspace lockfile and
# every package manifest have to be in the context:
#
#   docker build -f apps/api/Dockerfile -t dataroom-api .
#
# This image is not the one `docker-compose.yml` runs. Compose runs a stock Node image in
# watch mode over a bind mount; conflating the two would mean debugging a production
# image every time a file is saved.

# Debian slim, matching the compose Postgres reasoning: glibc, not musl. Prisma ships
# separate engine binaries for the two, and a musl base is one more axis on which local
# and production can differ for no benefit.
ARG NODE_IMAGE=node:22.22.1-bookworm-slim

# ======================================================================================
# Stage 1 — build
# ======================================================================================
FROM ${NODE_IMAGE} AS build
WORKDIR /repo

# Prisma probes for `openssl` to pick an engine build. The slim image ships libssl3 but
# not the binary, so the probe fails and Prisma silently falls back to its openssl-1.1.x
# engine — the wrong one for bookworm. That surfaces as a confusing engine error at the
# first migration rather than as a missing package.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

ENV CI=true
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# `packageManager` in the root package.json pins the pnpm version, and corepack honours
# it. That is why the manifest is copied before anything else runs.
COPY package.json ./
RUN corepack enable && corepack install

# Manifests first, sources second: the dependency layer is then only invalidated by a
# dependency change, not by every edit to a source file.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/contracts/package.json ./packages/contracts/

# --ignore-scripts because @dr/api's postinstall is `prisma generate`, and the schema has
# not been copied yet. It is run explicitly below, once the schema is present.
#
# --frozen-lockfile is what makes this build reproducible, and it also fails while any
# dependency's install scripts are unapproved — see `allowBuilds` in pnpm-workspace.yaml.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api

# `prisma.config.ts` resolves env('DIRECT_URL') the moment the config file is LOADED, so
# every prisma invocation needs the variable set — including `generate`, which reads the
# schema and never opens a connection. There is no database at build time and there must
# not be one, so this is a placeholder that is never dialled. It exists only in this
# stage; the runtime stage gets the real value from Secret Manager.
ENV DIRECT_URL=postgresql://build:build@127.0.0.1:5432/build

# The client is generated into apps/api/src/generated, which is a SOURCE directory: tsc
# then compiles it into dist alongside everything else. Generating after the build would
# produce a dist without a client.
RUN pnpm --filter @dr/api exec prisma generate

# Topological: @dr/contracts emits dist + declarations that @dr/api compiles against.
RUN pnpm --filter @dr/contracts build \
 && pnpm --filter @dr/api build

# Collects @dr/api and its production dependencies into one self-contained directory
# with a real node_modules — no symlinks out to a store, so it can simply be copied into
# a stage that has no pnpm at all. --prod drops devDependencies; `prisma` is deliberately
# a runtime dependency because the entrypoint below runs it.
#
# --legacy is required, not vestigial. Since pnpm 10 the default implementation refuses
# to deploy a workspace unless `injectWorkspacePackages=true`, which would make every
# workspace dependency a physical copy instead of a link — a change to how the whole
# monorepo resolves, dev included, to satisfy one build step. pnpm's own warning here is
# misleading: it reports that the legacy path was "forced" while erroring without it.
RUN pnpm --filter @dr/api deploy --prod --legacy /out

# ======================================================================================
# Stage 2 — runtime
# ======================================================================================
FROM ${NODE_IMAGE} AS runtime

# tini becomes PID 1. Without it Node is PID 1, and the kernel does not deliver a signal
# to PID 1 unless that process installed a handler — so Cloud Run's SIGTERM is ignored
# and every revision takes the full 10s grace period before SIGKILL.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini openssl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# `node` is a non-root user the base image already provides.
COPY --from=build --chown=node:node /out ./
COPY --chown=node:node apps/api/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

ENV NODE_ENV=production

# Documentation only. Cloud Run INJECTS PORT and ignores anything configured, which is
# why envSchema validates PORT with a default instead of hard-coding 3000 anywhere.
ENV PORT=8080
EXPOSE 8080

USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./docker-entrypoint.sh"]
