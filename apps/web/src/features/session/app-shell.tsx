import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { SessionUser } from '@dr/contracts';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSharedWithMe } from '@/features/share/use-shared-with-me';
import { useLogout } from './use-session';

/**
 * The one nav item between the wordmark and the user cluster. A list of one exists so
 * `AppShellSkeleton` renders a placeholder of the same shape without hand-copying
 * dimensions between the two components — the actual duplication risk here, since this
 * header is rendered exactly once, by `AppShell` itself.
 */
const NAV_ITEMS = [{ to: '/shared', label: 'Shared with me' }] as const;

function initials(user: SessionUser): string {
  const source = user.name ?? user.email;
  const letters = source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

/**
 * The frame every authenticated screen renders inside. It exists as its own component
 * so the loading skeleton below has the same geometry as the real thing — a shell that
 * appears only once data has arrived makes every load look like a layout jump.
 *
 * The wordmark links to `/`, which resolves to the caller's own Data Room (`home.tsx`).
 * `PublicShareShell` carries the same link for the same reason: a reader who followed a
 * share link into the app should not need the back button to reach their own room.
 */
export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const { logout, isPending } = useLogout();
  // Same query key as `SharedRoute`'s own `useSharedWithMe()` — TanStack Query dedupes it,
  // so mounting both here and on `/shared` is not a second request.
  const sharedWithMe = useSharedWithMe();

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4 sm:px-6">
        <Link
          to="/"
          className="text-sm font-semibold tracking-tight underline-offset-4 hover:underline"
        >
          Virtual Data Room
        </Link>
        <nav className="flex flex-1 items-center gap-4 text-sm">
          {NAV_ITEMS.map((item) => (
            <Link key={item.to} to={item.to} className="flex items-center gap-1.5 hover:underline">
              {item.label}
              {sharedWithMe.data ? (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">
                  {sharedWithMe.data.length}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <div className="text-sm leading-tight font-medium">{user.name ?? user.email}</div>
            {user.name ? (
              <div className="text-xs leading-tight text-muted-foreground">{user.email}</div>
            ) : null}
          </div>
          <Avatar className="size-8">
            {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
            <AvatarFallback>{initials(user)}</AvatarFallback>
          </Avatar>
          <Button variant="outline" size="sm" onClick={logout} disabled={isPending}>
            {isPending ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </header>
      <main className="flex-1 overflow-auto px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

/** The loading state of `AppShell`, matching its geometry so nothing shifts on arrival. */
export function AppShellSkeleton() {
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4 sm:px-6">
        <span className="text-sm font-semibold tracking-tight">Virtual Data Room</span>
        <nav className="flex flex-1 items-center gap-4 text-sm">
          {NAV_ITEMS.map((item) => (
            <Skeleton key={item.to} className="h-4 w-28" />
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Skeleton className="hidden h-4 w-32 sm:block" />
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-7 w-20" />
        </div>
      </header>
      <main className="flex-1 px-4 py-8 sm:px-6">
        <div className="mx-auto w-full max-w-4xl space-y-4">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-48 w-full" />
        </div>
      </main>
    </div>
  );
}
