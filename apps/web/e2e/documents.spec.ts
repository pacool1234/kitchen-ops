import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts, setUpTwoFactor, signIn } from "./accounts.ts";
import { arrivedAt, signedIn, unique } from "./catalogue.ts";
import {
  FAIL,
  openDocuments,
  photoPng,
  settled,
  statusOf,
  textPdf,
  uploadPdf,
} from "./documents.ts";

// Receiving documents (#106): what the screens stand on. The browser tests' API stores files and
// reads them with the fake model, and a failure shows in seconds.

test.describe("documents, through the web app's /api", () => {
  // Signing in, then up to 30 s for the document to settle.
  test.setTimeout(60_000);

  test("a PDF is stored, read by the fake model, and its file can be fetched by its link", async ({
    page,
  }, testInfo) => {
    await signedIn(page, accounts.office);
    const sent = textPdf(unique(testInfo, "Albaran de prueba, sin nada raro"));
    const uploaded = await uploadPdf(page, sent);
    expect(uploaded.status).toBe("queued");

    const read = await settled(page, uploaded.id);
    expect(read).toMatchObject({
      status: "ready_for_review",
      failureReason: null,
      draft: { number: "ALB-0001" },
      checkFailures: [],
    });
    // Office isn't shown what reading cost (spec section 6). The API's tests check the owner is.
    expect(read.costMicroUsd).toBeUndefined();
    const file = await page.request.get(read.files[0]!.url);
    expect(file.status()).toBe(200);
    expect(Buffer.from(await file.body()).equals(sent)).toBe(true);
  });

  test("a document the fake model is told to fail has failed within seconds, its tries made", async ({
    page,
  }, testInfo) => {
    await signedIn(page, accounts.counter);
    const uploaded = await uploadPdf(
      page,
      textPdf(unique(testInfo, `Albaran que falla ${FAIL}`)),
    );
    const read = await settled(page, uploaded.id);
    expect(read).toMatchObject({
      status: "failed",
      failureReason: "model_error",
    });
  });
});

/** Opens the upload page from the documents list. */
async function openUpload(page: Page): Promise<void> {
  await openDocuments(page);
  await page.getByRole("link", { name: "Subir documento" }).click();
  await arrivedAt(page, "Subir documento");
}

/** Sends what's chosen, and waits for the new document's page. */
async function send(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
}

/** Marks this page load, to tell later whether the page was reloaded. */
const markLoad = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loadMark: boolean }).loadMark = true;
  });
const sameLoad = (page: Page) =>
  page.evaluate(() => (window as unknown as { loadMark?: boolean }).loadMark);

