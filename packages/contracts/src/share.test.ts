import { describe, expect, it } from 'vitest';

import { createShareBodySchema } from './share';

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
