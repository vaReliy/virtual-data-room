import { meResponseSchema, type MeResponse } from '@dr/contracts';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { ApiError, apiFetch, apiNoContent, isClientError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * The session subject and the Data Rooms they own, in one call (decision #13): the
 * authenticated shell renders both on every load, so splitting them would produce a
 * waterfall on every navigation.
 *
 * A 401 is not retried. It is the ordinary "not signed in" answer, not a transient
 * failure, and retrying it delays the login screen by several seconds for every
 * first-time visitor.
 */
export function useSession(): UseQueryResult<MeResponse, Error> {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: () => apiFetch('/api/me', meResponseSchema),
    retry: (failureCount, error) => !isClientError(error) && failureCount < 2,
  });
}

/** `true` when the query failed specifically because nobody is signed in. */
export function isUnauthenticated(error: Error | null): boolean {
  return error instanceof ApiError && error.status === 401;
}

/**
 * Logout is a single `POST`; the cookie is cleared server-side and the token is
 * stateless (decision #14). The cache is reset rather than invalidated, so no stale
 * room data can flash on screen before the redirect lands.
 */
export function useLogout(): { logout: () => void; isPending: boolean } {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => apiNoContent('/api/auth/logout'),
    onSettled: () => {
      queryClient.clear();
      // A full document load, not a client-side navigation: it guarantees no component
      // is still holding session-derived state from the signed-in render.
      window.location.assign('/login');
    },
  });
  return {
    logout: () => {
      mutation.mutate();
    },
    isPending: mutation.isPending,
  };
}
