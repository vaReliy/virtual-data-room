import {
  browseResponseSchema,
  nodeSummarySchema,
  type BrowseResponse,
  type NodeSummary,
} from '@dr/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type UseInfiniteQueryResult,
  type InfiniteData,
} from '@tanstack/react-query';

import { apiFetch, apiNoContent, apiSend, isClientError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/** `undefined` is the room root, which has no node row to address. */
function browsePath(roomId: string, nodeId?: string, cursor?: string): `/api/${string}` {
  const base = `/api/rooms/${roomId}/nodes${nodeId === undefined ? '' : `/${nodeId}`}`;
  return (
    cursor === undefined ? base : `${base}?cursor=${encodeURIComponent(cursor)}`
  ) as `/api/${string}`;
}

function nodePath(roomId: string, nodeId: string): `/api/${string}` {
  return `/api/rooms/${roomId}/nodes/${nodeId}`;
}

export type BrowseQuery = UseInfiniteQueryResult<
  InfiniteData<BrowseResponse, string | null>,
  Error
>;

/**
 * One location's whole view, in one query (decision #24): the node itself, its clipped
 * breadcrumbs, one page of children, and — only at a whole-room scope root — the room.
 *
 * Paginated rather than merely fetched, because `nextCursor` is part of the contract and
 * a 51st folder that never appears is a worse bug than a "Load more" button. Every page
 * repeats `room`, `node` and `breadcrumbs`; the component reads those off the first page
 * and flattens only `children`.
 *
 * A 4xx is never retried. Each one here is a settled answer with its own screen — `404`
 * not found, `410` deleted — and retrying it three times just delays that screen.
 */
export function useBrowse(roomId: string, nodeId?: string): BrowseQuery {
  return useInfiniteQuery({
    queryKey: queryKeys.browse(roomId, nodeId),
    queryFn: ({ pageParam }) =>
      apiFetch(browsePath(roomId, nodeId, pageParam ?? undefined), browseResponseSchema),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    retry: (failureCount, error) => !isClientError(error) && failureCount < 2,
  });
}

/**
 * The one invalidation every mutation on this screen performs.
 *
 * Exactly one key, and deliberately **not** `queryKeys.session`: the aggregates the header
 * shows now arrive with the thing being viewed, so the header and the table are the same
 * query and refetch together. Invalidating the session query on a content mutation is the
 * coupling decision #24 removed.
 */
function useInvalidateBrowse(roomId: string, nodeId?: string): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.browse(roomId, nodeId) });
  };
}

/**
 * Creates a folder in the location currently on screen. `parentId` is `null` at the room
 * root — the API reads that as the caller's scope root, which is not always the room's
 * (a subtree share resolves elsewhere), so the client never tries to name it itself.
 */
export function useCreateFolder(roomId: string, nodeId?: string) {
  const invalidate = useInvalidateBrowse(roomId, nodeId);
  return useMutation<NodeSummary, Error, string>({
    mutationFn: (name) =>
      apiSend(browsePath(roomId), nodeSummarySchema, 'POST', { parentId: nodeId ?? null, name }),
    onSuccess: invalidate,
  });
}

/** Renames a child of the location on screen. `409` reaches the dialog with its status. */
export function useRenameNode(roomId: string, nodeId?: string) {
  const invalidate = useInvalidateBrowse(roomId, nodeId);
  return useMutation<NodeSummary, Error, { id: string; name: string }>({
    mutationFn: ({ id, name }) =>
      apiSend(nodePath(roomId, id), nodeSummarySchema, 'PATCH', { name }),
    onSuccess: invalidate,
  });
}

/**
 * Soft-deletes a child and its whole subtree. `204`, so there is nothing to parse: the
 * warning the user just confirmed was rendered from the folder's own aggregates, which
 * the invalidation then refreshes along with the row disappearing.
 */
export function useDeleteNode(roomId: string, nodeId?: string) {
  const invalidate = useInvalidateBrowse(roomId, nodeId);
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiNoContent(nodePath(roomId, id), 'DELETE'),
    onSuccess: invalidate,
  });
}
