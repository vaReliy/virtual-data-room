# Manual E2E test cases — Virtual Data Room

Behaviour-level cases for walking the product by hand, or by driving a real browser through
the `chrome-devtools` MCP. **Deliberately free of implementation.** No selectors, no element
ids, no route internals, no API paths: the UI and the backend will change, the flows below
will not. Every step names an _intent_ ("open the control that starts an upload") and every
expectation names an _observable outcome_ ("the row states the reason it was refused").

This file lives in `docs/` rather than in gitignored `notes/` because it is meant to outlive
the machine it was written on. **Update it when behaviour changes, not when markup changes.**
A case that had to be rewritten because a button moved was written too specifically; a case
that still passes after a defect shipped was written too loosely.

Where a case depends on a rule rather than on a layout, the rule is stated in the case, so
a future reader can tell a regression from an intentional redesign.

## How to use this

- **Preconditions** must hold before step 1; a case that starts from the wrong state proves
  nothing.
- Steps are numbered; expectations sit with the step that produces them.
- A case is **passed** only when every expectation in it holds, including the ones about
  what must _not_ appear.
- Cases marked **[state]** exist to check a loading, empty or error screen. They are part of
  the feature, not extras — skipping them is how those screens rot.
- Cases marked **[phase 4+]** describe behaviour that is not built yet. Do not run them; do
  not delete them.
- Cases marked **[long session]** only fail after the session has aged. They cannot be
  covered by a quick pass, and they are the ones a quick pass has already missed once —
  see **SES-01**.

## Fixtures

Prepare once, keep beside the run:

| Name            | What it is                                | Used by            |
| --------------- | ----------------------------------------- | ------------------ |
| `contract.pdf`  | a small valid PDF (a few hundred B)       | most upload cases  |
| `nda.pdf`       | a second small valid PDF                  | conflict, deletion |
| `big-deck.pdf`  | a valid PDF just under the per-file limit | progress, cancel   |
| `oversized.pdf` | a valid PDF just over the per-file limit  | rejection          |
| `notes.txt`     | any non-PDF                               | rejection          |

The per-file limit, the accepted type, the batch size and the room quota are published by
the app itself — the hint under the file list states all of them. Read the numbers there
rather than hard-coding them here; that hint is also what case **UP-07** checks.

Cancelling a large transfer needs the transfer to last long enough to click. Throttle the
network to a mobile profile in the browser's own devtools rather than looking for a bigger
file.

---

## Sign-in and shell

### AUTH-01 — Sign in reaches an owned Data Room

**Preconditions:** signed out.

1. Open the application root.
   - Expected: the sign-in screen, offering Google as the only method. No file or folder
     content is visible anywhere on it.
2. Sign in with a Google account that has used the app before.
   - Expected: the account's own Data Room opens, showing its name, its totals line
     (folders, files, size) and its top-level contents.
   - Expected: the header shows the signed-in identity and a way to sign out.

### AUTH-02 — A signed-out visitor cannot reach room content **[state]**

**Preconditions:** signed out; the address of a folder inside a room is known.

1. Open that folder's address directly.
   - Expected: the sign-in screen. Not a folder, not an error page, and **no folder name
     anywhere on screen** — a name is itself confidential.

---

## Session lifetime

The session is a signed token in a cookie with a fixed lifetime and **no refresh token**.
Past half that lifetime, the next authenticated request silently replaces it, so an active
user is never signed out mid-task while an abandoned session still dies on schedule.

That sliding window is the only part of this product whose behaviour **changes with the age
of the session**, which makes it the one thing a fast walkthrough structurally cannot see.
It is also where a defect has already shipped: every guarded request outside the auth module
began failing once a session crossed the threshold, while the signed-in header kept working,
so it read as a data problem an hour after the last code change. Hence the cases below.

### SES-01 — An aged session keeps working, everywhere **[long session] [state]**

**Preconditions:** signed in at least as long as half the session lifetime — read the
lifetime from the configuration rather than guessing, and leave the tab alone in the
meantime. Coming back to yesterday's tab is the natural way to run this.

