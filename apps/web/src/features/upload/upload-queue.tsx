import { AlertCircle, CheckCircle2, CircleSlash, FileUp, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/formatters';
import type { UploadItem, UploadQueue } from './use-upload-queue';

/**
 * The one line under a row that says which of the five states it is in. Every state has
 * wording of its own: a queue that renders four of them as "…" is a queue the user cannot
 * read while it is doing the only thing they are watching it for.
 */
function statusLine(item: UploadItem): string {
  switch (item.status) {
    case 'pending':
      return `${formatBytes(item.size)} · waiting`;
    case 'uploading':
      return item.progress >= 1
        ? `${formatBytes(item.size)} · finishing`
        : `${formatBytes(item.size)} · ${String(Math.round(item.progress * 100))}%`;
    case 'complete':
      return `${formatBytes(item.size)} · uploaded`;
    case 'cancelled':
      return 'Cancelled';
    case 'error':
      return item.error ?? 'The upload failed.';
  }
}

function StatusIcon({ status }: { status: UploadItem['status'] }) {
  if (status === 'complete') return <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />;
  if (status === 'error') return <AlertCircle className="size-4 shrink-0 text-destructive" />;
  if (status === 'cancelled') {
    return <CircleSlash className="size-4 shrink-0 text-muted-foreground" />;
  }
  return <FileUp className="size-4 shrink-0 text-muted-foreground" />;
}

/**
 * The progress bar, as a plain element rather than a component from the library.
 *
 * `role="progressbar"` with the three `aria-value*` attributes is what makes it a progress
 * bar to a screen reader; the coloured `div` only makes it one to everyone else.
 */
function ProgressBar({ fraction, label }: { fraction: number; label: string }) {
  const percent = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={`Uploading ${label}`}
      className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-150"
        style={{ width: `${String(percent)}%` }}
      />
    </div>
  );
}

/**
 * The upload queue, above the table it is filling.
 *
 * It is deliberately not a toast: a toast stack cannot show ten simultaneous progress bars,
 * it dismisses itself while a transfer is still running, and a per-file `422` disappears
 * before it has been read. The queue stays until the user clears it.
 */
export function UploadQueuePanel({ queue }: { queue: UploadQueue }) {
  const { items, cancel, clearFinished } = queue;
  if (items.length === 0) return null;

  const settled = items.filter((item) => item.status !== 'pending' && item.status !== 'uploading');
  const remaining = items.length - settled.length;

  return (
    <section aria-label="Uploads" className="rounded-lg border">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <h2 className="text-sm font-medium">
          {remaining > 0
            ? `Uploading ${String(settled.length + 1)} of ${String(items.length)}`
            : `${String(items.length)} upload${items.length === 1 ? '' : 's'} finished`}
        </h2>
        {settled.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={clearFinished}>
            Clear finished
          </Button>
        ) : null}
      </header>

      <ul className="divide-y">
        {items.map((item) => {
          // Cancel stops being offered the moment the bytes are in storage: from there the
          // file is one call from existing, and a button that cannot do what it says is
          // worse than no button.
          const cancellable =
            item.status === 'pending' || (item.status === 'uploading' && item.progress < 1);
          return (
            <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
              <div className="pt-0.5">
                <StatusIcon status={item.status} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={item.name}>
                  {item.name}
                </p>
                <p
                  className={`text-xs ${
                    item.status === 'error' ? 'text-destructive' : 'text-muted-foreground'
                  }`}
                >
                  {statusLine(item)}
                </p>
                {item.status === 'uploading' ? (
                  <ProgressBar fraction={item.progress} label={item.name} />
                ) : null}
              </div>
              {cancellable ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Cancel upload of ${item.name}`}
                  onClick={() => {
                    cancel(item.id);
                  }}
                >
                  <X />
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
