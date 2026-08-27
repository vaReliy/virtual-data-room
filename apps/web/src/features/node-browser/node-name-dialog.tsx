import { useState, type FormEvent } from 'react';
import { nodeNameSchema } from '@dr/contracts';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, NetworkError } from '@/lib/api-client';

/**
 * Turns a failed submit into the right piece of UI. The three statuses below are three
 * different situations, and the error contract exists so that they do not collapse into
 * one "something went wrong":
 *
 * - `409` — the name is taken. The dialog **stays open** with the field selected, so the
 *   next keystroke replaces the name: rename or cancel, and no suffix is invented for the
 *   user (decision #20).
 * - `422` — the server rejected the string. The same `nodeNameSchema` runs on this side,
 *   so it should be unreachable; when it is not, it is a field problem and it belongs on
 *   the field rather than in a banner.
 * - anything else — a dialog-level message, because it is not about what was typed.
 */
function describeSubmitFailure(error: Error): { field: string | null; banner: string | null } {
  if (error instanceof NetworkError) {
    return { field: null, banner: 'The server could not be reached. Check your connection.' };
  }
  if (error instanceof ApiError) {
    if (error.status === 409) return { field: error.message, banner: null };
    if (error.status === 422) return { field: error.message, banner: null };
    if (error.status === 410) {
      return { field: null, banner: 'This item was deleted by the owner.' };
    }
    if (error.status === 404) return { field: null, banner: 'This item no longer exists.' };
    return { field: null, banner: error.message };
  }
  return { field: null, banner: error.message };
}

/**
 * The body of both the create and the rename dialog. It lives in its own component so
 * that Radix unmounting the closed dialog is what resets the typed name, the touched flag
 * and the last failure — a dialog reopened still showing the previous attempt's `409` is
 * the classic bug here, and there is no reset effect to forget.
 */
function NodeNameForm({
  description,
  submitLabel,
  initialName,
  onSubmit,
  onCancel,
}: {
  description: string;
  submitLabel: string;
  initialName: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);

  // The same schema the request body is validated against on the server, so the client
  // rejects exactly what the server rejects, for the same reasons. There is deliberately
  // no second, hand-written rule sitting next to it.
  const parsed = nodeNameSchema.safeParse(value);
  const described = failure ? describeSubmitFailure(failure) : null;

  // Shown as soon as there is something wrong with something typed — not only on blur.
  // The submit button disables itself on an invalid name, and a disabled button with no
  // stated reason reads as a broken dialog. An *empty* field is the one case left alone
  // until blur or submit: nagging someone for not having typed yet is noise, not help.
  const showValidation = touched || value.trim().length > 0;
  const fieldError =
    described?.field ??
    (showValidation && !parsed.success ? parsed.error.issues[0]?.message : null);

  // Unchanged is not a submit: on rename it would be a request whose only possible
  // outcomes are a no-op `200` and a `409` against the row itself.
  const unchanged = parsed.success && parsed.data === initialName;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!parsed.success || pending) return;

    setPending(true);
    setFailure(null);
    try {
      await onSubmit(parsed.data);
    } catch (error) {
      setFailure(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      noValidate
      className="min-w-0"
    >
      <DialogHeader>
        <DialogTitle>{submitLabel}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className="my-5 space-y-2">
        <Label htmlFor="node-name">Name</Label>
        <Input
          id="node-name"
          value={value}
          autoFocus
          // Selected rather than merely focused: after a 409 the whole point is that the
          // next keystroke replaces the name that was taken.
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setValue(event.target.value);
            // The server's verdict was about the previous string, not this one.
            setFailure(null);
          }}
          onBlur={() => {
            setTouched(true);
          }}
          aria-invalid={fieldError !== null}
          aria-describedby={fieldError ? 'node-name-error' : undefined}
          disabled={pending}
        />
        <FieldError id="node-name-error">{fieldError}</FieldError>
      </div>

      {described?.banner ? (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {described.banner}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !parsed.success || unchanged}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * One dialog for both create and rename. They differ only in their wording and their
 * starting value, and every state that matters — validation, `409`, `422` — is identical,
 * so writing them twice would mean maintaining the conflict flow twice.
 */
export function NodeNameDialog({
  open,
  onOpenChange,
  description,
  submitLabel,
  initialName = '',
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  description: string;
  submitLabel: string;
  initialName?: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <NodeNameForm
          description={description}
          submitLabel={submitLabel}
          initialName={initialName}
          onSubmit={async (name) => {
            await onSubmit(name);
            onOpenChange(false);
          }}
          onCancel={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
