import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates one query parameter against a schema from `packages/contracts`, so the set of
 * accepted values is declared once and both apps read the same declaration (decision #12).
 *
 * **`400`, not the `422` `ZodValidationPipe` raises.** The distinction is who authored the
 * value. A body is typed by a person and a rejected name is an answer their dialog renders;
 * a query parameter like `?disposition=` is assembled by our own client, so a value outside
 * the enum is a malformed request rather than an unprocessable one. Falling back to a
 * default instead would hide the typo for as long as the feature keeps half-working.
 *
 * **The output is the parsed value.** A schema carrying `.default(…)` is how an absent
 * parameter acquires its meaning, which only works if the pipe hands on what it produced.
 */
export class ZodQueryPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;

    // No field path: the parameter's own name is already in the message the caller sees.
    throw new BadRequestException(parsed.error.issues.map((issue) => issue.message));
  }
}