test.describe("the document screens (#106)", () => {
  test.setTimeout(60_000);

  test("on a phone, photos taken in order, one removed, become a readable draft without a reload", async ({
    page,
    isMobile,
  }, testInfo) => {
    test.skip(!isMobile, "the camera is a phone's");
    await signedIn(page, accounts.counter);
    await openUpload(page);

    const camera = page.getByLabel("Hacer foto");
    for (const n of [1, 2, 3]) {
      await camera.setInputFiles({
        name: `foto-${n}.png`,
        mimeType: "image/png",
        buffer: photoPng(unique(testInfo, `foto ${n}`)),
      });
    }
    const chosen = page.getByRole("list", { name: "Lo que vas a enviar" });
    await expect(chosen.getByRole("listitem")).toHaveCount(3);
    await expect(chosen.getByRole("img", { name: "Foto 3" })).toBeVisible();
    await expectAccessible(page);
    await chosen.getByRole("button", { name: "Quitar Foto 2" }).click();
    await expect(chosen.getByRole("listitem")).toHaveCount(2);

    await send(page);
    await markLoad(page);
    await expect(statusOf(page)).toHaveText("Listo para revisar", {
      timeout: 30_000,
    });
    expect(await sameLoad(page)).toBe(true);
    await expect(page.getByRole("img", { name: "Foto 2 de 2" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Albarán ALB-0001",
    );
    await expect(
      page.getByText("Distribuciones de Ejemplo, S.L."),
    ).toBeVisible();
    await expect(page.getByRole("table", { name: "Líneas" })).toContainText(
      "Tomate pera",
    );
    await expect(
      page.getByText("Ha pasado todas las comprobaciones."),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test("on a desktop, a PDF chosen with the button, and another dropped on the page", async ({
    page,
    isMobile,
  }, testInfo) => {
    test.skip(isMobile, "dragging a file is a desktop's");
    await signedIn(page, accounts.office);
    await openUpload(page);
    await page.getByLabel("Elegir archivos").setInputFiles({
      name: "albaran.pdf",
      mimeType: "application/pdf",
      buffer: textPdf(unique(testInfo, "Albaran elegido con el boton")),
    });
    await expect(
      page.getByRole("list", { name: "Lo que vas a enviar" }),
    ).toContainText("albaran.pdf");
    await send(page);
    await expect(statusOf(page)).toHaveText("Listo para revisar", {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("link", { name: "Abrir el PDF" }),
    ).toBeVisible();

    await openUpload(page);
    const dropped = textPdf(unique(testInfo, "Albaran arrastrado a la pagina"));
    const transfer = await page.evaluateHandle(
      (bytes) => {
        const data = new DataTransfer();
        data.items.add(
          new File([new Uint8Array(bytes)], "arrastrado.pdf", {
            type: "application/pdf",
          }),
        );
        return data;
      },
      [...dropped],
    );
    await page
      .getByTestId("drop-zone")
      .dispatchEvent("drop", { dataTransfer: transfer });
    await expect(
      page.getByRole("list", { name: "Lo que vas a enviar" }),
    ).toContainText("arrastrado.pdf");
    await send(page);
    await expect(statusOf(page)).toHaveText("Listo para revisar", {
      timeout: 30_000,
    });
  });

  test("a file already received is refused, with a link to the document that has it", async ({
    page,
  }, testInfo) => {
    await signedIn(page, accounts.counter);
    const pdf = textPdf(unique(testInfo, "Albaran que se sube dos veces"));
    const first = await uploadPdf(page, pdf);

    await openUpload(page);
    await page.getByLabel("Elegir archivos").setInputFiles({
      name: "otra-vez.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
    await page.getByRole("button", { name: "Enviar" }).click();
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Este archivo ya se había recibido." });
    await expect(alert).toBeVisible();
    await expectAccessible(page);
    await alert.getByRole("link", { name: "Ver el documento" }).click();
    await expect(page).toHaveURL(new RegExp(`/documents/${first.id}$`));
  });

  test("a document that couldn't be read says why, and is read again from its page", async ({
    page,
  }, testInfo) => {
    await signedIn(page, accounts.office);
    const failing = await uploadPdf(
      page,
      textPdf(unique(testInfo, `Albaran que no se lee ${FAIL}`)),
    );
    await page.goto(`/documents/${failing.id}`);
    await expect(statusOf(page)).toHaveText("Ha fallado", { timeout: 30_000 });
    await expect(
      page.getByText(
        "El servicio que lee los documentos ha respondido con un error.",
      ),
    ).toBeVisible();
    await expectAccessible(page);

    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(statusOf(page)).not.toHaveText("Ha fallado");
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeHidden();
    // The fake model fails on this document every time: it fails again.
    await expect(statusOf(page)).toHaveText("Ha fallado", { timeout: 30_000 });
  });

  test("the list: filtered by status, its statuses changing by themselves", async ({
    page,
  }, testInfo) => {
    await signedIn(page, accounts.counter);
    const failing = await uploadPdf(
      page,
      textPdf(unique(testInfo, `Albaran de la lista ${FAIL}`)),
    );
    await openDocuments(page);
    await markLoad(page);
    // A table row on a desktop, a card on a phone.
    const entry = page
      .getByRole("row")
      .or(page.getByRole("listitem"))
      .filter({ has: page.locator(`a[href="/documents/${failing.id}"]`) });
    await expect(entry.getByRole("link", { name: "Sin leer" })).toBeVisible();
    await expect(entry.getByTestId("list-status")).toHaveText("Ha fallado", {
      timeout: 30_000,
    });
    expect(await sameLoad(page)).toBe(true);
    await expectAccessible(page);

    await page.getByLabel("Estado").click();
    await page.getByRole("option", { name: "Ha fallado" }).click();
    await expect(page).toHaveURL(/status=failed/);
    await expect(entry).toBeVisible();
  });

  test("counter and office never see what reading cost", async ({
    page,
  }, testInfo) => {
    for (const account of [accounts.counter, accounts.office]) {
      await signedIn(page, account);
      const uploaded = await uploadPdf(
        page,
        textPdf(unique(testInfo, `Coste oculto a ${account.email}`)),
      );
      await page.goto(`/documents/${uploaded.id}`);
      await expect(statusOf(page)).toHaveText("Listo para revisar", {
        timeout: 30_000,
      });
      await expect(page.getByText("Coste de la lectura")).toHaveCount(0);
      await page.context().clearCookies();
    }
  });

  test("the owner sees what reading cost", async ({
    page,
    isMobile,
  }, testInfo) => {
    test.skip(isMobile, "the owner's 2FA setup runs once, at desktop size");
    await signIn(page, accounts.manager);
    await setUpTwoFactor(page, accounts.manager.password);
    const uploaded = await uploadPdf(
      page,
      textPdf(unique(testInfo, "Albaran que ve la direccion")),
    );
    await page.goto(`/documents/${uploaded.id}`);
    await expect(statusOf(page)).toHaveText("Listo para revisar", {
      timeout: 30_000,
    });
    await expect(page.getByText("Coste de la lectura")).toBeVisible();
    // The fake model costs nothing.
    await expect(page.getByText("0,0000 US$")).toBeVisible();
  });
});
