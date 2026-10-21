import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ExtractedDocument } from "@kitchen-ops/shared";
import { GOLD_DIRECTORY } from "../gold/gold-set";
import {
  FACTURAE_NAMESPACES,
  FACTURAE_UNITS,
  parseFacturae,
  type FacturaeVersion,
} from "./facturae";

const GOLD = "syn-006-facturae";
const goldXml = readFileSync(
  new URL(`${GOLD}/source.xml`, GOLD_DIRECTORY),
  "utf8",
);
const goldExpected = ExtractedDocument.parse(
  JSON.parse(
    readFileSync(new URL(`${GOLD}/expected.json`, GOLD_DIRECTORY), "utf8"),
  ),
);

/** The gold file with some text replaced; each piece must be there, so a typo can't hide. */
function variant(...replacements: [string, string][]): string {
  let xml = goldXml;
  for (const [from, to] of replacements) {
    if (!xml.includes(from)) throw new Error(`not in the gold file: ${from}`);
    xml = xml.replaceAll(from, to);
  }
  return xml;
}

const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Each line's DeliveryNotesReferences, as Facturae holds them: per line, not per invoice. */
const references = (numbers: readonly string[]) =>
  numbers.length === 0
    ? ""
    : `<DeliveryNotesReferences>${numbers
        .map(
          (n) =>
            `<DeliveryNote><DeliveryNoteNumber>${escape(n)}</DeliveryNoteNumber></DeliveryNote>`,
        )
        .join("")}</DeliveryNotesReferences>`;

const UNIT_CODES = new Map(
  Object.entries(FACTURAE_UNITS).flatMap(([code, name]) =>
    name === null ? [] : [[name, code] as const],
  ),
);

/**
 * Test-only: the smallest Facturae file holding `document`, to check that parsing gives back
 * what was written. Not a Facturae writer for real use: the system never issues invoices.
 */
function writeFacturae(
  document: ExtractedDocument,
  version: FacturaeVersion,
): string {
  const element = (name: string, value: string | null) =>
    value === null ? "" : `<${name}>${escape(value)}</${name}>`;
  const tax = (rate: string | null, base = "0.00", amount = "0.00") =>
    `<Tax><TaxTypeCode>01</TaxTypeCode>${element("TaxRate", rate)}<TaxableBase><TotalAmount>${base}</TotalAmount></TaxableBase><TaxAmount><TotalAmount>${amount}</TotalAmount></TaxAmount></Tax>`;
  const lines = document.lines.map((line, i) => {
    const unit =
      line.unit === null ? null : (UNIT_CODES.get(line.unit) ?? null);
    const discount =
      line.discountPercent === null
        ? ""
        : `<DiscountsAndRebates><Discount><DiscountReason>Descuento</DiscountReason>${element("DiscountRate", line.discountPercent)}<DiscountAmount>0.00</DiscountAmount></Discount></DiscountsAndRebates>`;
    return `<InvoiceLine>${references(i === 0 ? document.deliveryNotes : [])}${element("ItemDescription", line.description)}${element("Quantity", line.quantity)}${element("UnitOfMeasure", unit)}${element("UnitPriceWithoutTax", line.unitPrice)}<TotalCost>0.00</TotalCost>${discount}${element("GrossAmount", line.lineTotal)}<TaxesOutputs>${tax(line.vatRate)}</TaxesOutputs>${element("ArticleCode", line.supplierCode)}</InvoiceLine>`;
  });
  const totals = document.totals;
  return `<?xml version="1.0" encoding="UTF-8"?>
<fe:Facturae xmlns:fe="${FACTURAE_NAMESPACES[version]}">
<Parties><SellerParty><TaxIdentification>${element("TaxIdentificationNumber", document.supplier.taxId)}</TaxIdentification><LegalEntity>${element("CorporateName", document.supplier.name)}</LegalEntity></SellerParty></Parties>
<Invoices><Invoice>
<InvoiceHeader>${element("InvoiceNumber", document.number)}</InvoiceHeader>
<InvoiceIssueData>${element("IssueDate", document.issueDate)}<InvoiceCurrencyCode>EUR</InvoiceCurrencyCode></InvoiceIssueData>
<TaxesOutputs>${(totals?.vat ?? []).map((row) => tax(row.rate, row.base ?? undefined, row.amount ?? undefined)).join("")}</TaxesOutputs>
<InvoiceTotals>${element("TotalGrossAmountBeforeTaxes", totals?.net ?? null)}<TotalTaxesWithheld>0.00</TotalTaxesWithheld>${element("InvoiceTotal", totals?.total ?? null)}</InvoiceTotals>
<Items>${lines.join("\n")}</Items>
</Invoice></Invoices>
</fe:Facturae>`;
}

