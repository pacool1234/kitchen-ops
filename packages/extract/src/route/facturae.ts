import { DOMParser, type Element } from "@xmldom/xmldom";
import { ExtractedDocument } from "@kitchen-ops/shared";

// Facturae, Spain's structured e-invoice (spec section 5, stage 2): read directly, no model. Values
// are copied, never calculated. Anything this reader can't represent faithfully (several
// invoices in one file, foreign currency, other taxes, withholdings) goes to review with a reason,
// rather than being read wrongly. The XAdES signature isn't verified.

/** The root element's namespace for each supported version (from the official XSDs). */
export const FACTURAE_NAMESPACES = {
  "3.2": "http://www.facturae.es/Facturae/2009/v3.2/Facturae",
  "3.2.1": "http://www.facturae.es/Facturae/2014/v3.2.1/Facturae",
  "3.2.2": "http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml",
} as const;
export type FacturaeVersion = keyof typeof FACTURAE_NAMESPACES;

/**
 * Facturae's unit codes (UnitOfMeasureType, the same in 3.2 to 3.2.2) as the short names a
 * printed document would use. "05" is "other": no unit we can name, so null.
 */
export const FACTURAE_UNITS: Readonly<Record<string, string | null>> = {
  "01": "ud",
  "02": "h",
  "03": "kg",
  "04": "l",
  "05": null,
  "06": "caja",
  "07": "bandeja",
  "08": "barril",
  "09": "bidón",
  "10": "bolsa",
  "11": "bombona",
  "12": "botella",
  "13": "bote",
  "14": "brik",
  "15": "cl",
  "16": "cm",
  "17": "cubo",
  "18": "docena",
  "19": "estuche",
  "20": "garrafa",
  "21": "g",
  "22": "km",
  "23": "lata",
  "24": "manojo",
  "25": "m",
  "26": "mm",
  "27": "pack de 6",
  "28": "paquete",
  "29": "ración",
  "30": "rollo",
  "31": "sobre",
  "32": "tarrina",
  "33": "m³",
  "34": "s",
  "35": "W",
  "36": "kWh",
};

/** IVA in TaxTypeCodeType. */
const IVA = "01";

export type FacturaeResult =
  | { readonly status: "extracted"; readonly document: ExtractedDocument }
  | {
      readonly status: "needs-review";
      readonly reason: string;
      /** Field paths and schema messages, never document contents. */
      readonly issues: readonly string[];
    }
  | { readonly status: "not-facturae"; readonly reason: string };

const notFacturae = (reason: string): FacturaeResult => ({
  status: "not-facturae",
  reason,
});
const review = (reason: string, issues: string[] = []): FacturaeResult => ({
  status: "needs-review",
  reason,
  issues,
});

/** Direct children with this name. Facturae's elements below the root have no namespace. */
function children(parent: Element | undefined, name: string): Element[] {
  const found: Element[] = [];
  for (let node = parent?.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && (node as Element).localName === name) {
      found.push(node as Element);
    }
  }
  return found;
}

function child(parent: Element | undefined, ...path: string[]) {
  let element = parent;
  for (const name of path) element = children(element, name)[0];
  return element;
}

/** The trimmed text at `path`, or null if the element isn't there or is empty. */
function text(parent: Element | undefined, ...path: string[]): string | null {
  const value = child(parent, ...path)?.textContent?.trim() ?? "";
  return value === "" ? null : value;
}

/**
 * Drops zeros after the second decimal ("6.900000" is "6.90"), which changes no value. Anything
 * else stays as written: if it doesn't fit the schema, the schema says so and it goes to review.
 */
function decimal(value: string | null): string | null {
  return value !== null && /^-?\d+\.\d{3,}$/.test(value)
    ? value.replace(/(\.\d{2}\d*?)0+$/, "$1")
    : value;
}

const isZero = (value: string | null) =>
  value === null || /^-?0*(\.0*)?$/.test(value);

function sellerName(seller: Element | undefined): string | null {
  const company = text(seller, "LegalEntity", "CorporateName");
  if (company !== null) return company;
  const person = child(seller, "Individual");
  const parts = ["Name", "FirstSurname", "SecondSurname"]
    .map((name) => text(person, name))
    .filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" ");
}

/** Why a tax can't be represented, or null if it's plain IVA. */
function taxProblem(tax: Element): string | null {
  const code = text(tax, "TaxTypeCode");
  if (code !== IVA) {
    return code !== null && /^\d{2}$/.test(code)
      ? `a tax other than IVA (code ${code})`
      : "a tax other than IVA";
  }
  if (
    !isZero(text(tax, "EquivalenceSurcharge")) ||
    !isZero(text(tax, "EquivalenceSurchargeAmount", "TotalAmount"))
  ) {
    return "an equivalence surcharge (recargo de equivalencia)";
  }
  return null;
}

