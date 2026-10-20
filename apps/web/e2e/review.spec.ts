import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts } from "./accounts.ts";
import { signedIn, unique } from "./catalogue.ts";
import { MISREAD, photoPng, settled, textPdf, uploadPdf } from "./documents.ts";
import { mainNav } from "./shell.ts";

// Reviewing a document (#118): its draft corrected next to its original, the checks run again
// as it's typed, and saved apart from what was read. The fake model misreads a document that
// says MISREAD: line 1's 5 kg as 50, so its line total fails the checks.

test.setTimeout(60_000);

/** Uploads a PDF the fake model misreads, waits for it to be read, and opens its page. */
async function misreadDocument(page: Page, label: string): Promise<string> {
  const uploaded = await uploadPdf(
    page,
    textPdf(`${label} ${MISREAD} con una linea mal leida`),
  );
  await settled(page, uploaded.id);
  await page.goto(`/documents/${uploaded.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Albarán ALB-0001",
  );
  return uploaded.id;
}

const line = (page: Page, n: number) =>
  page.getByRole("group", { name: `Línea ${n}`, exact: true });
const checks = (page: Page) =>
  page.getByRole("region", { name: "Comprobaciones" });
const LINE_TOTAL_FAILS =
  "Línea 1: el importe no cuadra con la cantidad, el precio y el descuento";

test("a misread quantity is caught, corrected next to the original, checked again as it's typed, and saved apart from what was read", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  const id = await misreadDocument(page, unique(testInfo, "Albaran"));

  // The original beside the form: the PDF, and a link to it.
  await expect(page.getByRole("link", { name: "Abrir el PDF" })).toBeVisible();
  const quantity = line(page, 1).getByRole("textbox", { name: "Cantidad" });
  const total = line(page, 1).getByRole("textbox", { name: "Importe" });
  await expect(quantity).toHaveValue("50");
  await expect(total).toHaveValue("9,00");

  // The failure, in the summary and on its field; the summary takes you there.
  await expect(checks(page)).toContainText(LINE_TOTAL_FAILS);
  await expect(total).toHaveAttribute("aria-invalid", "true");
  await expect(total).toHaveAccessibleDescription(
    /El importe no cuadra con la cantidad, el precio y el descuento/,
  );
  await expectAccessible(page);
  await checks(page).getByRole("button", { name: LINE_TOTAL_FAILS }).click();
  await expect(total).toBeFocused();

  // Corrected: the failure goes as it's typed, before anything is saved.
  await quantity.fill("5");
  await expect(checks(page)).toContainText(
    "Ha pasado todas las comprobaciones.",
  );
  await expect(total).not.toHaveAttribute("aria-invalid");

  await page.getByRole("button", { name: "Guardar correcciones" }).click();
  await expect(page.getByText("Correcciones guardadas")).toBeVisible();

  // Kept: the correction, and apart from it, what the model read.
  await page.reload();
  await expect(quantity).toHaveValue("5");
  await expect(checks(page)).toContainText(
    "Ha pasado todas las comprobaciones.",
  );
  await page.getByText("Lo que leyó el modelo").click();
  const read = page.getByRole("table", { name: "Líneas leídas" });
  await expect(read.getByRole("row").nth(1)).toContainText("50");
  await expectAccessible(page);

  const saved = (await (
    await page.request.get(`/api/documents/${id}`)
  ).json()) as {
    draft: { lines: { quantity: string }[] };
    corrected: { lines: { quantity: string }[] };
  };
  expect(saved.draft.lines[0]!.quantity).toBe("50");
  expect(saved.corrected.lines[0]!.quantity).toBe("5");
});

test("a counter user corrects only quantities: the rest of the delivery note is shown, not editable", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.counter);
  await misreadDocument(page, unique(testInfo, "Albaran del mostrador"));

  const first = line(page, 1);
  await expect(first).toContainText("Tomate pera");
  await expect(first.getByRole("textbox")).toHaveCount(1);
  const quantity = first.getByRole("textbox", { name: "Cantidad" });
  await expect(quantity).toHaveValue("50");
  await expect(page.getByRole("textbox", { name: "Número" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Añadir línea" })).toHaveCount(
    0,
  );
  await expectAccessible(page);

  await quantity.fill("5");
  await expect(checks(page)).toContainText(
    "Ha pasado todas las comprobaciones.",
  );
  await page.getByRole("button", { name: "Guardar correcciones" }).click();
  await expect(page.getByText("Correcciones guardadas")).toBeVisible();
  await page.reload();
  await expect(quantity).toHaveValue("5");
});

test("lines and VAT rows are added and removed; the last line can't be", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  await misreadDocument(page, unique(testInfo, "Albaran con lineas"));

  await expect(page.getByRole("group", { name: /^Línea \d+$/ })).toHaveCount(2);
  await page.getByRole("button", { name: "Añadir línea" }).click();
  const third = line(page, 3);
  await expect(
    third.getByRole("textbox", { name: "Descripción" }),
  ).toBeFocused();
  await third.getByRole("button", { name: "Quitar la línea 3" }).click();
  await line(page, 2)
    .getByRole("button", { name: "Quitar la línea 2" })
    .click();
  await expect(page.getByRole("group", { name: /^Línea \d+$/ })).toHaveCount(1);
  await expect(
    line(page, 1).getByRole("button", { name: "Quitar la línea 1" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Añadir un tipo de IVA" }).click();
  await expect(
    page.getByRole("group", { name: "IVA 2", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Quitar el IVA 2" }).click();
  await expect(
    page.getByRole("group", { name: "IVA 2", exact: true }),
  ).toHaveCount(0);
});

test("a value the draft can't take is refused on its field, and nothing is saved", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  const id = await misreadDocument(
    page,
    unique(testInfo, "Albaran con descuento"),
  );

  const discount = line(page, 1).getByRole("textbox", { name: "Dto." });
  await discount.fill("150");
  await discount.press("Tab");
  await expect(discount).toHaveAccessibleDescription(
    /Un porcentaje entre 0 y 100/,
  );
  await page.getByRole("button", { name: "Guardar correcciones" }).click();
  await expect(discount).toHaveAttribute("aria-invalid", "true");
  const saved = (await (
    await page.request.get(`/api/documents/${id}`)
  ).json()) as { corrected: unknown };
  expect(saved.corrected).toBeNull();
});

test("leaving with corrections not saved asks first", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  await misreadDocument(page, unique(testInfo, "Albaran sin guardar"));

  await line(page, 1).getByRole("textbox", { name: "Cantidad" }).fill("5");
  await mainNav(page).getByRole("link", { name: "Documentos" }).click();
  const asking = page.getByRole("dialog", { name: "¿Salir sin guardar?" });
  await expect(asking).toBeVisible();
  await asking.getByRole("button", { name: "Seguir editando" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Albarán ALB-0001",
  );
});

test("a photo opens larger, zooms with the keyboard, and gives focus back when closed", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.counter);
  const response = await page.request.post("/api/documents", {
    multipart: {
      files: {
        name: "albaran.png",
        mimeType: "image/png",
        buffer: photoPng(unique(testInfo, "foto ampliada")),
      },
    },
  });
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  await settled(page, id);
  await page.goto(`/documents/${id}`);

  const photo = page.getByRole("button", { name: "Ampliar la foto 1 de 1" });
  await photo.click();
  const viewer = page.getByRole("dialog", { name: "Foto 1 de 1" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("status")).toHaveText("100 %");
  await page.keyboard.press("+");
  await expect(viewer.getByRole("status")).toHaveText("150 %");
  await viewer.getByRole("button", { name: "Alejar" }).click();
  await expect(viewer.getByRole("status")).toHaveText("100 %");
  await expect(viewer.getByRole("button", { name: "Alejar" })).toBeDisabled();
  await expectAccessible(page);

  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(photo).toBeFocused();
});
