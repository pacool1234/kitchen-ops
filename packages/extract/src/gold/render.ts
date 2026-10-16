import PDFDocument from "pdfkit";
import type { ExtractedDocument, ExtractedLine } from "@kitchen-ops/shared";

// Renders a synthetic gold document from its expected.json, so the document matches its answer
// by construction. Values are printed the Spanish way ("1.234,56", "15/10/2026",
// "B-12.345.678"), so extraction has to convert them back, as with real documents. Everything
// else on the page (addresses, the customer) is fictional and not part of the answer.
//
// The output is deterministic: a fixed creation date, which pdfkit also uses for the file ID, and
// no other clock or randomness. The gold-set test re-renders and compares bytes.

const CREATED = new Date(Date.UTC(2026, 0, 1));

const PAGE_WIDTH = 595.28; // A4, in points
const PAGE_HEIGHT = 841.89;
const LEFT = 40;
const RIGHT = PAGE_WIDTH - 40;
const TABLE_TOP = 140;
const ROW = 15;
/** Lines stop here; the page number goes below. */
const BOTTOM = PAGE_HEIGHT - 60;
const SIZE = 9;

/** "1234.56" → "1.234,56": a comma for decimals and dots for thousands, keeping the decimals given. */
export function formatDecimal(value: string): string {
  const negative = value.startsWith("-");
  const [whole = "", decimals] = (negative ? value.slice(1) : value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped}${decimals === undefined ? "" : `,${decimals}`}`;
}

/** "2026-10-15" → "15/10/2026". */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

/** A CIF "B12345678" → "B-12.345.678"; anything else as it is. */
export function formatTaxId(taxId: string): string {
  const cif = /^([A-Z])(\d{2})(\d{3})(\d{2}[0-9A-J])$/.exec(taxId);
  return cif ? `${cif[1]}-${cif[2]}.${cif[3]}.${cif[4]}` : taxId;
}

interface Column {
  readonly title: string;
  readonly x: number;
  readonly width: number;
  readonly align: "left" | "right";
  readonly value: (line: ExtractedLine) => string | null;
}

const decimal = (value: string | null) =>
  value === null ? null : formatDecimal(value);

const PRICED_COLUMNS: readonly Column[] = [
  {
    title: "Código",
    x: 40,
    width: 52,
    align: "left",
    value: (l) => l.supplierCode,
  },
  {
    title: "Descripción",
    x: 94,
    width: 176,
    align: "left",
    value: (l) => l.description,
  },
  {
    title: "Cantidad",
    x: 272,
    width: 48,
    align: "right",
    value: (l) => decimal(l.quantity),
  },
  { title: "Ud.", x: 326, width: 38, align: "left", value: (l) => l.unit },
  {
    title: "Precio",
    x: 366,
    width: 52,
    align: "right",
    value: (l) => decimal(l.unitPrice),
  },
  {
    title: "Dto. %",
    x: 420,
    width: 34,
    align: "right",
    value: (l) => decimal(l.discountPercent),
  },
  {
    title: "IVA %",
    x: 456,
    width: 34,
    align: "right",
    value: (l) => decimal(l.vatRate),
  },
  {
    title: "Importe",
    x: 492,
    width: 63,
    align: "right",
    value: (l) => decimal(l.lineTotal),
  },
];

const UNPRICED_COLUMNS: readonly Column[] = [
  {
    title: "Código",
    x: 40,
    width: 70,
    align: "left",
    value: (l) => l.supplierCode,
  },
  {
    title: "Descripción",
    x: 112,
    width: 300,
    align: "left",
    value: (l) => l.description,
  },
  {
    title: "Cantidad",
    x: 414,
    width: 70,
    align: "right",
    value: (l) => decimal(l.quantity),
  },
  { title: "Ud.", x: 492, width: 63, align: "left", value: (l) => l.unit },
];

function title(document: ExtractedDocument): string {
  if (document.documentType === "delivery-note") return "ALBARÁN";
  return document.totals?.total?.startsWith("-")
    ? "FACTURA RECTIFICATIVA"
    : "FACTURA";
}

/** Renders the document as an A4 PDF. Same input, same bytes. */
export function renderGoldPdf(document: ExtractedDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: "A4",
      // Every position below is absolute. With margins, pdfkit adds a page by itself when text
      // gets close to the bottom.
      margin: 0,
      bufferPages: true,
      info: {
        CreationDate: CREATED,
        Producer: "kitchen-ops",
        Creator: "kitchen-ops gold renderer",
        Title: "Synthetic document",
      },
    });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    draw(pdf, document);
    pdf.end();
  });
}

function draw(pdf: PDFKit.PDFDocument, document: ExtractedDocument): void {
  const priced =
    document.totals !== null ||
    document.lines.some((l) => l.unitPrice !== null || l.lineTotal !== null);
  const columns = priced ? PRICED_COLUMNS : UNPRICED_COLUMNS;
  const text = (
    value: string,
    x: number,
    y: number,
    options: PDFKit.Mixins.TextOptions = {},
  ) => pdf.text(value, x, y, { lineBreak: false, ...options });

  // First page: who, what, when, and for whom.
  pdf.font("Helvetica-Bold").fontSize(14);
  text(document.supplier.name ?? "", LEFT, 40, { width: 290, ellipsis: true });
  pdf.font("Helvetica").fontSize(SIZE);
  if (document.supplier.taxId !== null) {
    text(`CIF: ${formatTaxId(document.supplier.taxId)}`, LEFT, 60);
  }
  text("Polígono Ficticio, nave 0 · 00000 Ciudad Ejemplo", LEFT, 72);

  pdf.font("Helvetica-Bold").fontSize(16);
  text(title(document), 300, 40, { width: RIGHT - 300, align: "right" });
  pdf.font("Helvetica").fontSize(SIZE);
  if (document.number !== null) {
    text(`Nº: ${document.number}`, 300, 62, {
      width: RIGHT - 300,
      align: "right",
    });
  }
  if (document.issueDate !== null) {
    text(`Fecha: ${formatDate(document.issueDate)}`, 300, 74, {
      width: RIGHT - 300,
      align: "right",
    });
  }
  text(
    "Cliente: Restaurante Ejemplo · C/ Imaginaria 1 · 00000 Ciudad Ejemplo",
    LEFT,
    104,
  );

  const tableHeader = (y: number) => {
    pdf.font("Helvetica-Bold");
    for (const column of columns) {
      text(column.title, column.x, y, {
        width: column.width,
        align: column.align,
      });
    }
    pdf.font("Helvetica");
    pdf
      .moveTo(LEFT, y + 11)
      .lineTo(RIGHT, y + 11)
      .lineWidth(0.5)
      .stroke();
    return y + ROW;
  };
  /** A new page; the table header is repeated only if more lines follow. */
  const continuation = (moreLines: boolean) => {
    pdf.addPage();
    pdf.font("Helvetica-Bold");
    text(
      `${title(document)}${document.number === null ? "" : ` ${document.number}`} (continuación)`,
      LEFT,
      40,
    );
    pdf.font("Helvetica");
    return moreLines ? tableHeader(70) : 70;
  };

  let y = tableHeader(TABLE_TOP);
  for (const line of document.lines) {
    if (y + ROW > BOTTOM) y = continuation(true);
    for (const column of columns) {
      const value = column.value(line);
      if (value !== null) {
        text(value, column.x, y, {
          width: column.width,
          align: column.align,
          ellipsis: true,
        });
      }
    }
    y += ROW;
  }

  // Totals after the last line, on a new page if they don't fit.
  const { totals } = document;
  if (totals !== null) {
    const rows: [string, string | null][] = [
      ["Base imponible", totals.net],
      ...totals.vat.map((v): [string, string | null] => [
        `IVA ${v.rate === null ? "" : `${formatDecimal(v.rate)} % `}sobre ${v.base === null ? "" : formatDecimal(v.base)}`,
        v.amount,
      ]),
    ];
    if (y + ROW * (rows.length + 2) > BOTTOM) y = continuation(false);
    y += ROW;
    for (const [label, amount] of rows) {
      text(label, 330, y, { width: 150, align: "right" });
      if (amount !== null)
        text(formatDecimal(amount), 492, y, { width: 63, align: "right" });
      y += ROW;
    }
    pdf.font("Helvetica-Bold");
    text("TOTAL €", 330, y, { width: 150, align: "right" });
    if (totals.total !== null) {
      text(formatDecimal(totals.total), 492, y, { width: 63, align: "right" });
    }
    pdf.font("Helvetica");
  } else {
    if (y + ROW * 3 > BOTTOM) y = continuation(false);
    text("Recibí conforme (firma y sello):", LEFT, y + ROW * 2);
  }

  // Page numbers, now that the number of pages is known.
  const { start, count } = pdf.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    pdf.switchToPage(i);
    text(`Página ${i - start + 1} de ${count}`, LEFT, PAGE_HEIGHT - 40, {
      width: RIGHT - LEFT,
      align: "center",
    });
  }
}
