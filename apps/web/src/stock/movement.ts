import {
  EXTRACTED_DOCUMENT_TYPES,
  type BaseUnit,
  type Locale,
  type ProductMovement,
} from "@kitchen-ops/shared";
import { formatQuantity } from "../i18n/format";

// A movement on a product's stock page (#150): the document it came from, and how much moved.

export interface MovementDocument {
  type: ProductMovement["document"]["type"];
  number: string | null;
  /** It undid another document's movements. */
  reversal: boolean;
  /** The document page that shows it; none for a stock document, which has no page yet. */
  pageId: string | null;
}

/**
 * What a movement's document is called, and where it links. A reversal has no page of its own:
 * the document it reverses shows both. Waste, counts and transfers get pages in #151 and #152.
 */
export function movementDocument(
  document: ProductMovement["document"],
): MovementDocument {
  const supplier = (EXTRACTED_DOCUMENT_TYPES as readonly string[]).includes(
    document.type,
  );
  return {
    type: document.type,
    number: document.number,
    reversal: document.reverses !== null,
    pageId: supplier ? (document.reverses ?? document.id) : null,
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
