import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  CONTENT_URL_TTL_SECONDS,
  type ContentDisposition,
  type ContentUrlResponse,
} from '@dr/contracts';

import type { AccessScope } from '../../access/access-scope';
import { StorageService } from '../../storage/storage.service';
import { NodeService } from '../node/node.service';
import { BlobRepository } from './blob.repository';

/**
 * The URL a browser downloads or previews a file with.
 *
 * **Not guarded by `role`, deliberately.** Every mutation asserts `scope.role === 'OWNER'`;
 * this is a read, and a `VIEWER` must be able to open a file that was shared with them in
 * Phase 4. Adding the guard "for symmetry" would break sharing before it is built.
 */
@Injectable()
export class ContentService {
  constructor(
    private readonly nodeService: NodeService,
    private readonly blobs: BlobRepository,
    private readonly storage: StorageService,
  ) {}

  /**
   * A short-lived presigned `GET`, as JSON rather than a `302`.
   *
   * `404` and `410` come for free: the node is resolved through `resolveLiveNode`, which is
   * the single place the order of checks runs. This method has no error handling of its own
   * beyond the two cases below.
   *
   * A `FOLDER` is **`422`**. It is not in `architecture.md` § Error contract because a
   * folder has no blob and no URL can be produced — and `404` would be a lie, since the node
   * exists and the caller may see it. Same category as the move cycle guard: a well-formed
   * request that cannot be satisfied.
   *
   * `expiresAt` is computed here rather than parsed out of the URL, and it is what the
   * preview refetches on. Five minutes, so a leaked URL dies quickly — the number is
   * load-bearing, which is why `CONTENT_URL_TTL_SECONDS` is shared with the client instead
   * of written twice.
   *
   * `disposition` selects preview or download. It is a parameter of the *signature*, not of
   * the client's handling of the response — a cross-origin `<a download>` does nothing —
   * so a preview URL cannot be reused for a save and vice versa. Downloading is a **read**,
   * and this endpoint is deliberately unguarded by role for the same reason previewing is:
   * a `VIEWER` must be able to keep a copy of a file shared with them, and refusing here
   * would be theatre while the same bytes render in the frame beside the button.
   */
  async urlFor(
    scope: AccessScope,
    nodeId: string,
    disposition: ContentDisposition,
  ): Promise<ContentUrlResponse> {
    const node = await this.nodeService.resolveLiveNode(scope, nodeId);

    if (node.type !== 'FOLDER' && node.blobId !== null) {
      const blob = await this.blobs.findInRoom(scope.dataRoomId, node.blobId);
      // `nodes_type_blob_check` guarantees a FILE has a blob id, and the foreign key
      // guarantees the row exists, so this is a broken database rather than a bad request.
      if (!blob) throw new NotFoundException('The file content is unavailable.');

      const url = await this.storage.presignGet(blob.storageKey, {
        contentType: blob.mimeType,
        fileName: node.name,
        expiresIn: CONTENT_URL_TTL_SECONDS,
        disposition,
      });

      return {
        url,
        expiresAt: new Date(Date.now() + CONTENT_URL_TTL_SECONDS * 1000).toISOString(),
      };
    }

    throw new UnprocessableEntityException('A folder has no content to open.');
  }
}
