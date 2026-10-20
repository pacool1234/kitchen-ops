import { z } from "zod";

// What a refused request answers (#88): a short code for the whole answer, which the web app
// translates (`forbidden`, `not_found`), and for invalid input one code per field, keyed by the
// field's path (`taxId`, `lines.1.quantity`), shown next to that field.

/** Why a field was refused. A closed list, so the web app can have a message for each. */
export const FIELD_ERROR_CODES = [
  /** Missing, or blank once trimmed. */
  "required",
  /** The wrong type, or not one of the values allowed. */
  "invalid",
  "too_short",
  "too_long",
  "too_small",
  "too_big",
  /** A field the endpoint doesn't take. */
  "unknown_field",
  "invalid_tax_id",
  /** A value that must be unique, already used (409). */
  "taken",
  /** A name kept for something else: a product's base unit, which every product has. */
  "reserved",
  /** A reference to a row that doesn't exist: a storeroom, a supplier, a product. */
  "not_found",
  /** Something other rows rely on, which can't be removed or changed so (409). */
  "in_use",
  /** A pack's unit that isn't one of the product's. */
  "unknown_unit",
  /** A pack that isn't a whole number of base units: 0.0001 kg is 0.1 g. */
  "not_whole_base_units",
  /** A line that would take stock below zero (invariant 6, #119). */
  "below_zero",
  /** More files than an upload may hold. */
  "too_many",
  /** A file that isn't a PDF, a Facturae XML, a JPEG or a PNG, by its bytes. */
  "unsupported_type",
  /** A PDF or XML file sent with other files: it makes a document on its own. */
  "mixed_kinds",
] as const;
export const FieldErrorCode = z.enum(FIELD_ERROR_CODES);
export type FieldErrorCode = z.infer<typeof FieldErrorCode>;

/**
 * Every error answer: `error`, and `fields` for invalid input or a conflict. A file already
 * received names the document that has it in `duplicateOf` (#102).
 */
export const ErrorBody = z.object({
  error: z.string(),
  fields: z.record(z.string(), FieldErrorCode).optional(),
  duplicateOf: z.uuid().optional(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/** A refinement's options, so the field it refuses answers with this code. */
export function fieldError(code: FieldErrorCode) {
  return { params: { code } };
}

/** One of Zod's issues, as far as its field code needs it. */
export interface FieldIssue {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  /** What was checked, for too_small and too_big: "string", "number", "array"… */
  readonly origin?: unknown;
  readonly minimum?: unknown;
  /** For unrecognized_keys: the fields the schema doesn't take. */
  readonly keys?: readonly string[];
  /** For a refinement: `{ code }`, from `fieldError(...)`. */
  readonly params?: unknown;
}

function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  return path.reduce<unknown>(
    (value, key) =>
      value !== null && typeof value === "object"
        ? (value as Record<PropertyKey, unknown>)[key]
        : undefined,
    input,
  );
}

const isFieldErrorCode = (code: unknown): code is FieldErrorCode =>
  (FIELD_ERROR_CODES as readonly unknown[]).includes(code);

/** Why Zod refused a field, as one of the codes the web app has a message for. */
function fieldCode(issue: FieldIssue, value: unknown): FieldErrorCode {
  // Not sent at all, whatever Zod expected there (a string, one of an enum's values…).
  if (value === undefined) return "required";
  switch (issue.code) {
    case "too_small":
      if (issue.origin !== "string") return "too_small";
      // Blank once trimmed counts as missing.
      return Number(issue.minimum) <= 1 ? "required" : "too_short";
    case "too_big":
      return issue.origin === "string" ? "too_long" : "too_big";
    case "custom": {
      // A refinement's own code: `fieldError("invalid_tax_id")`.
      const code = (issue.params as { code?: unknown } | undefined)?.code;
      return isFieldErrorCode(code) ? code : "invalid";
    }
    default:
      return "invalid";
  }
}

/**
 * Each refused field's path (`lines.1.quantity`) and code, from Zod's issues and the input they
 * were about; the first issue per field wins. The API answers with these (#88), and the web
 * app's forms check with them (#89), so both say the same about the same input.
 */
export function fieldErrors(
  issues: readonly FieldIssue[],
  input: unknown,
): Record<string, FieldErrorCode> {
  const fields: Record<string, FieldErrorCode> = {};
  const add = (path: readonly PropertyKey[], code: FieldErrorCode) => {
    fields[path.map(String).join(".")] ??= code;
  };
  for (const issue of issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys ?? [])
        add([...issue.path, key], "unknown_field");
    } else {
      add(issue.path, fieldCode(issue, valueAt(input, issue.path)));
    }
  }
  return fields;
}
