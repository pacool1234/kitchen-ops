/**
 * A valid CIF for a fictional company, different for each `n` (0 to 99 999): "B00" and `n`, then
 * the control digit. Province 00 doesn't exist, so it belongs to no real company.
 */
export function syntheticCif(n: number): string {
  const digits = `00${String(n).padStart(5, "0")}`;
  let sum = 0;
  [...digits].forEach((character, i) => {
    const doubled = 2 * Number(character);
    sum +=
      i % 2 === 1
        ? Number(character)
        : Math.floor(doubled / 10) + (doubled % 10);
  });
  return `B${digits}${(10 - (sum % 10)) % 10}`;
}
