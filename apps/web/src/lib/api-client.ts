import type { ZodType } from 'zod';

/**
 * An API response that was not 2xx. The status is carried deliberately: the error
 * contract in `architecture.md` gives distinct meanings to 404, 409, 410 and 422, and
 * each one renders a different screen. Collapsing them into a generic failure is the
 * mistake this class exists to prevent.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The API is not reachable at all — offline, dev server down, proxy misconfigured. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('The server could not be reached.');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

/** Nest's default error body. Only `message` is read, and only as a fallback. */
function extractMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  }
  return fallback;
}

/**
 * Every call is same-origin and relative: the SPA and `/api/*` share one origin both
 * locally (Vite's proxy) and in production (the Vercel rewrite), which is what makes the
 * session cookie first-party. There is deliberately no configurable API base URL —
 * introducing one would reintroduce the cross-site cookie problem decision #10 removes.
 *
 * The response is parsed with the same Zod schema the API is typed against, so a
 * contract drift surfaces here rather than as `undefined` deep inside a component.
 */
export async function apiFetch<T>(
  path: `/api/${string}`,
  schema: ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...init?.headers },
    });
  } catch (cause) {
    throw new NetworkError(cause);
  }

  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, extractMessage(body, response.statusText));
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // A 200 whose shape is wrong is a bug, not a user-facing state. Fail loudly.
    throw new ApiError(response.status, `Unexpected response shape for ${path}.`);
  }
  return parsed.data;
}

/** `POST /api/auth/logout` replies 204 with no body, so it bypasses `apiFetch`. */
export async function apiPostNoContent(path: `/api/${string}`): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', credentials: 'same-origin' });
  } catch (cause) {
    throw new NetworkError(cause);
  }
  if (!response.ok) throw new ApiError(response.status, response.statusText);
}
