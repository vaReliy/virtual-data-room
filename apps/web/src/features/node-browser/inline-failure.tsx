import { AlertTriangle } from 'lucide-react';

/**
 * The one inline failure surface, for the two operations that have nowhere else to report.
 *
 * A drag-and-drop move and a download both start from a row and finish with no dialog open
 * — the row may even be gone from the listing by then — so neither can render its failure
 * where it began. Everything else in the browser reports inside the dialog that started it.
 *
 * It is a shared component rather than two copies for a scheduled reason: Activity
 * (`phase-4.1/issues/06-activity.md`) removes this banner and takes both cases with it. A
 * second, separately invented surface would survive that deletion unnoticed.
 */
export function InlineFailure({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      // `alert` so a reader who is not looking at this part of the page is told: the
      // download they asked for produced no file and no other feedback.
      role="alert"
      className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1">{message}</p>
      <button type="button" className="underline underline-offset-4" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
