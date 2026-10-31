import { expect, test } from "@playwright/test";

import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import { storefrontPath } from "../src/urls";

/**
 * Where the three banners `db/seeds/dev/100_campaign_banners.sql` publishes
 * link, in the order the operator put them in.
 */
const SEEDED_BANNER_LINKS = [
  `/series/${SEED_TENANT.series.publicId}`,
  `/labels/${SEED_TENANT.labelId}`,
  "/series?free=1",
] as const;

test.describe("web-storefront campaign banners", () => {
  test("the top page opens on the banners showing now, in the operator's order", async ({
    page,
  }) => {
    await page.goto(storefrontPath("/"));

    const campaigns = page.getByRole("region", { name: "Campaigns" });
    await expect(
      campaigns.getByRole("link", { name: "Campaign banner" })
    ).toHaveCount(SEEDED_BANNER_LINKS.length);
    await expect
      .poll(() =>
        campaigns
          .getByRole("link")
          .evaluateAll((links) =>
            links.map((link) => link.getAttribute("href"))
          )
      )
      .toEqual(SEEDED_BANNER_LINKS.map((link) => storefrontPath(link)));

    // The band stands above the work the page opens with.
    const bandBottom = await campaigns.evaluate(
      (band) => band.getBoundingClientRect().bottom
    );

    const headingTop = await page
      .getByRole("heading", { level: 1 })
      .evaluate((heading) => heading.getBoundingClientRect().top);

    expect(bandBottom).toBeLessThan(headingTop);
  });

  test("the strip runs on past either end", async ({ page }) => {
    await page.goto(storefrontPath("/"));

    const campaigns = page.getByRole("region", { name: "Campaigns" });

    const previous = campaigns.getByRole("button", {
      name: "Previous campaign",
    });

    const next = campaigns.getByRole("button", { name: "Next campaign" });
    await expect(campaigns.getByText("1 / 3")).toBeVisible();

    // The buttons are a Client Component the server already drew, so a press
    // that lands before hydration is dropped; a visible button cannot tell.
    // oxlint-disable-next-line sonarjs/no-networkidle-wait
    await page.waitForLoadState("networkidle");
    await previous.click();
    await expect(campaigns.getByText("3 / 3")).toBeVisible();
    await next.click();
    await expect(campaigns.getByText("1 / 3")).toBeVisible();
    await next.click();
    await next.click();
    await expect(campaigns.getByText("3 / 3")).toBeVisible();
    await next.click();
    await expect(campaigns.getByText("1 / 3")).toBeVisible();

    // Every slide, the copies at the two ends included, has a scroll position
    // that puts it in the centre. Without one the browser stops a copy short
    // of the centre, and the move onto the banner it copies shows as a jump.
    const reach = await campaigns.getByRole("list").evaluate((strip) => {
      const centring = [...strip.children].map(
        (slide) =>
          (slide as HTMLElement).offsetLeft +
          (slide as HTMLElement).offsetWidth / 2 -
          strip.clientWidth / 2
      );

      return {
        first: centring[0] ?? 0,
        last: centring.at(-1) ?? 0,
        max: strip.scrollWidth - strip.clientWidth,
      };
    });

    expect(reach.first).toBeGreaterThanOrEqual(-1);
    expect(reach.last).toBeLessThanOrEqual(reach.max + 1);

    // Wherever the strip went to get there, the banner in the centre is the
    // first one itself rather than the copy that stands after the last, so it
    // is the one a reader can follow.
    const centred = campaigns.getByRole("link").first();
    await expect(centred).toBeInViewport();
    await centred.click();
    await expect(page).toHaveURL(
      new RegExp(`${storefrontPath(SEEDED_BANNER_LINKS[0])}$`, "u")
    );
  });
});
