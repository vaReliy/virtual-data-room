# CLAUDE.md

Virtual Data Room — take-home project. A secure repository for storing and sharing documents during
due diligence.

**Status: design closed. Phases 0–4 shipped; Phase 5 (Production data and demo) and Phase 6 (README
and sweep) are groomed and next.** The API serves the folder browser, files and sharing end to end —
`AccessScope`, the node repository with its raw-SQL tree statements, the node endpoints, the
three-step upload protocol, move, the content URL with its `?disposition=`, link and per-user
shares, and the public `/s/:token` surface — and the web app exercises all of it, including the
share dialog and "Shared with me". Phase 4.1 (sort, Activity) is groomed but deliberately left in
the backlog; see `docs/roadmap.md`'s "Backlog — groomed, not started" section.

Phase 5 and Phase 6 are both small enough that their scope lives entirely in `docs/roadmap.md` — no
`notes/issues/phase-5/` or `phase-6/` exists, and neither needs to unless a session there turns out
larger than expected. A phase that does grow a `notes/issues/<slug>/` directory follows the same
convention as `phase-1`–`phase-4`: a `PRD.md`, numbered issues, and a `HANDOVER.md` written at the
session boundary — see "Issue tracker" below.

## Read before working

Load only what the task needs — these are not all required at once.

