import { z } from 'zod';
import { sharedWithMeEntrySchema, type SharedWithMeEntry } from '@dr/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

const sharedWithMeListSchema = z.array(sharedWithMeEntrySchema);

/**
 * `GET /api/shares/shared-with-me` — one row per live grant held by the caller, across
 * rooms. Session-scoped, not room-scoped: nothing here invalidates it, since a grant is
 * created by someone else's action, not the caller's own.
 */
export function useSharedWithMe(): UseQueryResult<SharedWithMeEntry[], Error> {
  return useQuery({
    queryKey: queryKeys.sharedWithMe,
    queryFn: () => apiFetch('/api/shares/shared-with-me', sharedWithMeListSchema),
  });
}
