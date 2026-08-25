import type { Role } from '@dr/contracts';

/**
 * The brand. Deliberately **not** exported: without a way to name this key, no other file
 * can write an object literal that satisfies `AccessScope`. A service cannot invent its
 * own boundary, which is the whole point of decision #9 — authorization is a value
 * produced in one place and passed explicitly, never a check someone remembers to run.
 */
declare const accessScopeBrand: unique symbol;

/**
 * The resolved result of an authorization check — a boundary, not a boolean.
 *
 * Every repository method takes one as its first argument and confines its query to
 * `path LIKE rootPath || '%'`, in SQL. A node above the boundary therefore does not
 * exist for that request: it cannot be read, listed, renamed or deleted, and it cannot
 * appear in a breadcrumb.
 *
 * - `rootNodeId` is `null` when the scope is the whole Data Room (the owner, or a
 *   whole-room `USER` share). `rootPath` is then `'/'`.
 * - For a shared subtree, `rootPath` is the share root's own `path` — inclusive, so the
 *   shared node itself is inside the boundary.
 * - `role` says what the caller may *change*. Reading is already answered by the
 *   boundary; writing is not, which is why every mutation asserts it (decision #25).
 */
export interface AccessScope {
  readonly [accessScopeBrand]: 'AccessScope';
  readonly dataRoomId: string;
  readonly rootNodeId: string | null;
  readonly rootPath: string;
  readonly role: Role;
}

/** The shape a scope carries, minus the brand. Only the producer below may complete it. */
type AccessScopeFields = Omit<AccessScope, typeof accessScopeBrand>;

/**
 * The single construction site. It lives here rather than in the service only because the
 * brand does — every caller of it is in `access-control.service.ts`, and a second caller
 * anywhere else is a security change, not a refactor.
 */
export function brandAccessScope(fields: AccessScopeFields): AccessScope {
  return fields as AccessScope;
}
