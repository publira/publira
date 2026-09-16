import { expect, test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";

const SEED_READER = {
  email: "member@example.com",
  name: "Sample Member",
  publicId: "SeedMMBRAAA1",
} as const;

/**
 * Finding a reader from the console's readers list.
 *
 * The seed tenant's member is the reader looked up. Its administrator holds a
 * staff role on the same tenant, which is what keeps that account off the list.
 */
test.describe("web-admin readers", () => {
  test("staff open the list from the navigation, search by email, and filter by status", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/");

    await page.getByRole("link", { exact: true, name: "Readers" }).click();
    await expect(page).toHaveURL(/\/readers$/u);
    await expect(
      page.getByRole("heading", { level: 1, name: "Readers" })
    ).toBeVisible();
    await expect(page.getByText("admin@example.com")).toHaveCount(0);

    await page
      .getByRole("searchbox", { name: "Name or email" })
      .fill(SEED_READER.email);
    await page.getByRole("button", { name: "Apply" }).click();

    await expect(page).toHaveURL(/[?&]q=member%40example\.com/u);
    // The search is a substring match, and the scenario accounts other specs
    // add to this tenant (`settings-member@example.com` and the like) match it
    // too, so the row is picked by an exact email cell.
    const row = page.getByRole("row").filter({
      has: page.getByRole("cell", { exact: true, name: SEED_READER.email }),
    });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Active")).toBeVisible();
    await expect(
      row.getByRole("link", { name: SEED_READER.name })
    ).toHaveAttribute(
      "href",
      new RegExp(`/readers/${SEED_READER.publicId}$`, "u")
    );

    // The search box keeps what was typed, so narrowing by state keeps it too.
    await page
      .getByRole("combobox", { name: "Status" })
      .selectOption("suspended");
    await page.getByRole("button", { name: "Apply" }).click();

    await expect(page).toHaveURL(/[?&]status=suspended/u);
    await expect(page.getByText("There are no readers to show.")).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "Name or email" })
    ).toHaveValue(SEED_READER.email);

    await page.getByRole("link", { name: "Reset" }).click();
    await expect(page).toHaveURL(/\/readers$/u);
    await expect(
      page.getByRole("searchbox", { name: "Name or email" })
    ).toHaveValue("");
  });
});
