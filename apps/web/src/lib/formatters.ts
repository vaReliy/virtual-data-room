const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Sizes cross the wire as `number` (see `byteSizeSchema`), so this never sees a BigInt.
 * Binary steps with decimal labels, which is what Drive, Dropbox and Finder all show.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${BYTE_UNITS[unit] ?? 'B'}`;
}

/** `1 file` / `2 files`. Trivial, but it is written once rather than at each call site. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

/**
 * `updatedAt` crosses the wire as an ISO 8601 string. Rendered in the reader's own
 * locale and timezone rather than a fixed one: a due-diligence reader is very often in a
 * different country from the owner who uploaded the document.
 */
export function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
