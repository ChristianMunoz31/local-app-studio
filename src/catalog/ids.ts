// Ids the model may pick are enums built from the context (docs/CATALOG.md, "Ids from the model are enums"), so
// structured output can only name declared tables, pages, sources and fields. Pure.
import * as z from 'zod';

/**
 * An enum of the given ids, or `z.never()` when there are none: a part whose required binding has nothing to bind
 * to cannot be generated, which is correct.
 */
export function idEnum(ids: readonly string[]): z.ZodType<string> {
  const [first, ...rest] = ids;
  return first === undefined ? z.never() : z.enum([first, ...rest]);
}
