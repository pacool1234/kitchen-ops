import { expect, test } from "@playwright/test";
import { accounts } from "./accounts.ts";
import { signedIn, unique } from "./catalogue.ts";
import { FAIL, settled, textPdf, uploadPdf } from "./documents.ts";

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
