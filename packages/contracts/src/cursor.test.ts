import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor';

describe('cursor codec', () => {
  it('round-trips a keyset position', () => {
    const position = { type: 'FOLDER', lowerName: 'due diligence' } as const;
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
  });

  it('survives names that are not ASCII', () => {
    // Folder names are user input; the codec must not assume latin1.
    const position = { type: 'FILE', lowerName: 'угода.pdf' } as const;
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
  });

  it('is opaque: the encoding is not the raw name', () => {
    const cursor = encodeCursor({ type: 'FILE', lowerName: 'contract.pdf' });
    expect(cursor).not.toContain('contract.pdf');
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects anything it did not issue rather than guessing', () => {
    // A malformed cursor is client tampering, so the caller gets null and returns 400.
    expect(decodeCursor('not-base64!!')).toBeNull();
    expect(decodeCursor(btoa('{}'))).toBeNull();
    expect(decodeCursor(btoa('["NOPE","x"]'))).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });
});
