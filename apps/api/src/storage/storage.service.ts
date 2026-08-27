import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ContentDisposition } from '@dr/contracts';

import type { Env } from '../config/env';

/**
 * How long a presigned PUT lives.
 *
 * Set explicitly, because the SDK's own default is 900 s and an inherited default is not a
 * chosen one. The value happens to agree with it: a presign batch is up to ten 10 MB files
 * signed at one moment while the browser transfers them one after another, so a shorter
 * window would expire the tail of a legitimate batch on a slow uplink.
 *
 * It is *not* the GET number. A PUT URL names an object that does not exist yet and grants
 * nothing to read; the GET is 300 s precisely because it does.
 */
export const UPLOAD_URL_TTL_SECONDS = 900;

/**
 * What storage reports about an object that is actually there. Both fields are read back
 * rather than trusted from the client, because they feed the Data Room aggregates.
 */
export interface StoredObject {
  size: number;
  contentType: string | null;
}

/**
 * The one storage implementation, for MinIO locally and GCS in production.
 *
 * GCS is reached through its **S3-compatible XML API**, not through the Google SDK, which
 * is what makes a single implementation possible — the difference between the two
 * environments is the endpoint and the credentials, both of which are configuration.
 *
 * That API supports presigned `PUT` but **not** S3's POST policy documents, which is why
 * the size, type and quota limits are enforced by this API at presign and at complete
 * rather than by storage itself.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('STORAGE_BUCKET', { infer: true });
    this.client = new S3Client({
      endpoint: config.get('STORAGE_ENDPOINT', { infer: true }),
      region: config.get('STORAGE_REGION', { infer: true }),
      credentials: {
        accessKeyId: config.get('STORAGE_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('STORAGE_SECRET_ACCESS_KEY', { infer: true }),
      },
      // Both endpoints address a bucket by path — `https://storage.googleapis.com/<bucket>`
      // and `http://minio:9000/<bucket>`. Virtual-hosted style would need wildcard DNS for
      // bucket subdomains, which neither provides here.
      forcePathStyle: true,
    });
  }

  /**
   * A presigned `PUT` the browser uploads straight to, so bytes never traverse the API or
   * the Vercel rewrite (whose 4.5 MB body limit and request timeout would otherwise apply).
   *
   * **`signableHeaders` is not optional here.** Non-`x-amz-*` headers are excluded from the
   * signature by default, so without `content-type` in that set the URL accepts *any*
   * content type and "`Content-Type: application/pdf` signed into the PUT" is simply not
   * true. Nothing catches the omission: complete re-checks the type with a `HEAD`, so every
   * test still passes while the guarantee is gone.
   */
  async presignPut(key: string, contentType: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(['content-type']) },
    );
  }

  /**
   * A short-lived presigned `GET` for a download or an inline preview.
   *
   * The two `response-*` overrides pin what the browser does with the bytes, because the
   * object itself cannot: keys are UUIDs with no extension, so a viewer has nothing to
   * sniff a type from. They are also the parameters whose GCS behaviour can differ from
   * MinIO's, which is why the gate verifies them against a real bucket.
   *
   * The name is **not** the type anywhere in this system. `contentType` comes from the blob
   * — recorded at PUT — and `fileName` from the node, so `contract.pdf` renamed to
   * `contract.txt` still renders as a PDF. That is intended: rename does not police
   * extensions (decision #28).
   *
   * `disposition` is the difference between a preview and a download, and it is a parameter
   * *here* — not on the client — because it is signed. `<a download>` is ignored for a
   * cross-origin URL, so `attachment` inside this header is the only thing that saves a
   * file to disk. The `filename*=` half is unconditional either way: it is what makes a
   * saved file arrive named after the node instead of after its UUID storage key.
   */
  async presignGet(
    key: string,
    options: {
      contentType: string;
      fileName: string;
      expiresIn: number;
      disposition: ContentDisposition;
    },
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: options.contentType,
        ResponseContentDisposition: `${options.disposition}; filename*=${encodeRfc5987(options.fileName)}`,
      }),
      { expiresIn: options.expiresIn },
    );
  }

  /**
   * Writes bytes straight from this process. **The seed is its only caller, and it must
   * stay that way**: every upload a user makes goes through `presignPut` so the bytes never
   * traverse the API, the Vercel rewrite's 4.5 MB body limit or the Cloud Run request
   * timeout. Routing a request path through here would reintroduce all three.
   *
   * The seed has no browser to presign for, and signing a URL only to `PUT` to it from the
   * same process would add a signature round trip and a second place for the content type
   * to be got wrong.
   */
  async putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /**
   * The real size and content type of a stored object, or `null` if nothing is there.
   *
   * A missing object is an ordinary outcome, not an error: it is what a complete call for
   * an upload that never finished looks like. Everything else propagates — a storage
   * failure dressed up as "not uploaded" would tell the user to retry something that is not
   * their problem.
   */
  async head(key: string): Promise<StoredObject | null> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: response.ContentLength ?? 0,
        contentType: response.ContentType ?? null,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * Removes an object. Called on exactly one path: an upload whose stored bytes violate the
   * limits, where keeping them would leave bytes nothing will ever collect.
   *
   * **Deleting a file does not come here.** A soft-deleted file keeps its bytes, and that
   * is structural rather than a preference: `nodes_type_blob_check` requires
   * `FILE → blob_id NOT NULL`, so the blob row can be neither deleted nor detached, and
   * removing only the bytes would make a reversible operation irreversible in fact while
   * still looking reversible.
   */
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/**
 * S3 reports a missing object on `HEAD` with a `404` and an empty body, so there is no
 * error code to match on — the name and the HTTP status are what distinguish it.
 */
function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === 'NotFound' || candidate.$metadata?.httpStatusCode === 404;
}

/**
 * `filename*=UTF-8''…` per RFC 5987, which is what lets a non-ASCII document name survive
 * the header. `encodeURIComponent` leaves `!'()*` unescaped and RFC 5987 does not allow
 * them in this position, so they are escaped afterwards.
 */
function encodeRfc5987(value: string): string {
  const escaped = encodeURIComponent(value).replace(
    /['()*!]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `UTF-8''${escaped}`;
}
