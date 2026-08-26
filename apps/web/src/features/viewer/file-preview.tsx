import { Download, ExternalLink } from 'lucide-react';
import type { Breadcrumb, NodeSummary } from '@dr/contracts';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { InlineFailure } from '@/features/node-browser/inline-failure';
import { NodeBreadcrumbs } from '@/features/node-browser/node-breadcrumbs';
import { ErrorState } from '@/features/session/error-state';
import { formatBytes, formatTimestamp } from '@/lib/formatters';
import { useContentUrl } from './use-content-url';
import { useDownload } from './use-download';

/**
 * The file preview: an `<iframe>` pointed at a short-lived presigned GET (decision #15).
 *
 * **No PDF library.** `react-pdf` is on the stretch list, and the browser's own viewer will
 * look primitive next to it — that is the accepted trade, not an omission. What makes the
 * frame work at all is on the other side of the wire: the presigned GET carries
 * `response-content-type=application/pdf` and `response-content-disposition: inline`, and
 * without `inline` every browser downloads the file instead of rendering it.
 *
 * **The file's extension is never consulted.** Object keys are UUIDs and the content type is
 * pinned by the presigned GET, so a file named `contract.txt` renders as the PDF it is.
 * Branching on the name would be branching on a label the storage layer does not read.
 *
 * There are no rename/move/delete controls here on purpose: they live on the row in the
 * folder that contains the file, where they are type-agnostic and already built, rather
 * than being wired a second time on a screen whose job is to show the document.
 */
export function FilePreview({
  roomId,
  node,
  breadcrumbs,
  rootLabel,
}: {
  roomId: string;
  node: NodeSummary;
  breadcrumbs: Breadcrumb[];
  rootLabel: string;
}) {
  const content = useContentUrl(roomId, node.id);
  const downloads = useDownload(roomId);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="space-y-2">
        <NodeBreadcrumbs
          roomId={roomId}
          rootLabel={rootLabel}
          trail={breadcrumbs}
          current={node.name}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{node.name}</h1>
            <p className="text-sm text-muted-foreground">
              {formatBytes(node.size)} · updated {formatTimestamp(node.updatedAt)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/*
              Always offered, even while the preview is still loading or has failed: the
              download does not reuse the preview's URL and does not depend on it. That URL
              was signed `inline`, and disposition is chosen at signing time — so this
              button fetches its own, signed `attachment`.
            */}
            <Button
              size="sm"
              variant="outline"
              disabled={downloads.pendingId === node.id}
              onClick={() => {
                downloads.download(node);
              }}
            >
              <Download />
              {downloads.pendingId === node.id ? 'Preparing…' : 'Download'}
            </Button>
            {content.data ? (
              <Button asChild size="sm" variant="outline">
                {/*
                  `noreferrer` matters more than usual: the URL *is* the capability for the
                  next 300 seconds, and it must not travel to another site in a `Referer`.
                */}
                <a href={content.data.url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open in a new tab
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {downloads.failure ? (
        <InlineFailure message={downloads.failure} onDismiss={downloads.dismissFailure} />
      ) : null}

      {content.isPending ? (
        <Skeleton className="h-[70vh] w-full rounded-lg" />
      ) : content.isError ? (
        <ErrorState
          error={content.error}
          onRetry={() => {
            void content.refetch();
          }}
        />
      ) : (
        <div className="space-y-2">
          <iframe
            // Keyed on the URL so that a refetched link actually reloads the frame; a
            // changed `src` alone is not something every browser reliably acts on.
            key={content.data.url}
            src={content.data.url}
            title={node.name}
            className="h-[70vh] w-full rounded-lg border bg-muted"
          />
          {/*
            The fallback for a browser with no built-in PDF viewer, which renders the frame
            as a blank rectangle rather than reporting anything a `load` handler could see.
          */}
          <p className="text-xs text-muted-foreground">
            If the document does not appear, your browser may not display PDFs inline — open it in a
            new tab instead. The link expires a few minutes after this page opens; reload the page
            for a fresh one.
          </p>
        </div>
      )}
    </div>
  );
}
