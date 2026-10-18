// Searching a list of options (#85): what people type rarely has the accents or capitals the
// option has, so "limon" must find "Limón".

/** Lowercase, without accents, and with single spaces: "Crème  Brûlée" is "creme brulee". */
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether `label` has every word of `query`, anywhere and in any order. "" matches all. */
export function matchesSearch(label: string, query: string): boolean {
  const target = normalizeForSearch(label);
  return normalizeForSearch(query)
    .split(" ")
    .filter(Boolean)
    .every((word) => target.includes(word));
}
