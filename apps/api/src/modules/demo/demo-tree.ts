import { DEMO_SHARE_FOLDER_ID, DEMO_SHARE_FOLDER_NAME } from './demo.constants';

/** The three committed PDFs. Real, multi-page, and re-used across several documents. */
export type FixtureName = 'annual-report.pdf' | 'agreement.pdf' | 'minutes.pdf';

export interface FolderSpec {
  kind: 'folder';
  /** Set on exactly one folder — the shared one, whose identity must survive a re-seed. */
  id?: string;
  name: string;
  children: TreeSpec[];
}

export interface FileSpec {
  kind: 'file';
  name: string;
  fixture: FixtureName;
}

export type TreeSpec = FolderSpec | FileSpec;

const folder = (name: string, ...children: TreeSpec[]): FolderSpec => ({
  kind: 'folder',
  name,
  children,
});

const file = (name: string, fixture: FixtureName): FileSpec => ({ kind: 'file', name, fixture });

/**
 * What the demo room contains. Editing this function is the whole of "change the demo" —
 * the seed recreates the room from it on every run, and the aggregate check re-derives the
 * counters from what it built, so nothing else has to be kept in step.
 *
 * Four levels deep under the room root, which is what makes breadcrumbs and nested
 * aggregates visible at all: `Due Diligence / Corporate / Incorporation / <file>`.
 *
 * Three things here are deliberate rather than decorative:
 *
 * - **`Management Accounts` is empty**, so the empty-folder state is reachable without
 *   creating a folder by hand.
 * - **`Internal` sits outside the shared folder.** The grant covers the shared folder only,
 *   so a grantee must not be able to see `Internal` at all — not its contents, not its name
 *   in a breadcrumb. It is what makes scope clipping demonstrable instead of merely
 *   implemented.
 * - **The shared folder carries a fixed id.** Everything else is created with
 *   `randomUUID()`; this one row is addressed by `DemoGrantService`, so its identity has to
 *   outlive a re-seed.
 */
export function demoTree(): TreeSpec[] {
  return [
    {
      ...folder(
        DEMO_SHARE_FOLDER_NAME,
        folder(
          'Corporate',
          folder(
            'Incorporation',
            file('Certificate of Incorporation.pdf', 'agreement.pdf'),
            file('Articles of Association.pdf', 'agreement.pdf'),
          ),
          folder(
            'Board Minutes',
            file('Board Minutes 2025-11-14.pdf', 'minutes.pdf'),
            file('Board Minutes 2025-09-12.pdf', 'minutes.pdf'),
          ),
        ),
        folder(
          'Financials',
          folder('2025', file('Annual Report 2025.pdf', 'annual-report.pdf')),
          folder('Management Accounts'),
        ),
        folder(
          'Legal',
          folder('Contracts', file('Master Services Agreement.pdf', 'agreement.pdf')),
          file('Mutual NDA.pdf', 'agreement.pdf'),
        ),
      ),
      id: DEMO_SHARE_FOLDER_ID,
    },
    folder('Internal', folder('Deal Notes', file('Valuation Notes.pdf', 'minutes.pdf'))),
  ];
}
