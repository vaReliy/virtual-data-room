import { describe, expect, it } from 'vitest';
import { contentDispositionQuerySchema } from './upload';

describe('contentDispositionQuerySchema', () => {
  it('defaults to inline, so a caller written before download existed is unaffected', () => {
    expect(contentDispositionQuerySchema.parse(undefined)).toBe('inline');
  });

  it('accepts the two dispositions the presigned GET can be signed with', () => {
    expect(contentDispositionQuerySchema.parse('inline')).toBe('inline');
    expect(contentDispositionQuerySchema.parse('attachment')).toBe('attachment');
  });

  it('rejects an unknown value rather than falling back to the default', () => {
    // The parameter is assembled by our own client, so anything else is a typo in a
    // request we control — 400, not a download that silently opens a preview instead.
    expect(contentDispositionQuerySchema.safeParse('Attachment').success).toBe(false);
    expect(contentDispositionQuerySchema.safeParse('download').success).toBe(false);
    expect(contentDispositionQuerySchema.safeParse('').success).toBe(false);
  });
});
