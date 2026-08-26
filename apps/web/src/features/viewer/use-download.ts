import { useState } from 'react';
import { contentUrlResponseSchema, type NodeSummary } from '@dr/contracts';

import { ApiError, apiFetch } from '@/lib/api-client';

/**
 * The same endpoint the preview reads, with the one parameter that turns it into a save.
 * `attachment` is written into the signature by the server; it is not a request header the
 * browser could add afterwards.
 */
function downloadPath(roomId: string, nodeId: string): `/api/${string}` {
  return `/api/rooms/${roomId}/nodes/${nodeId}/content?disposition=attachment`;
}

/**
 * Asks for a presigned GET signed `attachment` and navigates to it.
 *
 * **Deliberately not a `useQuery`.** The preview's URL is cached with `gcTime: 0` precisely
 * so a dead link is never handed back (decision #15), and a download needs the same
 * freshness for a stronger reason: the URL must be signed *at click time* and the
 * preview's is signed `inline`, which no client-side attribute can override — `<a download>`
 * is ignored cross-origin. So this is a plain fetch on an event, with no cache entry to go
 * stale and no key to invalidate.
 *
 * The navigation is `location.assign` rather than an anchor or a new tab: the response
 * carries `Content-Disposition: attachment`, so the browser saves it and leaves the page
 * exactly where it was. A `_blank` tab would flash open and close instead.
 */
export function useDownload(roomId: string): {
  /** Fire-and-forget: failures land in `failure`, not in a rejected promise. */
  download: (node: Pick<NodeSummary, 'id' | 'name'>) => void;
  /** The id currently being signed, so the row that was clicked can say so. */
  pendingId: string | null;
  failure: string | null;
  dismissFailure: () => void;
} {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  function download(node: Pick<NodeSummary, 'id' | 'name'>): void {
    setFailure(null);
    setPendingId(node.id);
    apiFetch(downloadPath(roomId, node.id), contentUrlResponseSchema)
      .then(({ url }) => {
        window.location.assign(url);
      })
      .catch((error: unknown) => {
        setFailure(describeFailure(node.name, error));
      })
      .finally(() => {
        setPendingId((current) => (current === node.id ? null : current));
      });
  }

  return {
    download,
    pendingId,
    failure,
    dismissFailure: () => {
      setFailure(null);
    },
  };
}

/**
 * The error contract's statuses, kept apart in the wording.
 *
 * `404` and `410` are different states with different screens everywhere else in this app,
 * and a download has no screen of its own to route to — so the distinction survives in the
 * sentence instead. "Something went wrong" would erase the one thing the reader can act on:
 * a deleted file is gone for good, a file that moved out of scope may simply need the
 * listing refreshed.
 */
function describeFailure(name: string, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return `“${name}” is no longer available here.`;
    if (error.status === 410) return `“${name}” has been deleted and cannot be downloaded.`;
    if (error.status === 422) return `“${name}” has no content to download.`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return `“${name}” could not be downloaded. ${message}`;
}
