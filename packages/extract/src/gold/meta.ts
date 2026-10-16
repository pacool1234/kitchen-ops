import { z } from "zod";

/**
 * Where a gold document comes from. Client documents are never gold documents: they stay in the
 * private eval folder (spec section 8).
 */
export const GOLD_ORIGINS = ["own", "public", "synthetic"] as const;

/** What kind of input a gold document is, which decides how it is routed (spec section 5). */
export const GOLD_KINDS = [
  "text-pdf",
  "scan",
  "photo",
  "facturae-xml",
] as const;
export type GoldKind = (typeof GOLD_KINDS)[number];

/** The kinds each source file type can be. */
export const KINDS_BY_EXTENSION: Readonly<Record<string, readonly GoldKind[]>> =
  {
    pdf: ["text-pdf", "scan"],
    jpg: ["photo", "scan"],
    png: ["photo", "scan"],
    xml: ["facturae-xml"],
  };

/** `meta.json` in each gold folder. Unknown keys are rejected, so a typo can't hide a field. */
export const GoldMeta = z.strictObject({
  origin: z.enum(GOLD_ORIGINS),
  kind: z.enum(GOLD_KINDS),
  /** What makes this document hard. Never client data. */
  notes: z.string().min(1),
  /**
   * Who checked `expected.json` against the source, and when. Gold answers are written or
   * checked by a person, never copied from model output (`.claude/rules/extract.md`). null until
   * someone has.
   */
  checked: z
    .strictObject({ by: z.string().min(1), on: z.iso.date() })
    .nullable(),
});
export type GoldMeta = z.infer<typeof GoldMeta>;