// Generated invoices, within what Facturae can carry: an invoice always has a number, a date,
// totals and, on every line, a description, quantity, price, VAT rate and total.
const text = fc
  .string({
    unit: fc.constantFrom(..."abcñáé XYZ0129-/.,&<>\"'·()%"),
    minLength: 1,
    maxLength: 30,
  })
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
/**
 * A decimal as a Facturae file would hold it once its padding is gone: no zeros at the end of
 * the decimals beyond the second.
 */
const decimal = (decimals: number) =>
  fc
    .tuple(
      fc.boolean(),
      fc.integer({ min: 0, max: 99_999 }),
      fc.string({
        unit: fc.constantFrom(..."0123456789"),
        maxLength: decimals,
      }),
    )
    .filter(([, , fraction]) => fraction.length <= 2 || !fraction.endsWith("0"))
    .map(
      ([negative, whole, fraction]) =>
        `${negative ? "-" : ""}${whole}${fraction === "" ? "" : `.${fraction}`}`,
    );
const percentage = fc
  .tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.string({ unit: fc.constantFrom(..."0123456789"), maxLength: 2 }),
  )
  .map(([whole, fraction]) =>
    fraction === "" ? `${whole}` : `${whole}.${fraction}`,
  );
const date = fc
  .integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2030, 11, 31) })
  .map((ms) => new Date(ms).toISOString().slice(0, 10));
const invoice: fc.Arbitrary<ExtractedDocument> = fc.record({
  documentType: fc.constant("invoice" as const),
  currency: fc.constant("EUR" as const),
  supplier: fc.record({
    name: text,
    taxId: fc.string({
      unit: fc.constantFrom(..."ABCDEFGHJNPQRSUVW0123456789"),
      minLength: 9,
      maxLength: 11,
    }),
  }),
  number: text,
  issueDate: date,
  deliveryNotes: fc.uniqueArray(text, { maxLength: 3 }),
  totals: fc.record({
    net: decimal(2),
    vat: fc.array(
      fc.record({ rate: percentage, base: decimal(2), amount: decimal(2) }),
      { maxLength: 3 },
    ),
    total: decimal(2),
  }),
  lines: fc.array(
    fc.record({
      supplierCode: fc.option(text, { nil: null }),
      description: text,
      quantity: decimal(6),
      unit: fc.option(fc.constantFrom(...UNIT_CODES.keys()), { nil: null }),
      unitPrice: decimal(6),
      discountPercent: fc.option(percentage, { nil: null }),
      vatRate: percentage,
      lineTotal: decimal(2),
    }),
    { minLength: 1, maxLength: 5 },
  ),
});

