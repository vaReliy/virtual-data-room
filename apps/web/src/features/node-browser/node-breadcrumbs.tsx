import { Fragment } from 'react';
import { Link } from 'react-router';
import type { Breadcrumb as Crumb } from '@dr/contracts';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { nodeLink, rootLink, type NodeSource } from '@/lib/node-source';

/**
 * The ancestry, rendered exactly as the API sent it.
 *
 * **Nothing is reconstructed here.** The server clips the trail to the caller's scope
 * root by arithmetic on `path`, so an ancestor above that root is never fetched, let
 * alone rendered — in an M&A context a folder name is itself confidential, and a
 * breadcrumb is the easiest place to leak one. A client that rebuilt ancestry from
 * `parentId` would climb straight past the boundary; it stops at `parentId: null`, which
 * marks the root of what this caller may see rather than the root of the tree.
 *
 * `rootLabel` is the room's name when the caller holds the whole room, and a neutral
 * word when they do not: `room` is absent from the response precisely when the room's
 * name sits above their scope (decision #24).
 */
export function NodeBreadcrumbs({
  source,
  rootLabel,
  trail,
  current,
}: {
  source: NodeSource;
  rootLabel: string;
  trail: Crumb[];
  current: string | null;
}) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {current === null ? (
            <BreadcrumbPage>{rootLabel}</BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <Link to={rootLink(source)}>{rootLabel}</Link>
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>

        {trail.map((crumb) => (
          <Fragment key={crumb.id}>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to={nodeLink(source, crumb.id)}>{crumb.name}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
          </Fragment>
        ))}

        {current === null ? null : (
          <Fragment>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{current}</BreadcrumbPage>
            </BreadcrumbItem>
          </Fragment>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
