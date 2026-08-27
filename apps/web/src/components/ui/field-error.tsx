import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Fixed-height slot for a single form control's validation message. Always rendered —
 * never conditionally mounted — so its height is reserved whether or not there is
 * currently an error, and the dialog around it never resizes when validation state
 * changes. `h-5` matches `text-sm`'s line-height (1.25rem) exactly; a message that
 * doesn't fit on one line is clipped with an ellipsis rather than pushing anything else,
 * since a rare over-length message is a better trade than the dialog jumping around.
 *
 * Requires a `min-w-0` on the nearest flex/grid ancestor (e.g. the `<form>` inside
 * `DialogContent`, which is a grid item): without it, the browser's automatic minimum
 * size for that ancestor is based on this element's un-truncated content width, and the
 * ancestor grows to fit instead of this element ever getting the chance to clip.
 */
function FieldError({ className, id, children, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      id={id}
      data-slot="field-error"
      className={cn('h-5 overflow-hidden truncate text-sm text-destructive', className)}
      {...props}
    >
      {children ?? ''}
    </p>
  );
}

export { FieldError };