| File                   | When to read it                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONTEXT.md`           | Always. Domain vocabulary used in code, tests and UI.                                                                                                               |
| `BRIEF.md`             | The brief. **Read-only — never edit.**                                                                                                                              |
| `docs/decisions.md`    | Before changing anything architectural. Every accepted decision, with its rationale. Nothing is left undecided.                                                     |
| `docs/data-model.md`   | Schema work, migrations, queries, indexes, invariants.                                                                                                              |
| `docs/architecture.md` | Layers, access control, upload flow, error contract, folder layout.                                                                                                 |
| `docs/roadmap.md`      | Always, before picking up work. Task-level plan, per-phase scope, descope order.                                                                                    |
| `docs/manual-e2e.md`   | Before walking the app by hand or driving it through the browser MCP. Behaviour-level cases, no selectors — update it when behaviour changes, not when markup does. |

## Rules

- **All code, comments, documentation and commit messages in English.** Chat with the user is in
  Ukrainian with English technical terms.
- **Never run writable git commands** (`commit`, `push`, `rebase`, `reset --hard`). Stage nothing;
  the user commits.
- `BRIEF.md` is read-only.
- **Never install or authenticate a cloud CLI locally** (`gcloud`, `vercel`). Cloud changes are made
  by the user in the web console or Cloud Shell, or by the deploy workflow. Write the commands; do
  not hold the credentials (decision #22).
- Secrets only in `.env`, never committed. `.env.example` documents every variable.
- Dependencies are pinned exactly (`save-exact=true`) and no release younger than 7 days is
  installed (`minimum-release-age=10080`).

## Stack

- **Monorepo:** pnpm workspaces — `apps/api`, `apps/web`, `packages/contracts`. No NX, no Turborepo
  (decision #12).
- **Backend:** NestJS, Prisma, PostgreSQL (Neon). Modules + repository layer, no domain entities or
  mappers (decision #2).
- **Frontend:** Vite + React + TypeScript, React Router, TanStack Query, Tailwind, shadcn/ui
  (decision #11).
- **Contracts:** Zod schemas shared by both apps — one schema is validation, type and form resolver
  (decision #12).
- **Storage:** GCS via its S3-compatible API (`@aws-sdk/client-s3`); MinIO locally. Presigned
  PUT/GET straight from the browser.
- **Auth:** Google OAuth only, Passport, httpOnly session cookie (decision #8).
- **Deploy:** Vercel (static SPA) rewriting `/api/*` to Cloud Run (Docker), so the browser sees a
  single origin (decision #10). Cloud Run is deployed by a `workflow_dispatch` GitHub Actions
  workflow authenticating through Workload Identity Federation (decision #22). Migrations run from
  the container entrypoint.

## Architectural constraints to respect

These are load-bearing. Violating them silently breaks security or scale properties.

- `PrismaService` is **not** exported from the persistence module. Services never import
  `@prisma/client`; only `*.repository.ts` files do (ESLint-enforced).
- Repository methods take `AccessScope` as their first argument and bound every query by
  `path startsWith scope.rootPath`. `AccessScope` is a branded type produced solely by
  `AccessControlService`.
- `path` is built from UUIDs, never names. It is internal: never accepted from a request, never
  returned to a client.
- `parent_id` is the source of truth; `path` and the folder aggregates are denormalized caches,
  rebuildable with `pnpm db:recompute`.
- Breadcrumbs are clipped to `scope.rootPath`. A node above the caller's scope must be
  indistinguishable from one that does not exist — 404, never 403.
- Raw SQL lives only in `node.repository.ts`, and it **bypasses** the Prisma soft-delete extension:
  raw queries must filter `deleted_at IS NULL` explicitly.

## Definition of done

A `roadmap.md` checkbox is not done until all of these hold. Do not tick it otherwise, and do not
report a phase complete with a failing gate — say which gate fails.

- `pnpm typecheck && pnpm lint && pnpm test` pass. Not "should pass" — run them.
- Any UI work ships with its **loading, empty and error states**. They are part of the feature, not
  a later pass.
- Anything touching the schema was written from `docs/data-model.md`, not from memory.
- Error responses use the status codes in `architecture.md` § Error contract. `404` and `410` are
  different states with different screens; neither is a generic failure.
- New files land in the layout already described in `architecture.md`. A new top-level directory is
  a design change, not an implementation detail.
- **`CHANGELOG.md` has an entry.** Write it when a phase finishes, or when a task large enough to
  carry its own issue finishes — not in a sweep at the end. Record what changed _and_ what the diff
  does not make obvious: a constraint that will bite whoever edits it next, a version pinned for a
  reason, a statement that must be carried forward by hand. `notes/` is gitignored, so
  `deviations.md` never reaches the repository — anything that must outlive the session belongs
  here.

## Working rules

Four rules that close mistakes actually made during design. Each one exists because its absence
caused rework.

- **A decision does not exist until it has a task.** Anything written into `decisions.md` must have
  a corresponding checkbox in `roadmap.md`. A decision recorded in one document and unscheduled in
  the other is an untracked commitment — it looks planned and is not.
- **During implementation phases, do not edit `docs/`.** The exception is where a task explicitly
  says to (Phase 2 writes the scope-exception inventory into `architecture.md`). Documentation drift
  is how a phase ends without producing anything runnable.
- **Verify, do not predict — and that includes this repository's own code.** For anything outside it
  — cloud console UIs, provider behaviour, library APIs — check it or ask. Never write instructions,
  or assert how an external system behaves, from memory. A console UI that "has no page for this"
  usually has one now. The same rule applies _inside_: never state how a query, a guard, a
  transaction or a repository method behaves without opening the file in the same session and citing
  `file:line`. Reasoning from `docs/` instead of the source has already produced a finding whose
  severity was backwards — `findInScope` returns rows the design docs read as unreachable.
- **A review is a report, not a dialogue.** "Verify these proposals" means a bounded findings list —
  each claim checked against the code, each with `file:line`, classified fits / additive / breaking
  / deferrable, closing with go or no-go. That is the shape `notes/forward-compat-pass.md`
  prescribes and it is timeboxed to 15–20 minutes. The design is closed, so a multi-round
  question-and-answer review can only yield a clause appended to an existing checkbox, or a
  re-litigation of `decisions.md`. Neither is worth a round.
- **Say when the scope changes.** If a task is running past roughly twice its expected size, stop
  and report instead of continuing. Report the overrun before starting the work, not after being
  asked about it. State the expected output and cost in one line _before_ starting anything
  review-shaped, then hold yourself to it.

## Stop and ask

Do not resolve these yourself. They are decisions that were made deliberately, and a
plausible-looking local fix silently breaks a property the design depends on.

- A schema change that `data-model.md` does not describe — including "just one column".
- A repository method that cannot take `AccessScope`, or a query that needs to escape the scope
  boundary. The legitimate exceptions are enumerated in `architecture.md`; anything outside that
  list is a security decision.
- Raw SQL anywhere except `node.repository.ts`.
- A new runtime dependency. Supply-chain rules apply (`save-exact`, 7-day minimum age), and most
  additions are avoidable.
- Contradicting an accepted decision in `decisions.md`. If it is wrong, say so and stop — do not
  implement around it.
- Reaching for anything on the **stretch list** while floor work remains unfinished.
- Scope beyond the current phase. The phases are ordered so that each one is demoable; work pulled
  forward tends to arrive half-built.

## Agent skills

These three sections are the whole convention. There is no `docs/agents/` directory — earlier drafts
pointed at one, and nothing was ever written there.

### Issue tracker

Tasks are local markdown under gitignored `notes/issues/`, never GitHub or GitLab: this repository
has no remote configured, so an agent must not reach for `gh` or open a PR.

- One phase or feature per directory: `notes/issues/<slug>/`, e.g. `phase-3/`, `phase-4.1/`.
- The brief for the whole set is `notes/issues/<slug>/PRD.md`.
- Individual issues are `notes/issues/<slug>/issues/<NN>-<slug>.md`, numbered from `01` — unless the
  set inherits issues from another one, in which case the numbering continues around them and the
  PRD says so. Phase 4 is that case: `03`–`05` were groomed for Phase 4.1 and pulled forward, so its
  sharing issues start at `06`. Numbers are never reused within a directory and never renumbered
  once a commit references them; a bare number is meaningful only inside one directory, so a
  cross-directory reference is always a full path.
- `notes/issues/<slug>/deviations.md` carries what a session learned that the next one cannot
  re-derive — a real bucket's behaviour, a library that did not do what its docs said. `notes/` is
  gitignored, so anything that must outlive the work belongs in `CHANGELOG.md` instead.
- **An issue brief must be self-contained.** Inline the invariant it depends on; do not cite the
  document that states it. A brief that says "see `data-model.md`" is a brief that gets implemented
  without the constraint, and the failure is silent.

### Triage labels

A `Status:` line directly under each issue's title, from this vocabulary:

`needs-triage` · `needs-info` · `ready-for-agent` · `ready-for-human` · `wontfix`

`ready-for-agent` means an agent may pick it up unattended. Deliberately deferred work is
`ready-for-human` — not `wontfix`, which means never, and not `ready-for-agent`, which would let a
sweep grab something that was parked on purpose.

### Domain docs

Single context, no per-file ADRs: `CONTEXT.md` at the root is the glossary, and `docs/decisions.md`
is the running decision log. A term goes into `CONTEXT.md` the moment it is settled — before three
files invent three names for the same thing.
