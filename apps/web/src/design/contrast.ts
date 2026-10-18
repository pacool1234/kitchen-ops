// WCAG 2.2's contrast ratio (https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio), for the token
// tests and the gallery's colour swatches.

/** A channel of an sRGB colour, 0 to 255, as linear light. */
function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** How bright a colour looks, 0 (black) to 1 (white). */
function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) =>
    linear(Number.parseInt(hex.slice(i, i + 2), 16)),
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** The contrast between two `#rrggbb` colours: 1 (none) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (light! + 0.05) / (dark! + 0.05);
}
