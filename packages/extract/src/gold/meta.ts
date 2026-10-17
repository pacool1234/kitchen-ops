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

/**
 * How a synthetic text PDF was made: rendered from its expected.json by `gold:render`, or made
 * elsewhere (by hand or with another tool) and checked by a person.
 */
export const GOLD_MADE = ["rendered", "elsewhere"] as const;

/** `meta.json` in each gold folder. Unknown keys are rejected, so a typo can't hide a field. */
export const GoldMeta = z.strictObject({
  origin: z.enum(GOLD_ORIGINS),
  kind: z.enum(GOLD_KINDS),
  /** Required for a synthetic text PDF, and only there (checked in `goldEntryProblems`). */
  made: z.enum(GOLD_MADE).optional(),
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

/**
 * Whether `gold:render` writes this document's source.pdf, and so whether the gold set test checks
 * it against the renderer. A PDF made elsewhere is never overwritten.
 */
export function isRendered(meta: GoldMeta): boolean {
  return (
    meta.origin === "synthetic" &&
    meta.kind === "text-pdf" &&
    meta.made === "rendered"
  );
}