describe("parseFacturae: a Facturae 3.2.x e-invoice read directly, without a model", () => {
  it("the gold Facturae invoice gives exactly its hand-written answer", () => {
    expect(parseFacturae(goldXml)).toEqual({
      status: "extracted",
      document: goldExpected,
    });
  });

  it("any invoice written as Facturae 3.2, 3.2.1 or 3.2.2 parses back to the same values", () => {
    fc.assert(
      fc.property(
        invoice,
        fc.constantFrom<FacturaeVersion>("3.2", "3.2.1", "3.2.2"),
        (document, version) => {
          expect(ExtractedDocument.safeParse(document).success).toBe(true);
          expect(parseFacturae(writeFacturae(document, version))).toEqual({
            status: "extracted",
            document,
          });
        },
      ),
    );
  });

  it("lists the delivery notes its lines reference, each once, in the order they first appear (#120)", () => {
    const [head, ...lines] = goldXml.split("<InvoiceLine>");
    const perLine = [["AV-1", "AV-2"], ["AV-2"], [], ["AV-0"]];
    const xml = [
      head,
      ...lines.map((line, i) => `${references(perLine[i]!)}${line}`),
    ].join("<InvoiceLine>");
    const result = parseFacturae(xml);
    expect(result.status).toBe("extracted");
    expect(
      result.status === "extracted" && result.document.deliveryNotes,
    ).toEqual(["AV-1", "AV-2", "AV-0"]);
  });

  it("the document number is the series code followed by the invoice number", () => {
    const result = parseFacturae(goldXml);
    expect(result.status === "extracted" && result.document.number).toBe(
      "LI260482",
    );
    const noSeries = parseFacturae(
      variant(["<InvoiceSeriesCode>LI26</InvoiceSeriesCode>", ""]),
    );
    expect(noSeries.status === "extracted" && noSeries.document.number).toBe(
      "0482",
    );
  });

  it("zeros after the second decimal are dropped, which changes no value", () => {
    const result = parseFacturae(goldXml);
    if (result.status !== "extracted") throw new Error(result.status);
    const butter = result.document.lines[1]!;
    // 4.400000, 5.0000 and 41.800000 in the file.
    expect(butter.unitPrice).toBe("4.40");
    expect(butter.discountPercent).toBe("5.00");
    expect(butter.lineTotal).toBe("41.80");
  });

  it("a value with more decimals than the schema allows goes to review, naming the field: it is never rounded", () => {
    const result = parseFacturae(
      variant([
        "<InvoiceTotal>192.21</InvoiceTotal>",
        "<InvoiceTotal>192.215</InvoiceTotal>",
      ]),
    );
    expect(result).toMatchObject({ status: "needs-review" });
    if (result.status !== "needs-review") return;
    expect(result.issues).toEqual([
      "totals.total: must be a decimal with at most 2 decimals, written with a point",
    ]);
  });

  it("units come from Facturae's codes; 'other' or no unit is null, never a guess", () => {
    const unit = (xml: string) => {
      const result = parseFacturae(xml);
      return result.status === "extracted"
        ? result.document.lines[0]!.unit
        : result;
    };
    expect(unit(goldXml)).toBe("caja");
    expect(
      unit(
        variant([
          "<UnitOfMeasure>06</UnitOfMeasure>",
          "<UnitOfMeasure>05</UnitOfMeasure>",
        ]),
      ),
    ).toBeNull();
    expect(unit(variant(["<UnitOfMeasure>06</UnitOfMeasure>", ""]))).toBeNull();
    expect(FACTURAE_UNITS["03"]).toBe("kg");
    expect(Object.keys(FACTURAE_UNITS)).toHaveLength(36);
  });

  it("an element that isn't there becomes null", () => {
    const result = parseFacturae(
      variant(
        ["<IssueDate>2026-10-14</IssueDate>", ""],
        ["<ArticleCode>LI-010</ArticleCode>", ""],
      ),
    );
    if (result.status !== "extracted") throw new Error(result.status);
    expect(result.document.issueDate).toBeNull();
    expect(result.document.lines[0]!.supplierCode).toBeNull();
  });

  it("a person as seller: name and surnames", () => {
    const result = parseFacturae(
      variant(
        [
          "<LegalEntity>\n        <CorporateName>Lácteos Inventados S.L.</CorporateName>",
          "<Individual>\n        <Name>Ana</Name><FirstSurname>Ficticia</FirstSurname><SecondSurname>Ejemplo</SecondSurname>",
        ],
        [
          "</AddressInSpain>\n      </LegalEntity>\n    </SellerParty>",
          "</AddressInSpain>\n      </Individual>\n    </SellerParty>",
        ],
      ),
    );
    if (result.status !== "extracted") throw new Error(result.status);
    expect(result.document.supplier.name).toBe("Ana Ficticia Ejemplo");
  });

  it("the tax ID is written like the schema asks: upper case, without spaces, dots or hyphens", () => {
    const result = parseFacturae(
      variant([
        "<TaxIdentificationNumber>B00444331</TaxIdentificationNumber>",
        "<TaxIdentificationNumber>b-00.444.331</TaxIdentificationNumber>",
      ]),
    );
    if (result.status !== "extracted") throw new Error(result.status);
    expect(result.document.supplier.taxId).toBe("B00444331");
  });

  describe("what goes to review, with the reason, instead of being read wrongly", () => {
    const invoiceElement = goldXml.slice(
      goldXml.indexOf("<Invoice>"),
      goldXml.indexOf("</Invoice>") + "</Invoice>".length,
    );
    it.each([
      [
        "a batch of two invoices",
        variant(["</Invoice>\n", `</Invoice>\n${invoiceElement}\n`]),
        "the file holds 2 invoices: one per document is supported",
      ],
      [
        "a currency other than euros",
        variant([
          "<InvoiceCurrencyCode>EUR</InvoiceCurrencyCode>",
          "<InvoiceCurrencyCode>USD</InvoiceCurrencyCode>",
        ]),
        "the invoice isn't in euros",
      ],
      [
        "a tax other than IVA (IGIC, code 03)",
        variant([
          "<TaxTypeCode>01</TaxTypeCode>\n          <TaxRate>4.00</TaxRate>\n          <TaxableBase>\n            <TotalAmount>122.28",
          "<TaxTypeCode>03</TaxTypeCode>\n          <TaxRate>4.00</TaxRate>\n          <TaxableBase>\n            <TotalAmount>122.28",
        ]),
        "a tax other than IVA (code 03)",
      ],
      [
        "an equivalence surcharge",
        variant([
          "<TotalAmount>4.89</TotalAmount>\n          </TaxAmount>",
          "<TotalAmount>4.89</TotalAmount>\n          </TaxAmount>\n          <EquivalenceSurcharge>0.50</EquivalenceSurcharge>",
        ]),
        "an equivalence surcharge (recargo de equivalencia)",
      ],
      [
        "a withholding",
        variant([
          "<TotalTaxesWithheld>0.00</TotalTaxesWithheld>",
          "<TotalTaxesWithheld>1.80</TotalTaxesWithheld>",
        ]),
        "a withholding (retención)",
      ],
      [
        "two discounts on one line",
        variant([
          "</Discount>\n",
          "</Discount>\n<Discount><DiscountReason>Pronto pago</DiscountReason><DiscountRate>2.00</DiscountRate><DiscountAmount>0.84</DiscountAmount></Discount>\n",
        ]),
        "line 2 has 2 discounts",
      ],
    ])("%s", (_case, xml, reason) => {
      expect(parseFacturae(xml)).toEqual({
        status: "needs-review",
        reason,
        issues: [],
      });
    });
  });

  describe("what isn't Facturae 3.2.x", () => {
    it.each([
      [
        "another Facturae version (3.1)",
        variant([
          FACTURAE_NAMESPACES["3.2.2"],
          "http://www.facturae.es/Facturae/2007/v3.1/Facturae",
        ]),
        "XML that isn't Facturae 3.2, 3.2.1 or 3.2.2",
      ],
      [
        "a UBL invoice",
        '<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>',
        "XML that isn't Facturae 3.2, 3.2.1 or 3.2.2",
      ],
      [
        "XML that isn't well-formed",
        goldXml.slice(0, 500),
        "the XML isn't well-formed",
      ],
      [
        "a DOCTYPE, which Facturae never has: no entities are expanded",
        `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa">]>${goldXml.slice(goldXml.indexOf("<fe:Facturae"))}`,
        "the XML has a DOCTYPE, which Facturae never has",
      ],
    ])("%s", (_case, xml, reason) => {
      expect(parseFacturae(xml)).toEqual({ status: "not-facturae", reason });
    });
  });

  it("reasons and issues never quote the document", () => {
    const result = parseFacturae(
      variant([
        "<InvoiceTotal>192.21</InvoiceTotal>",
        "<InvoiceTotal>192.215</InvoiceTotal>",
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("192.215");
  });
});
