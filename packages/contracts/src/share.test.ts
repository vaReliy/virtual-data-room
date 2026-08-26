import { describe, expect, it } from 'vitest';

import { cascadeQuerySchema, createShareBodySchema, shareSummarySchema } from './share';

/**
 * The schema is where `shares_mode_check` is enforced *first*. Every combination the
 * database CHECK refuses has to be rejected here, or a bad body reaches Postgres and the
 * caller gets a `500` where they were owed a `422` — an error a dialog cannot render.
 */
describe('createShareBodySchema', () => {
  // A fixed UUID: this package has no Node types, and the value only has to be well formed.
  const nodeId = '11111111-2222-4333-8444-555555555555';

  it('normalizes the grantee address, so a grant cannot silently miss', () => {
    const body = createShareBodySchema.parse({
      nodeId,
      mode: 'USER',
      granteeEmail: '  Counterparty@Example.COM ',
    });

    expect(body.granteeEmail).toBe('counterparty@example.com');
  });

  it('rejects a USER share with no address: nobody could ever reach it', () => {
    const result = createShareBodySchema.safeParse({ nodeId, mode: 'USER' });

    expect(result.success).toBe(false);
  });

  it('rejects a LINK share carrying an address: a token targets nobody', () => {
    const result = createShareBodySchema.safeParse({
      nodeId,
      mode: 'LINK',
      granteeEmail: 'counterparty@example.com',
    });

    expect(result.success).toBe(false);
  });

  it('accepts a whole-room share, which is what nodeId: null means', () => {
    expect(createShareBodySchema.parse({ nodeId: null, mode: 'LINK' }).nodeId).toBeNull();
  });
});

/**
 * The query param issue 09 adds to `DELETE /shares/:shareId`. Assembled by our own
 * client, so it defaults rather than requiring every caller to spell out `false`.
 */
describe('cascadeQuerySchema', () => {
  it('defaults to false, so a caller that does not know about cascading does not cascade', () => {
    expect(cascadeQuerySchema.parse(undefined)).toBe(false);
  });

  it('parses the two values the client ever sends', () => {
    expect(cascadeQuerySchema.parse('true')).toBe(true);
    expect(cascadeQuerySchema.parse('false')).toBe(false);
  });

  it('rejects anything else rather than silently defaulting', () => {
    expect(cascadeQuerySchema.safeParse('1').success).toBe(false);
    expect(cascadeQuerySchema.safeParse('True').success).toBe(false);
  });
});

describe('shareSummarySchema', () => {
  const base = {
    id: '11111111-2222-4333-8444-555555555555',
    nodeId: null,
    mode: 'LINK' as const,
    role: 'VIEWER' as const,
    granteeEmail: null,
    expiresAt: null,
    createdAt: new Date().toISOString(),
  };

  it('parses a response with no nestedLiveGrantCount, so an older or non-computing caller is unaffected', () => {
    expect(shareSummarySchema.parse(base).nestedLiveGrantCount).toBeUndefined();
  });

  it('parses a response that does compute it', () => {
    expect(shareSummarySchema.parse({ ...base, nestedLiveGrantCount: 2 }).nestedLiveGrantCount).toBe(2);
  });
});
