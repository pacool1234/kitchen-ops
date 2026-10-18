import { z } from "zod";
import { Name } from "./fields";
import { ListStatus, PageQuery, pageOf, SearchText } from "./lists";

// Storerooms (spec section 3, #88): where stock is kept. The restaurant has three (spec 11.1).

export const STOREROOM_TYPES = ["cold_room", "dry_store", "bar"] as const;
export const StoreroomType = z.enum(STOREROOM_TYPES);
export type StoreroomType = z.infer<typeof StoreroomType>;

export const Storeroom = z.object({
  id: z.uuid(),
  name: z.string(),
  type: StoreroomType,
  active: z.boolean(),
});
export type Storeroom = z.infer<typeof Storeroom>;

/** Body of `POST /api/storerooms`. The name is unique, whatever its case. */
export const NewStoreroom = z.strictObject({ name: Name, type: StoreroomType });
export type NewStoreroom = z.infer<typeof NewStoreroom>;

/** Body of `PATCH /api/storerooms/:id`: only the fields to change. `active: false` deactivates. */
export const StoreroomChanges = z.strictObject({
  name: Name.optional(),
  type: StoreroomType.optional(),
  active: z.boolean().optional(),
});
export type StoreroomChanges = z.infer<typeof StoreroomChanges>;

/** Query of `GET /api/storerooms`. */
export const StoreroomQuery = PageQuery.extend({
  q: SearchText,
  type: StoreroomType.optional(),
  status: ListStatus,
});
export type StoreroomQuery = z.infer<typeof StoreroomQuery>;

export const StoreroomPage = pageOf(Storeroom);
export type StoreroomPage = z.infer<typeof StoreroomPage>;
