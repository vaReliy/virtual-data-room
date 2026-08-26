import { z } from 'zod';
import { shareSummarySchema, type ShareSummary } from '@dr/contracts';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { ApiError, apiFetch, apiNoContent } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

const shareListSchema = z.array(shareSummarySchema);

function sharesPath(roomId: string, nodeId: string | null): `/api/${string}` {
  return nodeId
    ? `/api/rooms/${roomId}/shares?nodeId=${nodeId}`
    : `/api/rooms/${roomId}/shares`;
}

/**
 * The live shares on one node — or, with `nodeId: null`, on the whole Data Room. Owner-only,
 * same as the endpoint it calls.
 */
export function useShares(roomId: string, nodeId: string | null): UseQueryResult<ShareSummary[], Error> {
  return useQuery({
    queryKey: queryKeys.shares(roomId, nodeId),
    queryFn: () => apiFetch(sharesPath(roomId, nodeId), shareListSchema),
  });
}

/**
 * Revokes one share. A `410` means someone else (another tab, another click) already
 * revoked it — the outcome the caller wanted already holds, so it is folded into success
 * rather than surfaced as a failure to react to.
 *
 * Exposed as a plain `mutateAsync(shareId)` so issue 09 can wrap this exact call in a
 * confirmation without reimplementing it.
 */
export function useRevokeShare(roomId: string, nodeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (shareId) => {
      try {
        await apiNoContent(`/api/rooms/${roomId}/shares/${shareId}`, 'DELETE');
      } catch (error) {
        if (error instanceof ApiError && error.status === 410) return;
        throw error;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.shares(roomId, nodeId) });
    },
  });
}
