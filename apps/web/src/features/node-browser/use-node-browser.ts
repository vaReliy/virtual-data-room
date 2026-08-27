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
import { browsePath, moveNodePath, nodeMutationPath, type NodeSource } from '@/lib/node-source';
import { queryKeys } from '@/lib/query-keys';

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
 *
 * **`source` rather than a room id**, so that the same query serves a signed-in reader and
 * a link recipient (`node-source.ts`). It decides the path and the cache key together; a
 * second copy of this hook for the public surface is how the two would drift apart, and
 * it would also mean implementing Phase 4.1's `?sort=` twice.
 */
export function useBrowse(source: NodeSource, nodeId?: string): BrowseQuery {
  return useInfiniteQuery({
    queryKey: queryKeys.browse(source, nodeId),
    queryFn: ({ pageParam }) =>
      apiFetch(browsePath(source, nodeId, pageParam ?? undefined), browseResponseSchema),
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
function useInvalidateBrowse(source: NodeSource, nodeId?: string): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.browse(source, nodeId) });
  };
}

/**
 * Creates a folder in the location currently on screen. `parentId` is `null` at the room
 * root — the API reads that as the caller's scope root, which is not always the room's
 * (a subtree share resolves elsewhere), so the client never tries to name it itself.
 *
 * **The four mutations below take a `source` they can only ever be given a room for.** A
 * link recipient resolves to a `VIEWER` scope, so every control that reaches them is
 * hidden on `role` and the service would answer `404` anyway; the path builders throw
 * before a request leaves the browser rather than sending a token somewhere it does not
 * belong (`node-source.ts`).
 */
export function useCreateFolder(source: NodeSource, nodeId?: string) {
  const invalidate = useInvalidateBrowse(source, nodeId);
  return useMutation<NodeSummary, Error, string>({
    mutationFn: (name) =>
      apiSend(browsePath(source), nodeSummarySchema, 'POST', { parentId: nodeId ?? null, name }),
    onSuccess: invalidate,
  });
}

/** Renames a child of the location on screen. `409` reaches the dialog with its status. */
export function useRenameNode(source: NodeSource, nodeId?: string) {
  const invalidate = useInvalidateBrowse(source, nodeId);
  return useMutation<NodeSummary, Error, { id: string; name: string }>({
    mutationFn: ({ id, name }) =>
      apiSend(nodeMutationPath(source, id), nodeSummarySchema, 'PATCH', { name }),
    onSuccess: invalidate,
  });
}

/**
 * Moves a node into another folder — `POST /:nodeId/move`, a sub-resource rather than a
 * field on `PATCH`, so that "move to the room root" (`parentId: null`) cannot be confused
 * with "the client did not send a parent".
 *
 * **Two keys are invalidated, not one.** A move changes the listing the node left *and* the
 * listing it arrived in, along with the aggregates of both folders. Every other mutation on
 * this screen touches one location; this is the only one that touches two.
 *
 * `409` reaches the caller with its status: the destination already holds that name, and
 * move deliberately does not auto-suffix (decision #20) — the user chose the destination
 * knowing what was in it.
 */
export function useMoveNode(source: NodeSource, nodeId?: string) {
  const queryClient = useQueryClient();
  return useMutation<NodeSummary, Error, { id: string; parentId: string | null }>({
    mutationFn: ({ id, parentId }) =>
      apiSend(moveNodePath(source, id), nodeSummarySchema, 'POST', { parentId }),
    onSuccess: async (_node, { parentId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.browse(source, nodeId) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.browse(source, parentId ?? undefined),
        }),
      ]);
    },
  });
}

/**
 * Soft-deletes a child and its whole subtree. `204`, so there is nothing to parse: the
 * warning the user just confirmed was rendered from the folder's own aggregates, which
 * the invalidation then refreshes along with the row disappearing.
 */
export function useDeleteNode(source: NodeSource, nodeId?: string) {
  const invalidate = useInvalidateBrowse(source, nodeId);
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiNoContent(nodeMutationPath(source, id), 'DELETE'),
    onSuccess: invalidate,
  });
}
