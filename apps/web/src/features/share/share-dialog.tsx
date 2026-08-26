import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link as LinkIcon, Mail, Trash2 } from 'lucide-react';
import {
  createShareBodySchema,
  createShareResponseSchema,
  granteeEmailSchema,
  type CreateShareResponse,
  type ShareMode,
  type ShareSummary,
} from '@dr/contracts';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, NetworkError, apiSend } from '@/lib/api-client';
import { formatTimestamp } from '@/lib/formatters';
import { queryKeys } from '@/lib/query-keys';
import { useRevokeShare, useShares } from './use-shares';

/** What the dialog is about to share. `nodeId: null` is the whole Data Room. */
export type ShareTarget = { nodeId: string | null; name: string };

/**
 * Same three-way split as `node-name-dialog.tsx`'s `describeSubmitFailure`: a `409` never
 * applies here (a node can hold any number of shares), so only the generic statuses need a
 * dialog-level message. There is nothing field-shaped for the server to reject that the
 * client-side `createShareBodySchema` parse would not already have caught.
 */
function describeSubmitFailure(error: Error): string {
  if (error instanceof NetworkError) {
    return 'The server could not be reached. Check your connection.';
  }
  if (error instanceof ApiError) {
    if (error.status === 410) return 'This item was deleted by the owner.';
    if (error.status === 404) return 'This item no longer exists.';
    return error.message;
  }
  return error.message;
}

/**
 * Same three-way split as `delete-node-dialog.tsx`'s `describeFailure`: a `410` here means
 * the list itself could not be loaded (a `404`/`410` on the node the dialog is about), not
 * that one row was already revoked — that case is folded into success in `useRevokeShare`.
 */
function describeListFailure(error: Error): string {
  if (error instanceof NetworkError) {
    return 'The server could not be reached. Check your connection.';
  }
  if (error instanceof ApiError) {
    if (error.status === 410) return 'This item was deleted by the owner.';
    if (error.status === 404) return 'This item no longer exists.';
    return error.message;
  }
  return error.message;
}

/** One live share, and its revoke control. Never renders anything that looks like it could
 * reveal a `LINK` share's URL — the plaintext exists only in the moment it was created. */
