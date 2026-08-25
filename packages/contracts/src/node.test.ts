import { describe, expect, it } from 'vitest';
import { nodeNameSchema } from './node';

describe('nodeNameSchema', () => {
  it('trims before measuring, so surrounding space never reaches the uniqueness index', () => {
    // '"Legal "' and '"Legal"' must not be two rows: lower(name) is the uniqueness
    // domain, and it does not normalize whitespace.
    expect(nodeNameSchema.parse('  Legal  ')).toBe('Legal');
  });

  it('rejects a name that is only whitespace', () => {
    // 422, not a silent no-op: the trimmed name is empty.
    expect(nodeNameSchema.safeParse('   ').success).toBe(false);
  });

  it('measures length after trimming', () => {
    expect(nodeNameSchema.safeParse(` ${'a'.repeat(255)} `).success).toBe(true);
    expect(nodeNameSchema.safeParse('a'.repeat(256)).success).toBe(false);
  });

  it('rejects separators and control characters', () => {
    expect(nodeNameSchema.safeParse('Legal/Contracts').success).toBe(false);
    expect(nodeNameSchema.safeParse('Legal\u0000Contracts').success).toBe(false);
    expect(nodeNameSchema.safeParse('Legal\tContracts').success).toBe(false);
  });

  it('rejects the two traversal names', () => {
    expect(nodeNameSchema.safeParse('.').success).toBe(false);
    expect(nodeNameSchema.safeParse('..').success).toBe(false);
    // A leading dot is fine — only the two names themselves are reserved.
    expect(nodeNameSchema.safeParse('.hidden').success).toBe(true);
  });

  it('preserves case, because uniqueness is on lower(name) and display is not', () => {
    expect(nodeNameSchema.parse('Due Diligence')).toBe('Due Diligence');
  });
});
