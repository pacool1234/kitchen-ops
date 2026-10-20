import type { DocumentSummary } from "@kitchen-ops/shared";
import type { useT } from "../i18n";

// How a document is named on screen (#106): its type and number once read, "Albarán A-42";
// "Sin leer" before.

export function documentName(
  t: ReturnType<typeof useT>,
  document: Pick<DocumentSummary, "type" | "number">,
): string {
  const { type, number } = document;
  if (!number) return t("documents.unread");
  return type
    ? t("documents.titled", { type: t(`documents.types.${type}`), number })
    : number;
}
