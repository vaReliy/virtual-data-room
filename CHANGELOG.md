# Changelog

Notable changes to the Virtual Data Room, newest first. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Entries record what changed **and** what is easy to get wrong about it. Design rationale
lives in `docs/decisions.md`; this file is for what a reader of the diff would not
otherwise see.

## [Unreleased]

### Fixed — A share rooted at a FILE no longer renders as an empty folder (Phase 4, issue 14)

- **A `LINK` share (or a `USER` grant) targeting a single file has answered `node: null,
  children: []` at its root since issue 07 shipped** — byte-identical to an empty folder or
  an empty room, so a visitor opening a file share saw "Nothing here yet" for a file that had
  content. `NodeService.browse` hardcoded `node = null` whenever the caller browsed their own
  scope root, on the assumption — true through Phase 3, false the moment issue 07 let a
  `LINK` target a file directly — that a scope root is never itself a `FILE`. `browse()` now
  returns the file's own summary as `node` when the root is a `FILE`; a folder or whole-room
  root is unaffected. `docs/decisions.md` decision #24 is amended to state the exception.
- Found and root-caused during issue 13's manual verification, not by a test — the existing
  suite had no scope rooted at a `FILE` to exercise this branch. One now does
  (`share.integration.test.ts`).

### Fixed — A deleted grant no longer shadows a live one (Phase 4 review)

- **A grantee holding grants on two sibling folders lost the survivor when the owner
  deleted the other one.** `resolveForUser` picks one scope per room before it knows what
  the caller is about to read, and the loser was reachable nowhere: the room root answered
  `410` from the dead scope root, the live folder answered `404` because it lay outside it,
  and "Shared with me" went on listing that folder — so the application rendered a link to
  its own `404`. Liveness is now the first key in `compareBreadth`.

#### Notes that the diff does not make obvious

- **`path` length orders ancestors against descendants and nothing else.** A `path` is a
  sequence of fixed-width UUID segments, so two folders at the same depth compare *equal*
  however differently they are named, and the order fell through to `created_at` — making
  the older grant win. The length comparison reads like a breadth measure and is one only
  along a single branch. Decision #29 now says so; before this it did not, and the rule was
  written as though length separated any two grants.
