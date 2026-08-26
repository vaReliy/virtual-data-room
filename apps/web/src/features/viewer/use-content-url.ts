import { contentUrlResponseSchema, type ContentUrlResponse } from '@dr/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiFetch, isClientError } from '@/lib/api-client';
import { contentPath, type NodeSource } from '@/lib/node-source';
import { queryKeys } from '@/lib/query-keys';

/**
 * The presigned GET behind the preview — `{ url, expiresAt }` as JSON, not a redirect, so
 * the client reads the URL and puts it in the `src` itself.
 *
 * **`staleTime: 0` *and* `gcTime: 0`, and the second one is the one that matters**
 * (decision #15). The URL lives 300 seconds. `staleTime: 0` alone would still leave it
 * *retained* after the preview unmounts, so coming back to the file inside the default
 * `gcTime` renders the cached URL into the frame instantly — and if those 300 seconds have
 * passed, what the reader sees is the storage provider's XML error document, inside the
 * app, looking like the file is corrupt. `gcTime: 0` drops it as soon as nothing is
 * watching, so every visit starts from a fresh request.
 *
 * The app-wide `staleTime: 30_000` in `main.tsx` is exactly what is being overridden here.
 *
 * `refetchOnWindowFocus` is off for this one query, against the app-wide default. The
 * `<iframe>` only needs a valid URL at the moment it loads; replacing `src` while someone
 * is reading page 12 would reload the document and lose their place.
 *
 * A 4xx is never retried: `404` and `410` are settled answers with screens of their own.
 */
export function useContentUrl(
  source: NodeSource,
  nodeId: string,
): UseQueryResult<ContentUrlResponse, Error> {
  return useQuery({
    queryKey: queryKeys.content(source, nodeId),
    queryFn: () => apiFetch(contentPath(source, nodeId), contentUrlResponseSchema),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => !isClientError(error) && failureCount < 2,
  });
}
