import { z } from "zod";

// What every catalogue list takes and answers (#88): search, status, and one page at a time.

/** Text to look for: in a name, whatever its case and accents. Blank means no search. */
export const SearchText = z.string().trim().max(100).optional();

/** Which rows a list shows: the active ones (the default), the inactive ones, or all. */
export const LIST_STATUSES = ["active", "inactive", "all"] as const;
export const ListStatus = z.enum(LIST_STATUSES).default("active");
export type ListStatus = z.infer<typeof ListStatus>;

/** The page wanted, and its size: 50 rows by default, at most 200. */
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** One page of a list. `total` counts every row the filters match. */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  });
}

/** The ID in a path: `/api/storerooms/:id`. */
export const IdParams = z.object({ id: z.uuid() });
