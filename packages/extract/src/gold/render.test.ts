import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtractedDocument, ExtractedLine } from "@kitchen-ops/shared";
import { pdfPageTexts } from "../route/pdf";
import {
  formatDate,
  formatDecimal,
  formatTaxId,
  renderGoldPdf,
} from "./render";

describe("Spanish formatting, as printed on the rendered documents", () => {
  it("decimals: a comma for decimals and dots for thousands, keeping the decimals given", () => {
    expect(formatDecimal("1234.56")).toBe("1.234,56");
    expect(formatDecimal("1234567.5")).toBe("1.234.567,5");
    expect(formatDecimal("2.350")).toBe("2,350");
    expect(formatDecimal("-7.00")).toBe("-7,00");
    expect(formatDecimal("-1234")).toBe("-1.234");
    expect(formatDecimal("999")).toBe("999");
  });

  it("dates: 2026-10-15 is 15/10/2026", () => {
    expect(formatDate("2026-10-15")).toBe("15/10/2026");
  });

  it("tax IDs: a CIF B12345678 is printed B-12.345.678; anything else as it is", () => {
    expect(formatTaxId("B12345678")).toBe("B-12.345.678");
    expect(formatTaxId("ESB12345678")).toBe("ESB12345678");
  });
});

function line(i: number): ExtractedLine {
  return {
    supplierCode: `P-${i}`,
    description: `Producto ${i}`,
    quantity: "1",
    unit: "kg",
    unitPrice: "1.00",
    discountPercent: null,
    vatRate: "10",
    lineTotal: "1.00",
  };
}

function invoiceWith(lines: number): ExtractedDocument {
  const net = `${lines}.00`;
  return {
    documentType: "invoice",
    currency: "EUR",
    supplier: { name: "Proveedor Ficticio S.L.", taxId: "B00000000" },
    number: "F-1",
    issueDate: "2026-10-15",
    deliveryNotes: [],
    totals: { net, vat: [], total: net },
    lines: Array.from({ length: lines }, (_, i) => line(i + 1)),
  };
}

/** Pages in a PDF: page objects are not compressed, so they can be counted in the bytes. */
function pageCount(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
}

describe("renderGoldPdf: a synthetic document from its expected.json", () => {
  it("is a PDF", async () => {
    const pdf = await renderGoldPdf(invoiceWith(3));
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is the same, byte for byte, every time: no clock, no randomness", async () => {
    // Only Date is faked; the clock is moved between the two renders, so reading it would show.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    const first = await renderGoldPdf(invoiceWith(3));
    vi.setSystemTime(new Date("2030-06-15T12:34:56Z"));
    const second = await renderGoldPdf(invoiceWith(3));
    expect(first.equals(second)).toBe(true);
  });

  it("changes when the answer changes", async () => {
    const original = await renderGoldPdf(invoiceWith(3));
    const changed = await renderGoldPdf({ ...invoiceWith(3), number: "F-2" });
    expect(original.equals(changed)).toBe(false);
  });

  it("an invoice prints the delivery notes it lists, under its date; one that lists none, nothing (#120)", async () => {
    const text = async (deliveryNotes: string[]) =>
      (
        await pdfPageTexts(
          new Uint8Array(
            await renderGoldPdf({ ...invoiceWith(3), deliveryNotes }),
          ),
        )
      ).join("\n");
    expect(await text(["A-1"])).toContain("Albarán: A-1");
    expect(await text(["A-1", "A-2"])).toContain("Albaranes: A-1, A-2");
    expect(await text([])).not.toContain("Albar");
  });

  it("3 lines fit on one page; 40 lines take more than one", async () => {
    expect(pageCount(await renderGoldPdf(invoiceWith(3)))).toBe(1);
    expect(pageCount(await renderGoldPdf(invoiceWith(40)))).toBeGreaterThan(1);
  });
});