function ShareRow({
  share,
  revoke,
}: {
  share: ShareSummary;
  revoke: (shareId: string) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const meta = [
    `Created ${formatTimestamp(share.createdAt)}`,
    share.expiresAt ? `Expires ${formatTimestamp(share.expiresAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  async function handleRevoke() {
    setPending(true);
    setFailure(null);
    try {
      await revoke(share.id);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="flex items-start gap-2 overflow-hidden">
        {share.mode === 'LINK' ? (
          <LinkIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        ) : (
          <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {share.mode === 'LINK' ? 'Anyone with the link' : share.granteeEmail}
          </p>
          <p className="text-xs text-muted-foreground">{meta}</p>
          {failure ? <p className="text-xs text-destructive">{failure}</p> : null}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={
          share.mode === 'LINK' ? 'Revoke this link' : `Revoke access for ${share.granteeEmail ?? ''}`
        }
        disabled={pending}
        onClick={() => {
          void handleRevoke();
        }}
      >
        <Trash2 className="text-destructive" />
      </Button>
    </li>
  );
}

/**
 * Who currently has access to `target`. Loading is a couple of skeleton rows — the dialog
 * is already open, so this is where the user is looking. Empty is the common case (most
 * nodes are not shared) and reads as a calm sentence, not an error.
 */
function ShareList({ roomId, nodeId }: { roomId: string; nodeId: string | null }) {
  const shares = useShares(roomId, nodeId);
  const revoke = useRevokeShare(roomId, nodeId);

  if (shares.isPending) {
    return (
      <div className="space-y-2 py-1">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (shares.isError) {
    return (
      <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {describeListFailure(shares.error)}
      </p>
    );
  }

  if (shares.data.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">No one has been given access yet.</p>;
  }

  return (
    <ul className="divide-y">
      {shares.data.map((share) => (
        <ShareRow key={share.id} share={share} revoke={revoke.mutateAsync} />
      ))}
    </ul>
  );
}

/**
 * Two `Button`s standing in for a radio group — there is no `radio-group` component in
 * this repository, and the CLI that would add one writes imports against the split
 * `@radix-ui/react-*` packages, which are not installed here (only the unified `radix-ui`
 * package is).
 */
function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: ShareMode;
  onChange: (mode: ShareMode) => void;
  disabled: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Share mode" className="grid grid-cols-2 gap-2">
      <Button
        type="button"
        role="radio"
        aria-checked={mode === 'LINK'}
        variant={mode === 'LINK' ? 'default' : 'outline'}
        disabled={disabled}
        onClick={() => {
          onChange('LINK');
        }}
      >
        Anyone with the link
      </Button>
      <Button
        type="button"
        role="radio"
        aria-checked={mode === 'USER'}
        variant={mode === 'USER' ? 'default' : 'outline'}
        disabled={disabled}
        onClick={() => {
          onChange('USER');
        }}
      >
        A specific person
      </Button>
    </div>
  );
}

/** A selectable, read-only field holding the one-time link, with a copy button. */
function CopyLinkField({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        value={url}
        aria-label="Share link"
        onFocus={(event) => {
          event.currentTarget.select();
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Copy link"
        onClick={() => {
          void navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 2000);
          });
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

/**
 * The create form. Local `useState` plus `schema.safeParse` on submit — the house pattern
 * `node-name-dialog.tsx` uses, because there is no form library in this repository
 * (decision #12's "the schema is the form resolver" is literal, not a package to add).
 *
 * The `expiresAt` date input yields `2026-09-01`, which is not the ISO datetime the
 * contract requires; it is converted to end-of-day before the parse so that "expires on
 * the 1st" still includes the 1st.
 */
function ShareForm({
  target,
  roomId,
  onCreated,
  onCancel,
}: {
  target: ShareTarget;
  roomId: string;
  onCreated: (response: CreateShareResponse) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<ShareMode>('LINK');
  const [granteeEmail, setGranteeEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);

  const emailParsed = mode === 'USER' ? granteeEmailSchema.safeParse(granteeEmail) : null;
  const showEmailError = mode === 'USER' && (touched || granteeEmail.trim().length > 0);
  const emailError =
    showEmailError && emailParsed && !emailParsed.success
      ? emailParsed.error.issues[0]?.message
      : null;
  const canSubmit = mode === 'LINK' || (emailParsed?.success ?? false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!canSubmit || pending) return;

    const parsed = createShareBodySchema.safeParse({
      nodeId: target.nodeId,
      mode,
      granteeEmail: mode === 'USER' ? granteeEmail : undefined,
      // End of day, not midnight, so a date typed as "today" is still live right now.
      expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
    });
    if (!parsed.success) {
      setFailure(new Error(parsed.error.issues[0]?.message ?? 'This share could not be created.'));
      return;
    }

    setPending(true);
    setFailure(null);
    try {
      const response = await apiSend(
        `/api/rooms/${roomId}/shares`,
        createShareResponseSchema,
        'POST',
        parsed.data,
      );
      onCreated(response);
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
    >
      <DialogHeader>
        <DialogTitle>
          {target.nodeId === null ? 'Share this Data Room' : `Share “${target.name}”`}
        </DialogTitle>
        <DialogDescription>
          Anyone with the link can open it, or invite one person by their email address.
        </DialogDescription>
      </DialogHeader>

      <div className="my-5 space-y-4">
        <ModeToggle mode={mode} onChange={setMode} disabled={pending} />

        {mode === 'USER' ? (
          <div className="space-y-2">
            <Label htmlFor="share-email">Email address</Label>
            <Input
              id="share-email"
              type="email"
              value={granteeEmail}
              autoFocus
              onChange={(event) => {
                setGranteeEmail(event.target.value);
                setFailure(null);
              }}
              onBlur={() => {
                setTouched(true);
              }}
              placeholder="name@example.com"
              aria-invalid={emailError !== null}
              aria-describedby={emailError ? 'share-email-error' : undefined}
              disabled={pending}
            />
            {emailError ? (
              <p id="share-email-error" className="text-sm text-destructive">
                {emailError}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="share-expiry">Expires (optional)</Label>
          <Input
            id="share-expiry"
            type="date"
            value={expiresAt}
            onChange={(event) => {
              setExpiresAt(event.target.value);
            }}
            disabled={pending}
          />
        </div>
      </div>

      {failure ? (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {describeSubmitFailure(failure)}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !canSubmit}>
          {pending ? 'Sharing…' : 'Create share'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * The result view. Reached only once, right after creation, because the token is stored
 * hashed and `shareSummarySchema` carries no field that could show it again — the dialog
 * has to say so here or the link is lost the moment this view is dismissed.
 */
function ShareResult({ result, onDone }: { result: CreateShareResponse; onDone: () => void }) {
  return (
    <div>
      <DialogHeader>
        <DialogTitle>Share created</DialogTitle>
        <DialogDescription>
          {result.mode === 'LINK'
            ? 'This link is shown here once and cannot be shown again. Replacing a lost link means revoking this one and creating another.'
            : 'This person can now sign in and open it:'}
        </DialogDescription>
      </DialogHeader>

      {result.mode === 'LINK' && result.url ? (
        <div className="my-5">
          <CopyLinkField url={result.url} />
        </div>
      ) : null}

      {result.mode === 'USER' && result.granteeEmail ? (
        <p className="my-5 rounded-md bg-muted px-3 py-3 text-center text-base font-semibold">
          {result.granteeEmail}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * Creates a share on a node, or on the whole Data Room (`target.nodeId === null`), in
 * either mode, and lists who already has access with a revoke control on each row
 * (`ShareList`).
 *
 * The dialog never closes itself on success: for a `LINK` share that would throw away the
 * one chance to copy the URL, and for consistency a `USER` share gets the same result step
 * rather than a silent close. The user dismisses it, through **one** path — `close()` below
 * — whether that is the "Done"/"Cancel" button or Radix's own `onOpenChange` (backdrop,
 * `Escape`, the corner close button). A version that reset `result` only inside Radix's
 * callback left it stale: setting `open` to `false` from a button's `onClick` changes the
 * `open` *prop*, which does not run through `onOpenChange` — Radix calls that only for its
 * own UI-driven close gestures — so the next share opened on a different node showed the
 * previous one's link.
 */
export function ShareDialog({
  target,
  roomId,
  open,
  onOpenChange,
}: {
  target: ShareTarget | null;
  roomId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [result, setResult] = useState<CreateShareResponse | null>(null);
  const queryClient = useQueryClient();

  function close() {
    setResult(null);
    onOpenChange(false);
  }

  if (!target) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {result ? (
          <ShareResult result={result} onDone={close} />
        ) : (
          <>
            <div className="space-y-1">
              <p className="text-sm font-medium">Who has access</p>
              <ShareList roomId={roomId} nodeId={target.nodeId} />
            </div>
            <div className="my-4 border-t" />
            <ShareForm
              key={target.nodeId ?? 'room'}
              target={target}
              roomId={roomId}
              onCreated={(response) => {
                setResult(response);
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.shares(roomId, target.nodeId),
                });
              }}
              onCancel={close}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
