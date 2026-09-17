import { test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import { expectDocumentWithoutCatalogNamespaces } from "../src/client-catalog";

test.describe("web-admin client catalog", () => {
  test("a console page carries no other app's copy", async ({ page }) => {
    await signInAsSeedAdmin(page, "/");

    await expectDocumentWithoutCatalogNamespaces(page, "/", {
      excluded: ["host", "mobile", "email", "platform"],
      included: ["admin", "errors", "locale"],
    });
  });
});
