import { expect, test } from "@playwright/test";

import { signInAsSeedMember } from "../src/host";
import { SEED_MEMBER } from "../src/scenarios/member-announcements";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import { hostPath } from "../src/urls";

const paidEpisodePath = `/series/${SEED_TENANT.series.publicId}/episodes/${SEED_TENANT.series.paidEpisodeId}`;

/**
 * Public episode access gate (#616). Paid Seed Episode 001-10 is locked
 * without a session; `member@example.com` holds seed ticket SeedTCKTAAA1.
 *
 * Seed catalog has no body images, so entitled is "images not published"
 * rather than a page raster — that still means the viewer opened.
 */
test.describe("web-host episode access", () => {
  test("a paid episode offers the sign-in path while signed out", async ({
    page,
  }) => {
    await page.goto(hostPath(paidEpisodePath));

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: SEED_TENANT.series.paidEpisodeTitle,
      })
    ).toBeVisible();
    await expect(page.getByText("このエピソードは有料です")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "ログインして閲覧する" })
    ).toHaveAttribute(
      "href",
      `${hostPath("/login")}?returnTo=${encodeURIComponent(paidEpisodePath)}`
    );
    await expect(
      page.getByText("本文画像はまだ公開されていません。")
    ).toHaveCount(0);
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
    await expect(
      page.getByText("本文画像はまだ公開されていません。")
    ).toBeVisible();
    await expect(page.getByText("このエピソードは有料です")).toHaveCount(0);
    await expect(page.getByText("このエピソードは閲覧できません")).toHaveCount(
      0
    );
    await expect(
      page.getByRole("link", { name: "ログインして閲覧する" })
    ).toHaveCount(0);
  });

  test("coming back from the gate's login opens the episode on the ticket", async ({
    page,
  }) => {
    await page.goto(hostPath(paidEpisodePath));
    await page.getByRole("link", { name: "ログインして閲覧する" }).click();

    await expect(page).toHaveURL(/\/login\?returnTo=/u);
    // The login shell is a non-interactive skeleton until searchParams
    // resolve. Wait for the real form's returnTo, not the catalog default.
    await expect(page.locator('input[name="returnTo"]')).toHaveValue(
      paidEpisodePath
    );
    await page.getByLabel(/メールアドレス/u).fill(SEED_MEMBER.email);
    await page.getByLabel(/パスワード/u).fill(SEED_MEMBER.password);
    await page.getByRole("button", { name: "ログイン" }).click();

    await expect(page).toHaveURL(new RegExp(`${paidEpisodePath}$`, "u"));
    await expect(
      page.getByText("本文画像はまだ公開されていません。")
    ).toBeVisible();
    await expect(page.getByText("このエピソードは有料です")).toHaveCount(0);
  });
});
