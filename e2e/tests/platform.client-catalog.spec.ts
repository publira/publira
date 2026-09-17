import { test } from "@playwright/test";

import { expectDocumentWithoutCatalogNamespaces } from "../src/client-catalog";
import { signInAsSeedPlatformSuperAdmin } from "../src/platform";

test.describe("web-platform client catalog", () => {
  test("a console page carries no other app's copy", async ({ page }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/");

    await expectDocumentWithoutCatalogNamespaces(page, "/", {
      excluded: ["host", "mobile", "email", "admin"],
      included: ["platform", "errors", "locale"],
    });
  });
});