export function parseFacturae(xml: string): FacturaeResult {
  // Checked before parsing, so no entity in a DTD is ever expanded.
  if (xml.includes("<!DOCTYPE")) {
    return notFacturae("the XML has a DOCTYPE, which Facturae never has");
  }
  let root: Element | null;
  try {
    root = new DOMParser({
      onError: (level) => {
        if (level !== "warning") throw new Error(level);
      },
    }).parseFromString(xml, "text/xml").documentElement;
  } catch {
    return notFacturae("the XML isn't well-formed");
  }
  const namespaces: readonly string[] = Object.values(FACTURAE_NAMESPACES);
  if (
    root === null ||
    root.localName !== "Facturae" ||
    !namespaces.includes(root.namespaceURI ?? "")
  ) {
    return notFacturae("XML that isn't Facturae 3.2, 3.2.1 or 3.2.2");
  }

  const invoices = children(child(root, "Invoices"), "Invoice");
  const [invoice] = invoices;
  if (invoice === undefined || invoices.length > 1) {
    return review(
      `the file holds ${invoices.length} invoices: one per document is supported`,
    );
  }
  if (text(invoice, "InvoiceIssueData", "InvoiceCurrencyCode") !== "EUR") {
    return review("the invoice isn't in euros");
  }

  const lines = children(child(invoice, "Items"), "InvoiceLine");
  const withheld =
    !isZero(text(invoice, "InvoiceTotals", "TotalTaxesWithheld")) ||
    [invoice, ...lines].some(
      (element) => children(child(element, "TaxesWithheld"), "Tax").length > 0,
    );
  if (withheld) return review("a withholding (retención)");

  const taxes = [invoice, ...lines].flatMap((element) =>
    children(child(element, "TaxesOutputs"), "Tax"),
  );
  for (const tax of taxes) {
    const problem = taxProblem(tax);
    if (problem !== null) return review(problem);
  }
  for (const [i, line] of lines.entries()) {
    const discounts = children(child(line, "DiscountsAndRebates"), "Discount");
    if (discounts.length > 1) {
      return review(`line ${i + 1} has ${discounts.length} discounts`);
    }
  }

  const seller = child(root, "Parties", "SellerParty");
  const taxId = text(seller, "TaxIdentification", "TaxIdentificationNumber");
  const series = text(invoice, "InvoiceHeader", "InvoiceSeriesCode");
  const number = text(invoice, "InvoiceHeader", "InvoiceNumber");
  const unitCode = (line: Element) => text(line, "UnitOfMeasure");

  const document = {
    documentType: "invoice",
    currency: "EUR",
    supplier: {
      name: sellerName(seller),
      taxId: taxId?.toUpperCase().replace(/[\s.-]/g, "") ?? null,
    },
    number: number === null ? null : `${series ?? ""}${number}`,
    issueDate: text(invoice, "InvoiceIssueData", "IssueDate"),
    // Facturae names them per line (#120); the draft lists each once, in the order first seen.
    deliveryNotes: [
      ...new Set(
        lines.flatMap((line) =>
          children(child(line, "DeliveryNotesReferences"), "DeliveryNote")
            .map((note) => text(note, "DeliveryNoteNumber"))
            .filter((n) => n !== null),
        ),
      ),
    ],
    totals: {
      net: decimal(
        text(invoice, "InvoiceTotals", "TotalGrossAmountBeforeTaxes"),
      ),
      vat: children(child(invoice, "TaxesOutputs"), "Tax").map((tax) => ({
        rate: decimal(text(tax, "TaxRate")),
        base: decimal(text(tax, "TaxableBase", "TotalAmount")),
        amount: decimal(text(tax, "TaxAmount", "TotalAmount")),
      })),
      total: decimal(text(invoice, "InvoiceTotals", "InvoiceTotal")),
    },
    lines: lines.map((line) => {
      const code = unitCode(line);
      return {
        supplierCode: text(line, "ArticleCode"),
        description: text(line, "ItemDescription"),
        quantity: decimal(text(line, "Quantity")),
        unit: code === null ? null : (FACTURAE_UNITS[code] ?? null),
        unitPrice: decimal(text(line, "UnitPriceWithoutTax")),
        discountPercent: decimal(
          text(line, "DiscountsAndRebates", "Discount", "DiscountRate"),
        ),
        vatRate: decimal(text(line, "TaxesOutputs", "Tax", "TaxRate")),
        lineTotal: decimal(text(line, "GrossAmount")),
      };
    }),
  };

  const result = ExtractedDocument.safeParse(document);
  if (!result.success) {
    return review(
      "values that don't fit the extraction schema",
      result.error.issues.map(
        (issue) =>
          `${issue.path.join(".") || "(the whole object)"}: ${issue.message}`,
      ),
    );
  }
  return { status: "extracted", document: result.data };
}