1. Reload a folder page.
   - Expected: the folder's contents. **Not** an error, and not a redirect to sign-in.
2. Exercise **one action from each area** before doing anything else: open a file, upload a
   file, rename something, move something, delete something.
   - Expected: all of them succeed.
   - Rule: this must be checked per area, not once. The known defect spared some routes and
     broke others, so "the app opened" proves nothing about the rest of it.
3. Watch the server log while doing the above.
   - Expected: no exception of any kind. A `500` here is the shape this case exists for.
4. Inspect the session cookie before step 1 and after it (devtools, application storage).
   - Expected: it has been **replaced** — the new one is issued at roughly the time of the
     request, and its lifetime starts again from there.
   - Expected: it stays inaccessible to page scripts, and it is not readable from
     JavaScript.

### SES-02 — An expired session is refused cleanly **[state]**

**Preconditions:** a session older than the full lifetime — leave a tab overnight, or clear
the session cookie by hand to simulate the end state.

1. Reload any page inside a room.
   - Expected: the sign-in screen.
   - Expected: no room content, no folder name, and no half-rendered shell with an error in
     the middle of it.

### SES-03 — Restarting the server does not sign anyone out

**Preconditions:** signed in, a folder open.

1. Restart the API.
2. Reload the page.
   - Expected: the same session still works.
   - Rule: sessions are stateless by design — nothing about them is held in server memory.
     If a restart signs people out, that property has been lost.

---

## Browsing

### NAV-01 — Descend and return by breadcrumb

**Preconditions:** signed in; the room root holds at least one folder with a subfolder.

1. Open a folder from the list.
   - Expected: its name becomes the heading; the breadcrumb gains a step for it; the list
     shows that folder's own children.
   - Expected: the totals line describes **this** folder's subtree, not the room's.
2. Open the subfolder.
   - Expected: the breadcrumb now shows the whole path, room first.
3. Use the breadcrumb to jump back to the room root.
   - Expected: the room root's list and totals, and the breadcrumb reduced to one step.

### NAV-02 — Folders sort before files

**Preconditions:** a folder holding both folders and files.

1. Open it.
   - Expected: every folder appears before every file, and within each group the names are
     in case-insensitive alphabetical order.

### NAV-03 — Paging through a long listing

**Preconditions:** a folder holding more children than one page (create them in bulk).

1. Open it and scroll to the end of the list.
   - Expected: a control to load more, not a silently truncated list.
2. Load the next page.
   - Expected: the new rows continue the same ordering across the boundary — no duplicated
     row, no row skipped where folders give way to files.

### NAV-04 — An empty folder says so **[state]**

1. Open a folder with no children.
   - Expected: an empty-state message, not a blank area and not an error.
   - Expected: the toolbar still offers creating a folder and uploading.
   - Expected: a `..` row is still there, above the message — an empty folder must not be a
     dead end. This holds only for a folder; at the room root there is no `..` row to show
     (`node` is `null` there too, so the plain placard is all there is).

### NAV-05 — A slow load shows placeholders, not a blank page **[state]**

**Preconditions:** network throttled to a slow profile.

1. Open any folder.
   - Expected: placeholder rows shaped like the table appear while loading, then are
     replaced by content — the layout must not jump from empty to full.

### NAV-06 — An unreachable server is reported and retryable **[state]**

**Preconditions:** stop the API (leave the front end running).

1. Open the room root.
   - Expected: a message saying the server cannot be reached, and a control to try again.
   - Expected: it does **not** say "not found" — an unreachable server and a missing node
     are different situations.
2. Start the API and use the retry control.
   - Expected: the content loads without a full page reload.

### NAV-07 — The `..` row climbs one level

**Preconditions:** a folder with a subfolder holding at least one child, all owned (or, for
a share recipient, the subfolder sits below their scope root).

1. Open the room root.
   - Expected: no `..` row — this is already the top of what the caller can see.
2. Open a folder, then open its subfolder.
   - Expected: the subfolder's list opens with a `..` row pinned first, before every real
     row — no size, contents, date or actions menu on it.
   - Expected: this holds even when the subfolder is empty — see NAV-04.
