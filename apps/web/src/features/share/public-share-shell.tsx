import type { ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * The frame a share link renders inside — `AppShell` with everything that assumes an
 * account taken out, rather than `AppShell` with those things left empty.
 *
 * Two deliberate absences:
 *
 * - **No avatar, no name, no "Sign out".** There is no session to describe. Rendering the
 *   controls in a disabled or blank state would suggest one had failed to load.
 * - **No breadcrumb above the share.** Everything this visitor may reach is below the
 *   shared node, and the trail inside already stops exactly there, clipped server-side.
 *
 * **The wordmark is a link to `/`, and the distinction it rests on is worth stating.** What
 * this surface must not offer is a *remedy* — a "Sign in to view this" beside a dead link,
 * which promises that an account grants access when the token is the authorization and an
 * account has nothing to do with it. A wordmark is not a remedy; it is the ordinary "go to
 * the application" gesture, and without it a reader who *does* have an account — most
 * counterparties in a due-diligence thread do — is stranded on a page with no way into
 * their own room.
 *
 * No branch on session state is needed for that, and deliberately none is written: `/` is
 * a resolver, so a signed-in visitor lands in their own Data Room and an anonymous one is
 * sent to `/login` by `SessionGate` — the same thing that happens to any address in this
 * app. The redirect is a consequence of where they clicked to, not a claim about this
 * document.
 *
 * What the frame keeps is the geometry: the same header height and the same `main`
 * padding, so a shared folder is the app rather than a second, thinner application.
 */
export function PublicShareShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4 sm:px-6">
        <Link
          to="/"
          className="text-sm font-semibold tracking-tight underline-offset-4 hover:underline"
        >
          Virtual Data Room
        </Link>
        <span className="text-xs text-muted-foreground">Shared with you</span>
      </header>
      <main className="flex-1 overflow-auto px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
