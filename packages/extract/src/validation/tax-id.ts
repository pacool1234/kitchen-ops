// Spanish tax IDs and their control characters (spec section 5, stage 4: "supplier tax ID passes
// its checksum"). Input is as `ExtractedDocument` holds it: upper case, no spaces, dots or hyphens.

export type TaxIdCheck =
  | { readonly valid: true; readonly kind: "NIF" | "NIE" | "CIF" }
  | { readonly valid: false; readonly reason: string };

/** NIF and NIE control letters, indexed by the number mod 23. */
const NIF_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
/** A CIF's control as a letter, indexed by its control digit. */
const CIF_LETTERS = "JABCDEFGHI";
/** Organisation types whose CIF control is always a digit (companies). */
const CIF_DIGIT_ONLY = "ABEH";
/** Organisation types whose CIF control is always a letter (public bodies, foreign entities…). */
const CIF_LETTER_ONLY = "PQSNW";

/**
 * The control digit of a CIF's 7 digits: the even positions added as they are, the odd ones
 * doubled with their digits added (8 → 16 → 7), then (10 − sum mod 10) mod 10.
 */
function cifControl(digits: string): number {
  let sum = 0;
  [...digits].forEach((character, i) => {
    const digit = Number(character);
    if (i % 2 === 1) {
      sum += digit;
    } else {
      const doubled = 2 * digit;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    }
  });
  return (10 - (sum % 10)) % 10;
}

const invalid = (reason: string): TaxIdCheck => ({ valid: false, reason });

/** Whether a NIF, NIE or CIF has the right control character. An `ES` prefix is allowed. */
export function checkSpanishTaxId(taxId: string): TaxIdCheck {
  let id = taxId;
  if (/^ES[A-Z0-9]{9}$/.test(id)) {
    id = id.slice(2);
  } else if (/^[A-Z]{2}[A-Z0-9]+$/.test(id) && id.length !== 9) {
    return invalid(`a foreign tax ID (${id.slice(0, 2)}) can't be verified`);
  }

  const nif = /^(\d{8})([A-Z])$/.exec(id);
  if (nif) {
    const expected = NIF_LETTERS[Number(nif[1]) % 23];
    return nif[2] === expected
      ? { valid: true, kind: "NIF" }
      : invalid(`the NIF's control letter should be ${expected}`);
  }

  const nie = /^([XYZ])(\d{7})([A-Z])$/.exec(id);
  if (nie) {
    const number = Number(`${"XYZ".indexOf(nie[1] ?? "")}${nie[2]}`);
    const expected = NIF_LETTERS[number % 23];
    return nie[3] === expected
      ? { valid: true, kind: "NIE" }
      : invalid(`the NIE's control letter should be ${expected}`);
  }

  const cif = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(id);
  if (cif) {
    const [, type = "", digits = "", control] = cif;
    const digit = cifControl(digits);
    const asDigit = control === String(digit);
    const asLetter = control === CIF_LETTERS[digit];
    const valid = CIF_DIGIT_ONLY.includes(type)
      ? asDigit
      : CIF_LETTER_ONLY.includes(type)
        ? asLetter
        : asDigit || asLetter;
    return valid
      ? { valid: true, kind: "CIF" }
      : invalid(
          `the CIF's control should be ${CIF_DIGIT_ONLY.includes(type) ? digit : CIF_LETTER_ONLY.includes(type) ? CIF_LETTERS[digit] : `${digit} or ${CIF_LETTERS[digit]}`}`,
        );
  }

  return invalid("not a NIF, NIE or CIF");
}
