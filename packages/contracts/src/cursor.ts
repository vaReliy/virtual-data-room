import { z } from 'zod';
import { nodeTypeSchema } from './primitives';

/**
 * A keyset position in a folder listing.
 *
 * The sort key is `(type, lower(name))` — the same pair the listing index and the
 * case-insensitive uniqueness index are built on. Sorting on one key and paginating on
 * another is what drops or duplicates a row at a page boundary, so the cursor carries
 * `lower(name)` and never the raw `name`.
 */
export const cursorPositionSchema = z.object({
  type: nodeTypeSchema,
  lowerName: z.string().min(1),
});
export type CursorPosition = z.infer<typeof cursorPositionSchema>;

/**
 * The cursor is opaque (decision #13): a keyset position is not public API. Encoding it
 * stops clients constructing one by hand and lets the sort key change without breaking
 * the contract.
 *
 * `btoa` / `atob` rather than `Buffer`, because this package is compiled into the browser
 * bundle as well as the API.
 */
function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

export function encodeCursor(position: CursorPosition): string {
  const { type, lowerName } = cursorPositionSchema.parse(position);
  return toBase64Url(JSON.stringify([type, lowerName]));
}

/**
 * Returns `null` for anything that is not a cursor this API issued. The cursor is opaque,
 * so a malformed one is client tampering rather than a recoverable state — the caller
 * turns `null` into a `400`.
 */
export function decodeCursor(cursor: string): CursorPosition | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(fromBase64Url(cursor));
  } catch {
    return null;
  }
  if (!Array.isArray(decoded) || decoded.length !== 2) return null;

  // `Array.isArray` narrows to `any[]`, so the pair is re-typed as unknown before it
  // reaches the schema — the whole point being that this input is not trusted.
  const [type, lowerName] = decoded as readonly unknown[];
  const parsed = cursorPositionSchema.safeParse({ type, lowerName });
  return parsed.success ? parsed.data : null;
}
