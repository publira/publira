import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { uploadEpisodePages } from "../src/episode-pages";
import { signInAsMember } from "../src/host";
import {
  revalidateHostTags,
  tenantSeriesDetailTag,
  tenantSiteTag,
} from "../src/revalidate";
import {
  AGE_VERIFICATION_ADMIN,
  AGE_VERIFICATION_EPISODE,
  AGE_VERIFICATION_EPISODE_PATH,
  AGE_VERIFICATION_MINOR,
  AGE_VERIFICATION_SCENARIO,
  AGE_VERIFICATION_TENANT,
} from "../src/scenarios/age-verification";
import { episodePageLabel } from "../src/scenarios/viewer-pages";
import {
  hostPath,
  WEB_ADMIN_AGE_VERIFICATION_BASE_URL,
  WEB_HOST_AGE_VERIFICATION_BASE_URL,
} from "../src/urls";

/**
 * Choosing which ratings demand a proven age, from the tenant settings console.
 *
 * The whole round trip goes through the product: an administrator picks a rule
 * on `/settings`, and the result is read back off the public episode page by a
 * reader the previous rule shut out. Nothing here writes to Postgres except the
 * scenario seed that puts the rule back between runs.
 */

const episodeUrl = `${WEB_HOST_AGE_VERIFICATION_BASE_URL}${hostPath(AGE_VERIFICATION_EPISODE_PATH)}`;

const AGE_GATE_MESSAGE = "This work is not available for your age.";

/** The canvas the viewer lays out for the episode's first page. */
const firstPage = (page: Page) =>
  page.locator(
    `canvas[aria-label="${episodePageLabel(AGE_VERIFICATION_EPISODE.title, 1)}"]`
  );

/** The browser's own interstitial, which the tenant's rule is answered before. */
const ratingConfirmation = (page: Page) =>
  page.getByRole("button", { name: "I am 18 or older" });

/** The card's radio for one rule, by the label the console shows it under. */
const ruleRadio = (page: Page, option: string) =>
  page.getByRole("radio", { exact: true, name: option });

/** Choose one rule on the settings card and submit it. */
const saveAgeVerification = async (
  page: Page,
  option: string
): Promise<void> => {
  await ruleRadio(page, option).click();
  await page.getByRole("button", { name: "Save the age verification" }).click();
};

/**
 * Read the episode page again and again until the gate catches up with the
 * console.
 *
 * Revalidation marks a `"use cache"` entry stale rather than dropping it, so
 * the request right after it is still answered from the old copy. Waiting on a
 * single navigation would be waiting on a page that can never change.
 *
 * Each round first waits for one of the three things the page can settle on —
 * the age gate, the rating confirmation, or the episode's own title — so it
 * reads a page that has rendered rather than one that has not arrived.
 */
const pollAgeGate = (page: Page) =>
  expect.poll(
    async () => {
      await page.goto(episodeUrl);
      await expect(
        page
          .getByText(AGE_GATE_MESSAGE)
          .or(ratingConfirmation(page))
          .or(
            page.getByRole("heading", {
              level: 1,
              name: new RegExp(AGE_VERIFICATION_EPISODE.title, "u"),
            })
          )
          .first()
      ).toBeVisible();
      return await page.getByText(AGE_GATE_MESSAGE).count();
    },
    {
      message: "the episode page never caught up with the saved rule",
      timeout: 30_000,
    }
  );

/**
 * Put the tenant back on the rule the suites expect and tell web-host about it.
 *
 * The scenario file writes `r18` back, a write no app saw, so without the tags
 * the storefront would keep gating this tenant by whatever the console last
 * saved. It also describes the episode's pages, which is what makes "the body
 * opened" something the suite can see, so the fixtures behind those rows are
 * uploaded here rather than by `task e2e:db`: seeding this tenant for the whole
 * stack would put it in the tenant list the platform baseline photographs.
 */
const resetAgeVerification = async (): Promise<void> => {
  applyScenarioSql(AGE_VERIFICATION_SCENARIO);
  uploadEpisodePages(AGE_VERIFICATION_EPISODE.publicId);
  await revalidateHostTags([
    tenantSiteTag(AGE_VERIFICATION_TENANT.id),
    tenantSeriesDetailTag(AGE_VERIFICATION_TENANT.id),
  ]);
};

// One rule for one tenant, so the tests run in order rather than beside each
// other.
test.describe.configure({ mode: "serial" });

test.describe("web-admin age verification", () => {
  test.beforeAll(async () => {
    await resetAgeVerification();
  });

  test.afterAll(async () => {
    await resetAgeVerification();
  });

  test("the console opens on the stored rule and says what each one does", async ({
    page,
  }) => {
    await signInAsAdmin(
      page,
      AGE_VERIFICATION_ADMIN,
      "/settings",
      WEB_ADMIN_AGE_VERIFICATION_BASE_URL
    );

    await expect(ruleRadio(page, "Check R18 only")).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(ruleRadio(page, "Check no ages")).toHaveAttribute(
      "aria-checked",
      "false"
    );

    // Each rule says which ratings end up closed, so the choice is not a guess
    // about what "R18" does to the storefront.
    await expect(
      page.getByText(
        "A rated series keeps its rating and still asks the reader to confirm, but no date of birth is asked for or checked."
      )
    ).toBeVisible();
    await expect(
      page.getByText(
        "An R18 series opens only to a reader who has proven they are 18, and an R15 series is left to the reader's own confirmation."
      )
    ).toBeVisible();
    await expect(
      page.getByText(
        "An R15 series opens only to a reader who has proven they are 15, and an R18 series only to one who has proven they are 18."
      )
    ).toBeVisible();
  });

  // The rule is the one thing that decides whether a proven age is needed at
  // all, so it is measured where a reader would meet it rather than by reading
  // the console back.
  test("dropping the rule opens the rated body to a reader it was shutting out", async ({
    browser,
    page,
  }) => {
    await signInAsAdmin(
      page,
      AGE_VERIFICATION_ADMIN,
      "/settings",
      WEB_ADMIN_AGE_VERIFICATION_BASE_URL
    );

    const readerContext = await browser.newContext();
    const readerPage = await readerContext.newPage();
    try {
      // Sixteen, so `r18` is a rating this reader can never prove, and the
      // rule stops them before the browser confirmation is ever offered.
      await signInAsMember(
        readerPage,
        AGE_VERIFICATION_MINOR,
        AGE_VERIFICATION_EPISODE_PATH,
        WEB_HOST_AGE_VERIFICATION_BASE_URL
      );
      await expect(readerPage.getByText(AGE_GATE_MESSAGE)).toBeVisible();
      await expect(ratingConfirmation(readerPage)).toHaveCount(0);

      await saveAgeVerification(page, "Check no ages");
      await expect(
        page.getByText("The age verification was saved.")
      ).toBeVisible();

      // With the rule gone, only the browser confirmation stands in front of
      // the body, and answering it is what opens it.
      await pollAgeGate(readerPage).toBe(0);
      await ratingConfirmation(readerPage).click();
      await expect(firstPage(readerPage)).toBeVisible();

      // Back on the rule the rest of the suite runs on, and read from the API
      // rather than from the form that submitted it: a reload is what says the
      // console is showing what was stored.
      await saveAgeVerification(page, "Check R18 only");
      await pollAgeGate(readerPage).toBe(1);
      await page.reload();
      await expect(ruleRadio(page, "Check R18 only")).toHaveAttribute(
        "aria-checked",
        "true"
      );
    } finally {
      await readerContext.close();
    }
  });
});
