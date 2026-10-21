import {
  EXTRACTED_DOCUMENT_TYPES,
  type BaseUnit,
  type Locale,
  type ProductMovement,
} from "@kitchen-ops/shared";
import { formatQuantity } from "../i18n/format";

// A movement on a product's stock page (#150): the document it came from, and how much moved.
// Waste and transfers have pages of their own (#151).

/** A page that shows a document: a supplier's, or waste or a transfer. */
export interface DocumentLink {
  name: "document" | "stock-document";
  id: string;
}

export interface MovementDocument {
  type: ProductMovement["document"]["type"];
  number: string | null;
  /** It undid another document's movements. */
  reversal: boolean;
  /** The page that shows it; none for a count, which has no page yet (#152). */
  link: DocumentLink | null;
}

/**
 * What a movement's document is called, and where it links. A reversal has no page of its own:
 * the document it reverses shows both.
 */
export function movementDocument(
  document: ProductMovement["document"],
): MovementDocument {
  const supplier = (EXTRACTED_DOCUMENT_TYPES as readonly string[]).includes(
    document.type,
  );
  const id = document.reverses ?? document.id;
  return {
    type: document.type,
    number: document.number,
    reversal: document.reverses !== null,
    link: supplier
      ? { name: "document", id }
      : document.type === "count"
        ? null
        : { name: "stock-document", id },
  };
}

/** How much moved, signed as it went: `+5 kg` into the storeroom, `-4 kg` out of it. */
export function signedQuantity(
  quantity: number,
  baseUnit: BaseUnit,
  locale: Locale,
): string {
  const text = formatQuantity(quantity, baseUnit, locale);
  return quantity > 0 ? `+${text}` : text;
}
