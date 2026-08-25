import { Navigate, useSearchParams } from 'react-router';
import { AlertTriangle, ShieldCheck } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AppShellSkeleton } from '@/features/session/app-shell';
import { isUnauthenticated, useSession } from '@/features/session/use-session';
import { ErrorState } from '@/features/session/error-state';

/**
 * Sign-in is a plain link, not a fetch. The OAuth flow is a sequence of top-level
 * redirects ending at a `Set-Cookie` on the callback response, so the browser has to
 * own the navigation — an XHR would follow the redirects invisibly and land the cookie
 * on a response the SPA then throws away.
 */
const GOOGLE_LOGIN_URL = '/api/auth/google';

export function LoginRoute() {
  const [params] = useSearchParams();
  const session = useSession();

  // The API redirects here with `?error=google` when the provider hands back no profile.
  const providerFailed = params.get('error') === 'google';

  if (session.isPending) return <AppShellSkeleton />;

  // Already signed in — the login screen is not somewhere to sit.
  if (session.isSuccess) return <Navigate to="/" replace />;

  const unexpectedError =
    session.isError && !isUnauthenticated(session.error) ? session.error : null;

  return (
    <div className="flex h-full items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-sm space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Virtual Data Room</CardTitle>
            <CardDescription>
              A secure repository for storing and sharing documents during due diligence.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {providerFailed ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Sign-in did not complete</AlertTitle>
                <AlertDescription>
                  Google did not return an account. Please try again.
                </AlertDescription>
              </Alert>
            ) : null}

            {unexpectedError ? <ErrorState error={unexpectedError} /> : null}

            <Button asChild size="lg" className="w-full">
              <a href={GOOGLE_LOGIN_URL}>Continue with Google</a>
            </Button>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Google is the only sign-in method. Your Data Rooms are private until you share them.
              </span>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
