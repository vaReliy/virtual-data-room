import { z } from 'zod';
import { roleSchema } from './node';
import { nodeTypeSchema, uuidSchema } from './primitives';

/**
 * A share is either a capability (`LINK`, a token anyone holding it may spend) or a grant
 * to a named person (`USER`, matched on their *verified* session email). The database
 * makes that a closed set rather than a convention — `shares_mode_check` in the init
 * migration requires `LINK` to carry a `token_hash` and no email, and `USER` an email and
 * no token — so the schemas below mirror it exactly. A body the constraint would reject
 * has to be a `422` from here, never a `500` from Postgres.
 */
export const shareModeSchema = z.enum(['LINK', 'USER']);
export type ShareMode = z.infer<typeof shareModeSchema>;

/**
 * A grantee's address, **normalized in the schema** rather than in the service.
 *
 * `grantee_email` is stored lower-case and `UserRepository` lower-cases the address it
 * writes on sign-in, so matching a grant is a plain string comparison. One un-normalized
 * write is therefore not a validation problem but a silent miss: the share exists, the
 * grantee signs in, and nothing resolves. Normalizing here means both sides of that
 * comparison are produced by the same declaration (decision #12).
 */
export const granteeEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('A valid email address is required.'));

/**
 * `POST /api/rooms/:roomId/shares`.
 *
 * `nodeId: null` means the whole Data Room — the grantee's scope becomes the room itself,
 * exactly as the owner's is. Anything else is a subtree rooted at that node.
 *
 * The refinement is `shares_mode_check` restated: a `USER` share without an address is
 * unreachable by anybody, and a `LINK` share with one implies a targeting the token does
 * not do.
 *
 * `expiresAt` is optional and carries no "must be in the future" rule: expiry is checked
 * where it matters, in the liveness predicate every read of a share applies.
 */
export const createShareBodySchema = z
  .object({
    nodeId: uuidSchema.nullable(),
    mode: shareModeSchema,
    granteeEmail: granteeEmailSchema.optional(),
    expiresAt: z.iso.datetime().nullish(),
  })
  .superRefine((body, ctx) => {
    if (body.mode === 'USER' && body.granteeEmail === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['granteeEmail'],
        message: 'An email address is required to share with a person.',
      });
    }
    if (body.mode === 'LINK' && body.granteeEmail !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['granteeEmail'],
        message: 'A link share has no recipient.',
      });
    }
  });
export type CreateShareBody = z.infer<typeof createShareBodySchema>;

/**
 * What the owner's list of shares renders.
 *
 * **There is no token field, and that absence is the enforcement.** A `LINK` share's
 * plaintext token exists exactly once, in the response to the call that created it; only
 * its SHA-256 is stored. No response shaped like this can leak one, and no endpoint can be
 * added later to recover a lost link without defeating the reason it is hashed.
 */
/**
 * How many other live `USER` grants the same grantee holds strictly beneath this one —
 * the number issue 09's cascade-revoke confirmation states. Populated only for a `USER`
 * grant on a folder or the whole room, where nesting is possible; absent otherwise
 * (`LINK` shares, and grants nothing can nest under). Optional rather than required, so
 * a response that does not compute it — none does yet outside the owner's share list —
 * still parses instead of failing with "Unexpected response shape".
 */
export const shareSummarySchema = z.object({
  id: uuidSchema,
  nodeId: uuidSchema.nullable(),
  mode: shareModeSchema,
  role: roleSchema,
  granteeEmail: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  nestedLiveGrantCount: z.number().int().nonnegative().optional(),
});
export type ShareSummary = z.infer<typeof shareSummarySchema>;

/**
 * `?cascade=` on `DELETE /api/rooms/:roomId/shares/:shareId`. Assembled by our own
 * client, so an unknown value is a malformed request (`400` via `ZodQueryPipe`), not a
 * person's typo — the same reasoning `contentDispositionQuerySchema` documents.
 *
 * Default is `false`: a caller that does not know about cascading must not cascade.
 */
export const cascadeQuerySchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');
export type CascadeQuery = z.infer<typeof cascadeQuerySchema>;

/**
 * The create response, and **the only place a token ever crosses the wire**.
 *
 * `url` is the full link for a `LINK` share and `null` for a `USER` one. The dialog has to
 * say, at this moment, that it cannot be shown again: the way to replace a lost link is to
 * revoke it and create another.
 */
export const createShareResponseSchema = shareSummarySchema.extend({
  url: z.string().nullable(),
});
export type CreateShareResponse = z.infer<typeof createShareResponseSchema>;

/**
 * What a grant points at, as the recipient sees it.
 *
 * `'ROOM'` is not a node type: it is what a whole-room grant (`nodeId: null`) is, and the
 * client needs it to build the link — `/rooms/:id` versus `/rooms/:id/n/:nodeId` — and to
 * pick an icon.
 */
export const sharedTargetTypeSchema = z.enum([...nodeTypeSchema.options, 'ROOM']);
export type SharedTargetType = z.infer<typeof sharedTargetTypeSchema>;

/**
 * `GET /api/shares/shared-with-me` — one row per live grant, across rooms.
 *
 * **`name` is the granted node's name, never the room's** — except when the grant is on
 * the whole room, where the room *is* the grantee's scope. Printing a room name beside a
 * subtree grant would leak exactly what breadcrumb clipping protects: a browse response
 * omits `room` whenever the scope is a subtree, and in an M&A context a name like
 * `Project Falcon` is itself confidential.
 *
 * `sharedBy` is who created the share, which is what tells two similarly named folders
 * from two different counterparties apart.
 *
 * `id` is the share's own id, and it is here to be a **stable list key** rather than to be
 * displayed or sent back. Nothing stops an owner granting the same node to the same address
 * twice — there is no unique constraint on `(data_room_id, node_id, grantee_email)` — so
 * `dataRoomId` and `nodeId` together do not identify a row.
 */
export const sharedWithMeEntrySchema = z.object({
  id: uuidSchema,
  dataRoomId: uuidSchema,
  nodeId: uuidSchema.nullable(),
  name: z.string(),
  type: sharedTargetTypeSchema,
  sharedBy: z.object({
    name: z.string().nullable(),
    email: z.string(),
  }),
  createdAt: z.iso.datetime(),
});
export type SharedWithMeEntry = z.infer<typeof sharedWithMeEntrySchema>;
