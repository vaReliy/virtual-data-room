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

/** What to revoke, and whether to take everything nested beneath it (issue 09) with it. */
export interface RevokeShareInput {
  shareId: string;
  cascade?: boolean;
}

/**
 * Revokes one share, or — with `cascade: true` — that share plus every other live `USER`
 * grant the same grantee holds strictly beneath it (issue 09). A `410` means someone else
 * (another tab, another click) already revoked it — the outcome the caller wanted already
 * holds, so it is folded into success rather than surfaced as a failure to react to.
 *
 * Exposed as a plain `mutateAsync({ shareId, cascade })` so the confirmation dialog can
 * wrap this exact call without reimplementing it.
 */
export function useRevokeShare(roomId: string, nodeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, RevokeShareInput>({
    mutationFn: async ({ shareId, cascade }) => {
      const query = cascade ? '?cascade=true' : '';
      try {
        await apiNoContent(`/api/rooms/${roomId}/shares/${shareId}${query}`, 'DELETE');
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
