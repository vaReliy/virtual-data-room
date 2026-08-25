import { UnprocessableEntityException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates a request body against a schema from `packages/contracts` — the same schema
 * the client's form resolver uses, so both sides reject the same strings for the same
 * reasons (decision #12).
 *
 * Nest's built-in `ValidationPipe` is not used anywhere in this API: it is built on
 * class-validator and decorated DTO classes, which would mean a second declaration of
 * every shape that `packages/contracts` already owns.
 *
 * **The output is the parsed value, not the input.** `nodeNameSchema` trims, and a pipe
 * that validated without returning the result would leave the untrimmed name to be
 * inserted — normalization at the edge only works if the edge hands on what it normalized.
 *
 * `422`, not `400`: a syntactically valid body whose contents are rejected is the
 * "unprocessable" case the error contract already uses for quota and file-type failures.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;

    // Field paths are included because the dialogs show the message inline, against the
    // input that produced it.
    const problems = parsed.error.issues.map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    );
    throw new UnprocessableEntityException(problems);
  }
}
