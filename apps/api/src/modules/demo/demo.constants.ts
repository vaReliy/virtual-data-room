/**
 * Everything the demo is, in one file: who owns it, what it is called, which two rows have
 * fixed identity, and whether a sign-in is granted access to it.
 *
 * **None of this is configuration.** An earlier revision put it in the environment, on the
 * reasoning that a local and a deployed demo might want to differ. They must not: the demo
 * exists to be identical everywhere, and two environments disagreeing about the demo room's
 * name was a way for the seed and the grant to silently stop finding each other. Constants
 * cannot drift.
 */

/**
 * The Data Room's id, and the id of the folder that is shared — **fixed, not generated**.
 *
 * Node ids are `randomUUID()` at insert, so everything the seed creates gets a new identity
 * on every run. These two do not, and that is what makes the demo re-seedable in place: a
 * `/rooms/:roomId` link written into a README survives, and — the part that matters
 * structurally — `DemoGrantService` finds the folder to share **by id**, never by name. The
 * name is then free to change without quietly breaking the grant.
 *
 * They are deliberately readable rather than random-looking: nobody should mistake one of
 * these for a real room. Both are valid v4-shaped UUIDs, which is all Postgres requires.
 */
export const DEMO_ROOM_ID = 'd3900000-0000-4000-8000-000000000001';
export const DEMO_SHARE_FOLDER_ID = 'd3900000-0000-4000-8000-000000000002';

/**
 * The demo owner's `Account.provider_account_id`. Synthetic, in a shape Google never issues
 * — a real `sub` is decimal digits — so **the demo owner is a row that exists and cannot be
 * signed in as**. `upsertFromGoogle` is reused rather than a second user writer added: it is
 * already keyed on `(provider, providerAccountId)`, which is exactly the idempotency the
 * seed needs.
 */
export const DEMO_PROVIDER_ACCOUNT_ID = 'seed:acme-demo-owner';

/**
 * Acme Corp. is the company in `BRIEF.md` conducting the due diligence, so the demo room
 * reads as theirs rather than as a developer's test data.
 *
 * The address is on `.example`, which RFC 2606 reserves and nobody can register. That is
 * load-bearing: `upsertFromGoogle` links a new Google account to an existing user with the
 * same email, so a demo owner on a *registrable* address could be signed in as by whoever
 * controls it — and they would own the demo room.
 */
export const DEMO_OWNER_EMAIL = 'dataroom@acme.example';
export const DEMO_OWNER_NAME = 'Acme Corp.';

/** Display names only. Identity is the two UUIDs above; these can change freely. */
export const DEMO_ROOM_NAME = 'Acme Corp. — Project Atlas';
export const DEMO_SHARE_FOLDER_NAME = 'Due Diligence';

/**
 * **The off switch for the first-login grant.** Set to `false` and redeploy to stop handing
 * the demo folder to everyone who signs in.
 *
 * It is a constant rather than an environment variable on purpose. On Cloud Run a changed
 * environment variable is a new revision — the same deploy either way — so the variable buys
 * no operational speed, and it can disagree with what the code says. This cannot.
 *
 * **Turning it off does not revoke anything.** A `Share` is a capability that was issued,
 * not a rule that is re-evaluated, so everyone already holding one keeps it. Taking it back
 * is `pnpm demo:revoke`, and it must run **after** this is `false` and deployed — otherwise
 * anyone signing in during the gap is granted again. See `docs/decisions.md` #32.
 */
// Annotated `boolean` rather than left to infer the literal `true`: without it, flipping
// the value changes the constant's *type*, and every `if` that reads it becomes provably
// dead in one direction — which is how a flag turns into a compiler error at the moment you
// most want it to be a one-word edit.
export const AUTO_GRANT_ENABLED: boolean = true;
