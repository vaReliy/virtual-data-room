import type { StorageService, StoredObject } from '../storage/storage.service';

/**
 * An in-memory stand-in for `StorageService`.
 *
 * The integration tests exercise the *protocol* — the conditional flip, the advisory lock,
 * the aggregate delta, the `23505` retry — none of which is about S3. What they need from
 * storage is a `HEAD` that answers, and answering it from a `Map` keeps a real bucket (and
 * real credentials, which `CLAUDE.md` forbids the agent from holding) out of the loop.
 *
 * The one thing this **cannot** cover is whether GCS behaves as MinIO does on the
 * `response-*` overrides and on a repeated PUT to the same presigned URL. That is why the
 * gate carries a manual verification against a real bucket rather than another test.
 */
export class StorageDouble {
  readonly objects = new Map<string, StoredObject>();
  readonly deleted: string[] = [];

  /** Stands in for the browser's `PUT`: puts bytes where a presigned URL would have. */
  put(key: string, object: StoredObject): void {
    this.objects.set(key, object);
  }

  presignPut(key: string): Promise<string> {
    return Promise.resolve(`https://storage.example/${key}?signature=put`);
  }

  presignGet(key: string): Promise<string> {
    return Promise.resolve(`https://storage.example/${key}?signature=get`);
  }

  head(key: string): Promise<StoredObject | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }

  delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.objects.delete(key);
    return Promise.resolve();
  }

  /**
   * The cast is confined to this one line rather than repeated at every construction site.
   * `StorageService` has private fields — an S3 client and a bucket name — so a structural
   * stand-in cannot satisfy it nominally, and neither of them is anything a test can hold.
   */
  asService(): StorageService {
    return this as unknown as StorageService;
  }
}
