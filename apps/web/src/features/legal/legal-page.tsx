import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Layout for the two public legal pages. They sit outside `SessionGate` on purpose:
 * Google's OAuth configuration requires the privacy policy and terms links to resolve
 * for a signed-out visitor, and a redirect to `/login` would not qualify.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto bg-muted/40">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-6">
          <Link to="/login">
            <ArrowLeft />
            Back to sign-in
          </Link>
        </Button>

        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">Last updated: {updated}</p>

        <div className="mt-8 space-y-8 text-sm leading-relaxed text-foreground">{children}</div>
      </div>
    </div>
  );
}

/** One numbered section of a legal document. */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{heading}</h2>
      {children}
    </section>
  );
}
