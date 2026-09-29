import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsSeedMember } from "../src/host";
import { SEED_MEMBER } from "../src/scenarios/member-announcements";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import { episodePageLabel } from "../src/scenarios/viewer-pages";
import { hostPath } from "../src/urls";

const paidEpisodePath = `/series/${SEED_TENANT.series.publicId}/episodes/${SEED_TENANT.series.paidEpisodeId}`;

/** The canvas the viewer lays out for the paid episode's first page. */
const firstPage = (page: Page) =>
  page.locator(
    `canvas[aria-label="${episodePageLabel(SEED_TENANT.series.paidEpisodeTitle, 1)}"]`
  );

/**
 * Public episode access gate. Paid Seed Episode 001-10 is locked
 * without a session; `member@example.com` holds seed ticket SeedTCKTAAA1.
 *
 * Every seeded episode carries a body, so what the gate decides is whether the
 * reader is given one: an entitled reader gets the viewer's pages and a locked
 * one gets the gate's answer in their place. Whether a page then draws is
 * `host.episode-reading.spec.ts`, which reaches web-host through the edge —
 * the only origin that also serves `/images/episodes/{id}`.
 */
test.describe("web-host episode access", () => {
  test("a paid episode shows the sign-in gate while signed out", async ({
    page,
  }) => {
    await page.goto(hostPath(paidEpisodePath));

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: SEED_TENANT.series.paidEpisodeTitle,
      })
    ).toBeVisible();
    await expect(page.getByText("This episode is paid")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Sign in to read" })
    ).toHaveAttribute(
      "href",
      `${hostPath("/login")}?returnTo=${encodeURIComponent(paidEpisodePath)}`
    );
    await expect(firstPage(page)).toHaveCount(0);
  });

  test("a member with a valid ticket can open the paid episode body", async ({
    page,
  }) => {
    await signInAsSeedMember(page, paidEpisodePath);

    await expect(page).toHaveURL(new RegExp(`${paidEpisodePath}$`, "u"));
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: SEED_TENANT.series.paidEpisodeTitle,
      })
    ).toBeVisible();
    await expect(firstPage(page)).toBeVisible();
    await expect(page.getByText("This episode is paid")).toHaveCount(0);
    await expect(page.getByText("You cannot read this episode")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Sign in to read" })
    ).toHaveCount(0);
  });

  test("returning from the gate's login opens the episode with the ticket", async ({
    page,
  }) => {
    await page.goto(hostPath(paidEpisodePath));
    await page.getByRole("link", { name: "Sign in to read" }).click();

    await expect(page).toHaveURL(/\/login\?returnTo=/u);
    // The login shell is a non-interactive skeleton until searchParams
    // resolve. Wait for the real form's returnTo, not the catalog default.
    await expect(page.locator('input[name="returnTo"]')).toHaveValue(
      paidEpisodePath
    );
    await page.getByLabel(/Email address/u).fill(SEED_MEMBER.email);
    await page.getByLabel(/Password/u).fill(SEED_MEMBER.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(new RegExp(`${paidEpisodePath}$`, "u"));
    await expect(firstPage(page)).toBeVisible();
    await expect(page.getByText("This episode is paid")).toHaveCount(0);
  });
});
