import { Skeleton } from '@/components/ui/skeleton';
import { SharedWithMeSection } from '@/features/share/shared-with-me-section';
import { useSharedWithMe } from '@/features/share/use-shared-with-me';

/**
 * `/shared` — the caller's "Shared with me" list, reachable directly from `AppShell`'s nav.
 * Unlike the old `home.tsx` branch this route replaces, there is no redirect fallback: this
 * route renders pending, error and empty states itself, since it is the destination now,
 * not a detour on the way to the caller's own room.
 */
export function SharedRoute() {
  const sharedWithMe = useSharedWithMe();

  if (sharedWithMe.isPending) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (sharedWithMe.isError) {
    return (
      <div className="mx-auto w-full max-w-2xl text-sm text-muted-foreground">
        Couldn't load what's been shared with you. Try reloading the page.
      </div>
    );
  }

  return <SharedWithMeSection entries={sharedWithMe.data} />;
}
