/**
 * The private drag type that separates a **node drag** from a **file drop**.
 *
 * Both mechanisms are native HTML5 drag-and-drop and both fire on the same elements, so
 * something has to tell them apart at `dragover` — the moment where the drop is accepted
 * or refused. `DataTransfer.getData()` is deliberately unreadable during a drag (the
 * browser's drag protection mode), so `types` is the only thing available then: a file drag
 * always reports `Files`, and a node drag reports this.
 *
 * Lowercase because `types` is normalized to lowercase by the browser, and a comparison
 * against a capitalized constant would quietly never match.
 */
export const NODE_DRAG_TYPE = 'application/x-vdr-node';

export function carriesNode(transfer: DataTransfer): boolean {
  return Array.from(transfer.types).includes(NODE_DRAG_TYPE);
}