- **Liveness is a sort key, not a filter, and the difference is a status code.** Filtering
  dead grants out is the shorter fix and it is wrong: a grantee whose *only* grant was
  deleted would get `404` ("you were never given this") instead of `410` ("the owner deleted
  this"). That `410` is the entire reason `NodeRepository.findGrantNodeInRoom` bypasses the
  soft-delete extension. Sorting dead grants last keeps both answers. There is a regression
  test pinning the all-deleted case for exactly this reason — it passes with or without the
  fix, and is there to fail on the tempting simplification.
- **`SharedWithMeEntry` gained `id`** (the share's own id) purely as a stable list key.
  There is no unique constraint on `(data_room_id, node_id, grantee_email)`, so an owner can
  grant the same node to the same address twice and `dataRoomId` + `nodeId` does not
  identify a row — the web list was keying on that pair and produced duplicate React keys.
  If a uniqueness constraint is ever added, this field stays useful and the constraint is
  the behaviour change, not this.
- **Changing `packages/contracts` requires `pnpm --filter @dr/contracts build` before
  `pnpm typecheck`.** `apps/api` and `apps/web` resolve the package through its `dist`,
  while Vitest resolves the sources — so a new field is visible to the tests and invisible
  to `tsc` until the package is rebuilt. Green tests prove nothing about types here.

### Added — The demo Data Room and the first-login grant (Phase 4, issue 10, re-groomed)

- **`pnpm db:seed`** (from `apps/api`) creates Acme Corp.'s Data Room: eleven folders four
  levels deep and eight documents cut from three committed multi-page PDFs.
- **Every sign-in is granted one folder of it**, so a reviewer with a single Google account
  arrives with something in "Shared with me" — the permissioned share `BRIEF.md` asks for,
  demonstrable without a second account.
- **`pnpm demo:revoke`** takes that grant back from everyone holding it.

The whole feature is `apps/api/src/modules/demo/`, plus one import and one call in
`AuthModule`/`AuthService`. `docs/decisions.md` #32 carries the reasoning and the removal
list.

What the diff does not show:

- **The seed RESETS, it does not top up.** Every run hard-deletes every Data Room the demo
  owner holds — nodes, shares, blob rows, stored objects — and rebuilds. That is the only
  hard delete of a Data Room in the system; everything a user does is a soft delete. It is
  bounded by `ownerId` in the `where`, and **that predicate is the safety rail** — with a
  room id alone, a wrong argument erases a real customer's room.
- **The counters are the risk, and they fail silently.** `total_size`, `file_count` and
  `folder_count` are caches maintained per mutation, never computed on read. A seed that
  inserted rows directly would leave them at zero, every test would still pass, and the wrong
  numbers would show in the room header and the delete warning. This one goes through
  `createFolder`/`createFile` and then re-derives the totals from the tree it built, failing
  the run on a mismatch. **Do not replace that walk with hardcoded numbers** — they go stale
  the first time `demoTree()` changes, and nothing notices.
- **Two ids are pinned** (`DEMO_ROOM_ID`, `DEMO_SHARE_FOLDER_ID`), which is why
  `DataRoomRepository.create` and `NodeRepository.createFolder` now take an optional `id`.
  **No request path may pass one**: a caller-chosen node id is a caller-chosen `path`, and
  `path` is what every scope boundary is computed from. The pin exists so the grant can
  address the folder by id — by name, renaming it silently stopped the grant from finding
  anything.
- **Turning the demo off is two steps, in order.** Set `AUTO_GRANT_ENABLED = false` in
  `demo.constants.ts`, deploy, *then* run `pnpm demo:revoke`. A `Share` is a capability that
  was issued, not a rule re-evaluated per request, so the flag alone revokes nothing — and
  revoking first re-grants anyone who signs in during the gap. The command warns when it sees
  the flag still on. An earlier `DEMO_AUTO_SHARE` environment variable was removed for giving
  "off" two meanings with different results.
- **The demo is not configurable and must not become so.** No `DEMO_*` environment variables:
  two environments disagreeing about the demo room's name was a way for the seed and the
  grant to stop finding each other with no error.
- **The demo owner cannot be signed in as** — synthetic `provider_account_id`, address on the
  RFC 2606 `.example` TLD. Deliberate, and it means demo grants have no UI at all: they can
  only be listed or revoked by script.
- **`nest-cli.json` exists solely to copy `modules/demo/fixtures/*.pdf` into `dist`** so the
  seed runs from the production image. Nothing else needed it before.
- **`demo:revoke` spares `LINK` shares** on the demo folder — a public demo link is a
  deliberate artefact, and killing it as a side effect would surprise. A mechanism for demo
  `LINK` shares is not designed yet.

### Added — Cascade revoke with confirmation (Phase 4, issue 09)

- **Revoking a `USER` grant on a folder or the whole room now offers to take everything
  nested beneath it with it**, when the same grantee holds other live grants there — a
  confirmation names the count and offers "Revoke all N" or "Revoke only this one", neither
  styled as the default. See `docs/decisions.md` #31 for why this is a prompt rather than a
  rule in either direction.
- **`DELETE /api/rooms/:roomId/shares/:shareId` gained `?cascade=`** (`cascadeQuerySchema`
  in `@dr/contracts`), default `false`; an unknown value is a `400`, the same as any other
  client-assembled query parameter in this codebase.
- **`ShareSummary` gained `nestedLiveGrantCount`, optional.** Computed only for a `USER`
  grant on a folder or the whole room, by `ShareService.nestedLiveGrantShareIds` — the same
  method the cascade revoke itself calls, so the number a caller sees and what a cascade
  actually touches cannot disagree. A grant whose node the owner has already soft-deleted is
  dropped before counting: `findGrantNodeInRoom` bypasses the soft-delete extension on
  purpose (that is what lets a grantee see `410` rather than `404`), so an unfiltered count
  would offer to revoke a grant already serving nothing.
- **No new raw SQL.** The nested search reuses `ShareRepository.findLiveGrantsForEmail` and
  `NodeRepository.findGrantNodeInRoom`, looping over the grantee's handful of grants in the
  room rather than a path-prefix join — that join would have needed a new statement in
  `node.repository.ts`, mixing a share query into the node repository.
- **`ShareRepository.revokeMany`** revokes several shares as one `UPDATE ... WHERE id IN
  (...)` — atomic by itself, so no `$transaction` was added for it.

### Added — Row-menu icons, and "Shared with me" becomes its own route (Phase 4, issue 08.4)

- **Every row-menu item now has an icon.** Rename got `Pencil`, Move got `FolderInput`, and
  Delete got `Trash2` — the same destructive glyph `ShareList`'s revoke button already used,
  so the two menus in this app do not use different icons for the same kind of action.
- **`/` no longer renders "Shared with me" — it is now an unconditional redirect** to the
  caller's own Data Room, with no dependency on `useSharedWithMe()` at all. This supersedes
  the "lives at `/`" behaviour the 08.1–08.3 entry below describes: that design worked only
  as long as a signed-in user could be in at most one place, and Phase 4 sharing broke that
  once a grantee held both a room and a grant.
- **"Shared with me" moved to its own route, `/shared`,** rendered unconditionally —
  including an empty state ("Nothing has been shared with you yet.") it did not previously
  need, since it used to be reachable only past a non-empty guard in `home.tsx`.
- **`AppShell` gained a permanent nav link to `/shared`,** with a count badge from the same
  `useSharedWithMe()` query `/shared` itself uses — TanStack Query dedupes the key, so
  mounting both is not a second request. The link is never hidden at zero count: hiding it
  would make it appear the moment someone first shares something with the caller, with no
  other notification surface in this phase to soften that (no Activity feed exists yet).
  `AppShellSkeleton` grew a matching placeholder from the same `{ to, label }` list the real
  header renders from, so the two cannot drift out of sync by hand-copied dimensions.
- **Amends decision #23's "no switcher" clause** (`docs/decisions.md`): still one owned
  room, still no create-room/list/rename, but a nav link now reaches a second legitimate
  destination.

### Added — Sharing: the web surface (Phase 4, issues 08.1, 08.2, 08.3)

- **A `LINK` share's URL is unrecoverable by design, and the dialog is built around that.**
  The token is stored hashed and the plaintext exists only in the response to the create
  call, so `ShareDialog` never closes itself on success and shows a result view that says
  the link cannot be shown again — the only way to replace a lost one is to revoke it and
  create another. `ShareList` renders every live share with no control that could reveal an
  existing URL: a link row shows only that it exists, when it was created and its expiry.
- **`ShareDialog` is one component reused from three entry points** — a row's actions
  dropdown, the room-root toolbar (`nodeId: null`, the whole-room share's only entry point),
  and the file preview screen — all owner-only (`canWrite`). `NodeView` now passes
  `canWrite={first.role === 'OWNER'}` down to `FilePreview`, which it did not carry before.
- **Closing the dialog goes through one `close()` function, not Radix's `onOpenChange`
  alone.** Radix only calls that callback for its own UI-driven close gestures (`Escape`,
  backdrop, the corner button) — not when a parent sets the `open` prop programmatically,
  which is what the "Done"/"Cancel" buttons do. Resetting `result` only in `onOpenChange`
  left it stale after a button close, so sharing a different node right after showed the
  previous share's link.
- **`useRevokeShare`'s mutation folds a `410` into success in `mutationFn` itself.** Revoke
  is idempotent at the API (a second `DELETE` returns `204`, not `410` — verified against
  the running service, not assumed from the brief), and the fold means every caller,
  including issue 09's cascade-revoke confirmation later, sees one outcome shape rather than
  special-casing "already gone".
- **"Shared with me" lives at `/`, the app's one resolver route, not a second navigation
  target.** `HomeRoute` now fetches `GET /api/shares/shared-with-me` before deciding: an
  empty result or a failed query redirects to the caller's own room exactly as before this
  feature, and the screen renders only once there is at least one row — the redirect must
  not race the query, or every owner with no shares would see a flash of an empty section.
- **A row names the granted node, never the room — except a whole-room grant, where the
  room *is* the grantee's scope.** This is enforced by the contract, not the component:
  `sharedWithMeEntrySchema` carries no room name for a subtree grant, so there is nothing to
  leak by fetching the room separately. `sharedBy` is shown beside the name because it is
  what tells two similarly-named folders from two different counterparties apart.
- Shared rooms are **not** added to `MeResponse.dataRooms` — that array is owner-bounded at
  the repository and `SessionGate` reads an empty one as a provisioning error, not "nothing
  shared yet".
- `docs/manual-e2e.md` gained `SHR-01`–`SHR-05`, covering both share modes on a folder, a
  file and the whole room; email normalization; a same-day expiry; listing and revoking
  (including a double revoke); and the grantee's "Shared with me" view.

### Added — Sharing: the public link surface (Phase 4, issue 07)

- **`TRUST_PROXY_HOPS` is a new environment variable, and removing it silently breaks a
  security control.** `main.ts` feeds it to Express `trust proxy`, and exactly one thing
  reads the result: the per-IP rate limit on `/api/s/:token`, the only route with no
  session to key on. Behind the Vercel rewrite and Cloud Run, an untrusted chain makes
  `req.ip` the proxy's address for **every** caller, so the limit becomes one shared bucket
  for the whole deployment — it still responds, still counts, and is wrong. Trusting more
  hops than really sit in front of the service is the opposite failure: `X-Forwarded-For`
  becomes spoofable and the limit stops applying. It is a deployment fact, not a default,
  which is why it is an environment variable. **It ships at `0` locally; the deployed value
  was observed at `2`** (2026-08-27) — `ClientIpThrottlerGuard` logs the first anonymous
  request's `req.ip` and raw header once per process for exactly that purpose. A first
  attempt shipped `1`, read off the two addresses in a captured `X-Forwarded-For`; that
  undercounts by one, because Express's numeric `trust proxy` also spends one hop on the raw
  socket address (Cloud Run's own front end, invisible except at `trust proxy=0`) before it
  starts consuming the header — `1` resolved `req.ip` to Vercel's own egress address, not the
  caller's, which surfaced as two different networks sharing one rate-limit bucket. See
  `notes/issues/phase-4/deviations.md` § `TRUST_PROXY_HOPS` for the two logs that show it.
  Nothing else in the codebase reads `req.ip`, so the blast radius of a wrong value is this
  limit alone.
- **One throttler options array now holds every named bucket, and that is forced.**
  `ThrottlerModule` is `@Global()` and `forRoot` provides `THROTTLER_OPTIONS`, so two
  arrays would be two providers racing for one token and the loser would silently take the
  other's limits. `FileModule` and `ShareModule` are handed the *same* array. The price is
  that a `ThrottlerGuard` enforces **every** bucket in the options, so each controller
  carries a `@SkipThrottle` for the one that is not its own — without them a share visitor
  would spend the upload allowance, tracked by a guard that throws when there is no
  session. `common/throttler.config.test.ts` is the experiment kept as a regression guard.
- **The public controller writes no new listing code.** `resolveForToken` produces the
  scope and the existing `NodeService.browse` and `ContentService.urlFor` do the rest, so
  `browseResponseSchema` travels verbatim — `room` omitted, `parentId` nulled at the scope
  root, breadcrumbs clipped server-side. A public twin of the DTO is how the two drift, and
  it would mean implementing Phase 4.1's `?sort=` twice. Read-only is structural, not
  disciplinary: the scope's `role` is `VIEWER` and every mutation starts with
  `assertMayWrite`.
- **`NodeSource` replaces the `roomId` prop threaded through the whole browser** (`lib/
  node-source.ts`). One value now decides the API path, the in-app link and the cache key
  together. The cache key is the part that matters: the same node id can be legitimately
  reachable both ways at once, and the two answers differ in `role`, in whether `room`
  travels and in where the breadcrumbs are clipped — one shared key would hand a signed-out
  visitor an owner's answer. A share is keyed on its token and never on a room id, which
  the visitor does not have and must not be handed. The four write hooks take a source they
  can only be given a room for; the path builders throw rather than send a token to an
  endpoint that would refuse it.
- **`/s/:token` sits outside `SessionGate`**, and must stay there. The gate redirects an
  unauthenticated visitor to `/login`, and signing in grants a link recipient nothing —
  putting these routes behind it would turn every share link into a sign-in prompt.
- **The header wordmark is now a link to `/` in both shells**, and the line it walks is
  worth keeping. What the anonymous surface must never offer is a *remedy* — a "Sign in to
  view this" beside a dead link — because an account grants nothing there: the token is the
  authorization. A wordmark is not a remedy; it is "go to the application", and without it
  a reader who does have an account was stranded with no way into their own room. No
  session branch was written for it and none is wanted: `/` resolves to the caller's room,
  and `SessionGate` sends a signed-out caller to `/login` exactly as it does for any other
  address. The dead-link placard itself stays actionless.
- **Two different `410`s on one surface, told apart by position rather than by the body.**
  At a share's root the token itself is dead; deeper in, a node was deleted. A `410`
  carries a message and nothing else, and adding a field naming which case it was would be
  a contract change to serve one sentence — so revoking a link under a visitor standing
  deep inside it shows the deleted-node screen first and the truth one click later. The
  dead-link screen deliberately offers **no** action of its own.
- **Four situations answer `410` on `/s/:token` with one body**: unknown token, revoked,
  expired, and a live token whose shared node the owner deleted. Do not add a field that
  distinguishes them. A distinct answer for "never existed" turns probing into a progress
  signal — feedback that the address space is being searched correctly — and an identical
  answer denies it; the fourth case is additionally one the client *cannot* tell apart,
  since a stamped scope root raises the same exception with no node in the body. The screen
  therefore names all four causes rather than asserting the likeliest, which is `BRIEF.md`'s
  "deleting a folder that is being viewed by someone it was shared with" answered honestly
  without a contract change.

### Added — Sharing: shares written, and grants resolved (Phase 4, issue 06)

- **A `LINK` share's URL is returned exactly once**, in the response to the call that
  created it. `randomBytes(32).toString('base64url')` is minted in `share-token.ts`, only
  its SHA-256 reaches `token_hash`, and `shareSummarySchema` has **no field** for a token —
  that absence is the enforcement, not a convention. No endpoint can be added later to show
  a lost link again without defeating the reason it is hashed; the way to replace one is to
  revoke it and create another. Issue 08's dialog has to say so at creation time.
- **`NodeRepository.findGrantNodeInRoom` deliberately sees soft-deleted rows and takes no
  `AccessScope`.** Both omissions are load-bearing. It runs *before* a scope exists —
  producing one is its purpose — and it must return a deleted node so that a grantee whose
  folder the owner removed gets `410` ("deleted by the owner") rather than `404` ("you were
  never given this"). It lives in `node.repository.ts` because of the **tool** it needs, not
  the subject it serves: the soft-delete extension overwrites a caller-supplied `deletedAt`
  by design, so raw SQL is the only way past it, and ESLint confines raw SQL to that file.
  Moving it to `share.repository.ts`, where its subject suggests it belongs, trips that rule
  — and the rule must not be weakened to allow it.
- **Three `ShareRepository` reads take no `AccessScope`**, each now a row in
  `architecture.md` § Scope-exception inventory: `findLiveGrantsForEmail` (bounded by
  `dataRoomId` plus a **verified** email), `findLiveByTokenHash` (bounded by the unique
  index; the token *is* the authorization), and `listForGrantee` (crosses rooms on purpose
  — that is what "Shared with me" is).
- **The soft-delete extension does not reach a relation filter.** It narrows a query on
  `Node`; `listForGrantee` queries `Share`, so "drop grants whose node was deleted" is
  written out explicitly. Its liveness and node-liveness predicates are combined with
  `AND: [...]` rather than two `OR` keys in one object literal — the second would silently
  overwrite the first, and the share would stay listed after expiry.
- **`NodeService.browse` now resolves the scope root for liveness** when no `nodeId` is
  given and the scope is a subtree. Every child of a deleted folder is stamped too, so
  without it a grantee saw an empty listing and "Nothing here yet" — a silent falsehood
  about somebody else's documents. One extra query, on the grantee path only.
- **The broadest live grant wins** (decision #29), tie-broken by `created_at` then `id` so
  the same request cannot resolve two ways on two page loads.
- **`AccessControlService` reads `ShareRepository` and `NodeRepository` straight from
  `PersistenceModule` and imports no feature module.** `NodeModule` imports `AccessModule`,
  so an import of `ShareModule` or `NodeModule` here would close a cycle.
- **A grant is matched only against a *verified* session email** (decision #7). The session
  JWT carries `{ sub, email }` and no verification flag, so it comes from a primary-key read
  on the user row, on the non-owner path only. Adding the claim to the token instead would
  log out every open session.
- `resolveForToken` has **no `mode` branch** and must not grow one (decision #27):
  `shares_mode_check` keeps `token_hash` null on every `USER` row. Unknown, revoked and
  expired tokens are one `410`.
- **The mode constraint is enforced in Zod first.** `createShareBodySchema` rejects a `USER`
  body without an address and a `LINK` body with one, so a bad body is a `422` a dialog can
  render rather than a `500` from a CHECK violation. The grantee address is normalized in
  the schema (`.trim().toLowerCase()`), because matching a grant is a plain string
  comparison and one un-normalized write makes it miss silently.
- No migration: `Share` and `shares_mode_check` shipped with the init migration.
- `/s/:token` has no controller yet — issue 07 owns the anonymous surface — and the web app
  has no share dialog or "Shared with me" screen yet (issue 08). `GET
  /api/shares/shared-with-me` already answers.

### Fixed — Folder contents no longer change height between states (Phase 4, issue 04)

- **`UploadDropzone`'s wrapper is now a `flex flex-col min-h-(--browser-frame-min-height)`
  container** (`features/upload/upload-dropzone.tsx`), not a bare `relative` div. Its drag
  overlay is `absolute inset-0`, so before this it was exactly the size of whatever it
  wrapped — over a one-file folder (90px) that meant a 24px icon and two lines of text
  fighting for space. The overlay is legible now because its parent has a floor, not
  because the overlay itself changed.
- **`--browser-frame-min-height: 250px` is one CSS custom property** (`index.css`), not a
  `min-h-[250px]` repeated in every file that needs the floor. `NodeTableSkeleton` must
  independently reach the exact same height as the dropzone (see below), so a literal
  copied into both places would silently drift the day either one is tweaked. It is a
  plain `:root` variable, not an entry in the default spacing scale, because that scale
  backs every `p-*`, `m-*` and `gap-*` utility in the app — this is one layout constant,
  not a scale to extend.
- **Both things the dropzone can wrap now stretch to fill it**: `Placard`
  (`node-browser/browser-states.tsx`, used by `EmptyFolderState`) gained `flex-1
  justify-center`, and the table's outer bordered box (`node-browser/node-table.tsx`)
  gained `flex flex-1 flex-col`. A folder with rows stays pinned to the top of that box;
  the leftover space is blank and still inside the frame, and still a valid drop target.
- **`NodeTableSkeleton` reaches the same floor independently** — it renders during
  `browse.isPending`, outside `UploadDropzone` entirely, so it cannot inherit the fix from
  either of the above and needed its own `min-h-(--browser-frame-min-height)` plus
  vertical centring.
- **The in-table "this folder is empty" message moved out of the table.** It was a
  `colSpan={5}` row with fixed `py-14` padding, which meant it hugged the top of the box
  under the `..` row with dead space below rather than centring like `EmptyFolderState`
  does at the room root. It is now a plain `flex-1 flex items-center justify-center`
  `div` rendered after `</Table>`, a sibling of the table rather than a row inside it —
  the `..` row is still a real table row above it, but the message itself grows to fill
  whatever height is left and centres in it, matching the room-root placard instead of
  reading as a second, shorter kind of "empty."

### Added — The `..` row (Phase 4, issue 03)

- **A pinned first row in the folder table that navigates one level up**
  (`features/node-browser/node-table.tsx`), rendered outside `nodes.map` — no size,
  contents, date or actions dropdown, and no drag handlers, so it cannot accidentally
  satisfy `accepts()` as a drop target.
- **The destination is `node.parentId`, never anything derived.** `parentId` is `null`
  both at the caller's Access Scope root and at the room root, so the row disappears
  exactly where climbing must stop — a node above the caller's scope stays
  indistinguishable from one that does not exist. `MoveNodeDialog`'s "Up one folder"
  already relied on the same field; this row matches its `aria-label` wording.
- The link's visible text is `..`, but its accessible name is "Up one folder" — a screen
  reader announces the destination, not two dots.
- **An empty folder still offers the `..` row.** Issue 03 originally called for
  `EmptyFolderState` to fully replace the table on an empty listing, which would have
  taken the row with it — a dead end with no gesture back up but the breadcrumb. Revised
  during review: `NodeBrowser` now falls back to the standalone placard only at the room
  root (`node === null`, where there is no `..` destination to offer either way);
  everywhere else `NodeTable` renders the `..` row plus an in-table "this folder is empty"
  message, so climbing out never depends on remembering the breadcrumb is there.

### Added — Download a file (Phase 4, issue 05)

- **`GET /api/rooms/:roomId/nodes/:nodeId/content?disposition=inline|attachment`.** The
  parameter selects the `Content-Disposition` **type** written into the presigned GET;
  `filename*=` (RFC 5987) is unconditional, and is what makes a saved file arrive named
  after the node rather than after its UUID storage key. Absent means `inline`, so every
  caller written before this is unaffected.
- **This cannot be done on the client, and a future refactor must not try.** `<a download>`
  is ignored for a **cross-origin** URL. The bytes are served by storage, not by this
  origin, so the disposition has to be inside the signature — which means it is chosen at
  signing time, on the server. The preview's URL is signed `inline` and is therefore
  unusable for a save: `useDownload` fetches its own URL at click time and does not go
  through TanStack Query at all, so there is no cached entry to reuse and none to go stale
  (the same hazard decision #15 addresses for the preview).
- **An unknown `disposition` is `400`, not a fallback to `inline`.** New `ZodQueryPipe`
  (`common/zod-query.pipe.ts`) exists for that status: `ZodValidationPipe` answers `422`,
  which is right for a body a person typed and wrong for a query parameter our own client
  assembles — there, a bad value is a malformed request, and a silent default would hide the
  typo while the feature half-worked.
- **Download is available to a `VIEWER`, deliberately.** The content endpoint is not guarded
  by role — the `AccessScope` boundary already answers who may read — and a reader who can
  open the document in the preview can already keep the bytes. The row-actions menu is
  therefore **no longer hidden behind `canWrite`**: it renders whenever it would hold at
  least one item, with each mutation item individually behind the role. Re-gating the whole
  menu would leave a reader with a permitted download and no way to ask for it.
- **`InlineFailure`** (`features/node-browser/inline-failure.tsx`) is the extracted banner
  that already reported failed drag-moves, now shared with download — the two operations
  that finish with no dialog open to report into. It is one component on purpose: Activity
  (`phase-4.1`, issue 06) deletes this surface and takes both cases with it, and a second
  hand-rolled banner would survive that deletion unnoticed.
- Verified against the local MinIO bucket that both dispositions come back on the response
  and that a Cyrillic file name survives the header intact. **GCS is not covered by that** —
  the `response-*` overrides are exactly where the two can differ, so it stays a manual gate
  item against a real bucket.
- Note for anyone editing `packages/contracts`: `apps/api` still type-checks against the
  package's `dist`, so a new export needs `pnpm --filter @dr/contracts build` before
  `pnpm typecheck` will see it. `apps/web` resolves the source directly.

### Added — Phase 3 (S2), upload queue, PDF preview, file states, move UI

- **Upload queue** (`features/upload/`). The three-step protocol, driven from the browser:
  a batched presign, one sequential `PUT` per file straight to storage, and one complete
  per file. Five row states — pending, uploading, error, cancelled, complete — all of them
  shipped with the screen.
- **`putObject`** (`features/upload/put-object.ts`). The one request in the app that does
  **not** go through `api-client.ts`: `XMLHttpRequest`, because `fetch` cannot report upload
  progress and cannot abort mid-body. Failures are `TransferError`, never `ApiError`.
- **File drag-and-drop into a folder, and node drag-and-drop between folders.** Two separate
  native HTML5 mechanisms, no new dependency.
- **PDF preview** (`features/viewer/`). `<iframe>` on the presigned GET, fetched with
  `staleTime: 0` / `gcTime: 0` (decision #15). No PDF library.
- **`NodeView`** dispatches on `node.type`: a file id renders the preview, a folder id the
  browser. Same route, no new one — and it now owns the loading, `404` and `410` screens for
  both.
- **The deleted-file `410` screen**, owed by Phase 2. A second component, not a second
  destination.
- **"Move to…" dialog with a folder picker**, the primary move affordance (decision #19),
  plus dragging a file row onto a folder row.

### Changed — Phase 3 (S2)

- **`apps/web` resolves `@dr/contracts` to `packages/contracts/src`**, through a Vite alias
  and a matching tsconfig `paths` entry, instead of to the package's `dist`. This is what
  decision #12 says — "consumed as TypeScript source by both apps" — and the package's
  `main` never delivered it. It removes the CJS interop, the `optimizeDeps` pre-bundle, and
  a whole failure mode: Vite keys that pre-bundle on the lockfile and the config, **not** on
  a linked package's `dist`, so a running dev server kept serving the previous build of the
  contracts. What that looked like was not an error but `undefined` for every export added
  since — `NaN MB` in the upload hint, with `presignUploadResponseSchema` silently
  `undefined` beside it. `apps/web`'s `rootDir` widens to the repository root because the
  checked program now spans two packages. **`apps/api` is unchanged and still uses `dist`**,
  so a contract edit still needs `pnpm --filter @dr/contracts build` before its type-check.

### Fixed — Phase 3 (S2)

- **The delete dialog said "This also deletes everything inside it — 583 B" for a file.**
  Phase 2 wrote that sentence when only folders existed; a file has nothing inside it. It
  now reads "This file is 583 B." Found by walking the flow in a browser, not by a test.

### Fixed — session guard wiring (found in manual testing)

- **Every guarded request outside `AuthModule` answered `500` once a session passed half its
  life.** `JwtModule` was registered inside `AuthModule` and not exported, and a guard named
  in `@UseGuards()` is constructed in the module that declares the **controller** — so
  exporting `JwtAuthGuard` alone left `NodeModule` and `FileModule` unable to resolve
  `JwtService`, and the guard was built with `jwt` undefined. `AuthModule` now exports
  `JwtModule`.

  Two things kept this hidden and are worth remembering. `reissueIfStale` returns before
  touching `this.jwt` until the token crosses `SESSION_REISSUE_AFTER_SECONDS`, so a fresh
  login never reaches the branch — a complete manual walk of every flow passed on it, and
  the failure then arrives an hour later with no code change to blame. And `ConfigModule` is
  global, so the guard's other dependency resolved anyway, leaving a half-built guard rather
  than a startup error. `/api/me` kept working throughout, because `MeController` lives in
  `AuthModule` — the header stayed populated while every folder answered `500`.

  **No test in this repository could have caught it**: the suite wires services by hand and
  never boots the module graph. `notes/issues/phase-3/issues/03-di-wiring-regression-test.md`
  carries that gap.

### Notes that the diff does not make obvious — Phase 3 (S2)

- **The two drag mechanisms are told apart by `DataTransfer.types`, and nothing else can
  do it.** `getData()` is unreadable during `dragover` — the browser's drag protection mode
  — so at the moment a drop must be accepted or refused, the only visible fact is the type
  list: `Files` for a file drop, `application/x-vdr-node` for a node drag. The type string
  is lowercase because the browser normalizes `types`; a capitalized constant would silently
  never match.
- **`draggable={false}` on the file name link is load-bearing.** An anchor is draggable by
  default and would start a _link_ drag — a URL — from the part of the row a user is most
  likely to grab. Removing that attribute breaks the move drag in a way that looks like the
  drop target being wrong.
- **`gcTime: 0` is the half of decision #15 that matters**, not `staleTime: 0`. With
  `staleTime: 0` alone the presigned URL is still _retained_ after the preview unmounts, so
  returning to the file inside the default `gcTime` renders the cached URL — and past its
  300 seconds what appears inside the frame is the storage provider's XML error, looking
  like a corrupt document. `refetchOnWindowFocus` is off for this one query against the
  app-wide default: the frame only needs a valid URL when it loads, and swapping `src` under
  a reader loses their place in the document.
- **The file `410` wording is reachable in exactly two ways, and neither is a state
  machine.** A `410` body carries a message and no type. The preview knows it was looking at
  a file because TanStack keeps the last success beside a failed refetch; a click on a row
  that has already gone knows because the table put `nodeType` in navigation state — which
  rides on the history entry, so a **reload** of that entry keeps it too. A link arriving
  from outside the app carries neither and falls back to the folder wording on purpose. Do
  not add a type field to the error body to close that gap.
- **The dropzone rejects on the shared limits and still shows the file.** Wrong type,
  oversized or an unusable name become `error` rows _before_ presign, from
  `MAX_FILE_SIZE_BYTES`, `UPLOAD_MIME_TYPE` and `nodeNameSchema` — never a second copy of
  the numbers. A silently ignored file is worse than a row saying why.
- **`429` has no backoff and must not grow one.** Twenty presigns a minute at ten files each
  is two hundred files: a legitimate user cannot reach it, so reaching it means something is
  wrong and a silent retry would hide it.
- **Cancel stops being offered once the bytes are in storage.** From there the file is one
  call from existing, so a row claiming it was stopped would be a lie. A cancelled or
  abandoned transfer leaves a `PENDING` blob that nothing collects — known, accepted, and
  the sweeper is Phase 6 README prose.
- **Rename says nothing about suffixes, on purpose.** Upload auto-suffixes because the name
  came from a file; rename and move answer `409` because the user chose the name or the
  destination (decision #20). Copy promising an automatic rename on those dialogs would
  describe the one path that does not do it.

### Added — Phase 3 (S1), upload protocol, move and content URLs

- **`StorageService`.** One implementation for MinIO and GCS, reached through GCS's
  S3-compatible XML API: presign PUT/GET, `HEAD`, delete. `forcePathStyle` because both
  endpoints address a bucket by path.
- **Upload protocol (decision #28).** `POST /api/rooms/:roomId/uploads/presign` takes a
  batch; `POST /api/rooms/:roomId/uploads/complete` takes **one file**. A `FILE` node is
  born only here — it cannot exist without a `READY` blob.
- **`BlobRepository`.** Prisma only, bounded by `storageKey: { startsWith: dataRoomId + '/' }`.
  `blobs.storageKey` is the whole of a blob's tenancy; `Blob` has no `dataRoomId` column.
- **`POST /api/rooms/:roomId/nodes/:nodeId/move`.** One transaction: parent change,
  descendant `path` rewrite, and both halves of the aggregate transfer.
- **`GET /api/rooms/:roomId/nodes/:nodeId/content`.** `{ url, expiresAt }` as JSON, GET
  signed for 300 s, `response-content-type` and `response-content-disposition: inline` with
  an RFC 5987 filename. **Not** guarded by `role` — a `VIEWER` must be able to open a file
  shared with them in Phase 4.
- **Presign rate limit**, 20/minute keyed on the session `userId`, registered on the
  controller after `JwtAuthGuard`.
- **Contract reshape.** The four limits (`application/pdf`, 10 MB, 10 files, 200 MB quota),
  the presign / complete / content schemas, and `moveNodeBodySchema` — all of it in S1, so
  S2 does not build against a moving shape.
- **Five more integration tests**, on the Phase 2 harness: the `23505` retry, the idempotent
  replay, the `410` replay, the move cycle guard, and the presign limit being per user.
  Listing coverage extended to mixed folders and files across a page boundary.

### Notes that the diff does not make obvious — Phase 3 (S1)

- **The auto-suffix bound is 3, and it is visible in behaviour.** A folder already holding
  `contract.pdf`, `contract (1).pdf` and `contract (2).pdf` answers **`409` on the fourth
  drop** of that name. Correct per decision #20; no diff shows it. The suffix goes before
  the extension, and at the 255-character limit the **stem** is shortened rather than the
  suffix — a truncated suffix would collide again, which is the one thing the retry cannot
  recover from.
- **The retry re-runs the whole transaction, and the flip is what proves it.** The
  conditional `PENDING → READY` update sits _inside_ the transaction, so a `23505` on the
  node insert rolls it back and the blob returns to `PENDING`. Move the flip out, or retry
  only the insert, and the second attempt finds the blob `READY`, takes the idempotent
  branch, finds no node, and answers **`410` for an upload that just succeeded**. The
  integration test asserts the blob ends `READY` once with the room charged once — the
  obvious assertion, "the second file is named `contract (1).pdf`", passes either way.
- **Three new runtime dependencies, not the one `roadmap.md:308` names.** `getSignedUrl` is
  not exported from `@aws-sdk/client-s3`; it lives in `@aws-sdk/s3-request-presigner`, which
  no design document mentions. Installed with the owner's approval on the stop-and-ask.
  `roadmap.md:308` still says "the one new runtime dependency" and is wrong.
- **`signableHeaders: new Set(['content-type'])` is load-bearing and fails silently.**
  Without it the presigned PUT accepts any content type, and nothing catches it: complete
  re-checks the type with a `HEAD`, so every test still passes while the guarantee is gone.
  It cannot be verified against MinIO alone — check 2 of `notes/issues/phase-3/gcs-check.mjs`
  is what proves it.
- **`SessionThrottlerGuard` throws instead of falling back to `req.ip`.** Behind the Vercel
  rewrite `req.ip` is the proxy's address for every caller, so a fallback would turn a broken
  guard chain into one shared bucket for the whole deployment — a limit that works, counts,
  and is wrong. It also reads `req.user.userId`: `SessionContext` has no `id`, so the
  library's own `req.user?.id` spelling compiles here and yields `undefined`.
- **Complete short-circuits on a `READY` blob before re-validating the bytes.** Taken
  literally, `HEAD`-then-transaction would re-run the size and type checks on a replay — and
  a violation there deletes the object, which for an already-completed blob means deleting
  the bytes behind a live file.
- **`TransactionRunner` is new, in `persistence/`.** Upload-complete spans two repositories,
  so its transaction belongs to neither; services cannot open one because `PrismaService` is
  not exported. It carries the raised Prisma budget — `maxWait` 5 s, `timeout` 15 s — because
  the advisory lock is taken _inside_ the transaction and lock wait counts against `timeout`.
- **`substring(path FROM $n::int)` — the cast is not decoration.** Postgres has two
  `substring` forms, and `substring(text FROM text)` is the _regex_ one. An uncast bind
  parameter resolves to it, so the offset is read as a pattern, nothing matches, and every
  rewritten `path` comes back `NULL`. Here it surfaced loudly as a `23502` because `path` is
  `NOT NULL`; in a nullable column it would have been silent.
- **GCS verified, 7/7 against the real bucket**, run by the owner because the agent may not
  hold the credentials (`notes/issues/phase-3/gcs-check.mjs`, which drives the compiled
  `StorageService`). The presigned PUT refuses a mismatched content type with `403`, and both
  `response-*` overrides survive intact — GCS matches MinIO on every parameter S2's preview
  is built on. CORS is not covered and cannot be until S2 serves a page from the app origin.
- **A presigned PUT URL is not single-use on GCS.** The second PUT to the same URL returns
  `200` and replaces the object. So for the whole PUT TTL — 900 s from presign — the bytes
  behind a completed file can still be swapped, while `Node.size` and the room aggregates
  keep the values read by the `HEAD` at complete. `db:recompute` does not repair it either —
  `Blob.size` is stale by the same amount — so the 200 MB quota is evadable by someone
  willing to do it deliberately. The URL only ever reaches the owner uploading their own
  file, so it grants no access anyone lacked. **Left as is on purpose** and recorded in the
  README's known limitations; the reasoning is in `notes/issues/phase-3/deviations.md`.

### Added — Phase 2, node backend

- **`AccessScope`.** A branded boundary produced only by `AccessControlService`. The brand
  is a `unique symbol` that is not exported, so no service can write an object literal
  that satisfies the type — the enforcement is the type, not a convention.
- **`NodeRepository`.** The tree, and the only file allowed to run raw SQL. Every method
  takes an `AccessScope` first and bounds its query by `path LIKE rootPath || '%'` **in
  SQL**, never in TypeScript.
- **Node endpoints.** `GET /api/rooms/:roomId/nodes/:nodeId?`, `POST`, `PATCH /:nodeId`,
  `DELETE /:nodeId` — browse, create folder, rename, delete subtree.
- **Contract reshape (decision #24).** The browse response carries
  `{ room?, node, breadcrumbs, children, nextCursor, role }`, and `GET /api/me` narrows to
  `{ user, dataRooms: [{ id, name }] }`. Room aggregates no longer travel with the session.
- **`nodeNameSchema`.** One schema in `packages/contracts` for both request bodies and,
  from the next session, both dialog resolvers.
- **`ZodValidationPipe`.** Bodies are validated against the contracts schemas and rejected
  with `422`. Nest's `ValidationPipe` is not used anywhere in this API.
- **Integration harness.** Vitest against a real Postgres, with three tests: the subtree
  delete over an already-deleted subtree, `23505` → `409` on rename, and keyset paging.
  CI now runs a `postgres:17` service container for them.

### Notes that the diff does not make obvious — Phase 2 backend

- **`findInScope` has no safe twin, and that is the design.** It always returns
  soft-deleted rows. Adding a `findById` that filters `deleted_at` would let a call site
  turn a `410` into a `404` — a deleted document reported as one that never existed. Every
  caller goes through `NodeService.resolveLiveNode`, whose return type has no `deletedAt`
  field at all, so `if (!node) throw 404` cannot compile into serving a deleted node.
- **The subtree delete is the single writer of `deleted_at` on `nodes`.** "A node under a
  deleted ancestor is itself deleted" is an assumption the `410` design rests on, not a
  constraint the database enforces. A second writer — a restore cascade, a hand-run
  `UPDATE` while debugging — breaks it silently, leaving live rows under a deleted
  ancestor that are missing from listings and still readable by direct id.
- **`AND deleted_at IS NULL` in that delete is load-bearing.** Without it a second delete
  re-stamps already-deleted rows and charges the ancestors for them twice. Nothing throws;
  the delete-warning dialog simply shows a wrong number. The integration test was verified
  by removing the predicate — the delta goes from `-2` to `-4`.
- **The listing carries the database's own `lower(name)`.** The cursor must hold the value
  Postgres computed for the `ORDER BY`, not a JavaScript `toLowerCase()` of the name:
  JS case folding is locale-invariant while `lower()` follows the collation, and where
  they disagree a row is dropped or repeated at a page boundary.
- **`applyAggregateDelta` updates `DataRoom` too, in the same transaction.** A root-level
  node has no ancestors, so the ancestor `updateMany` would update nothing at all. It is
  also the one repository method deliberately _not_ clipped to `rootPath`: counters above
  a share root still have to be right. Both facts are in `architecture.md`'s new
  scope-exception inventory, which is where the next such method must be recorded.
- **`23505` is caught in two spellings.** The uniqueness index is created in raw SQL, not
  declared in the Prisma schema, so Prisma's `P2002` cannot be assumed; the driver's raw
  SQLSTATE is matched as well, following the error through `cause`.
- **The integration tests use their own database.** `TEST_DATABASE_URL`, defaulting to
  `…/dataroom_test`, because the harness empties every table between tests — pointing it
  at the compose database would wipe the local sign-in on every run. `prisma migrate
deploy` creates it on first use, so there is no setup step. It is read from the real
  environment, **not** from `.env`: Vitest does not load that file, so overriding the
  default means exporting the variable (which is what `ci.yml` does).
- **`apps/web/src/routes/rooms.$roomId.tsx` is a placeholder between two shapes.** It lost
  the aggregates it used to render from `/api/me` and gained nothing back: the node browser
  that reads them from the browse endpoint lands in the next session, along with the
  removal of its `dataRooms.find` ownership gate.

### Added — Phase 2, node browser (web)

- **`features/node-browser/`.** One `NodeBrowser` component serves the room root and every
  folder inside it: breadcrumbs, a folder table, the create / rename / delete dialogs, and
  the four error screens. The API answers both locations with one shape, so there is no
  second code path for "the root".
- **Route `rooms/:roomId/n/:nodeId`,** plus a rewritten `rooms.$roomId.tsx`. **Both lost
  their ownership gate** — see the note below.
- **Folder rows carry their own subtree totals.** Read straight off the denormalized
  counters on each row, so a folder with ten thousand descendants renders in the same work
  as an empty one. This is the README's scaling claim on screen rather than asserted.
- **Keyset pagination** via `useInfiniteQuery` over the opaque `nextCursor`, with a
  "Load more" control. Page size is the server's 50.
- **`dataRooms: []` renders the shell's error state** (decision #23), in `SessionGate`
  above every authenticated route. There is no create-room affordance to offer instead.
- **`cursor: pointer` restored** on `button` and `[role="button"]` in `index.css`
  `@layer base`, over Tailwind v4's Preflight. Global so it also covers Radix triggers.

### Notes that the diff does not make obvious — Phase 2 web

- **The route must never decide what exists, and that is a security property.** There is
  no `dataRooms.find(...)` gate in either room route. `GET /api/me` lists the rooms the
  caller _owns_, not the rooms they can _reach_; in Phase 4 a `USER`-share recipient
  browses these same private routes, and an ownership gate would 404 them in the client
  before the API was ever asked. Reintroducing one — it looks like a harmless guard —
  breaks sharing one door over from wherever it is added.
- **Four statuses, four screens, and collapsing any two is the failure mode.** `404` "Not
  found", `410` "This folder was deleted by the owner" with a link to the room root, `409`
  inline in the dialog with no auto-suffix, `422` on the field. `ApiError.status` is
  preserved from `fetch` to the component for exactly this reason, and 4xx is never
  retried — a retried `410` is a second of fake "loading" over an answer the server gave
  instantly.
- **The `410` screen is a dead end with a way back, never a redirect.** There is no
  nearest-live-ancestor to bounce to: the subtree delete stamps every ancestor in one
  statement, so any bounce lands at the room root anyway. It fires only for a caller
  standing _inside_ the deleted folder; a deleted child just stops appearing in its
  parent's next listing.
- **One mutation invalidates one browse key, and never the session key.** Aggregates
  travel with what is being viewed (decision #24), so the header and the table are the
  same query and refetch together. Invalidating `queryKeys.session` on a content mutation
  is precisely the coupling #24 removed.
- **Dialog state lives inside `DialogContent` on purpose.** Radix unmounts a closed
  dialog, so the typed name, the touched flag and the last `409` reset for free. Hoisting
  that state one level up gives a dialog that reopens still showing the previous attempt's
  conflict, and no reset effect to forget.
- **The `409` sentence in the dialog is `node.errors.ts`'s, verbatim.** The client shows
  `ApiError.message` rather than composing its own wording, because the collision is on
  `lower(name)` — `legal` conflicts with `Legal` — and an invented "That name is taken"
  would hide why. Editing that exception message edits the UI.
- **The dialogs validate with `nodeNameSchema` directly, not through a `react-hook-form`
  resolver** as `architecture.md` § `nodeNameSchema` describes. The dependency is not
  installed and was not added. The invariant the doc protects is intact — one schema drives
  both request bodies and both dialogs — only the mechanism differs, and it is contained
  entirely within `node-name-dialog.tsx`.
- **Breadcrumbs are rendered exactly as the API sends them.** They arrive already clipped
  to the caller's scope root, and nothing on the client reconstructs ancestry or climbs
  past a `parentId: null`. A client-side rebuild from `parentId` would walk straight past
  the boundary, and in an M&A context a folder name is itself confidential.
- **`dataRooms: []` has never been seen on screen.** Provisioning is idempotent and runs
  on every sign-in, so reaching it means hand-deleting the `data_rooms` row. The code path
  is `SessionGate` → `NoDataRoomState`; it is the one state in this phase verified by
  reading rather than by looking.

### Changed — Phase 2 → 3 forward-compat pass

No behaviour changed. The pass ran against the frozen surfaces at the boundary, which is
the last moment `docs/` are cheap to edit, and produced one spec correction plus four
invariants that Phase 2 satisfies by accident.

- **The deleted-_file_ `410` no longer promises a link to its folder**
  (`architecture.md` § `410` on both node types). It cannot: a `410` carries no body, so
  on a direct load the client knows neither that the node was a file nor which folder held
  it. The type is only in hand when the reader arrived by clicking a row, and a reload
  destroys it. Both screens now go back to the Data Room root. The alternative —
  `{ type, parentId }` in the `410` body — leaks nothing, since the order of checks has
  already established this caller could see the node alive, but it turns an error into a
  response shape that every later producer owes, including the Phase 4 share `410`s, which
  have no node to describe. The link would usually be dead anyway: the subtree delete
  stamps every ancestor in one statement, so a file's parent is very likely `410` itself.
- **Two Phase 3 checkboxes added that nothing had scheduled.** The file `410` screen was
  deferred by Phase 2 and never picked up by Phase 3, and `NodeRoute`'s type dispatch was
  implied by the route structure and written down nowhere. A commitment recorded in one
  document and unscheduled in the other looks planned and is not.
- **Four invariants carried into Phase 3's "watch for"**, each currently true for a reason
  that stops holding once `FILE` rows exist: a file's `path` needs the same trailing slash
  and app-generated id as a folder's, or `LIKE path || '%'` matches siblings; the subtree
  delete already handles a single file and must not acquire a second writer of
  `deleted_at`; `deleteSubtree` takes no advisory lock, so a concurrent delete can make an
  upload's quota check refuse `422` and then succeed on retry (accepted — the room cannot
  go _over_ quota); and the folders-before-files order has never executed against mixed
  data, resting on the enum's declaration order and the keyset's `::"NodeType"` cast.
- **`@nestjs/throttler` needs no early raise.** The stale rationale in `roadmap.md` said to
  install it ahead of Phase 3 so `minimum-release-age=10080` would not refuse it. Verified
  at the boundary: the newest release is `6.5.0` from 2025-12-02, nine months clear of the
  gate, peer range covering `@nestjs/common ^11`. It stays where it was scheduled.
- **`applyAggregateDelta` is four call sites but five calls.** Move calls it twice —
  negative off the old ancestor chain, positive onto the new. The two room updates net to
  zero, which is correct: a move relocates a subtree inside one room and changes no
  whole-room total. Both the docstring and the roadmap said "four", and someone would have
  counted.

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

- **Bucket CORS is console-only state.** `scripts/gcloud-bootstrap.sh` does not set it and
  the repository holds no `cors.json`, so the configuration on `vdr-test-task-docs` exists
  nowhere but the console: one entry with origins `http://localhost:5173` and
  `https://virtual-data-room-gamma.vercel.app`, methods `GET`, `PUT` and `HEAD`, response headers
  `Content-Type` and `ETag`, max age 3600. Nothing will overwrite it — and nothing will
  restore it either if the bucket is ever recreated. `ETag` is in the list so the browser
  may read it back after a signed `PUT`; without it the S3 client sees a successful upload
  and an `undefined` ETag. Bucket CORS applies because uploads go through the
  S3-compatible XML endpoint; the JSON API ignores it entirely.

Why this was needed: the `Publish app` button on **Audience** stays disabled while the
**Branding** page's _App domain_ section is empty. Those three links are documented as
required for every External app in production, and the console names none of them — the
banner only says the configuration is incomplete. The earlier suspicion that `vercel.app`
was the blocker is wrong: `vercel.app` is on the Public Suffix List, so
`virtual-data-room-gamma.vercel.app` _is_ a top private domain and the console accepts it
as an Authorized domain.

Publication was verified behaviourally, not by reading the console: an account with no
role on the project and no entry in the test-user list signed in successfully. A project
owner signing in proves nothing — the console admits owners while the app is still in
Testing.

Carry this forward by hand: **do not upload an app logo and do not start brand
verification.** The app uses only non-sensitive scopes (`openid`, `userinfo.email`,
`userinfo.profile`), so verification is not required — but a logo on an External
production app triggers it, and verification demands a Search Console _Domain property_
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
