import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin, signInAsSeedAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { SEED_ADMIN } from "../src/scenarios/admin-publish";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import {
  TENANT_ROLES_AUDITOR,
  TENANT_ROLES_EDITOR,
  TENANT_ROLES_SCENARIO,
} from "../src/scenarios/tenant-roles";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

/** Sidebar entries whose screens only a tenant admin may use. */
const ADMIN_ONLY_ENTRIES = [
  "Readers",
  "Contact messages",
  "Access tickets",
  "Royalties",
  "Email",
  "Payments",
  "Mobile push",
  "Sign-in",
  "Members",
  "Audit logs",
] as const;

/** Sidebar entries every member of staff may open. */
const SHARED_ENTRIES = [
  "Series",
  "Comments",
  "Read-through",
  "App links",
  "Branding",
  "Settings",
] as const;

const EDITOR_ONLY_NOTICE =
  "Only an editor or a tenant admin can change this. You have read-only access.";
const ADMIN_ONLY_NOTICE =
  "Only a tenant administrator can change this setting. You have read-only access.";

const navigationEntry = (page: Page, name: string) =>
  page.getByRole("link", { exact: true, name });

/**
 * The gated entries and the account menu wait on the same read of the
 * operator, so once the menu names them every entry has had its answer.
 */
const waitForOperator = async (page: Page, name: string): Promise<void> => {
  await expect(
    page.getByRole("button", { name: new RegExp(name, "u") })
  ).toBeVisible();
};

/** The sidebar offers every entry of `shown` and none of `hidden`. */
const expectNavigation = async (
  page: Page,
  shown: readonly string[],
  hidden: readonly string[]
): Promise<void> => {
  await Promise.all([
    ...shown.map((name) => expect(navigationEntry(page, name)).toBeVisible()),
    ...hidden.map((name) => expect(navigationEntry(page, name)).toHaveCount(0)),
  ]);
};

const expectNotFound = async (page: Page, pathname: string): Promise<void> => {
  await page.goto(adminUrl(pathname));
  await expect(
    page.getByRole("heading", { name: "Page not found" })
  ).toBeVisible();
};

/**
 * What the console shows each tenant role: an auditor reads what an editor
 * reads and is offered none of its writes, an editor is offered the catalogue
 * but nothing that administers the tenant, and an administrator everything.
 * The API refuses the same; these assert that the console never offers a
 * control the API would refuse.
 */
test.describe("tenant roles in the console", () => {
  test.beforeAll(() => {
    applyScenarioSql(TENANT_ROLES_SCENARIO);
  });

  test("an auditor is offered nothing that writes", async ({ page }) => {
    await signInAsAdmin(page, TENANT_ROLES_AUDITOR, "/series");
    await waitForOperator(page, TENANT_ROLES_AUDITOR.name);

    await expectNavigation(page, SHARED_ENTRIES, ADMIN_ONLY_ENTRIES);

    // The list offers to view each series, and nothing to create or edit.
    await expect(
      page.getByRole("link", { name: "View" }).first()
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Create series" })).toHaveCount(
      0
    );
    await expect(
      page.getByRole("link", { exact: true, name: "Edit" })
    ).toHaveCount(0);

    // A series opens as the form an editor sees, every control of it closed
    // under a notice saying why.
    await page.getByRole("link", { name: "View" }).first().click();
    await expect(page.getByText(EDITOR_ONLY_NOTICE)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Title" })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Update series" })
    ).toBeDisabled();

    // An episode shows its title closed with the rest of its fields, and its
    // pages with nothing to move, replace, or delete one by.
    await page.goto(
      adminUrl(
        `/series/${SEED_TENANT.series.publicId}/episodes/${SEED_TENANT.series.freeEpisodeId}`
      )
    );
    await expect(page.getByText(EDITOR_ONLY_NOTICE)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Title" })).toBeDisabled();
    const episodePages = page.getByRole("list", {
      exact: true,
      name: "Registered page images",
    });
    await expect(
      episodePages.getByRole("img", { exact: true, name: "Page 1" })
    ).toBeVisible();
    await expect(
      episodePages.getByRole("button", {
        name: /^(?:Reorder|Replace|Delete) page /u,
      })
    ).toHaveCount(0);

    // A screen whose whole purpose is to write is not there at all.
    await expectNotFound(page, "/series/new");

    // The author roles are listed in their order with nothing to change them.
    await page.goto(adminUrl("/creator-roles"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Author roles" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Create role" })).toHaveCount(
      0
    );
    await expect(page.getByRole("button", { name: /^Reorder /u })).toHaveCount(
      0
    );

    // Nor is anything only an administrator may read.
    await expectNotFound(page, "/readers");
  });

  test("an editor is offered the catalogue but nothing that administers the tenant", async ({
    page,
  }) => {
    await signInAsAdmin(page, TENANT_ROLES_EDITOR, "/series");
    await waitForOperator(page, TENANT_ROLES_EDITOR.name);

    await expectNavigation(page, SHARED_ENTRIES, ADMIN_ONLY_ENTRIES);

    await expect(
      page.getByRole("link", { name: "Create series" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { exact: true, name: "Edit" }).first()
    ).toBeVisible();

    // The tenant's settings are read like any member of staff reads them, and
    // only an administrator may change them.
    await page.goto(adminUrl("/settings"));
    await expect(page.getByText(ADMIN_ONLY_NOTICE).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save the settings" })
    ).toBeDisabled();

    await expectNotFound(page, "/audit-logs");
    await expectNotFound(page, "/integrations/sign-in");
  });

  test("an administrator is offered every entry", async ({ page }) => {
    await signInAsSeedAdmin(page, "/series");
    await waitForOperator(page, SEED_ADMIN.name);

    await expectNavigation(
      page,
      [...SHARED_ENTRIES, ...ADMIN_ONLY_ENTRIES],
      []
    );
    await expect(
      page.getByRole("link", { name: "Create series" })
    ).toBeVisible();
  });
});
