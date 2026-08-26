import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { DATA_ROOM_QUOTA_BYTES, MAX_FILE_SIZE_BYTES, UPLOAD_MIME_TYPE } from '@dr/contracts';

import { Button } from '@/components/ui/button';
import { describeMegabytes } from './use-upload-queue';

/** The one line that states every limit, from the constants rather than from memory. */
export function uploadLimitsHint(): string {
  return `PDF only · up to ${describeMegabytes(MAX_FILE_SIZE_BYTES)} per file · ${describeMegabytes(
    DATA_ROOM_QUOTA_BYTES,
  )} per Data Room`;
}

/** A file drag always carries this, and a node drag never does. See `NODE_DRAG_TYPE`. */
function carriesFiles(transfer: DataTransfer): boolean {
  return Array.from(transfer.types).includes('Files');
}

/**
 * The file-drop half of drag-and-drop. **Native HTML5 DnD, no new dependency**:
 * `DataTransfer` is the only way to read dropped files at all, so a pointer-drag library
 * would add a second mechanism beside this one rather than replace it.
 *
 * It wraps the folder's content instead of being a bordered box of its own, because the
 * target a user aims at when dropping documents into a folder is the folder — the list they
 * are looking at — not a separate rectangle beside it. The overlay only appears while files
 * are actually over the page.
 */
export function UploadDropzone({
  onFiles,
  disabled = false,
  children,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  // `dragenter` and `dragleave` fire once per element the pointer crosses, including every
  // descendant, so a bare `dragleave` handler would clear the highlight the moment the
  // cursor moved onto a table row inside the zone. The depth counter is what makes
  // "left the zone" mean the zone rather than one of its children.
  const depth = useRef(0);

  if (disabled) return <>{children}</>;

  const reset = () => {
    depth.current = 0;
    setOver(false);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    depth.current += 1;
    setOver(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    // Without both of these the browser navigates to the dropped file, which looks
    // exactly like the app crashing.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    depth.current -= 1;
    if (depth.current <= 0) reset();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    reset();
    // A dropped folder appears as an entry with no file body; `getAsFile()` returns a
    // directory-shaped `File` that fails screening on its type. Recursive directory
    // traversal is not in this phase, and silently uploading only the top level would be
    // worse than the queue saying which entries it refused.
    onFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex min-h-(--browser-frame-min-height) flex-col"
    >
      {children}
      {over ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary bg-background/85 text-center">
          <Upload className="size-6 text-primary" />
          <p className="text-sm font-medium">Drop to upload into this folder</p>
          <p className="text-xs text-muted-foreground">{uploadLimitsHint()}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The keyboard-and-click way in. Drag-and-drop is the convenience on top of it, never the
 * only route: a file picker is reachable by keyboard, works on touch, and is what a screen
 * reader announces.
 *
 * The `<input>` is hidden and driven by the button rather than styled, because a styled
 * file input is a fight with the browser's own rendering in every one of them.
 */
export function UploadButton({
  onFiles,
  disabled = false,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        // A hint to the picker, not a check: `accept` is trivially bypassed by choosing
        // "All files", so the real refusal is `screen()` in the queue and `HEAD` at
        // complete. Both still run on everything this input hands over.
        accept={UPLOAD_MIME_TYPE}
        className="hidden"
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          // Cleared so that choosing the same file twice in a row fires `change` again —
          // otherwise the second attempt looks like a dead button.
          event.target.value = '';
        }}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          input.current?.click();
        }}
      >
        <Upload />
        Upload files
      </Button>
    </>
  );
}
