import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import { SEED_MEMBER } from "../src/scenarios/member-announcements";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import {
  STAFF_READER_EDITOR,
  STAFF_READER_MEMBER,
  STAFF_READER_SCENARIO,
} from "../src/scenarios/staff-reader";
import { episodePageLabel } from "../src/scenarios/viewer-pages";
import { signInAsMember } from "../src/storefront";
import { WEB_STOREFRONT_BASE_URL } from "../src/urls";

const paidEpisodePath = `/series/${SEED_TENANT.series.publicId}/episodes/${SEED_TENANT.series.paidEpisodeId}`;

const STAFF_ACCESS =
  "Open to you through your staff role. Readers see a purchase prompt here.";

/** The canvas the viewer lays out for the paid episode's first page. */
const paidFirstPage = (page: Page) =>
  page.locator(
    `canvas[aria-label="${episodePageLabel(SEED_TENANT.series.paidEpisodeTitle, 1)}"]`
  );

/**
 * What the storefront shows on the priced `Seed Episode 001-10` to a member of
 * the tenant's staff, who holds no purchase or ticket, beside a reader who
 * bought it and one who holds nothing.
 */
test.describe("web-storefront staff episode access", () => {
  test.beforeAll(() => {
    applyScenarioSql(STAFF_READER_SCENARIO);
  });

  test("a member of staff reads the paid episode and is told it is open through their role", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      STAFF_READER_EDITOR,
      paidEpisodePath,
      WEB_STOREFRONT_BASE_URL
    );

    await expect(paidFirstPage(page)).toBeVisible();
    await expect(page.getByText(STAFF_ACCESS)).toBeVisible();
    await expect(page.getByText("You cannot read this episode")).toHaveCount(0);
  });

  test("a reader who bought the episode reads it without the staff notice", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      SEED_MEMBER,
      paidEpisodePath,
      WEB_STOREFRONT_BASE_URL
    );

    await expect(paidFirstPage(page)).toBeVisible();
    await expect(page.getByText(STAFF_ACCESS)).toHaveCount(0);
  });

  test("a reader with no grant meets the gate", async ({ page }) => {
    await signInAsMember(
      page,
      STAFF_READER_MEMBER,
      paidEpisodePath,
      WEB_STOREFRONT_BASE_URL
    );

    await expect(page.getByText("You cannot read this episode")).toBeVisible();
    await expect(paidFirstPage(page)).toHaveCount(0);
    await expect(page.getByText(STAFF_ACCESS)).toHaveCount(0);
  });
});
