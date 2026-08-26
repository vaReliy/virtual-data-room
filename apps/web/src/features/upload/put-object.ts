/**
 * Step 2 of the upload protocol: the bytes, straight to storage.
 *
 * **This is the one request in the app that does not go through `api-client.ts`**, and the
 * exception is deliberate rather than an oversight. The URL points at GCS (MinIO locally),
 * not at the API: it carries no session cookie, it is not same-origin, and what comes back
 * is a storage provider's status code rather than this project's error contract. An
 * `ApiError` here would claim a meaning — `409` taken, `410` gone — that the responder
 * never intended.
 *
 * **`XMLHttpRequest`, not `fetch`.** `fetch` reports nothing while a request body is being
 * sent, so a progress bar driven by it can only ever be a spinner. `xhr.upload.onprogress`
 * is the only source of bytes-sent, and `xhr.abort()` is the only way to make cancelling a
 * 10 MB transfer stop the transfer rather than merely stop watching it.
 */

/** The PUT failed. `status` is `null` when the request never reached a response at all. */
export class TransferError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'TransferError';
  }
}

/** The user cancelled. Not a failure: it has its own row state and no error text. */
export class TransferCancelled extends Error {
  constructor() {
    super('The upload was cancelled.');
    this.name = 'TransferCancelled';
  }
}

/**
 * `Content-Type` is sent because it was **signed into the URL** (`signableHeaders` on the
 * presigner), so storage rejects the PUT with `403` if it differs by one character. It is
 * passed in rather than read off `File.type` for that reason: the signature covers the type
 * the API was told about at presign, and a browser's own sniffing of a file is not it.
 */
export function putObject({
  url,
  file,
  contentType,
  signal,
  onProgress,
}: {
  url: string;
  file: File;
  contentType: string;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new TransferCancelled());
      return;
    }

    const xhr = new XMLHttpRequest();
    const abort = () => {
      xhr.abort();
    };

    const settle = (outcome: () => void) => {
      signal.removeEventListener('abort', abort);
      outcome();
    };

    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', contentType);

    xhr.upload.onprogress = (event) => {
      // `lengthComputable` is false for a body of unknown length. A `File` always has a
      // size, so this holds in practice — but reporting `NaN` if it ever did not would
      // freeze the bar at a nonsense width rather than simply not moving it.
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };

    xhr.onload = () => {
      settle(() => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // The bar reaches the end on the response, not on the last progress event: the
          // final chunk is "sent" some time before storage acknowledges it.
          onProgress(1);
          resolve();
          return;
        }
        reject(
          new TransferError(
            xhr.status,
            // A presigned URL that has expired answers `403`, which is the one storage
            // status a user can plausibly cause by leaving a batch running too long.
            xhr.status === 403
              ? 'The upload link expired before the file finished. Try again.'
              : `Storage refused the upload (HTTP ${String(xhr.status)}).`,
          ),
        );
      });
    };

    // A CORS rejection is indistinguishable from a dead network here — the browser refuses
    // to say which, on purpose. The wording covers both without guessing.
    xhr.onerror = () => {
      settle(() => {
        reject(new TransferError(null, 'The file could not be sent to storage.'));
      });
    };
    xhr.ontimeout = () => {
      settle(() => {
        reject(new TransferError(null, 'The upload timed out.'));
      });
    };
    xhr.onabort = () => {
      settle(() => {
        reject(new TransferCancelled());
      });
    };

    signal.addEventListener('abort', abort, { once: true });
    xhr.send(file);
  });
}