3. Activate the `..` row by keyboard (tab to it, then Enter).
   - Expected: it lands one level up, at the folder from step 2, and a screen reader
     announces it as a link to the parent folder, not as two dots.
4. For a share recipient scoped to that subfolder: open it directly.
   - Expected: no `..` row — this is their scope root, indistinguishable from the room root.

---

## Upload

### UP-01 — Upload several files through the picker

**Preconditions:** an owned folder open.

1. Open the control that starts an upload and choose `contract.pdf` and `nda.pdf`.
   - Expected: an upload queue appears listing both by name and size.
   - Expected: each row moves through waiting → a progress indication → a finished state.
2. Wait for both to finish.
   - Expected: both files appear as rows in the folder's list without a manual refresh.
   - Expected: the folder's totals line grows by two files and by their combined size.
   - Expected: the queue keeps showing the finished rows until they are cleared, and offers
     a way to clear them.

### UP-02 — Upload by dropping files onto the folder

1. Drag `contract.pdf` from the desktop over the folder's contents.
   - Expected: the drop area is indicated while the files are over it, and the indication
     names what will happen.
2. Drop.
   - Expected: the same queue behaviour as **UP-01**. Dropping must never navigate the
     browser to the file itself.

### UP-03 — A non-PDF is refused before anything is uploaded

1. Add `notes.txt` to the upload.
   - Expected: it appears in the queue as a failed row stating that only PDFs are accepted.
   - Expected: **no upload is attempted for it** — watch the network: no request carrying
     its bytes, and no reservation on the server.
   - Expected: it does not appear in the folder's list.

### UP-04 — An oversized file is refused before anything is uploaded

1. Add `oversized.pdf`.
   - Expected: a failed row stating the per-file size limit, with the same "nothing was
     uploaded" guarantee as **UP-03**.

### UP-05 — Valid and invalid files in one selection

1. Select `contract.pdf`, `notes.txt` and `oversized.pdf` together.
   - Expected: the valid file uploads and lands; the two invalid ones each state their own
     reason; neither blocks the other.
   - Rule: a refused file is still shown. Silently dropping it would leave the user with a
     dropzone that ignored half of what they gave it and no reason why.

### UP-06 — Progress is real, and cancelling stops the transfer

**Preconditions:** network throttled so a large transfer takes several seconds.

1. Upload `big-deck.pdf`.
   - Expected: the progress indication advances through intermediate values — not 0 then 100.
2. Cancel that row while it is still moving.
   - Expected: the row settles into a cancelled state, visibly distinct from a failure — a
     cancellation is not an error the user has to fix.
   - Expected: **the file does not appear in the folder's list**, and the folder's totals
     do not change.
3. Let a different file finish, then look for a cancel control on it.
   - Expected: none is offered once its bytes have arrived — by then the file exists, and a
     control that cannot do what it says is worse than no control.

### UP-07 — The limits are stated where files are added

