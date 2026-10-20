import type { FieldErrorCode, MatchedBy } from "@kitchen-ops/shared";

// The matching rules (#117, decision 0035), apart from the database: a read line to one of the
// supplier's supplier products, by code and then by exact description, and whether a line can
// be remembered as a new one without making a match ambiguous.

/** One of the supplier's supplier products, as matching needs it. */
export interface Offer {
  readonly id: string;
  /** Stored trimmed, and unique per supplier when set. */
  readonly code: string | null;
  readonly description: string;
  /** Active, and its product too: only these match. */
  readonly usable: boolean;
}

/** A line as read: what it's matched by. */
export interface ReadLine {
  readonly supplierCode: string | null;
  readonly description: string | null;
}

export interface Match {
  readonly by: MatchedBy;
  readonly offerId: string;
}

/** A line's code as a supplier product keeps it: trimmed, and blank is none. */
export const codeOf = (line: ReadLine): string | null =>
  line.supplierCode?.trim() || null;

/** "Exact" description: case and runs of spaces don't count, accents do. Blank is none. */
const comparable = (description: string | null): string | null =>
  description?.trim().replace(/\s+/g, " ").toLowerCase() || null;

const withDescription = (offers: readonly Offer[], line: ReadLine) => {
  const wanted = comparable(line.description);
  return wanted === null
    ? []
    : offers.filter((o) => o.usable && comparable(o.description) === wanted);
};

/** The supplier product a line is, if one is: by its code, else by a description only one has. */
export function matchLine(
  line: ReadLine,
  offers: readonly Offer[],
): Match | null {
  const code = codeOf(line);
  const byCode =
    code === null ? undefined : offers.find((o) => o.usable && o.code === code);
  if (byCode) return { by: "code", offerId: byCode.id };
  const byDescription = withDescription(offers, line);
  return byDescription.length === 1
    ? { by: "description", offerId: byDescription[0]!.id }
    : null;
}

/**
 * Why a line can't be remembered as a new supplier product, by field, or null if it can:
 * its code is already the supplier's, or it has no code and its description already matches.
 * Either way, remembering it wouldn't make it match next time.
 */
export function mappingRefusal(
  line: ReadLine,
  offers: readonly Offer[],
): Record<string, FieldErrorCode> | null {
  const code = codeOf(line);
  if (code !== null) {
    // Any of the supplier's, active or not: codes are unique per supplier.
    return offers.some((o) => o.code === code) ? { code: "taken" } : null;
  }
  return withDescription(offers, line).length > 0
    ? { description: "taken" }
    : null;
}
