import { Link } from 'react-router';

import { Button } from '@/components/ui/button';

/** An unknown URL inside the SPA. Distinct from a 404 from the API, which the error
 *  contract renders through `ErrorState`. */
export function NotFoundRoute() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div>
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">This address does not match anything here.</p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link to="/">Go to your Data Room</Link>
      </Button>
    </div>
  );
}
