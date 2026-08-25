import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError, NetworkError } from '@/lib/api-client';

/**
 * The shared failure surface. It deliberately reads the status rather than printing
 * whatever the server said: per the error contract, 404, 410 and 422 are distinct
 * product states, and a generic "something went wrong" would erase the distinction the
 * backend went out of its way to preserve.
 */
function describe(error: Error): { title: string; detail: string } {
  if (error instanceof NetworkError) {
    return {
      title: 'Cannot reach the server',
      detail: 'Check your connection and try again.',
    };
  }
  if (error instanceof ApiError) {
    // 502/503/504 never come from the API itself — they come from whatever sits in
    // front of it: Vite's proxy locally, the Vercel rewrite in production. To the user
    // that is the same situation as being offline, and "Bad Gateway" is not a sentence
    // anyone can act on.
    if (error.status === 502 || error.status === 503 || error.status === 504) {
      return {
        title: 'Cannot reach the server',
        detail: 'The service is not responding. Please try again in a moment.',
      };
    }
    switch (error.status) {
      case 404:
        return {
          title: 'Not found',
          detail: 'This item does not exist, or is not shared with you.',
        };
      case 410:
        return { title: 'No longer available', detail: 'This item was deleted by its owner.' };
      default:
        return { title: 'Something went wrong', detail: error.message };
    }
  }
  return { title: 'Something went wrong', detail: error.message };
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const { title, detail } = describe(error);
  return (
    <Alert variant="destructive" className="mx-auto max-w-md">
      <AlertTriangle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{detail}</AlertDescription>
      {onRetry ? (
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </Alert>
  );
}