1. Look at the folder screen as an owner.
   - Expected: one line states the accepted type, the per-file limit and the room quota, in
     real numbers.
   - Expected: those numbers match what the refusals in **UP-03**/**UP-04** say, and neither
     shows a placeholder such as `NaN` or `undefined`.

### UP-08 — Uploading the same name repeatedly auto-suffixes, then stops

1. Upload `contract.pdf` into a folder that already contains `contract.pdf`.
   - Expected: it lands under a suffixed name (`contract (1).pdf`) with **no dialog** — the
     name came from the file, not from the user.
2. Repeat until the folder holds the original and three suffixed copies.
   - Expected: the next upload of that name fails with a row saying the name is taken.
   - Rule: the suffix is bounded, and the bound is visible. Rename is the way out.

### UP-09 — Uploading into a folder that was deleted meanwhile

**Preconditions:** the same folder open in two browser tabs.

1. In tab B, delete the folder.
2. In tab A, without refreshing, upload a file into it.
   - Expected: the row fails saying the destination folder is gone — not a generic failure,
     and not silent success.

### UP-10 — Exceeding the room quota is refused with the reason

**Preconditions:** a room close to its quota.

1. Upload files whose combined size crosses the quota.
   - Expected: the refusal states the quota, and the room's stored total never exceeds it.
   - Note: the check is made on the batch as a whole, so files that pass individually can
     fail together. That is correct.

### UP-11 — A reader cannot upload **[phase 4+]**

**Preconditions:** signed in as someone with read-only access to a shared folder.

1. Open it.
   - Expected: no upload control, no create-folder control, and no rename, move or delete on
     any row.
   - Expected: a file row still offers **Download**, and nothing else. Downloading is a read,
     and a reader may keep a copy of what they can already open — see DL-04.
   - Expected: dragging files over the list offers no drop indication.
   - Rule: hiding controls is presentation only — the server refuses the write regardless.

---

## Preview

### PRV-01 — Open a file and see the document

**Preconditions:** a folder holding an uploaded PDF.

1. Open the file from its row.
   - Expected: the file's own screen, with its name as the heading, its size and its last
     update, and a breadcrumb that includes the containing folder.
   - Expected: the document itself renders **inline** on the page — it must not download.
2. While it is loading **[state]**.
   - Expected: a placeholder the size of the viewer, not a blank gap.

### PRV-02 — The preview link is short-lived and is not reused

1. Open a file, then navigate away and back to it.
   - Expected: the document renders again.
   - Rule: the address behind the viewer is a temporary, signed link measured in minutes.
     A cached one is a dead one, and the failure surfaces as a storage provider's raw error
     page inside the viewer. Seeing that page is a **failure of this case**.
2. Leave the preview open, well past the link's lifetime, without touching it.
   - Expected: the already-rendered document keeps working. The page does not reload itself
     under the reader.

### PRV-03 — The file name's extension decides nothing

**Preconditions:** a PDF uploaded, then renamed to end in `.txt`.

1. Open it.
   - Expected: it still renders as a PDF. The stored content type is what matters; the name
     is a label.

### PRV-04 — A file deleted while it is open **[state]**

**Preconditions:** the same file open in tab A; tab B able to delete it.

1. Delete it in tab B.
2. Return to tab A and let it refresh (switching back to the tab is enough).
   - Expected: a dead-end screen saying **the file** was deleted by the owner, with a link
     back to the Data Room root.
   - Expected: not a generic error, and not a stale document left on screen.

### PRV-05 — Following a row for a file that is already gone **[state]**

**Preconditions:** a folder listing open in tab A; the file deleted in tab B.

1. In tab A, without refreshing, open that file's row.
   - Expected: the same "this file was deleted" screen.
2. Reload that page.
   - Expected: still the file wording — the browser keeps what the row knew on the history
     entry.
3. Open the same address in a **new** tab, pasted rather than navigated.
   - Expected: the deleted-**folder** wording. This is correct, not a bug: the server's
     answer for a dead node names no type, so with no prior knowledge the app falls back to
     the general case. Do not "fix" it by adding a type to that answer.

### PRV-06 — An address that never existed **[state]**

1. Open the room with a node address made of a plausible but unused identifier.
   - Expected: a "not found" screen, distinct in wording from the deleted screens.
   - Rule: something outside the caller's access must be indistinguishable from something
     that never existed. A signed-in user must never be able to tell them apart.

---

## Download

### DL-01 — Download a file from its row

**Preconditions:** a folder holding an uploaded PDF.

1. Open the row's actions and choose **Download**.
   - Expected: the browser saves a file **named after the node**, ending in `.pdf` — not a
     bare identifier and not a name the browser invented.
   - Expected: the page does not navigate anywhere. The listing stays exactly as it was.
   - Expected: a non-ASCII name (Cyrillic, an accent, a space) survives intact.

### DL-02 — Download from the preview, and the preview stays a preview

1. Open a file, then use **Download** on its screen.
   - Expected: the file is saved, and the document on screen is untouched — same page, same
     scroll position.
2. Reload and open the document without downloading.
   - Expected: it still renders inline (PRV-01 unchanged).
   - Rule: preview and download are two differently signed addresses for the same bytes. One
     is decided by the server at the moment it is asked for, not by the link the page is
     already holding.

### DL-03 — A folder cannot be downloaded

1. Open a folder row's actions.
   - Expected: no Download item. A folder has no content of its own to save, and there is no
     zip-a-folder feature.

### DL-04 — A reader can download **[phase 4+]**

**Preconditions:** signed in as someone with read-only access to a shared folder.

1. Download a file from its row, and again from its preview screen.
   - Expected: both succeed.
   - Rule: this is deliberate. The reader can already open the document; refusing to let them
     save it would block nothing and hide a control that works.

### DL-05 — A file deleted between the listing and the click **[state]**

**Preconditions:** a folder listing open in tab A; the file deleted in tab B.

1. In tab A, without refreshing, choose **Download** on that row.
   - Expected: an inline message naming the file and saying it was **deleted** — distinct
     from the wording used for a file that is merely no longer available here, and
     dismissible.
   - Expected: no file is saved, no dialog opens, and nothing else on the screen changes.

---

## Folders

### FLD-01 — Create a folder

1. Open the create-folder control, enter a name, confirm.
   - Expected: the dialog closes, the folder appears in the list, and the folder count on
     the totals line grows by one.

### FLD-02 — Create with a name already taken

1. Create a folder using the name of an existing sibling folder.
   - Expected: the dialog **stays open** and states that the name is taken, with the typed
     name still editable.
   - Expected: no folder is created, and **no suffix is invented** — the user typed this
     name, so the app asks rather than guesses.

### FLD-03 — Names are validated the same way on both sides

1. Try to submit: an empty name, a name of only spaces, a name containing `/`, and a name
   of more than the maximum length.
   - Expected: each is refused with a message about what is wrong, and the confirm control
     is unavailable while the name is invalid.
   - Expected: leading and trailing spaces are trimmed rather than preserved.

### FLD-04 — Rename a folder, including case-only changes

1. Rename `Legal` to `legal`.
   - Expected: it succeeds, and the list shows the new casing.
   - Rule: uniqueness ignores case, but a row does not collide with itself.

### FLD-05 — Delete a folder names what goes with it

**Preconditions:** a folder containing nested folders and files.

1. Start deleting it.
   - Expected: the confirmation states how much is going — counts and total size of the
     **whole subtree**, not just the visible level — and that it cannot be undone.
2. Confirm.
   - Expected: the row disappears and the parent's totals shrink by the whole subtree.
   - Expected: no trash or restore is offered anywhere. There is none by design.

### FLD-06 — Standing inside a folder that gets deleted **[state]**

**Preconditions:** folder open in tab A, deleted in tab B.

1. Return to tab A and let it refresh.
   - Expected: a dead-end screen saying **the folder** was deleted by the owner, with a link
     back to the Data Room root.
   - Expected: nothing moves under the reader on its own — no automatic redirect.

---

## File actions

### FIL-01 — Rename a file

1. Rename an uploaded file to an unused name.
   - Expected: the row shows the new name, and opening it still shows the same document.

### FIL-02 — Rename a file into a name already taken

1. Rename `nda.pdf` to `contract.pdf` in a folder holding both.
   - Expected: the dialog stays open, states that the name is taken, and creates nothing.
   - Expected: **no suffix is offered or applied**, and no copy anywhere promises an
     automatic rename. Only upload suffixes; rename does not.

### FIL-03 — Delete a file

1. Start deleting a file.
   - Expected: the confirmation is about a single document — it must not claim to delete
     "everything inside it", which is folder wording.
2. Confirm.
   - Expected: the row disappears; the folder's file count and size shrink accordingly.

### FIL-04 — Every file action is reachable by keyboard

1. Using only the keyboard, reach a file's actions, open them, and move through the entries.
   - Expected: the actions open, each entry can be focused and activated, and the resulting
     dialog receives focus.
   - Expected: closing a dialog with the keyboard returns focus somewhere sensible in the
     list.

---

## Move

### MOV-01 — Move a file with the dialog

**Preconditions:** a file in one folder, a second folder elsewhere in the room.

1. Open the move action for the file.
   - Expected: a picker starting at the Data Room root, listing **folders only** — a file
     cannot receive a file.
2. Navigate into the destination folder.
   - Expected: a way back up that stops at the root and never climbs above it.
3. Confirm the move.
   - Expected: the dialog closes; the file leaves the source listing.
   - Expected: **both** folders' totals are correct afterwards — the source shrinks and the
     destination grows by the file's size and count.

### MOV-02 — The current parent is offered but not usable

1. Open the move dialog for a file and navigate to the folder it already lives in.
   - Expected: the confirm control is present but unavailable, and says the file is already
     there. Moving something to where it already is is not an operation.

### MOV-03 — Move by dragging a row onto a folder row

1. Drag a file's row onto a folder's row in the same listing.
   - Expected: the target row is highlighted while it is a valid destination.
   - Expected: on drop, the file moves, with the same totals guarantee as **MOV-01**.
2. Drag a file's row onto its own row, and onto a file row.
   - Expected: neither is highlighted, and dropping does nothing.
3. Start the drag from the file's **name** specifically.
   - Expected: the row is dragged — not the link. A link drag (a URL) means the mechanism
     has broken even though the rest of the row still works.

### MOV-04 — Moving into a folder that already holds that name

**Preconditions:** `contract.pdf` in both the source and the destination folder.

1. Move the source `contract.pdf` into the destination.
   - Expected: it is refused with a message naming the conflict, shown where the user acted
     — inside the dialog for a dialog move, or as a dismissible message for a drag.
   - Expected: **no suffix**, and the file stays where it was. The user chose this
     destination knowing what is in it; renaming first is the way through.

### MOV-05 — Moving to the Data Room root

1. Move a nested file to the root using the dialog without entering any folder.
   - Expected: the file appears at the room root, and both totals lines are correct.

### MOV-06 — A folder cannot be moved into its own descendant

**Preconditions:** only if a folder-move affordance exists. There is none by design in the
current scope — the rule is enforced by the server and covered by an automated test.

1. If a UI for moving folders is ever added, attempt to move a folder into its own child.
   - Expected: refused with a message about the destination being invalid, and the tree left
     untouched.

---

## Cross-cutting

### X-01 — Two tabs stay honest about each other

**Preconditions:** the same folder open in two tabs.

1. Create, rename and delete items in tab B.
2. Return to tab A.
   - Expected: switching back refreshes it, and the list matches what tab B did — including
     items disappearing.

### X-02 — Nothing internal leaks into the client

1. Watch the responses while browsing folders and opening a file.
   - Expected: no materialized path, no storage key, no bucket name and no internal
     identifier beyond the node identifiers the app already uses in its addresses.

### X-03 — The browser console is clean

1. Walk **UP-01**, **PRV-01**, **FIL-01** and **MOV-01** with the console open.
   - Expected: no errors and no warnings. A React key warning or an unhandled rejection here
     is a defect, even when the flow appears to work.

### X-04 — Sharing surfaces **[phase 4+]**

Share dialog, link and user shares, revocation, "Shared with me", and the public read-only
surface. Not built; no cases written. When they arrive, a revoked link and a revoked user
grant must give **different** answers, and the reasoning belongs with those cases.

---

## Reporting a failure

Name the case id, the step, what was expected and what happened. **Include the server log
for the moment it happened** — a `500` in this app is deliberately opaque to the browser,
which sees only "Internal server error", while the log names the line.

Three things are worth checking before filing anything. The first two have produced
convincing phantom bugs here; the third has produced a real one that looked like a phantom:

- **Is the running back end actually running the current code?** A watcher can stop
  restarting its child and serve an old build; the stack trace then points at a line that no
  longer matches the file.
- **Is the front end serving the current code?** A dev server can hold a stale pre-bundle of
  a linked workspace package, in which case anything recently added to it reads as
  `undefined` in the browser — typically surfacing as `NaN` or a blank value rather than an
  error.

- **How old is the session?** A failure that appears without a code change, on a tab that
  was working, and that leaves the signed-in header intact while everything else breaks, is
  the shape of **SES-01**. Signing out and back in will make it disappear without fixing
  anything — so check before you do that, not after.

The first two traps, and how to clear them, are described in `README.md` § "When the app
looks wrong but the code looks right".
